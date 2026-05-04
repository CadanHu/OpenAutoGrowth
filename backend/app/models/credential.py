"""SQLAlchemy models: platform_credentials"""
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Enum, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class PlatformCredential(Base):
    __tablename__ = "platform_credentials"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False)
    
    platform: Mapped[str] = mapped_column(
        Enum("GOOGLE", "META", "TIKTOK", "WECHAT", "X", name="platform_type"), 
        nullable=False
    )
    
    # The account ID on the platform side (e.g., Google Ads Customer ID)
    external_account_id: Mapped[Optional[str]] = mapped_column(String(100))
    external_account_name: Mapped[Optional[str]] = mapped_column(String(255))
    
    # Encrypted tokens
    access_token: Mapped[str] = mapped_column(String(1024), nullable=False)
    refresh_token: Mapped[Optional[str]] = mapped_column(String(1024))
    
    status: Mapped[str] = mapped_column(
        Enum("ACTIVE", "EXPIRED", "DISCONNECTED", "INVALID", name="credential_status"),
        default="ACTIVE"
    )
    
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    organization: Mapped["Organization"] = relationship("app.models.user.Organization", back_populates="credentials")
