"""
ARQ async task definitions — long-running agent pipeline jobs.
ARQ worker: `arq app.tasks.agent_tasks.WorkerSettings`
"""
import json
import uuid
from datetime import datetime, date
from typing import Any

import structlog
from arq import create_pool
from arq.connections import RedisSettings

from app.config import settings
from app.core.event_bus import event_bus

logger = structlog.get_logger(__name__)


def _jsonb_safe(obj):
    """Recursively convert non-serializable types (UUID, datetime, etc.) to strings
    so payloads can be stored in PostgreSQL JSONB columns."""
    if isinstance(obj, dict):
        return {k: _jsonb_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_jsonb_safe(v) for v in obj]
    if isinstance(obj, uuid.UUID):
        return str(obj)
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, bytes):
        return obj.hex()
    return obj


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
    After execution, persists all results (Plan, Tasks, DomainEvents, status)
    back to the database.
    """
    # Robustness: ensure event_bus is connected in this worker process
    if not event_bus._redis:
        await event_bus.connect()

    logger.info("campaign_pipeline_start", campaign_id=campaign_id)

    from app.database import get_checkpointer, async_session_factory
    from app.agents.graph import build_campaign_graph
    from app.models.campaign import Campaign, Plan, Task, DomainEvent

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

    # Tag every llm_client.chat_completion call inside the graph with this
    # campaign_id so token usage rows land in the right bucket. ContextVar
    # is local to the running task; no cross-job leakage.
    from app.core.llm import current_campaign_id
    cv_token = current_campaign_id.set(campaign_id)
    try:
        async with get_checkpointer() as checkpointer:
            graph = build_campaign_graph(checkpointer)
            config = {"configurable": {"thread_id": campaign_id}}
            result = await graph.ainvoke(initial_state, config=config)
    finally:
        current_campaign_id.reset(cv_token)

    # ── Persist results back to DB ────────────────────────────────────────
    final_status = result.get("status", "COMPLETED")
    # Map LangGraph internal status to DB-valid enum values
    db_status = final_status
    if db_status == "OPTIMIZING":
        loop = result.get("loop_count", 1)
        if loop <= 5:
            db_status = f"LOOP_{loop}"
        else:
            db_status = "OPTIMIZING"

    completed_tasks = result.get("completed_tasks", [])

    # Event-type/payload mapping is shared between the persistence block and
    # the broadcast loop below, so define it at function scope.
    event_map = {
        "planner":      ("PlanGenerated",        lambda r: {"plan": r.get("plan", {}), "scenario": r.get("scenario", "")}),
        "strategy":     ("StrategyDecided",      lambda r: {"strategy": r.get("strategy", {})}),
        "content_gen":  ("ContentGenerated",     lambda r: {"bundle": r.get("content", {})}),
        "multimodal":   ("AssetsGenerated",      lambda r: {"assets": r.get("assets", {})}),
        "reviewer":     ("ContentApproved",      lambda r: {"review_result": r.get("review_result", ""), "feedback": r.get("review_feedback", "")}),
        "channel_exec": ("AdDeployed",           lambda r: r.get("deployed_ads", {})),
        "analysis":     ("ReportGenerated",      lambda r: r.get("report", {})),
        "optimizer":    ("OptimizationApplied",  lambda r: {"actions": r.get("opt_actions", []), "loop_count": r.get("loop_count", 0)}),
    }

    old_status = "UNKNOWN"
    persisted = False
    try:
        async with async_session_factory() as db:
            campaign = await db.get(Campaign, uuid.UUID(campaign_id))
            if not campaign:
                logger.error("campaign_not_found_on_persist", campaign_id=campaign_id)
                return result

            # 1. Update campaign status and loop_count
            old_status = campaign.status
            campaign.status = db_status
            campaign.loop_count = result.get("loop_count", 0)
            db.add(campaign)

            # 2. Persist the Plan and Tasks if planner produced them.
            # `plans.scenario` is VARCHAR(50) — the LLM sometimes returns a long
            # sentence here, so cap to 50 chars before INSERT (the full text
            # is still preserved inside the JSONB `dag` column).
            plan_data = result.get("plan")
            if plan_data and plan_data.get("tasks"):
                scenario_raw = (plan_data.get("scenario") or "DYNAMIC")
                plan = Plan(
                    campaign_id=campaign.id,
                    scenario=str(scenario_raw)[:50],
                    dag=_jsonb_safe(plan_data),
                )
                db.add(plan)
                await db.flush()  # get plan.id

                for t in plan_data["tasks"]:
                    task = Task(
                        plan_id=plan.id,
                        campaign_id=campaign.id,
                        task_key=str(t.get("id", ""))[:20],
                        agent_type=t["agent_type"],
                        dependencies=t.get("dependencies", []),
                        params=t,
                        status="DONE" if t["agent_type"].lower().replace("_", "") in
                               [c.lower().replace("_", "") for c in completed_tasks] else "PENDING",
                    )
                    db.add(task)

            # 3. Record DomainEvents for each completed pipeline stage,
            #    enriched with LLM token usage per agent.
            from app.models.usage import LLMUsage
            from app.core.llm import estimate_cost_usd
            from sqlalchemy import select as sa_select

            # Map task_name to agent_type strings stored in llm_usage
            _AGENT_TYPE_MAP = {
                "planner":      "PLANNER",
                "strategy":     "STRATEGY",
                "content_gen":  "CONTENT_GEN",
                "multimodal":   "MULTIMODAL",
                "reviewer":     "REVIEWER",
                "channel_exec": "CHANNEL_EXEC",
                "analysis":     "ANALYSIS",
                "optimizer":    "OPTIMIZER",
            }

            # Fetch all usage rows for this campaign in one query
            all_usage_rows = (await db.execute(
                sa_select(LLMUsage).where(LLMUsage.campaign_id == campaign.id)
            )).scalars().all()

            # Group by agent_type
            usage_by_agent: dict[str, list] = {}
            for row in all_usage_rows:
                usage_by_agent.setdefault(row.agent_type or "UNKNOWN", []).append(row)

            for task_name in completed_tasks:
                if task_name in event_map:
                    event_type, payload_fn = event_map[task_name]
                    try:
                        payload = _jsonb_safe(payload_fn(result))
                    except Exception:
                        payload = {}

                    # Attach LLM usage summary for this agent step
                    agent_key = _AGENT_TYPE_MAP.get(task_name)
                    agent_rows = usage_by_agent.get(agent_key, [])
                    if agent_rows:
                        total_in = sum(r.input_tokens or 0 for r in agent_rows)
                        total_out = sum(r.output_tokens or 0 for r in agent_rows)
                        models_used = list(set(r.model for r in agent_rows if r.model))
                        providers_used = list(set(r.provider for r in agent_rows if r.provider))
                        total_cost = sum(
                            estimate_cost_usd(r.provider, r.model, r.input_tokens or 0, r.output_tokens or 0)
                            for r in agent_rows
                        )
                        payload["llm_usage"] = {
                            "calls": len(agent_rows),
                            "models": models_used,
                            "providers": providers_used,
                            "input_tokens": total_in,
                            "output_tokens": total_out,
                            "total_tokens": total_in + total_out,
                            "estimated_cost_usd": round(total_cost, 6),
                        }

                    db.add(DomainEvent(
                        campaign_id=campaign.id,
                        event_type=event_type,
                        payload=payload,
                    ))

            # 4. Final StatusChanged event
            db.add(DomainEvent(
                campaign_id=campaign.id,
                event_type="StatusChanged",
                payload={"old_status": old_status, "new_status": db_status},
            ))

            await db.commit()
            persisted = True
            logger.info("campaign_results_persisted", campaign_id=campaign_id,
                        status=db_status, events_written=len(completed_tasks) + 1)
    except Exception as e:
        # Persistence failure must not kill the broadcast — clients are still
        # waiting on the WS for the final StatusChanged.
        logger.exception("campaign_persist_failed", campaign_id=campaign_id, error=str(e))
        # Best-effort: at least flip the campaign row's status so the UI
        # stops showing PLANNING forever.
        try:
            async with async_session_factory() as db2:
                camp = await db2.get(Campaign, uuid.UUID(campaign_id))
                if camp:
                    old_status = old_status if old_status != "UNKNOWN" else camp.status
                    camp.status = db_status
                    camp.loop_count = result.get("loop_count", 0)
                    db2.add(camp)
                    await db2.commit()
        except Exception as e2:
            logger.warning("campaign_status_fallback_failed", error=str(e2))

    # ── Broadcast to frontend via EventBus ────────────────────────────────
    # Publish each event so WebSocket-connected clients see real-time updates
    for task_name in completed_tasks:
        if task_name in event_map:
            event_type, payload_fn = event_map[task_name]
            try:
                await event_bus.publish(event_type, _jsonb_safe(payload_fn(result)), campaign_id)
            except Exception as e:
                logger.warning("event_broadcast_failed", event=event_type, error=str(e))

    # Final status broadcast
    broadcast_status = "COMPLETED" if final_status == "OPTIMIZING" else db_status
    await event_bus.publish("StatusChanged", {"old_status": old_status, "new_status": broadcast_status}, campaign_id)

    logger.info("campaign_pipeline_done", campaign_id=campaign_id, status=db_status)
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
