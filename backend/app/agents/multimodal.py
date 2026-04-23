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
from app.core.llm import llm_client
from .state import CampaignState

logger = structlog.get_logger(__name__)

# Platform → required sizes
_PLATFORM_SIZES: dict[str, list[str]] = {
    "tiktok":  ["9:16", "1:1"],
    "meta":    ["1:1", "4:5", "16:9"],
    "google":  ["16:9", "1:1"],
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
    # 2. Generate images for each required size
    for size in sizes:
        asset_url = None
        tool_used = "NONE"
        
        # Try DALL-E 3
        asset_url = await _call_dalle3(visual_description, size)
        if asset_url:
            tool_used = "DALLE3"
        else:
            # Fallback to Stability
            asset_url = await _call_stability(visual_description, size)
            if asset_url:
                tool_used = "STABILITY_AI"
            else:
                # Mock fallback for development if no keys provided
                asset_url = f"https://picsum.photos/seed/{uuid.uuid4().hex[:6]}/1024/1024"
                tool_used = "MOCK_PICSUM"

        assets.append({
            "id": f"img_{uuid.uuid4().hex[:8]}",
            "type": "IMAGE",
            "visual_tool": tool_used,
            "size": size,
            "storage_url": asset_url,
            "generation_prompt": visual_description,
        })

    bundle = {
        "bundle_id": f"asset_bundle_{uuid.uuid4().hex[:8]}",
        "assets": assets,
    }

    # 3. Notify and Persist
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
