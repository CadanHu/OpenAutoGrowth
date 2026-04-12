"""
Optimizer Agent Node — AI + RuleEngine hybrid closed-loop decision.

Input:  state.report, state.anomalies, state.kpi, state.loop_count
Output: state.opt_actions, state.loop_count (incremented)
Events: OptimizationApplied
Routing: should_loop() → "loop_strategy" | "loop_content" | "loop_exec" | "done"
"""
import json
import structlog
from typing import Any

from app.core.event_bus import event_bus
from app.core.rule_engine import rule_engine
from app.core.llm import llm_client
from .state import CampaignState

logger = structlog.get_logger(__name__)

MAX_LOOPS = 5

OPTIMIZER_SYSTEM_PROMPT = """
You are a Performance Marketing AI Optimizer. Your goal is to analyze campaign performance and suggest surgical improvements.

Available Action Types:
1. REWRITE_COPY: When CTR is low or messaging feels misaligned with the goal.
2. ADJUST_BID: When cost is too high or we are not winning auctions.
3. INCREASE_BUDGET: When ROAS is high and there's room to scale.
4. PAUSE_AD_GROUP: When performance is consistently below KPI.
5. REFRESH_STRATEGY: When current channel mix is not working.

Input:
- Metrics: Current performance (CTR, CPC, ROAS, Conversions).
- KPI Targets: What we aim to achieve.
- Loop Count: How many times we've tried to optimize.

Output (Strict JSON):
{
  "analysis": "Briefly explain the bottleneck identified.",
  "ai_actions": [
    {
      "type": "REWRITE_COPY | ADJUST_BID | INCREASE_BUDGET | PAUSE_AD_GROUP | REFRESH_STRATEGY",
      "params": { "reason": "string", "suggestion": "specific instruction for next agent" },
      "priority": 1-10
    }
  ]
}
"""

async def optimizer_node(state: CampaignState) -> dict:
    """LangGraph node: hybrid AI + Rules optimization."""
    campaign_id = state["campaign_id"]
    loop_count = state.get("loop_count", 0)
    logger.info("optimizer_start", campaign_id=campaign_id, loop=loop_count)

    report = state.get("report") or {}
    metrics = report.get("metrics", {})
    kpi = state.get("kpi") or {}
    anomalies = state.get("anomalies") or []

    # 1. Evaluate Deterministic Rules (Safety Floor)
    rule_context = {
        "metrics": metrics,
        "kpi": kpi,
        "anomalies": anomalies,
        "loop_count": loop_count,
    }
    rule_actions = rule_engine.evaluate(rule_context, campaign_id)

    # 2. Call AI for Deep Analysis (Strategic Brain)
    ai_actions = []
    analysis_summary = "No AI analysis performed."
    
    try:
        prompt = f"""
        Performance Metrics: {json.dumps(metrics)}
        KPI Targets: {json.dumps(kpi)}
        Anomalies: {json.dumps(anomalies)}
        Current Loop: {loop_count}
        """
        
        response_text = await llm_client.chat_completion(
            messages=[{"role": "user", "content": prompt}],
            system=OPTIMIZER_SYSTEM_PROMPT
        )
        
        # Parse JSON from AI response
        if "```json" in response_text:
            response_text = response_text.split("```json")[1].split("```")[0].strip()
        
        ai_data = json.loads(response_text)
        ai_actions = ai_data.get("ai_actions", [])
        analysis_summary = ai_data.get("analysis", "AI analysis completed.")
        
    except Exception as e:
        logger.error("optimizer_ai_failed", error=str(e))

    # 3. Merge Actions (Rules + AI)
    # Note: Rules usually have higher priority for immediate stops/safety
    combined_actions = rule_actions + ai_actions
    
    new_loop_count = loop_count + 1

    await event_bus.publish(
        "OptimizationApplied",
        {
            "actions": combined_actions, 
            "loop_count": new_loop_count,
            "analysis": analysis_summary
        },
        campaign_id,
    )

    logger.info("optimizer_done", actions=len(combined_actions), loop=new_loop_count)
    return {
        "opt_actions": combined_actions,
        "loop_count": new_loop_count,
        "status": "OPTIMIZING",
        "completed_tasks": ["optimizer"],
    }


def should_loop(state: CampaignState) -> str:
    """
    Conditional edge function: determines WHERE to loop back based on action types.
    Returns: "loop_strategy" | "loop_content" | "loop_exec" | "done"
    """
    if state.get("loop_count", 0) >= MAX_LOOPS:
        logger.info("optimizer_max_loops_reached")
        return "done"

    report = state.get("report") or {}
    metrics = report.get("metrics", {})
    roas = metrics.get("roas", 0.0)
    target = state.get("kpi", {}).get("target", 3.0)

    # 1. Check if KPI achieved
    if roas >= target and roas > 0:
        logger.info("optimizer_kpi_achieved", roas=roas, target=target)
        return "done"

    # 2. Analyze actions to determine the most efficient loop-back point
    actions = state.get("opt_actions") or []
    if not actions:
        return "done"

    action_types = {a.get("type") for a in actions}

    # Priority 1: Strategy Change (Budget re-allocation across channels)
    if "INCREASE_BUDGET" in action_types or "PAUSE_CAMPAIGN" in action_types:
        logger.info("optimizer_loop_strategy", reason="budget_reallocation")
        return "loop_strategy"

    # Priority 2: Content Change (New variants needed)
    if "REWRITE_COPY" in action_types or "PAUSE_LOSING_VARIANTS" in action_types:
        logger.info("optimizer_loop_content", reason="creative_refresh")
        return "loop_content"

    # Priority 3: Execution Change (Pure bidding or ad-group level pause)
    if "PAUSE_AD_GROUP" in action_types or "ADJUST_BID" in action_types:
        logger.info("optimizer_loop_exec", reason="bidding_adjustment")
        return "loop_exec"

    # Default fallback
    return "loop_strategy"
