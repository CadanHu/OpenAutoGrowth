"""
Multimodal Agent Node — visual asset generation.

Input:  state.strategy, state.constraints
Output: state.assets  (bundle_id + assets[])
Events: AssetsGenerated
"""
import uuid

import structlog

from app.config import settings
from app.core.event_bus import event_bus
from .state import CampaignState

logger = structlog.get_logger(__name__)

# Platform → required sizes
_PLATFORM_SIZES: dict[str, list[str]] = {
    "tiktok":  ["9:16", "1:1"],
    "meta":    ["1:1", "4:5", "16:9"],
    "google":  ["16:9", "1:1"],
    "wechat":  ["1:1"],
    "weibo":   ["16:9", "1:1"],
}

# Tool priority (descend until one succeeds)
_TOOL_PRIORITY = ["DALLE3", "STABILITY_AI", "MIDJOURNEY"]


def _infer_sizes(channels: list[str]) -> list[str]:
    sizes = set()
    for ch in channels:
        sizes.update(_PLATFORM_SIZES.get(ch, ["1:1"]))
    return list(sizes)


async def _generate_image(prompt: str, size: str, tool: str) -> dict | None:
    """
    Call image generation API.
    Production: implement DALL-E 3 / Stability AI / Midjourney adapters.
    Stub: returns placeholder asset dict.
    """
    # TODO: implement per-tool API call
    return {
        "id": f"img_{uuid.uuid4().hex[:8]}",
        "type": "IMAGE",
        "visual_tool": tool,
        "size": size,
        "storage_url": None,   # populated after upload to object storage
        "generation_prompt": prompt,
    }


async def multimodal_node(state: CampaignState) -> dict:
    """LangGraph node: generate visual assets for each required platform size."""
    logger.info("multimodal_start", campaign_id=state["campaign_id"])

    strategy = state.get("strategy") or {}
    channels = [c["channel"] for c in strategy.get("channel_plan", [])] or ["tiktok", "meta"]
    sizes = _infer_sizes(channels)

    goal_prompt = f"Marketing visual for: {state['goal'][:200]}"
    assets = []

    for size in sizes:
        for tool in _TOOL_PRIORITY:
            asset = await _generate_image(goal_prompt, size, tool)
            if asset:
                assets.append(asset)
                break

    bundle = {
        "bundle_id": f"asset_bundle_{uuid.uuid4().hex[:8]}",
        "assets": assets,
    }

    await event_bus.publish(
        "AssetsGenerated",
        {"asset_ids": [a["id"] for a in assets], "type": "IMAGE"},
        state["campaign_id"],
    )

    logger.info("multimodal_done", assets=len(assets))
    return {
        "assets": bundle,
        "completed_tasks": ["multimodal"],
    }
