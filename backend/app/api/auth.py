"""
Auth API — Handling OAuth 2.0 flows for platform integrations.
"""
import uuid
import structlog
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.config import settings
from app.models.credential import PlatformCredential
from app.core.oauth.google import google_exchange_code
from app.core.oauth.wechat import wechat_exchange_code
from app.core.oauth.meta import meta_exchange_code, meta_get_long_lived_token
from app.core.oauth.tiktok import tiktok_exchange_code
from app.core.oauth.x import x_exchange_code
from app.core.crypto import encrypt

logger = structlog.get_logger(__name__)

router = APIRouter()

@router.get("/{platform}/authorize")
async def authorize_platform(
    platform: str,
    org_id: uuid.UUID = Query(...), # In real app, get from current_user session
    mock: bool = Query(False),
):
    """
    Step 1: Redirect user to the platform's OAuth consent page.
    """
    state = f"{platform}:{org_id}"

    # Simulation mode for testing/demo without real platform credentials
    if mock:
        logger.info("auth_mock_redirect", platform=platform, org_id=org_id)
        return RedirectResponse(
            url=f"http://localhost:9393/v1/auth/{platform}/callback?code=mock_code_123&state={state}"
        )
    
    if platform == "google":
        if not settings.google_ads_client_id:
            return RedirectResponse(url="https://ads.google.com")
        
        base_url = "https://accounts.google.com/o/oauth2/v2/auth"
        params = {
            "client_id": settings.google_ads_client_id,
            "redirect_uri": f"http://localhost:9393/v1/auth/google/callback",
            "response_type": "code",
            "scope": "https://www.googleapis.com/auth/adwords",
            "access_type": "offline",
            "prompt": "consent",
            "state": state,
        }
        query_string = "&".join(f"{k}={v}" for k, v in params.items())
        return RedirectResponse(url=f"{base_url}?{query_string}")

    elif platform == "wechat":
        # If Client ID is missing, redirect to the marketing page to help user register/configure
        if not settings.wechat_ads_client_id:
            logger.info("wechat_auth_missing_config_redirecting_to_landing")
            return RedirectResponse(url="https://e.qq.com/ads")

        # Tencent Ads (Marketing API) OAuth
        base_url = "https://ads.qq.com/oauth/authorize"
        params = {
            "client_id": settings.wechat_ads_client_id,
            "redirect_uri": f"http://localhost:9393/v1/auth/wechat/callback",
            "state": state,
            "scope": "ads_management",
            "response_type": "code",
        }
        query_string = "&".join(f"{k}={v}" for k, v in params.items())
        return RedirectResponse(url=f"{base_url}?{query_string}")

    elif platform == "meta":
        if not settings.meta_app_id:
            return RedirectResponse(url="https://www.facebook.com/business/ads")
            
        base_url = "https://www.facebook.com/v19.0/dialog/oauth"
        params = {
            "client_id": settings.meta_app_id,
            "redirect_uri": f"http://localhost:9393/v1/auth/meta/callback",
            "state": state,
            "scope": "ads_management,ads_read,business_management",
            "response_type": "code",
        }
        query_string = "&".join(f"{k}={v}" for k, v in params.items())
        return RedirectResponse(url=f"{base_url}?{query_string}")

    elif platform == "tiktok":
        if not settings.tiktok_app_id:
            return RedirectResponse(url="https://ads.tiktok.com/business/")
            
        base_url = "https://business-api.tiktok.com/portal/auth/"
        params = {
            "app_id": settings.tiktok_app_id,
            "redirect_uri": f"http://localhost:9393/v1/auth/tiktok/callback",
            "state": state,
        }
        query_string = "&".join(f"{k}={v}" for k, v in params.items())
        return RedirectResponse(url=f"{base_url}?{query_string}")

    elif platform == "x":
        if not settings.x_client_id:
            return RedirectResponse(url="https://ads.twitter.com")
            
        base_url = "https://twitter.com/i/oauth2/authorize"
        params = {
            "response_type": "code",
            "client_id": settings.x_client_id,
            "redirect_uri": f"http://localhost:9393/v1/auth/x/callback",
            "scope": "tweet.read tweet.write users.read offline.access ads.read ads.write",
            "state": state,
            "code_challenge": "challenge", # Static challenge for prototype
            "code_challenge_method": "plain",
        }
        query_string = "&".join(f"{k}={v}" for k, v in params.items())
        return RedirectResponse(url=f"{base_url}?{query_string}")
    
    raise HTTPException(status_code=400, detail=f"Platform {platform} not supported.")

@router.get("/{platform}/callback")
async def oauth_callback(
    platform: str,
    code: str = Query(None, alias="auth_code"), # TikTok uses auth_code
    state: str = Query(...),
    db: AsyncSession = Depends(get_db),
    request: Request = None
):
    """
    Step 2: Handle callback from the platform, exchange code for tokens.
    """
    # Normalize 'code' parameter as some platforms use 'code' and TikTok uses 'auth_code'
    if not code:
        code = request.query_params.get("code")

    try:
        platform_name, org_id_str = state.split(":")
        org_id = uuid.UUID(org_id_str)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid state parameter")

    if platform != platform_name:
         raise HTTPException(status_code=400, detail="Platform mismatch")

    if platform == "google":
        try:
            token_data = await google_exchange_code(code)
            
            # Encrypt tokens before saving
            access_token = encrypt(token_data["access_token"])
            refresh_token = encrypt(token_data.get("refresh_token", ""))
            
            # Save or Update Credential
            cred = PlatformCredential(
                org_id=org_id,
                platform="GOOGLE",
                access_token=access_token,
                refresh_token=refresh_token,
                status="ACTIVE"
            )
            db.add(cred)
            await db.commit()
            
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    elif platform == "wechat":
        try:
            token_data = await wechat_exchange_code(code)
            
            access_token = encrypt(token_data["access_token"])
            refresh_token = encrypt(token_data.get("refresh_token", ""))
            
            cred = PlatformCredential(
                org_id=org_id,
                platform="WECHAT",
                access_token=access_token,
                refresh_token=refresh_token,
                status="ACTIVE"
            )
            db.add(cred)
            await db.commit()
            
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    elif platform == "meta":
        try:
            # 1. Exchange code for short-lived token
            token_data = await meta_exchange_code(code)
            short_token = token_data["access_token"]
            
            # 2. Exchange for long-lived token (if not in mock mode)
            if not code.startswith("mock_code"):
                long_token_data = await meta_get_long_lived_token(short_token)
                final_token = long_token_data["access_token"]
            else:
                final_token = short_token
                
            access_token = encrypt(final_token)
            
            cred = PlatformCredential(
                org_id=org_id,
                platform="META",
                access_token=access_token,
                status="ACTIVE"
            )
            db.add(cred)
            await db.commit()
            
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    elif platform == "tiktok":
        try:
            token_data = await tiktok_exchange_code(code)
            
            access_token = encrypt(token_data["access_token"])
            
            cred = PlatformCredential(
                org_id=org_id,
                platform="TIKTOK",
                access_token=access_token,
                status="ACTIVE"
            )
            db.add(cred)
            await db.commit()
            
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    elif platform == "x":
        try:
            token_data = await x_exchange_code(code)
            
            access_token = encrypt(token_data["access_token"])
            refresh_token = encrypt(token_data.get("refresh_token", ""))
            
            cred = PlatformCredential(
                org_id=org_id,
                platform="X",
                access_token=access_token,
                refresh_token=refresh_token,
                status="ACTIVE"
            )
            db.add(cred)
            await db.commit()
            
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


    return RedirectResponse(url=f"{settings.cors_origins[0]}/#/integrations?status=success")

@router.get("/integrations")
async def list_integrations(
    org_id: uuid.UUID = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """
    List active integrations for an organization.
    """
    from sqlalchemy import select
    result = await db.execute(
        select(PlatformCredential).where(PlatformCredential.org_id == org_id)
    )
    creds = result.scalars().all()
    
    return [
        {
            "platform": c.platform.lower(),
            "status": c.status,
            "updated_at": c.updated_at.isoformat() if c.updated_at else None
        }
        for c in creds
    ]

@router.delete("/integrations/{platform}")
async def disconnect_platform(
    platform: str,
    org_id: uuid.UUID = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Remove platform credentials from the database.
    """
    from sqlalchemy import delete
    await db.execute(
        delete(PlatformCredential)
        .where(PlatformCredential.org_id == org_id)
        .where(PlatformCredential.platform == platform.upper())
    )
    await db.commit()
    return {"success": True}
