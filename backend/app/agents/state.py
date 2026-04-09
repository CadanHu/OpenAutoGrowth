"""
CampaignState — LangGraph shared state TypedDict.
Every agent node reads from and writes partial updates to this state.
"""
from typing import Annotated, Any, Optional
from typing_extensions import TypedDict


def _merge_list(a: list, b: list) -> list:
    """Reducer: append new items without duplicates."""
    return list(dict.fromkeys(a + b))


class CampaignState(TypedDict):
    # ── Input (set at graph entry) ─────────────────────────────────
    campaign_id:   str
    goal:          str
    budget:        dict[str, Any]           # { total, currency, daily_cap }
    kpi:           dict[str, Any]           # { metric, target }
    constraints:   dict[str, Any]           # { channels[], region }

    # ── Planning layer ─────────────────────────────────────────────
    plan:          Optional[dict[str, Any]]  # DAG plan from Planner
    scenario:      Optional[str]             # NEW_PRODUCT | RETENTION | BRAND | GROWTH

    # ── Execution layer ────────────────────────────────────────────
    strategy:      Optional[dict[str, Any]]  # channel_plan, budget allocation
    content:       Optional[dict[str, Any]]  # copy variants
    assets:        Optional[dict[str, Any]]  # visual assets
    deployed_ads:  Optional[dict[str, Any]]  # ad IDs per platform

    # ── Feedback layer ─────────────────────────────────────────────
    report:        Optional[dict[str, Any]]  # metrics: ctr, roas, cvr, ...
    anomalies:     Optional[list[dict]]
    opt_actions:   Optional[list[dict]]      # RuleEngine decisions

    # ── Control flow ───────────────────────────────────────────────
    status:        str                       # current campaign status
    loop_count:    int                       # optimization loop counter
    errors:        Annotated[list[dict], _merge_list]  # accumulated node errors
    completed_tasks: Annotated[list[str], _merge_list] # node names finished
