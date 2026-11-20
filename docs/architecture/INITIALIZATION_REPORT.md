# Project Initialization Report — Manga Reader Web Application (`QL-DocTruyen`)

> **Date:** 2026-11-20  
> **Workspace:** `d:\work\TH-PTTK\QL-DocTruyen`  
> **Status:** All Quality Gates (A, B, C, D, E) **PASSED** with execution evidence.

---

## 1. What Was Inspected

1. **Authoritative Agent Plan (`docs/agent-plan/`):** Read all 15 Markdown specification documents completely in canonical reading order (`00`, `01`, `03`, `04`, `12`, `05`, `06`, `07`, `08`, `09`, `02`, `10`, `11`, `13`, `14`).
2. **Primary References (`docs/reference/`):** Verified presence of `Lab8.docx`, `Lab9.docx`, `Lab10.docx`, and `drawio/QuanLyDocTruyen.drawio`, and checked for embedded JSON Schema text. Confirmed that raw `Pasted text(2).txt` is missing from the workspace (explicitly reported below and in `packages/contracts/README.md`).
3. **Host Infrastructure & Coursework Handoff (`docs/system_dump/` & `D:\work\Android\coursework`):**
   - Inspected `00_START_HERE_AI_CONTEXT.md`, `01_connection_and_storage_access.json`, `03_database_ddl_mssql.sql`, `manga_backend/pyproject.toml`, `manga_backend/app/core/*`, and `manga_backend/services/minio/docker-compose.yml`.
   - Inspected active local services on Windows 11 Pro (`i5-12450H`):
     - **SQL Server 2022 Express (`MSSQLSERVER`)**: Running, with `QL_DocTruyen` ALREADY attached & `ONLINE` (`D:\work\TH-PTTK\QL-DocTruyen\data\QL_DocTruyen.mdf`, 44 user tables + `sysdiagrams`, 0 rows). Audited all 44 tables, columns, PKs, unique constraints, indexes, and CHECK constraints against Lab10's 39-table spec and ADR migrations `M-001`..`M-011`.
     - **Memurai (Redis-compatible server)**: Running on `127.0.0.1:6379`.
     - **MinIO (`mangalibrary-minio`, `elestio/minio:latest`)**: Running on `127.0.0.1:9010` (S3 API) and `127.0.0.1:9011` (Console).
     - **PostgreSQL** (`:5432`) and **MySQL 8.0** (`:3306`): Detected running (not selected as primary local engine).
   - **Host Runtimes & Disk Space:**
     - `Git 2.51.0.windows.1`, `Node.js v24.11.1`, `npm 11.6.2`, `pnpm 12.4.2`, `yarn 1.22.22`, `Python 3.13.0` (`uv` resolved CPython `3.12.13` venv per `>=3.12,<3.14`), `uv 0.11.11`, `Docker 28.5.1`, `sqlcmd 16.0.1000.6`, `ODBC Driver 17 & 18 for SQL Server`, `.NET 9.0.205`, `Java 17.0.9`. (`Bun` and `psql` not installed.)
     - **Disk Space Constraint:** Drive `C:` had `14.40 GB` free vs. Drive `D:` `67.23 GB` free — drove cache pinning (`.uv-cache/`, `.pnpm-store/`) and opt-in Docker profiles on Drive `D:`.

---

## 2. Technology Stack Chosen

| Dimension | Choice |
|---|---|
| **Frontend** | React 19 + TypeScript 5.8 (strict) + Vite 6 + React Router v7 + TanStack Query v5 + Tailwind CSS v4 |
| **Backend** | Python (`>=3.12,<3.14`) + FastAPI + Uvicorn + Pydantic v2 + Pydantic Settings + `uv` |
| **Database & ORM** | Microsoft SQL Server 2022 (`QL_DocTruyen`) local primary + SQLAlchemy 2.x Async (`mssql+aioodbc`, `aiosqlite` dev/test fallback) + PostgreSQL-portable metadata |
| **Migrations** | Alembic (`database/alembic.ini`, `database/migrations/`, forward-only revisions) |
| **Contracts** | Shared `packages/contracts/` housing pinned JSON Schema Draft 2020-12 (`manga-reader-package:2.0`), TypeScript (`ajv/dist/2020`), Python (`jsonschema.Draft202012Validator`), and fixtures |
| **Auth / Security Primitives** | Argon2id (`argon2-cffi`), keyed HMAC-SHA256 for opaque refresh tokens & OTPs, `PyJWT`, server-side RBAC/ownership guards, secret-redacting structured JSON logger |
| **Cache / Storage / Worker** | Protocol-backed `CacheAdapter` (Redis/Memurai + `InMemoryCacheAdapter`), `ObjectStorageAdapter` (MinIO/S3 + `LocalDevStorageAdapter`), `MediaUrlSigner`, `OutboxPublisher`, in-process extractable `BackgroundWorkerBoundary` |
| **Testing & Quality** | `pytest` + `pytest-asyncio` + `httpx` + `ruff` + `mypy --strict`; `vitest` + Testing Library + `jsdom` + `eslint` + `prettier` + `tsc --noEmit` |
| **CI & DevOps** | GitHub Actions (`.github/workflows/ci.yml`), opt-in Docker Compose (`infrastructure/docker/docker-compose.dev.yml`), PowerShell service diagnostics |

---

## 3. Why It Was Chosen

1. **Zero Friction with Existing Local Infrastructure:** `QL_DocTruyen.mdf` is already attached on local Windows-Auth SQL Server 2022 (`ODBC Driver 17`), and local Memurai (`:6379`) + MinIO (`:9010`) are already running. FastAPI + `aioodbc` connects cleanly over Shared Memory/Named Pipes even with TCP 1433 closed, matching the host's proven `manga_backend` stack.
2. **Future ML / Recommendation Readiness:** Phase 10 requires three distinct recommendation engines (Item-Based CF, User-Based CF, Content-Based TF-IDF/cosine similarity) which execute natively in Python without introducing a premature microservice.
3. **Interactive Reader UX:** React + Vite SPA cleanly supports complex stateful reader modes (`VERTICAL_WEBTOON`, `SINGLE_PAGE`, `DOUBLE_PAGE` RTL/LTR, anchor preservation, lazy/prefetch controls) without SSR hydration mismatch overhead.
4. **Drive `C:` Protection:** Avoids pulling gigabytes of redundant DB/broker Docker images onto Drive `C:`; keeps `.uv-cache` and `.pnpm-store` on Drive `D:`.
5. **Reversibility:** Every external infrastructure dependency (DB dialect, cache, object storage, search index, email, worker runner) sits behind explicit Python `Protocol` / TypeScript interfaces.

---

## 4. Architecture Created

- **Layered Modular Monolith** (`Presentation/API -> Application -> Domain <- Infrastructure/Persistence`) with **12 explicit domain module boundaries** under `apps/api/src/manga_reader/modules/`:
  1. `account_auth`
  2. `manga_creator`
  3. `catalog_discovery`
  4. `etl_cdc` *(includes complete `manga-reader-package:2.0` Draft 2020-12 loader, validator, strict Pydantic v2 DTOs, External-to-Internal identity mapper, and ETL pipeline port)*
  5. `reader_engine`
  6. `reading_status_history`
  7. `ratings`
  8. `comments_reactions`
  9. `moderation_reporting`
  10. `reading_lists`
  11. `recommendations`
  12. `admin_analytics`
- **Extractable Worker Boundary:** `apps/api/src/manga_reader/workers/runner.py` handles structured correlation-tracked job execution in-process today and can be split into `apps/worker` later without domain rewrites.
- **API & Observability Foundation:** `/api/v1` versioning, `X-Request-ID` correlation middleware, secret-redacting JSON access/application logging, canonical `{data, meta}` / `{error, meta}` envelopes, centralized exception handlers, OpenAPI 3.1 (`/api/v1/docs`, `/api/v1/openapi.json`), and `/api/v1/health` + `/api/v1/health/ready`.
- **Frontend Foundation Shell:** Design tokens (`tokens.css` with Dark/Light theme toggle), 4 layout boundaries (`PublicLayout`, `AuthenticatedLayout`, `AdminLayout`, `ReaderShellLayout`), reusable state components (`LoadingState`, `EmptyState`, `ErrorState`, `ForbiddenState`, `NotFoundState`), typed `ApiClient` (correlation ID + refresh-lock hook), `AuthProvider`/`useAuth` abstraction, and all 16 required placeholder routes plus 404 fallback.

---

## 5. Key Files and Folders Created

- **Root & Workspace:** `.gitignore`, `.env.example`, `.npmrc`, `package.json`, `pnpm-workspace.yaml`, `README.md`, `.github/workflows/ci.yml`
- **Architecture & Ops Docs (`docs/`):**
  - `docs/architecture/REPOSITORY_ASSESSMENT.md`
  - `docs/architecture/ADR-TECH-STACK.md`
  - `docs/architecture/SYSTEM_ARCHITECTURE.md`
  - `docs/architecture/MODULE_BOUNDARIES.md`
  - `docs/architecture/DEVELOPMENT_GUIDELINES.md`
  - `docs/architecture/INITIALIZATION_REPORT.md`
  - `docs/operations/LOCAL_SETUP.md`
  - `docs/operations/TROUBLESHOOTING.md`
- **Shared Contract Package (`packages/contracts/`):**
  - `README.md`, `package.json`, `tsconfig.json`, `eslint.config.js`, `.prettierrc.json`
  - `schemas/manga-reader-package.v2.0.schema.json`
  - `fixtures/` (5 valid/invalid canonical JSON fixtures)
  - `src/types.ts`, `src/validator.ts`, `src/index.ts`, `tests/contract.test.ts`
- **Backend API (`apps/api/`):**
  - `pyproject.toml`, `uv.lock`
  - `src/manga_reader/main.py`, `config/`, `common/`, `infrastructure/`, `middleware/`, `api/v1/`, `workers/`, and all 12 `modules/*` packages
  - `tests/conftest.py`, `tests/fixtures/mock_providers.py`, `tests/unit/test_foundation_core.py`, `tests/unit/test_contract_v2.py`, `tests/integration/test_app_and_migrations.py`, `tests/integration/test_live_mssql_optional.py`
- **Frontend Web (`apps/web/`):**
  - `package.json`, `tsconfig*.json`, `vite.config.ts`, `vitest.config.ts`, `eslint.config.js`, `.prettierrc.json`, `index.html`
  - `src/main.tsx`, `src/app/`, `src/layouts/`, `src/components/`, `src/features/`, `src/hooks/`, `src/services/`, `src/styles/`
  - `tests/setup.ts`, `tests/App.test.tsx`
- **Database, Storage, Infra, Cross-Tests:**
  - `database/alembic.ini`, `database/migrations/env.py`, `database/migrations/script.py.mako`, `database/migrations/versions/20261120_0001_foundation_bootstrap.py`, `database/seeds/seed_dev.py`, `database/documentation/SCHEMA_IMPLEMENTATION_PLAN.md`
  - `storage/README.md`
  - `infrastructure/docker/docker-compose.dev.yml`, `infrastructure/docker/README.md`, `infrastructure/scripts/check-local-services.ps1`
  - `tests/integration/test_cross_component_contract.py`, `tests/e2e/README.md`

---

## 6. Dependencies Installed

- **JS/TS Workspace (`pnpm install` — 294 packages resolved via `D:\.pnpm-store\v11`):**
  - `@manga-reader/contracts`: `ajv`, `ajv-formats`, `typescript`, `vitest`, `eslint`, `typescript-eslint`, `prettier`
  - `@manga-reader/web`: `react`, `react-dom`, `react-router-dom`, `@tanstack/react-query`, `tailwindcss`, `@tailwindcss/vite`, `vite`, `@vitejs/plugin-react`, `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom`, `eslint`, `prettier`, `typescript`
- **Python Backend (`uv --project apps/api sync` — 70 packages installed in `apps/api/.venv` using `.uv-cache` on `D:`):**
  - Runtime: `fastapi`, `uvicorn`, `pydantic`, `pydantic-settings`, `sqlalchemy`, `alembic`, `aiosqlite`, `aioodbc`, `pyodbc`, `jsonschema`, `redis`, `argon2-cffi`, `pyjwt`
  - Dev: `pytest`, `pytest-asyncio`, `httpx`, `ruff`, `mypy`, `types-jsonschema`

---

## 7. Verification Commands Executed

All commands below were executed directly in `d:\work\TH-PTTK\QL-DocTruyen`:

1. `pnpm install` -> exit `0` (`esbuild` postinstall completed cleanly)
2. `uv --project apps/api sync` -> exit `0` (70 packages installed)
3. `pnpm lint` -> exit `0` (`eslint` contracts + web: 0 errors, 0 warnings; `ruff check`: `All checks passed!`)
4. `pnpm format:check` -> exit `0` (`prettier --check` contracts + web + `ruff format --check` 65 files formatted)
5. `pnpm typecheck` -> exit `0` (`tsc --noEmit` contracts + web; `mypy src`: `Success: no issues found in 53 source files`)
6. `pnpm test` -> exit `0` (38 total tests passed, 0 failed, 0 skipped)
7. `pnpm build` -> exit `0` (`@manga-reader/contracts` `tsc` + `@manga-reader/web` Vite production bundle)
8. `pnpm db:migrate` + `pnpm db:current` + `pnpm db:seed` (run twice for idempotency) + `pnpm db:migrate:sql` -> exit `0`
9. `powershell -ExecutionPolicy Bypass -File infrastructure/scripts/check-local-services.ps1` -> verified SQL Server (`QL_DocTruyen`, 44 user tables), Memurai (`:6379`), and MinIO (`:9010`)
10. Live HTTP server smoke check: booted real `uvicorn` on `127.0.0.1:8020` and `vite` on `127.0.0.1:5173`, verified live HTTP 200 responses from `/api/v1/health`, `/api/v1/health/ready`, and `/`, then cleanly terminated processes.

---

## 8. Test Results Summary

| Suite | Runner | Passed | Failed | Notes |
|---|---|---:|---:|---|
| `@manga-reader/contracts` | `vitest` | **7** | 0 | Draft 2020-12 schema load, full & metadata-only fixtures, unsupported version, extra nested field, non-contiguous pages, `unknown` != `safe` |
| `@manga-reader/web` | `vitest` + Testing Library | **8** | 0 | Home rendering, dynamic params, Auth/Admin layout boundaries, 404 fallback, all 5 UI state primitives |
| `apps/api` + `tests/integration` | `pytest` | **23** | 0 | Env validation, UTC clock, `MediaObjectRef` traversal, Argon2id & token hashing, RBAC/ownership, secret redaction, Contract v2.0 + External-to-Internal identity mapper, `/health`, `/health/ready`, OpenAPI 3.1, centralized error/validation envelopes, Alembic `upgrade head`/`downgrade base`, cross-component contract smoke, and **live read-only SQL Server `QL_DocTruyen` connectivity check** |
| **Total** | | **38** | **0** | Zero warnings, zero skips |

---

## 9. Build Results Summary

- `@manga-reader/contracts`: `tsc -p tsconfig.json` compiled cleanly to `packages/contracts/dist/`.
- `@manga-reader/web`: `tsc -b && vite build` transformed 102 modules and built production bundle in `apps/web/dist/` (`index.html` 0.44 kB, CSS 12.59 kB / 3.53 kB gzip, JS 320.59 kB / 100.61 kB gzip) in `1.05s`.

---

## 10. Known Limitations (Intentional Foundation Scope)

1. **Missing Raw `Pasted text(2).txt`:** `packages/contracts/schemas/manga-reader-package.v2.0.schema.json` was faithfully reconstructed from `docs/agent-plan/05_PACKAGE_V2_ETL_CDC.md`. Verify verbatim against the original file once supplied.
2. **Pre-existing `QL_DocTruyen.mdf` Left Untouched:** To prevent premature destructive mutations before Phase 1 schema decisions are executed, `QL_DocTruyen.mdf` was verified read-only (44 tables intact) while Alembic migrations were verified against isolated SQLite dev/test databases and offline SQL output.
3. **No Premature Business Features:** Auth/OTP flows, ETL/CDC workers, Reader canvas logic, comments, ratings, moderation actions, reading lists, and recommendation models are intentionally deferred to Roadmap Phases 1–10.
4. **Development Fallback Adapters:** Default `.env.example` runs `sqlite`, `InMemoryCacheAdapter`, `LocalDevStorageAdapter`, and `DevConsoleEmailAdapter` (explicitly marked `mode: "dev-fallback"` and blocked in `staging`/`production`).

---

## 11. External Services Requiring Credentials (For Full Local/Prod Mode)

| Service | Env Variables Needed | Dev Fallback Available? |
|---|---|---|
| Local SQL Server `QL_DocTruyen` | `DATABASE_BACKEND=mssql`, `DATABASE_URL` (Windows Auth — no password needed locally) | Yes (`sqlite`) |
| Memurai / Redis | `CACHE_BACKEND=redis`, `REDIS_URL` (no password needed on local Memurai) | Yes (`memory`) |
| MinIO / S3 | `STORAGE_BACKEND=minio`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_ENDPOINT_URL` | Yes (`local-dev`) |
| SMTP Email (OTP & Lock Notices) | `EMAIL_BACKEND=smtp`, `SMTP_HOST`, `SMTP_USERNAME`, `SMTP_PASSWORD` | Yes (`dev-console`) |
| Upstream External Manga Service | `UPSTREAM_SOURCE_BASE_URL`, `UPSTREAM_WEBHOOK_SECRET` | Yes (Mock provider in tests; local `MangaLibrary` coursework dump usable as dev fixture source in Phase 3) |
| Production JWT Signing | `JWT_SECRET_KEY` (>=32 random bytes, non-default) | Dev-only key blocked in staging/prod |

---

## 12. Outstanding Decisions Requiring Product Confirmation

Per `docs/agent-plan/12_ADR_CONFLICTS_AND_RISKS.md` §5 and `database/documentation/SCHEMA_IMPLEMENTATION_PLAN.md`:
1. 7-day lock/unlock rule semantics (`ADR-002`, MVP does not enforce cooldown).
2. Reading list visibility scope (`ADR-009`, MVP defaults private owner-only).
3. Authoritative report reason category lists for `ACCOUNT`, `MANGA`, and `COMMENT`.
4. Valid-view duration threshold and anti-refresh dedupe window (`ADR-016`, currently configurable in `.env`).
5. Reading history and rating retention policy on destructive manga deletion (`ADR-011` / `M-011`).
6. `DOUBLE_PAGE` first/last spread pairing and adjacent chapter language fallback (`07_READER_ENGINE_PROGRESS_MEDIA.md`).
7. Exact target numeric NFRs missing from `Lab8.docx` (`ADR-015`, currently configurable defaults).
8. Reconciliation approval for modifying existing `QL_DocTruyen.mdf` columns (`accounts.locked_until` -> `locked_at`/`locked_by_admin_account_id`/`failed_login_attempts`, `user_sessions.jwt_token_hash` -> `refresh_token_hash`, plus adding `reader_progress`, `comments.parent_comment_id`, `outbox_events`).

---

## 13. Exact Commands for Running the Project

```powershell
# Initial setup (once)
Copy-Item .env.example .env
pnpm install
uv --project apps/api sync
pnpm db:migrate
pnpm db:seed

# Local development (two terminals)
pnpm dev:api        # FastAPI on http://127.0.0.1:8020 (Docs: /api/v1/docs)
pnpm dev:web        # Vite React on http://127.0.0.1:5173

# Verification gates
pnpm check:all      # lint + format:check + typecheck + test + build
```

---

## 14. Recommended Next Roadmap Phase

Proceed to **Phase 1 — Domain Skeleton and Database Integrity** (`docs/agent-plan/13_IMPLEMENTATION_ROADMAP.md` §Phase 1):
1. Confirm the 3-way schema reconciliation in `database/documentation/SCHEMA_IMPLEMENTATION_PLAN.md` (`QL_DocTruyen.mdf` vs. Lab10 vs. `M-001`..`M-011`).
2. Implement SQLAlchemy 2.x ORM models and forward-only Alembic migrations (`M-001` `reader_progress`, `M-002` `comments.parent_comment_id`, `M-003` `previous_is_spoiler`, `M-004` media GC, `M-007` deletion tombstones, `M-008` `accounts`/`user_sessions` security alignment, `M-011` nullable/system report actor & `outbox_events`).
3. Add repository integration tests validating unique constraints, CHECK constraints, FK delete semantics, and transaction boundaries before moving to **Phase 2 (Authentication, Account Lifecycle & RBAC)**.
