"""
Campaign REST API — /v1/campaigns
State machine: DRAFT → PLANNING → RUNNING → COMPLETED
"""
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.campaign import Campaign, DomainEvent
from app.schemas.campaign import (
    CampaignCreate,
    CampaignDetailResponse,
    CampaignListResponse,
    CampaignResponse,
    StartCampaignResponse,
)
from app.core.event_bus import event_bus
from app.core.tenant import resolve_tenant_filter

logger = structlog.get_logger(__name__)
router = APIRouter()


@router.post("/analyze-url")
async def analyze_url_endpoint(payload: dict):
    """
    Scrape and analyze a URL to extract marketing insights.
    Used for pre-filling the campaign creation form.
    """
    from app.agents.analysis import url_analyzer
    url = payload.get("url")
    campaign_type = payload.get("campaign_type", "ecom")
    
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")
        
    logger.info("analyzing_url", url=url, type=campaign_type)
    result = await url_analyzer.analyze(url, campaign_type)
    
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
        
    return result


@router.post("/analyze-url")
async def analyze_url_endpoint(payload: dict):
    """Scrape and analyze a URL to extract marketing insights."""
    from app.agents.analysis import url_analyzer
    url = payload.get("url")
    campaign_type = payload.get("campaign_type", "ecom")
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")
    logger.info("analyzing_url", url=url, type=campaign_type)
    result = await url_analyzer.analyze(url, campaign_type)
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    return result

# Allowed status transitions
TRANSITIONS: dict[str, list[str]] = {
    "DRAFT":           ["PLANNING"],
    "PLANNING":        ["PENDING_REVIEW", "PLANNING_FAILED", "PAUSED"],
    "PENDING_REVIEW":  ["PRODUCTION", "PAUSED"],
    "PRODUCTION":      ["DEPLOYED", "PRODUCTION_FAILED", "PAUSED"],
    "DEPLOYED":        ["MONITORING", "PAUSED"],
    "MONITORING":      ["OPTIMIZING", "PAUSED", "COMPLETED"],
    "OPTIMIZING":      ["MONITORING", "PAUSED", "COMPLETED"],
    # While the LangGraph pipeline is in a loop iteration the campaign sits
    # in LOOP_1..LOOP_5; pause must be reachable from there or the global
    # "Pause all" button can't actually stop a running campaign.
    "LOOP_1":          ["PAUSED", "OPTIMIZING", "MONITORING", "COMPLETED"],
    "LOOP_2":          ["PAUSED", "OPTIMIZING", "MONITORING", "COMPLETED"],
    "LOOP_3":          ["PAUSED", "OPTIMIZING", "MONITORING", "COMPLETED"],
    "LOOP_4":          ["PAUSED", "OPTIMIZING", "MONITORING", "COMPLETED"],
    "LOOP_5":          ["PAUSED", "OPTIMIZING", "MONITORING", "COMPLETED"],
    "PAUSED":          ["MONITORING", "OPTIMIZING", "COMPLETED"],
}


# Redis-backed cooperative pause flag. The ARQ worker's optimizer node
# checks this every loop boundary (see app/agents/optimizer.py); when set,
# the LangGraph short-circuits to "done" instead of starting another loop.
# The flag survives worker restarts and is shared across processes.
def _pause_flag_key(campaign_id) -> str:
    return f"oag:campaign:{campaign_id}:paused"


async def _set_pause_flag(campaign_id) -> None:
    try:
        from app.core.event_bus import event_bus
        if not event_bus._redis:
            await event_bus.connect()
        await event_bus._redis.set(_pause_flag_key(campaign_id), "1", ex=86400)
    except Exception as exc:
        logger.warning("pause_flag_set_failed", campaign_id=str(campaign_id), error=str(exc))


async def _clear_pause_flag(campaign_id) -> None:
    try:
        from app.core.event_bus import event_bus
        if not event_bus._redis:
            await event_bus.connect()
        await event_bus._redis.delete(_pause_flag_key(campaign_id))
    except Exception as exc:
        logger.warning("pause_flag_clear_failed", campaign_id=str(campaign_id), error=str(exc))


async def _get_campaign_or_404(campaign_id: UUID, db: AsyncSession) -> Campaign:
    result = await db.get(Campaign, campaign_id)
    if not result:
        raise HTTPException(status_code=404, detail=f"Campaign {campaign_id} not found")
    return result


async def _transition(campaign: Campaign, new_status: str, db: AsyncSession) -> Campaign:
    allowed = TRANSITIONS.get(campaign.status, [])
    if new_status not in allowed:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot transition from {campaign.status} to {new_status}",
        )
    old_status = campaign.status
    campaign.status = new_status
    db.add(campaign)

    event = DomainEvent(
        campaign_id=campaign.id,
        event_type="StatusChanged",
        payload={"old_status": old_status, "new_status": new_status},
    )
    db.add(event)
    await db.flush()
    # `updated_at` has a server-side default (`now()`), so flush() leaves the
    # ORM attribute marked expired. If we hand the campaign straight to a
    # response_model=CampaignResponse, Pydantic's lazy attribute access
    # triggers an async DB load outside the greenlet context and crashes
    # serialization with `MissingGreenlet`. Explicit refresh keeps it sync.
    await db.refresh(campaign)

    await event_bus.publish(
        "StatusChanged",
        {"old_status": old_status, "new_status": new_status},
        str(campaign.id),
    )
    return campaign


# ── CRUD ──────────────────────────────────────────────────────────────────────

@router.post("", response_model=CampaignResponse, status_code=201)
async def create_campaign(body: CampaignCreate, db: AsyncSession = Depends(get_db)):
    """Create a Campaign in DRAFT status."""
    campaign = Campaign(
        name=body.name or body.goal[:60],
        goal=body.goal,
        budget_total=body.budget.total,
        budget_daily_cap=body.budget.daily_cap,
        currency=body.budget.currency,
        kpi_metric=body.kpi.metric,
        kpi_target=body.kpi.target,
        start_date=body.timeline.start if body.timeline else None,
        end_date=body.timeline.end if body.timeline else None,
        target_channels=body.constraints.channels if body.constraints else [],
        target_region=body.constraints.region if body.constraints else None,
        status="DRAFT",
    )
    db.add(campaign)
    await db.flush()

    event = DomainEvent(
        campaign_id=campaign.id,
        event_type="CampaignCreated",
        payload={"campaign_id": str(campaign.id), "goal": campaign.goal},
    )
    db.add(event)

    await event_bus.publish("CampaignCreated", {"goal": campaign.goal}, str(campaign.id))
    logger.info("campaign_created", campaign_id=str(campaign.id))
    return campaign


@router.get("", response_model=CampaignListResponse)
async def list_campaigns(
    status: str | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    tenant: UUID | None = Depends(resolve_tenant_filter),
):
    """List campaigns with optional status filter and pagination.

    Tenant-scoped: a non-ADMIN only sees their own tenant's campaigns;
    ADMIN sees everything (or a single tenant via ?tenant_id=).
    """
    query = select(Campaign)
    if status:
        query = query.where(Campaign.status == status)
    if tenant is not None:
        query = query.where(Campaign.org_id == tenant)

    total_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(total_q)).scalar_one()

    items_q = query.order_by(Campaign.created_at.desc()).offset(offset).limit(limit)
    items = (await db.execute(items_q)).scalars().all()

    return CampaignListResponse(total=total, items=list(items))


@router.get("/{campaign_id}", response_model=CampaignDetailResponse)
async def get_campaign(campaign_id: UUID, db: AsyncSession = Depends(get_db)):
    """Get full campaign details including plans and tasks."""
    from app.models.campaign import Campaign as CampaignModel, Plan
    result = await db.execute(
        select(CampaignModel)
        .where(CampaignModel.id == campaign_id)
        .options(selectinload(CampaignModel.plans).selectinload(Plan.tasks))
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail=f"Campaign {campaign_id} not found")
    return campaign


# ── State Transitions ─────────────────────────────────────────────────────────

@router.post("/{campaign_id}/start", response_model=StartCampaignResponse, status_code=202)
async def start_campaign(campaign_id: UUID, db: AsyncSession = Depends(get_db)):
    """
    Trigger DAG planning (DRAFT → PLANNING).
    Enqueues an ARQ job; progress is streamed via WebSocket.
    """
    campaign = await _get_campaign_or_404(campaign_id, db)
    await _transition(campaign, "PLANNING", db)

    # Enqueue async agent job
    from app.tasks.agent_tasks import enqueue_campaign
    job_id = await enqueue_campaign(str(campaign_id))

    logger.info("campaign_started", campaign_id=str(campaign_id), job_id=job_id)
    return StartCampaignResponse(
        job_id=job_id, campaign_id=campaign_id, status="PLANNING"
    )


@router.post("/{campaign_id}/pause", response_model=CampaignResponse)
async def pause_campaign(campaign_id: UUID, db: AsyncSession = Depends(get_db)):
    try:
        campaign = await _get_campaign_or_404(campaign_id, db)
        # Set the cooperative pause flag FIRST so any in-flight loop boundary
        # the optimizer reaches sees it before we even commit the DB change.
        await _set_pause_flag(campaign_id)
        return await _transition(campaign, "PAUSED", db)
    except HTTPException:
        raise
    except Exception as exc:
        # Surface real errors instead of letting Starlette swallow them
        # behind a bare "Internal Server Error" body.
        logger.exception("pause_campaign_failed", campaign_id=str(campaign_id))
        raise HTTPException(status_code=500, detail=f"pause failed: {exc!s}") from exc


@router.post("/{campaign_id}/resume", response_model=CampaignResponse)
async def resume_campaign(campaign_id: UUID, db: AsyncSession = Depends(get_db)):
    campaign = await _get_campaign_or_404(campaign_id, db)
    await _clear_pause_flag(campaign_id)
    return await _transition(campaign, "MONITORING", db)


@router.post("/{campaign_id}/complete", response_model=CampaignResponse)
async def complete_campaign(campaign_id: UUID, db: AsyncSession = Depends(get_db)):
    campaign = await _get_campaign_or_404(campaign_id, db)
    await _clear_pause_flag(campaign_id)
    return await _transition(campaign, "COMPLETED", db)


@router.delete("/{campaign_id}", status_code=204)
async def delete_campaign(campaign_id: UUID, db: AsyncSession = Depends(get_db)):
    """
    Delete a campaign and every record that references it.

    Several FKs to `campaigns.id` are NOT configured with ON DELETE CASCADE
    or ORM-side cascade (optimization_records, agent_memory, performance_reports,
    anomalies, content_assets/copies via campaign_id, tasks via campaign_id),
    so we issue explicit DELETE statements in dependency order before removing
    the campaign row itself. A single transaction keeps the operation atomic.
    """
    from sqlalchemy import delete
    from app.models.campaign import Plan, Task
    from app.models.content import ContentBundle, ContentAsset, Copy
    from app.models.analytics import PerformanceReport, ChannelStat, VariantStat, Anomaly
    from app.models.optimization import OptimizationRecord, AgentMemory
    from app.models.usage import LLMUsage

    campaign = await db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail=f"Campaign {campaign_id} not found")

    # 1. Analytics: drill into report children first.
    report_ids_q = select(PerformanceReport.id).where(PerformanceReport.campaign_id == campaign_id)
    await db.execute(delete(VariantStat).where(VariantStat.report_id.in_(report_ids_q)))
    await db.execute(delete(ChannelStat).where(ChannelStat.report_id.in_(report_ids_q)))
    await db.execute(delete(Anomaly).where(Anomaly.campaign_id == campaign_id))
    await db.execute(delete(PerformanceReport).where(PerformanceReport.campaign_id == campaign_id))

    # 2. Optimization side-tables + LLM usage rows.
    await db.execute(delete(OptimizationRecord).where(OptimizationRecord.campaign_id == campaign_id))
    await db.execute(delete(AgentMemory).where(AgentMemory.campaign_id == campaign_id))
    await db.execute(delete(LLMUsage).where(LLMUsage.campaign_id == campaign_id))

    # 3. Content tree — bundle → copies + assets.
    bundle_ids_q = select(ContentBundle.id).where(ContentBundle.campaign_id == campaign_id)
    await db.execute(delete(Copy).where(Copy.bundle_id.in_(bundle_ids_q)))
    await db.execute(delete(ContentAsset).where(ContentAsset.campaign_id == campaign_id))
    await db.execute(delete(ContentBundle).where(ContentBundle.campaign_id == campaign_id))

    # 4. Plan / Task tree (Task has FKs to BOTH plans and campaigns, delete by
    # campaign_id covers any orphans that escaped plan-cascade).
    await db.execute(delete(Task).where(Task.campaign_id == campaign_id))
    await db.execute(delete(Plan).where(Plan.campaign_id == campaign_id))

    # 5. Domain events (declared cascade, but be explicit so pure-SQL deletes
    # don't depend on ORM-load order).
    await db.execute(delete(DomainEvent).where(DomainEvent.campaign_id == campaign_id))

    # 6. Finally the campaign row itself.
    await db.execute(delete(Campaign).where(Campaign.id == campaign_id))
    await db.commit()

    # Clean up the Redis pause flag (if any) — orphaned flag would otherwise
    # outlive the campaign for 24h before its TTL expires.
    await _clear_pause_flag(campaign_id)

    logger.info("campaign_deleted", campaign_id=str(campaign_id))
    return None


# ── Sub-resources ─────────────────────────────────────────────────────────────

@router.get("/{campaign_id}/events")
async def get_campaign_events(
    campaign_id: UUID,
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """Return domain event history for a campaign."""
    await _get_campaign_or_404(campaign_id, db)
    q = (
        select(DomainEvent)
        .where(DomainEvent.campaign_id == campaign_id)
        .order_by(DomainEvent.occurred_at.desc())
        .limit(limit)
    )
    events = (await db.execute(q)).scalars().all()
    return {"total": len(events), "events": events}


@router.get("/{campaign_id}/memory")
async def get_campaign_memory(
    campaign_id: UUID,
    limit: int = Query(20, ge=1, le=100),
    memory_type: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Return long-term agent memory entries for a campaign (newest first)."""
    from app.models.optimization import AgentMemory

    await _get_campaign_or_404(campaign_id, db)

    q = select(AgentMemory).where(AgentMemory.campaign_id == campaign_id)
    if memory_type:
        q = q.where(AgentMemory.memory_type == memory_type)
    q = q.order_by(AgentMemory.created_at.desc()).limit(limit)

    rows = (await db.execute(q)).scalars().all()
    items = [
        {
            "id": str(r.id),
            "memory_type": r.memory_type,
            "content": r.content,
            "metadata": r.metadata_,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]
    return {"total": len(items), "items": items}


@router.get("/{campaign_id}/usage")
async def get_campaign_usage(campaign_id: UUID, db: AsyncSession = Depends(get_db)):
    """
    Return LLM token usage + estimated USD cost for a campaign.

    Aggregates one row per (provider, model) plus an overall total. Cost is
    estimated from `app.core.llm.PRICING_PER_1M`; the underlying `llm_usage`
    table stores raw token counts so the rate table can be revised without
    rewriting historical data.
    """
    from app.models.usage import LLMUsage
    from app.core.llm import estimate_cost_usd

    await _get_campaign_or_404(campaign_id, db)

    rows = (await db.execute(
        select(LLMUsage).where(LLMUsage.campaign_id == campaign_id)
    )).scalars().all()

    by_model: dict[tuple[str, str], dict] = {}
    total_in = total_out = total_calls = 0
    total_latency_ms = 0
    total_cost = 0.0
    for r in rows:
        key = (r.provider, r.model)
        bucket = by_model.setdefault(key, {
            "provider": r.provider,
            "model": r.model,
            "calls": 0,
            "input_tokens": 0,
            "output_tokens": 0,
            "estimated_cost_usd": 0.0,
        })
        bucket["calls"] += 1
        bucket["input_tokens"]  += r.input_tokens or 0
        bucket["output_tokens"] += r.output_tokens or 0
        cost = estimate_cost_usd(r.provider, r.model, r.input_tokens or 0, r.output_tokens or 0)
        bucket["estimated_cost_usd"] += cost
        total_in  += r.input_tokens or 0
        total_out += r.output_tokens or 0
        total_calls += 1
        total_cost += cost
        total_latency_ms += (r.latency_ms or 0)

    # Per-agent-type breakdown (shows usage per pipeline step)
    by_agent: dict[str, dict] = {}
    for r in rows:
        atype = r.agent_type or "UNKNOWN"
        bucket = by_agent.setdefault(atype, {
            "agent_type": atype,
            "calls": 0,
            "input_tokens": 0,
            "output_tokens": 0,
            "models": set(),
            "estimated_cost_usd": 0.0,
        })
        bucket["calls"] += 1
        bucket["input_tokens"]  += r.input_tokens or 0
        bucket["output_tokens"] += r.output_tokens or 0
        bucket["models"].add(r.model or "")
        bucket["estimated_cost_usd"] += estimate_cost_usd(
            r.provider, r.model, r.input_tokens or 0, r.output_tokens or 0
        )

    return {
        "campaign_id": str(campaign_id),
        "calls": total_calls,
        "input_tokens": total_in,
        "output_tokens": total_out,
        "total_tokens": total_in + total_out,
        "estimated_cost_usd": round(total_cost, 6),
        "avg_latency_ms": round(total_latency_ms / total_calls, 1) if total_calls else 0,
        "breakdown": [
            {**v, "estimated_cost_usd": round(v["estimated_cost_usd"], 6)}
            for v in sorted(by_model.values(), key=lambda x: -x["estimated_cost_usd"])
        ],
        "by_agent": [
            {**v, "models": sorted(v["models"] - {""}), "estimated_cost_usd": round(v["estimated_cost_usd"], 6)}
            for v in sorted(by_agent.values(), key=lambda x: -x["calls"])
        ],
    }

