"""
ARQ async task definitions — long-running agent pipeline jobs.
ARQ worker: `arq app.tasks.agent_tasks.WorkerSettings`
"""
import uuid
from typing import Any

import structlog
from arq import create_pool
from arq.connections import RedisSettings

from app.config import settings
from app.core.event_bus import event_bus

logger = structlog.get_logger(__name__)


# ── Lifecycle Hooks ──────────────────────────────────────────────────────────

async def startup(ctx: dict):
    """Initialize resources for the worker process."""
    await event_bus.connect()
    logger.info("worker_startup_complete")


async def shutdown(ctx: dict):
    """Cleanup resources."""
    await event_bus.disconnect()
    logger.info("worker_shutdown_complete")


# ── Task Functions (executed by ARQ worker) ───────────────────────────────────

async def run_campaign_pipeline(ctx: dict, campaign_id: str):
    """
    Full campaign pipeline: PLANNING → DEPLOYED → MONITORING → OPTIMIZING.
    Invokes the LangGraph StateGraph with PostgreSQL checkpointer.
    """
    # Robustness: ensure event_bus is connected in this worker process
    if not event_bus._redis:
        await event_bus.connect()

    logger.info("campaign_pipeline_start", campaign_id=campaign_id)

    from app.database import get_checkpointer, async_session_factory
    from app.agents.graph import build_campaign_graph
    from app.models.campaign import Campaign

    async with async_session_factory() as db:
        campaign = await db.get(Campaign, uuid.UUID(campaign_id))
        if not campaign:
            logger.error("campaign_not_found", campaign_id=campaign_id)
            return {"error": "campaign_not_found"}

        initial_state = {
            "campaign_id":    campaign_id,
            "goal":           campaign.goal,
            "budget":         {"total": campaign.budget_total, "currency": campaign.currency},
            "kpi":            {"metric": campaign.kpi_metric, "target": campaign.kpi_target},
            "constraints":    {"channels": campaign.target_channels or [], "region": campaign.target_region},
            "status":         "PLANNING",
            "loop_count":     0,
            "errors":         [],
            "completed_tasks":[],
        }

    async with get_checkpointer() as checkpointer:
        graph = build_campaign_graph(checkpointer)
        config = {"configurable": {"thread_id": campaign_id}}
        result = await graph.ainvoke(initial_state, config=config)

    # Final status update to trigger frontend 'COMPLETED' (loop-back) visual
    final_status = result.get("status", "COMPLETED")
    if final_status == "OPTIMIZING":
         # In the logic, OPTIMIZING means we finished a loop and KPI was met
         # Let's broadcast COMPLETED to trigger the UI loop-back animation
         await event_bus.publish("StatusChanged", {"old_status": "OPTIMIZING", "new_status": "COMPLETED"}, campaign_id)

    logger.info("campaign_pipeline_done", campaign_id=campaign_id, status=final_status)
    return result


async def run_agent_node(ctx: dict, agent_name: str, task_id: str, agent_input: dict):
    """
    Run a single agent node (for A2A task routing).
    Stores result in Redis for polling via GET /v1/agents/{name}/tasks/{id}
    """
    import json
    import redis.asyncio as aioredis

    logger.info("agent_node_start", agent=agent_name, task_id=task_id)

    node_map = {
        "planner":      "app.agents.planner:planner_node",
        "strategy":     "app.agents.strategy:strategy_node",
        "content_gen":  "app.agents.content_gen:content_gen_node",
        "multimodal":   "app.agents.multimodal:multimodal_node",
        "channel_exec": "app.agents.channel_exec:channel_exec_node",
        "analysis":     "app.agents.analysis:analysis_node",
        "optimizer":    "app.agents.optimizer:optimizer_node",
    }

    if agent_name not in node_map:
        result = {"error": f"unknown agent: {agent_name}"}
    else:
        module_path, fn_name = node_map[agent_name].rsplit(":", 1)
        import importlib
        module = importlib.import_module(module_path)
        node_fn = getattr(module, fn_name)
        result = await node_fn(agent_input)

    redis_client = aioredis.from_url(settings.arq_redis_url, decode_responses=True)
    await redis_client.set(
        f"a2a:task:{task_id}",
        json.dumps({"output": result}),
        ex=3600,
    )
    await redis_client.aclose()

    logger.info("agent_node_done", agent=agent_name, task_id=task_id)
    return result


# ── Client helpers (called from FastAPI routes) ───────────────────────────────

async def enqueue_campaign(campaign_id: str) -> str:
    """Enqueue a full campaign pipeline job. Returns ARQ job ID."""
    pool = await create_pool(RedisSettings.from_dsn(settings.arq_redis_url))
    job = await pool.enqueue_job("run_campaign_pipeline", campaign_id)
    await pool.aclose()
    return job.job_id if job else str(uuid.uuid4())


async def enqueue_agent_node(agent_name: str, task_id: str, agent_input: dict) -> str:
    """Enqueue a single agent node job for A2A task handling."""
    pool = await create_pool(RedisSettings.from_dsn(settings.arq_redis_url))
    job = await pool.enqueue_job("run_agent_node", agent_name, task_id, agent_input)
    await pool.aclose()
    return job.job_id if job else str(uuid.uuid4())


async def get_task_result(task_id: str) -> dict | None:
    """Poll Redis for a completed A2A task result."""
    import json
    import redis.asyncio as aioredis
    redis_client = aioredis.from_url(settings.arq_redis_url, decode_responses=True)
    raw = await redis_client.get(f"a2a:task:{task_id}")
    await redis_client.aclose()
    return json.loads(raw) if raw else None


async def cancel_job(task_id: str) -> bool:
    """Attempt to cancel a queued ARQ job. Returns True if cancelled."""
    # ARQ doesn't support cancellation directly; mark as cancelled in Redis
    import redis.asyncio as aioredis
    import json
    redis_client = aioredis.from_url(settings.arq_redis_url, decode_responses=True)
    await redis_client.set(
        f"a2a:task:{task_id}",
        json.dumps({"error": "cancelled"}),
        ex=3600,
    )
    await redis_client.aclose()
    return True


# ── ARQ Worker Settings ───────────────────────────────────────────────────────

class WorkerSettings:
    functions = [run_campaign_pipeline, run_agent_node]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(settings.arq_redis_url)
    max_jobs = settings.arq_max_jobs
    job_timeout = settings.arq_job_timeout
    keep_result = 3600  # seconds
