"""
RuleEngine — deterministic optimizer decision engine.
Python port of src/core/RuleEngine.js with full DSL condition evaluation.
Rules: R001-R005 (see docs/architecture/05-rule-engine.md)
"""
import time
from typing import Any

import structlog

logger = structlog.get_logger(__name__)


# ── Default rule set (mirrors RuleEngine.js) ──────────────────────────────────

DEFAULT_RULES = [
    {
        "id": "R001",
        "name": "低 CTR 暂停",
        "priority": 10,
        "cooldown_ms": 3_600_000,
        "enabled": True,
        "condition": {
            "operator": "AND",
            "children": [
                {"field": "metrics.ctr",  "op": "<",  "value": 0.01},
                {"field": "metrics.roas", "op": "<",  "value": 1.5},
            ],
        },
        "action": {"type": "PAUSE_AD_GROUP", "params": {"reason": "low_ctr"}},
    },
    {
        "id": "R002",
        "name": "高 ROAS 加量",
        "priority": 20,
        "cooldown_ms": 7_200_000,
        "enabled": True,
        "condition": {
            "operator": "AND",
            "children": [
                {"field": "metrics.roas", "op": ">",  "value": 3.5},
                {"field": "metrics.ctr",  "op": ">",  "value": 0.025},
            ],
        },
        "action": {"type": "INCREASE_BUDGET", "params": {"pct": 0.20}},
    },
    {
        "id": "R003",
        "name": "A/B 胜者确认",
        "priority": 30,
        "cooldown_ms": 86_400_000,
        "enabled": True,
        "condition": {
            "operator": "AND",
            "children": [
                {"field": "metrics.clicks", "op": ">", "value": 500},
            ],
        },
        "action": {"type": "PAUSE_LOSING_VARIANTS", "params": {}},
    },
    {
        "id": "R004",
        "name": "异常 ROAS 告警",
        "priority": 5,
        "cooldown_ms": 1_800_000,
        "enabled": True,
        "condition": {
            "operator": "OR",
            "children": [
                {"field": "metrics.roas", "op": "<",  "value": 0.5},
                {"field": "metrics.roas", "op": ">",  "value": 15.0},
            ],
        },
        "action": {"type": "ALERT", "params": {"severity": "HIGH", "metric": "roas"}},
    },
    {
        "id": "R005",
        "name": "超预算熔断",
        "priority": 1,
        "cooldown_ms": 0,
        "enabled": True,
        "condition": {"field": "metrics.spend_ratio", "op": ">", "value": 0.95},
        "action": {"type": "PAUSE_CAMPAIGN", "params": {"reason": "budget_exhausted"}},
    },
]


class RuleEngine:
    def __init__(self, rules: list[dict] | None = None):
        self.rules = sorted(rules or DEFAULT_RULES, key=lambda r: r["priority"])
        self._cooldown: dict[str, float] = {}   # "campaignId:ruleId" → last_fired_ms

    def evaluate(self, context: dict, campaign_id: str) -> list[dict]:
        """
        Evaluate all enabled rules against context.
        Returns deduplicated list of OptAction dicts.
        """
        actions = []
        for rule in self.rules:
            if not rule.get("enabled", True):
                continue
            if self._on_cooldown(campaign_id, rule["id"], rule.get("cooldown_ms", 0)):
                continue
            if self._eval_condition(rule["condition"], context):
                logger.info("rule_fired", rule_id=rule["id"], name=rule["name"])
                actions.append({"rule_id": rule["id"], **rule["action"]})
                self._record_fire(campaign_id, rule["id"])

        return self._dedup(actions)

    # ── Condition evaluation ──────────────────────────────────────

    def _eval_condition(self, condition: dict, context: dict) -> bool:
        if "field" in condition:
            return self._eval_predicate(condition, context)

        operator = condition.get("operator", "AND")
        children = condition.get("children", [])
        results = [self._eval_condition(c, context) for c in children]

        if operator == "AND":
            return all(results)
        if operator == "OR":
            return any(results)
        if operator == "NOT":
            return not results[0] if results else False
        return False

    def _eval_predicate(self, pred: dict, context: dict) -> bool:
        field = pred["field"]
        op    = pred["op"]
        value = pred["value"]

        actual = self._get_field(field, context)
        if actual is None:
            return False

        match op:
            case ">":  return actual > value
            case ">=": return actual >= value
            case "<":  return actual < value
            case "<=": return actual <= value
            case "==": return actual == value
            case "!=": return actual != value
            case _:    return False

    def _get_field(self, field: str, context: dict) -> Any:
        """Dot-notation field access: 'metrics.ctr' → context['metrics']['ctr']"""
        parts = field.split(".")
        node = context
        for part in parts:
            if not isinstance(node, dict) or part not in node:
                return None
            node = node[part]
        return node

    # ── Cooldown tracking ─────────────────────────────────────────

    def _on_cooldown(self, campaign_id: str, rule_id: str, cooldown_ms: int) -> bool:
        if cooldown_ms <= 0:
            return False
        key = f"{campaign_id}:{rule_id}"
        last = self._cooldown.get(key, 0)
        return (time.time() * 1000 - last) < cooldown_ms

    def _record_fire(self, campaign_id: str, rule_id: str):
        self._cooldown[f"{campaign_id}:{rule_id}"] = time.time() * 1000

    # ── Deduplication ─────────────────────────────────────────────

    def _dedup(self, actions: list[dict]) -> list[dict]:
        """Keep only the highest-priority action per type."""
        seen: dict[str, dict] = {}
        for action in actions:
            t = action["type"]
            if t not in seen:
                seen[t] = action
        return list(seen.values())


# Global singleton
rule_engine = RuleEngine()
