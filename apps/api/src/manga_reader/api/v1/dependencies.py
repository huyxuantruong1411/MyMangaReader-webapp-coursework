"""FastAPI dependency injection providers and live JWT + Session RBAC verification."""

from __future__ import annotations

from typing import cast
from uuid import UUID

import jwt
from fastapi import Depends, Request

from manga_reader.common.clock import utc_now
from manga_reader.common.errors import AuthenticationRequiredError
from manga_reader.common.identities import AccountId, SessionId
from manga_reader.common.security import (
    ANONYMOUS_PRINCIPAL,
    AccountRole,
    AccountStatus,
    SecurityPrincipal,
    require_active_reader,
    require_admin,
    require_authenticated,
)
from manga_reader.config.settings import Settings
from manga_reader.infrastructure.container import AppContainer
from manga_reader.infrastructure.orm import AccountModel, AdminModel, UserSessionModel


def get_container(request: Request) -> AppContainer:
    """Resolve the application DI container attached during app startup."""
    return cast(AppContainer, request.app.state.container)


def get_app_settings(container: AppContainer = Depends(get_container)) -> Settings:
    return container.settings


async def get_current_principal(
    request: Request,
    container: AppContainer = Depends(get_container),
) -> SecurityPrincipal:
    """Resolve caller's verified security principal from Bearer JWT + live DB session check.

    Enforces `03_DOMAIN_RULES_AND_STATE_MACHINES.md` §3: a signed JWT alone is
    insufficient — every request checks session revocation and live account status.
    """
    existing = getattr(request.state, "principal", None)
    if isinstance(existing, SecurityPrincipal):
        return existing

    auth_header = request.headers.get("Authorization")
    if not auth_header:
        return ANONYMOUS_PRINCIPAL
    if not auth_header.startswith("Bearer "):
        raise AuthenticationRequiredError("Invalid Authorization header format.")

    token = auth_header.removeprefix("Bearer ").strip()
    if not token:
        raise AuthenticationRequiredError("Empty Bearer token.")

    try:
        payload = jwt.decode(
            token,
            container.settings.jwt_secret_key.get_secret_value(),
            algorithms=[container.settings.jwt_algorithm],
        )
        account_uuid = UUID(str(payload["sub"]))
        session_uuid = UUID(str(payload["sid"]))
    except (jwt.PyJWTError, KeyError, ValueError) as exc:
        raise AuthenticationRequiredError(
            "Access token is invalid or expired.",
            error_code="SESSION_EXPIRED",
        ) from exc

    async with container.db.session() as db:
        user_session = await db.get(UserSessionModel, session_uuid)
        if (
            user_session is None
            or user_session.account_id != account_uuid
            or user_session.revoked_at is not None
            or user_session.expires_at <= utc_now()
        ):
            raise AuthenticationRequiredError(
                "Session has been revoked or expired.",
                error_code="SESSION_EXPIRED",
            )
        account = await db.get(AccountModel, account_uuid)
        if account is None:
            raise AuthenticationRequiredError(
                "Account no longer exists.", error_code="SESSION_EXPIRED"
            )
        admin = await db.get(AdminModel, account_uuid)

    role = AccountRole.ADMIN if admin is not None else AccountRole.READER
    principal = SecurityPrincipal(
        account_id=AccountId(account.account_id),
        session_id=SessionId(user_session.session_id),
        role=role,
        status=AccountStatus(account.status),
        admin_role_level=admin.role_level if admin is not None else None,
    )
    request.state.principal = principal
    return principal


async def get_authenticated_principal(
    principal: SecurityPrincipal = Depends(get_current_principal),
) -> SecurityPrincipal:
    return require_authenticated(principal)


async def get_active_reader_principal(
    principal: SecurityPrincipal = Depends(get_current_principal),
) -> SecurityPrincipal:
    return require_active_reader(principal)


async def get_admin_principal(
    principal: SecurityPrincipal = Depends(get_current_principal),
) -> SecurityPrincipal:
    return require_admin(principal)
