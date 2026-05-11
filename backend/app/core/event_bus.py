"""
EventBus — Redis Pub/Sub backed event bus.
Replaces the in-memory EventBus.js for cross-process, cross-client broadcasting.
"""
import asyncio
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
    "ReviewCompleted":     "review.completed",
    "ApprovalRequired":    "governance.approval_required",
    "ApprovalResolved":    "governance.approval_resolved",
    "ApprovalEscalated":   "governance.approval_escalated",
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
        self._reader_task: asyncio.Task | None = None

    async def connect(self):
        self._redis = aioredis.from_url(settings.redis_url, decode_responses=True)
        self._pubsub = self._redis.pubsub()
        # redis-py's async PubSub does not auto-drive the message loop; if we
        # only call `pubsub.subscribe(**{channel: handler})` the handlers
        # never fire because nobody reads from the connection. Spawn a
        # background reader that polls and dispatches.
        self._reader_task = asyncio.create_task(self._reader_loop())
        logger.info("event_bus_connected", url=settings.redis_url)

    async def disconnect(self):
        if self._reader_task:
            self._reader_task.cancel()
            try:
                await self._reader_task
            except (asyncio.CancelledError, Exception):
                pass
            self._reader_task = None
        if self._pubsub:
            await self._pubsub.close()
        if self._redis:
            await self._redis.aclose()

    async def _reader_loop(self):
        """Drive PubSub: poll messages, dispatch to per-channel handlers."""
        while True:
            try:
                if not self._pubsub or not self._pubsub.subscribed:
                    await asyncio.sleep(0.05)
                    continue
                msg = await self._pubsub.get_message(
                    ignore_subscribe_messages=True,
                    timeout=1.0,
                )
                if not msg:
                    continue
                channel = msg.get("channel")
                data = msg.get("data")
                try:
                    parsed = json.loads(data) if isinstance(data, str) else data
                except json.JSONDecodeError:
                    continue
                for handler in list(self._handlers.get(channel, [])):
                    try:
                        await handler(parsed)
                    except Exception as exc:
                        logger.warning("event_bus_handler_error", channel=channel, error=str(exc))
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("event_bus_reader_error", error=str(exc))
                await asyncio.sleep(0.5)

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
                # Subscribe by channel name only. Dispatch happens in
                # _reader_loop via self._handlers — registering a per-channel
                # handler dict here is redundant and would fight the loop.
                await self._pubsub.subscribe(channel)

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
