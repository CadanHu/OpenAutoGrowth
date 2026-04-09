"""SQLAlchemy models: style_guides, content_bundles, copies, content_assets"""
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class StyleGuide(Base):
    __tablename__ = "style_guides"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    brand_voice: Mapped[Optional[str]] = mapped_column(Text)
    tone_keywords: Mapped[Optional[list]] = mapped_column(JSONB)
    forbidden_words: Mapped[Optional[list]] = mapped_column(JSONB)
    color_palette: Mapped[Optional[dict]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ContentBundle(Base):
    __tablename__ = "content_bundles"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("campaigns.id"), nullable=False)
    task_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("tasks.id"))
    llm_model: Mapped[Optional[str]] = mapped_column(String(100))
    prompt_template: Mapped[Optional[str]] = mapped_column(Text)
    generation_params: Mapped[Optional[dict]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    copies: Mapped[list["Copy"]] = relationship("Copy", back_populates="bundle")
    assets: Mapped[list["ContentAsset"]] = relationship("ContentAsset", back_populates="bundle")


class Copy(Base):
    __tablename__ = "copies"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    bundle_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("content_bundles.id"), nullable=False)
    campaign_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("campaigns.id"), nullable=False)
    variant_label: Mapped[Optional[str]] = mapped_column(String(10))  # A, B, C
    hook: Mapped[Optional[str]] = mapped_column(String(500))          # opening hook
    body: Mapped[Optional[str]] = mapped_column(Text)
    cta: Mapped[Optional[str]] = mapped_column(String(200))
    channel: Mapped[Optional[str]] = mapped_column(String(50))        # tiktok / meta
    language: Mapped[str] = mapped_column(String(10), default="zh-CN")
    status: Mapped[str] = mapped_column(
        Enum(
            "GENERATING", "GENERATED", "REVIEWING", "APPROVED",
            "REJECTED", "LIVE", "PAUSED", "REPLACED", "ARCHIVED",
            name="content_status",
        ),
        default="GENERATED",
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    bundle: Mapped[ContentBundle] = relationship("ContentBundle", back_populates="copies")


class ContentAsset(Base):
    __tablename__ = "content_assets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    bundle_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("content_bundles.id"), nullable=False)
    campaign_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("campaigns.id"), nullable=False)
    asset_type: Mapped[str] = mapped_column(
        Enum("IMAGE", "VIDEO", name="asset_type"), nullable=False
    )
    visual_tool: Mapped[Optional[str]] = mapped_column(
        Enum("DALLE3", "MIDJOURNEY", "STABILITY_AI", "RUNWAY", "PIKA", "SORA", "COGVIDEOX",
             name="visual_tool")
    )
    storage_url: Mapped[Optional[str]] = mapped_column(String(1000))
    width: Mapped[Optional[int]] = mapped_column(Integer)
    height: Mapped[Optional[int]] = mapped_column(Integer)
    duration_sec: Mapped[Optional[int]] = mapped_column(Integer)
    generation_prompt: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    bundle: Mapped[ContentBundle] = relationship("ContentBundle", back_populates="assets")
