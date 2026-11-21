"""FastAPI routes for Module 1 (`account_auth`): auth, profile, avatar, password, admin lock."""

from __future__ import annotations

from datetime import date
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, File, Query, Request, Response, UploadFile
from pydantic import BaseModel, Field

from manga_reader.api.v1.dependencies import (
    get_active_reader_principal,
    get_admin_principal,
    get_authenticated_principal,
    get_container,
    get_current_principal,
)
from manga_reader.api.v1.envelopes import PaginatedEnvelope, PaginatedMeta, SuccessEnvelope
from manga_reader.common.errors import AuthenticationRequiredError
from manga_reader.common.pagination import PaginationParams
from manga_reader.common.security import SecurityPrincipal
from manga_reader.infrastructure.container import AppContainer
from manga_reader.modules.account_auth.application.service import AuthService

router = APIRouter(tags=["Authentication & Account"])
REFRESH_COOKIE_NAME = "mr_refresh_token"


class RegisterRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=1, max_length=128)
    displayName: str | None = Field(default=None, max_length=100)


class VerifyOtpRequest(BaseModel):
    email: str
    code: str = Field(min_length=4, max_length=10)


class ResendOtpRequest(BaseModel):
    email: str


class LoginRequest(BaseModel):
    identifier: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=128)


class RefreshRequest(BaseModel):
    refreshToken: str | None = None


class UpdateProfileRequest(BaseModel):
    displayName: str | None = None
    bio: str | None = None
    birthDate: date | None = None
    isBirthDatePublic: bool | None = None


class ChangePasswordRequest(BaseModel):
    currentPassword: str
    newPassword: str


class LockUnlockRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def _set_refresh_cookie(response: Response, raw_refresh: str, container: AppContainer) -> None:
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=raw_refresh,
        httponly=True,
        secure=container.settings.app_env in ("staging", "production"),
        samesite="lax",
        max_age=container.settings.refresh_token_ttl_days * 86400,
        path=f"{container.settings.api_prefix}/auth",
    )


@router.post("/auth/register", status_code=201, response_model=SuccessEnvelope[dict[str, Any]])
async def register(
    body: RegisterRequest,
    request: Request,
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = AuthService(container)
    async with container.db.session() as db:
        result = await svc.register(
            db,
            email=body.email,
            username=body.username,
            password=body.password,
            display_name=body.displayName,
            ip_address=_client_ip(request),
        )
    return SuccessEnvelope(data=result)


@router.post("/auth/verify-otp", response_model=SuccessEnvelope[dict[str, Any]])
async def verify_otp(
    body: VerifyOtpRequest,
    request: Request,
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = AuthService(container)
    async with container.db.session() as db:
        result = await svc.verify_otp(
            db, email=body.email, code=body.code, ip_address=_client_ip(request)
        )
    return SuccessEnvelope(data=result)


@router.post("/auth/resend-otp", response_model=SuccessEnvelope[dict[str, Any]])
async def resend_otp(
    body: ResendOtpRequest,
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = AuthService(container)
    async with container.db.session() as db:
        result = await svc.resend_otp(db, email=body.email)
    return SuccessEnvelope(data=result)


@router.post("/auth/login", response_model=SuccessEnvelope[dict[str, Any]])
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = AuthService(container)
    async with container.db.session() as db:
        result, raw_refresh = await svc.login(
            db,
            identifier=body.identifier,
            password=body.password,
            ip_address=_client_ip(request),
            user_agent=request.headers.get("user-agent"),
        )
    _set_refresh_cookie(response, raw_refresh, container)
    return SuccessEnvelope(data=result)


@router.post("/auth/refresh", response_model=SuccessEnvelope[dict[str, Any]])
async def refresh_token(
    request: Request,
    response: Response,
    body: RefreshRequest | None = None,
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    raw_token = (body.refreshToken if body and body.refreshToken else None) or request.cookies.get(
        REFRESH_COOKIE_NAME
    )
    if not raw_token:
        raise AuthenticationRequiredError("Refresh token missing.", error_code="SESSION_EXPIRED")
    svc = AuthService(container)
    async with container.db.session() as db:
        result, new_refresh = await svc.refresh_session(
            db, raw_refresh_token=raw_token, ip_address=_client_ip(request)
        )
    _set_refresh_cookie(response, new_refresh, container)
    return SuccessEnvelope(data=result)


@router.post("/auth/logout", response_model=SuccessEnvelope[dict[str, bool]])
async def logout(
    response: Response,
    principal: SecurityPrincipal = Depends(get_authenticated_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, bool]]:
    svc = AuthService(container)
    async with container.db.session() as db:
        await svc.logout(db, principal=principal)
    response.delete_cookie(
        key=REFRESH_COOKIE_NAME,
        path=f"{container.settings.api_prefix}/auth",
    )
    return SuccessEnvelope(data={"loggedOut": True})


@router.get("/account/me", response_model=SuccessEnvelope[dict[str, Any]])
async def get_me(
    principal: SecurityPrincipal = Depends(get_authenticated_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = AuthService(container)
    async with container.db.session() as db:
        profile = await svc.get_profile(db, viewer=principal, account_id=principal.account_id)
    return SuccessEnvelope(data=profile)


@router.get("/accounts/{account_id}/profile", response_model=SuccessEnvelope[dict[str, Any]])
async def get_account_profile(
    account_id: UUID,
    viewer: SecurityPrincipal = Depends(get_current_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = AuthService(container)
    async with container.db.session() as db:
        profile = await svc.get_profile(db, viewer=viewer, account_id=account_id)
    return SuccessEnvelope(data=profile)


@router.get("/profiles/{username}", response_model=SuccessEnvelope[dict[str, Any]])
async def get_profile_by_username(
    username: str,
    viewer: SecurityPrincipal = Depends(get_current_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = AuthService(container)
    async with container.db.session() as db:
        profile = await svc.get_profile(db, viewer=viewer, username=username)
    return SuccessEnvelope(data=profile)


@router.patch("/account/profile", response_model=SuccessEnvelope[dict[str, Any]])
async def update_my_profile(
    body: UpdateProfileRequest,
    request: Request,
    principal: SecurityPrincipal = Depends(get_authenticated_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = AuthService(container)
    async with container.db.session() as db:
        profile = await svc.update_profile(
            db,
            principal=principal,
            display_name=body.displayName,
            bio=body.bio,
            birth_date=body.birthDate,
            is_birth_date_public=body.isBirthDatePublic,
            ip_address=_client_ip(request),
        )
    return SuccessEnvelope(data=profile)


@router.post("/account/avatar", response_model=SuccessEnvelope[dict[str, Any]])
async def upload_my_avatar(
    request: Request,
    file: UploadFile = File(...),
    principal: SecurityPrincipal = Depends(get_authenticated_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    raw = await file.read()
    svc = AuthService(container)
    async with container.db.session() as db:
        profile = await svc.update_avatar(
            db, principal=principal, raw_bytes=raw, ip_address=_client_ip(request)
        )
    return SuccessEnvelope(data=profile)


@router.put("/account/password", response_model=SuccessEnvelope[dict[str, Any]])
async def update_my_password(
    body: ChangePasswordRequest,
    request: Request,
    principal: SecurityPrincipal = Depends(get_active_reader_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = AuthService(container)
    async with container.db.session() as db:
        result = await svc.change_password(
            db,
            principal=principal,
            current_password=body.currentPassword,
            new_password=body.newPassword,
            ip_address=_client_ip(request),
        )
    return SuccessEnvelope(data=result)


@router.get("/admin/accounts", response_model=PaginatedEnvelope[dict[str, Any]])
async def admin_list_accounts(
    q: str | None = Query(default=None),
    status: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=24, alias="pageSize", ge=1, le=100),
    _admin: SecurityPrincipal = Depends(get_admin_principal),
    container: AppContainer = Depends(get_container),
) -> PaginatedEnvelope[dict[str, Any]]:
    pg = PaginationParams.create(
        page=page,
        page_size=page_size,
        default_page_size=container.settings.catalog_default_page_size,
        max_page_size=container.settings.catalog_max_page_size,
    )
    svc = AuthService(container)
    async with container.db.session() as db:
        items, total = await svc.admin_list_accounts(
            db, q=q, status=status, page=pg.page, page_size=pg.page_size
        )
    return PaginatedEnvelope(
        data=items,
        meta=PaginatedMeta(
            page=pg.page,
            page_size=pg.page_size,
            total=total,
            has_next=(pg.page * pg.page_size) < total,
        ),
    )


@router.get("/admin/accounts/{account_id}", response_model=SuccessEnvelope[dict[str, Any]])
async def admin_get_account(
    account_id: UUID,
    admin: SecurityPrincipal = Depends(get_admin_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = AuthService(container)
    async with container.db.session() as db:
        profile = await svc.get_profile(db, viewer=admin, account_id=account_id)
    return SuccessEnvelope(data=profile)


@router.post("/admin/accounts/{account_id}/lock", response_model=SuccessEnvelope[dict[str, Any]])
async def admin_lock_account(
    account_id: UUID,
    body: LockUnlockRequest,
    request: Request,
    admin: SecurityPrincipal = Depends(get_admin_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = AuthService(container)
    async with container.db.session() as db:
        result = await svc.admin_lock_account(
            db,
            admin_principal=admin,
            target_account_id=account_id,
            reason=body.reason,
            ip_address=_client_ip(request),
        )
    return SuccessEnvelope(data=result)


@router.post("/admin/accounts/{account_id}/unlock", response_model=SuccessEnvelope[dict[str, Any]])
async def admin_unlock_account(
    account_id: UUID,
    body: LockUnlockRequest,
    request: Request,
    admin: SecurityPrincipal = Depends(get_admin_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = AuthService(container)
    async with container.db.session() as db:
        result = await svc.admin_unlock_account(
            db,
            admin_principal=admin,
            target_account_id=account_id,
            reason=body.reason,
            ip_address=_client_ip(request),
        )
    return SuccessEnvelope(data=result)
