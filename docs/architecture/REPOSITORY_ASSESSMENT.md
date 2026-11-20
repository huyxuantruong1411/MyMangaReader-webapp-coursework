# Repository & Environment Assessment (Phase 0)

> **Date:** 2026-11-20  
> **Workspace:** `d:\work\TH-PTTK\QL-DocTruyen`  
> **Assessment Scope:** Phase 0 reconnaissance per `13_IMPLEMENTATION_ROADMAP.md` and Principal Architect initialization protocol.

---

## 1. Executive Summary

The workspace `d:\work\TH-PTTK\QL-DocTruyen` is a **greenfield application repository** containing rich specification artifacts and a pre-created, empty Microsoft SQL Server 2022 database (`QL_DocTruyen`), but **no existing web frontend, backend API, test suite, migration pipeline, Docker setup, CI/CD, or Git history** prior to this initialization.

Additionally, the host machine already runs a mature set of local services (from the adjacent coursework project at `D:\work\Android\coursework\manga_backend`, documented in `docs/system_dump/`) that can be safely leveraged without duplicating heavyweight infrastructure or exhausting drive `C:` disk space.

---

## 2. Existing Workspace Condition

| Path | Condition | Classification | Action Policy |
|---|---|---|---|
| `docs/agent-plan/` | 15 complete Markdown specification files (`00` through `14`) | Authoritative consolidated specification | **Preserve read-only** |
| `docs/reference/` | `Lab8.docx`, `Lab9.docx`, `Lab10.docx`, `drawio/QuanLyDocTruyen.drawio` | Primary academic source documents | **Preserve read-only** |
| `docs/system_dump/` | Complete schema/API/storage dump & ~245 MB `.jsonl.gz` archives from `D:\work\Android\coursework\manga_backend` | Reference & reusable sample data source | **Preserve read-only** (ignore `.jsonl.gz` in Git) |
| `data/QL_DocTruyen.mdf` & `data/QL_DocTruyen_log.ldf` | Attached, `ONLINE` SQL Server 2022 database (~73 MB total, 44 user tables + `sysdiagrams`, 0 rows) | Pre-created local database | **Do NOT overwrite or drop**; exclude binary `.mdf`/`.ldf` from Git; manage forward changes via Alembic migrations after schema reconciliation |
| Application source (`apps/`, `packages/`, `tests/`, `.github/`) | **Absent** | Greenfield | Initialize full production-oriented foundation |
| Git repository (`.git/`) | **Absent prior to initialization** | Greenfield | Initialize `main` branch with clean `.gitignore` and milestone commits |

### 2.1 Source Document Completeness Audit

All 15 files in `docs/agent-plan/` were read in the mandatory canonical order (`00` → `01` → `03` → `04` → `12` → `05` → `06` → `07` → `08` → `09` → `02` → `10` → `11` → `13` → `14`).

**Explicit Missing / Inconsistent Source Findings (Reported per Specification Policy):**
1. **Missing Raw JSON Schema File (`Pasted text(2).txt`):** Referenced by `00_README_AGENT_ENTRYPOINT.md` and `14_HANDOFF_MANIFEST.md` as the original JSON Schema Draft 2020-12 file (`urn:manga-datalake:contract:manga-reader-package:2.0`), this raw text file is **not present** in `d:\work\TH-PTTK\QL-DocTruyen`. However, all root fields, 9 nested `$defs`, required properties, constants, enums, and `additionalProperties: false` constraints are documented in `05_PACKAGE_V2_ETL_CDC.md`. The foundation reconstructs the strict Draft 2020-12 schema strictly from `05_PACKAGE_V2_ETL_CDC.md` in `packages/contracts/schemas/manga-reader-package.v2.0.schema.json` and explicitly flags it for verbatim byte-level verification once the original `Pasted text(2).txt` is dropped in.
2. **Schema Drift Between `Lab10` (39 tables), Live `QL_DocTruyen.mdf` (44 tables), and Canonical ADRs (`M-001`..`M-011`):**
   - `QL_DocTruyen.mdf` already includes 5 tables beyond Lab10's 39-table inventory: `account_status_histories`, `creator_biographies`, `manga_content_vectors`, `manga_moderation_logs`, and `tag_names` (already addressing `M-005` localization!).
   - `QL_DocTruyen.mdf` **diverges** from Lab10/ADRs on several critical points:
     - **Missing `reader_progress` table** (`ADR-001` / `M-001`, Critical).
     - **Missing `comments.parent_comment_id`** (`ADR-008` / `M-002`) and **`comment_edit_histories.previous_is_spoiler`** (`M-003`).
     - **`accounts` uses `locked_until`** rather than `locked_at` + `locked_by_admin_account_id` + `failed_login_attempts` (`ADR-003` / `ADR-019` / `M-008`).
     - **`user_sessions` uses `jwt_token_hash` + `is_active`** instead of `refresh_token_hash` + `user_agent` + `revoke_reason` (conflicts with `00_README_AGENT_ENTRYPOINT.md` Rule #3 & `06_AUTH_SECURITY_MODERATION.md` — never persist raw/hashed JWT access tokens as session refresh identity).
     - **`report_action_histories.admin_account_id` is `NOT NULL`**, conflicting with system auto-close (`ADR-020`).
     - **Missing deletion tombstone / `deletion_status`** (`ADR-011` / `M-007`), **media GC columns** (`M-004`), and **transactional `outbox_events`** (`ADR` Round 3).
   - Full table-by-table reconciliation is recorded in `database/documentation/SCHEMA_IMPLEMENTATION_PLAN.md`.
3. **Unresolved Source Numeric NFRs (`ADR-015`):** Numerous numeric NFRs in `Lab8.docx` (latency budgets, pagination size, password length, avatar max size, valid-view threshold, rate limits) are blank in source documents and must remain centralized, environment-configurable settings labeled as **project targets / dev defaults**, never hardcoded as source requirements.

---

## 3. Host Machine Environment & Installed Tooling

| Category | Tool / Component | Detected Version / Details | Path / Status |
|---|---|---|---|
| **OS & CPU** | Microsoft Windows 11 Pro (x64) | Build `10.0.26200.0`, 12th Gen Intel Core i5-12450H | PowerShell 5.1.26100.9818 |
| **Disk Space** | Drive `C:` / Drive `D:` | **`C:` 14.40 GB free** / **`D:` 67.23 GB free** | **Constraint:** Keep caches, venvs, packages, and volumes on `D:` |
| **Version Control** | Git + Git LFS | `git 2.51.0.windows.1` (`filter.lfs` enabled) | `D:\code\Git\cmd\git.exe` |
| **Python Runtime** | Python + `uv` | `Python 3.13.0`, `uv 0.11.11` | `uv` at `C:\Users\Huy\.local\bin\uv.exe` |
| **Node.js Runtime** | Node.js / npm / pnpm / yarn | `Node v24.11.1`, `npm 11.6.2`, `pnpm 12.4.2`, `yarn 1.22.22` | `Bun`: NOT installed |
| **Other Runtimes** | .NET SDK / Java JDK | `.NET 9.0.205`, `Java 17.0.9` | Installed, not selected for core stack |
| **Container Engine** | Docker Desktop | `Docker 28.5.1` (only `elestio/minio:latest` pulled locally, 241 MB) | Running (`mangalibrary-minio` container up) |
| **DB CLI & Drivers** | `sqlcmd`, ODBC Drivers | `sqlcmd 16.0.1000.6`; `ODBC Driver 17` & `18` for SQL Server | `psql`: NOT on PATH |

---

## 4. Existing Local Infrastructure & Reuse Analysis

Inspecting active Windows services, listening sockets, and `docs/system_dump/` (referencing `D:\work\Android\coursework\manga_backend`) revealed live local infrastructure:

| Service | Host / Port | Current Status | Reusable for `QL-DocTruyen`? | Notes & Isolation Boundary |
|---|---|---|---|---|
| **Microsoft SQL Server 2022 Express** (`MSSQLSERVER`) | `localhost` (`DESKTOP-HKIPI1M`) via Shared Memory / Named Pipes (TCP 1433 currently closed on `127.0.0.1`) | **RUNNING** | **Yes (Primary DB)** | `QL_DocTruyen` DB is already attached & ONLINE. Separate from `MangaLibrary` coursework DB (`3.87M` rows). Connect via `ODBC Driver 17 for SQL Server` + `Trusted_Connection=yes`. |
| **MinIO S3 Storage** (`mangalibrary-minio` Docker container) | S3 API `127.0.0.1:9010`, Console `127.0.0.1:9011` | **RUNNING** | **Yes (Optional Dev S3)** | Uses existing `elestio/minio:latest` image with data bind-mounted on `D:`. Use a dedicated bucket (e.g. `manga-reader-media`) or read-only sample reference to `manga-media` (`1,116` objects, ~1.05 GB) — never mutate coursework objects. |
| **Memurai (Redis-compatible for Windows)** | `127.0.0.1:6379` | **RUNNING** | **Yes (Optional Dev Cache/OTP)** | Native Windows Redis 5/7-compatible server. Use isolated Redis DB index (e.g. `/1` or key prefix `mreader:`) so keys never collide with other projects. |
| **PostgreSQL** (`postgres`) | `0.0.0.0:5432` | **RUNNING** | Optional future target | Not primary locally since `QL_DocTruyen.mdf` is MSSQL, but SQLAlchemy 2.x + Alembic keeps PostgreSQL portability open. |
| **MySQL 8.0** (`MySQL80`) | `::3306` | **RUNNING** | No | Unrelated to project specs. |
| **Coursework `MangaLibrary` DB & `docs/system_dump/`** | SQL Server `MangaLibrary` + `docs/system_dump/` | Available locally | **Read-only Reference & Future ETL Mock Source** | Provides real-world MangaDex-derived catalog metadata (`86,866` manga, `1.78M` chapters, `49,937` creators, `76` tags, `1,097` covers on MinIO) that can feed a future dev External Manga Package v2.0 adapter/seeder in Phase 3 without crawling external sites! |

---

## 5. Detected Limitations & Compatibility Risks

1. **Drive `C:` Low Free Space (14.4 GB):**
   - *Risk:* Pulling heavyweight Docker images (e.g., MSSQL Linux container ~1.5 GB, Postgres, Redis) expands Docker Desktop's `docker_data.vhdx` on `C:`. Default `uv` and `pnpm` caches on `C:` can also consume several GB.
   - *Mitigation:* Reuse native SQL Server (`QL_DocTruyen`), native Memurai (`:6379`), and already-pulled `elestio/minio:latest` (`:9010`). Pin `uv` cache to `apps/api/.uv-cache` on `D:` and document `pnpm` store configuration on `D:`.
2. **SQL Server TCP Port 1433 Closed on `127.0.0.1`:**
   - *Risk:* Pure-TCP Node.js/Docker clients fail to reach `127.0.0.1:1433` unless TCP/IP is enabled in SQL Server Configuration Manager.
   - *Mitigation:* Python `pyodbc`/`aioodbc` with `ODBC Driver 17 for SQL Server` and `SERVER=localhost;Trusted_Connection=yes` connects cleanly over Windows Shared Memory / Named Pipes immediately (verified with `sqlcmd -S localhost -d QL_DocTruyen -E -C`).
3. **Port Collisions with Existing Local Projects:**
   - *Context:* Coursework `manga_backend` notes port `8000` is sometimes used by another project (so it uses `8010`), and MinIO uses `9010`/`9011` because `9000`/`9001` are reserved.
   - *Mitigation:* Configure this app's backend default port cleanly via `API_PORT=8020` (configurable in `.env`) and frontend dev server on `5173` (configurable), avoiding collisions with `8000`, `8010`, `9000`, and `9010`.
4. **Windows Path & Shell Compatibility:**
   - *Risk:* PowerShell 5.1 does not support `&&` chaining; bash-only npm scripts break on Windows.
   - *Mitigation:* Use cross-platform Node/Python CLI invocations in `package.json` and provide native PowerShell helper scripts in `infrastructure/scripts/`.
5. **External Credentials Not Required for Boot:**
   - *Risk:* Requiring live SQL Server, Redis, MinIO, or SMTP credentials just to start or run unit tests blocks CI and developer onboarding.
   - *Mitigation:* Provide explicit dev-safe adapters (`InMemoryCacheAdapter`, `LocalDevStorageAdapter`, `SqliteDevDatabase` fallback for automated test suites, `NoopEmailAdapter`) clearly distinguished from production adapters.

---

## 6. Recommended Project Architecture & Setup Actions

- **Architecture Style:** **Modular Monolith** with clean layer separation (`Presentation/API → Application → Domain → Infrastructure/Persistence`) and 12 explicit domain module boundaries, plus an isolated `workers/` boundary ready for future extraction into a standalone worker process.
- **Selected Stack:**
  - **Backend:** Python 3.13 + FastAPI + Uvicorn + Pydantic v2 + SQLAlchemy 2.x Async + Alembic + `uv` (with `ruff`, `mypy`, `pytest`).
  - **Frontend:** React 19 + TypeScript (strict) + Vite + React Router v7 + TanStack Query + Tailwind CSS v4 + `pnpm` (with `eslint`, `prettier`, `vitest`, Testing Library).
  - **Contracts:** Shared `packages/contracts/` housing the canonical `manga-reader-package:2.0` JSON Schema Draft 2020-12, fixtures, and validators (both TypeScript/Ajv2020 and Python/`jsonschema` Draft202012Validator).
  - **Database:** Microsoft SQL Server 2022 (`QL_DocTruyen`) as local primary engine (via `mssql+aioodbc`), with Alembic migrations (`database/migrations/`) and SQLite (`aiosqlite`) test harness for fast isolated CI testing.
  - **Cache / Storage:** Interface-backed adapters supporting local Memurai Redis (`:6379`) and MinIO (`:9010`), with automatic development-safe fallbacks (`memory` / `local-dev`) when external services are disabled or absent.
- **Immediate Setup Actions:**
  1. Record full technology decisions in `docs/architecture/ADR-TECH-STACK.md`.
  2. Document system topology, 12 module boundaries, and engineering guidelines.
  3. Initialize monorepo structure (`apps/api`, `apps/web`, `packages/contracts`, `database/`, `storage/`, `infrastructure/`, `tests/`, `.github/workflows/`).
  4. Implement foundation infrastructure, JSON Schema v2.0 contract suite, minimal health/readiness endpoints, frontend shell with all 16 placeholder routes, and automated verification suite.
  5. Verify all Quality Gates (A–E) by executing install, lint, format check, typecheck, test, build, and runtime smoke checks, then produce `INITIALIZATION_REPORT.md`.
