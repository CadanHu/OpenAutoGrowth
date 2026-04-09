"""
OpenAutoGrowth — FastAPI Application Entry Point
Backend port: 9393
"""
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.api.router import api_router

logger = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown lifecycle hooks."""
    logger.info("starting_up", env=settings.app_env, port=settings.app_port)

    # ── Startup ───────────────────────────────────────────────────
    # 1. Verify DB connectivity
    from app.database import engine
    async with engine.connect() as conn:
        await conn.execute(__import__("sqlalchemy").text("SELECT 1"))
    logger.info("database_connected")

    # 2. Verify Redis connectivity
    import redis.asyncio as aioredis
    redis_client = aioredis.from_url(settings.redis_url)
    await redis_client.ping()
    await redis_client.aclose()
    logger.info("redis_connected")

    # 3. Initialize EventBus subscription
    from app.core.event_bus import event_bus
    await event_bus.connect()
    logger.info("event_bus_ready")

    logger.info("openautogrowth_ready", agents=8, port=settings.app_port)
    yield

    # ── Shutdown ──────────────────────────────────────────────────
    await event_bus.disconnect()
    await engine.dispose()
    logger.info("shutdown_complete")


app = FastAPI(
    title="OpenAutoGrowth API",
    description="AI Multi-Agent Closed-Loop Growth Engine",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routes ────────────────────────────────────────────────────────────────────
app.include_router(api_router)


# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/health", tags=["System"])
async def health():
    return {"status": "ok", "version": "1.0.0", "env": settings.app_env}


@app.get("/health/agents", tags=["System"])
async def health_agents():
    agents = [
        "planner", "strategy", "content_gen", "multimodal",
        "channel_exec", "analysis", "optimizer",
    ]
    return {"agents": {name: "ready" for name in agents}}
