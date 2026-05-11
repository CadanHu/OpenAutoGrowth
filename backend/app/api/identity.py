"""Identity & RBAC API — /v1/identity.

Endpoints:
  POST /login      → access + refresh token from email+password
  POST /refresh    → new access token from refresh token
  GET  /me         → current user profile (incl. governance roles)
  POST /users      → admin-only: create a user
  POST /users/{id}/grant   → admin-only: grant a governance role
  POST /users/{id}/revoke  → admin-only: revoke a governance role
"""
import uuid
from typing import Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from jose import JWTError
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import AuthIdentity, current_user, require_gov_role
from app.core.security import (
    create_access_token, create_refresh_token, decode_token,
    hash_password, verify_password,
)
from app.database import get_db
from app.models.identity import UserGovernanceRole
from app.models.user import Organization, User

logger = structlog.get_logger(__name__)
router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class LoginIn(BaseModel):
    # Plain str (not EmailStr) on purpose — email-validator rejects reserved
    # TLDs like .local and .test, which legitimate internal/dev accounts use.
    email: str
    password: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: dict


class RefreshIn(BaseModel):
    refresh_token: str


class UserCreateIn(BaseModel):
    email: str
    password: str = Field(min_length=8)
    role: str = "MARKETER"
    tenant_id: Optional[uuid.UUID] = None
    gov_roles: list[str] = []


class GrantIn(BaseModel):
    role: str


class TenantIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    slug: str = Field(pattern=r"^[a-z0-9][a-z0-9\-]{0,98}$")


class TenantOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str

    class Config:
        from_attributes = True


class UserListOut(BaseModel):
    id: uuid.UUID
    email: str
    role: str
    tenant_id: Optional[uuid.UUID]
    gov_roles: list[str]
    is_active: bool


class NotifyPrefsIn(BaseModel):
    slack_webhook: Optional[str] = None
    dingtalk_webhook: Optional[str] = None
    dingtalk_secret: Optional[str] = None
    # CSV: "EMAIL,SLACK,DINGTALK" — channels in this set are skipped.
    notify_channels_disabled: Optional[str] = None


class NotifyPrefsOut(BaseModel):
    slack_webhook: Optional[str]
    dingtalk_webhook: Optional[str]
    dingtalk_secret_set: bool
    notify_channels_disabled: Optional[str]


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _gov_roles_for(db: AsyncSession, user_id: uuid.UUID) -> list[str]:
    rows = (await db.execute(
        select(UserGovernanceRole.role).where(UserGovernanceRole.user_id == user_id)
    )).scalars().all()
    return list(rows)


def _user_dict(user: User, gov_roles: list[str]) -> dict:
    return {
        "id": str(user.id),
        "email": user.email,
        "role": user.role,
        "tenant_id": str(user.tenant_id) if user.tenant_id else None,
        "gov_roles": gov_roles,
        "is_active": user.is_active,
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/login", response_model=TokenPair)
async def login(body: LoginIn, db: AsyncSession = Depends(get_db)):
    user = (await db.execute(select(User).where(User.email == body.email))).scalar_one_or_none()
    if not user or not user.is_active or not verify_password(body.password, user.hashed_password):
        # Generic message; don't leak account-existence.
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="invalid credentials")

    gov_roles = await _gov_roles_for(db, user.id)

    return TokenPair(
        access_token=create_access_token(
            user_id=user.id,
            email=user.email,
            user_role=user.role,
            gov_roles=gov_roles,
            tenant_id=user.tenant_id,
        ),
        refresh_token=create_refresh_token(user.id),
        user=_user_dict(user, gov_roles),
    )


@router.post("/refresh", response_model=TokenPair)
async def refresh(body: RefreshIn, db: AsyncSession = Depends(get_db)):
    try:
        payload = decode_token(body.refresh_token)
    except JWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail=f"invalid refresh token: {exc}")
    if payload.get("type") != "refresh":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="not a refresh token")

    user_id = uuid.UUID(payload["sub"])
    user = await db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="account inactive")

    gov_roles = await _gov_roles_for(db, user.id)
    return TokenPair(
        access_token=create_access_token(
            user_id=user.id,
            email=user.email,
            user_role=user.role,
            gov_roles=gov_roles,
            tenant_id=user.tenant_id,
        ),
        refresh_token=create_refresh_token(user.id),
        user=_user_dict(user, gov_roles),
    )


@router.get("/me")
async def me(user: AuthIdentity = Depends(current_user), db: AsyncSession = Depends(get_db)):
    row = await db.get(User, uuid.UUID(user.user_id))
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="user not found")
    return _user_dict(row, await _gov_roles_for(db, row.id))


@router.get("/me/notifications", response_model=NotifyPrefsOut)
async def my_notify_prefs(user: AuthIdentity = Depends(current_user), db: AsyncSession = Depends(get_db)):
    row = await db.get(User, uuid.UUID(user.user_id))
    if not row:
        raise HTTPException(404, detail="user not found")
    return NotifyPrefsOut(
        slack_webhook=row.slack_webhook,
        dingtalk_webhook=row.dingtalk_webhook,
        dingtalk_secret_set=bool(row.dingtalk_secret),
        notify_channels_disabled=row.notify_channels_disabled,
    )


@router.patch("/me/notifications", response_model=NotifyPrefsOut)
async def update_my_notify_prefs(
    body: NotifyPrefsIn,
    user: AuthIdentity = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    row = await db.get(User, uuid.UUID(user.user_id))
    if not row:
        raise HTTPException(404, detail="user not found")
    # Empty strings mean "clear it"; None means "leave it alone".
    if body.slack_webhook is not None:
        row.slack_webhook = body.slack_webhook or None
    if body.dingtalk_webhook is not None:
        row.dingtalk_webhook = body.dingtalk_webhook or None
    if body.dingtalk_secret is not None:
        row.dingtalk_secret = body.dingtalk_secret or None
    if body.notify_channels_disabled is not None:
        row.notify_channels_disabled = body.notify_channels_disabled or None
    db.add(row)
    await db.commit()
    return NotifyPrefsOut(
        slack_webhook=row.slack_webhook,
        dingtalk_webhook=row.dingtalk_webhook,
        dingtalk_secret_set=bool(row.dingtalk_secret),
        notify_channels_disabled=row.notify_channels_disabled,
    )


# ── Admin: user provisioning ──────────────────────────────────────────────────

@router.post("/users", status_code=201)
async def create_user(
    body: UserCreateIn,
    db: AsyncSession = Depends(get_db),
    _admin: AuthIdentity = Depends(require_gov_role("ADMIN")),
):
    existing = (await db.execute(select(User).where(User.email == body.email))).scalar_one_or_none()
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="email already in use")

    # Default tenant = the caller's tenant. Lets an ADMIN provision users
    # without having to know their own tenant_id explicitly.
    tenant_id = body.tenant_id
    if tenant_id is None and _admin.tenant_id:
        tenant_id = uuid.UUID(_admin.tenant_id)

    user = User(
        org_id=tenant_id or uuid.UUID("00000000-0000-0000-0000-000000000001"),
        email=body.email,
        hashed_password=hash_password(body.password),
        role=body.role,
        tenant_id=tenant_id,
        is_active=True,
    )
    db.add(user)
    await db.flush()

    for role in body.gov_roles:
        db.add(UserGovernanceRole(user_id=user.id, role=role.upper(), tenant_id=tenant_id))

    await db.commit()
    return _user_dict(user, [r.upper() for r in body.gov_roles])


@router.post("/users/{user_id}/grant")
async def grant_role(
    user_id: uuid.UUID,
    body: GrantIn,
    db: AsyncSession = Depends(get_db),
    _admin: AuthIdentity = Depends(require_gov_role("ADMIN")),
):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, detail="user not found")

    role = body.role.upper()
    existing = (await db.execute(
        select(UserGovernanceRole)
        .where(UserGovernanceRole.user_id == user_id)
        .where(UserGovernanceRole.role == role)
    )).scalar_one_or_none()
    if existing:
        return {"granted": False, "reason": "already_held"}

    db.add(UserGovernanceRole(
        user_id=user_id, role=role, tenant_id=user.tenant_id,
        granted_by=uuid.UUID(_admin.user_id) if _admin.user_id else None,
    ))
    await db.commit()
    return {"granted": True, "role": role}


@router.get("/users", response_model=list[UserListOut])
async def list_users(
    db: AsyncSession = Depends(get_db),
    _admin: AuthIdentity = Depends(require_gov_role("ADMIN")),
    tenant_id: Optional[uuid.UUID] = None,
):
    """ADMIN-only: list users, optionally filtered to one tenant."""
    q = select(User).order_by(User.email)
    if tenant_id is not None:
        q = q.where(User.tenant_id == tenant_id)
    rows = (await db.execute(q)).scalars().all()
    out: list[UserListOut] = []
    for u in rows:
        roles = await _gov_roles_for(db, u.id)
        out.append(UserListOut(
            id=u.id, email=u.email, role=u.role,
            tenant_id=u.tenant_id, gov_roles=roles, is_active=u.is_active,
        ))
    return out


# ── Admin: tenants ────────────────────────────────────────────────────────────

@router.get("/tenants", response_model=list[TenantOut])
async def list_tenants(
    db: AsyncSession = Depends(get_db),
    _admin: AuthIdentity = Depends(require_gov_role("ADMIN")),
):
    rows = (await db.execute(select(Organization).order_by(Organization.name))).scalars().all()
    return rows


@router.post("/tenants", response_model=TenantOut, status_code=201)
async def create_tenant(
    body: TenantIn,
    db: AsyncSession = Depends(get_db),
    _admin: AuthIdentity = Depends(require_gov_role("ADMIN")),
):
    existing = (await db.execute(
        select(Organization).where(Organization.slug == body.slug)
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="slug already in use")
    org = Organization(name=body.name, slug=body.slug)
    db.add(org)
    await db.commit()
    return org


@router.post("/users/{user_id}/revoke")
async def revoke_role(
    user_id: uuid.UUID,
    body: GrantIn,
    db: AsyncSession = Depends(get_db),
    _admin: AuthIdentity = Depends(require_gov_role("ADMIN")),
):
    role = body.role.upper()
    row = (await db.execute(
        select(UserGovernanceRole)
        .where(UserGovernanceRole.user_id == user_id)
        .where(UserGovernanceRole.role == role)
    )).scalar_one_or_none()
    if not row:
        return {"revoked": False, "reason": "not_held"}

    await db.delete(row)
    await db.commit()
    return {"revoked": True, "role": role}
