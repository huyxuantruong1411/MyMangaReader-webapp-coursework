# Engineering & Development Guidelines

> **Source Alignment:** `00_README_AGENT_ENTRYPOINT.md` (§5, §7, §8, §10), `03_DOMAIN_RULES_AND_STATE_MACHINES.md`, `06_AUTH_SECURITY_MODERATION.md`, `10_API_CONTRACTS_AND_EVENTS.md`.

---

## 1. Non-Negotiable Domain & Engineering Invariants

Every contributor and coding agent must enforce these rules at the server/persistence boundary (never UI-only):

1. **ID Separation:** `account_id`, `manga_id`, `chapter_id` are internal UUIDs; `pool_manga_id`, `pool_chapter_id`, `creator_id`, `page_uid` are external contract identifiers. Never mix them and never use `slug`, `title`, `chapter_number`, or image URLs as primary keys.
2. **Media Identity (`ADR-018`):** Store only `(bucket, object_key)` + verified metadata/hashes in `media_objects`. Generate signed/proxy URLs at runtime.
3. **Public Visibility Guarantee:** Every public catalog, search, autocomplete, creator works, chapter open, recommendation, and reader-facing list endpoint MUST filter `visibility_status = 'PUBLIC'` inside the database query predicate.
4. **Content Rating Safety:** `unknown` is **never** treated as `safe`.
5. **Chapter Ordering (`ADR-013`):** Sort by `(chapter_numeric, language, pool_chapter_id/chapter_id)`. Display `chapter_number` verbatim without parsing strings for ordering.
6. **Security & Secrets:**
   - Never persist raw passwords, raw OTPs, raw refresh tokens, or JWT access tokens.
   - Never log passwords, OTPs, bearer tokens, refresh cookies, or signed media URLs.
   - Admin `LOCKED` status (`accounts.status`) is distinct from temporary cache-backed login throttling (`ADR-003`).
   - Derive acting `account_id` and role strictly from verified server session context; never trust client-supplied owner IDs.
7. **UTC Timestamps:** All timestamps stored in DB, serialized in JSON (RFC 3339 with `Z` / `+00:00`), and emitted in logs MUST use timezone-aware UTC via `common.clock.utc_now()`. Never use naive `datetime.utcnow()` or local server time.
8. **Audit & Soft Deletion:** All privileged Admin mutations emit immutable `activity_logs` records (and `report_action_histories` for moderation). Comments soft-delete; report snapshots and audit histories survive target deletion.
9. **Configurable NFRs (`ADR-015`):** Never hardcode guessed numeric NFRs (page size, debounce, upload limit, password min length, valid-view threshold, rate limits, cache TTL). Read from `config.settings` and document defaults as *dev/project defaults*, not source requirements.
10. **Contract Strictness:** Never add arbitrary fields to `manga-reader-package:2.0`. Missing optional root `chapters` means metadata-only update, NEVER chapter deletion (`ADR-012`).

---

## 2. Coding, Naming & Import Conventions

### Python (`apps/api`)
- **Formatting & Linting:** `ruff format` and `ruff check` (line length 100, Python 3.13 target, import sorting enabled).
- **Static Typing:** `mypy` strict mode across `src/manga_reader`. All public functions, DTOs, and repository protocols require explicit type annotations.
- **Naming:**
  - Files & modules: `snake_case`
  - Classes, Pydantic schemas, TypedDicts, Protocols: `PascalCase`
  - Constants & Enums: `UPPER_SNAKE_CASE`
  - Error codes: stable uppercase `SNAKE_CASE` (e.g., `VALIDATION_ERROR`, `MANGA_NOT_FOUND`, `CONTRACT_VERSION_UNSUPPORTED`)
- **Imports:** Absolute imports from `manga_reader.*`. Cross-module imports may ONLY reference the target module's public `__init__.py` or `application/` contracts — never reach into another module's `infrastructure/`.

### TypeScript / React (`apps/web` & `packages/contracts`)
- **Formatting & Linting:** `prettier` + `eslint` (flat config with TypeScript & React Hooks rules).
- **Static Typing:** `tsc --noEmit` with `"strict": true`, `"noUncheckedIndexedAccess": true`, no implicit `any`.
- **Naming:**
  - React components & layout files: `PascalCase.tsx`
  - Hooks: `useCamelCase.ts`
  - Services, utilities, types: `camelCase.ts`
  - CSS design tokens: `--mr-<category>-<name>` in `src/styles/tokens.css`
- **State Discipline:** Keep server state in TanStack Query, ephemeral UI state (modals, filter drafts, reader layout preview) in React state/URL params, and never trust client state for authorization.

---

## 3. API & Error Handling Standards

- **Base Path:** `/api/v1`
- **Success Envelope:** `{ "data": ..., "meta": { "requestId": "..." } }`
- **Paginated Envelope:** `{ "data": [...], "meta": { "page": 1, "pageSize": 24, "total": 0, "hasNext": false, "requestId": "..." } }`
- **Error Envelope:**
  ```json
  {
    "error": {
      "code": "VALIDATION_ERROR",
      "message": "Request validation failed",
      "details": {}
    },
    "meta": { "requestId": "..." }
  }
  ```
- **Correlation:** Echo `X-Request-ID` header on every response and include `requestId` in `meta` and all server logs.
- **Sorting & Filtering:** Always validate against allowlisted enums; never interpolate user strings into SQL.

---

## 4. Database & Migration Conventions

- **Migration Tool:** Alembic (`database/alembic.ini`, `database/migrations/versions/`).
- **Naming Pattern:** `YYYYMMDD_NNNN_<short_snake_description>.py` (or Alembic revision + descriptive slug).
- **Forward-Only Discipline:** Never mutate schema out-of-band. Every migration must document rollback impact and preserve existing data/audit evidence.
- **Constraint Naming (aligned with `QL_DocTruyen`):**
  - Primary keys: `PK_<table>`
  - Unique constraints: `UQ_<table>_<purpose>`
  - Filtered unique indexes: `UX_<table>_<column>`
  - Foreign keys: `FK_<table>_<ref_table>[_<role>]`
  - Check constraints: `CK_<table>_<rule>`
  - Non-unique indexes: `IX_<table>_<purpose>`

---

## 5. Git Version Control Workflow

- **Default Branch:** `main` (always runnable, linted, typechecked, and passing tests).
- **Feature Branches:** `feat/<phase>-<uc-slug>`, `fix/<issue-slug>`, `chore/<topic>`, `docs/<topic>`.
- **Commit Messages:** Conventional Commits (`feat(etl): ...`, `fix(auth): ...`, `docs(architecture): ...`, `test(contracts): ...`, `chore(ci): ...`).
- **Pre-Commit Verification Protocol (from `00_README_AGENT_ENTRYPOINT.md` §8):**
  1. Identify target UC-IDs and read linked canonical rules + ADRs.
  2. Verify no secrets (`.env`, real keys, live `.mdf`/`.ldf`, `.jsonl.gz`) are staged.
  3. Run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, and `pnpm build` (covering both backend & frontend).
  4. Update traceability docs / OpenAPI / ADRs if contracts or schema changed.
- **Never rewrite published history** and never commit unverified claims of passing tests.
