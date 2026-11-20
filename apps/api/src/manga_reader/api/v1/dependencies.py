"""FastAPI dependency injection providers and auth/RBAC guard interfaces."""

from __future__ import annotations

from typing import cast

from fastapi import Depends, Request

from manga_reader.common.security import (
    ANONYMOUS_PRINCIPAL,
    SecurityPrincipal,
    require_active_reader,
    require_admin,
    require_authenticated,
)
from manga_reader.config.settings import Settings
from manga_reader.infrastructure.container import AppContainer


def get_container(request: Request) -> AppContainer:
    """Resolve the application DI container attached during app startup."""
    return cast(AppContainer, request.app.state.container)


def get_app_settings(container: AppContainer = Depends(get_container)) -> Settings:
    return container.settings


async def get_current_principal(request: Request) -> SecurityPrincipal:
    """Resolve caller's verified security principal.

    Foundation default returns ANONYMOUS_PRINCIPAL until Phase 2 JWT + DB/cache
    session verification middleware is wired in `account_auth`.
    """
    existing = getattr(request.state, "principal", None)
    if isinstance(existing, SecurityPrincipal):
        return existing
    return ANONYMOUS_PRINCIPAL


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
