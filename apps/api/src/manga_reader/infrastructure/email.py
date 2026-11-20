"""Outbound email abstraction (Phase 2 OTP & moderation notifications)."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Protocol

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class EmailMessage:
    to_email: str
    subject: str
    body_text: str
    contains_sensitive_secret: bool = False


class EmailAdapter(Protocol):
    """Port for asynchronous email delivery (consumed by outbox worker)."""

    @property
    def backend_name(self) -> str: ...
    @property
    def adapter_mode(self) -> str: ...
    async def send(self, message: EmailMessage) -> None: ...


class DevConsoleEmailAdapter:
    """Development-safe email sink that redacts sensitive bodies unless dev OTP logging is enabled."""

    def __init__(self, *, allow_dev_otp_log: bool = False) -> None:
        self._allow_dev_otp_log = allow_dev_otp_log
        self._sent: list[EmailMessage] = []

    @property
    def backend_name(self) -> str:
        return "dev-console"

    @property
    def adapter_mode(self) -> str:
        return "dev-fallback"

    async def send(self, message: EmailMessage) -> None:
        self._sent.append(message)
        should_redact = message.contains_sensitive_secret and not self._allow_dev_otp_log
        logger.info(
            "Dev email dispatched",
            extra={
                "recipient_domain": message.to_email.split("@")[-1],
                "subject": message.subject,
                "body_redacted": should_redact,
            },
        )
        if not should_redact:
            print(f"[DEV-EMAIL] To={message.to_email} | {message.subject} | {message.body_text}")

    @property
    def sent_messages(self) -> tuple[EmailMessage, ...]:
        return tuple(self._sent)
