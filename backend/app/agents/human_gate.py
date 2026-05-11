"""Human-in-the-loop gate node.

Sits between graph stages. On entry, checks for open `RevisionCase`s for
this campaign at this stage:

  - case exists & still open  →  state.gate_status = "PENDING"  (graph exits)
  - case exists & resolved    →  if any task REJECTED → "REJECTED"  (revise loop)
                                else → "PASSED"                    (proceed)
  - no case                   →  evaluate rules; if any fire, open a new case
                                and PAUSE; else "PASSED"

The graph uses a conditional edge after each gate node to either continue
to the next agent or route to END (paused) / loop back (rejected).
"""
import uuid
from datetime import datetime, timedelta, timezone

import structlog
from sqlalchemy import select

from app.core.event_bus import event_bus
from app.core.governance_rules import find_firing_rules
from app.database import async_session_factory
from .state import CampaignState

logger = structlog.get_logger(__name__)


def _snapshot_for_audit(state: CampaignState) -> dict:
    """Slim copy of the campaign state for the approver to see at decision time."""
    return {
        "goal":        state.get("goal"),
        "budget":      state.get("budget"),
        "kpi":         state.get("kpi"),
        "constraints": state.get("constraints"),
        "strategy":    state.get("strategy"),
        "loop_count":  state.get("loop_count"),
        "report":      state.get("report"),
    }


async def _evaluate_gate(state: CampaignState, stage: str) -> dict:
    """Shared implementation for every per-stage gate wrapper."""
    from app.models.governance import RevisionCase, RevisionTask

    campaign_id = state["campaign_id"]
    try:
        cid_uuid = uuid.UUID(campaign_id)
    except (ValueError, TypeError):
        # Bad campaign_id shouldn't crash the graph — fail open so the rest
        # of the pipeline can still run. The gate just becomes a no-op.
        logger.warning("gate_invalid_campaign_id", campaign_id=campaign_id, stage=stage)
        return {"gate_status": "PASSED"}

    async with async_session_factory() as db:
        # 1. Look for an active (un-consumed) case at this stage. CANCELLED
        #    means "already consumed by a previous gate visit" — that's how
        #    we avoid infinite loops on the rejected/revise path: as soon as
        #    the gate routes the campaign forward or back, the case is
        #    retired so the *next* visit re-evaluates rules from scratch.
        from sqlalchemy.orm import selectinload
        q = (
            select(RevisionCase)
            .options(selectinload(RevisionCase.tasks))
            .where(RevisionCase.campaign_id == cid_uuid)
            .where(RevisionCase.stage == stage)
            .where(RevisionCase.status.in_(("OPEN", "RESOLVED")))
            .order_by(RevisionCase.opened_at.desc())
            .limit(1)
        )
        case = (await db.execute(q)).scalar_one_or_none()

        if case and case.status == "OPEN":
            logger.info("gate_pending", campaign_id=campaign_id, stage=stage, case_id=str(case.id))
            return {"gate_status": "PENDING", "status": "PAUSED_FOR_APPROVAL"}

        if case and case.status == "RESOLVED":
            any_rejected = any(t.status == "REJECTED" for t in case.tasks)
            # Consume the case so subsequent gate visits (e.g. after a
            # strategy re-run on the revise branch) start fresh.
            case.status = "CANCELLED"
            db.add(case)
            await db.commit()
            if any_rejected:
                logger.info("gate_rejected", campaign_id=campaign_id, stage=stage, case_id=str(case.id))
                return {"gate_status": "REJECTED"}
            logger.info("gate_passed_after_approval", campaign_id=campaign_id, stage=stage)
            return {"gate_status": "PASSED"}

        # 2. No active case — run the rule engine.
        firing = await find_firing_rules(db, dict(state), stage)
        if not firing:
            return {"gate_status": "PASSED"}

        # 3. One or more rules fired — open a case and pause.
        # Inherit tenant_id from the campaign so per-tenant query scoping
        # (Phase 1B) can see the new rows immediately, not just after the
        # startup backfill.
        from app.models.campaign import Campaign
        camp = await db.get(Campaign, cid_uuid)
        camp_tenant = getattr(camp, "org_id", None) if camp else None

        new_case = RevisionCase(
            campaign_id=cid_uuid,
            tenant_id=camp_tenant,
            stage=stage,
            status="OPEN",
            trigger_context=_snapshot_for_audit(state),
        )
        db.add(new_case)
        await db.flush()

        for rule in firing:
            due = datetime.now(timezone.utc) + timedelta(hours=int(rule.sla_hours or 24))
            db.add(RevisionTask(
                case_id=new_case.id,
                tenant_id=camp_tenant,
                rule_id=rule.id,
                rule_code=rule.code,
                rule_name=rule.name,
                role=rule.require_role,
                status="OPEN",
                due_at=due,
            ))

        await db.commit()

        logger.info(
            "gate_opened_case",
            campaign_id=campaign_id,
            stage=stage,
            case_id=str(new_case.id),
            rules=[r.code for r in firing],
        )

        await event_bus.publish(
            "ApprovalRequired",
            {
                "case_id": str(new_case.id),
                "stage": stage,
                "rules": [{"code": r.code, "name": r.name, "role": r.require_role} for r in firing],
            },
            campaign_id,
        )

        # Fan out external notifications (email / Slack / 钉钉) — one round
        # per *distinct role* across firing rules so a user who holds two
        # required roles doesn't get two pings for the same case.
        from app.notify import dispatcher
        budget = (state.get("budget") or {}).get("total")
        kpi    = state.get("kpi") or {}
        for role in {r.require_role for r in firing}:
            await dispatcher.send_to_role(
                tenant_id=camp_tenant,
                role=role,
                template="approval_required",
                context={
                    "campaign_id":  campaign_id,
                    "stage":        stage,
                    "rules":        [r.code for r in firing if r.require_role == role],
                    "budget_total": budget,
                    "kpi_metric":   kpi.get("metric"),
                    "kpi_target":   kpi.get("target"),
                },
                event_type="ApprovalRequired",
            )

    return {"gate_status": "PENDING", "status": "PAUSED_FOR_APPROVAL"}


# Per-stage wrappers — LangGraph needs distinct node names so each gate has
# its own checkpointer entry and can be resumed independently.
async def gate_before_content_gen(state: CampaignState) -> dict:
    return await _evaluate_gate(state, "content_gen")


async def gate_before_reviewer(state: CampaignState) -> dict:
    return await _evaluate_gate(state, "reviewer")


async def gate_before_channel_exec(state: CampaignState) -> dict:
    return await _evaluate_gate(state, "channel_exec")


async def gate_before_optimizer(state: CampaignState) -> dict:
    return await _evaluate_gate(state, "optimizer")


def gate_decision(state: CampaignState) -> str:
    """Conditional-edge router for any gate node."""
    status = state.get("gate_status")
    if status == "PENDING":
        return "pause"
    if status == "REJECTED":
        return "revise"
    return "proceed"
