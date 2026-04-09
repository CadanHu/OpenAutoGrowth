"""
EventBus — Redis Pub/Sub backed event bus.
Replaces the in-memory EventBus.js for cross-process, cross-client broadcasting.
"""
import json
from collections.abc import Callable, Coroutine
from datetime import datetime, timezone
from typing import Any
import uuid

import redis.asyncio as aioredis
import structlog

from app.config import settings

logger = structlog.get_logger(__name__)

# Map domain event names → WebSocket message types (mirrors websocket.js)
WS_EVENT_MAP = {
    "StatusChanged":       "campaign.status_changed",
    "CampaignCreated":     "campaign.created",
    "PlanGenerated":       "campaign.plan_ready",
    "ContentGenerated":    "task.content_generated",
    "AssetsGenerated":     "task.assets_generated",
    "StrategyDecided":     "task.strategy_decided",
    "AdDeployed":          "task.ad_deployed",
    "ReportGenerated":     "metrics.updated",
    "AnomalyDetected":     "anomaly.detected",
    "OptimizationApplied": "optimization.applied",
}


class EventBus:
    """
    Async Redis Pub/Sub event bus.

    - publish(): serialize event → Redis channel `campaign:{campaign_id}`
    - subscribe(): register async callback for a channel
    - WebSocket handler (app/api/ws.py) subscribes per-connection
    """

    def __init__(self):
        self._redis: aioredis.Redis | None = None
        self._pubsub: aioredis.client.PubSub | None = None
        self._handlers: dict[str, set[Callable]] = {}

    async def connect(self):
        self._redis = aioredis.from_url(settings.redis_url, decode_responses=True)
        self._pubsub = self._redis.pubsub()
        logger.info("event_bus_connected", url=settings.redis_url)

    async def disconnect(self):
        if self._pubsub:
            await self._pubsub.close()
        if self._redis:
            await self._redis.aclose()

    async def publish(self, event_type: str, payload: dict, campaign_id: str | None = None):
        """Publish a domain event to Redis."""
        if not self._redis:
            logger.warning("event_bus_not_connected", event_type=event_type)
            return

        ws_type = WS_EVENT_MAP.get(event_type, f"event.{event_type.lower()}")
        message = {
            "type":        ws_type,
            "event_type":  event_type,
            "campaign_id": campaign_id,
            "payload":     payload,
            "timestamp":   datetime.now(timezone.utc).isoformat(),
            "id":          str(uuid.uuid4()),
        }

        channel = f"campaign:{campaign_id}" if campaign_id else "global"
        await self._redis.publish(channel, json.dumps(message))
        logger.debug("event_published", event_type=event_type, channel=channel)

    async def subscribe(
        self,
        channel: str,
        callback: Callable[[dict], Coroutine[Any, Any, None]],
    ) -> Callable:
        """
        Subscribe to a Redis channel. Returns an async unsubscribe function.

        Usage:
            unsubscribe = await event_bus.subscribe("campaign:abc", handler)
            # later:
            await unsubscribe()
        """
        if channel not in self._handlers:
            self._handlers[channel] = set()
            if self._pubsub:
                await self._pubsub.subscribe(
                    **{channel: self._dispatch_factory(channel)}
                )

        self._handlers[channel].add(callback)

        async def _unsubscribe():
            if channel in self._handlers:
                self._handlers[channel].discard(callback)
                if not self._handlers[channel]:
                    del self._handlers[channel]
                    if self._pubsub:
                        await self._pubsub.unsubscribe(channel)

        return _unsubscribe

    def _dispatch_factory(self, channel: str):
        async def _dispatch(message):
            if message["type"] != "message":
                return
            try:
                data = json.loads(message["data"])
            except json.JSONDecodeError:
                return
            for handler in list(self._handlers.get(channel, [])):
                await handler(data)
        return _dispatch


# Global singleton
event_bus = EventBus()
