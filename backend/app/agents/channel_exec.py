"""
ChannelExec Agent Node — multi-platform ad deployment.

Input:  state.strategy, state.content, state.assets
Output: state.deployed_ads  (platforms[], ad_ids[])
Events: AdDeployed
"""
from datetime import datetime, timezone
import uuid

import httpx
import structlog

from app.config import settings
from app.core.event_bus import event_bus
from .state import CampaignState

logger = structlog.get_logger(__name__)


# ── Platform Adapters (stubs — replace with real SDKs) ────────────────────────

class MetaAdapter:
    async def deploy(self, channel_config: dict, content: dict, assets: dict) -> list[str]:
        """TODO: facebook-business SDK"""
        logger.info("meta_deploy_stub", budget=channel_config.get("budget"))
        return [f"meta_ad_{uuid.uuid4().hex[:8]}"]


class TikTokAdapter:
    async def deploy(self, channel_config: dict, content: dict, assets: dict) -> list[str]:
        """TODO: TikTok Marketing API SDK"""
        logger.info("tiktok_deploy_stub", budget=channel_config.get("budget"))
        return [f"tiktok_ad_{uuid.uuid4().hex[:8]}"]


class GoogleAdapter:
    async def deploy(self, channel_config: dict, content: dict, assets: dict) -> list[str]:
        """TODO: google-ads-python SDK"""
        logger.info("google_deploy_stub", budget=channel_config.get("budget"))
        return [f"google_ad_{uuid.uuid4().hex[:8]}"]


class ZhihuAdapter:
    async def deploy(self, channel_config: dict, content: dict, assets: dict) -> list[str]:
        """Deploy article to Zhihu."""
        logger.info("zhihu_deploy_start")

        if not settings.zhihu_cookie:
            logger.warning("zhihu_no_cookie_configured")
            return ["zhihu_failed_no_cookie"]

        # In MVP, we simulate the network call to Zhihu's internal API
        # Actual implementation would use httpx to POST to https://zhuanlan.zhihu.com/api/articles
        # with the provided Cookie and Markdown content converted to Zhihu's format.

        async with httpx.AsyncClient() as client:
            # Placeholder for actual Zhihu API interaction
            # For MVP/Safety, we log the intent and return a simulated ID
            logger.info("zhihu_article_published_simulated",
                        title=content.get("variants", [{}])[0].get("title"))

        return [f"zhihu_art_{uuid.uuid4().hex[:8]}"]


_ADAPTERS = {
    "meta":   MetaAdapter(),
    "tiktok": TikTokAdapter(),
    "google": GoogleAdapter(),
    "zhihu":  ZhihuAdapter(),
}


async def channel_exec_node(state: CampaignState) -> dict:
    """LangGraph node: deploy ads across all channels in the strategy."""
    logger.info("channel_exec_start", campaign_id=state["campaign_id"])

    strategy = state.get("strategy") or {}
    content  = state.get("content")  or {}
    assets   = state.get("assets")   or {}

    all_ad_ids: list[str] = []
    deployed_platforms: list[str] = []
    errors: list[dict] = []

    for ch_config in strategy.get("channel_plan", []):
        channel = ch_config["channel"]
        adapter = _ADAPTERS.get(channel)

        if adapter is None:
            logger.warning("channel_exec_no_adapter", channel=channel)
            errors.append({"channel": channel, "error": "no adapter available"})
            continue

        try:
            ad_ids = await adapter.deploy(ch_config, content, assets)
            all_ad_ids.extend(ad_ids)
            deployed_platforms.append(channel)
        except Exception as exc:
            logger.error("channel_exec_deploy_error", channel=channel, error=str(exc))
            errors.append({"channel": channel, "error": str(exc)})

    deployed = {
        "platforms": deployed_platforms,
        "ad_ids": all_ad_ids,
        "deployed_at": datetime.now(timezone.utc).isoformat(),
    }

    await event_bus.publish(
        "AdDeployed",
        {"platforms": deployed_platforms, "ad_ids": all_ad_ids},
        state["campaign_id"],
    )

    logger.info("channel_exec_done", platforms=deployed_platforms, ads=len(all_ad_ids))
    return {
        "deployed_ads": deployed,
        "status": "DEPLOYED",
        "errors": errors,
        "completed_tasks": ["channel_exec"],
    }
