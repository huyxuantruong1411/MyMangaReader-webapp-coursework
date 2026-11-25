# Local Development Setup Guide

> **Platform:** Windows 11 (primary tested host) / Linux / macOS  
> **Zero-Credential Start:** The application starts cleanly in default development mode (`sqlite` + `memory` cache + `local-dev` storage + `dev-console` email) without requiring external credentials.

---

## 1. Prerequisites

Verify these tools are installed:

| Tool | Required Version | Verified Host Version |
|---|---|---|
| Git | 2.40+ | `2.51.0.windows.1` |
| Python | `>=3.12,<3.14` | `3.13.0` |
| `uv` | `0.6+` | `0.11.11` |
| Node.js | `>=22.0.0` | `v24.11.1` |
| `pnpm` | `>=10.0.0` | `12.4.2` |
| *(Optional)* SQL Server 2022 + ODBC Driver 17 | Local `QL_DocTruyen` DB | `16.0.1220.3` / ODBC 17 |
| *(Optional)* Memurai / Redis | `127.0.0.1:6379` | Running locally |
| *(Optional)* Docker + MinIO | `127.0.0.1:9010` | `Docker 28.5.1` (`mangalibrary-minio`) |

---

## 2. Environment Configuration

1. Copy `.env.example` to `.env` at the repository root:
   ```powershell
   Copy-Item .env.example .env
   ```
2. **Option A — Zero-Dependency Dev Mode (Default in `.env.example`):**
   - Uses local SQLite (`storage/local-dev/dev.sqlite3`), `InMemoryCacheAdapter`, `LocalDevStorageAdapter`, and `DevConsoleEmailAdapter`.
   - Ready immediately for API startup, frontend preview, migrations, and all unit/integration tests.
3. **Option B — Connect to Existing Local Host Services (SQL Server + Memurai + MinIO + Gmail SMTP):**
   Update these entries in your local `.env` (never commit `.env`):
   ```ini
   DATABASE_BACKEND=mssql
   DATABASE_URL="mssql+aioodbc://@localhost/QL_DocTruyen?driver=ODBC+Driver+17+for+SQL+Server&Trusted_Connection=yes&TrustServerCertificate=yes&MARS_Connection=yes"

   CACHE_BACKEND=redis
   REDIS_URL="redis://127.0.0.1:6379/1"
   REDIS_KEY_PREFIX="mreader:"

   STORAGE_BACKEND=minio
   S3_ENDPOINT_URL="http://127.0.0.1:9010"
   S3_ACCESS_KEY="<your-local-minio-access-key>"
   S3_SECRET_KEY="<your-local-minio-secret-key>"
   S3_DEFAULT_BUCKET="manga-reader-media"

   # Real Gmail SMTP OTP & Account Security Notifications (optional)
   EMAIL_BACKEND="smtp"
   SMTP_SERVER="smtp.gmail.com"
   SMTP_PORT="587"
   SMTP_ACCOUNT="<your-email@gmail.com>"
   SMTP_PASSWORD="<your-16-char-gmail-app-password>"
   SMTP_FROM_ADDRESS="<your-email@gmail.com>"
   EMAIL_DEV_LOG_OTP="false"
   ```
   > **Isolation & Security Notes:**
   > - Always use Redis DB `/1` with prefix `mreader:` and dedicated MinIO bucket `manga-reader-media` (or local shared read-only `manga-media` bucket) so host services stay isolated.
   > - Leaving `SMTP_ACCOUNT` / `SMTP_PASSWORD` empty automatically falls back to `DevConsoleEmailAdapter`; keep `EMAIL_DEV_LOG_OTP="false"` so OTP codes are never leaked to HTTP clients.

Check local service availability anytime:
```powershell
powershell -ExecutionPolicy Bypass -File infrastructure/scripts/check-local-services.ps1
```

---

## 3. Install Dependencies (Drive D: Cache-Safe)

Both package managers keep their caches inside the workspace on Drive `D:` (`.uv-cache/` and `.pnpm-store/`):

```powershell
# 1. Install JS/TS workspace packages (apps/web + packages/contracts)
pnpm install

# 2. Install Python backend dependencies & create apps/api/.venv
uv --project apps/api sync
```

---

## 4. Database Migrations & Seed

> **Warning:** Before running migrations against the pre-existing SQL Server `QL_DocTruyen.mdf`, review `database/documentation/SCHEMA_IMPLEMENTATION_PLAN.md`. On the default local SQLite dev DB, you can run migrations safely anytime:

```powershell
# Apply migrations to configured DATABASE_URL (default: storage/local-dev/dev.sqlite3)
pnpm db:migrate

# Inspect current Alembic revision
pnpm db:current

# Preview offline SQL without mutating any database
pnpm db:migrate:sql

# Run idempotent development foundation seed
pnpm db:seed
```

---

## 5. Run Applications Locally

Open two terminals in `d:\work\TH-PTTK\QL-DocTruyen`:

```powershell
# Terminal 1 — FastAPI backend (http://127.0.0.1:8020)
pnpm dev:api

# Terminal 2 — Vite React frontend (http://127.0.0.1:5173, proxies /api -> :8020)
pnpm dev:web
```

Verify running endpoints:
- Backend Liveness: `http://127.0.0.1:8020/api/v1/health`
- Backend Readiness: `http://127.0.0.1:8020/api/v1/health/ready`
- Backend OpenAPI Docs: `http://127.0.0.1:8020/api/v1/docs`
- Frontend Shell: `http://127.0.0.1:5173/`

---

## 6. Quality Gates (Lint, Format, Typecheck, Test, Build)

```powershell
pnpm lint          # ESLint (contracts + web) + Ruff (api + database + tests)
pnpm format:check  # Prettier + Ruff format check
pnpm typecheck     # tsc --noEmit + mypy --strict
pnpm test          # Vitest (contracts + web) + Pytest (api + cross-component integration)
pnpm build         # TypeScript build (contracts) + Vite production bundle (web)
pnpm check:all     # Run all five gates sequentially
```

---

## 7. System Reference & Codebase Traceability

For detailed architectural, UI, API, and database mapping across the repository:
- [USECASE_CODE_TRACEABILITY.md](../reference/USECASE_CODE_TRACEABILITY.md) — Use Cases `UC-1`..`UC-8` mapped end-to-end across Frontend, API, Services, ORM, and SQL Server Triggers.
- [WEB_UI_CODE_DICTIONARY.md](../reference/WEB_UI_CODE_DICTIONARY.md) — Dictionary of all 23 routes, 4 layouts, modals, drawers, SVG charts, and shared components (`UI-00`..`UI-16`).
- [BACKEND_API_AND_DATABASE_DICTIONARY.md](../reference/BACKEND_API_AND_DATABASE_DICTIONARY.md) — Dictionary of 12 domain modules, HTTP endpoints (`/api/v1/*`), 47 ORM tables + 3 system tables, covering indexes, and 10 T-SQL triggers.
