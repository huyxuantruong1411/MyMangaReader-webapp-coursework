"""Centralized FastAPI exception handlers returning canonical ErrorEnvelope responses."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from manga_reader.api.v1.envelopes import ErrorBody, ErrorEnvelope, RequestMeta
from manga_reader.common.correlation import get_request_id
from manga_reader.common.errors import AppError

logger = logging.getLogger(__name__)


def _build_error_response(
    *,
    status_code: int,
    code: str,
    message: str,
    details: dict[str, Any] | None = None,
) -> JSONResponse:
    envelope = ErrorEnvelope(
        error=ErrorBody(code=code, message=message, details=details or {}),
        meta=RequestMeta(request_id=get_request_id()),
    )
    return JSONResponse(
        status_code=status_code,
        content=envelope.model_dump(by_alias=True),
    )


def register_exception_handlers(app: FastAPI) -> None:
    """Attach centralized error translation to the FastAPI application."""

    @app.exception_handler(AppError)
    async def handle_app_error(_request: Request, exc: AppError) -> JSONResponse:
        if exc.status_code >= 500:
            logger.error(
                "Application error",
                extra={"error_code": exc.error_code, "status_code": exc.status_code},
            )
        return _build_error_response(
            status_code=exc.status_code,
            code=exc.error_code,
            message=exc.message,
            details=exc.details,
        )

    @app.exception_handler(RequestValidationError)
    async def handle_request_validation_error(
        _request: Request,
        exc: RequestValidationError,
    ) -> JSONResponse:
        field_errors = [
            {
                "loc": [str(part) for part in err.get("loc", ())],
                "message": str(err.get("msg", "Invalid value")),
                "type": str(err.get("type", "validation_error")),
            }
            for err in exc.errors()
        ]
        return _build_error_response(
            status_code=400,
            code="VALIDATION_ERROR",
            message="Request validation failed.",
            details={"errors": field_errors},
        )

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_exception(
        _request: Request,
        exc: StarletteHTTPException,
    ) -> JSONResponse:
        code_map = {
            401: "AUTHENTICATION_REQUIRED",
            403: "FORBIDDEN",
            404: "RESOURCE_NOT_FOUND",
            405: "METHOD_NOT_ALLOWED",
            429: "RATE_LIMITED",
        }
        code = code_map.get(exc.status_code, f"HTTP_{exc.status_code}")
        message = exc.detail if isinstance(exc.detail, str) else "HTTP request error."
        return _build_error_response(
            status_code=exc.status_code,
            code=code,
            message=message,
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_exception(_request: Request, exc: Exception) -> JSONResponse:
        # Never leak stack traces, SQL errors, or secrets to clients
        logger.exception(
            "Unhandled internal exception",
            extra={"error_type": type(exc).__name__},
        )
        return _build_error_response(
            status_code=500,
            code="INTERNAL_SERVER_ERROR",
            message="An unexpected internal error occurred.",
        )
