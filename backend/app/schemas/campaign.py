"""Pydantic schemas for Campaign REST API."""
from datetime import date, datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


# ── Enums ─────────────────────────────────────────────────────────────────────

class CampaignStatus(str):
    DRAFT = "DRAFT"
    PLANNING = "PLANNING"
    PLANNING_FAILED = "PLANNING_FAILED"
    PENDING_REVIEW = "PENDING_REVIEW"
    PRODUCTION = "PRODUCTION"
    DEPLOYED = "DEPLOYED"
    MONITORING = "MONITORING"
    OPTIMIZING = "OPTIMIZING"
    PAUSED = "PAUSED"
    COMPLETED = "COMPLETED"


# ── Sub-objects ───────────────────────────────────────────────────────────────

class BudgetSchema(BaseModel):
    total: int = Field(..., gt=0, description="Total budget in smallest currency unit (cents)")
    daily_cap: Optional[int] = Field(None, gt=0)
    currency: str = Field(default="CNY", pattern="^(CNY|USD|EUR|GBP)$")


class KPISchema(BaseModel):
    metric: str = Field(..., description="Metric name (e.g., ROAS, CPA, CPC, awareness)")
    target: float = Field(..., gt=0)


class TimelineSchema(BaseModel):
    start: date
    end: date
    duration_days: Optional[int] = None

    @model_validator(mode="after")
    def end_after_start(self):
        if self.end <= self.start:
            raise ValueError("end date must be after start date")
        return self


class ConstraintsSchema(BaseModel):
    channels: list[str] = Field(default_factory=list)
    region: Optional[str] = None
    url: Optional[str] = None


# ── Request Schemas ───────────────────────────────────────────────────────────

class CampaignCreate(BaseModel):
    name: Optional[str] = None
    campaign_type: str = Field(default="ecom")
    goal: str = Field(..., min_length=5, max_length=1000)
    budget: BudgetSchema
    kpi: KPISchema
    timeline: Optional[TimelineSchema] = None
    constraints: Optional[ConstraintsSchema] = None


class CampaignUpdate(BaseModel):
    name: Optional[str] = None
    goal: Optional[str] = None
    budget: Optional[BudgetSchema] = None
    kpi: Optional[KPISchema] = None
    timeline: Optional[TimelineSchema] = None
    constraints: Optional[ConstraintsSchema] = None


# ── Response Schemas ──────────────────────────────────────────────────────────

class TaskResponse(BaseModel):
    id: UUID
    task_key: str
    agent_type: str
    status: str
    dependencies: list[str]
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    error_message: Optional[str] = None

    model_config = {"from_attributes": True}


class PlanResponse(BaseModel):
    id: UUID
    scenario: str
    tasks: list[TaskResponse]
    created_at: datetime

    model_config = {"from_attributes": True}


class CampaignResponse(BaseModel):
    id: UUID
    name: str
    goal: str
    status: str
    loop_count: int
    budget_total: int
    currency: str
    kpi_metric: str
    kpi_target: float
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CampaignDetailResponse(CampaignResponse):
    plans: list[PlanResponse] = []


class CampaignListResponse(BaseModel):
    total: int
    items: list[CampaignResponse]


class StartCampaignResponse(BaseModel):
    job_id: str
    campaign_id: UUID
    status: str
