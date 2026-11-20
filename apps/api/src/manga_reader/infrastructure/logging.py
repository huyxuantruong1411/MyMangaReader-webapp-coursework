"""Structured JSON logging with correlation IDs and automatic secret redaction."""

from __future__ import annotations

import json
import logging
import sys
from typing import Any

from manga_reader.common.clock import format_rfc3339, utc_now
from manga_reader.common.correlation import get_request_id
from manga_reader.common.redaction import redact_mapping, redact_url_secrets


class StructuredJsonFormatter(logging.Formatter):
    """Formats every log record as single-line UTC JSON with secret redaction."""

    _RESERVED_ATTRS = frozenset(
        {
            "args",
            "asctime",
            "created",
            "exc_info",
            "exc_text",
            "filename",
            "funcName",
            "levelname",
            "levelno",
            "lineno",
            "module",
            "msecs",
            "message",
            "msg",
            "name",
            "pathname",
            "process",
            "processName",
            "relativeCreated",
            "stack_info",
            "thread",
            "threadName",
            "taskName",
        }
    )

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": format_rfc3339(utc_now()),
            "level": record.levelname,
            "logger": record.name,
            "request_id": get_request_id(),
            "message": redact_url_secrets(record.getMessage()),
        }
        extras: dict[str, Any] = {
            k: v for k, v in record.__dict__.items() if k not in self._RESERVED_ATTRS
        }
        if extras:
            payload["context"] = redact_mapping(extras)
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str, ensure_ascii=False)


def configure_logging(*, level: str = "INFO", log_format: str = "json") -> None:
    """Configure root logger cleanly without duplicating handlers."""
    root = logging.getLogger()
    root.setLevel(level)
    handler = logging.StreamHandler(sys.stdout)
    if log_format == "json":
        handler.setFormatter(StructuredJsonFormatter())
    else:
        handler.setFormatter(
            logging.Formatter("%(asctime)s [%(levelname)s] %(name)s - %(message)s")
        )
    root.handlers.clear()
    root.addHandler(handler)
    # Reduce noisy third-party loggers while retaining warnings/errors
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
