"""Tenant scoping — Phase 1B.

The tenant_id of the current request lives in a ContextVar set by the
`AuditContextMiddleware` (which decodes the JWT). Query helpers below
read from that ContextVar to scope every list/get to the caller's tenant.

ADMIN can override via an explicit `?tenant_id=` query param (handled by
`resolve_tenant_filter`). Everyone else is hard-locked to their own tenant.
"""
import contextvars
import uuid
from typing import Optional

from fastapi import Depends, HTTPException, Query, status

from app.core.permissions import AuthIdentity, current_user


# Set by AuditContextMiddleware. None inside background workers (no JWT) —
# code that runs there must use explicit tenant_ids from the row being acted on.
current_tenant_id: contextvars.ContextVar[Optional[uuid.UUID]] = contextvars.ContextVar(
    "current_tenant_id", default=None
)


def set_tenant_from_jwt(payload: dict) -> Optional[contextvars.Token]:
    tid = payload.get("tenant_id")
    if not tid:
        return None
    try:
        return current_tenant_id.set(uuid.UUID(tid))
    except (ValueError, TypeError):
        return None


def resolve_tenant_filter(
    user: AuthIdentity = Depends(current_user),
    tenant_id: Optional[uuid.UUID] = Query(
        None,
        description="ADMIN-only: override tenant scope. Ignored for non-admins.",
    ),
) -> Optional[uuid.UUID]:
    """Dependency that returns the tenant_id to filter queries by.

    Non-ADMIN: always the caller's own tenant. Passing `?tenant_id=` is
    silently ignored — we don't 400 because the front-end may send the
    param for ADMINs without knowing if the current user is one.

    ADMIN with explicit `?tenant_id=` → that tenant.
    ADMIN without override → None (no filter; sees everything).
    """
    held = {r.upper() for r in user.gov_roles}
    is_admin = "ADMIN" in held

    if is_admin:
        return tenant_id  # may be None → no filter

    if not user.tenant_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="user has no tenant")
    return uuid.UUID(user.tenant_id)


def apply_tenant_scope(stmt, tenant_column, tenant_id: Optional[uuid.UUID]):
    """Add a `WHERE tenant = :id` clause when tenant_id is set.

    Pass `None` to skip filtering (ADMIN-wide view). The column itself must
    be passed in because not all tables call it `tenant_id` (campaigns
    historically use `org_id` — same concept, different column name).
    """
    if tenant_id is None:
        return stmt
    return stmt.where(tenant_column == tenant_id)
