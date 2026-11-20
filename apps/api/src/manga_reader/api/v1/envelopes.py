"""Canonical API response envelopes (`10_API_CONTRACTS_AND_EVENTS.md` §1.2)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from manga_reader.common.correlation import get_request_id


class RequestMeta(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    request_id: str = Field(default_factory=get_request_id, serialization_alias="requestId")


class PaginatedMeta(RequestMeta):
    page: int
    page_size: int = Field(serialization_alias="pageSize")
    total: int
    has_next: bool = Field(serialization_alias="hasNext")


class SuccessEnvelope[T](BaseModel):
    data: T
    meta: RequestMeta = Field(default_factory=RequestMeta)


class PaginatedEnvelope[T](BaseModel):
    data: list[T]
    meta: PaginatedMeta


class ErrorBody(BaseModel):
    code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class ErrorEnvelope(BaseModel):
    error: ErrorBody
    meta: RequestMeta = Field(default_factory=RequestMeta)
