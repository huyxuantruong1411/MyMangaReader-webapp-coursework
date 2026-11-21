"""Phase 2: Authentication, OTP, Session Management, Profile & Admin Lock/Unlock Service."""

from __future__ import annotations

import io
import json
import re
import secrets
from datetime import date, timedelta
from typing import Any
from uuid import UUID, uuid4

import jwt
from PIL import Image, UnidentifiedImageError
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from manga_reader.common.clock import format_rfc3339, utc_now
from manga_reader.common.errors import (
    AccountLockedError,
    AuthenticationRequiredError,
    BusinessRuleError,
    ConflictError,
    EmailNotVerifiedError,
    ForbiddenError,
    PayloadTooLargeError,
    RateLimitedError,
    ResourceNotFoundError,
    ValidationAppError,
)
from manga_reader.common.identities import MediaObjectRef
from manga_reader.common.security import (
    AccountRole,
    AccountStatus,
    SecurityPrincipal,
    generate_opaque_token,
    hash_secret_token,
    verify_secret_hash,
)
from manga_reader.common.text import (
    is_reserved_display_name,
    normalize_identifier,
    sanitize_user_text,
)
from manga_reader.infrastructure.audit_outbox import append_activity_log, enqueue_outbox_event
from manga_reader.infrastructure.container import AppContainer
from manga_reader.infrastructure.email import EmailMessage
from manga_reader.infrastructure.orm import (
    AccountModel,
    AccountStatusHistoryModel,
    AdminModel,
    ReaderModel,
    ReaderSettingsModel,
    UserSessionModel,
)

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{2,49}$")
_ALLOWED_AVATAR_FORMATS = {
    "JPEG": ("jpg", "image/jpeg"),
    "PNG": ("png", "image/png"),
    "WEBP": ("webp", "image/webp"),
}


class AuthService:
    """Application service for Module 1 (`account_auth`)."""

    def __init__(self, container: AppContainer) -> None:
        self._container = container
        self._settings = container.settings

    @property
    def _pepper(self) -> str:
        return self._settings.jwt_secret_key.get_secret_value()

    def _otp_cache_key(self, normalized_email: str) -> str:
        return f"otp:verify:{normalized_email}"

    def _otp_resend_key(self, normalized_email: str) -> str:
        return f"otp:resend:{normalized_email}"

    def _issue_access_jwt(
        self,
        *,
        account_id: UUID,
        session_id: UUID,
        role: AccountRole,
    ) -> tuple[str, int]:
        now = utc_now()
        ttl_seconds = self._settings.access_token_ttl_minutes * 60
        payload = {
            "sub": str(account_id),
            "sid": str(session_id),
            "jti": str(uuid4()),
            "role": role.value,
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(seconds=ttl_seconds)).timestamp()),
        }
        token = jwt.encode(payload, self._pepper, algorithm=self._settings.jwt_algorithm)
        return token, ttl_seconds

    async def _create_and_dispatch_otp(self, normalized_email: str, account_id: UUID) -> str:
        otp_length = self._settings.otp_length
        raw_code = str(secrets.randbelow(10**otp_length)).zfill(otp_length)
        challenge_payload = json.dumps(
            {
                "account_id": str(account_id),
                "otp_hash": hash_secret_token(raw_code, pepper=self._pepper),
                "attempts": 0,
            }
        )
        await self._container.cache.set(
            self._otp_cache_key(normalized_email),
            challenge_payload,
            ttl_seconds=self._settings.otp_ttl_seconds,
        )
        await self._container.email.send(
            EmailMessage(
                to_email=normalized_email,
                subject="Verify your Manga Reader account",
                body_text=f"Your verification code is {raw_code}. It expires in {self._settings.otp_ttl_seconds}s.",
                contains_sensitive_secret=True,
            )
        )
        return raw_code

    async def register(
        self,
        session: AsyncSession,
        *,
        email: str,
        username: str,
        password: str,
        display_name: str | None = None,
        ip_address: str | None = None,
    ) -> dict[str, Any]:
        norm_email = normalize_identifier(email)
        norm_username = normalize_identifier(username)

        if not _EMAIL_RE.match(norm_email) or len(norm_email) > 254:
            raise ValidationAppError("Invalid email format.", details={"field": "email"})
        if not _USERNAME_RE.match(norm_username):
            raise ValidationAppError(
                "Username must be 3-50 chars (lowercase letters, digits, '.', '_', '-').",
                details={"field": "username"},
            )
        if len(password) < self._settings.password_min_length:
            raise ValidationAppError(
                f"Password must be at least {self._settings.password_min_length} characters.",
                details={"field": "password"},
            )
        resolved_display = (display_name or username).strip()
        if not resolved_display or len(resolved_display) > 100:
            raise ValidationAppError(
                "Display name must be 1-100 characters.", details={"field": "displayName"}
            )
        if is_reserved_display_name(resolved_display):
            raise ValidationAppError(
                "This display name is reserved and cannot be used.",
                details={"field": "displayName"},
            )

        existing_email = await session.scalar(
            select(AccountModel).where(AccountModel.email == norm_email)
        )
        if existing_email is not None:
            raise ConflictError(
                "An account with this email already exists.",
                error_code="DUPLICATE_RESOURCE",
                details={"field": "email"},
            )
        existing_user = await session.scalar(
            select(AccountModel).where(AccountModel.username == norm_username)
        )
        if existing_user is not None:
            raise ConflictError(
                "This username is already taken.",
                error_code="DUPLICATE_RESOURCE",
                details={"field": "username"},
            )

        now = utc_now()
        account = AccountModel(
            account_id=uuid4(),
            username=norm_username,
            email=norm_email,
            password_hash=self._container.password_hasher.hash(password),
            status=AccountStatus.PENDING_VERIFICATION.value,
            failed_login_attempts=0,
            last_status_change_at=now,
            created_at=now,
        )
        reader = ReaderModel(
            account_id=account.account_id,
            display_name=sanitize_user_text(resolved_display, preserve_newlines=False),
            is_birth_date_public=False,
        )
        reader_settings = ReaderSettingsModel(
            reader_account_id=account.account_id,
            preload_page_count=self._settings.reader_default_preload_pages,
            updated_at=now,
        )
        session.add(account)
        await session.flush()
        session.add(reader)
        await session.flush()
        session.add(reader_settings)
        append_activity_log(
            session,
            event_type="ACCOUNT_REGISTERED",
            account_id=account.account_id,
            target_type="ACCOUNT",
            target_id=str(account.account_id),
            ip_address=ip_address,
            details={"status": account.status},
        )
        await enqueue_outbox_event(
            session,
            idempotency_key=f"register-otp:{account.account_id}",
            event_type="ACCOUNT_REGISTERED",
            aggregate_type="ACCOUNT",
            aggregate_id=str(account.account_id),
            payload={"email_domain": norm_email.split("@")[-1]},
        )
        await session.commit()

        # OTP strictly stored in cache/Redis with 120s TTL (never SQL per ADR-004)
        raw_code = await self._create_and_dispatch_otp(norm_email, account.account_id)

        response_data: dict[str, Any] = {
            "accountId": str(account.account_id),
            "username": account.username,
            "status": account.status,
            "verificationRequired": True,
            "otpTtlSeconds": self._settings.otp_ttl_seconds,
        }
        if self._settings.app_env == "development" and self._settings.email_dev_log_otp:
            response_data["devOtpPreview"] = raw_code
        return response_data

    async def verify_otp(
        self,
        session: AsyncSession,
        *,
        email: str,
        code: str,
        ip_address: str | None = None,
    ) -> dict[str, Any]:
        norm_email = normalize_identifier(email)
        clean_code = code.strip()
        cache_key = self._otp_cache_key(norm_email)

        raw_challenge = await self._container.cache.get(cache_key)
        if raw_challenge is None:
            raise BusinessRuleError(
                "Verification code has expired or does not exist. Request a new code.",
                error_code="OTP_EXPIRED_OR_INVALID",
            )

        challenge = json.loads(raw_challenge)
        attempts = int(challenge.get("attempts", 0))
        if attempts >= self._settings.otp_max_attempts:
            await self._container.cache.delete(cache_key)
            raise RateLimitedError(
                "Maximum OTP verification attempts exceeded. Request a new code.",
                error_code="OTP_TOO_MANY_ATTEMPTS",
            )

        expected_hash = str(challenge["otp_hash"])
        if not verify_secret_hash(clean_code, expected_hash, pepper=self._pepper):
            challenge["attempts"] = attempts + 1
            await self._container.cache.set(
                cache_key,
                json.dumps(challenge),
                ttl_seconds=self._settings.otp_ttl_seconds,
            )
            raise ValidationAppError(
                "Invalid verification code.",
                error_code="INVALID_OTP",
            )

        # Atomic single-use consume prevents replay (AUTH-009)
        consumed = await self._container.cache.pop(cache_key)
        if consumed is None:
            raise BusinessRuleError(
                "Verification code was already consumed.",
                error_code="OTP_EXPIRED_OR_INVALID",
            )

        account = await session.scalar(select(AccountModel).where(AccountModel.email == norm_email))
        if account is None or str(account.account_id) != str(challenge["account_id"]):
            raise ResourceNotFoundError("Account not found.")

        if account.status == AccountStatus.ACTIVE.value:
            return {
                "accountId": str(account.account_id),
                "status": account.status,
                "verified": True,
            }
        if account.status != AccountStatus.PENDING_VERIFICATION.value:
            raise ConflictError("Account cannot be verified in its current state.")

        now = utc_now()
        account.status = AccountStatus.ACTIVE.value
        account.last_status_change_at = now
        append_activity_log(
            session,
            event_type="EMAIL_VERIFICATION_SUCCEEDED",
            account_id=account.account_id,
            target_type="ACCOUNT",
            target_id=str(account.account_id),
            ip_address=ip_address,
            details={"new_status": "ACTIVE"},
        )
        await session.commit()
        return {"accountId": str(account.account_id), "status": account.status, "verified": True}

    async def resend_otp(self, session: AsyncSession, *, email: str) -> dict[str, Any]:
        norm_email = normalize_identifier(email)
        cooldown_key = self._otp_resend_key(norm_email)
        if await self._container.cache.get(cooldown_key) is not None:
            raise RateLimitedError(
                "Please wait before requesting another verification code.",
                error_code="OTP_RESEND_COOLDOWN",
            )

        account = await session.scalar(select(AccountModel).where(AccountModel.email == norm_email))
        if account is None or account.status != AccountStatus.PENDING_VERIFICATION.value:
            # Safe response without leaking whether email exists
            return {"sent": True, "otpTtlSeconds": self._settings.otp_ttl_seconds}

        await self._container.cache.delete(self._otp_cache_key(norm_email))
        raw_code = await self._create_and_dispatch_otp(norm_email, account.account_id)
        await self._container.cache.set(
            cooldown_key,
            "1",
            ttl_seconds=self._settings.otp_resend_cooldown_seconds,
        )
        response_data: dict[str, Any] = {
            "sent": True,
            "otpTtlSeconds": self._settings.otp_ttl_seconds,
        }
        if self._settings.app_env == "development" and self._settings.email_dev_log_otp:
            response_data["devOtpPreview"] = raw_code
        return response_data

    async def _resolve_user_summary(
        self, session: AsyncSession, account: AccountModel
    ) -> tuple[AccountRole, dict[str, Any]]:
        admin = await session.scalar(
            select(AdminModel).where(AdminModel.account_id == account.account_id)
        )
        reader = await session.scalar(
            select(ReaderModel).where(ReaderModel.account_id == account.account_id)
        )
        role = AccountRole.ADMIN if admin is not None else AccountRole.READER
        display_name = (
            reader.display_name
            if reader is not None
            else (admin.admin_code if admin is not None else account.username)
        )
        avatar_url = self._resolve_avatar_url(reader) if reader is not None else None
        return role, {
            "accountId": str(account.account_id),
            "username": account.username,
            "email": account.email,
            "displayName": display_name,
            "avatarUrl": avatar_url,
            "role": role.value,
            "status": account.status,
            "adminRoleLevel": admin.role_level if admin is not None else None,
        }

    def _resolve_avatar_url(self, reader: ReaderModel) -> str | None:
        if reader.avatar_bucket and reader.avatar_object_key:
            ref = MediaObjectRef(bucket=reader.avatar_bucket, object_key=reader.avatar_object_key)
            return self._container.media_signer.build_signed_proxy_url(ref)
        return reader.avatar_url

    async def login(
        self,
        session: AsyncSession,
        *,
        identifier: str,
        password: str,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> tuple[dict[str, Any], str]:
        norm_id = normalize_identifier(identifier)
        rl_subject = f"{ip_address or 'unknown'}:{norm_id}"
        rl = await self._container.rate_limiter.check(
            "login",
            rl_subject,
            limit=self._settings.login_rate_limit_max_attempts,
            window_seconds=self._settings.login_rate_limit_window_seconds,
        )
        if not rl.allowed:
            raise RateLimitedError(
                "Too many login attempts. Please wait and try again.",
                error_code="RATE_LIMITED",
            )

        account = await session.scalar(
            select(AccountModel).where(
                or_(AccountModel.email == norm_id, AccountModel.username == norm_id)
            )
        )
        if account is None or not self._container.password_hasher.verify(
            account.password_hash, password
        ):
            if account is not None:
                account.failed_login_attempts += 1
                await session.commit()
            raise AuthenticationRequiredError(
                "Invalid username/email or password.",
                error_code="INVALID_CREDENTIALS",
            )

        if account.status == AccountStatus.LOCKED.value:
            raise AccountLockedError(
                "Your account has been locked by an administrator.",
                details={"reason": account.lock_reason} if account.lock_reason else {},
            )
        if account.status == AccountStatus.PENDING_VERIFICATION.value:
            raise EmailNotVerifiedError(
                "Please verify your email address with OTP before logging in.",
                details={"verificationRequired": True, "email": account.email},
            )

        now = utc_now()
        account.failed_login_attempts = 0
        raw_refresh = generate_opaque_token(32)
        refresh_hash = hash_secret_token(raw_refresh, pepper=self._pepper)
        user_session = UserSessionModel(
            session_id=uuid4(),
            account_id=account.account_id,
            refresh_token_hash=refresh_hash,
            ip_address=ip_address,
            user_agent=(user_agent or "")[:500] or None,
            created_at=now,
            expires_at=now + timedelta(days=self._settings.refresh_token_ttl_days),
        )
        session.add(user_session)
        role, user_summary = await self._resolve_user_summary(session, account)
        append_activity_log(
            session,
            event_type="LOGIN",
            account_id=account.account_id,
            target_type="SESSION",
            target_id=str(user_session.session_id),
            ip_address=ip_address,
            details={"role": role.value},
        )
        await session.commit()

        access_token, expires_in = self._issue_access_jwt(
            account_id=account.account_id,
            session_id=user_session.session_id,
            role=role,
        )
        return (
            {
                "accessToken": access_token,
                "tokenType": "Bearer",
                "expiresInSeconds": expires_in,
                "sessionId": str(user_session.session_id),
                "user": user_summary,
            },
            raw_refresh,
        )

    async def refresh_session(
        self,
        session: AsyncSession,
        *,
        raw_refresh_token: str,
        ip_address: str | None = None,
    ) -> tuple[dict[str, Any], str]:
        token_hash = hash_secret_token(raw_refresh_token, pepper=self._pepper)
        user_session = await session.scalar(
            select(UserSessionModel).where(UserSessionModel.refresh_token_hash == token_hash)
        )
        if user_session is None:
            raise AuthenticationRequiredError(
                "Invalid or rotated refresh token.",
                error_code="SESSION_EXPIRED",
            )

        now = utc_now()
        if user_session.revoked_at is not None:
            # Refresh token reuse detected -> revoke all active sessions for account (AUTH-020)
            await session.execute(
                update(UserSessionModel)
                .where(
                    UserSessionModel.account_id == user_session.account_id,
                    UserSessionModel.revoked_at.is_(None),
                )
                .values(revoked_at=now, revoke_reason="TOKEN_REUSE")
            )
            await session.commit()
            raise AuthenticationRequiredError(
                "Refresh token reuse detected; active sessions revoked.",
                error_code="SESSION_EXPIRED",
            )

        if user_session.expires_at <= now:
            raise AuthenticationRequiredError("Session expired.", error_code="SESSION_EXPIRED")

        account = await session.get(AccountModel, user_session.account_id)
        if account is None or account.status != AccountStatus.ACTIVE.value:
            raise AccountLockedError("Account is not active.")

        new_raw_refresh = generate_opaque_token(32)
        user_session.refresh_token_hash = hash_secret_token(new_raw_refresh, pepper=self._pepper)
        user_session.ip_address = ip_address or user_session.ip_address
        role, user_summary = await self._resolve_user_summary(session, account)
        await session.commit()

        access_token, expires_in = self._issue_access_jwt(
            account_id=account.account_id,
            session_id=user_session.session_id,
            role=role,
        )
        return (
            {
                "accessToken": access_token,
                "tokenType": "Bearer",
                "expiresInSeconds": expires_in,
                "sessionId": str(user_session.session_id),
                "user": user_summary,
            },
            new_raw_refresh,
        )

    async def logout(self, session: AsyncSession, *, principal: SecurityPrincipal) -> None:
        if principal.session_id is None:
            return
        user_session = await session.get(UserSessionModel, principal.session_id)
        if user_session is not None and user_session.revoked_at is None:
            user_session.revoked_at = utc_now()
            user_session.revoke_reason = "LOGOUT"
            await session.commit()

    async def get_profile(
        self,
        session: AsyncSession,
        *,
        viewer: SecurityPrincipal,
        account_id: UUID | None = None,
        username: str | None = None,
    ) -> dict[str, Any]:
        if account_id is not None:
            account = await session.get(AccountModel, account_id)
        elif username is not None:
            account = await session.scalar(
                select(AccountModel).where(AccountModel.username == normalize_identifier(username))
            )
        else:
            raise ValidationAppError("Either account_id or username is required.")

        if account is None:
            raise ResourceNotFoundError("Account not found.")

        reader = await session.get(ReaderModel, account.account_id)
        admin = await session.get(AdminModel, account.account_id)
        is_self = viewer.account_id == account.account_id
        is_privileged = is_self or viewer.is_admin

        birth_date_value: str | None = None
        if (
            reader
            and reader.birth_date is not None
            and (reader.is_birth_date_public or is_privileged)
        ):
            birth_date_value = reader.birth_date.isoformat()

        data: dict[str, Any] = {
            "accountId": str(account.account_id),
            "username": account.username,
            "displayName": (
                reader.display_name if reader else (admin.admin_code if admin else account.username)
            ),
            "avatarUrl": self._resolve_avatar_url(reader) if reader else None,
            "bio": reader.bio if reader else None,
            "birthDate": birth_date_value,
            "isBirthDatePublic": reader.is_birth_date_public if reader else False,
            "role": AccountRole.ADMIN.value if admin else AccountRole.READER.value,
            "status": account.status,
            "createdAt": format_rfc3339(account.created_at),
        }
        if is_privileged:
            data["email"] = account.email
            data["lockReason"] = account.lock_reason
            data["lockedAt"] = format_rfc3339(account.locked_at) if account.locked_at else None
        return data

    async def _get_or_create_reader(
        self,
        session: AsyncSession,
        principal: SecurityPrincipal,
    ) -> ReaderModel:
        assert principal.account_id is not None
        reader = await session.get(ReaderModel, principal.account_id)
        if reader is not None:
            return reader
        account = await session.get(AccountModel, principal.account_id)
        if account is None:
            raise ResourceNotFoundError("Account not found.")
        admin = await session.get(AdminModel, principal.account_id)
        default_display = (admin.admin_code if admin and admin.admin_code else account.username)[
            :100
        ]
        reader = ReaderModel(
            account_id=account.account_id,
            display_name=sanitize_user_text(default_display, preserve_newlines=False),
            is_birth_date_public=False,
        )
        session.add(reader)
        await session.flush()
        return reader

    async def update_profile(
        self,
        session: AsyncSession,
        *,
        principal: SecurityPrincipal,
        display_name: str | None = None,
        bio: str | None = None,
        birth_date: date | None = None,
        is_birth_date_public: bool | None = None,
        ip_address: str | None = None,
    ) -> dict[str, Any]:
        assert principal.account_id is not None
        reader = await self._get_or_create_reader(session, principal)

        if display_name is not None:
            clean_name = display_name.strip()
            if not clean_name or len(clean_name) > 100:
                raise ValidationAppError(
                    "Display name must be 1-100 characters.", details={"field": "displayName"}
                )
            if not principal.is_admin and is_reserved_display_name(clean_name):
                raise ValidationAppError(
                    "Display name contains reserved administrative keywords.",
                    details={"field": "displayName"},
                )
            reader.display_name = sanitize_user_text(clean_name, preserve_newlines=False)

        if bio is not None:
            if len(bio) > 2000:
                raise ValidationAppError(
                    "Bio cannot exceed 2000 characters.", details={"field": "bio"}
                )
            reader.bio = sanitize_user_text(bio, preserve_newlines=True)

        if birth_date is not None:
            today = utc_now().date()
            if birth_date > today:
                raise ValidationAppError(
                    "Birth date cannot be in the future.", details={"field": "birthDate"}
                )
            if birth_date.year < 1900:
                raise ValidationAppError(
                    "Birth date is out of valid range.", details={"field": "birthDate"}
                )
            reader.birth_date = birth_date

        if is_birth_date_public is not None:
            reader.is_birth_date_public = is_birth_date_public

        append_activity_log(
            session,
            event_type="PROFILE_UPDATE",
            account_id=principal.account_id,
            target_type="ACCOUNT",
            target_id=str(principal.account_id),
            ip_address=ip_address,
        )
        await session.commit()
        return await self.get_profile(session, viewer=principal, account_id=principal.account_id)

    async def update_avatar(
        self,
        session: AsyncSession,
        *,
        principal: SecurityPrincipal,
        raw_bytes: bytes,
        ip_address: str | None = None,
    ) -> dict[str, Any]:
        assert principal.account_id is not None
        if len(raw_bytes) == 0:
            raise ValidationAppError("Avatar file cannot be empty.")
        if len(raw_bytes) > self._settings.avatar_max_bytes:
            raise PayloadTooLargeError(
                f"Avatar exceeds max size ({self._settings.avatar_max_bytes} bytes).",
                error_code="UPLOAD_TOO_LARGE",
            )
        try:
            with Image.open(io.BytesIO(raw_bytes)) as img:
                img.verify()
            with Image.open(io.BytesIO(raw_bytes)) as img2:
                fmt = (img2.format or "").upper()
                if fmt not in _ALLOWED_AVATAR_FORMATS:
                    raise ValidationAppError(
                        "Unsupported avatar format. Allowed: JPG, PNG, WebP.",
                        error_code="UNSUPPORTED_MEDIA_TYPE",
                        status_code=415,
                    )
                ext, mime = _ALLOWED_AVATAR_FORMATS[fmt]
                # Re-encode cleanly to strip EXIF/metadata
                out = io.BytesIO()
                save_img = img2.convert("RGBA" if fmt in ("PNG", "WEBP") else "RGB")
                save_img.thumbnail((512, 512))
                save_img.save(out, format=fmt)
                cleaned_bytes = out.getvalue()
        except ValidationAppError:
            raise
        except (UnidentifiedImageError, OSError) as exc:
            raise ValidationAppError(
                "Uploaded file is not a valid JPG, PNG, or WebP image.",
                error_code="UNSUPPORTED_MEDIA_TYPE",
                status_code=415,
            ) from exc

        reader = await self._get_or_create_reader(session, principal)

        ref = MediaObjectRef(
            bucket=self._settings.s3_default_bucket,
            object_key=f"avatars/{principal.account_id}/{uuid4().hex}.{ext}",
        )
        await self._container.storage.put_bytes(ref, cleaned_bytes, content_type=mime)

        reader.avatar_bucket = ref.bucket
        reader.avatar_object_key = ref.object_key
        reader.avatar_url = None
        append_activity_log(
            session,
            event_type="AVATAR_UPDATE",
            account_id=principal.account_id,
            target_type="ACCOUNT",
            target_id=str(principal.account_id),
            ip_address=ip_address,
            details={"bucket": ref.bucket, "object_key": ref.object_key},
        )
        await session.commit()
        return await self.get_profile(session, viewer=principal, account_id=principal.account_id)

    async def change_password(
        self,
        session: AsyncSession,
        *,
        principal: SecurityPrincipal,
        current_password: str,
        new_password: str,
        ip_address: str | None = None,
    ) -> dict[str, Any]:
        assert principal.account_id is not None
        account = await session.get(AccountModel, principal.account_id)
        if account is None:
            raise ResourceNotFoundError("Account not found.")
        if not self._container.password_hasher.verify(account.password_hash, current_password):
            raise ValidationAppError(
                "Current password is incorrect.",
                error_code="INVALID_CURRENT_PASSWORD",
                details={"field": "currentPassword"},
            )
        if len(new_password) < self._settings.password_min_length:
            raise ValidationAppError(
                f"New password must be at least {self._settings.password_min_length} characters.",
                details={"field": "newPassword"},
            )
        if current_password == new_password:
            raise ValidationAppError(
                "New password must be different from current password.",
                details={"field": "newPassword"},
            )

        now = utc_now()
        account.password_hash = self._container.password_hasher.hash(new_password)

        # Revoke all OTHER active sessions (UC-6.3 / AUTH-035)
        revoke_stmt = (
            update(UserSessionModel)
            .where(
                UserSessionModel.account_id == account.account_id,
                UserSessionModel.revoked_at.is_(None),
            )
            .values(revoked_at=now, revoke_reason="PASSWORD_CHANGE")
        )
        if principal.session_id is not None:
            revoke_stmt = revoke_stmt.where(UserSessionModel.session_id != principal.session_id)
        await session.execute(revoke_stmt)

        append_activity_log(
            session,
            event_type="PASSWORD_CHANGE",
            account_id=account.account_id,
            target_type="ACCOUNT",
            target_id=str(account.account_id),
            ip_address=ip_address,
        )
        await session.commit()
        return {"changed": True, "otherSessionsRevoked": True}

    async def admin_list_accounts(
        self,
        session: AsyncSession,
        *,
        q: str | None = None,
        status: str | None = None,
        page: int = 1,
        page_size: int = 24,
    ) -> tuple[list[dict[str, Any]], int]:
        stmt = select(AccountModel)
        count_stmt = select(func.count()).select_from(AccountModel)
        if q:
            like = f"%{normalize_identifier(q)}%"
            cond = or_(AccountModel.username.ilike(like), AccountModel.email.ilike(like))
            stmt = stmt.where(cond)
            count_stmt = count_stmt.where(cond)
        if status:
            stmt = stmt.where(AccountModel.status == status)
            count_stmt = count_stmt.where(AccountModel.status == status)

        total = int(await session.scalar(count_stmt) or 0)
        rows = (
            await session.scalars(
                stmt.order_by(AccountModel.created_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()

        items: list[dict[str, Any]] = []
        for acc in rows:
            role, summary = await self._resolve_user_summary(session, acc)
            _ = role
            summary["lockedAt"] = format_rfc3339(acc.locked_at) if acc.locked_at else None
            summary["lockReason"] = acc.lock_reason
            summary["createdAt"] = format_rfc3339(acc.created_at)
            items.append(summary)
        return items, total

    async def admin_lock_account(
        self,
        session: AsyncSession,
        *,
        admin_principal: SecurityPrincipal,
        target_account_id: UUID,
        reason: str,
        ip_address: str | None = None,
        commit: bool = True,
    ) -> dict[str, Any]:
        assert admin_principal.account_id is not None
        clean_reason = reason.strip()
        if not clean_reason or len(clean_reason) > 500:
            raise ValidationAppError(
                "Lock reason is required (1-500 chars).", details={"field": "reason"}
            )

        target = await session.get(AccountModel, target_account_id)
        if target is None:
            raise ResourceNotFoundError("Target account not found.")

        target_is_admin = await session.get(AdminModel, target_account_id)
        if target_is_admin is not None:
            raise ForbiddenError(
                "Administrator accounts cannot be locked through Reader moderation (UC-1.2)."
            )

        if target.status == AccountStatus.LOCKED.value:
            return {
                "accountId": str(target.account_id),
                "status": target.status,
                "alreadyLocked": True,
            }
        if target.status != AccountStatus.ACTIVE.value:
            raise ConflictError("Only ACTIVE Reader accounts can be locked.")

        now = utc_now()
        previous_status = target.status
        target.status = AccountStatus.LOCKED.value
        target.locked_at = now
        target.locked_by_admin_account_id = admin_principal.account_id
        target.lock_reason = clean_reason
        target.last_status_change_at = now

        # Immediately revoke all active sessions (AUTH-021)
        await session.execute(
            update(UserSessionModel)
            .where(
                UserSessionModel.account_id == target.account_id,
                UserSessionModel.revoked_at.is_(None),
            )
            .values(revoked_at=now, revoke_reason="ACCOUNT_LOCK")
        )
        session.add(
            AccountStatusHistoryModel(
                target_account_id=target.account_id,
                admin_account_id=admin_principal.account_id,
                action_type="LOCK",
                previous_status=previous_status,
                new_status="LOCKED",
                reason=clean_reason,
                action_at=now,
            )
        )
        append_activity_log(
            session,
            event_type="ACCOUNT_LOCK",
            account_id=admin_principal.account_id,
            target_type="ACCOUNT",
            target_id=str(target.account_id),
            ip_address=ip_address,
            details={"reason": clean_reason, "before": previous_status, "after": "LOCKED"},
        )
        await enqueue_outbox_event(
            session,
            idempotency_key=f"account-lock:{target.account_id}:{int(now.timestamp() * 1000)}",
            event_type="ACCOUNT_LOCKED",
            aggregate_type="ACCOUNT",
            aggregate_id=str(target.account_id),
            payload={"reason": clean_reason},
        )
        if commit:
            await session.commit()
            await self._container.email.send(
                EmailMessage(
                    to_email=target.email,
                    subject="Your Manga Reader account has been locked",
                    body_text=f"Reason: {clean_reason}",
                )
            )
        return {
            "accountId": str(target.account_id),
            "status": target.status,
            "alreadyLocked": False,
            "lockedAt": format_rfc3339(now),
            "lockReason": clean_reason,
        }

    async def admin_unlock_account(
        self,
        session: AsyncSession,
        *,
        admin_principal: SecurityPrincipal,
        target_account_id: UUID,
        reason: str,
        ip_address: str | None = None,
    ) -> dict[str, Any]:
        assert admin_principal.account_id is not None
        clean_reason = reason.strip()
        if not clean_reason or len(clean_reason) > 500:
            raise ValidationAppError("Unlock reason/note is required.", details={"field": "reason"})

        target = await session.get(AccountModel, target_account_id)
        if target is None:
            raise ResourceNotFoundError("Target account not found.")
        if target.status != AccountStatus.LOCKED.value:
            raise ConflictError("Target account is not currently LOCKED.")

        now = utc_now()
        target.status = AccountStatus.ACTIVE.value
        target.locked_at = None
        target.locked_by_admin_account_id = None
        target.lock_reason = None
        target.last_status_change_at = now

        session.add(
            AccountStatusHistoryModel(
                target_account_id=target.account_id,
                admin_account_id=admin_principal.account_id,
                action_type="UNLOCK",
                previous_status="LOCKED",
                new_status="ACTIVE",
                reason=clean_reason,
                action_at=now,
            )
        )
        append_activity_log(
            session,
            event_type="ACCOUNT_UNLOCK",
            account_id=admin_principal.account_id,
            target_type="ACCOUNT",
            target_id=str(target.account_id),
            ip_address=ip_address,
            details={"reason": clean_reason, "before": "LOCKED", "after": "ACTIVE"},
        )
        await session.commit()
        await self._container.email.send(
            EmailMessage(
                to_email=target.email,
                subject="Your Manga Reader account has been unlocked",
                body_text=f"Note: {clean_reason}",
            )
        )
        return {"accountId": str(target.account_id), "status": "ACTIVE"}
