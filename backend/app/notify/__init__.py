"""Notification dispatch — Phase 2.

Public surface:

    from app.notify import dispatcher

    await dispatcher.send_to_role(
        tenant_id, role="FINANCE", template="approval_required",
        context={"campaign_id": ..., "rules": [...]},
    )

Per-user routing is decided here based on `users.slack_webhook /
dingtalk_webhook / notify_channels_disabled`. Each delivery is logged in
`notifications` regardless of channel success.

Failures are NOT retried in Phase 2 — they're recorded with status=FAILED.
Retry queue + dead-letter handling is a Phase 3 concern.
"""
from .dispatcher import dispatcher  # noqa: F401
