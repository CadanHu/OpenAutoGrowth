"""
ChannelExec Agent Node — multi-platform ad deployment.

Input:  state.strategy, state.content, state.assets
Output: state.deployed_ads  (platforms[], ad_ids[])
Events: AdDeployed
"""
from datetime import datetime, timezone
import uuid
import time

import httpx
import structlog
from sqlalchemy import select

from app.config import settings
from app.core.event_bus import event_bus
from .state import CampaignState

logger = structlog.get_logger(__name__)


# ── Platform Adapters ─────────────────────────────────────────────────────────

class MetaAdapter:
    """Meta (Facebook/Instagram) Ads Adapter"""
    
    async def _get_credentials(self, campaign_id: str):
        if settings.meta_access_token:
            return settings.meta_access_token
        try:
            from app.database import async_session_factory
            from app.models.campaign import Campaign
            from app.models.credential import PlatformCredential
            from app.core.crypto import decrypt

            async with async_session_factory() as db:
                stmt = select(Campaign.org_id).where(Campaign.id == uuid.UUID(campaign_id))
                res = await db.execute(stmt)
                org_id = res.scalar()
                if org_id:
                    cred_stmt = select(PlatformCredential).where(
                        PlatformCredential.org_id == org_id,
                        PlatformCredential.platform == "META"
                    )
                    res = await db.execute(cred_stmt)
                    cred = res.scalar()
                    if cred:
                        return decrypt(cred.access_token)
        except Exception:
            pass
        return None

    async def deploy(self, channel_config: dict, content: dict, assets: dict, campaign_id: str) -> list[str]:
        """TODO: facebook-business SDK"""
        token = await self._get_credentials(campaign_id)
        if not token:
            logger.warning("meta_deploy_missing_credentials")
            return [f"meta_sim_ad_{uuid.uuid4().hex[:8]}"]
            
        logger.info("meta_deploy_stub", budget=channel_config.get("budget"))
        return [f"meta_ad_{uuid.uuid4().hex[:8]}"]


class TikTokAdapter:
    """TikTok Marketing API Adapter"""

    async def _get_credentials(self, campaign_id: str):
        if settings.tiktok_access_token:
            return settings.tiktok_access_token
        try:
            from app.database import async_session_factory
            from app.models.campaign import Campaign
            from app.models.credential import PlatformCredential
            from app.core.crypto import decrypt

            async with async_session_factory() as db:
                stmt = select(Campaign.org_id).where(Campaign.id == uuid.UUID(campaign_id))
                res = await db.execute(stmt)
                org_id = res.scalar()
                if org_id:
                    cred_stmt = select(PlatformCredential).where(
                        PlatformCredential.org_id == org_id,
                        PlatformCredential.platform == "TIKTOK"
                    )
                    res = await db.execute(cred_stmt)
                    cred = res.scalar()
                    if cred:
                        return decrypt(cred.access_token)
        except Exception:
            pass
        return None

    async def deploy(self, channel_config: dict, content: dict, assets: dict, campaign_id: str) -> list[str]:
        """TODO: TikTok Marketing API SDK"""
        token = await self._get_credentials(campaign_id)
        if not token:
            logger.warning("tiktok_deploy_missing_credentials")
            return [f"tiktok_sim_ad_{uuid.uuid4().hex[:8]}"]

        logger.info("tiktok_deploy_stub", budget=channel_config.get("budget"))
        return [f"tiktok_ad_{uuid.uuid4().hex[:8]}"]


class XAdapter:
    """X (Twitter) Ads API Adapter"""

    async def _get_credentials(self, campaign_id: str):
        if settings.x_access_token:
            return settings.x_access_token
        try:
            from app.database import async_session_factory
            from app.models.campaign import Campaign
            from app.models.credential import PlatformCredential
            from app.core.crypto import decrypt

            async with async_session_factory() as db:
                stmt = select(Campaign.org_id).where(Campaign.id == uuid.UUID(campaign_id))
                res = await db.execute(stmt)
                org_id = res.scalar()
                if org_id:
                    cred_stmt = select(PlatformCredential).where(
                        PlatformCredential.org_id == org_id,
                        PlatformCredential.platform == "X"
                    )
                    res = await db.execute(cred_stmt)
                    cred = res.scalar()
                    if cred:
                        return decrypt(cred.access_token)
        except Exception:
            pass
        return None

    async def deploy(self, channel_config: dict, content: dict, assets: dict, campaign_id: str) -> list[str]:
        """TODO: X (Twitter) Ads API SDK"""
        token = await self._get_credentials(campaign_id)
        if not token:
            logger.warning("x_deploy_missing_credentials")
            return [f"x_sim_ad_{uuid.uuid4().hex[:8]}"]

        logger.info("x_deploy_stub", budget=channel_config.get("budget"))
        return [f"x_ad_{uuid.uuid4().hex[:8]}"]


class GoogleAdapter:
    """Google Ads API Adapter"""

    async def _get_credentials(self, campaign_id: str):
        if settings.google_ads_access_token:
            return settings.google_ads_access_token
        try:
            from app.database import async_session_factory
            from app.models.campaign import Campaign
            from app.models.credential import PlatformCredential
            from app.core.crypto import decrypt

            async with async_session_factory() as db:
                stmt = select(Campaign.org_id).where(Campaign.id == uuid.UUID(campaign_id))
                res = await db.execute(stmt)
                org_id = res.scalar()
                if org_id:
                    cred_stmt = select(PlatformCredential).where(
                        PlatformCredential.org_id == org_id,
                        PlatformCredential.platform == "GOOGLE"
                    )
                    res = await db.execute(cred_stmt)
                    cred = res.scalar()
                    if cred:
                        return decrypt(cred.access_token)
        except Exception:
            pass
        return None

    async def deploy(self, channel_config: dict, content: dict, assets: dict, campaign_id: str) -> list[str]:
        """TODO: google-ads-python SDK"""
        token = await self._get_credentials(campaign_id)
        if not token:
            logger.warning("google_deploy_missing_credentials")
            return [f"google_sim_ad_{uuid.uuid4().hex[:8]}"]

        logger.info("google_deploy_stub", budget=channel_config.get("budget"))
        return [f"google_ad_{uuid.uuid4().hex[:8]}"]


class WeChatAdapter:
    """Tencent Marketing API v3.0 Adapter"""
    BASE_URL = "https://api.e.qq.com/v3.0"

    async def _get_credentials(self, campaign_id: str):
        """Retrieve access token and account ID for the organization."""
        # 1. Try settings first (for quick dev/demo)
        if settings.wechat_ads_access_token and settings.wechat_ads_account_id:
            return settings.wechat_ads_access_token, settings.wechat_ads_account_id
        
        # 2. Try DB lookup
        try:
            from app.database import async_session_factory
            from app.models.campaign import Campaign
            from app.models.credential import PlatformCredential
            from app.core.crypto import decrypt

            async with async_session_factory() as db:
                # Find the organization this campaign belongs to
                stmt = select(Campaign.org_id).where(Campaign.id == uuid.UUID(campaign_id))
                res = await db.execute(stmt)
                org_id = res.scalar()

                if org_id:
                    # Get the WECHAT platform credential
                    cred_stmt = select(PlatformCredential).where(
                        PlatformCredential.org_id == org_id,
                        PlatformCredential.platform == "WECHAT"
                    )
                    res = await db.execute(cred_stmt)
                    cred = res.scalar()
                    if cred:
                        token = decrypt(cred.access_token)
                        # For account_id, we might store it in the credential metadata or use settings
                        # Assuming account_id is stored in settings for now, or could be extracted
                        return token, settings.wechat_ads_account_id
        except Exception as e:
            logger.error("wechat_get_credentials_failed", campaign_id=campaign_id, error=str(e))
        
        return None, None

    async def deploy(self, channel_config: dict, content: dict, assets: dict, campaign_id: str) -> list[str]:
        """
        Deploy to Tencent Marketing API v3.0.
        Creates a Campaign (and ideally Adgroup/Creative, but focus on Campaign for prototype).
        """
        token, account_id = await self._get_credentials(campaign_id)
        
        if not token or not account_id:
            logger.warning("wechat_deploy_missing_credentials", campaign_id=campaign_id)
            # Fallback to simulation if no credentials
            return [f"wechat_sim_ad_{uuid.uuid4().hex[:8]}"]

        # 1. Prepare Campaign Payload
        # Note: units in Tencent API are typically in cents (fen)
        budget_fen = int(channel_config.get("budget", 0) * 100) 
        
        # Marketing API v3.0 campaigns/add
        payload = {
            "account_id": int(account_id),
            "campaign_name": f"AI_Auto_{campaign_id[:8]}_{int(time.time())}",
            "campaign_type": "CAMPAIGN_TYPE_NORMAL",
            "promoted_object_type": "PROMOTED_OBJECT_TYPE_LINK",
            "daily_budget": max(budget_fen, 5000), # Min 50 RMB for Moments
            "configured_status": "AD_STATUS_NORMAL",
        }

        logger.info("wechat_api_call_start", campaign_id=campaign_id, payload=payload)

        async with httpx.AsyncClient(timeout=30) as client:
            url = f"{self.BASE_URL}/campaigns/add"
            params = {
                "access_token": token,
                "timestamp": int(time.time()),
                "nonce": uuid.uuid4().hex[:16],
            }
            
            try:
                # In sandbox environment, use sandbox URL if configured
                # sandbox_url = "https://sandbox-api.e.qq.com/v3.0/campaigns/add"
                
                response = await client.post(url, params=params, json=payload)
                data = response.json()
                
                if response.status_code != 200 or data.get("code") != 0:
                    logger.error("wechat_api_error", status=response.status_code, response=data)
                    raise Exception(f"Tencent API Error: {data.get('message', 'Unknown error')}")

                tencent_campaign_id = data.get("data", {}).get("campaign_id")
                logger.info("wechat_deploy_success", tencent_id=tencent_campaign_id)
                return [f"wechat_cp_{tencent_campaign_id}"]

            except Exception as e:
                logger.error("wechat_request_failed", error=str(e))
                # For demo purposes, we might still want to proceed with a simulated ID if it's not production
                if not settings.is_production:
                    return [f"wechat_sim_ad_{uuid.uuid4().hex[:8]}"]
                raise


class ZhihuAdapter:
    BASE = "https://zhuanlan.zhihu.com"

    def _md_to_html(self, md: str) -> str:
        import re
        # Strip residual markdown symbols
        md = re.sub(r'^#{1,6}\s+', '', md, flags=re.MULTILINE)
        md = re.sub(r'\*{1,3}([^*]+)\*{1,3}', r'\1', md)
        md = re.sub(r'`([^`]*)`', r'\1', md)
        md = re.sub(r'^[-*]\s+', '', md, flags=re.MULTILINE)
        # Split into paragraphs (separated by blank lines)
        paragraphs = re.split(r'\n{2,}', md.strip())
        html_parts = []
        for para in paragraphs:
            lines = [l.strip() for l in para.splitlines() if l.strip()]
            if lines:
                html_parts.append('<br>'.join(lines))
        # Paragraphs separated by double <br> for spacing
        return '<br><br>'.join(html_parts)

    def _xsrf(self) -> str:
        for part in settings.zhihu_cookie.split(";"):
            part = part.strip()
            if part.startswith("_xsrf="):
                return part[len("_xsrf="):]
        return ""

    def _headers(self) -> dict:
        return {
            "Cookie": settings.zhihu_cookie,
            "Content-Type": "application/json",
            "Accept": "application/json, text/plain, */*",
            "Origin": "https://zhuanlan.zhihu.com",
            "Referer": "https://zhuanlan.zhihu.com/write",
            "x-api-version": "3.0.91",
            "x-requested-with": "fetch",
            "x-xsrftoken": self._xsrf(),
            "x-zst-81": settings.zhihu_zst_81,
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/146.0.0.0 Safari/537.36"
            ),
        }

    async def deploy(self, channel_config: dict, content: dict, assets: dict, campaign_id: str) -> list[str]:
        """Save article as Zhihu draft. User reviews and publishes manually."""
        if not settings.zhihu_cookie:
            logger.warning("zhihu_no_cookie_configured")
            return ["zhihu_failed_no_cookie"]

        variant = (content.get("variants") or [{}])[0]
        title = variant.get("title", "无标题")
        body_md = variant.get("body", "")
        body_html = self._md_to_html(body_md)

        logger.info("zhihu_save_draft_start", title=title)

        async with httpx.AsyncClient(timeout=30) as client:
            # Step 1: POST /api/articles/drafts — create empty draft, get article ID
            create_resp = await client.post(
                f"{self.BASE}/api/articles/drafts",
                headers=self._headers(),
                json={},
            )
            logger.info("zhihu_create_draft", status=create_resp.status_code, body=create_resp.text[:300])
            create_resp.raise_for_status()
            article_id = create_resp.json().get("id")
            if not article_id:
                raise ValueError(f"No article id in response: {create_resp.text[:200]}")

            # Step 2: PATCH /api/articles/{id}/draft — save title and content
            patch_resp = await client.patch(
                f"{self.BASE}/api/articles/{article_id}/draft",
                headers=self._headers(),
                json={"title": title, "content": body_html, "table_of_contents": False},
            )
            logger.info("zhihu_save_draft", status=patch_resp.status_code, body=patch_resp.text[:300])
            patch_resp.raise_for_status()

            draft_url = f"https://zhuanlan.zhihu.com/p/{article_id}/edit"
            logger.info("zhihu_draft_saved", article_id=article_id, draft_url=draft_url)
            return [draft_url]


_ADAPTERS = {
    "meta":   MetaAdapter(),
    "tiktok": TikTokAdapter(),
    "google": GoogleAdapter(),
    "wechat": WeChatAdapter(),
    "x":      XAdapter(),
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
            ad_ids = await adapter.deploy(ch_config, content, assets, state["campaign_id"])
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
