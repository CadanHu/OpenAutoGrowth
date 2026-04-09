"""
Strategy Agent Node — channel scoring and budget allocation.

Input:  state.goal, state.budget, state.constraints, state.report (for loops)
Output: state.strategy  (channel_plan[], total_budget)
Events: StrategyDecided
"""
import uuid

import structlog

from app.core.event_bus import event_bus
from .state import CampaignState

logger = structlog.get_logger(__name__)

# Channel scoring weights (production: replace with ML model or Claude reasoning)
_CHANNEL_SCORES: dict[str, dict[str, float]] = {
    "tiktok":  {"reach": 0.9, "ctr_baseline": 0.04, "cpa_efficiency": 0.8},
    "meta":    {"reach": 0.85,"ctr_baseline": 0.03, "cpa_efficiency": 0.85},
    "google":  {"reach": 0.8, "ctr_baseline": 0.05, "cpa_efficiency": 0.9},
    "wechat":  {"reach": 0.7, "ctr_baseline": 0.02, "cpa_efficiency": 0.75},
    "weibo":   {"reach": 0.6, "ctr_baseline": 0.025,"cpa_efficiency": 0.7},
}


def _allocate_budget(channels: list[str], total: int) -> list[dict]:
    """
    Proportional budget allocation based on channel efficiency scores.
    Production: replace with Bayesian optimization or LP solver.
    """
    scores = {ch: _CHANNEL_SCORES.get(ch, {"cpa_efficiency": 0.5}) for ch in channels}
    total_score = sum(v["cpa_efficiency"] for v in scores.values()) or 1.0

    return [
        {
            "channel": ch,
            "budget": int(total * scores[ch]["cpa_efficiency"] / total_score),
            "bid_strategy": "ROAS_TARGET",
            "ctr_baseline": scores[ch].get("ctr_baseline", 0.03),
        }
        for ch in channels
    ]


async def strategy_node(state: CampaignState) -> dict:
    """LangGraph node: decide channel mix and budget split."""
    logger.info("strategy_start", campaign_id=state["campaign_id"])

    constraints = state.get("constraints") or {}
    channels = constraints.get("channels") or ["tiktok", "meta"]
    total_budget = state["budget"].get("total", 0)

    # Adjust based on previous loop report (closed-loop optimization)
    report = state.get("report")
    if report and state.get("loop_count", 0) > 0:
        # In production: use report metrics to re-score channels
        logger.info("strategy_adjusting_for_loop", loop=state["loop_count"])

    channel_plan = _allocate_budget(channels, total_budget)

    strategy = {
        "strategy_id": f"strat_{uuid.uuid4().hex[:8]}",
        "channel_plan": channel_plan,
        "total_budget": total_budget,
    }

    await event_bus.publish("StrategyDecided", {"strategy": strategy}, state["campaign_id"])

    logger.info("strategy_done", channels=channels)
    return {
        "strategy": strategy,
        "completed_tasks": ["strategy"],
    }
