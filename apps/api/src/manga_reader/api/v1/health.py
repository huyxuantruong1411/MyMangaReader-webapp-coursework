"""Liveness and readiness endpoints (`/api/v1/health`, `/api/v1/health/ready`)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from manga_reader.api.v1.dependencies import get_container
from manga_reader.api.v1.envelopes import RequestMeta, SuccessEnvelope
from manga_reader.common.clock import format_rfc3339, utc_now
from manga_reader.infrastructure.container import AppContainer

router = APIRouter(prefix="/health", tags=["Health & Observability"])


class HealthPayload(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    status: str
    service: str
    version: str
    environment: str
    timestamp_utc: str = Field(serialization_alias="timestampUtc")


class ComponentCheck(BaseModel):
    healthy: bool
    backend: str
    mode: str
    detail: str


class ReadinessPayload(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    status: str
    timestamp_utc: str = Field(serialization_alias="timestampUtc")
    components: dict[str, ComponentCheck]


@router.get(
    "",
    response_model=SuccessEnvelope[HealthPayload],
    summary="Application liveness check",
)
async def liveness_check(
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[HealthPayload]:
    payload = HealthPayload(
        status="ok",
        service=container.settings.app_name,
        version=container.settings.app_version,
        environment=container.settings.app_env,
        timestamp_utc=format_rfc3339(utc_now()),
    )
    return SuccessEnvelope(data=payload)


@router.get(
    "/ready",
    response_model=SuccessEnvelope[ReadinessPayload],
    summary="Application readiness check across configured adapters",
)
async def readiness_check(
    container: AppContainer = Depends(get_container),
) -> JSONResponse:
    db_health = await container.db.check_health()
    cache_health = await container.cache.check_health()
    storage_health = await container.storage.check_health()

    components = {
        "database": ComponentCheck(
            healthy=db_health.healthy,
            backend=db_health.backend,
            mode=db_health.mode,
            detail=db_health.detail,
        ),
        "cache": ComponentCheck(
            healthy=cache_health.healthy,
            backend=cache_health.backend,
            mode=cache_health.mode,
            detail=cache_health.detail,
        ),
        "storage": ComponentCheck(
            healthy=storage_health.healthy,
            backend=storage_health.backend,
            mode=storage_health.mode,
            detail=storage_health.detail,
        ),
    }
    all_healthy = all(c.healthy for c in components.values())
    payload = ReadinessPayload(
        status="ready" if all_healthy else "degraded",
        timestamp_utc=format_rfc3339(utc_now()),
        components=components,
    )
    envelope = SuccessEnvelope(data=payload, meta=RequestMeta())
    return JSONResponse(
        status_code=200 if all_healthy else 503,
        content=envelope.model_dump(by_alias=True),
    )
