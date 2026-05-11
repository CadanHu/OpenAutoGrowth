"""Optimizer rules HTTP API.

Exposes the backend's `rule_engine` to the frontend Rules tab so users see
(and can toggle) the actual rules driving optimization decisions. Without
this the frontend was showing its own hard-coded mock rule list that had
no effect on backend behavior.

Three endpoints:
    GET    /v1/optimizer/rules                  → list rules + current enabled state
    PATCH  /v1/optimizer/rules/{rule_id}        → toggle enabled, persists to DB
    DELETE /v1/optimizer/rules/{rule_id}/override → revert to default

Persistence lives in `optimizer_rule_overrides` (see app/models/optimization.py).
Workers re-load overrides on each optimizer pipeline pass (see
app/agents/optimizer.py::optimizer_node), so toggles take effect on the very
next campaign run without restarting the worker.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rule_engine import DEFAULT_RULES, rule_engine
from app.database import get_db
from app.models.optimization import OptimizerRuleOverride

router = APIRouter()


def _strip_for_ui(rule: dict, *, enabled: bool, overridden: bool) -> dict:
    """Project a rule dict into the shape the UI cares about.

    Strip nothing important — frontend renders the full condition tree
    in DSL-style. But we surface `enabled` (after override) and an
    `overridden` flag so the UI can show "this is non-default".
    """
    return {
        "id":          rule["id"],
        "name":        rule.get("name", rule["id"]),
        "priority":    rule.get("priority", 100),
        "cooldown_ms": rule.get("cooldown_ms", 0),
        "condition":   rule.get("condition"),
        "action":      rule.get("action"),
        "enabled":     enabled,
        "default_enabled": rule.get("enabled", True),
        "overridden":  overridden,
    }


async def _load_overrides(db: AsyncSession) -> dict[str, bool]:
    rows = (await db.execute(select(OptimizerRuleOverride))).scalars().all()
    return {r.rule_id: r.enabled for r in rows}


@router.get("/rules")
async def list_rules(db: AsyncSession = Depends(get_db)):
    """List the backend's optimizer rules with their effective enabled state."""
    overrides = await _load_overrides(db)
    rules = [
        _strip_for_ui(
            r,
            enabled=overrides.get(r["id"], r.get("enabled", True)),
            overridden=r["id"] in overrides,
        )
        for r in DEFAULT_RULES
    ]
    rules.sort(key=lambda r: r["priority"])
    return {"rules": rules}


class RuleToggle(BaseModel):
    enabled: bool


@router.patch("/rules/{rule_id}")
async def set_rule_enabled(
    rule_id: str,
    body: RuleToggle,
    db: AsyncSession = Depends(get_db),
):
    """Toggle a rule's enabled flag. Upserts an override row."""
    valid_ids = {r["id"] for r in DEFAULT_RULES}
    if rule_id not in valid_ids:
        raise HTTPException(status_code=404, detail=f"unknown rule_id: {rule_id}")

    existing = await db.get(OptimizerRuleOverride, rule_id)
    if existing:
        existing.enabled = body.enabled
    else:
        db.add(OptimizerRuleOverride(rule_id=rule_id, enabled=body.enabled))
    await db.commit()

    # Mirror into the in-process rule_engine so the same FastAPI worker
    # sees the change immediately on any subsequent in-proc evaluation.
    # ARQ worker processes pick the override up via _load_overrides on
    # their next pipeline pass.
    for r in rule_engine.rules:
        if r["id"] == rule_id:
            r["enabled"] = body.enabled
            break

    return {"ok": True, "rule_id": rule_id, "enabled": body.enabled}


@router.delete("/rules/{rule_id}/override", status_code=204)
async def clear_rule_override(rule_id: str, db: AsyncSession = Depends(get_db)):
    """Revert a rule back to its DEFAULT_RULES `enabled` value."""
    existing = await db.get(OptimizerRuleOverride, rule_id)
    if existing:
        await db.delete(existing)
        await db.commit()
    # Restore the in-process rule_engine to its default flag too.
    for r in rule_engine.rules:
        if r["id"] == rule_id:
            default_rule = next((d for d in DEFAULT_RULES if d["id"] == rule_id), None)
            if default_rule is not None:
                r["enabled"] = default_rule.get("enabled", True)
            break
    return None
