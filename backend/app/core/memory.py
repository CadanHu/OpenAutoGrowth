"""
Memory System — short-term (Redis) + long-term (pgvector semantic search).
Production implementation of the Memory.js simulation layer.
"""
import json
import uuid
from datetime import datetime, timezone
from typing import Any

import structlog

from app.config import settings

logger = structlog.get_logger(__name__)


class MemorySystem:
    """
    Two-tier memory:
    - Short-term: Redis hash (per campaign session)
    - Long-term:  PostgreSQL pgvector (semantic retrieval across campaigns)
    """

    def __init__(self):
        self._redis = None

    async def connect(self):
        import redis.asyncio as aioredis
        self._redis = aioredis.from_url(settings.redis_url, decode_responses=True)

    # ── Short-term (Redis) ────────────────────────────────────────

    async def save(self, campaign_id: str, key: str, value: Any):
        """Save value to Redis hash for this campaign's session."""
        if not self._redis:
            return
        await self._redis.hset(
            f"mem:st:{campaign_id}",
            key,
            json.dumps(value),
        )
        await self._redis.expire(f"mem:st:{campaign_id}", 86400)  # 24h TTL

    async def get(self, campaign_id: str, key: str) -> Any | None:
        """Retrieve value from short-term memory."""
        if not self._redis:
            return None
        raw = await self._redis.hget(f"mem:st:{campaign_id}", key)
        return json.loads(raw) if raw else None

    async def delete(self, campaign_id: str, key: str):
        if self._redis:
            await self._redis.hdel(f"mem:st:{campaign_id}", key)

    # ── Long-term (PostgreSQL + pgvector) ─────────────────────────

    async def persist(self, record: dict, db_session) -> str:
        """
        Store an optimization learning record with vector embedding.

        Args:
            record: { campaign_id, type, content, metadata }
            db_session: AsyncSession

        Returns:
            Memory record ID
        """
        from app.models.optimization import AgentMemory

        content = record.get("content") or json.dumps(record)
        embedding = await self._embed(content)

        memory = AgentMemory(
            id=uuid.uuid4(),
            campaign_id=record.get("campaign_id"),
            memory_type=record.get("type", "OPTIMIZATION_LEARNING"),
            content=content,
            metadata_=record.get("metadata"),
        )
        db_session.add(memory)
        await db_session.flush()

        logger.info("memory_persisted", id=str(memory.id), type=memory.memory_type)
        return str(memory.id)

    async def get_similar(self, query: str, top_k: int = 3, db_session=None) -> list[dict]:
        """
        Semantic search over long-term memories using pgvector cosine similarity.

        Production: uses text-embedding-3 vectors for similarity search.
        Stub: returns keyword match fallback.
        """
        if db_session is None:
            return []

        from sqlalchemy import select, text
        from app.models.optimization import AgentMemory

        # TODO: replace with vector similarity query when embeddings are populated
        # query_vec = await self._embed(query)
        # stmt = select(AgentMemory).order_by(
        #     AgentMemory.embedding.cosine_distance(query_vec)
        # ).limit(top_k)

        # Keyword fallback
        stmt = (
            select(AgentMemory)
            .where(AgentMemory.content.ilike(f"%{query[:50]}%"))
            .limit(top_k)
        )
        result = await db_session.execute(stmt)
        rows = result.scalars().all()

        return [
            {"id": str(r.id), "content": r.content, "type": r.memory_type}
            for r in rows
        ]

    async def _embed(self, text: str) -> list[float]:
        """
        Generate text embedding.
        Production: call Anthropic or OpenAI embeddings API.
        Stub: returns zero vector.
        """
        # TODO: implement real embedding call
        # response = await anthropic_client.embeddings.create(...)
        return [0.0] * 1536


# Global singleton
memory_system = MemorySystem()
