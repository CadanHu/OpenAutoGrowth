"""Governance rule engine — hard-coded approval gates.

Distinct from `core/rule_engine.py` (the *optimizer's* rule engine, which
fires automated actions). This engine evaluates pipeline-stage gates that
pause the campaign for human approval.

Predicates are a whitelist — no `eval`, no arbitrary expressions — so rule
data is safe to load from DB / user input. Adding a predicate: define it in
`_PREDICATES`, document in the table below, add a test.

Supported predicates
────────────────────
  budget_total_gte: int        — campaign.budget.total >= N (DB unit; cents)
  budget_total_lte: int        — campaign.budget.total <= N
  industry_in: [str, ...]      — campaign.metadata.industry in list (case-insensitive)
  channels_include: [str, ...] — any channel in strategy.channel_plan matches
  regions_outside_home: bool   — any target region != home region
  loop_count_gte: int          — campaign.loop_count >= N
  kpi_met: bool                — current KPI metric meets/beats target
  brand_first_use: bool        — first creative campaign for this brand
  goal_contains: [str, ...]    — campaign.goal contains ANY of the substrings (case-insensitive)
"""
from typing import Any, Callable


def _budget_total_gte(state: dict, threshold: int) -> bool:
    return int((state.get("budget") or {}).get("total") or 0) >= int(threshold)


def _budget_total_lte(state: dict, threshold: int) -> bool:
    return int((state.get("budget") or {}).get("total") or 0) <= int(threshold)


def _industry_in(state: dict, industries: list[str]) -> bool:
    target = ((state.get("metadata") or {}).get("industry") or "").lower()
    return target in {str(x).lower() for x in industries}


def _channels_include(state: dict, channels: list[str]) -> bool:
    plan = (state.get("strategy") or {}).get("channel_plan") or []
    used = {str(c.get("channel", "")).lower() for c in plan}
    return bool(used & {str(x).lower() for x in channels})


def _regions_outside_home(state: dict, flag: bool) -> bool:
    # Compare upper-case so "us" / "US" / "Us" all match. strategy_node
    # already normalizes its output to upper-case; this guards against
    # constraints.region being whatever the user typed in.
    home = str((state.get("constraints") or {}).get("region") or "").upper()
    targets = (state.get("strategy") or {}).get("regions") or []
    targets_u = {str(r).upper() for r in targets if r}
    outside = bool(home and (targets_u - {home}))
    return outside == bool(flag)


def _loop_count_gte(state: dict, threshold: int) -> bool:
    return int(state.get("loop_count") or 0) >= int(threshold)


def _kpi_met(state: dict, flag: bool) -> bool:
    report = (state.get("report") or {}).get("metrics") or {}
    target = (state.get("kpi") or {}).get("target") or 0
    metric_name = (state.get("kpi") or {}).get("metric", "").lower()
    actual = report.get(metric_name) or 0
    met = bool(target and actual and actual >= target)
    return met == bool(flag)


def _brand_first_use(state: dict, flag: bool) -> bool:
    return bool((state.get("metadata") or {}).get("brand_first_use", False)) == bool(flag)


def _goal_contains(state: dict, needles: list[str]) -> bool:
    goal = str(state.get("goal") or "").lower()
    return any(str(n).lower() in goal for n in needles)


_PREDICATES: dict[str, Callable[[dict, Any], bool]] = {
    "budget_total_gte":     _budget_total_gte,
    "budget_total_lte":     _budget_total_lte,
    "industry_in":          _industry_in,
    "channels_include":     _channels_include,
    "regions_outside_home": _regions_outside_home,
    "loop_count_gte":       _loop_count_gte,
    "kpi_met":              _kpi_met,
    "brand_first_use":      _brand_first_use,
    "goal_contains":        _goal_contains,
}


def evaluate_when(when: dict[str, Any], state: dict[str, Any]) -> bool:
    """All listed predicates must match (AND). Unknown predicates fail closed
    — better to miss an approval than to silently let a typo bypass the gate."""
    if not when:
        return False
    for key, arg in when.items():
        fn = _PREDICATES.get(key)
        if fn is None:
            return False
        try:
            if not fn(state, arg):
                return False
        except Exception:
            return False
    return True


async def find_firing_rules(db, state: dict[str, Any], stage: str) -> list:
    """Return all enabled GovernanceRules that fire for this state at this stage."""
    from sqlalchemy import select
    from app.models.governance import GovernanceRule

    q = select(GovernanceRule).where(
        GovernanceRule.stage_before == stage,
        GovernanceRule.enabled.is_(True),
    )
    rows = (await db.execute(q)).scalars().all()
    return [r for r in rows if evaluate_when(r.when, state)]
