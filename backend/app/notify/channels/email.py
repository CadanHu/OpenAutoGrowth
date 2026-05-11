"""SMTP adapter. Returns (ok: bool, error: Optional[str])."""
from email.message import EmailMessage
from typing import Optional

import aiosmtplib
import structlog

from app.config import settings

logger = structlog.get_logger(__name__)


async def send_email(to: str, subject: str, body: str) -> tuple[bool, Optional[str]]:
    if not settings.smtp_host:
        # SMTP intentionally disabled — caller logs as SKIPPED, not FAILED.
        return False, "smtp_unconfigured"

    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)

    try:
        await aiosmtplib.send(
            msg,
            hostname=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_username or None,
            password=settings.smtp_password or None,
            use_tls=settings.smtp_use_tls and not settings.smtp_start_tls,
            start_tls=settings.smtp_start_tls,
            timeout=15.0,
        )
        return True, None
    except Exception as exc:
        logger.warning("smtp_send_failed", to=to, error=str(exc))
        return False, f"{type(exc).__name__}: {exc}"
