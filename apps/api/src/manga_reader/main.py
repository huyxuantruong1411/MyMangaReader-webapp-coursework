"""FastAPI application factory and runtime entrypoint."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from manga_reader.api.v1.error_handlers import register_exception_handlers
from manga_reader.api.v1.router import api_v1_router
from manga_reader.config.settings import Settings, get_settings
from manga_reader.infrastructure.container import AppContainer
from manga_reader.infrastructure.logging import configure_logging
from manga_reader.middleware.access_log import StructuredAccessLogMiddleware
from manga_reader.middleware.correlation import CorrelationIdMiddleware

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    """Create a fully wired FastAPI application instance with isolated DI container."""
    resolved_settings = settings or get_settings()
    configure_logging(
        level=resolved_settings.log_level,
        log_format=resolved_settings.log_format,
    )
    container = AppContainer(resolved_settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.container = container
        logger.info(
            "Starting Manga Reader API",
            extra={
                "app_env": resolved_settings.app_env,
                "database_backend": container.db.backend,
                "cache_backend": container.cache.backend_name,
                "storage_backend": container.storage.backend_name,
            },
        )
        await container.startup()
        try:
            yield
        finally:
            await container.shutdown()
            logger.info("Manga Reader API shutdown complete")

    app = FastAPI(
        title=resolved_settings.app_name,
        version=resolved_settings.app_version,
        description=(
            "Production-oriented Modular Monolith Foundation for the Manga Reader Web Application "
            "(QL-DocTruyen)."
        ),
        openapi_url=f"{resolved_settings.api_prefix}/openapi.json",
        docs_url=f"{resolved_settings.api_prefix}/docs",
        redoc_url=f"{resolved_settings.api_prefix}/redoc",
        lifespan=lifespan,
    )
    app.state.container = container

    # Middleware order: outermost runs first (CorrelationId -> AccessLog -> CORS)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=resolved_settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID", "Idempotency-Key"],
        expose_headers=["X-Request-ID"],
    )
    app.add_middleware(StructuredAccessLogMiddleware)
    app.add_middleware(CorrelationIdMiddleware)

    register_exception_handlers(app)
    app.include_router(api_v1_router, prefix=resolved_settings.api_prefix)

    return app


app = create_app()
