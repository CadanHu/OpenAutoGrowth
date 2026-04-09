"""
Planner Agent Node — scenario detection + DAG plan generation.

Input:  state.goal, state.budget, state.kpi, state.constraints
Output: state.plan, state.scenario
Events: PlanGenerated
"""
import structlog
from anthropic import AsyncAnthropic

from app.config import settings
from app.core.event_bus import event_bus
from .state import CampaignState

logger = structlog.get_logger(__name__)
_client = AsyncAnthropic(api_key=settings.anthropic_api_key)

# DAG templates — mirrors Planner.js but is the authoritative Python version
_TEMPLATES: dict[str, list[dict]] = {
    "NEW_PRODUCT": [
        {"id": "t1", "agent_type": "STRATEGY",    "dependencies": [],           "parallel_group": None},
        {"id": "t2", "agent_type": "CONTENT_GEN", "dependencies": ["t1"],       "parallel_group": "gen"},
        {"id": "t3", "agent_type": "MULTIMODAL",  "dependencies": ["t1"],       "parallel_group": "gen"},
        {"id": "t4", "agent_type": "CHANNEL_EXEC","dependencies": ["t2", "t3"], "parallel_group": None},
        {"id": "t5", "agent_type": "ANALYSIS",    "dependencies": ["t4"],       "parallel_group": None},
        {"id": "t6", "agent_type": "OPTIMIZER",   "dependencies": ["t5"],       "parallel_group": None},
    ],
    "RETENTION": [
        {"id": "t1", "agent_type": "CONTENT_GEN", "dependencies": [],           "parallel_group": "gen"},
        {"id": "t2", "agent_type": "STRATEGY",    "dependencies": [],           "parallel_group": "gen"},
        {"id": "t3", "agent_type": "CHANNEL_EXEC","dependencies": ["t1", "t2"], "parallel_group": None},
        {"id": "t4", "agent_type": "ANALYSIS",    "dependencies": ["t3"],       "parallel_group": None},
        {"id": "t5", "agent_type": "OPTIMIZER",   "dependencies": ["t4"],       "parallel_group": None},
    ],
    "BRAND_AWARENESS": [
        {"id": "t1", "agent_type": "MULTIMODAL",  "dependencies": [],                     "parallel_group": None},
        {"id": "t2", "agent_type": "CONTENT_GEN", "dependencies": ["t1"],                 "parallel_group": None},
        {"id": "t3", "agent_type": "STRATEGY",    "dependencies": [],                     "parallel_group": None},
        {"id": "t4", "agent_type": "CHANNEL_EXEC","dependencies": ["t1", "t2", "t3"],     "parallel_group": None},
        {"id": "t5", "agent_type": "ANALYSIS",    "dependencies": ["t4"],                 "parallel_group": None},
        {"id": "t6", "agent_type": "OPTIMIZER",   "dependencies": ["t5"],                 "parallel_group": None},
    ],
    "GROWTH_GENERAL": [
        {"id": "t1", "agent_type": "STRATEGY",    "dependencies": [],           "parallel_group": None},
        {"id": "t2", "agent_type": "CONTENT_GEN", "dependencies": ["t1"],       "parallel_group": "gen"},
        {"id": "t3", "agent_type": "MULTIMODAL",  "dependencies": ["t1"],       "parallel_group": "gen"},
        {"id": "t4", "agent_type": "CHANNEL_EXEC","dependencies": ["t2", "t3"], "parallel_group": None},
        {"id": "t5", "agent_type": "ANALYSIS",    "dependencies": ["t4"],       "parallel_group": None},
        {"id": "t6", "agent_type": "OPTIMIZER",   "dependencies": ["t5"],       "parallel_group": None},
    ],
}


def _detect_scenario(goal: str, constraints: dict) -> str:
    g = goal.lower()
    if any(k in g for k in ["新品", "冷启动", "launch", "new product"]):
        return "NEW_PRODUCT"
    if any(k in g for k in ["复购", "retention", "留存"]):
        return "RETENTION"
    if any(k in g for k in ["品牌", "brand awareness", "曝光"]):
        return "BRAND_AWARENESS"
    return "GROWTH_GENERAL"


async def planner_node(state: CampaignState) -> dict:
    """
    LangGraph node function.
    In production: calls Claude to generate a dynamic DAG.
    Current: rule-based scenario detection + static templates.
    """
    logger.info("planner_start", campaign_id=state["campaign_id"], goal=state["goal"][:60])

    try:
        scenario = _detect_scenario(state["goal"], state.get("constraints", {}))
        tasks = _TEMPLATES[scenario]

        import uuid
        plan = {
            "id": f"plan_{uuid.uuid4().hex[:8]}",
            "scenario": scenario,
            "tasks": tasks,
        }

        await event_bus.publish(
            "PlanGenerated",
            {"plan": plan, "scenario": scenario},
            state["campaign_id"],
        )

        logger.info("planner_done", scenario=scenario, tasks=len(tasks))
        return {
            "plan": plan,
            "scenario": scenario,
            "status": "PLANNING",
            "completed_tasks": ["planner"],
        }

    except Exception as exc:
        logger.error("planner_error", error=str(exc))
        return {
            "errors": [{"node": "planner", "error": str(exc)}],
            "status": "PLANNING_FAILED",
        }
