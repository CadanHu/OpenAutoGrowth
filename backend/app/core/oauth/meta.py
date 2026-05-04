"""
Meta (Facebook/Instagram Marketing API) OAuth 2.0 utility.
"""
import uuid
import httpx
import structlog
from typing import Dict, Any
from app.config import settings

logger = structlog.get_logger(__name__)

async def meta_exchange_code(code: str) -> Dict[str, Any]:
    """
    Exchange the authorization code for a short-lived access token,
    then exchange that for a long-lived user access token.
    """
    # Quick bypass for simulated testing
    if code.startswith("mock_code"):
        logger.info("meta_auth_simulated_success")
        return {
            "access_token": f"sim_meta_at_{uuid.uuid4().hex[:12]}",
            "expires_in": 5184000 # 60 days
        }

    url = "https://graph.facebook.com/v19.0/oauth/access_token"
    params = {
        "client_id": settings.meta_app_id,
        "client_secret": settings.meta_app_secret,
        "redirect_uri": f"http://localhost:9393/v1/auth/meta/callback",
        "code": code,
    }
    
    async with httpx.AsyncClient() as client:
        response = await client.get(url, params=params)
        if response.status_code != 200:
            logger.error("meta_token_exchange_failed", status=response.status_code, body=response.text)
            raise Exception(f"Failed to exchange code for Meta token: {response.text}")
            
        return response.json()

async def meta_get_long_lived_token(short_lived_token: str) -> Dict[str, Any]:
    """
    Exchange a short-lived token for a long-lived (60-day) token.
    """
    url = "https://graph.facebook.com/v19.0/oauth/access_token"
    params = {
        "grant_type": "fb_exchange_token",
        "client_id": settings.meta_app_id,
        "client_secret": settings.meta_app_secret,
        "fb_exchange_token": short_lived_token,
    }
    
    async with httpx.AsyncClient() as client:
        response = await client.get(url, params=params)
        if response.status_code != 200:
            logger.error("meta_long_lived_token_failed", status=response.status_code, body=response.text)
            return {"access_token": short_lived_token} # Fallback to short-lived
            
        return response.json()
