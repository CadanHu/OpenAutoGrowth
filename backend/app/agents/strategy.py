"""
Strategy Agent Node — AI-driven channel scoring and budget allocation.

Input:  state.goal, state.budget, state.kpi, state.constraints, state.report (for feedback loops)
Output: state.strategy (channel_plan[], total_budget, reasoning)
Events: StrategyDecided
"""
import json
import uuid
import structlog
from typing import Any

from app.core.event_bus import event_bus
from app.core.llm import llm_client
from .state import CampaignState

logger = structlog.get_logger(__name__)

STRATEGY_SYSTEM_PROMPT = """
You are a Senior Digital Marketing Strategist. Your task is to allocate a total budget across multiple advertising channels to maximize campaign effectiveness.

Input Context:
1. Campaign Goal: The primary objective.
2. KPI: Target metrics (e.g., Target CPA, ROAS).
3. Constraints: Available channels and regional restrictions.
4. Past Performance (Optional): Metrics from previous optimization loops.

Decision Logic:
- If this is the FIRST loop (no past performance), use industry benchmarks and logical reasoning based on the goal.
- If past performance (report) is provided, perform 'Exploitation' (increase budget for high-performing channels) and 'Exploration' (maintain small budget for testing).
- Ensure total budget equals the provided total.

Response Format (Strict JSON):
{
  "reasoning": "Brief explanation of the strategy",
  "channel_plan": [
    {
      "channel": "string",
      "budget": number,
      "bid_strategy": "ROAS_TARGET | LOWEST_COST | COST_CAP",
      "ctr_baseline": number,
      "priority": "HIGH | MEDIUM | LOW"
    }
  ]
}
"""

def _get_fallback_plan(channels: list[str], total_budget: int) -> dict:
    """Simple proportional allocation as a safety fallback."""
    if not channels:
        channels = ["google", "meta"]
    per_channel = total_budget // len(channels)
    return {
        "reasoning": "Fallback: Equal distribution due to AI processing error.",
        "channel_plan": [
            {
                "channel": ch,
                "budget": per_channel,
                "bid_strategy": "LOWEST_COST",
                "ctr_baseline": 0.03,
                "priority": "MEDIUM"
            } for ch in channels
        ]
    }

async def strategy_node(state: CampaignState) -> dict:
    """LangGraph node: AI-driven decision on channel mix and budget split."""
    campaign_id = state.get("campaign_id", "unknown")
    logger.info("strategy_start", campaign_id=campaign_id, loop=state.get("loop_count", 0))

    # 1. Prepare context for LLM
    goal = state.get("goal", "General awareness")
    kpi = state.get("kpi", {})
    budget_config = state.get("budget", {"total": 1000})
    total_budget = budget_config.get("total", 0)
    constraints = state.get("constraints") or {}
    channels = constraints.get("channels") or ["tiktok", "meta", "google", "wechat"]
    report = state.get("report")

    prompt = f"""
Campaign Goal: {goal}
KPI Targets: {json.dumps(kpi)}
Total Budget: {total_budget}
Available Channels: {", ".join(channels)}
Current Loop: {state.get("loop_count", 0)}
Past Performance Report: {json.dumps(report) if report else "No previous data available."}

Generate the optimal budget allocation and strategy.
"""

    # 2. Call LLM for reasoning
    try:
        response_text = await llm_client.chat_completion(
            messages=[{"role": "user", "content": prompt}],
            system=STRATEGY_SYSTEM_PROMPT
        )
        
        # Extract JSON (handling potential markdown formatting)
        if "```json" in response_text:
            response_text = response_text.split("```json")[1].split("```")[0].strip()
        elif "```" in response_text:
            response_text = response_text.split("```")[1].split("```")[0].strip()
            
        strategy_data = json.loads(response_text)
        
        # Validate total budget (ensure AI didn't hallucinate a different total)
        allocated_total = sum(item["budget"] for item in strategy_data.get("channel_plan", []))
        if abs(allocated_total - total_budget) > (total_budget * 0.05): # 5% margin
             logger.warn("strategy_budget_mismatch", allocated=allocated_total, expected=total_budget)
             # Rescale to match total_budget exactly
             if allocated_total > 0:
                 for item in strategy_data["channel_plan"]:
                     item["budget"] = int(item["budget"] * total_budget / allocated_total)

    except Exception as e:
        logger.error("strategy_ai_failed", error=str(e))
        strategy_data = _get_fallback_plan(channels, total_budget)

    # 3. Finalize strategy object
    strategy = {
        "strategy_id": f"strat_{uuid.uuid4().hex[:8]}",
        "total_budget": total_budget,
        **strategy_data
    }

    # 4. Notify system and return update
    await event_bus.publish("StrategyDecided", {"strategy": strategy}, campaign_id)

    logger.info("strategy_done", channels=[c["channel"] for c in strategy["channel_plan"]])
    
    return {
        "strategy": strategy,
        "completed_tasks": ["strategy"],
    }
