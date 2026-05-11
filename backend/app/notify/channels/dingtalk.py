"""DingTalk (钉钉) custom-bot webhook adapter.

DingTalk requires either an IP allowlist, a keyword in the message, or an
HMAC signature appended to the URL. We support all three transparently —
caller just provides the webhook URL (with or without keyword filtering)
and an optional secret. When `secret` is set we compute the timestamped
HMAC-SHA256 signature DingTalk expects.

Docs: https://open.dingtalk.com/document/orgapp/custom-robots-send-group-messages
"""
import base64
import hashlib
import hmac
import time
import urllib.parse
from typing import Optional

import httpx
import structlog

logger = structlog.get_logger(__name__)


def _sign(secret: str) -> tuple[str, str]:
    ts = str(round(time.time() * 1000))
    string_to_sign = f"{ts}\n{secret}".encode("utf-8")
    digest = hmac.new(secret.encode("utf-8"), string_to_sign, digestmod=hashlib.sha256).digest()
    sign = urllib.parse.quote_plus(base64.b64encode(digest))
    return ts, sign


async def send_dingtalk(
    webhook_url: str,
    secret: Optional[str],
    subject: str,
    body: str,
) -> tuple[bool, Optional[str]]:
    if not webhook_url:
        return False, "no_webhook"

    url = webhook_url
    if secret:
        ts, sign = _sign(secret)
        sep = "&" if "?" in url else "?"
        url = f"{url}{sep}timestamp={ts}&sign={sign}"

    payload = {
        "msgtype": "markdown",
        "markdown": {
            "title": subject,
            # Custom-bot keyword filter (if enabled) needs to match the
            # `text` somewhere — clients usually allow "OAG" or "OpenAutoGrowth".
            "text": f"### {subject}\n\n```\n{body}\n```",
        },
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json=payload)
            data = {}
            try: data = resp.json()
            except Exception: pass
            # DingTalk returns 200 + {errcode: 0} on success. errcode != 0
            # is a *delivery* failure even when HTTP says 200.
            if resp.status_code == 200 and data.get("errcode") == 0:
                return True, None
            return False, f"http_{resp.status_code} errcode={data.get('errcode')} errmsg={data.get('errmsg', resp.text)[:200]}"
    except Exception as exc:
        logger.warning("dingtalk_send_failed", error=str(exc))
        return False, f"{type(exc).__name__}: {exc}"
