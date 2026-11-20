# Manga Reader Web Application (`QL-DocTruyen`)

Complete **Full-Stack Modular Monolith** Manga Reader Web Application, built strictly from the consolidated specifications in `docs/agent-plan/` (`Lab8.docx`, `Lab9.docx`, `Lab10.docx`, and `manga-reader-package:2.0` JSON Schema Draft 2020-12).

> **Current Stage:** All Roadmap Phases (`0` → `11`) Implemented & Verified — 47-table Canonical Schema + Alembic Migrations, all 12 Backend Domain Modules, Shared Package v2.0 Contracts, Complete 19-Route React 19 Frontend SPA, End-to-End Acceptance Suite, and Live Full-Stack Verification.

---

## Architecture & Technology Stack

| Layer | Technology | Location |
|---|---|---|
| **Frontend Web SPA** | React 19 + TypeScript (strict) + Vite + React Router v7 + TanStack Query v5 + Tailwind CSS v4 | `apps/web/` |
| **Backend API Monolith** | Python 3.13 + FastAPI + Uvicorn + Pydantic v2 + SQLAlchemy 2.x Async + Pillow + `uv` | `apps/api/` |
| **Shared Data Contract** | `manga-reader-package:2.0` (JSON Schema Draft 2020-12, Ajv2020 + Python `jsonschema`, fixtures) | `packages/contracts/` |
| **Database & Migrations** | SQL Server 2022 (`QL_DocTruyen`) primary + Alembic (`0001` & `0002` 47-table schema) + SQLite local-dev fallback | `database/` |
| **Cache / Storage / Worker** | `CacheAdapter` (Memurai Redis / InMemory), `ObjectStorageAdapter` (MinIO S3 / LocalDev + HMAC Signed Media Proxy), `BackgroundWorkerBoundary` | `apps/api/src/manga_reader/infrastructure/` |
| **CI Pipeline** | GitHub Actions (`contracts-and-web` + `backend-api`) | `.github/workflows/ci.yml` |

---

## Implemented Domain Modules & Capabilities (Phases 1–11)

1. **Canonical 47-Table Schema & Migrations (Phase 1):** All 39 Lab10 tables + ADR reconciliations `M-001`..`M-011` (`reader_progress`, `comments.parent_comment_id`, `comment_edit_histories.previous_is_spoiler`, `manga_deletion_tombstones`, `outbox_events`, `creator_biographies`, `tag_names`, `manga_content_vectors`, `account_status_histories`, `manga_moderation_logs`, `report_action_histories.actor_type`).
2. **Authentication, Security & Profile Management (Phase 2):** Registration + 120s cache-only OTP verification/resend, login throttling, rotating refresh tokens with reuse revocation, live JWT + DB session revocation, profile privacy (`is_birth_date_public`), MIME-verified Pillow avatar upload, password change revoking other sessions, Admin lock/unlock.
3. **Manga Package v2.0 ETL, CDC & Admin Lifecycle (Phase 3):** Strict Draft 2020-12 validation (`ADR-012` optional `chapters`, `ADR-017` dual-role creator deduplication, `ADR-007` localized maps), per-manga isolated batch ETL (`PARTIAL_FAILED` + retry), HMAC CDC webhook ingestion with revision ordering and tombstone resurrection protection, Admin hide/show/delete.
4. **Public Catalog, Advanced Filter, Search & Creators (Phase 4):** Strictly `PUBLIC` + `ACTIVE` visibility scoping, Include/Exclude multi-tag filter (`safe` strictly excludes `unknown`), accent/case-insensitive & fuzzy search, max-10 live autocomplete, deduplicated Creator works, canonical `(chapter_numeric, language, pool_chapter_id)` chapter listing.
5. **Reader Engine, Exact-Page Resume & Signed Media Proxy (Phase 5–6):** Multi-mode canvas (`VERTICAL_WEBTOON`, `SINGLE_PAGE`, `DOUBLE_PAGE` respecting `LTR`/`RTL`), fit modes (`FIT_WIDTH`, `FIT_HEIGHT`, `ORIGINAL`), exact active-page preservation across mode switches, debounced `reader_progress` checkpoints with `pages_revision` fallback, valid-view threshold & F5 deduplication, HMAC-signed `/api/v1/media/{bucket}/{object_key}` streaming proxy (`ADR-018`).
6. **Ratings, Threaded Comments & Reactions (Phase 7):** Chapter-open eligibility gate (`RATING_REQUIRES_READING`), 1–10 ratings with atomic `rating_histories` & `average_rating`, 1-level threaded comments (2000-char limit, HTML escaping), edit history, Admin spoiler lock, soft-delete placeholder `[Bình luận đã bị xóa]`, atomic Like/Dislike/None reactions.
7. **Private Reading Lists & Dynamic Metadata Statistics (Phase 8):** Strictly private owner-only lists (`404` on non-owner), normalized unique names, Clone/Merge with deduplication & `EMPTY_SOURCE_LISTS_CONFIRMATION_REQUIRED`, desired-state membership checklist with inline Quick-Create, dynamic metadata analytics with exact empty copy (`"Danh sách chưa có truyện nào để thống kê"`).
8. **Moderation Reporting, Activity Logs & Analytics (Phase 9):** Account/Manga/Comment reporting (`ignore_all_reports` respected), Admin queue, automatic `SYSTEM` `CLOSED` on missing target (`ADR-020`), atomic resolution delegating domain mutations, immutable activity logs, personal & admin analytics, counter reconciliation.
9. **Recommendations Engine (Phase 10):** 3 distinct methods (`ITEM_BASED`, anonymized `USER_BASED`, TF-IDF `CONTENT_BASED`) with deterministic cold-start fallbacks.
10. **Interactive Frontend SPA (Phase 11):** All 19 routes across Public, Immersive Reader, Authenticated Reader, and Isolated Admin layouts with Dark/Light theme toggle and responsive state components.

---

## Repository Layout

```text
QL-DocTruyen/
├── apps/
│   ├── api/                 # FastAPI modular monolith (12 complete domain modules + tests)
│   └── web/                 # React 19 + Vite SPA (19 interactive routes + components + Vitest suite)
├── packages/
│   └── contracts/           # Pinned manga-reader-package:2.0 JSON Schema Draft 2020-12 + fixtures + Ajv2020
├── database/
│   ├── alembic.ini          # Forward-only migration runner configuration
│   ├── migrations/          # Alembic env.py + revisions 0001 & 0002 (47 canonical tables)
│   ├── seeds/               # Idempotent dev seeder (3 accounts, 5 rich v2.0 manga packages + WebP media)
│   └── documentation/       # 3-way schema reconciliation plan (Lab10 vs QL_DocTruyen vs M-001..M-011)
├── storage/                 # Media identity (bucket + object_key) & storage adapter documentation
├── infrastructure/
│   ├── docker/              # Opt-in dev Compose profiles (protects Drive C:)
│   └── scripts/             # Host service diagnostic script (check-local-services.ps1)
├── tests/
│   ├── integration/         # Contract smoke + full E2E-1..E2E-5 acceptance suite + live SQL Server check
│   └── e2e/                 # Reserved Playwright harness directory
└── docs/
    ├── agent-plan/          # Original 15 authoritative specification files (untouched)
    ├── architecture/        # Assessment, ADR-TECH-STACK, Architecture, Guidelines, Init & Completion Reports
    ├── operations/          # LOCAL_SETUP.md & TROUBLESHOOTING.md
    ├── reference/           # Original Lab8/Lab9/Lab10 docx & drawio
    └── system_dump/         # Existing host machine coursework reference dump
```

---

## Quick Start & Demo Credentials

```powershell
# 1. Create local env file (works out-of-the-box with zero external credentials)
Copy-Item .env.example .env

# 2. Install JS/TS and Python dependencies (caches stay on Drive D:)
pnpm install
uv --project apps/api sync

# 3. Apply canonical 47-table migration & seed local dev data (idempotent)
pnpm db:migrate
pnpm db:seed

# 4. Run backend API (http://127.0.0.1:8020) and web SPA (http://127.0.0.1:5173)
pnpm dev:api
pnpm dev:web
```

### Local Dev Seeded Accounts (`database/seeds/seed_dev.py`)

| Role | Username | Email | Password |
|---|---|---|---|
| **Administrator** | `admin` | `admin@mangareader.local` | `Admin@123456` |
| **Reader 1** | `reader1` | `reader1@mangareader.local` | `Reader@123456` |
| **Reader 2** | `reader2` | `reader2@mangareader.local` | `Reader@123456` |

---

## Engineering Commands

| Command | Description |
|---|---|
| `pnpm dev:api` | Start FastAPI backend with reload on `127.0.0.1:8020` |
| `pnpm dev:web` | Start Vite frontend dev server on `127.0.0.1:5173` (proxies `/api` → `:8020`) |
| `pnpm lint` | Run ESLint (`contracts` + `web`) and Ruff (`api` + `database` + `tests`) |
| `pnpm format:check` | Check formatting with Prettier and `ruff format --check` |
| `pnpm typecheck` | Run `tsc --noEmit` and `mypy --strict` |
| `pnpm test` | Execute Vitest (`contracts`, `web`) and Pytest (`api`, `tests/integration`) |
| `pnpm build` | Compile `@manga-reader/contracts` and build `apps/web` production bundle |
| `pnpm db:migrate` | Run Alembic `upgrade head` |
| `pnpm db:migrate:sql` | Preview generated SQL offline without mutating DB |
| `pnpm db:seed` | Run idempotent development seeder |
| `pnpm check:all` | Run all quality gates (`lint`, `format:check`, `typecheck`, `test`, `build`) |

---

## Key Documentation

- **Architecture & Reports:**
  - `docs/architecture/COMPLETION_REPORT.md`
  - `docs/architecture/INITIALIZATION_REPORT.md`
  - `docs/architecture/REPOSITORY_ASSESSMENT.md`
  - `docs/architecture/ADR-TECH-STACK.md`
  - `docs/architecture/SYSTEM_ARCHITECTURE.md`
  - `docs/architecture/MODULE_BOUNDARIES.md`
  - `docs/architecture/DEVELOPMENT_GUIDELINES.md`
- **Data & Storage:**
  - `database/documentation/SCHEMA_IMPLEMENTATION_PLAN.md`
  - `packages/contracts/README.md`
  - `storage/README.md`
- **Operations:**
  - `docs/operations/LOCAL_SETUP.md`
  - `docs/operations/TROUBLESHOOTING.md`
- **Source of Truth:** `docs/agent-plan/00_README_AGENT_ENTRYPOINT.md` → `14_HANDOFF_MANIFEST.md`
