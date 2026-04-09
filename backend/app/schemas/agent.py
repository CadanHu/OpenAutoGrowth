"""Pydantic schemas for internal Agent input/output contracts."""
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, Field


# ── Agent Input (passed to each LangGraph node) ───────────────────────────────

class AgentInput(BaseModel):
    campaign_id: UUID
    goal: str
    budget: dict[str, Any]
    kpi: dict[str, Any]
    constraints: dict[str, Any] = Field(default_factory=dict)
    context: dict[str, Any] = Field(default_factory=dict)  # upstream node results


# ── Per-Agent Output Schemas ──────────────────────────────────────────────────

class PlanOutput(BaseModel):
    plan_id: str
    scenario: str
    tasks: list[dict]


class StrategyOutput(BaseModel):
    channel_plan: list[dict]   # [{ channel, budget, bid_strategy, audience }]
    total_budget: int


class ContentOutput(BaseModel):
    bundle_id: str
    variants: list[dict]       # [{ id, variant_label, hook, body, cta, channel }]
    llm_model: str


class AssetOutput(BaseModel):
    bundle_id: str
    assets: list[dict]         # [{ id, type, storage_url, width, height }]
    tool_used: str


class ExecOutput(BaseModel):
    platforms: list[str]
    ad_ids: list[str]
    deployed_at: str


class AnalysisOutput(BaseModel):
    report_id: str
    metrics: dict[str, float]  # { ctr, cvr, roas, roi, ... }
    anomalies: list[dict]
    winner_variant: Optional[str] = None


class OptimizerOutput(BaseModel):
    loop_count: int
    actions: list[dict]        # [{ rule_id, type, params }]
    kpi_delta: Optional[dict] = None
    should_loop: bool


# ── ARQ Job Schemas ───────────────────────────────────────────────────────────

class AgentJobRequest(BaseModel):
    campaign_id: str
    job_type: str              # "full_pipeline" | "single_node"
    node_name: Optional[str] = None
    priority: int = 5
