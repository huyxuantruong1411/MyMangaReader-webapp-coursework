"""Extractable background worker boundary (`workers/`).

Designed to run in-process for local/MVP workloads while maintaining a clean
application boundary so ETL/CDC/email/GC workers can be extracted to a dedicated
`apps/worker` process without refactoring domain logic.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from manga_reader.common.clock import utc_now
from manga_reader.common.correlation import (
    generate_request_id,
    reset_request_id,
    set_request_id,
)

logger = logging.getLogger(__name__)

JobHandler = Callable[[dict[str, Any]], Awaitable[None]]


@dataclass(frozen=True, slots=True)
class JobExecutionRecord:
    job_name: str
    correlation_id: str
    status: str
    duration_ms: float
    error_type: str | None = None


class BackgroundWorkerBoundary:
    """Registry & structured execution harness for idempotent background jobs."""

    def __init__(self) -> None:
        self._handlers: dict[str, JobHandler] = {}
        self._started: bool = False

    def register(self, job_name: str, handler: JobHandler) -> None:
        if job_name in self._handlers:
            raise ValueError(f"Duplicate worker job handler registration: '{job_name}'")
        self._handlers[job_name] = handler

    @property
    def registered_jobs(self) -> tuple[str, ...]:
        return tuple(sorted(self._handlers.keys()))

    async def start(self) -> None:
        self._started = True
        logger.info(
            "Background worker boundary started (in-process mode)",
            extra={"registered_jobs": list(self.registered_jobs)},
        )

    async def stop(self) -> None:
        self._started = False
        logger.info("Background worker boundary stopped")

    async def execute_once(
        self,
        job_name: str,
        payload: dict[str, Any],
        *,
        correlation_id: str | None = None,
    ) -> JobExecutionRecord:
        handler = self._handlers.get(job_name)
        if handler is None:
            raise KeyError(f"Unknown background job: '{job_name}'")

        trace_id = correlation_id or generate_request_id()
        token = set_request_id(trace_id)
        started_at = utc_now()
        try:
            logger.info("Background job started", extra={"job_name": job_name})
            await handler(payload)
            elapsed_ms = (utc_now() - started_at).total_seconds() * 1000.0
            logger.info(
                "Background job succeeded",
                extra={"job_name": job_name, "duration_ms": round(elapsed_ms, 2)},
            )
            return JobExecutionRecord(
                job_name=job_name,
                correlation_id=trace_id,
                status="SUCCEEDED",
                duration_ms=elapsed_ms,
            )
        except Exception as exc:
            elapsed_ms = (utc_now() - started_at).total_seconds() * 1000.0
            logger.exception(
                "Background job failed",
                extra={
                    "job_name": job_name,
                    "duration_ms": round(elapsed_ms, 2),
                    "error_type": type(exc).__name__,
                },
            )
            return JobExecutionRecord(
                job_name=job_name,
                correlation_id=trace_id,
                status="FAILED",
                duration_ms=elapsed_ms,
                error_type=type(exc).__name__,
            )
        finally:
            reset_request_id(token)
