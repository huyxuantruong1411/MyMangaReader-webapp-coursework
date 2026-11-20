"""Typed internal vs. external domain identities.

Critical invariant (`00_README_AGENT_ENTRYPOINT.md` Rule #1, #2, #9):
- Internal DB IDs (`AccountId`, `MangaId`, `ChapterId`) MUST NEVER be conflated
  with external contract IDs (`PoolMangaId`, `PoolChapterId`, `CreatorId`, `PageUid`).
- Slugs, titles, chapter_number display strings, and temporary image URLs are
  NEVER authoritative primary keys.
- Media identity is strictly `(bucket, object_key)` (`MediaObjectRef`).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import NewType
from uuid import UUID

# Internal primary key identities (owned by Reader DB)
AccountId = NewType("AccountId", UUID)
SessionId = NewType("SessionId", UUID)
MangaId = NewType("MangaId", UUID)
ChapterId = NewType("ChapterId", UUID)
MediaId = NewType("MediaId", int)
TagId = NewType("TagId", int)
ListId = NewType("ListId", UUID)
CommentId = NewType("CommentId", UUID)
ReportId = NewType("ReportId", UUID)

# External stable pool/contract identities (owned by Upstream Package v2.0)
PoolMangaId = NewType("PoolMangaId", str)
PoolChapterId = NewType("PoolChapterId", str)
SourceMangaId = NewType("SourceMangaId", str)
SourceChapterId = NewType("SourceChapterId", str)
CreatorId = NewType("CreatorId", str)
PageUid = NewType("PageUid", str)

_SAFE_BUCKET_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$")


@dataclass(frozen=True, slots=True)
class MediaObjectRef:
    """Immutable canonical media identity `(bucket, object_key)` per ADR-018."""

    bucket: str
    object_key: str

    def __post_init__(self) -> None:
        if not _SAFE_BUCKET_RE.match(self.bucket):
            raise ValueError(f"Invalid S3 bucket name: {self.bucket!r}")
        if not self.object_key or self.object_key.startswith("/"):
            raise ValueError(f"Invalid object_key (empty or leading slash): {self.object_key!r}")
        if "\\" in self.object_key or "\x00" in self.object_key:
            raise ValueError(f"Invalid object_key (disallowed control/slash): {self.object_key!r}")
        if any(seg in ("..", ".") for seg in self.object_key.split("/")):
            raise ValueError(f"Path traversal segment rejected in object_key: {self.object_key!r}")

    @property
    def storage_uri(self) -> str:
        """Internal non-HTTP canonical reference string (never exposed as render URL)."""
        return f"s3://{self.bucket}/{self.object_key}"
