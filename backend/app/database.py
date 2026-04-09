"""
Async SQLAlchemy engine, session factory, and LangGraph checkpointer setup.
"""
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from .config import settings


# ── ORM Base ──────────────────────────────────────────────────────────────────

class Base(DeclarativeBase):
    """All SQLAlchemy models inherit from this base."""
    pass


# ── Engine ────────────────────────────────────────────────────────────────────

engine = create_async_engine(
    settings.database_url,
    pool_size=settings.database_pool_size,
    max_overflow=settings.database_max_overflow,
    pool_pre_ping=True,
    echo=not settings.is_production,
)

async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


# ── Session Dependency ────────────────────────────────────────────────────────

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency — yields an async DB session per request."""
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


# ── LangGraph Checkpointer ────────────────────────────────────────────────────

@asynccontextmanager
async def get_checkpointer():
    """
    Yields a LangGraph PostgreSQL async checkpointer.
    Persists agent graph state to the `checkpoints` table (managed by LangGraph).

    Usage:
        async with get_checkpointer() as checkpointer:
            graph = build_campaign_graph(checkpointer)
            await graph.ainvoke(state, config={"configurable": {"thread_id": campaign_id}})
    """
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

    # Strip asyncpg dialect prefix — LangGraph uses psycopg internally
    pg_url = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")

    async with AsyncPostgresSaver.from_conn_string(pg_url) as checkpointer:
        await checkpointer.setup()
        yield checkpointer
