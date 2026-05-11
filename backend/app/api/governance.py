"""Governance & HITL REST endpoints — /v1/governance.

Phase 0 — single tenant, no RBAC. Adds:
  GET    /rules                          list all governance rules
  GET    /inbox?role=FINANCE[&status=]   list approval tasks
  GET    /cases/{case_id}                show a case with its tasks
  POST   /tasks/{task_id}/decide         Approve / Reject  (resumes campaign when case closes)
"""
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.event_bus import event_bus
from app.core.permissions import AuthIdentity, current_user, check_gov_role_or_403
from app.core.tenant import apply_tenant_scope, resolve_tenant_filter
from app.database import get_db
from app.models.campaign import Campaign
from app.models.governance import GovernanceRule, RevisionCase, RevisionTask

logger = structlog.get_logger(__name__)
router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class RuleOut(BaseModel):
    id: UUID
    code: str
    name: str
    description: Optional[str]
    when: dict
    require_role: str
    stage_before: str
    sla_hours: int
    enabled: bool
    default_decision: Optional[str] = None

    class Config:
        from_attributes = True


class TaskOut(BaseModel):
    id: UUID
    case_id: UUID
    rule_code: str
    rule_name: str
    role: str
    status: str
    due_at: Optional[datetime]
    decided_at: Optional[datetime]
    feedback: Optional[str]
    escalation_level: int = 0
    escalated_at: Optional[datetime] = None
    campaign_id: Optional[UUID] = None
    stage: Optional[str] = None
    trigger_context: Optional[dict] = None

    class Config:
        from_attributes = True


class CaseOut(BaseModel):
    id: UUID
    campaign_id: UUID
    stage: str
    status: str
    opened_at: datetime
    resolved_at: Optional[datetime]
    trigger_context: dict
    tasks: list[TaskOut]

    class Config:
        from_attributes = True


class DecisionIn(BaseModel):
    decision: str = Field(pattern="^(APPROVE|REJECT)$")
    feedback: Optional[str] = None
    decided_by: Optional[UUID] = None  # placeholder until RBAC lands


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/rules", response_model=list[RuleOut])
async def list_rules(
    db: AsyncSession = Depends(get_db),
    tenant: Optional[UUID] = Depends(resolve_tenant_filter),
):
    stmt = apply_tenant_scope(
        select(GovernanceRule).order_by(GovernanceRule.code),
        GovernanceRule.tenant_id, tenant,
    )
    rows = (await db.execute(stmt)).scalars().all()
    return rows


@router.get("/inbox", response_model=list[TaskOut])
async def list_inbox(
    role: Optional[str] = Query(None, description="Filter by role (FINANCE, LEGAL, …). Omit to use the caller's roles."),
    status: Optional[str] = Query("OPEN", description="OPEN | APPROVED | REJECTED | ALL"),
    db: AsyncSession = Depends(get_db),
    user: AuthIdentity = Depends(current_user),
):
    """List approval tasks.

    Default view: every OPEN task in roles the caller can act on.
    ADMINs see everything; specifying `role=` overrides for ADMIN only.
    """
    q = (
        select(RevisionTask)
        .options(selectinload(RevisionTask.case))
        .order_by(RevisionTask.created_at.desc())
    )

    held = {r.upper() for r in user.gov_roles}
    is_admin = "ADMIN" in held

    if role:
        wanted = role.upper()
        if not is_admin and wanted not in held:
            raise HTTPException(403, detail=f"requires role {wanted}")
        q = q.where(RevisionTask.role == wanted)
    elif not is_admin:
        # Restrict to roles the user actually holds. Empty = empty inbox.
        if not held:
            return []
        q = q.where(RevisionTask.role.in_(held))

    if status and status.upper() != "ALL":
        q = q.where(RevisionTask.status == status.upper())

    # Tenant scope: non-ADMIN sees only their tenant's tasks.
    if not is_admin and user.tenant_id:
        import uuid as _uuid
        q = q.where(RevisionTask.tenant_id == _uuid.UUID(user.tenant_id))

    rows = (await db.execute(q)).scalars().all()
    out: list[TaskOut] = []
    for t in rows:
        out.append(TaskOut(
            id=t.id,
            case_id=t.case_id,
            rule_code=t.rule_code,
            rule_name=t.rule_name,
            role=t.role,
            status=t.status,
            due_at=t.due_at,
            decided_at=t.decided_at,
            feedback=t.feedback,
            escalation_level=t.escalation_level or 0,
            escalated_at=t.escalated_at,
            campaign_id=t.case.campaign_id if t.case else None,
            stage=t.case.stage if t.case else None,
            trigger_context=t.case.trigger_context if t.case else None,
        ))
    return out


@router.get("/cases/{case_id}", response_model=CaseOut)
async def get_case(
    case_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthIdentity = Depends(current_user),
):
    q = (
        select(RevisionCase)
        .options(selectinload(RevisionCase.tasks))
        .where(RevisionCase.id == case_id)
    )
    case = (await db.execute(q)).scalar_one_or_none()
    if not case:
        raise HTTPException(404, detail=f"Case {case_id} not found")

    # Cross-tenant access blocked. 404 (not 403) on purpose — avoid leaking
    # the existence of resources outside the caller's tenant.
    held = {r.upper() for r in user.gov_roles}
    if "ADMIN" not in held and user.tenant_id and str(case.tenant_id) != user.tenant_id:
        raise HTTPException(404, detail=f"Case {case_id} not found")

    return CaseOut(
        id=case.id,
        campaign_id=case.campaign_id,
        stage=case.stage,
        status=case.status,
        opened_at=case.opened_at,
        resolved_at=case.resolved_at,
        trigger_context=case.trigger_context or {},
        tasks=[
            TaskOut(
                id=t.id, case_id=t.case_id, rule_code=t.rule_code, rule_name=t.rule_name,
                role=t.role, status=t.status, due_at=t.due_at,
                decided_at=t.decided_at, feedback=t.feedback,
                escalation_level=t.escalation_level or 0, escalated_at=t.escalated_at,
                campaign_id=case.campaign_id, stage=case.stage,
                trigger_context=case.trigger_context,
            ) for t in case.tasks
        ],
    )


@router.post("/tasks/{task_id}/decide", response_model=TaskOut)
async def decide_task(
    task_id: UUID,
    body: DecisionIn,
    db: AsyncSession = Depends(get_db),
    user: AuthIdentity = Depends(current_user),
):
    """Record an approval/rejection. If this closes the case, resume the campaign.

    Requires the caller to hold the governance role attached to the task
    (or ADMIN). `decided_by` is always taken from the authenticated user;
    any `decided_by` field in the body is ignored — clients can't impersonate.
    """
    task = (await db.execute(select(RevisionTask).where(RevisionTask.id == task_id))).scalar_one_or_none()
    if not task:
        raise HTTPException(404, detail=f"Task {task_id} not found")
    if task.status != "OPEN":
        raise HTTPException(409, detail=f"Task already decided ({task.status})")

    # Tenant guard before role guard — same reasoning as get_case: hide
    # cross-tenant existence behind a 404.
    held_roles = {r.upper() for r in user.gov_roles}
    if "ADMIN" not in held_roles and user.tenant_id and str(task.tenant_id) != user.tenant_id:
        raise HTTPException(404, detail=f"Task {task_id} not found")

    check_gov_role_or_403(user, task.role)

    now = datetime.now(timezone.utc)
    task.status = "APPROVED" if body.decision == "APPROVE" else "REJECTED"
    task.decided_at = now
    task.decided_by = UUID(user.user_id) if user.user_id else None
    task.feedback = body.feedback
    db.add(task)
    await db.flush()

    # Reload case + sibling tasks to check whether the case is now fully decided.
    case = (await db.execute(
        select(RevisionCase)
        .options(selectinload(RevisionCase.tasks))
        .where(RevisionCase.id == task.case_id)
    )).scalar_one()

    all_decided = all(t.status != "OPEN" for t in case.tasks)
    if all_decided:
        case.status = "RESOLVED"
        case.resolved_at = now
        db.add(case)

    await db.commit()

    # If the case just closed, resume the campaign worker. The LangGraph
    # checkpointer (keyed by thread_id=campaign_id) will pick up at the gate
    # node and re-evaluate — finding the case RESOLVED, it'll route to
    # `proceed` (all approved) or `revise` (any rejected).
    if all_decided:
        campaign = await db.get(Campaign, case.campaign_id)
        if campaign and campaign.status == "PAUSED_FOR_APPROVAL":
            old_status = campaign.status
            campaign.status = "PLANNING"  # transient; gate will advance it
            db.add(campaign)
            await db.commit()

            from app.tasks.agent_tasks import enqueue_campaign
            await enqueue_campaign(str(case.campaign_id))

            await event_bus.publish(
                "StatusChanged",
                {"old_status": old_status, "new_status": "PLANNING", "reason": "approval_granted"},
                str(case.campaign_id),
            )
            decisions = [
                {"task_id": str(t.id), "role": t.role, "rule_code": t.rule_code,
                 "status": t.status, "feedback": t.feedback}
                for t in case.tasks
            ]
            await event_bus.publish(
                "ApprovalResolved",
                {"case_id": str(case.id), "stage": case.stage, "decisions": decisions},
                str(case.campaign_id),
            )

            # Fan out resolution pings to the *same roles* the case asked of.
            outcome = "REJECTED" if any(t.status == "REJECTED" for t in case.tasks) else "APPROVED"
            try:
                from app.notify import dispatcher
                for role in {t.role for t in case.tasks}:
                    await dispatcher.send_to_role(
                        tenant_id=case.tenant_id,
                        role=role,
                        template="approval_resolved",
                        context={
                            "campaign_id": str(case.campaign_id),
                            "stage":       case.stage,
                            "outcome":     outcome,
                            "decisions":   decisions,
                        },
                        event_type="ApprovalResolved",
                    )
            except Exception as e:
                logger.warning("notify_resolved_failed", error=str(e))

    return TaskOut(
        id=task.id,
        case_id=task.case_id,
        rule_code=task.rule_code,
        rule_name=task.rule_name,
        role=task.role,
        status=task.status,
        due_at=task.due_at,
        decided_at=task.decided_at,
        feedback=task.feedback,
        escalation_level=task.escalation_level or 0,
        escalated_at=task.escalated_at,
        campaign_id=case.campaign_id,
        stage=case.stage,
        trigger_context=case.trigger_context,
    )
