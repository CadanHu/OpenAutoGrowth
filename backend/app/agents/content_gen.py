"""
ContentGen Agent Node — LLM-powered A/B copy generation.

Input:  state.strategy, state.goal, state.constraints
Output: state.content  (bundle_id + variants[])
Events: ContentGenerated
"""
import json
import uuid

import structlog
from tenacity import retry, stop_after_attempt, wait_exponential

from app.config import settings
from app.core.event_bus import event_bus
from app.core.llm import llm_client
from .state import CampaignState

logger = structlog.get_logger(__name__)


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
async def _call_llm(prompt: str) -> list[dict]:
    """Call LLM to generate copy variants. Retries 3x on transient errors."""
    raw = await llm_client.chat_completion(
        system=(
            "You are a senior performance marketing copywriter. "
            "Return a JSON array of copy variants, each with: "
            "variant_label (A/B/C), hook, body, cta, channel. "
            "Output ONLY valid JSON, no markdown."
        ),
        messages=[{"role": "user", "content": prompt}],
    )
    # Clean up potential markdown code blocks if the LLM includes them
    if "```json" in raw:
        raw = raw.split("```json")[1].split("```")[0].strip()
    elif "```" in raw:
        raw = raw.split("```")[1].split("```")[0].strip()

    return json.loads(raw)


async def content_gen_node(state: CampaignState) -> dict:
    """
    LangGraph node: generate A/B copy variants via Claude.
    """
    logger.info("content_gen_start", campaign_id=state["campaign_id"])

    strategy = state.get("strategy") or {}
    channels = strategy.get("channel_plan", [{"channel": "tiktok"}, {"channel": "meta"}])
    channel_names = [c["channel"] for c in channels]

    prompt = (
        f"Product goal: {state['goal']}\n"
        f"Target channels: {', '.join(channel_names)}\n"
        f"KPI target: {state['kpi']['metric']} = {state['kpi']['target']}\n"
        f"Generate 3 A/B/C copy variants optimized for these channels."
    )

    try:
        variants = await _call_llm(prompt)

        bundle = {
            "bundle_id": f"bundle_{uuid.uuid4().hex[:8]}",
            "variants": variants,
            "llm_model": settings.anthropic_model,
        }

        await event_bus.publish(
            "ContentGenerated",
            {"bundle": bundle},
            state["campaign_id"],
        )

        logger.info("content_gen_done", variants=len(variants))
        return {
            "content": bundle,
            "status": "PRODUCTION",
            "completed_tasks": ["content_gen"],
        }

    except Exception as exc:
        logger.error("content_gen_error", error=str(exc))
        return {"errors": [{"node": "content_gen", "error": str(exc)}]}
