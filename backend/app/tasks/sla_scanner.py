"""SLA scanner — Phase 3.

Runs as an ARQ cron job. Every tick:
  1. Find OPEN tasks past their `due_at`.
  2. If an escalation target exists, reassign + bump level + push deadline.
  3. Else apply `rule.default_decision`:
       - APPROVE  → auto-approve, close case if all tasks resolved
       - REJECT   → auto-reject, close case (triggers revise loop)
       - NONE/null → mark AUTO_DEFAULTED so dashboards flag it; no campaign movement.

Notifications fire on each escalation hop (template `approval_escalated`)
and on the final auto-decision (`approval_resolved`).

Idempotent: re-running on the same row is a no-op once the task is closed.
The cron uses `enqueue_campaign` to resume paused work after a default
decision closes the last open task in a case.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

import structlog
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.event_bus import event_bus
from app.database import async_session_factory
from app.models.campaign import Campaign
from app.models.governance import GovernanceRule, RevisionCase, RevisionTask

logger = structlog.get_logger(__name__)


# Fixed chain: who picks up a task once SLA expires. Per-rule overrides
# can be added later (column on governance_rules), but a global default
# keeps the moving parts small for Phase 3.
ESCALATION_CHAIN: dict[str, list[str]] = {
    "FINANCE":            ["MARKETING_DIRECTOR", "ADMIN"],
    "LEGAL":              ["MARKETING_DIRECTOR", "ADMIN"],
    "BRAND_LEAD":         ["MARKETING_DIRECTOR", "ADMIN"],
    "MARKETING_DIRECTOR": ["ADMIN"],
    "ADMIN":              [],
    "AI":                 [],
}


def _next_role(role: str, level: int) -> Optional[str]:
    """Return the role the task should escalate to next, or None if exhausted."""
    chain = ESCALATION_CHAIN.get((role or "").upper()) or []
    # `level` is the *current* escalation level. level=0 is original; the
    # first escalation pulls chain[0]. Anything past chain length = exhausted.
    if level < len(chain):
        return chain[level]
    return None


def _post_escalation_due(rule: GovernanceRule, now: datetime) -> datetime:
    """How long the escalated role has to respond. Half the original SLA
    (min 1h, max 24h) — keeps things urgent without being unreachable."""
    base = max(1, int(rule.sla_hours or 24) // 2)
    base = min(base, 24)
    return now + timedelta(hours=base)


async def _resume_if_case_closed(db, case: RevisionCase, campaign_id: str) -> bool:
    """If every task in the case is now decided, mark the case RESOLVED and
    re-enqueue the campaign worker. Returns whether the case closed here."""
    all_decided = all(t.status != "OPEN" for t in case.tasks)
    if not all_decided:
        return False

    now = datetime.now(timezone.utc)
    case.status = "RESOLVED"
    case.resolved_at = now
    db.add(case)
    await db.flush()

    # Flip the campaign off PAUSED_FOR_APPROVAL and re-enqueue so the
    # LangGraph checkpointer picks up where it left off.
    camp = await db.get(Campaign, case.campaign_id)
    if camp and camp.status == "PAUSED_FOR_APPROVAL":
        camp.status = "PLANNING"
        db.add(camp)
        await db.flush()

        from app.tasks.agent_tasks import enqueue_campaign
        await enqueue_campaign(campaign_id)

        await event_bus.publish(
            "StatusChanged",
            {"old_status": "PAUSED_FOR_APPROVAL", "new_status": "PLANNING",
             "reason": "sla_auto_decision"},
            campaign_id,
        )

    decisions = [
        {"task_id": str(t.id), "role": t.role, "rule_code": t.rule_code,
         "status": t.status, "feedback": t.feedback}
        for t in case.tasks
    ]
    await event_bus.publish(
        "ApprovalResolved",
        {"case_id": str(case.id), "stage": case.stage,
         "decisions": decisions, "reason": "sla_auto_decision"},
        campaign_id,
    )
    return True


async def _escalate(db, task: RevisionTask, rule: GovernanceRule, new_role: str):
    """Move a task to the next role in the chain."""
    now = datetime.now(timezone.utc)
    old_role = task.role
    task.role = new_role
    task.escalation_level = (task.escalation_level or 0) + 1
    task.escalated_at = now
    task.due_at = _post_escalation_due(rule, now)
    task.assignee_id = None  # reassign — the new role picks it up fresh
    db.add(task)
    await db.flush()

    logger.info(
        "sla_escalated",
        task_id=str(task.id), rule=task.rule_code,
        from_role=old_role, to_role=new_role, level=task.escalation_level,
    )

    # Notify the new role's users in the same tenant.
    try:
        from app.notify import dispatcher
        await dispatcher.send_to_role(
            tenant_id=task.tenant_id,
            role=new_role,
            template="approval_escalated",
            context={
                "campaign_id": str(task.case.campaign_id),
                "stage":       task.case.stage,
                "rule_code":   task.rule_code,
                "rule_name":   task.rule_name,
                "previous_role": old_role,
                "level":       task.escalation_level,
            },
            event_type="ApprovalEscalated",
        )
    except Exception as exc:
        logger.warning("escalation_notify_failed", error=str(exc))


async def _auto_decide(db, task: RevisionTask, rule: GovernanceRule):
    """Apply the rule's `default_decision` once the chain is exhausted."""
    now = datetime.now(timezone.utc)
    default = (rule.default_decision or "").upper()

    if default in ("APPROVE", "REJECT"):
        task.status = default + "D"  # → APPROVED / REJECTED
        task.feedback = (
            f"Auto-{default.lower()}d after SLA chain exhausted "
            f"(escalations: {task.escalation_level})"
        )
    else:
        # No safe default — flag for ops review. Campaign stays paused.
        task.status = "AUTO_DEFAULTED"
        task.feedback = "SLA chain exhausted; no default_decision configured"

    task.decided_at = now
    task.decided_by = None  # system
    db.add(task)
    await db.flush()

    logger.info(
        "sla_auto_decided",
        task_id=str(task.id), rule=task.rule_code,
        result=task.status, level=task.escalation_level,
    )


async def scan_overdue_tasks(ctx: dict) -> dict:
    """ARQ cron entry point. Returns a small summary dict for visibility."""
    summary = {"escalated": 0, "auto_decided": 0, "scanned_at": None}

    if not event_bus._redis:
        await event_bus.connect()

    now = datetime.now(timezone.utc)
    summary["scanned_at"] = now.isoformat()

    async with async_session_factory() as db:
        q = (
            select(RevisionTask)
            .options(selectinload(RevisionTask.case))
            .where(RevisionTask.status == "OPEN")
            .where(RevisionTask.due_at != None)  # noqa: E711 — SQL NULL check
            .where(RevisionTask.due_at < now)
        )
        overdue = (await db.execute(q)).scalars().all()
        if not overdue:
            return summary

        # Pre-load rules so we can read default_decision without an extra
        # query per row.
        rule_ids = {t.rule_id for t in overdue if t.rule_id}
        rules_by_id: dict = {}
        if rule_ids:
            rrows = (await db.execute(
                select(GovernanceRule).where(GovernanceRule.id.in_(rule_ids))
            )).scalars().all()
            rules_by_id = {r.id: r for r in rrows}

        # Group by case so a `_resume_if_case_closed` call doesn't re-enqueue
        # the campaign multiple times for the same case.
        cases_to_check: set = set()

        for task in overdue:
            rule = rules_by_id.get(task.rule_id)
            # If the rule was deleted, treat as no chain + no default →
            # AUTO_DEFAULTED so ops sees it.
            if rule is None:
                task.status = "AUTO_DEFAULTED"
                task.decided_at = now
                task.feedback = "Underlying rule deleted; manual triage required"
                db.add(task)
                cases_to_check.add(task.case_id)
                summary["auto_decided"] += 1
                continue

            nxt = _next_role(task.role, task.escalation_level)
            if nxt:
                await _escalate(db, task, rule, nxt)
                summary["escalated"] += 1
            else:
                await _auto_decide(db, task, rule)
                cases_to_check.add(task.case_id)
                summary["auto_decided"] += 1

        # Walk back through closed cases and resume campaigns where needed.
        for cid in cases_to_check:
            case = (await db.execute(
                select(RevisionCase)
                .options(selectinload(RevisionCase.tasks))
                .where(RevisionCase.id == cid)
            )).scalar_one_or_none()
            if case:
                await _resume_if_case_closed(db, case, str(case.campaign_id))

        await db.commit()

    if summary["escalated"] or summary["auto_decided"]:
        logger.info("sla_scan_complete", **summary)
    return summary
