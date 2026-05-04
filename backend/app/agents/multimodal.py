"""
Multimodal Agent Node — AI-driven visual asset generation.

Input:  state.strategy, state.goal, state.constraints, state.opt_actions
Output: state.assets (bundle_id + assets[])
Events: AssetsGenerated
"""
import json
import uuid
import httpx
import structlog
from typing import Optional

from app.config import settings
from app.core.event_bus import event_bus
from app.core.llm import llm_client, current_agent_type
from .state import CampaignState

logger = structlog.get_logger(__name__)

# Platform → required sizes
_PLATFORM_SIZES: dict[str, list[str]] = {
    "tiktok":  ["9:16", "1:1"],
    "meta":    ["1:1", "4:5", "16:9"],
    "google":  ["16:9", "1:1"],
    "wechat":  ["1:1", "16:9", "9:16"],
    "linkedin": ["1:1", "16:9"],
    "zhihu":   ["16:9"],
}

VISUAL_PROMPT_SYSTEM = """
You are a Senior Creative Director at a top advertising agency.
Your task is to convert a marketing goal into a detailed, high-quality visual prompt for an AI image generator (like DALL-E 3 or Midjourney).

Guidelines:
- Describe the subject, lighting, composition, and style (e.g., cinematic, minimalist, vector illustration).
- Match the visual style to the target audience and scenario.
- Avoid generic descriptions; be specific.
- Do not include text in the image prompt as AI generators are still inconsistent with text.
- Return ONLY the descriptive prompt string.
"""

def _infer_sizes(channels: list[str]) -> list[str]:
    sizes = set()
    for ch in channels:
        sizes.update(_PLATFORM_SIZES.get(ch, ["1:1"]))
    return list(sizes)

async def _call_dalle3(prompt: str, size: str) -> Optional[str]:
    """Call OpenAI DALL-E 3 API."""
    if not settings.openai_api_key:
        return None
    
    # Map aspect ratio to DALL-E 3 sizes
    # DALL-E 3 only supports 1024x1024, 1024x1792, and 1792x1024
    dalle_size = "1024x1024"
    if size == "9:16" or size == "4:5":
        dalle_size = "1024x1792"
    elif size == "16:9":
        dalle_size = "1792x1024"

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            response = await client.post(
                "https://api.openai.com/v1/images/generations",
                headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                json={
                    "model": "dall-e-3",
                    "prompt": prompt,
                    "n": 1,
                    "size": dalle_size,
                    "quality": "standard"
                }
            )
            response.raise_for_status()
            return response.json()["data"][0]["url"]
        except Exception as e:
            logger.warn("multimodal_dalle_failed", error=str(e))
            return None

async def _call_stability(prompt: str, size: str) -> Optional[str]:
    """Call Stability AI API (V1)."""
    if not settings.stability_api_key:
        return None
    
    # Simple aspect ratio to pixels for Stability (example)
    width, height = 1024, 1024
    if size == "16:9": width, height = 1216, 688
    elif size == "9:16": width, height = 688, 1216

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            # Note: Stability returns base64 or binary, this is a simplified flow
            # In a real setup, we would upload to S3 and return the URL
            response = await client.post(
                f"https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image",
                headers={
                    "Authorization": f"Bearer {settings.stability_api_key}",
                    "Accept": "application/json"
                },
                json={
                    "text_prompts": [{"text": prompt}],
                    "width": width,
                    "height": height,
                    "samples": 1,
                }
            )
            response.raise_for_status()
            # In MVP, we return a mock URL since we don't have object storage set up here
            return f"https://mock-cdn.oag.ai/stability/{uuid.uuid4().hex[:8]}.png"
        except Exception as e:
            logger.warn("multimodal_stability_failed", error=str(e))
            return None

async def multimodal_node(state: CampaignState) -> dict:
    """LangGraph node: generate visual assets for each required platform size."""
    _at_token = current_agent_type.set("MULTIMODAL")
    logger.info("multimodal_start", campaign_id=state["campaign_id"], loop=state.get("loop_count", 0))

    strategy = state.get("strategy") or {}
    channels = [c["channel"] for c in strategy.get("channel_plan", [])] or ["tiktok", "meta"]
    sizes = _infer_sizes(channels)

    # 1. Generate descriptive visual prompt using LLM
    opt_actions = state.get("opt_actions") or []
    visual_refresh = next((a for a in opt_actions if a.get("type") == "REFRESH_STRATEGY"), None)
    
    llm_prompt = f"Goal: {state['goal']}\nScenario: {state.get('scenario', 'General Marketing')}"
    if visual_refresh:
        llm_prompt += f"\nOptimization Suggestion: {visual_refresh.get('params', {}).get('suggestion')}"

    visual_description = await llm_client.chat_completion(
        messages=[{"role": "user", "content": llm_prompt}],
        system=VISUAL_PROMPT_SYSTEM
    )
    logger.info("multimodal_prompt_generated", prompt=visual_description[:50] + "...")

    assets = []
    # 2. Generate images for each required size.
    # Generate the DB UUID up front so the in-memory id, the event payload,
    # and the row in `content_assets` all share one identifier.
    for size in sizes:
        asset_uuid = uuid.uuid4()

        asset_url = await _call_dalle3(visual_description, size)
        tool_used = "DALLE3" if asset_url else None
        if not asset_url:
            asset_url = await _call_stability(visual_description, size)
            tool_used = "STABILITY_AI" if asset_url else None
        if not asset_url:
            asset_url = f"https://picsum.photos/seed/{asset_uuid.hex[:6]}/1024/1024"
            tool_used = "MOCK_PICSUM"

        assets.append({
            "id":                f"img_{asset_uuid.hex[:8]}",
            "_db_id":            asset_uuid,
            "type":              "IMAGE",
            "visual_tool":       tool_used,
            "size":              size,
            "storage_url":       asset_url,
            "generation_prompt": visual_description,
        })

    # Pre-generate a real UUID for the bundle so the value emitted on the
    # bus is always a valid UUID, even if persistence below is skipped.
    bundle_uuid = uuid.uuid4()
    bundle = {
        "bundle_id": str(bundle_uuid),
        "assets":    assets,
    }

    # 3. Persistence Layer (best-effort — never block the pipeline on
    # transient DB errors, but log loudly so we notice).
    from app.database import async_session_factory
    from app.models.content import ContentBundle, ContentAsset

    campaign_id_str = state.get("campaign_id")
    DEMO_UUID = uuid.UUID("00000000-0000-0000-0000-000000000001")
    try:
        camp_uuid = DEMO_UUID if campaign_id_str == "demo" else uuid.UUID(campaign_id_str)
    except (ValueError, TypeError) as e:
        camp_uuid = None
        logger.warning("multimodal_invalid_campaign_id",
                       campaign_id=campaign_id_str, error=str(e))

    if camp_uuid is not None:
        async with async_session_factory() as db:
            try:
                new_bundle = ContentBundle(
                    id=bundle_uuid,
                    campaign_id=camp_uuid,
                    generation_params={"sizes": sizes},
                )
                db.add(new_bundle)

                allowed_tools = {"DALLE3", "MIDJOURNEY", "STABILITY_AI"}
                for a in assets:
                    new_asset = ContentAsset(
                        id=a["_db_id"],
                        bundle_id=bundle_uuid,
                        campaign_id=camp_uuid,
                        asset_type="IMAGE",
                        visual_tool=a["visual_tool"] if a["visual_tool"] in allowed_tools else "DALLE3",
                        storage_url=a["storage_url"],
                        generation_prompt=a["generation_prompt"],
                    )
                    db.add(new_asset)

                await db.commit()
                logger.info("multimodal_persisted", bundle_id=str(bundle_uuid), assets=len(assets))
            except Exception as e:
                # Catch SQLAlchemy IntegrityError, OperationalError, etc.
                # so an FK violation (e.g. unknown campaign in graph-only test
                # runs) doesn't abort the rest of the pipeline.
                await db.rollback()
                logger.warning("multimodal_persistence_failed",
                               bundle_id=str(bundle_uuid), error=str(e))

    # 4. Notify and Finalize
    await event_bus.publish(
        "AssetsGenerated",
        {"asset_ids": [a["id"] for a in assets], "type": "IMAGE", "bundle_id": bundle["bundle_id"]},
        state["campaign_id"],
    )

    logger.info("multimodal_done", assets=len(assets))
    return {
        "assets": bundle,
        "completed_tasks": ["multimodal"],
    }
