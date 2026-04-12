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
    "PLANNING":        ["PENDING_REVIEW", "PLANNING_FAILED"],
    "PENDING_REVIEW":  ["PRODUCTION"],
    "PRODUCTION":      ["DEPLOYED", "PRODUCTION_FAILED"],
    "DEPLOYED":        ["MONITORING", "PAUSED"],
    "MONITORING":      ["OPTIMIZING", "PAUSED", "COMPLETED"],
    "OPTIMIZING":      ["MONITORING", "PAUSED", "COMPLETED"],
    "PAUSED":          ["MONITORING", "COMPLETED"],
}


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
):
    """List campaigns with optional status filter and pagination."""
    query = select(Campaign)
    if status:
        query = query.where(Campaign.status == status)

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
    campaign = await _get_campaign_or_404(campaign_id, db)
    return await _transition(campaign, "PAUSED", db)


@router.post("/{campaign_id}/resume", response_model=CampaignResponse)
async def resume_campaign(campaign_id: UUID, db: AsyncSession = Depends(get_db)):
    campaign = await _get_campaign_or_404(campaign_id, db)
    return await _transition(campaign, "MONITORING", db)


@router.post("/{campaign_id}/complete", response_model=CampaignResponse)
async def complete_campaign(campaign_id: UUID, db: AsyncSession = Depends(get_db)):
    campaign = await _get_campaign_or_404(campaign_id, db)
    return await _transition(campaign, "COMPLETED", db)


@router.delete("/{campaign_id}", status_code=204)
async def delete_campaign(campaign_id: UUID, db: AsyncSession = Depends(get_db)):
    """Delete a campaign and all its sub-resources."""
    # Ensure ContentBundle is imported so SQLAlchemy handles cascade if configured
    from app.models.content import ContentBundle
    campaign = await db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail=f"Campaign {campaign_id} not found")
    
    # We load them to ensure ORM-side cascade works (sqlalchemy will handle orphans if loaded)
    # Alternatively, ensure DB has ON DELETE CASCADE.
    # In async pg/sqlite, loading them is safer for ORM cascade.
    await db.delete(campaign)
    await db.commit()
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
