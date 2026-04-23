"""
Planner Agent Node — scenario detection + DAG plan generation.

Input:  state.goal, state.budget, state.kpi, state.constraints
Output: state.plan, state.scenario
Events: PlanGenerated
"""
import json
import structlog
import uuid

from app.config import settings
from app.core.event_bus import event_bus
from app.core.llm import llm_client
from .state import CampaignState

logger = structlog.get_logger(__name__)

def _print_ascii_dag(tasks: list[dict]):
    """Print a human-readable ASCII representation of the generated DAG."""
    print("\n" + "="*50)
    print(" 🗺️  GENERATED AGENT PLAN (DAG)")
    print("="*50)
    
    # Simple dependency visualization
    for task in tasks:
        deps = ", ".join(task['dependencies']) if task['dependencies'] else "START"
        parallel = f" [Parallel: {task['parallel_group']}]" if task.get('parallel_group') else ""
        print(f" {task['id']:<4} | {task['agent_type']:<15} | Deps: {deps:<15}{parallel}")
    
    print("="*50 + "\n")
async def planner_node(state: CampaignState) -> dict:
    """
    Planner Agent: Uses LLM to dynamically generate a task DAG based on the goal.
    Now incorporates historical insights from MemorySystem.
    """
    campaign_id = state.get("campaign_id", "unknown")
    goal = state.get("goal", "")
    logger.info("planner_start", campaign_id=campaign_id, goal=goal[:60])

    # 1. Retrieve Historical Experience from Memory
    from app.core.memory import memory_system
    from app.database import async_session_factory
    historical_context = ""
    try:
        async with async_session_factory() as db:
            past_memories = await memory_system.get_similar(goal, top_k=2, db_session=db)
            if past_memories:
                historical_context = "\n### RELEVANT PAST EXPERIENCES ###\n"
                for m in past_memories:
                    historical_context += f"- LEARNING: {m['content']}\n"
                historical_context += "Use these learnings to create a more robust plan.\n"
    except Exception as e:
        logger.warn("planner_memory_fetch_failed", error=str(e))

    system_prompt = (
        "You are a senior AI Solutions Architect. Your task is to decompose a marketing goal into a "
        "Directed Acyclic Graph (DAG) of specialized agent tasks.\n\n"
        "Available Agent Types:\n"
        "- STRATEGY: Budget allocation and channel selection.\n"
        "- CONTENT_GEN: Copywriting and text generation.\n"
        "- MULTIMODAL: Visual asset (image/video) generation.\n"
        "- CHANNEL_EXEC: Deploying content to platforms (Zhihu, TikTok, etc.).\n"
        "- ANALYSIS: Performance tracking and ROI calculation.\n"
        "- OPTIMIZER: Strategy refinement and closed-loop decision making.\n\n"
        "Return a JSON object with 'scenario' (string) and 'tasks' (array of objects).\n"
        "Each task object must have: id (t1, t2...), agent_type, dependencies (list of IDs), parallel_group (optional string).\n"
        "Ensure the graph is logical: e.g., CHANNEL_EXEC depends on CONTENT_GEN."
    )

    user_prompt = f"Product Goal: {goal}\nConstraints: {json.dumps(state.get('constraints', {}))}"
    if historical_context:
        user_prompt += historical_context

    try:

        # 1. Dynamic Generation via LLM
        raw_response = await llm_client.chat_completion(
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
            max_tokens=2048
        )
        
        # Extract JSON (handling potential markdown)
        start = raw_response.find('{')
        end = raw_response.rfind('}')
        plan_data = json.loads(raw_response[start:end+1])
        
        tasks = plan_data.get("tasks", [])
        scenario = plan_data.get("scenario", "DYNAMIC_GROWTH")

        # 2. Print ASCII Visualization for the user (in server logs)
        _print_ascii_dag(tasks)

        plan = {
            "id": f"plan_{uuid.uuid4().hex[:8]}",
            "scenario": scenario,
            "tasks": tasks,
        }

        # 3. Notify Frontend
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
        # Fallback to a basic template if LLM fails
        return {
            "errors": [{"node": "planner", "error": f"LLM Planning failed: {str(exc)}"}],
            "status": "PLANNING_FAILED",
        }
