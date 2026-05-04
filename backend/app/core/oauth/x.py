"""
X (formerly Twitter) OAuth 2.0 utility.
"""
import uuid
import base64
import httpx
import structlog
from typing import Dict, Any
from app.config import settings

logger = structlog.get_logger(__name__)

async def x_exchange_code(code: str) -> Dict[str, Any]:
    """
    Exchange the authorization code for an access token.
    X OAuth 2.0 uses Basic Auth for the token request.
    """
    # Quick bypass for simulated testing
    if code.startswith("mock_code"):
        logger.info("x_auth_simulated_success")
        return {
            "access_token": f"sim_x_at_{uuid.uuid4().hex[:12]}",
            "refresh_token": f"sim_x_rt_{uuid.uuid4().hex[:12]}",
            "expires_in": 7200
        }

    url = "https://api.twitter.com/2/oauth2/token"
    
    # X OAuth 2.0 requires Basic Auth: base64(client_id:client_secret)
    auth_str = f"{settings.x_client_id}:{settings.x_client_secret}"
    auth_bytes = base64.b64encode(auth_str.encode("utf-8")).decode("utf-8")
    
    headers = {
        "Authorization": f"Basic {auth_bytes}",
        "Content-Type": "application/x-www-form-urlencoded",
    }
    
    data = {
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": f"http://localhost:9393/v1/auth/x/callback",
        "code_verifier": "challenge", # PKCE verifier (needs to match what was sent in authorize)
    }
    
    async with httpx.AsyncClient() as client:
        response = await client.post(url, headers=headers, data=data)
        if response.status_code != 200:
            logger.error("x_token_exchange_failed", status=response.status_code, body=response.text)
            raise Exception(f"Failed to exchange code for X token: {response.text}")
            
        return response.json()
