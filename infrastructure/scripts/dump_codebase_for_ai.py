"""Dump the complete important codebase (Backend + Frontend + Contracts + DB + Tests + Docs)
into structured, AI-ready Markdown files for external architecture review & code auditing.

Usage:
    # Default: generates layered Markdown files (00_AI_AUDIT_INDEX.md .. 09_ARCHITECTURE_DOCS.md)
    # under exports/codebase-dump/
    uv --project apps/api run python infrastructure/scripts/dump_codebase_for_ai.py

    # Also generate a single combined FULL_CODEBASE_DUMP.md file
    uv --project apps/api run python infrastructure/scripts/dump_codebase_for_ai.py --also-single

    # Generate ONLY a single merged Markdown file
    uv --project apps/api run python infrastructure/scripts/dump_codebase_for_ai.py --single-only

    # Exclude architecture docs (source code + tests + configs only)
    uv --project apps/api run python infrastructure/scripts/dump_codebase_for_ai.py --no-docs
"""

from __future__ import annotations

import argparse
import hashlib
import re
import subprocess
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUT_DIR = REPO_ROOT / "exports" / "codebase-dump"

# Directories and patterns strictly excluded from dumps (secrets, binaries, build outputs, caches)
EXCLUDED_DIR_NAMES = frozenset(
    {
        ".git",
        ".venv",
        "venv",
        ".uv-cache",
        "node_modules",
        ".pnpm-store",
        "dist",
        "build",
        "__pycache__",
        ".pytest_cache",
        ".mypy_cache",
        ".ruff_cache",
        "coverage",
        ".vite",
        "exports",
        "local-dev",
        "tmp",
        ".tmp",
    }
)

EXCLUDED_FILE_NAMES = frozenset(
    {
        ".env",
        ".env.local",
        "pnpm-lock.yaml",
        "uv.lock",
        "package-lock.json",
        "yarn.lock",
        ".DS_Store",
        "Thumbs.db",
    }
)

EXCLUDED_EXTENSIONS = frozenset(
    {
        ".pyc",
        ".pyo",
        ".pyd",
        ".sqlite",
        ".sqlite3",
        ".db",
        ".mdf",
        ".ldf",
        ".ndf",
        ".gz",
        ".zip",
        ".tar",
        ".png",
        ".jpg",
        ".jpeg",
        ".webp",
        ".gif",
        ".ico",
        ".svg",
        ".pdf",
        ".docx",
        ".drawio",
        ".woff",
        ".woff2",
        ".ttf",
        ".pem",
        ".key",
        ".tsbuildinfo",
    }
)

LANG_BY_EXT: dict[str, str] = {
    ".py": "python",
    ".ts": "typescript",
    ".tsx": "tsx",
    ".js": "javascript",
    ".jsx": "jsx",
    ".json": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".toml": "toml",
    ".ini": "ini",
    ".css": "css",
    ".html": "html",
    ".md": "markdown",
    ".sql": "sql",
    ".ps1": "powershell",
    ".sh": "bash",
    ".example": "dotenv",
}


@dataclass(frozen=True, slots=True)
class SourceFileEntry:
    rel_path: str
    abs_path: Path
    content: str
    lines: int
    size_bytes: int
    sha256_short: str


@dataclass(slots=True)
class DumpPart:
    filename: str
    title: str
    purpose: str
    files: list[SourceFileEntry] = field(default_factory=list)

    @property
    def total_bytes(self) -> int:
        return sum(f.size_bytes for f in self.files)

    @property
    def total_lines(self) -> int:
        return sum(f.lines for f in self.files)


def _is_excluded(rel_path: Path) -> bool:
    if any(part in EXCLUDED_DIR_NAMES for part in rel_path.parts):
        return True
    name = rel_path.name
    if name in EXCLUDED_FILE_NAMES:
        return True
    if name.startswith(".env.") and name != ".env.example":
        return True
    return rel_path.suffix.lower() in EXCLUDED_EXTENSIONS


def _detect_language(path: Path) -> str:
    if path.name == ".env.example":
        return "dotenv"
    if path.name.lower() == "dockerfile":
        return "dockerfile"
    return LANG_BY_EXT.get(path.suffix.lower(), "text")


def _safe_markdown_fence(content: str) -> str:
    """Return a backtick fence longer than any backtick run inside `content`."""
    runs = [len(m.group(0)) for m in re.finditer(r"`+", content)]
    max_run = max(runs, default=0)
    return "`" * max(3, max_run + 1)


def _load_file(abs_path: Path) -> SourceFileEntry | None:
    rel = abs_path.relative_to(REPO_ROOT)
    if _is_excluded(rel):
        return None
    try:
        raw_bytes = abs_path.read_bytes()
        text = raw_bytes.decode("utf-8")
    except (OSError, UnicodeDecodeError):
        return None
    normalized = text.replace("\r\n", "\n")
    line_count = normalized.count("\n") + (0 if normalized.endswith("\n") or not normalized else 1)
    return SourceFileEntry(
        rel_path=rel.as_posix(),
        abs_path=abs_path,
        content=normalized,
        lines=line_count,
        size_bytes=len(raw_bytes),
        sha256_short=hashlib.sha256(raw_bytes).hexdigest()[:10],
    )


def _collect_paths(patterns: list[str]) -> list[SourceFileEntry]:
    seen: set[str] = set()
    entries: list[SourceFileEntry] = []
    for pat in patterns:
        target = REPO_ROOT / pat
        if target.is_file():
            entry = _load_file(target)
            if entry and entry.rel_path not in seen:
                seen.add(entry.rel_path)
                entries.append(entry)
        elif target.is_dir():
            for child in sorted(target.rglob("*"), key=lambda p: p.as_posix()):
                if child.is_file():
                    entry = _load_file(child)
                    if entry and entry.rel_path not in seen:
                        seen.add(entry.rel_path)
                        entries.append(entry)
    return entries


def _git_recent_commits(limit: int = 12) -> list[str]:
    try:
        proc = subprocess.run(  # noqa: S603
            ["git", "log", f"-n{limit}", "--oneline"],  # noqa: S607
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=True,
            timeout=5,
        )
        return [line.strip() for line in proc.stdout.splitlines() if line.strip()]
    except Exception:
        return []


def build_dump_parts(*, include_docs: bool = True) -> list[DumpPart]:
    """Assemble logically grouped, non-overlapping dump parts covering the whole codebase."""
    claimed: set[str] = set()

    def _claim(entries: list[SourceFileEntry]) -> list[SourceFileEntry]:
        out: list[SourceFileEntry] = []
        for e in entries:
            if e.rel_path not in claimed:
                claimed.add(e.rel_path)
                out.append(e)
        return out

    part_01 = DumpPart(
        filename="01_ROOT_CONFIG_AND_CONTRACTS.md",
        title="Part 01 — Root Configuration, CI/CD, Tooling & Package v2.0 Contracts",
        purpose=(
            "Monorepo workspace orchestration, environment template, CI workflow, build/lint "
            "tooling configs, and the authoritative `manga-reader-package:2.0` JSON Schema "
            "Draft 2020-12 contract package with TypeScript validator and fixtures."
        ),
        files=_claim(
            _collect_paths(
                [
                    "README.md",
                    "package.json",
                    "pnpm-workspace.yaml",
                    ".env.example",
                    ".gitignore",
                    ".github/workflows/ci.yml",
                    "apps/api/pyproject.toml",
                    "apps/web/package.json",
                    "apps/web/vite.config.ts",
                    "apps/web/tsconfig.json",
                    "apps/web/tsconfig.app.json",
                    "apps/web/tsconfig.node.json",
                    "apps/web/eslint.config.js",
                    "packages/contracts",
                ]
            )
        ),
    )

    part_02 = DumpPart(
        filename="02_DATABASE_ORM_MIGRATIONS_AND_SEEDS.md",
        title="Part 02 — Canonical 47-Table ORM Models, Alembic Migrations & Data Importers",
        purpose=(
            "Complete SQLAlchemy 2.x relational schema (all 39 Lab10 tables + ADR M-001..M-011), "
            "dialect-portable GUID/UTCDateTime types, forward-only Alembic migrations (`0001`, "
            "`0002`), dev seeder (`seed_dev.py`), and local `MangaLibrary` + MinIO importer."
        ),
        files=_claim(
            _collect_paths(
                [
                    "database/alembic.ini",
                    "database/migrations",
                    "apps/api/src/manga_reader/infrastructure/orm",
                    "database/seeds",
                ]
            )
        ),
    )

    part_03 = DumpPart(
        filename="03_BACKEND_CORE_API_AND_INFRASTRUCTURE.md",
        title="Part 03 — Backend FastAPI Entrypoint, Config, Common Primitives & Infrastructure",
        purpose=(
            "FastAPI application factory, centralized Pydantic Settings, error hierarchy, "
            "security/JWT/text primitives, API envelopes, live session dependency guards, "
            "cache/storage/HMAC media signer/email/audit/outbox adapters, and worker boundary."
        ),
        files=_claim(
            _collect_paths(
                [
                    "apps/api/src/manga_reader/__init__.py",
                    "apps/api/src/manga_reader/main.py",
                    "apps/api/src/manga_reader/config",
                    "apps/api/src/manga_reader/common",
                    "apps/api/src/manga_reader/api",
                    "apps/api/src/manga_reader/infrastructure",
                    "apps/api/src/manga_reader/workers",
                ]
            )
        ),
    )

    part_04 = DumpPart(
        filename="04_BACKEND_MODULES_AUTH_CATALOG_ETL.md",
        title="Part 04 — Backend Domain Modules: Auth, Manga Lifecycle, Catalog/Search & ETL/CDC",
        purpose=(
            "Modules 1-4: Account/Auth/OTP/Sessions/Profile/Admin Lock (`account_auth`), "
            "Admin Manga Hide/Show/Delete/Tombstone (`manga_creator`), Public Catalog/Include-"
            "Exclude Filter/Search/Autocomplete/Creators (`catalog_discovery`), and Package v2.0 "
            "ETL/CDC Validator/Mapper/Service (`etl_cdc`)."
        ),
        files=_claim(
            _collect_paths(
                [
                    "apps/api/src/manga_reader/modules/__init__.py",
                    "apps/api/src/manga_reader/modules/account_auth",
                    "apps/api/src/manga_reader/modules/manga_creator",
                    "apps/api/src/manga_reader/modules/catalog_discovery",
                    "apps/api/src/manga_reader/modules/etl_cdc",
                ]
            )
        ),
    )

    part_05 = DumpPart(
        filename="05_BACKEND_MODULES_READER_SOCIAL_ADMIN.md",
        title="Part 05 — Backend Domain Modules: Reader Engine, Social, Lists, Moderation & Recs",
        purpose=(
            "Modules 5-12: Reader Engine + Exact Page Progress + Signed Media Proxy + Hybrid "
            "MangaDex/Demo Fallback (`reader_engine`, `reading_status_history`), Eligibility-Gated "
            "Ratings (`ratings`), Threaded Comments & Atomic Reactions (`comments_reactions`), "
            "Private Reading Lists & Dynamic Stats (`reading_lists`), Moderation Reports "
            "(`moderation_reporting`), 3-Method Recommendations (`recommendations`), and "
            "Activity Logs & Admin Analytics (`admin_analytics`)."
        ),
        files=_claim(
            _collect_paths(
                [
                    "apps/api/src/manga_reader/modules/reader_engine",
                    "apps/api/src/manga_reader/modules/reading_status_history",
                    "apps/api/src/manga_reader/modules/ratings",
                    "apps/api/src/manga_reader/modules/comments_reactions",
                    "apps/api/src/manga_reader/modules/reading_lists",
                    "apps/api/src/manga_reader/modules/moderation_reporting",
                    "apps/api/src/manga_reader/modules/recommendations",
                    "apps/api/src/manga_reader/modules/admin_analytics",
                ]
            )
        ),
    )

    part_06 = DumpPart(
        filename="06_FRONTEND_CORE_SERVICES_AND_COMPONENTS.md",
        title="Part 06 — Frontend React Core, Routing, Typed API Client, Auth, Layouts & UI Components",
        purpose=(
            "React 19 + TypeScript + Vite SPA foundation: entrypoints, 19-route router, design "
            "tokens, typed API client & contracts, single-flight refresh auth provider, hooks, "
            "Public/Reader/Authenticated/Admin layout boundaries, and shared interactive components."
        ),
        files=_claim(
            _collect_paths(
                [
                    "apps/web/index.html",
                    "apps/web/src/main.tsx",
                    "apps/web/src/vite-env.d.ts",
                    "apps/web/src/app",
                    "apps/web/src/styles",
                    "apps/web/src/services",
                    "apps/web/src/hooks",
                    "apps/web/src/layouts",
                    "apps/web/src/components",
                ]
            )
        ),
    )

    part_07 = DumpPart(
        filename="07_FRONTEND_FEATURE_PAGES.md",
        title="Part 07 — Frontend Feature Pages (All 19 Interactive User & Admin Screens)",
        purpose=(
            "Complete feature screens: Login/Register/OTP, Home Discovery, Advanced Explore Filter, "
            "Manga & Creator Search, Manga Detail + Threaded Comments, Multi-Mode Chapter Reader "
            "Canvas, Creator Profile, User Profile/History/Settings, Private Reading Lists + "
            "Dynamic Metadata Stats, and Admin Moderation/Analytics Consoles."
        ),
        files=_claim(_collect_paths(["apps/web/src/features"])),
    )

    part_08 = DumpPart(
        filename="08_TESTS_AND_VERIFICATION.md",
        title="Part 08 — Automated Test Suite (Backend Unit/E2E Acceptance, Frontend Vitest, Integration)",
        purpose=(
            "Complete automated verification covering Backend unit tests, Alembic upgrade/downgrade "
            "tests, full E2E-1..E2E-5 acceptance workflows, Frontend Vitest + Testing Library suite, "
            "and cross-component contract integration checks."
        ),
        files=_claim(
            _collect_paths(
                [
                    "apps/api/tests",
                    "apps/web/tests",
                    "tests/integration",
                ]
            )
        ),
    )

    parts = [part_01, part_02, part_03, part_04, part_05, part_06, part_07, part_08]

    if include_docs:
        part_09 = DumpPart(
            filename="09_ARCHITECTURE_AND_SCHEMA_DOCS.md",
            title="Part 09 — Architecture Blueprints, Tech Stack ADRs, Schema Plan & Completion Report",
            purpose=(
                "High-level design rationale, technology ADRs, module boundary rules, 3-way schema "
                "reconciliation plan, storage conventions, and Phase 0-11 completion evidence."
            ),
            files=_claim(
                _collect_paths(
                    [
                        "docs/architecture",
                        "database/documentation",
                        "storage/README.md",
                        "docs/operations",
                    ]
                )
            ),
        )
        parts.append(part_09)

    return parts


def _render_file_block(entry: SourceFileEntry) -> str:
    lang = _detect_language(entry.abs_path)
    fence = _safe_markdown_fence(entry.content)
    body = entry.content if entry.content.endswith("\n") else f"{entry.content}\n"
    return (
        f"---\n\n"
        f"## File: `{entry.rel_path}`\n\n"
        f"- **Lines:** {entry.lines} | **Size:** {entry.size_bytes:,} bytes | "
        f"**SHA-256:** `{entry.sha256_short}`\n\n"
        f"{fence}{lang}\n"
        f"{body}"
        f"{fence}\n\n"
    )


def render_part_markdown(part: DumpPart, *, generated_at: str) -> str:
    est_tokens = part.total_bytes // 4
    toc_lines = [
        f"| `{f.rel_path}` | {f.lines:,} | {f.size_bytes / 1024:.1f} KB | `{f.sha256_short}` |"
        for f in part.files
    ]
    header = (
        f"# {part.title}\n\n"
        f"- **Generated (UTC):** `{generated_at}`\n"
        f"- **Files Included:** {len(part.files)} | **Total Lines:** {part.total_lines:,} | "
        f"**Total Size:** {part.total_bytes / 1024:.1f} KB (~{est_tokens:,} tokens)\n"
        f"- **Purpose:** {part.purpose}\n\n"
        f"## Table of Contents\n\n"
        f"| File Path | Lines | Size | SHA-256 |\n"
        f"|---|---:|---:|---|\n" + "\n".join(toc_lines) + "\n\n"
    )
    return header + "".join(_render_file_block(f) for f in part.files)


def _build_directory_tree(all_files: list[SourceFileEntry]) -> str:
    tree: dict[str, object] = {}
    for entry in all_files:
        cursor = tree
        parts = entry.rel_path.split("/")
        for part_name in parts[:-1]:
            nxt = cursor.setdefault(part_name, {})
            assert isinstance(nxt, dict)
            cursor = nxt
        cursor[parts[-1]] = f"{entry.lines} lines"

    lines: list[str] = ["QL-DocTruyen/"]

    def _walk(node: dict[str, object], prefix: str) -> None:
        items = sorted(node.items(), key=lambda kv: (not isinstance(kv[1], dict), kv[0]))
        for idx, (name, val) in enumerate(items):
            is_last = idx == len(items) - 1
            branch = "└── " if is_last else "├── "
            if isinstance(val, dict):
                lines.append(f"{prefix}{branch}{name}/")
                _walk(val, prefix + ("    " if is_last else "│   "))
            else:
                lines.append(f"{prefix}{branch}{name} ({val})")

    _walk(tree, "")
    return "\n".join(lines)


def render_index_markdown(parts: list[DumpPart], *, generated_at: str) -> str:
    all_files = [f for p in parts for f in p.files]
    total_bytes = sum(p.total_bytes for p in parts)
    total_lines = sum(p.total_lines for p in parts)
    total_tokens = total_bytes // 4
    commits = _git_recent_commits(12)

    manifest_rows = [
        f"| `{p.filename}` | {len(p.files)} | {p.total_lines:,} | "
        f"{p.total_bytes / 1024:.1f} KB | ~{p.total_bytes // 4:,} | {p.purpose} |"
        for p in parts
    ]
    commit_block = (
        "\n".join(f"- `{c}`" for c in commits) if commits else "- *(git log unavailable)*"
    )

    return f"""# AI Codebase Audit Context — Manga Reader Web Application (`QL-DocTruyen`)

- **Generated (UTC):** `{generated_at}`
- **Total Files Dumped:** {len(all_files)} source/config/test/doc files
- **Total Lines:** {total_lines:,} lines
- **Total Raw Size:** {total_bytes / 1024:.1f} KB (~{total_tokens:,} estimated tokens)
- **Safety Filter:** `.env`, private keys, binary DB files (`*.mdf`, `*.sqlite3`), `node_modules/`, `.venv/`, `dist/`, and raw data archives (`docs/system_dump/data_jsonl_gz/`) are **strictly excluded**.

---

## 1. How to Read & Audit This Codebase (For Reviewing AI)

This repository implements a **Production-Oriented Modular Monolith** Manga Reader Web Application derived from consolidated UML/ERD/JSON Schema specifications (`Lab8`, `Lab9`, `Lab10`, `manga-reader-package:2.0` Draft 2020-12):

- **Backend (`apps/api/`):** Python 3.13 + FastAPI + Pydantic v2 + SQLAlchemy 2.x Async + Alembic + Pillow (`uv`). Organized into **12 explicit domain modules** with strict layered separation (`presentation -> application -> domain -> infrastructure`).
- **Frontend (`apps/web/`):** React 19 + TypeScript (strict) + Vite + React Router v7 + TanStack Query v5 + Tailwind CSS v4 (`pnpm`). Implements **19 routes** across 4 isolated layout boundaries (`PublicLayout`, `ReaderShellLayout`, `AuthenticatedLayout`, `AdminLayout`).
- **Shared Contract (`packages/contracts/`):** Pinned JSON Schema Draft 2020-12 (`manga-reader-package:2.0`), TypeScript types, Ajv2020 validator, and valid/invalid fixtures.
- **Database (`database/` + `apps/api/src/manga_reader/infrastructure/orm/`):** Canonical **47-table schema** (39 Lab10 tables + ADR reconciliations `M-001`..`M-011`), runnable on SQLite (local dev/CI) and SQL Server 2022 (`mssql+aioodbc`).
- **Local Reading Mode Notes:**
  - Third-party External ETL/CDC UI is currently toggled **ON HOLD** via `VITE_EXTERNAL_ETL_ENABLED=false` / `EXTERNAL_ETL_ENABLED=false` (backend ETL/CDC engine & tests remain fully implemented and passing).
  - Real local catalog data (`80` popular titles + `80` MinIO covers + `1,291` `vi`/`en` chapters + `76` tags + `119` creators) is imported via `database/seeds/import_local_mangalibrary.py`.
  - Chapter reading uses a **Hybrid Page Engine**: live MangaDex At-Home API proxy + local disk cache when online, automatically falling back to illustrated Pillow WebP demo pages when offline or unavailable.

---

## 2. Dump Files Manifest (Recommended Reading Order)

| Dump File | Files | Lines | Size | Est. Tokens | Contents & Responsibility |
|---|---:|---:|---:|---:|---|
{chr(10).join(manifest_rows)}

---

## 3. Core Architecture & Domain Invariants to Verify During Audit

1. **Visibility & Deletion Scoping:** Public catalog, search, autocomplete, creator works, chapter reader, list statistics, and recommendations MUST strictly enforce `visibility_status = 'PUBLIC'` AND `deletion_status = 'ACTIVE'`.
2. **Content Rating Safety (`safe != unknown`):** Filtering by `contentRating=safe` MUST strictly exclude `unknown`-rated manga.
3. **Auth & Session Security:** OTPs are cache-only (`120s` TTL, never persisted in SQL); refresh tokens are opaque rotated hashes with reuse revocation; Admin account lock & password change immediately revoke sessions enforced live on every JWT request (`api/v1/dependencies.py`).
4. **Media Object Identity (`ADR-018`):** DB persists only canonical `(bucket, object_key)`; `/api/v1/media/{{bucket}}/{{object_key}}` URLs are HMAC-signed at runtime with short TTL and never stored in SQL.
5. **Exact-Page Progress Separation (`ADR-001` / `M-001`):** `reader_progress` stores exact `(chapter_id, page_number, page_uid, pages_revision, client_sequence)` independently from append-only `reading_histories` (which tracks valid-view threshold & F5 deduplication).
6. **Reader Mode Preservation:** Switching between `VERTICAL_WEBTOON`, `SINGLE_PAGE`, and `DOUBLE_PAGE` (`LTR`/`RTL`) preserves the exact active page identity.
7. **Social Integrity:** Ratings require prior chapter-open eligibility (`RATING_REQUIRES_READING`); comments support 1-level replies, HTML sanitization, read-only edit history (`previous_is_spoiler`), Admin spoiler lock, soft-delete placeholder `[Bình luận đã bị xóa]`, and atomic `LIKE`/`DISLIKE`/`null` reactions.
8. **Private Lists & Moderation (`ADR-009`, `ADR-020`):** Reading lists are strictly owner-private (`404` for non-owners), Clone/Merge deduplicates and guards empty sources, empty list stats return `"Danh sách chưa có truyện nào để thống kê"`; reports auto-close via `SYSTEM` actor if target was already deleted.

---

## 4. Included Source Tree

```text
{_build_directory_tree(all_files)}
```

---

## 5. Recent Git History & Verification Gate

Quality gate command verifying the entire repository: `pnpm check:all` (ESLint, Ruff, Prettier, `tsc --noEmit`, `mypy --strict`, Vitest Contracts + Web, Pytest API + E2E Acceptance Suite, production builds).

{commit_block}
"""


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Dump complete important project source code into structured AI-ready Markdown files."
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_OUT_DIR,
        help="Output directory for Markdown dump files (default: exports/codebase-dump).",
    )
    parser.add_argument(
        "--no-docs",
        action="store_true",
        help="Exclude docs/architecture and docs/operations Markdown files from dump.",
    )
    parser.add_argument(
        "--also-single",
        action="store_true",
        help="Also write a single merged FULL_CODEBASE_DUMP.md file in addition to split files.",
    )
    parser.add_argument(
        "--single-only",
        action="store_true",
        help="Write ONLY a single merged FULL_CODEBASE_DUMP.md file (skip split part files).",
    )
    args = parser.parse_args()

    out_dir: Path = args.out.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    # Remove stale generated *.md files in target directory to avoid mixing old dumps
    for old_md in out_dir.glob("*.md"):
        old_md.unlink()

    generated_at = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    parts = build_dump_parts(include_docs=not args.no_docs)
    index_md = render_index_markdown(parts, generated_at=generated_at)

    written_files: list[tuple[Path, int]] = []

    if not args.single_only:
        index_path = out_dir / "00_AI_AUDIT_INDEX.md"
        index_path.write_text(index_md, encoding="utf-8")
        written_files.append((index_path, index_path.stat().st_size))

        for part in parts:
            part_md = render_part_markdown(part, generated_at=generated_at)
            part_path = out_dir / part.filename
            part_path.write_text(part_md, encoding="utf-8")
            written_files.append((part_path, part_path.stat().st_size))

    if args.also_single or args.single_only:
        combined_chunks = [index_md]
        for part in parts:
            combined_chunks.append("\n\n---\n\n")
            combined_chunks.append(render_part_markdown(part, generated_at=generated_at))
        single_path = out_dir / "FULL_CODEBASE_DUMP.md"
        single_path.write_text("".join(combined_chunks), encoding="utf-8")
        written_files.append((single_path, single_path.stat().st_size))

    total_files = sum(len(p.files) for p in parts)
    total_lines = sum(p.total_lines for p in parts)
    print(f"[dump] Exported {total_files} source files ({total_lines:,} lines) -> {out_dir}")
    for path, size in written_files:
        print(f"  - {path.name:<46s} {size / 1024:7.1f} KB (~{size // 4:7,d} tokens)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
