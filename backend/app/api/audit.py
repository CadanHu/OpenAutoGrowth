"""Audit log query API — /v1/audit (Phase 1B).

Read-only. Writes go through the SQLAlchemy `before_flush` listener — there
is intentionally no POST endpoint.

Query params (all optional):
  actor      — substring match on actor_email
  action     — exact match (e.g. "task.update")
  entity     — exact match on entity_type (e.g. "revision_tasks")
  entity_id  — exact match on entity_id
  from / to  — ISO timestamps; inclusive lower / exclusive upper bound
  limit      — page size (default 50, max 500)
  offset     — pagination offset
"""
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import AuthIdentity, current_user
from app.core.tenant import apply_tenant_scope, resolve_tenant_filter
from app.database import get_db
from app.models.identity import AuditLog

router = APIRouter()


class AuditOut(BaseModel):
    id: uuid.UUID
    ts: datetime
    actor_id: Optional[uuid.UUID]
    actor_email: Optional[str]
    action: str
    entity_type: str
    entity_id: Optional[uuid.UUID]
    before: Optional[dict]
    after: Optional[dict]
    ip: Optional[str]
    user_agent: Optional[str]
    tenant_id: Optional[uuid.UUID]

    class Config:
        from_attributes = True


class AuditList(BaseModel):
    total: int
    items: list[AuditOut]


@router.get("", response_model=AuditList)
async def list_audit(
    actor: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    entity: Optional[str] = Query(None),
    entity_id: Optional[uuid.UUID] = Query(None),
    from_: Optional[datetime] = Query(None, alias="from"),
    to: Optional[datetime] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    user: AuthIdentity = Depends(current_user),
    tenant: Optional[uuid.UUID] = Depends(resolve_tenant_filter),
):
    q = select(AuditLog)
    q = apply_tenant_scope(q, AuditLog.tenant_id, tenant)

    if actor:
        q = q.where(AuditLog.actor_email.ilike(f"%{actor}%"))
    if action:
        q = q.where(AuditLog.action == action)
    if entity:
        q = q.where(AuditLog.entity_type == entity)
    if entity_id:
        q = q.where(AuditLog.entity_id == entity_id)
    if from_:
        q = q.where(AuditLog.ts >= from_)
    if to:
        q = q.where(AuditLog.ts < to)

    total = (await db.execute(
        select(func.count()).select_from(q.subquery())
    )).scalar_one()

    rows = (await db.execute(
        q.order_by(AuditLog.ts.desc()).offset(offset).limit(limit)
    )).scalars().all()

    # `ip` comes back as ipaddress.IPv4Address from the INET column; coerce
    # to str so the response schema (which uses plain str) doesn't choke.
    items = [
        AuditOut(
            id=r.id, ts=r.ts, actor_id=r.actor_id, actor_email=r.actor_email,
            action=r.action, entity_type=r.entity_type, entity_id=r.entity_id,
            before=r.before, after=r.after,
            ip=str(r.ip) if r.ip is not None else None,
            user_agent=r.user_agent, tenant_id=r.tenant_id,
        )
        for r in rows
    ]
    return AuditList(total=total, items=items)
