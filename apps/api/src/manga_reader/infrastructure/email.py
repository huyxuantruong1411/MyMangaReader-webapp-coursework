"""Outbound email abstraction (Phase 2 OTP, password reset & moderation notifications)."""

from __future__ import annotations

import asyncio
import html
import logging
import smtplib
from dataclasses import dataclass
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Protocol

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class EmailMessage:
    to_email: str
    subject: str
    body_text: str
    contains_sensitive_secret: bool = False
    body_html: str | None = None


def build_otp_email_html(code: str, ttl_seconds: int, action_label: str) -> str:
    """Build a clean, responsive HTML verification/reset OTP email."""
    safe_code = html.escape(code)
    safe_action = html.escape(action_label)
    minutes = max(1, round(ttl_seconds / 60))
    return f"""
    <html>
      <body style="font-family: Arial, sans-serif; background-color: #0f172a; color: #e2e8f0; padding: 24px;">
        <div style="max-width: 520px; margin: 0 auto; background-color: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 24px;">
          <h2 style="margin-top: 0; color: #38bdf8;">Manga Reader (QL-DocTruyen)</h2>
          <p style="font-size: 14px; line-height: 1.5; color: #cbd5e1;">Xin chào,</p>
          <p style="font-size: 14px; line-height: 1.5; color: #cbd5e1;">
            Mã xác nhận OTP để <strong>{safe_action}</strong> của bạn là:
          </p>
          <div style="margin: 20px 0; padding: 14px 20px; text-align: center; background-color: #0f172a; border: 1px solid #38bdf8; border-radius: 8px;">
            <span style="font-family: monospace; font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #38bdf8;">
              {safe_code}
            </span>
          </div>
          <p style="font-size: 13px; color: #94a3b8;">
            Mã này có hiệu lực trong vòng <strong>{ttl_seconds} giây</strong> (~{minutes} phút). Vui lòng không chia sẻ mã này cho bất kỳ ai.
          </p>
          <p style="margin-bottom: 0; font-size: 13px; color: #94a3b8;">
            Trân trọng,<br/>Đội ngũ Manga Reader
          </p>
        </div>
      </body>
    </html>
    """.strip()


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


class SmtpEmailAdapter:
    """SMTP/STARTTLS email adapter for real OTP & account security notifications."""

    def __init__(
        self,
        *,
        host: str,
        port: int,
        username: str,
        password: str,
        from_address: str,
        allow_dev_otp_log: bool = False,
    ) -> None:
        self._host = host
        self._port = port
        self._username = username
        self._password = password
        self._from_address = from_address
        self._allow_dev_otp_log = allow_dev_otp_log
        self._sent: list[EmailMessage] = []

    @property
    def backend_name(self) -> str:
        return "smtp"

    @property
    def adapter_mode(self) -> str:
        return "smtp-tls"

    def _send_sync(self, message: EmailMessage) -> None:
        mime_msg = MIMEMultipart("alternative")
        mime_msg["From"] = self._from_address
        mime_msg["To"] = message.to_email
        mime_msg["Subject"] = message.subject
        mime_msg.attach(MIMEText(message.body_text, "plain", "utf-8"))
        if message.body_html:
            mime_msg.attach(MIMEText(message.body_html, "html", "utf-8"))

        try:
            with smtplib.SMTP(self._host, self._port, timeout=15) as server:
                server.ehlo()
                server.starttls()
                server.ehlo()
                server.login(self._username, self._password)
                server.send_message(mime_msg)
            logger.info(
                "SMTP email sent",
                extra={"recipient_domain": message.to_email.split("@")[-1]},
            )
        except Exception as exc:
            logger.warning(
                "SMTP delivery failed",
                extra={
                    "recipient_domain": message.to_email.split("@")[-1],
                    "error": str(exc),
                },
            )

    async def send(self, message: EmailMessage) -> None:
        self._sent.append(message)
        should_redact = message.contains_sensitive_secret and not self._allow_dev_otp_log
        if not should_redact:
            print(f"[SMTP-EMAIL] To={message.to_email} | {message.subject}")
        await asyncio.to_thread(self._send_sync, message)

    @property
    def sent_messages(self) -> tuple[EmailMessage, ...]:
        return tuple(self._sent)
