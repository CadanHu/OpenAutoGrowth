"""
CampaignState — LangGraph shared state TypedDict.
Every agent node reads from and writes partial updates to this state.
"""
import json
from typing import Annotated, Any, Optional
from typing_extensions import TypedDict


def _merge_str_list(a: list[str], b: list[str]) -> list[str]:
    """Reducer for hashable items (strings). Order-preserving dedup."""
    return list(dict.fromkeys(a + b))


def _merge_dict_list(a: list[dict], b: list[dict]) -> list[dict]:
    """
    Reducer for unhashable items (dicts). dict.fromkeys would raise
    TypeError, so we dedup by JSON-canonical form. Two structurally
    identical errors won't double-log; structurally distinct ones — even
    if they share the same 'node' field — are kept.
    """
    seen: set[str] = set()
    out: list[dict] = []
    for item in a + b:
        try:
            key = json.dumps(item, sort_keys=True, default=str)
        except (TypeError, ValueError):
            # Un-serializable payloads still get appended (no dedup).
            out.append(item)
            continue
        if key not in seen:
            seen.add(key)
            out.append(item)
    return out


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

    # ── Reviewer layer ─────────────────────────────────────────────
    review_result:   Optional[str]           # APPROVED | REJECTED
    review_feedback: Optional[str]           # Feedback if REJECTED

    # ── Human-in-the-loop gate ─────────────────────────────────────
    gate_status:     Optional[str]           # PASSED | PENDING | REJECTED

    # ── Control flow ───────────────────────────────────────────────
    status:        str                       # current campaign status
    loop_count:    int                       # optimization loop counter
    errors:        Annotated[list[dict], _merge_dict_list]  # accumulated node errors
    completed_tasks: Annotated[list[str], _merge_str_list]   # node names finished
