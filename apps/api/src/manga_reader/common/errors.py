"""Centralized domain and transport error hierarchy.

Maps directly to the stable error codes in `10_API_CONTRACTS_AND_EVENTS.md` §1.3.
Never attach raw SQL exceptions, stack traces, passwords, OTPs, or tokens to `details`.
"""

from __future__ import annotations

from typing import Any


class AppError(Exception):
    """Base application exception translated by centralized FastAPI error handlers."""

    status_code: int = 500
    error_code: str = "INTERNAL_SERVER_ERROR"
    default_message: str = "An unexpected error occurred."

    def __init__(
        self,
        message: str | None = None,
        *,
        error_code: str | None = None,
        status_code: int | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        self.message = message or self.default_message
        if error_code is not None:
            self.error_code = error_code
        if status_code is not None:
            self.status_code = status_code
        self.details: dict[str, Any] = details or {}
        super().__init__(self.message)


class ValidationAppError(AppError):
    status_code = 400
    error_code = "VALIDATION_ERROR"
    default_message = "Input validation failed."


class AuthenticationRequiredError(AppError):
    status_code = 401
    error_code = "AUTHENTICATION_REQUIRED"
    default_message = "Authentication is required."


class ForbiddenError(AppError):
    status_code = 403
    error_code = "FORBIDDEN"
    default_message = "You do not have permission to perform this action."


class AccountLockedError(AppError):
    status_code = 403
    error_code = "ACCOUNT_LOCKED"
    default_message = "This account is currently locked."


class EmailNotVerifiedError(AppError):
    status_code = 403
    error_code = "EMAIL_NOT_VERIFIED"
    default_message = "Email verification is required before using this feature."


class ResourceNotFoundError(AppError):
    status_code = 404
    error_code = "RESOURCE_NOT_FOUND"
    default_message = "The requested resource was not found."


class ConflictError(AppError):
    status_code = 409
    error_code = "STATE_CONFLICT"
    default_message = "The request conflicts with the current resource state."


class PayloadTooLargeError(AppError):
    status_code = 413
    error_code = "PACKAGE_TOO_LARGE"
    default_message = "The submitted payload exceeds the configured size limit."


class BusinessRuleError(AppError):
    status_code = 422
    error_code = "BUSINESS_RULE_VIOLATION"
    default_message = "The operation violates a domain business rule."


class ContractVersionUnsupportedError(BusinessRuleError):
    error_code = "CONTRACT_VERSION_UNSUPPORTED"
    default_message = "Unsupported manga-reader-package contract version."


class ContractValidationError(BusinessRuleError):
    error_code = "CONTRACT_VALIDATION_FAILED"
    default_message = "Package failed manga-reader-package:2.0 contract validation."


class RateLimitedError(AppError):
    status_code = 429
    error_code = "RATE_LIMITED"
    default_message = "Too many requests. Please try again later."


class UpstreamUnavailableError(AppError):
    status_code = 503
    error_code = "UPSTREAM_UNAVAILABLE"
    default_message = "An upstream dependency is temporarily unavailable."


class StorageUnavailableError(AppError):
    status_code = 503
    error_code = "STORAGE_UNAVAILABLE"
    default_message = "Object storage is temporarily unavailable."
