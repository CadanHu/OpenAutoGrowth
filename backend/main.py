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

    # 4. Ensure newly-introduced tables exist without forcing a manual
    #    `python init_db.py` run. This is idempotent — create_all is a
    #    no-op for tables already present. Lets feature commits that add
    #    a single small table ship without dragging operators into a
    #    migration step.
    from app.database import Base
    import app.models  # noqa: F401 — registers ORM
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("schema_ensured")

    # 5. Install the audit-log SQLAlchemy listener so every governance/
    #    campaign write lands in audit_log automatically.
    from app.core.audit import install as install_audit
    install_audit()

    # 6. Phase 1B backfill: any pre-1B row without a tenant_id gets
    #    associated with the default organization so tenant scoping has
    #    something to match against. Idempotent — runs every boot.
    from sqlalchemy import text as _sql_text
    default_tenant = "00000000-0000-0000-0000-000000000001"
    async with engine.begin() as conn:
        # Idempotent column additions for Phase 2 notification prefs.
        # `create_all` does not migrate existing tables — without these
        # ALTERs the User model would diverge from the schema.
        for col, ddl in (
            ("slack_webhook",        "VARCHAR(500)"),
            ("dingtalk_webhook",     "VARCHAR(500)"),
            ("dingtalk_secret",      "VARCHAR(200)"),
            ("notify_channels_disabled", "VARCHAR(200)"),
        ):
            await conn.execute(_sql_text(
                f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {col} {ddl}"
            ))

        # Phase 3 — SLA escalation columns.
        await conn.execute(_sql_text(
            "ALTER TABLE governance_rules ADD COLUMN IF NOT EXISTS default_decision VARCHAR(20)"
        ))
        await conn.execute(_sql_text(
            "ALTER TABLE revision_tasks ADD COLUMN IF NOT EXISTS escalation_level INTEGER NOT NULL DEFAULT 0"
        ))
        await conn.execute(_sql_text(
            "ALTER TABLE revision_tasks ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ"
        ))
        # Backfill safe defaults on the seeded rules.
        await conn.execute(_sql_text("""
            UPDATE governance_rules SET default_decision='REJECT'
            WHERE code IN ('finance_high_budget','legal_cross_border','brand_first_creative')
              AND default_decision IS NULL
        """))
        await conn.execute(_sql_text("""
            UPDATE governance_rules SET default_decision='APPROVE'
            WHERE code='director_loop_escalation' AND default_decision IS NULL
        """))

        for tbl in (
            "users", "governance_rules",
            "revision_cases", "revision_tasks", "user_governance_roles",
        ):
            await conn.execute(_sql_text(
                f"UPDATE {tbl} SET tenant_id = :t WHERE tenant_id IS NULL"
            ), {"t": default_tenant})
        # campaigns use `org_id`, same concept. Without this, every existing
        # campaign would be invisible under tenant-scoped queries.
        await conn.execute(_sql_text(
            "UPDATE campaigns SET org_id = :t WHERE org_id IS NULL"
        ), {"t": default_tenant})

        # Sample governance rules (idempotent on `code`). These give the
        # LEGAL / MARKETING_DIRECTOR roles real work — without them the
        # gate nodes for those stages always pass-through, even when users
        # hold the role.
        _SAMPLE_RULES = [
            (
                "legal_cross_border",
                "Legal review — cross-border campaign",
                "Requires Legal sign-off when the campaign targets a region outside its home market.",
                '{"regions_outside_home": true}',
                "LEGAL",
                "channel_exec",
                48,
            ),
            (
                "director_loop_escalation",
                "Director escalation — KPI not met after 2 loops",
                "Marketing Director must approve continued optimization once the campaign has run two full loops without hitting its KPI target.",
                '{"loop_count_gte": 2, "kpi_met": false}',
                "MARKETING_DIRECTOR",
                "optimizer",
                12,
            ),
            (
                "brand_first_creative",
                "Brand review — new-launch creative",
                "Brand lead must sign off on creative for any campaign whose goal mentions a launch, rebranding, or new product introduction.",
                '{"goal_contains": ["launch", "首发", "新品", "rebrand", "上新", "发布"]}',
                "BRAND_LEAD",
                "reviewer",
                24,
            ),
        ]
        for code, name, desc, when_json, role, stage, sla in _SAMPLE_RULES:
            await conn.execute(_sql_text("""
                INSERT INTO governance_rules
                    (id, code, name, description, "when", require_role, stage_before, sla_hours, enabled, tenant_id)
                VALUES
                    (gen_random_uuid(), :code, :name, :desc, CAST(:wj AS jsonb), :role, :stage, :sla, TRUE, :tenant)
                ON CONFLICT (code) DO NOTHING
            """), {
                "code": code, "name": name, "desc": desc, "wj": when_json,
                "role": role, "stage": stage, "sla": sla, "tenant": default_tenant,
            })

    logger.info("tenant_backfill_complete", tenant=default_tenant)

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

# ── Audit-context middleware ──────────────────────────────────────────────────
# Decodes the bearer token (best-effort) and stashes the actor + request
# meta in ContextVars so the audit listener can read them without each
# handler having to plumb identity through every DB write.
from starlette.middleware.base import BaseHTTPMiddleware
from app.core.audit import current_actor, current_request_meta
from app.core.security import decode_token
from app.core.tenant import set_tenant_from_jwt, current_tenant_id


class AuditContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        actor_token = None
        meta_token = None
        tenant_token = None
        try:
            auth = request.headers.get("authorization") or ""
            if auth.lower().startswith("bearer "):
                try:
                    payload = decode_token(auth.split(" ", 1)[1])
                    if payload.get("type") == "access":
                        actor_token = current_actor.set(payload)
                        tenant_token = set_tenant_from_jwt(payload)
                except Exception:
                    pass
            meta_token = current_request_meta.set({
                "ip": request.client.host if request.client else None,
                "user_agent": request.headers.get("user-agent"),
            })
            return await call_next(request)
        finally:
            if actor_token is not None:
                current_actor.reset(actor_token)
            if meta_token is not None:
                current_request_meta.reset(meta_token)
            if tenant_token is not None:
                current_tenant_id.reset(tenant_token)


app.add_middleware(AuditContextMiddleware)


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
