"""Aggregate all API routers into a single prefix."""
from fastapi import APIRouter

from .campaigns import router as campaigns_router
from .agents import router as agents_router
from .articles import router as articles_router
from .ws import router as ws_router

api_router = APIRouter()

api_router.include_router(campaigns_router, prefix="/v1/campaigns", tags=["Campaigns"])
api_router.include_router(agents_router,   prefix="/v1/agents",    tags=["A2A Agents"])
api_router.include_router(articles_router, prefix="/v1/articles",  tags=["Articles"])
api_router.include_router(ws_router,                               tags=["WebSocket"])
