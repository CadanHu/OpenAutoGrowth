"""Slack incoming-webhook adapter.

Webhook URL format: https://hooks.slack.com/services/T.../B.../<secret>
The body is posted as JSON; Slack picks up `text` and (optionally) blocks.
"""
from typing import Optional

import httpx
import structlog

logger = structlog.get_logger(__name__)


async def send_slack(webhook_url: str, subject: str, body: str) -> tuple[bool, Optional[str]]:
    if not webhook_url:
        return False, "no_webhook"

    payload = {
        # Slack supports markdown-ish via blocks; for Phase 2 we keep it
        # plain text — easier to debug and renders cleanly in every client.
        "text": f"*{subject}*\n```{body}```",
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(webhook_url, json=payload)
            if 200 <= resp.status_code < 300:
                return True, None
            return False, f"http_{resp.status_code}: {resp.text[:200]}"
    except Exception as exc:
        logger.warning("slack_send_failed", error=str(exc))
        return False, f"{type(exc).__name__}: {exc}"
