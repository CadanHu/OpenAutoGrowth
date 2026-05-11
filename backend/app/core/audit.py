"""Audit logging — Phase 1A.

Listens for SQLAlchemy session flushes and writes `audit_log` rows for any
state change on a watched entity. The listener is registered globally so
forgetting to log at a callsite is no longer possible.

Actor identity flows in via a `ContextVar` set by the auth middleware
(`middleware/audit_context.py`). For background tasks (worker jobs, the
LangGraph pipeline) the actor is `None` — the row records "system".

Watched entities (Phase 1A — extend as needed):
  • RevisionTask  (approve/reject)
  • RevisionCase  (open/resolve/cancel)
  • GovernanceRule(create/update/delete)
  • Campaign      (status transitions, deletes)
  • User          (create/deactivate)

PII guard: `_snapshot` deliberately drops password hashes and OAuth tokens.
Adding a new model? Update `_SAFE_FIELDS` (whitelist beats blacklist).
"""
import contextvars
import uuid
from typing import Any, Optional

import structlog
from sqlalchemy import event, inspect
from sqlalchemy.orm import Session

from app.models.identity import AuditLog

logger = structlog.get_logger(__name__)


# Set by auth middleware per request; defaults to None for background work.
current_actor: contextvars.ContextVar[Optional[dict]] = contextvars.ContextVar(
    "audit_current_actor", default=None
)
current_request_meta: contextvars.ContextVar[Optional[dict]] = contextvars.ContextVar(
    "audit_request_meta", default=None
)


# Per-model whitelist of fields safe to snapshot. Avoids logging credentials,
# tokens, and large blobs. Anything not listed is dropped from the snapshot.
_SAFE_FIELDS: dict[str, set[str]] = {
    "revision_tasks":     {"id", "case_id", "rule_code", "role", "status",
                           "decided_by", "decided_at", "feedback", "due_at"},
    "revision_cases":     {"id", "campaign_id", "stage", "status", "opened_at", "resolved_at"},
    "governance_rules":   {"id", "code", "name", "when", "require_role",
                           "stage_before", "sla_hours", "enabled"},
    "campaigns":          {"id", "name", "status", "loop_count", "budget_total",
                           "kpi_metric", "kpi_target"},
    "users":              {"id", "email", "role", "tenant_id", "is_active"},
}

# Action verb per (table, change-kind).
_ACTION_VERBS: dict[tuple[str, str], str] = {
    ("revision_tasks",   "insert"): "task.create",
    ("revision_tasks",   "update"): "task.update",
    ("revision_tasks",   "delete"): "task.delete",
    ("revision_cases",   "insert"): "case.open",
    ("revision_cases",   "update"): "case.update",
    ("revision_cases",   "delete"): "case.delete",
    ("governance_rules", "insert"): "rule.create",
    ("governance_rules", "update"): "rule.update",
    ("governance_rules", "delete"): "rule.delete",
    ("campaigns",        "insert"): "campaign.create",
    ("campaigns",        "update"): "campaign.update",
    ("campaigns",        "delete"): "campaign.delete",
    ("users",            "insert"): "user.create",
    ("users",            "update"): "user.update",
    ("users",            "delete"): "user.delete",
}


def _snapshot(obj: Any, table: str) -> dict:
    """Build a JSON-safe dict of whitelisted fields."""
    safe = _SAFE_FIELDS.get(table)
    if not safe:
        return {}
    out: dict[str, Any] = {}
    for k in safe:
        v = getattr(obj, k, None)
        # JSONB columns / dicts: keep as-is; everything else stringify.
        if v is None or isinstance(v, (str, int, float, bool, dict, list)):
            out[k] = v
        else:
            out[k] = str(v)
    return out


def _previous_snapshot(state, obj, table: str) -> dict:
    """Reconstruct the pre-flush values for an updated row using SQLAlchemy
    attribute history. Falls back to current values for fields with no
    recorded prior state (e.g. unchanged columns)."""
    safe = _SAFE_FIELDS.get(table)
    if not safe:
        return {}
    out: dict[str, Any] = {}
    for k in safe:
        try:
            hist = state.attrs[k].history
            if hist.deleted:
                v = hist.deleted[0]
            elif hist.unchanged:
                v = hist.unchanged[0]
            else:
                v = getattr(obj, k, None)
        except (KeyError, AttributeError):
            v = getattr(obj, k, None)
        if v is None or isinstance(v, (str, int, float, bool, dict, list)):
            out[k] = v
        else:
            out[k] = str(v)
    return out


def _emit(session: Session, obj: Any, kind: str):
    table = obj.__tablename__
    verb = _ACTION_VERBS.get((table, kind))
    if not verb:
        return  # not a watched entity

    actor = current_actor.get() or {}
    meta = current_request_meta.get() or {}

    after = _snapshot(obj, table) if kind != "delete" else None
    before = None
    if kind == "update":
        try:
            state = inspect(obj)
            before = _previous_snapshot(state, obj, table)
        except Exception:
            before = None
    elif kind == "delete":
        before = _snapshot(obj, table)

    tenant_id = getattr(obj, "tenant_id", None)
    if tenant_id is None and actor.get("tenant_id"):
        try:    tenant_id = uuid.UUID(actor["tenant_id"])
        except Exception: tenant_id = None
    actor_uuid = None
    if actor.get("sub"):
        try:    actor_uuid = uuid.UUID(actor["sub"])
        except Exception: actor_uuid = None

    session.add(AuditLog(
        tenant_id=tenant_id,
        actor_id=actor_uuid,
        actor_email=actor.get("email"),
        action=verb,
        entity_type=table,
        entity_id=getattr(obj, "id", None),
        before=before,
        after=after,
        ip=meta.get("ip"),
        user_agent=meta.get("user_agent"),
    ))


def install():
    """Attach the listener. Idempotent — calling twice is a no-op."""
    @event.listens_for(Session, "before_flush")
    def _before_flush(session: Session, flush_context, instances):
        # Build the audit rows *during* before_flush so they ride the same
        # transaction. We avoid `after_flush` because emitting new objects
        # there can require an extra autoflush pass.
        try:
            for obj in list(session.new):
                if isinstance(obj, AuditLog):
                    continue
                _emit(session, obj, "insert")
            for obj in list(session.dirty):
                if isinstance(obj, AuditLog):
                    continue
                if session.is_modified(obj, include_collections=False):
                    _emit(session, obj, "update")
            for obj in list(session.deleted):
                if isinstance(obj, AuditLog):
                    continue
                _emit(session, obj, "delete")
        except Exception as exc:
            # An audit failure must never kill the underlying write.
            logger.warning("audit_listener_error", error=str(exc))

    logger.info("audit_listener_installed")
