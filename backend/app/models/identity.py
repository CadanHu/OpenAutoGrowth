"""Identity & access control models — Phase 1A.

  - UserGovernanceRole : which governance roles a user can claim
                         (one user can hold multiple, e.g. FINANCE + LEGAL)
  - AuditLog           : append-only record of every meaningful state change

The existing `users.role` column is a coarse SaaS role (ADMIN/MARKETER/VIEWER)
governing UI affordances. The governance roles here are *approval roles* —
they decide who can sign off a `RevisionTask`. Kept separate on purpose so
adding new gate roles never requires touching the user-management enum.
"""
import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import DateTime, Enum, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import INET, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


GOVERNANCE_ROLE_ENUM = Enum(
    "FINANCE", "LEGAL", "BRAND_LEAD", "MARKETING_DIRECTOR", "AI", "ADMIN",
    name="governance_role",  # matches the enum already declared in models/governance.py
    create_type=False,        # don't try to re-create the type; it already exists
)


class UserGovernanceRole(Base):
    """User ↔ Governance-role mapping. One row per (user, role, tenant)."""
    __tablename__ = "user_governance_roles"
    __table_args__ = (
        UniqueConstraint("user_id", "role", "tenant_id", name="uq_user_gov_role"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(GOVERNANCE_ROLE_ENUM, nullable=False)
    tenant_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)

    granted_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AuditLog(Base):
    """Append-only audit trail. Writes go through the `core.audit` listener,
    never directly from request handlers — that way nothing can be silently
    skipped by forgetting to log.

    `before` and `after` are snapshot dicts (PII-stripped at the listener) so
    a row diff is reconstructable without crossing into a separate object
    store. Keep them small — large fields (file blobs, full LLM outputs)
    should NOT be serialized in.
    """
    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)

    actor_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    actor_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Free-form verb, e.g. "task.approve", "rule.update", "campaign.start".
    action: Mapped[str] = mapped_column(String(80), nullable=False, index=True)

    entity_type: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    entity_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)

    before: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    after: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, nullable=True)

    ip: Mapped[Optional[str]] = mapped_column(INET, nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(String(400), nullable=True)

    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
