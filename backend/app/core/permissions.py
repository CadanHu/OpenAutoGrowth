"""FastAPI dependencies for auth/permissions — Phase 1A.

Usage:
    from app.core.permissions import current_user, require_gov_role

    @router.get("/me")
    async def me(user = Depends(current_user)):
        ...

    @router.post("/admin-thing")
    async def thing(user = Depends(require_gov_role("ADMIN"))):
        ...

    # Resolve required role from request payload (e.g. approve a task whose
    # `role` field decides which permission is needed):
    @router.post("/tasks/{id}/decide")
    async def decide(id, body, user = Depends(current_user)):
        require_gov_role_or_admin(user, task.role)  # raises 403
        ...
"""
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError

from app.core.security import decode_token


# `auto_error=False` so unauth requests reach the handler and we can return
# 401 with a consistent shape (FastAPI's default 403 from HTTPBearer is wrong).
_bearer = HTTPBearer(auto_error=False)


class AuthIdentity(dict):
    """Convenience accessors for the decoded JWT claims."""

    @property
    def user_id(self) -> str:
        return self.get("sub", "")

    @property
    def email(self) -> str:
        return self.get("email", "")

    @property
    def user_role(self) -> str:
        return self.get("user_role", "")

    @property
    def gov_roles(self) -> list[str]:
        return list(self.get("gov_roles") or [])

    @property
    def tenant_id(self) -> Optional[str]:
        return self.get("tenant_id")

    def has_gov_role(self, role: str) -> bool:
        return role.upper() in {r.upper() for r in self.gov_roles}


async def current_user(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> AuthIdentity:
    """Decode the bearer JWT. Raises 401 if missing/invalid/expired."""
    if not creds or creds.scheme.lower() != "bearer":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="missing bearer token")
    try:
        payload = decode_token(creds.credentials)
    except JWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail=f"invalid token: {exc}")
    if payload.get("type") != "access":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="not an access token")
    # Stash the actor on the request so the audit listener can pick it up
    # without re-decoding.
    request.state.actor = payload
    return AuthIdentity(payload)


async def current_user_optional(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> Optional[AuthIdentity]:
    """Like `current_user` but returns None instead of 401 when no token is
    present — useful during Phase 1A rollout to keep public endpoints open."""
    if not creds or creds.scheme.lower() != "bearer":
        return None
    try:
        payload = decode_token(creds.credentials)
    except JWTError:
        return None
    if payload.get("type") != "access":
        return None
    request.state.actor = payload
    return AuthIdentity(payload)


def require_gov_role(*roles: str):
    """Dependency factory: require one of the named governance roles.

    ADMIN always passes. Use for endpoints where the required role is fixed
    at route-definition time (e.g. POST /v1/governance/rules — admin only)."""
    needed = {r.upper() for r in roles}

    async def _dep(user: AuthIdentity = Depends(current_user)) -> AuthIdentity:
        held = {r.upper() for r in user.gov_roles}
        if "ADMIN" in held or held & needed:
            return user
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=f"requires one of: {sorted(needed)}; holding: {sorted(held)}",
        )

    return _dep


def check_gov_role_or_403(user: AuthIdentity, role: str):
    """Inline guard for cases where the required role isn't known until the
    request body / DB lookup is parsed (e.g. POST /tasks/{id}/decide where
    the role is determined by the task itself)."""
    held = {r.upper() for r in user.gov_roles}
    if "ADMIN" in held or role.upper() in held:
        return
    raise HTTPException(
        status.HTTP_403_FORBIDDEN,
        detail=f"requires role {role}; holding: {sorted(held)}",
    )
