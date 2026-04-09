"""
Optimizer Agent Node — RuleEngine evaluation + closed-loop decision.

Input:  state.report, state.anomalies, state.kpi, state.loop_count
Output: state.opt_actions, state.loop_count (incremented)
Events: OptimizationApplied
Routing: should_loop() → "loop" | "done"
"""
import structlog

from app.core.event_bus import event_bus
from app.core.rule_engine import rule_engine
from .state import CampaignState

logger = structlog.get_logger(__name__)

MAX_LOOPS = 5


async def optimizer_node(state: CampaignState) -> dict:
    """LangGraph node: evaluate rules and decide optimization actions."""
    logger.info("optimizer_start", campaign_id=state["campaign_id"], loop=state.get("loop_count", 0))

    report   = state.get("report") or {}
    kpi      = state.get("kpi") or {}
    anomalies = state.get("anomalies") or []

    context = {
        "metrics":   report.get("metrics", {}),
        "kpi":       kpi,
        "anomalies": anomalies,
        "loop_count": state.get("loop_count", 0),
    }

    actions = rule_engine.evaluate(context, state["campaign_id"])
    new_loop_count = state.get("loop_count", 0) + 1

    await event_bus.publish(
        "OptimizationApplied",
        {"actions": actions, "loop_count": new_loop_count},
        state["campaign_id"],
    )

    logger.info("optimizer_done", actions=len(actions), loop_count=new_loop_count)
    return {
        "opt_actions": actions,
        "loop_count": new_loop_count,
        "status": "OPTIMIZING",
        "completed_tasks": ["optimizer"],
    }


def should_loop(state: CampaignState) -> str:
    """
    Conditional edge function: determines whether to loop back to strategy.
    Returns "loop" or "done".
    """
    if state.get("loop_count", 0) >= MAX_LOOPS:
        logger.info("optimizer_max_loops_reached")
        return "done"

    report = state.get("report") or {}
    metrics = report.get("metrics", {})
    roas = metrics.get("roas", 0.0)
    target = state.get("kpi", {}).get("target", 3.0)

    if roas >= target:
        logger.info("optimizer_kpi_achieved", roas=roas, target=target)
        return "done"

    # Continue looping if there are actionable optimization recommendations
    actions = state.get("opt_actions") or []
    if not actions:
        return "done"

    logger.info("optimizer_loop_continue", roas=roas, target=target, actions=len(actions))
    return "loop"
