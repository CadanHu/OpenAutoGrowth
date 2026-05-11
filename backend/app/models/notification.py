"""Notification delivery log — Phase 2.

One row per send attempt. Status starts SENT or FAILED; we do not retry
in Phase 2 (fire-and-forget). The history is here so the audit trail can
answer "did Alice actually get the FINANCE approval ping at 3pm?".
"""
import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


CHANNEL_ENUM = Enum(
    "EMAIL", "SLACK", "DINGTALK",
    name="notify_channel",
)

STATUS_ENUM = Enum(
    "SENT", "FAILED", "SKIPPED",
    name="notify_status",
)


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)

    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # The event the notification was sent for ("ApprovalRequired" etc).
    # Free-form on purpose — adding a new event type shouldn't require a
    # migration for an enum bump.
    event_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)

    # The Jinja template that produced the body — kept for debugging.
    template: Mapped[str] = mapped_column(String(120), nullable=False)

    channel: Mapped[str] = mapped_column(CHANNEL_ENUM, nullable=False, index=True)
    status: Mapped[str] = mapped_column(STATUS_ENUM, nullable=False, index=True)

    # Recipient address. For email = full address; for slack/dingtalk = a
    # redacted webhook host so leaks via audit log are limited.
    recipient: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Substituted variables, useful for re-issuing later. Body is NOT stored
    # to keep this table small (templates are version-controlled in code).
    context: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, nullable=True)

    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
