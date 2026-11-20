# Manga Reader Web Application (`QL-DocTruyen`)

Production-oriented **Modular Monolith Foundation** for the Manga Reader Web Application, built strictly from the consolidated specifications in `docs/agent-plan/` (`Lab8.docx`, `Lab9.docx`, `Lab10.docx`, and `manga-reader-package:2.0` JSON Schema Draft 2020-12).

> **Current Stage:** Project Foundation Initialized (Ready for `13_IMPLEMENTATION_ROADMAP.md` Phase 1 — Schema Reconciliation & Core Domain Migrations).

---

## Architecture & Technology Stack

| Layer | Technology | Location |
|---|---|---|
| **Frontend Web SPA** | React 19 + TypeScript (strict) + Vite + React Router v7 + TanStack Query + Tailwind CSS v4 | `apps/web/` |
| **Backend API Monolith** | Python 3.13 + FastAPI + Uvicorn + Pydantic v2 + SQLAlchemy 2.x Async + `uv` | `apps/api/` |
| **Shared Data Contract** | `manga-reader-package:2.0` (JSON Schema Draft 2020-12, Ajv2020 + Python `jsonschema`, fixtures) | `packages/contracts/` |
| **Database & Migrations** | SQL Server 2022 (`QL_DocTruyen`) primary + Alembic (`database/migrations/`) + SQLite dev/test fallback | `database/` |
| **Cache / Storage / Worker** | `CacheAdapter` (Memurai Redis / InMemory), `ObjectStorageAdapter` (MinIO S3 / LocalDev), `BackgroundWorkerBoundary` | `apps/api/src/manga_reader/infrastructure/` |
| **CI Pipeline** | GitHub Actions (`contracts-and-web` + `backend-api`) | `.github/workflows/ci.yml` |

---

## Repository Layout

```text
QL-DocTruyen/
├── apps/
│   ├── api/                 # FastAPI modular monolith (12 domain modules + extractable workers/)
│   └── web/                 # React 19 + Vite shell (16 placeholder routes + Public/Auth/Admin/Reader layouts)
├── packages/
│   └── contracts/           # Pinned manga-reader-package:2.0 JSON Schema Draft 2020-12 + TS/Python fixtures
├── database/
│   ├── alembic.ini          # Forward-only migration runner configuration
│   ├── migrations/          # Alembic env.py + versioned revisions
│   ├── seeds/               # Idempotent local seed runner
│   └── documentation/       # 3-way schema reconciliation plan (Lab10 vs QL_DocTruyen vs M-001..M-011)
├── storage/                 # Media identity (bucket + object_key) & storage adapter documentation
├── infrastructure/
│   ├── docker/              # Opt-in dev Compose profiles (protects Drive C:)
│   └── scripts/             # Host service diagnostic script (check-local-services.ps1)
├── tests/
│   ├── integration/         # Cross-component contract smoke tests
│   └── e2e/                 # Reserved Playwright E2E harness (E2E-1..E2E-5)
└── docs/
    ├── agent-plan/          # Original 15 authoritative specification files (untouched)
    ├── architecture/        # Assessment, ADR-TECH-STACK, System Architecture, Module Boundaries, Guidelines, Init Report
    ├── operations/          # LOCAL_SETUP.md & TROUBLESHOOTING.md
    ├── reference/           # Original Lab8/Lab9/Lab10 docx & drawio
    └── system_dump/         # Existing host machine coursework reference dump
```

---

## Quick Start

```powershell
# 1. Create local env file (works out-of-the-box without external credentials)
Copy-Item .env.example .env

# 2. Install JS/TS and Python dependencies (caches stay on Drive D:)
pnpm install
uv --project apps/api sync

# 3. Apply foundation migration to dev DB & verify seed
pnpm db:migrate
pnpm db:seed

# 4. Run backend API (http://127.0.0.1:8020) and web shell (http://127.0.0.1:5173)
pnpm dev:api
pnpm dev:web
```

---

## Engineering Commands

| Command | Description |
|---|---|
| `pnpm dev:api` | Start FastAPI backend with reload on `127.0.0.1:8020` |
| `pnpm dev:web` | Start Vite frontend dev server on `127.0.0.1:5173` |
| `pnpm lint` | Run ESLint (`contracts` + `web`) and Ruff (`api` + `database` + `tests`) |
| `pnpm format:check` | Check formatting with Prettier and `ruff format --check` |
| `pnpm typecheck` | Run `tsc --noEmit` and `mypy --strict` |
| `pnpm test` | Execute Vitest (`contracts`, `web`) and Pytest (`api`, `tests/integration`) |
| `pnpm build` | Compile `@manga-reader/contracts` and build `apps/web` production bundle |
| `pnpm db:migrate` | Run Alembic `upgrade head` |
| `pnpm db:migrate:sql` | Preview generated SQL offline without mutating DB |
| `pnpm db:seed` | Run idempotent development foundation seed |
| `pnpm check:all` | Run all quality gates (`lint`, `format:check`, `typecheck`, `test`, `build`) |

---

## Key Documentation

- **Architecture & Decisions:**
  - `docs/architecture/REPOSITORY_ASSESSMENT.md`
  - `docs/architecture/ADR-TECH-STACK.md`
  - `docs/architecture/SYSTEM_ARCHITECTURE.md`
  - `docs/architecture/MODULE_BOUNDARIES.md`
  - `docs/architecture/DEVELOPMENT_GUIDELINES.md`
  - `docs/architecture/INITIALIZATION_REPORT.md`
- **Data & Storage:**
  - `database/documentation/SCHEMA_IMPLEMENTATION_PLAN.md`
  - `packages/contracts/README.md`
  - `storage/README.md`
- **Operations:**
  - `docs/operations/LOCAL_SETUP.md`
  - `docs/operations/TROUBLESHOOTING.md`
- **Source of Truth:** `docs/agent-plan/00_README_AGENT_ENTRYPOINT.md` → `14_HANDOFF_MANIFEST.md`
