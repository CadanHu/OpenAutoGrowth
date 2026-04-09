"""SQLAlchemy models: campaigns, plans, tasks"""
import uuid
from datetime import datetime, date
from typing import Optional

from sqlalchemy import (
    BigInteger, Date, DateTime, Enum, Float, ForeignKey,
    Integer, String, Text, func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Campaign(Base):
    __tablename__ = "campaigns"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("organizations.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    goal: Mapped[str] = mapped_column(Text, nullable=False)

    # Budget
    budget_total: Mapped[int] = mapped_column(BigInteger, nullable=False)  # cents
    budget_daily_cap: Mapped[Optional[int]] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(
        Enum("CNY", "USD", "EUR", "GBP", name="currency_code"), default="CNY"
    )

    # Timeline
    start_date: Mapped[Optional[date]] = mapped_column(Date)
    end_date: Mapped[Optional[date]] = mapped_column(Date)

    # KPI
    kpi_metric: Mapped[str] = mapped_column(
        Enum("GMV", "CTR", "CVR", "ROAS", "ROI", "CAC", "REACH", name="kpi_metric"),
        nullable=False,
    )
    kpi_target: Mapped[float] = mapped_column(Float, nullable=False)

    # Constraints
    target_channels: Mapped[Optional[list]] = mapped_column(JSONB)   # ["tiktok", "meta"]
    target_region: Mapped[Optional[str]] = mapped_column(String(50))

    # State machine
    status: Mapped[str] = mapped_column(
        Enum(
            "DRAFT", "PLANNING", "PLANNING_FAILED", "PENDING_REVIEW",
            "PRODUCTION", "PRODUCTION_FAILED", "DEPLOYED", "MONITORING",
            "OPTIMIZING", "LOOP_1", "LOOP_2", "LOOP_3", "LOOP_4", "LOOP_5",
            "PAUSED", "COMPLETED",
            name="campaign_status",
        ),
        nullable=False,
        default="DRAFT",
    )
    loop_count: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    organization: Mapped["Organization"] = relationship("Organization", back_populates="campaigns")
    plans: Mapped[list["Plan"]] = relationship("Plan", back_populates="campaign")
    events: Mapped[list["DomainEvent"]] = relationship("DomainEvent", back_populates="campaign")


class Plan(Base):
    __tablename__ = "plans"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("campaigns.id"), nullable=False)
    scenario: Mapped[str] = mapped_column(String(50), nullable=False)  # NEW_PRODUCT / RETENTION / ...
    dag: Mapped[dict] = mapped_column(JSONB, nullable=False)            # full DAG structure
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    campaign: Mapped[Campaign] = relationship("Campaign", back_populates="plans")
    tasks: Mapped[list["Task"]] = relationship("Task", back_populates="plan")


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plan_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("plans.id"), nullable=False)
    campaign_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("campaigns.id"), nullable=False)
    task_key: Mapped[str] = mapped_column(String(20), nullable=False)  # t1, t2, ...
    agent_type: Mapped[str] = mapped_column(
        Enum(
            "PLANNER", "CONTENT_GEN", "MULTIMODAL", "STRATEGY",
            "CHANNEL_EXEC", "ANALYSIS", "OPTIMIZER",
            name="agent_type",
        ),
        nullable=False,
    )
    dependencies: Mapped[list] = mapped_column(JSONB, default=list)    # ["t1", "t2"]
    params: Mapped[dict] = mapped_column(JSONB, default=dict)
    result: Mapped[Optional[dict]] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(
        Enum("PENDING", "WAITING", "RUNNING", "DONE", "FAILED", "BLOCKED", "SKIPPED",
             name="task_status"),
        nullable=False,
        default="PENDING",
    )
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    error_message: Mapped[Optional[str]] = mapped_column(Text)

    plan: Mapped[Plan] = relationship("Plan", back_populates="tasks")


class DomainEvent(Base):
    __tablename__ = "domain_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("campaigns.id"))
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    version: Mapped[str] = mapped_column(String(10), default="1.0")
    trace_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), default=uuid.uuid4)
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    campaign: Mapped[Optional[Campaign]] = relationship("Campaign", back_populates="events")
