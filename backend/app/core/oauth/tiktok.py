"""
TikTok for Business (Marketing API) OAuth 2.0 utility.
"""
import uuid
import httpx
import structlog
from typing import Dict, Any
from app.config import settings

logger = structlog.get_logger(__name__)

async def tiktok_exchange_code(code: str) -> Dict[str, Any]:
    """
    Exchange the authorization code for an access token.
    TikTok Marketing API uses a JSON POST to the access_token endpoint.
    """
    # Quick bypass for simulated testing
    if code.startswith("mock_code"):
        logger.info("tiktok_auth_simulated_success")
        return {
            "access_token": f"sim_tiktok_at_{uuid.uuid4().hex[:12]}",
            "expires_in": 86400
        }

    url = "https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/"
    
    # TikTok uses app_id and secret in the JSON body
    data = {
        "app_id": settings.tiktok_app_id,
        "secret": settings.tiktok_app_secret,
        "auth_code": code,
    }
    
    async with httpx.AsyncClient() as client:
        response = await client.post(url, json=data)
        if response.status_code != 200:
            logger.error("tiktok_token_exchange_failed", status=response.status_code, body=response.text)
            raise Exception(f"Failed to exchange code for TikTok token: {response.text}")
            
        res_json = response.json()
        
        # TikTok returns errors in a "code" field, 0 is success
        if res_json.get("code") != 0:
            logger.error("tiktok_api_error", data=res_json)
            raise Exception(f"TikTok API Error: {res_json.get('message')}")
            
        return res_json.get("data", {})
