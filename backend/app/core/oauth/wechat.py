"""
WeChat (Tencent Marketing API) OAuth 2.0 utility — exchanging codes for tokens.
"""
import uuid
import httpx
import structlog
from typing import Dict, Any
from app.config import settings

logger = structlog.get_logger(__name__)

async def wechat_exchange_code(code: str) -> Dict[str, Any]:
    """
    Exchange the authorization code for an access token and a refresh token.
    Tencent Marketing API version.
    """
    # Quick bypass for simulated testing
    if code.startswith("mock_code"):
        logger.info("wechat_auth_simulated_success")
        return {
            "access_token": f"sim_at_{uuid.uuid4().hex[:12]}",
            "refresh_token": f"sim_rt_{uuid.uuid4().hex[:12]}",
            "expires_in": 86400
        }

    url = "https://api.ads.qq.com/v1.1/oauth/token"
    params = {
        "client_id": settings.wechat_ads_client_id,
        "client_secret": settings.wechat_ads_client_secret,
        "grant_type": "authorization_code",
        "authorization_code": code,
        "redirect_uri": f"http://localhost:9393/v1/auth/wechat/callback",
    }
    
    async with httpx.AsyncClient() as client:
        # Note: Tencent Ads often uses GET or POST with params for token exchange
        response = await client.get(url, params=params)
        if response.status_code != 200:
            logger.error("wechat_token_exchange_failed", status=response.status_code, body=response.text)
            # For development/demo, we might return a mock if credentials are missing
            if not settings.wechat_ads_client_id:
                logger.warning("wechat_mock_token_fallback")
                return {
                    "access_token": "mock_wechat_access_token",
                    "refresh_token": "mock_wechat_refresh_token",
                    "expires_in": 86400
                }
            raise Exception(f"Failed to exchange code for token: {response.text}")
            
        data = response.json()
        # Tencent Ads response structure might differ, normalize if needed
        # { "code": 0, "message": "", "data": { "access_token": "...", ... } }
        if data.get("code") != 0:
            logger.error("wechat_token_exchange_error_code", data=data)
            raise Exception(f"WeChat API Error: {data.get('message')}")
            
        return data.get("data", {})

async def wechat_refresh_token(refresh_token: str) -> Dict[str, Any]:
    """
    Use a refresh token to obtain a new access token.
    """
    url = "https://api.ads.qq.com/v1.1/oauth/token"
    params = {
        "client_id": settings.wechat_ads_client_id,
        "client_secret": settings.wechat_ads_client_secret,
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
    }
    
    async with httpx.AsyncClient() as client:
        response = await client.get(url, params=params)
        if response.status_code != 200:
            logger.error("wechat_token_refresh_failed", status=response.status_code, body=response.text)
            raise Exception(f"Failed to refresh token: {response.text}")
            
        data = response.json()
        if data.get("code") != 0:
            raise Exception(f"WeChat API Error: {data.get('message')}")
            
        return data.get("data", {})
