"""
WebSocket endpoint — /ws/{campaign_id}
Bridges Redis Pub/Sub to connected browser clients.
"""
import asyncio
import json

import structlog
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.event_bus import event_bus

logger = structlog.get_logger(__name__)
router = APIRouter()


@router.websocket("/ws/{campaign_id}")
async def campaign_websocket(websocket: WebSocket, campaign_id: str):
    """
    Clients connect here to receive real-time campaign events.

    Message protocol:
      Server → Client: { type, campaign_id, payload, timestamp }
      Client → Server: { type: "ping" }  →  { type: "pong" }
    """
    await websocket.accept()
    logger.info("ws_connected", campaign_id=campaign_id)

    queue: asyncio.Queue = asyncio.Queue()

    async def on_event(message: dict):
        await queue.put(message)

    # Subscribe to campaign-specific Redis channel
    unsubscribe = await event_bus.subscribe(f"campaign:{campaign_id}", on_event)

    try:
        await websocket.send_json({"type": "connected", "campaign_id": campaign_id})

        while True:
            # Race: incoming WS message OR outgoing event
            done, pending = await asyncio.wait(
                [
                    asyncio.ensure_future(websocket.receive_text()),
                    asyncio.ensure_future(queue.get()),
                ],
                return_when=asyncio.FIRST_COMPLETED,
            )

            for task in pending:
                task.cancel()

            for task in done:
                result = task.result()

                if isinstance(result, str):
                    # Client → Server (ping/pong)
                    try:
                        msg = json.loads(result)
                        if msg.get("type") == "ping":
                            await websocket.send_json(
                                {"type": "pong", "timestamp": _now()}
                            )
                    except json.JSONDecodeError:
                        pass
                elif isinstance(result, dict):
                    # Redis event → Client
                    await websocket.send_json(result)

    except WebSocketDisconnect:
        logger.info("ws_disconnected", campaign_id=campaign_id)
    finally:
        await unsubscribe()


def _now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
