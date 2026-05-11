"""Aggregate all API routers into a single prefix."""
from fastapi import APIRouter

from .campaigns import router as campaigns_router
from .agents import router as agents_router
from .articles import router as articles_router
from .ws import router as ws_router
from .auth import router as auth_router
from .optimizer import router as optimizer_router
from .governance import router as governance_router
from .identity import router as identity_router
from .audit import router as audit_router

api_router = APIRouter()

api_router.include_router(campaigns_router, prefix="/v1/campaigns", tags=["Campaigns"])
api_router.include_router(agents_router,   prefix="/v1/agents",    tags=["A2A Agents"])
api_router.include_router(articles_router, prefix="/v1/articles",  tags=["Articles"])
api_router.include_router(auth_router,     prefix="/v1/auth",      tags=["Platform OAuth"])
api_router.include_router(identity_router, prefix="/v1/identity",  tags=["Identity & RBAC"])
api_router.include_router(optimizer_router, prefix="/v1/optimizer", tags=["Optimizer"])
api_router.include_router(governance_router, prefix="/v1/governance", tags=["Governance & HITL"])
api_router.include_router(audit_router,      prefix="/v1/audit",      tags=["Audit Log"])
api_router.include_router(ws_router,                               tags=["WebSocket"])
