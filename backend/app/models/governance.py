"""Governance models: human-in-the-loop approval rules and revision cases.

A `GovernanceRule` defines a hard-coded condition that, when satisfied at a
specific pipeline stage, requires human approval from a designated role
before the campaign can proceed.

A `RevisionCase` is opened against a campaign when one or more rules fire.
It bundles N `RevisionTask`s (one per fired rule), each addressed to a role.
The case stays open until every task is decided.
"""
import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import (
    Boolean, DateTime, Enum, ForeignKey, Integer, String, Text, func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


ROLE_ENUM = Enum(
    "FINANCE", "LEGAL", "BRAND_LEAD", "MARKETING_DIRECTOR", "AI", "ADMIN",
    name="governance_role",
)

CASE_STATUS_ENUM = Enum(
    "OPEN", "RESOLVED", "CANCELLED",
    name="revision_case_status",
)

TASK_STATUS_ENUM = Enum(
    "OPEN", "APPROVED", "REJECTED", "ESCALATED", "AUTO_DEFAULTED",
    name="revision_task_status",
)


class GovernanceRule(Base):
    """A hard rule routing campaigns through a human approval gate.

    Conditions are stored as a JSONB whitelist of predicates (e.g.
    `{"budget_total_gte": 50000}`) — *not* free-form expressions, so the
    evaluator can never `eval()` untrusted input.
    """
    __tablename__ = "governance_rules"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)

    # Human-readable identity. `code` is the stable machine name used in
    # logs and audit trails; renaming `name` is safe, renaming `code` is not.
    code: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)

    # Predicates, e.g. {"budget_total_gte": 50000, "industry_in": ["pharma"]}.
    # All listed predicates must match (AND). See `core/rule_engine.py` for
    # the supported whitelist.
    when: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

    # Which role's approval clears this rule.
    require_role: Mapped[str] = mapped_column(ROLE_ENUM, nullable=False)

    # The stage *before* which the gate evaluates. e.g. "content_gen" means
    # the gate runs after strategy_node finishes, before content_gen_node.
    stage_before: Mapped[str] = mapped_column(String(40), nullable=False, index=True)

    sla_hours: Mapped[int] = mapped_column(Integer, default=24)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # What the SLA scanner does after the escalation chain is exhausted and
    # the task is still OPEN. Values: APPROVE / REJECT / NONE. NULL = NONE.
    # Safe default for high-blast-radius gates (FINANCE/LEGAL) is REJECT —
    # never auto-spend / auto-publish if humans don't engage. For DIRECTOR
    # loop escalation, APPROVE is reasonable (don't stall the pipeline
    # forever just because nobody clicked).
    default_decision: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class RevisionCase(Base):
    """A campaign-scoped grouping of approval tasks opened at a single gate."""
    __tablename__ = "revision_cases"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)

    campaign_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("campaigns.id"), nullable=False, index=True
    )
    # The pipeline stage the gate is in front of (matches GovernanceRule.stage_before).
    stage: Mapped[str] = mapped_column(String(40), nullable=False, index=True)

    status: Mapped[str] = mapped_column(CASE_STATUS_ENUM, nullable=False, default="OPEN", index=True)

    # Snapshot of the campaign state slice that triggered the rules — kept
    # so the approver can see the budget, strategy, etc. at decision time
    # without re-querying live state (which may have moved on).
    trigger_context: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)

    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    tasks: Mapped[list["RevisionTask"]] = relationship(
        "RevisionTask", back_populates="case", cascade="all, delete-orphan"
    )


class RevisionTask(Base):
    """One approval ask inside a case. Each fired rule produces exactly one task."""
    __tablename__ = "revision_tasks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)

    case_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("revision_cases.id"), nullable=False, index=True
    )
    rule_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("governance_rules.id"), nullable=True
    )
    # Denormalized snapshot — surviving rule renames/deletes.
    rule_code: Mapped[str] = mapped_column(String(80), nullable=False)
    rule_name: Mapped[str] = mapped_column(String(200), nullable=False)

    role: Mapped[str] = mapped_column(ROLE_ENUM, nullable=False, index=True)
    status: Mapped[str] = mapped_column(TASK_STATUS_ENUM, nullable=False, default="OPEN", index=True)

    assignee_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    due_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    # Escalation tracking (Phase 3). 0 = original role; 1 = first escalation;
    # bumps each time SLA expires without a decision.
    escalation_level: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    escalated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    decided_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    feedback: Mapped[Optional[str]] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    case: Mapped[RevisionCase] = relationship("RevisionCase", back_populates="tasks")
