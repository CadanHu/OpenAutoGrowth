"""SQLAlchemy models: optimization_records, rules, agent_memory"""
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Enum, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

try:
    from pgvector.sqlalchemy import Vector
    _PGVECTOR_AVAILABLE = True
except ImportError:
    Vector = None
    _PGVECTOR_AVAILABLE = False


class OptimizationRecord(Base):
    __tablename__ = "optimization_records"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("campaigns.id"), nullable=False)
    loop_count: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(
        Enum(
            "TRIGGERED", "ANALYZING", "DECISION_MADE", "NO_ACTION",
            "EXECUTING", "WAIT_EFFECT", "EFFECT_VALIDATED", "EFFECT_FAILED",
            "ROLLBACK", "COMMITTED",
            name="opt_loop_status",
        ),
        default="TRIGGERED",
    )
    triggered_rules: Mapped[Optional[list]] = mapped_column(JSONB)   # rule IDs that fired
    actions: Mapped[Optional[list]] = mapped_column(JSONB)           # OptAction[]
    kpi_before: Mapped[Optional[dict]] = mapped_column(JSONB)
    kpi_after: Mapped[Optional[dict]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    committed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class Rule(Base):
    __tablename__ = "rules"

    id: Mapped[str] = mapped_column(String(20), primary_key=True)    # R001, R002, ...
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    priority: Mapped[int] = mapped_column(Integer, default=100)
    condition: Mapped[dict] = mapped_column(JSONB, nullable=False)   # DSL condition tree
    action: Mapped[dict] = mapped_column(JSONB, nullable=False)      # OptAction
    cooldown_ms: Mapped[int] = mapped_column(Integer, default=3600000)  # 1 hour
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AgentMemory(Base):
    """Long-term semantic memory — embeddings stored in pgvector index."""
    __tablename__ = "agent_memory"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("campaigns.id"))
    memory_type: Mapped[str] = mapped_column(String(50), default="OPTIMIZATION_LEARNING")
    content: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_: Mapped[Optional[dict]] = mapped_column(JSONB, name="metadata")
    # embedding column added conditionally to avoid import error when pgvector is absent
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# Add embedding column only when pgvector is available
if _PGVECTOR_AVAILABLE and Vector is not None:
    from sqlalchemy import Column
    AgentMemory.__table__.append_column(  # type: ignore[attr-defined]
        Column("embedding", Vector(1536))
    )
