# Architecture Decision Record: Technology Stack (`ADR-TECH-STACK`)

> **Status:** ACCEPTED (Foundation Baseline)  
> **Date:** 2026-11-20  
> **Context:** Evidence-based technology selection for the Manga Reader Web Application (`QL-DocTruyen`), derived from `docs/agent-plan/*`, `docs/architecture/REPOSITORY_ASSESSMENT.md`, and host environment capabilities.

---

## Summary Matrix

| # | Concern | Chosen Technology | Mandatory / Replaceable |
|---|---|---|---|
| 1 | Frontend Framework | React 19 + Vite + React Router v7 + TanStack Query + Tailwind CSS v4 | Replaceable |
| 2 | Backend Framework | FastAPI + Uvicorn (Python Async ASGI) | Replaceable |
| 3 | Programming Languages | TypeScript 5.x (Frontend & Shared Contracts) + Python 3.13 (Backend & ML/Recs) | Replaceable |
| 4 | Database Engine | Microsoft SQL Server 2022 (`QL_DocTruyen`) local primary; PostgreSQL-portable DDL/ORM | Replaceable (dialect-isolated) |
| 5 | ORM / DB Access | SQLAlchemy 2.x Async (`mssql+aioodbc`, `aiosqlite` for unit/CI tests) | Replaceable |
| 6 | Migration Tool | Alembic (`database/migrations/`, forward-only SQL/Python revisions) | Replaceable |
| 7 | API Communication Style | Versioned REST/JSON (`/api/v1`) + OpenAPI 3.1 auto-generation | Mandatory semantics (`10_API_CONTRACTS_AND_EVENTS.md`), replaceable transport |
| 8 | Authentication Strategy | Short-lived JWT Access Token (with `session_id`/JTI) + Rotating Hashed Refresh Token in `user_sessions` + Argon2id/bcrypt password hashing + Cache-backed OTP (120s TTL) | Mandatory invariants (`06_AUTH_SECURITY_MODERATION.md`), replaceable library |
| 9 | Object Storage Abstraction | `ObjectStorageAdapter` protocol → MinIO S3 (`aioboto3`/`boto3`) + `LocalDevStorageAdapter` | Mandatory identity rule (`bucket + object_key`), replaceable provider |
| 10 | Image Delivery / CDN Strategy | Runtime `MediaUrlSigner` resolving `(bucket, object_key)` → signed S3 URL or authorized backend proxy URL; CDN edge-ready | Mandatory rule (`ADR-018`), replaceable CDN |
| 11 | Background Jobs & Messaging | Transactional Outbox + in-process `WorkerBoundary` (Phase 1–3) → extractable worker process / Redis-backed queue (Phase 3–4+) | Replaceable runner, mandatory outbox/idempotency semantics |
| 12 | Caching Strategy | `CacheAdapter` protocol → Redis/Memurai (`redis.asyncio`) + `InMemoryCacheAdapter` (dev/tests) | Replaceable backend |
| 13 | Search Strategy | Normalized SQL indexed search + SQL FTS / trigram abstraction behind `SearchIndexAdapter` (Phase 5); optional OpenSearch/Meilisearch swap later | Replaceable engine |
| 14 | Testing Stack | Backend: `pytest`, `pytest-asyncio`, `httpx`; Frontend: `vitest`, React Testing Library, `jsdom`; Contracts: `jsonschema` (2020-12) + `ajv` (2020-12) | Replaceable |
| 15 | Dev & Deployment Tooling | `pnpm` workspace (JS/TS), `uv` (Python, `.uv-cache` on `D:`), `ruff` + `mypy`, `eslint` + `prettier`, Docker Compose dev profile, GitHub Actions CI | Replaceable |

---

## Detailed Decisions

### 1. Chosen Frontend Technology: React 19 + Vite + React Router v7 + TanStack Query + Tailwind CSS v4

- **Why Selected:**
  - The Manga Reader UI (`02_SCREEN_FRAME_EVENT_FLOWS.md`) is a highly stateful, client-interactive web application featuring a multi-mode reader canvas (`VERTICAL_WEBTOON`, `SINGLE_PAGE`, `DOUBLE_PAGE` RTL/LTR with IntersectionObserver anchor retention), debounced autocomplete, filter drawers, modals, and live optimistic UI updates.
  - Vite + React SPA cleanly decouples presentation from the FastAPI backend via typed `/api/v1` REST contracts, avoids SSR hydration complexity on viewport-dependent reader layouts, and starts/builds in sub-second times.
  - TanStack Query directly implements the required client/server state separation (`02_SCREEN_FRAME_EVENT_FLOWS.md` §1.2), request cancellation, cache invalidation on mutations, and loading/error/stale states.
  - Matches tooling already used on this machine (`Node v24.11.1`, `pnpm 12.4.2`, Vite + React + TS).
- **Alternatives Considered:**
  - *Next.js (App Router):* Adds a second Node.js server tier and SSR/RSC complexity that duplicates API orchestration already owned by FastAPI, with minimal SEO benefit during foundation/MVP.
  - *Vue 3 / Nuxt / SvelteKit:* Viable, but smaller ecosystem alignment with existing workspace conventions and testing utilities.
- **Advantages / Disadvantages:**
  - *Pros:* Fast HMR, clean SPA deployment (static bundle behind reverse proxy/CDN), strict TypeScript support, clear layout/route guard boundaries, minimal disk footprint.
  - *Cons:* Requires explicit SEO/SSR strategy (or prerendering) only if public search-engine indexing of manga detail pages becomes a hard requirement later.
- **Compatibility with Specifications:** Fully supports all 16+ routes, frame states (loading/empty/error/forbidden/not-found/stale), and screen event flows in `02_SCREEN_FRAME_EVENT_FLOWS.md`.
- **Status:** **Replaceable** (UI consumes versioned `/api/v1` API contracts).

---

### 2. Chosen Backend Technology: FastAPI + Uvicorn (Modular Monolith)

- **Why Selected:**
  - Direct operational alignment with the host environment: Python 3.13 + `uv 0.11.11` are installed, and the local coursework backend (`D:\work\Android\coursework\manga_backend`) already proves FastAPI + SQLAlchemy Async (`aioodbc`) + ODBC Driver 17 works reliably against local Windows-Auth SQL Server.
  - Automatic OpenAPI 3.1 schema generation + strict Pydantic v2 runtime validation align directly with `10_API_CONTRACTS_AND_EVENTS.md`.
  - Native Python ecosystem supports Phase 10's 3 distinct recommendation engines (Item-Based CF, User-Based CF, Content-Based TF-IDF/cosine similarity via `numpy`/`scipy`/`scikit-learn`) without adding a separate ML microservice prematurely.
  - First-class JSON Schema Draft 2020-12 validation (`jsonschema.Draft202012Validator`) for `manga-reader-package:2.0`.
- **Alternatives Considered:**
  - *NestJS / Fastify (TypeScript):* Single-language stack with frontend, but Windows-Auth local SQL Server without TCP 1433 requires native `msnodesqlv8` C++ bindings (fragile on Node 24/Windows), and Phase 10 recommendation ML still requires Python.
  - *ASP.NET Core (.NET 9):* Excellent MSSQL integration, but adds cognitive/tooling overhead alongside Python ML/ETL scripts and diverges from user's proven coursework tooling.
- **Advantages / Disadvantages:**
  - *Pros:* Fast development, strong Pydantic v2 + `mypy` static/runtime typing, native async I/O, unified runtime for API + ETL + Recommendations, automatic OpenAPI docs.
  - *Cons:* Two languages in repo (TypeScript frontend/contracts + Python backend) — mitigated by sharing the canonical JSON Schema v2.0 file and OpenAPI spec as language-neutral contracts.
- **Compatibility with Specifications:** 100% compatible with modular monolith boundaries, RBAC middleware, structured logging, ETL/CDC pipelines, and recommendation requirements.
- **Status:** **Replaceable** (domain rules and contracts are decoupled from HTTP transport).

---

### 3. Chosen Programming Languages: Python 3.13 (Backend) & TypeScript 5.x (Frontend & Shared Contracts)

- **Why Selected:** Both runtimes are installed locally (`Python 3.13.0`, `Node v24.11.1`), support strict static type checking (`mypy --strict` / `tsc --noEmit`), and optimize productivity in their respective domains (UI vs data/ETL/ML backend).
- **Alternatives Considered:** End-to-end TypeScript; C# + TypeScript.
- **Advantages / Disadvantages:** Strong type safety on both tiers; small cross-language contract boundary explicitly enforced via `packages/contracts/` and OpenAPI 3.1.
- **Compatibility:** Full Unicode/UTF-8, ISO-8601 UTC datetime, and JSON Schema Draft 2020-12 support in both languages.
- **Status:** **Replaceable**.

---

### 4. Database Engine: Microsoft SQL Server 2022 (`QL_DocTruyen`) Local Primary (PostgreSQL-Portable)

- **Why Selected:**
  - `D:\work\TH-PTTK\QL-DocTruyen\data\QL_DocTruyen.mdf` is **already created, attached, and ONLINE** in the local SQL Server 2022 Express instance (`MSSQLSERVER`), containing 44 tables derived from Lab10.
  - Lab10 (`04_DATABASE_SCHEMA_AND_MIGRATIONS.md`) specifies SQL Server types (`UNIQUEIDENTIFIER`, `NVARCHAR`, `DATETIME2(3)`, `BIT`, `BIGINT IDENTITY(1,1)`).
  - Avoids spinning up an additional database container on Drive `C:` (which has only 14.4 GB free).
  - SQLAlchemy 2.x + Alembic abstracts dialect specifics so the application can also target PostgreSQL 15+ in cloud Linux deployments or SQLite (`aiosqlite`) in fast CI unit/integration tests.
- **Alternatives Considered:**
  - *PostgreSQL 18 (also running on port 5432 locally):* Strong open-source choice for Linux cloud production, and supported as a future target via SQLAlchemy/Alembic, but switching away from the already-built `QL_DocTruyen.mdf` without justification violates Repository Safety.
  - *MySQL 8.0:* Weaker check-constraint/partial-unique-index ergonomics compared to MSSQL/PostgreSQL.
- **Advantages / Disadvantages:**
  - *Pros:* Zero duplicate DB setup, matches Lab10 natively, supports `DATETIME2(3)`, filtered unique indexes (`WHERE mangadex_id IS NOT NULL`), and full ACID transactions.
  - *Cons:* Windows-Auth local connection requires ODBC Driver 17/18 on Windows; Linux CI tests use SQLite (`aiosqlite`) or containerized MSSQL/PostgreSQL.
- **Compatibility:** Directly matches `04_DATABASE_SCHEMA_AND_MIGRATIONS.md` §10 guidance ("preserve UUID behavior, Unicode, timestamp precision, partial unique indexes, FK deletion rules, JSON constraints and transactions").
- **Status:** **Replaceable** via SQLAlchemy/Alembic dialect layer (schema semantics are mandatory).

---

### 5. ORM / Database Access Strategy: SQLAlchemy 2.x Async + Repository Pattern

- **Why Selected:** SQLAlchemy 2.0 typed `Mapped[...]` declarations provide compile-time type safety with `mypy`, explicit async transaction boundaries (`async with session.begin():`), parameterized SQL (preventing SQL injection per `03_DOMAIN_RULES_AND_STATE_MACHINES.md` §15), and clean separation of domain entities from persistence models via Repository interfaces.
- **Alternatives Considered:** Raw `pyodbc`/SQL queries (high boilerplate, error-prone); Prisma (limited Python/MSSQL Windows-Auth ergonomics); Tortoise ORM (weaker MSSQL/Alembic support).
- **Advantages / Disadvantages:**
  - *Pros:* Mature MSSQL/PostgreSQL/SQLite support, fine-grained transaction/locking (`SELECT ... WITH (UPDLOCK)` / `FOR UPDATE`), zero N+1 via explicit `selectinload`/`joinedload`.
  - *Cons:* Requires discipline not to leak ORM session objects into Domain/Presentation layers — enforced via module boundary rules.
- **Compatibility:** Supports all 39+ tables, composite PKs (`manga_creators`, `manga_tags`), supertype/subtype reports, and explicit transaction boundaries.
- **Status:** **Replaceable** behind module repository protocols.

---

### 6. Migration Tool: Alembic (`database/migrations/`)

- **Why Selected:** Standard forward-only schema migration tool for SQLAlchemy; supports online migrations (`alembic upgrade head`), offline SQL script generation (`alembic upgrade head --sql` for DBA/review), baseline stamping (`alembic stamp`) for the existing `QL_DocTruyen.mdf`, and clean versioned history.
- **Alternatives Considered:** Raw SQL migration scripts (no built-in revision graph); Flyway/Liquibase (requires JVM runtime for DB ops).
- **Advantages / Disadvantages:**
  - *Pros:* Tightly integrated with SQLAlchemy metadata, supports MSSQL batch/explicit DDL operations, auditable forward-only revisions.
  - *Cons:* Auto-generate must always be manually reviewed for MSSQL filtered indexes and CHECK constraints.
- **Compatibility:** Satisfies `00_README_AGENT_ENTRYPOINT.md` Rule §8.4 (forward-only migrations, no out-of-band schema edits).
- **Status:** **Replaceable**.

---

### 7. API Communication Style: Versioned REST/JSON (`/api/v1`) + OpenAPI 3.1

- **Why Selected:** Directly matches `10_API_CONTRACTS_AND_EVENTS.md` (`/api/v1`, standard `{data, meta}` / `{error, meta}` envelopes, HTTP status semantics `400/401/403/404/409/413/415/422/429/502/503`, `Idempotency-Key`, pagination/filtering/sorting conventions, multipart avatar upload, and media streaming).
- **Alternatives Considered:** GraphQL (overkill for binary media delivery, file uploads, webhook receivers, and caching semantics); gRPC (browser incompatibility without proxy).
- **Advantages / Disadvantages:**
  - *Pros:* Native HTTP caching, easy CDN/proxy integration, standard OpenAPI 3.1 tooling, simple debugging.
  - *Cons:* Must prevent over-fetching on catalog cards by using dedicated lightweight card DTOs (`08_CATALOG_SEARCH_RECOMMENDATIONS.md` §1).
- **Compatibility:** Exact match to `10_API_CONTRACTS_AND_EVENTS.md`.
- **Status:** **Mandatory contract semantics**; framework binding is replaceable.

---

### 8. Authentication & Security Strategy

- **Selected Design:**
  - **Password Hashing:** `argon2-cffi` (Argon2id default) with `bcrypt` verification compatibility (via `PasswordHasher` protocol) — never plaintext.
  - **Sessions & Tokens:** Short-lived signed JWT access token carrying `sub` (`account_id`), `sid` (`session_id`), `jti`, `role`, and `exp` ONLY (no PII/email/lock reason). Opaque cryptographically random refresh token whose SHA-256/HMAC hash is stored in `user_sessions.refresh_token_hash` (delivered via `HttpOnly`, `Secure`, `SameSite=Lax` cookie when feasible).
  - **Immediate Lock Enforcement:** Auth middleware verifies JWT signature **and** checks active session revocation + account `ACTIVE` status (via fast cache/DB session lookup) so Admin `LOCKED` immediately invalidates active sessions (`03_DOMAIN_RULES_AND_STATE_MACHINES.md` §3).
  - **OTP Storage (`ADR-004`):** Keyed hash in shared Cache/Redis (Memurai locally, 120-second TTL, atomic single-use consume); **never** written to SQL.
  - **Login Throttling (`ADR-003`):** Separate cache-backed sliding-window/TTL rate limiter (`RateLimiter` protocol) — never mutates `accounts.status = 'LOCKED'`.
- **Alternatives Considered:** Stateless JWT-only (violates immediate Admin account lock revocation invariant); server-side opaque session cookies only (harder for multi-client/mobile extensibility).
- **Compatibility:** Satisfies `06_AUTH_SECURITY_MODERATION.md`, `ADR-003`, `ADR-004`, `ADR-019`.
- **Status:** **Mandatory security invariants**; specific crypto/JWT library is replaceable.

---

### 9. Object Storage Abstraction: `ObjectStorageAdapter` (MinIO S3 + `LocalDevStorageAdapter`)

- **Why Selected:**
  - The host already runs `mangalibrary-minio` (`elestio/minio:latest`) on `127.0.0.1:9010` (S3 API) with bind-mounted storage on `D:`.
  - Defining an `ObjectStorageAdapter` protocol with two adapters — `MinioS3StorageAdapter` (for local MinIO / production S3-compatible storage) and `LocalDevStorageAdapter` (filesystem under `storage/local-dev/` when MinIO is disabled/unavailable) — allows zero-credential startup and deterministic tests while preserving production S3 semantics.
  - Enforces strict bucket allowlist and path-traversal rejection on `object_key` (`05_PACKAGE_V2_ETL_CDC.md` §3.10).
- **Alternatives Considered:** Storing images as SQL `VARBINARY(MAX)` BLOBs (anti-pattern already deprecated in coursework `system_dump`, bloats DB backups and violates `ReaderMediaRef` contract).
- **Compatibility:** Preserves `bucket + object_key` as canonical media identity (`ADR-018`).
- **Status:** **Mandatory identity abstraction**; storage vendor (MinIO / AWS S3 / Cloudflare R2) is replaceable.

---

### 10. Image Delivery / CDN Strategy: Runtime `MediaUrlSigner` (Signed URL / Authorized Proxy)

- **Why Selected:**
  - `ReaderMediaRef` contains only `(bucket, object_key)` and metadata — never a URL (`ADR-018`).
  - `MediaUrlSigner` resolves `(bucket, object_key)` at runtime after enforcing `visibility_status = PUBLIC` into either:
    1. Short-lived S3/CDN presigned URL (`presigned` mode), or
    2. Signed/authorized backend proxy URL (`/api/v1/media/...` in `proxy` mode, ideal for local dev and private buckets behind a CDN).
  - Incorporates `pages_revision` / content hash into immutable cache keys (`07_READER_ENGINE_PROGRESS_MEDIA.md` §5.3).
- **Alternatives Considered:** Persisting external/signed URLs in DB (explicitly forbidden by `ADR-018`).
- **Compatibility:** Full compliance with `07_READER_ENGINE_PROGRESS_MEDIA.md` §5 and `ADR-018`.
- **Status:** **Mandatory runtime resolution rule**; CDN provider is replaceable.

---

### 11. Background Job & Messaging Strategy: Transactional Outbox + Extractable `WorkerBoundary`

- **Why Selected:**
  - Avoids introducing RabbitMQ or Kafka prematurely ("do not introduce infrastructure merely for architectural decoration").
  - Uses a **Transactional Outbox** pattern (`outbox_events` table in Phase 1) combined with an explicit `workers/` application boundary inside `apps/api`:
    - For local development and MVP startup, lightweight in-process async task runner polls/executes idempotent handlers without requiring a separate broker process.
    - When ETL/CDC/email throughput grows (Phase 3–4+), the exact same `workers/` handlers can run as a standalone process (`apps/worker`) consuming from the outbox or Redis/ARQ without changing domain logic.
- **Alternatives Considered:** Celery + RabbitMQ / Kafka from Day 1 (unjustified operational overhead at initialization); raw FastAPI `BackgroundTasks` alone (not durable across process crashes — unsafe for ETL/CDC/audit outbox).
- **Compatibility:** Satisfies `ADR` Round 3 (no network calls inside DB transactions; crash-safe retries, dead-lettering, idempotent replay).
- **Status:** **Replaceable runner**; transactional outbox & idempotency semantics are mandatory.

---

### 12. Caching Strategy: `CacheAdapter` (Memurai/Redis + `InMemoryCacheAdapter`)

- **Why Selected:**
  - `ADR-003` and `ADR-004` explicitly require shared TTL-capable cache for 120s OTP challenges and temporary login throttling (not SQL!).
  - The host machine ALREADY runs **Memurai** (Redis-compatible server) on `127.0.0.1:6379`, giving real Redis behavior locally at zero extra RAM/disk cost (isolated via prefix `mreader:` / DB index `1`).
  - `InMemoryCacheAdapter` provides a clearly-labeled development/test fallback so tests and CI run cleanly without requiring a Redis server.
- **Alternatives Considered:** Storing OTPs or rate limits in SQL (violates `00_README_AGENT_ENTRYPOINT.md` Rule #3 & `ADR-004`); hard-requiring Redis at boot (hurts testability).
- **Compatibility:** Full compliance with `ADR-003`, `ADR-004`, and catalog cache invalidation rules.
- **Status:** **Replaceable adapter**.

---

### 13. Search Strategy: `SearchIndexAdapter` (SQL Normalized Search First, External Engine Pluggable)

- **Why Selected:**
  - `08_CATALOG_SEARCH_RECOMMENDATIONS.md` §3.2 explicitly states: *"Search service may be SQL FTS or engine such as Elasticsearch/OpenSearch; Lab8 describes search engine as example, not mandatory stack."*
  - Avoids introducing Elasticsearch/OpenSearch (heavy RAM + ~1 GB Docker image on low-space `C:`) during initialization.
  - Isolates search behind `SearchIndexAdapter` (outbox-driven indexing on ETL/CDC/hide/show/delete). Initial Phase 5 implementation uses normalized accent-folded/case-folded SQL columns + SQL Server Full-Text Search / fuzzy matching with central `visibility_status = 'PUBLIC'` enforcement; can swap to Meilisearch/OpenSearch later without touching API/UI contracts.
- **Alternatives Considered:** Elasticsearch from Day 1 (premature decoration & excessive resource footprint on local machine).
- **Compatibility:** Supports title + `alt_titles` search, creator search, max 10 autocomplete suggestions, and `PUBLIC` visibility guarantee.
- **Status:** **Replaceable engine**.

---

### 14. Testing Stack

- **Backend (`apps/api`):** `pytest` + `pytest-asyncio` + `httpx` (`ASGITransport`) + `jsonschema` (Draft 2020-12) + `aiosqlite` (isolated fast DB tests) + optional live MSSQL connectivity smoke test.
- **Frontend (`apps/web`):** `vitest` + `@testing-library/react` + `@testing-library/user-event` + `@testing-library/jest-dom` + `jsdom`.
- **Shared Contracts (`packages/contracts`):** `vitest` + `ajv` (`ajv/dist/2020`) + `ajv-formats` validating canonical fixtures against `manga-reader-package.v2.0.schema.json`.
- **E2E (`tests/e2e/`):** Harness prepared for Playwright in Phase 5+ once full user journeys exist.
- **Compatibility:** Maps cleanly to all 9 tiers of the testing pyramid in `11_TEST_STRATEGY_ACCEPTANCE.md`.
- **Status:** **Replaceable**.

---

### 15. Development & Deployment Tooling

- **Python Package Manager:** `uv` (`apps/api/pyproject.toml`, `cache-dir = ".uv-cache"` on `D:`).
- **JS/TS Workspace Manager:** `pnpm` (`pnpm-workspace.yaml` covering `apps/web` and `packages/contracts`).
- **Code Quality:**
  - Python: `ruff` (lint + format check) and `mypy` (strict static typing).
  - TypeScript: `eslint` (flat config), `prettier` (format check), and `tsc --noEmit`.
- **Local Infrastructure:** `infrastructure/docker/docker-compose.dev.yml` (reuses `elestio/minio:latest` with `pull_policy: never` option + opt-in profiles so Drive `C:` is never bloated) + `infrastructure/scripts/check-local-services.ps1`.
- **CI/CD:** `.github/workflows/ci.yml` running contracts tests, backend lint/format/typecheck/tests, and frontend lint/format/typecheck/tests/build on push & PR.
- **Status:** **Replaceable**.
