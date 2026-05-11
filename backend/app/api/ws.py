"""
WebSocket endpoint — /ws/{campaign_id}
Bridges Redis Pub/Sub to connected browser clients.
"""
import asyncio
import json
import uuid

import structlog
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from jose import JWTError

from app.core.event_bus import event_bus
from app.core.security import decode_token
from app.database import async_session_factory
from app.models.campaign import Campaign

logger = structlog.get_logger(__name__)
router = APIRouter()


async def _authorize_ws(websocket: WebSocket, campaign_id: str) -> bool:
    """Enforce auth + tenant scope on WS subscribe.

    Browsers can't set Authorization headers on WebSocket constructors, so
    the client passes the JWT via the `token` query param. Returns True if
    the connection should proceed.
    """
    token = websocket.query_params.get("token") or ""
    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return False
    try:
        payload = decode_token(token)
    except JWTError:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return False
    if payload.get("type") != "access":
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return False

    held = {r.upper() for r in (payload.get("gov_roles") or [])}
    if "ADMIN" in held:
        return True  # ADMIN can subscribe cross-tenant

    user_tenant = payload.get("tenant_id")
    try:
        cid = uuid.UUID(campaign_id)
    except ValueError:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return False
    async with async_session_factory() as db:
        camp = await db.get(Campaign, cid)
        if not camp or str(camp.org_id) != str(user_tenant):
            # Same logic as REST 404-on-cross-tenant: don't leak existence.
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return False
    return True


@router.websocket("/ws/{campaign_id}")
async def campaign_websocket(websocket: WebSocket, campaign_id: str):
    """
    Clients connect here to receive real-time campaign events.

    Auth: `?token=<JWT>` in the connect URL. Cross-tenant subscriptions are
    rejected with 1008 (policy violation).

    Message protocol:
      Server → Client: { type, campaign_id, payload, timestamp }
      Client → Server: { type: "ping" }  →  { type: "pong" }
    """
    await websocket.accept()
    if not await _authorize_ws(websocket, campaign_id):
        logger.info("ws_unauthorized", campaign_id=campaign_id)
        return
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
