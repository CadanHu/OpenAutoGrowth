"""SQLAlchemy models: performance_reports, channel_stats, variant_stats, anomalies"""
import uuid
from datetime import datetime, date
from typing import Optional

from sqlalchemy import BigInteger, Date, DateTime, Enum, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class PerformanceReport(Base):
    __tablename__ = "performance_reports"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("campaigns.id"), nullable=False)
    report_date: Mapped[date] = mapped_column(Date, nullable=False)
    granularity: Mapped[str] = mapped_column(
        Enum("HOURLY", "DAILY", "WEEKLY", name="report_granularity"), default="DAILY"
    )

    # Core metrics
    impressions: Mapped[int] = mapped_column(BigInteger, default=0)
    clicks: Mapped[int] = mapped_column(BigInteger, default=0)
    conversions: Mapped[int] = mapped_column(BigInteger, default=0)
    spend: Mapped[int] = mapped_column(BigInteger, default=0)       # cents
    revenue: Mapped[int] = mapped_column(BigInteger, default=0)     # cents

    # Derived metrics (stored for query performance)
    ctr: Mapped[Optional[float]] = mapped_column(Float)             # clicks / impressions
    cvr: Mapped[Optional[float]] = mapped_column(Float)             # conversions / clicks
    cpc: Mapped[Optional[float]] = mapped_column(Float)             # spend / clicks (cents)
    cpa: Mapped[Optional[float]] = mapped_column(Float)             # spend / conversions (cents)
    roas: Mapped[Optional[float]] = mapped_column(Float)            # revenue / spend
    roi: Mapped[Optional[float]] = mapped_column(Float)             # (revenue - spend) / spend

    attribution_model: Mapped[str] = mapped_column(
        Enum("LAST_CLICK", "FIRST_CLICK", "LINEAR", "POSITION_BASED", "DATA_DRIVEN",
             name="attribution_model"),
        default="LAST_CLICK",
    )
    raw_data: Mapped[Optional[dict]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    channel_stats: Mapped[list["ChannelStat"]] = relationship("ChannelStat", back_populates="report")
    variant_stats: Mapped[list["VariantStat"]] = relationship("VariantStat", back_populates="report")


class ChannelStat(Base):
    __tablename__ = "channel_stats"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    report_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("performance_reports.id"), nullable=False)
    channel: Mapped[str] = mapped_column(
        Enum("META", "GOOGLE", "TIKTOK", "WECHAT", "WEIBO", name="channel_type"), nullable=False
    )
    impressions: Mapped[int] = mapped_column(BigInteger, default=0)
    clicks: Mapped[int] = mapped_column(BigInteger, default=0)
    spend: Mapped[int] = mapped_column(BigInteger, default=0)
    conversions: Mapped[int] = mapped_column(BigInteger, default=0)
    roas: Mapped[Optional[float]] = mapped_column(Float)

    report: Mapped[PerformanceReport] = relationship("PerformanceReport", back_populates="channel_stats")


class VariantStat(Base):
    __tablename__ = "variant_stats"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    report_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("performance_reports.id"), nullable=False)
    copy_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("copies.id"))
    variant_label: Mapped[str] = mapped_column(String(10))         # A, B, C
    impressions: Mapped[int] = mapped_column(BigInteger, default=0)
    clicks: Mapped[int] = mapped_column(BigInteger, default=0)
    conversions: Mapped[int] = mapped_column(BigInteger, default=0)
    ctr: Mapped[Optional[float]] = mapped_column(Float)
    cvr: Mapped[Optional[float]] = mapped_column(Float)
    is_winner: Mapped[Optional[bool]] = mapped_column()

    report: Mapped[PerformanceReport] = relationship("PerformanceReport", back_populates="variant_stats")


class Anomaly(Base):
    __tablename__ = "anomalies"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("campaigns.id"), nullable=False)
    metric: Mapped[str] = mapped_column(String(50), nullable=False)    # CTR, ROAS, ...
    channel: Mapped[Optional[str]] = mapped_column(String(50))
    severity: Mapped[str] = mapped_column(
        Enum("LOW", "MEDIUM", "HIGH", "CRITICAL", name="anomaly_severity"), default="MEDIUM"
    )
    expected_value: Mapped[Optional[float]] = mapped_column(Float)
    actual_value: Mapped[Optional[float]] = mapped_column(Float)
    deviation_pct: Mapped[Optional[float]] = mapped_column(Float)
    description: Mapped[Optional[str]] = mapped_column(Text)
    resolved: Mapped[bool] = mapped_column(default=False)
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
