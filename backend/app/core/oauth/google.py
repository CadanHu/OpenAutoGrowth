"""
Google OAuth 2.0 utility — exchanging codes for tokens.
"""
import httpx
import structlog
from typing import Dict, Any
from app.config import settings

logger = structlog.get_logger(__name__)

async def google_exchange_code(code: str) -> Dict[str, Any]:
    """
    Exchange the authorization code for an access token and a refresh token.
    """
    # Quick bypass for simulated testing
    if code.startswith("mock_code"):
        return {
            "access_token": "mock_google_access_token",
            "refresh_token": "mock_google_refresh_token",
            "expires_in": 3600
        }

    url = "https://oauth2.googleapis.com/token"
    data = {
        "code": code,
        "client_id": settings.google_ads_client_id,
        "client_secret": settings.google_ads_client_secret,
        "redirect_uri": f"http://localhost:9393/v1/auth/google/callback",
        "grant_type": "authorization_code",
    }
    
    async with httpx.AsyncClient() as client:
        response = await client.post(url, data=data)
        if response.status_code != 200:
            logger.error("google_token_exchange_failed", status=response.status_code, body=response.text)
            raise Exception(f"Failed to exchange code for token: {response.text}")
            
        return response.json()

async def google_refresh_token(refresh_token: str) -> Dict[str, Any]:
    """
    Use a refresh token to obtain a new access token.
    """
    url = "https://oauth2.googleapis.com/token"
    data = {
        "refresh_token": refresh_token,
        "client_id": settings.google_ads_client_id,
        "client_secret": settings.google_ads_client_secret,
        "grant_type": "refresh_token",
    }
    
    async with httpx.AsyncClient() as client:
        response = await client.post(url, data=data)
        if response.status_code != 200:
            logger.error("google_token_refresh_failed", status=response.status_code, body=response.text)
            raise Exception(f"Failed to refresh token: {response.text}")
            
        return response.json()
