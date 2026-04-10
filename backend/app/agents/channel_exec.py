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
    BASE = "https://zhuanlan.zhihu.com"

    def _md_to_html(self, md: str) -> str:
        import markdown as md_lib
        return md_lib.markdown(
            md,
            extensions=["tables", "fenced_code", "nl2br"],
        )

    def _headers(self) -> dict:
        return {
            "Cookie": settings.zhihu_cookie,
            "Content-Type": "application/json",
            "Accept": "application/json, text/plain, */*",
            "Origin": "https://zhuanlan.zhihu.com",
            "Referer": "https://zhuanlan.zhihu.com/write",
            "x-api-version": "3.0.91",
            "x-requested-with": "fetch",
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/146.0.0.0 Safari/537.36"
            ),
        }

    async def deploy(self, channel_config: dict, content: dict, assets: dict) -> list[str]:
        if not settings.zhihu_cookie:
            logger.warning("zhihu_no_cookie_configured")
            return ["zhihu_failed_no_cookie"]

        variant = (content.get("variants") or [{}])[0]
        title = variant.get("title", "无标题")
        body_md = variant.get("body", "")
        body_html = self._md_to_html(body_md)

        logger.info("zhihu_deploy_start", title=title)

        async with httpx.AsyncClient(timeout=30) as client:
            # Step 1: create draft
            create_resp = await client.post(
                f"{self.BASE}/api/articles",
                headers=self._headers(),
                json={"title": title, "content": body_html, "table_of_contents": False},
            )
            logger.info("zhihu_create_draft", status=create_resp.status_code,
                        body=create_resp.text[:300])
            create_resp.raise_for_status()
            article_id = create_resp.json().get("id")
            if not article_id:
                raise ValueError(f"No article id in response: {create_resp.text[:200]}")

            # Step 2: publish
            pub_resp = await client.put(
                f"{self.BASE}/api/articles/{article_id}/publish",
                headers=self._headers(),
                json={"title": title, "content": body_html,
                      "topics": [], "table_of_contents": False},
            )
            logger.info("zhihu_publish", status=pub_resp.status_code,
                        body=pub_resp.text[:300])
            pub_resp.raise_for_status()

            url = f"https://zhuanlan.zhihu.com/p/{article_id}"
            logger.info("zhihu_published_ok", article_id=article_id, url=url)
            return [f"zhihu_{article_id}"]


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
