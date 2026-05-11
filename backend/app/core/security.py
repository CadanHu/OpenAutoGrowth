"""JWT + bcrypt — Phase 1A.

Token shape:
    {
      "sub": "<user uuid>",
      "email": "alice@…",
      "tenant_id": "<uuid>",
      "user_role": "MARKETER",
      "gov_roles": ["FINANCE", "LEGAL"],
      "iat": ...,
      "exp": ...
    }

Governance roles are included in the JWT so the `require_role` dependency
doesn't hit the DB on every protected request. Trade-off: a role grant
takes effect on the next token refresh (default: 1h), not immediately.
For Phase 1A this is acceptable; if real-time revocation matters later,
swap to DB-checked roles with a small cache.
"""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import bcrypt
from jose import JWTError, jwt

from app.config import settings


ALGORITHM = "HS256"
ACCESS_TOKEN_TTL = timedelta(hours=8)
REFRESH_TOKEN_TTL = timedelta(days=14)


# bcrypt has a hard 72-byte input limit. We pre-truncate so a long password
# doesn't blow up; nothing security-critical hinges on bytes 73+ anyway.
# (Use `bcrypt` directly instead of passlib — passlib 1.7 is incompatible
# with bcrypt >= 4.x and the project intentionally tracks bcrypt 5.)
_BCRYPT_MAX = 72


def hash_password(plain: str) -> str:
    pw_bytes = plain.encode("utf-8")[:_BCRYPT_MAX]
    return bcrypt.hashpw(pw_bytes, bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        pw_bytes = plain.encode("utf-8")[:_BCRYPT_MAX]
        return bcrypt.checkpw(pw_bytes, hashed.encode("utf-8"))
    except Exception:
        return False


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def create_access_token(
    user_id: uuid.UUID,
    email: str,
    user_role: str,
    gov_roles: list[str],
    tenant_id: Optional[uuid.UUID] = None,
    ttl: timedelta = ACCESS_TOKEN_TTL,
) -> str:
    now = _now_utc()
    payload = {
        "sub": str(user_id),
        "email": email,
        "user_role": user_role,
        "gov_roles": gov_roles,
        "tenant_id": str(tenant_id) if tenant_id else None,
        "iat": int(now.timestamp()),
        "exp": int((now + ttl).timestamp()),
        "type": "access",
    }
    return jwt.encode(payload, settings.app_secret_key, algorithm=ALGORITHM)


def create_refresh_token(user_id: uuid.UUID) -> str:
    now = _now_utc()
    payload = {
        "sub": str(user_id),
        "iat": int(now.timestamp()),
        "exp": int((now + REFRESH_TOKEN_TTL).timestamp()),
        "type": "refresh",
    }
    return jwt.encode(payload, settings.app_secret_key, algorithm=ALGORITHM)


def decode_token(token: str) -> dict[str, Any]:
    """Raises JWTError on any invalid/expired token."""
    return jwt.decode(token, settings.app_secret_key, algorithms=[ALGORITHM])
