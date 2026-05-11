"""NotificationDispatcher — pick recipients, render templates, fan out to adapters.

`send_to_role(tenant_id, role, template, context)`:
  1. Find users in `tenant × role`.
  2. For each user, render the template, then attempt every enabled channel.
  3. Persist one Notification row per (user × channel).

The adapters themselves live in `app/notify/channels/`. Each is a small async
callable that returns (status, error_msg). The dispatcher doesn't know what
SMTP / Slack / 钉钉 require — it just calls the adapter.

Failure handling: an adapter exception is caught and logged as FAILED;
nothing escalates to the caller. The point of notifications is "best-effort
ping" — the inbox UI is the authoritative source of pending work.
"""
import uuid
from pathlib import Path
from typing import Any, Optional

import structlog
from jinja2 import Environment, FileSystemLoader, select_autoescape
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import async_session_factory
from app.models.identity import UserGovernanceRole
from app.models.notification import Notification
from app.models.user import User

from .channels.email import send_email
from .channels.slack import send_slack
from .channels.dingtalk import send_dingtalk

logger = structlog.get_logger(__name__)


_TEMPLATE_DIR = Path(__file__).parent / "templates"
_env = Environment(
    loader=FileSystemLoader(str(_TEMPLATE_DIR)),
    autoescape=select_autoescape(disabled_extensions=("j2",), default=False),
    trim_blocks=True,
    lstrip_blocks=True,
)


def _disabled_channels(user: User) -> set[str]:
    raw = (user.notify_channels_disabled or "").strip()
    if not raw:
        return set()
    return {p.strip().upper() for p in raw.split(",") if p.strip()}


def _render(template: str, suffix: str, context: dict[str, Any]) -> str:
    tpl = _env.get_template(f"{template}.{suffix}.j2")
    return tpl.render(**context).strip()


async def _find_role_users(db: AsyncSession, tenant_id: Optional[uuid.UUID], role: str) -> list[User]:
    """All active users in a tenant who hold the given governance role."""
    q = (
        select(User)
        .join(UserGovernanceRole, UserGovernanceRole.user_id == User.id)
        .where(UserGovernanceRole.role == role.upper())
        .where(User.is_active.is_(True))
    )
    if tenant_id is not None:
        q = q.where(UserGovernanceRole.tenant_id == tenant_id)
    rows = (await db.execute(q)).scalars().unique().all()
    return list(rows)


class NotificationDispatcher:

    async def send_to_role(
        self,
        tenant_id: Optional[uuid.UUID],
        role: str,
        template: str,
        context: dict[str, Any],
        event_type: str = "ApprovalRequired",
    ) -> int:
        """Send to every user in `tenant × role`. Returns number of attempts made.

        ADMINs in the same tenant are NOT auto-CC'd here — they get pings
        when they hold the specific role. (Wildcard-ADMIN approval power
        doesn't imply wildcard-ADMIN notification spam.)
        """
        # Inject globals every template can rely on.
        ctx = {**context, "public_url": settings.app_public_url, "role": role}

        try:
            subject = _render(template, "subject", ctx)
            body    = _render(template, "body",    ctx)
        except Exception as exc:
            logger.error("notify_template_render_failed", template=template, error=str(exc))
            return 0

        attempts = 0
        async with async_session_factory() as db:
            users = await _find_role_users(db, tenant_id, role)
            if not users:
                logger.info("notify_no_recipients", tenant_id=str(tenant_id), role=role)
                return 0

            for u in users:
                disabled = _disabled_channels(u)

                # Email — always attempted unless explicitly disabled or SMTP unconfigured.
                if "EMAIL" not in disabled:
                    attempts += 1
                    await self._send_and_log(
                        db, u, tenant_id, event_type, template, "EMAIL",
                        recipient=u.email,
                        coro=send_email(u.email, subject, body),
                        context=ctx,
                    )

                if u.slack_webhook and "SLACK" not in disabled:
                    attempts += 1
                    await self._send_and_log(
                        db, u, tenant_id, event_type, template, "SLACK",
                        recipient=_redact_webhook(u.slack_webhook),
                        coro=send_slack(u.slack_webhook, subject, body),
                        context=ctx,
                    )

                if u.dingtalk_webhook and "DINGTALK" not in disabled:
                    attempts += 1
                    await self._send_and_log(
                        db, u, tenant_id, event_type, template, "DINGTALK",
                        recipient=_redact_webhook(u.dingtalk_webhook),
                        coro=send_dingtalk(u.dingtalk_webhook, u.dingtalk_secret, subject, body),
                        context=ctx,
                    )

            await db.commit()

        return attempts

    async def _send_and_log(
        self, db, user, tenant_id, event_type, template, channel,
        recipient, coro, context,
    ):
        status = "SKIPPED"
        error: Optional[str] = None
        try:
            ok, err = await coro
            if ok:
                status = "SENT"
            elif err in {"smtp_unconfigured", "no_webhook"}:
                # Channel not configured: log as SKIPPED so dashboards don't
                # show false-alarm FAILED counts in a fresh install.
                status, error = "SKIPPED", err
            else:
                status, error = "FAILED", err
        except Exception as exc:
            status = "FAILED"
            error = f"{type(exc).__name__}: {exc}"
            logger.warning("notify_channel_exception",
                           channel=channel, user=user.email, error=error)

        db.add(Notification(
            tenant_id=tenant_id,
            user_id=user.id,
            event_type=event_type,
            template=template,
            channel=channel,
            status=status,
            recipient=recipient,
            context=context,
            error=error,
        ))


def _redact_webhook(url: str) -> str:
    """Keep host + path prefix; drop secrets. So `audit_log` queries don't
    expose webhooks verbatim."""
    if "?" in url:
        url = url.split("?", 1)[0]
    if len(url) > 80:
        url = url[:60] + "…"
    return url


dispatcher = NotificationDispatcher()
