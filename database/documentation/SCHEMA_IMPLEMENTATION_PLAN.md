# Database Schema Implementation & Reconciliation Plan

> **Status:** Foundation Baseline (Non-Destructive)  
> **Primary Target DB:** Microsoft SQL Server 2022 (`QL_DocTruyen`, `D:\work\TH-PTTK\QL-DocTruyen\data\QL_DocTruyen.mdf`)  
> **Authoritative References:** `docs/agent-plan/04_DATABASE_SCHEMA_AND_MIGRATIONS.md`, `docs/agent-plan/12_ADR_CONFLICTS_AND_RISKS.md`

---

## 1. Identity & Persistence Conventions (Mandatory)

1. **Internal vs. External Identity Separation:**
   - Internal PKs: `account_id` (UUID), `manga_id` (UUID), `chapter_id` (UUID), `media_id` (BIGINT), `tag_id` (BIGINT), `list_id` (UUID).
   - External Stable Upsert Keys (UNIQUE, never internal PK): `pool_manga_id` (`VARCHAR(80)`), `pool_chapter_id` (`VARCHAR(100)`), `creator_id` (`VARCHAR(100)` — MangaDex UUID or UUIDv5), `page_uid` (`VARCHAR(120)`), `media_objects(bucket, object_key)`.
   - **Never use `slug`, `title`, `chapter_number`, or runtime image URLs as primary keys.**
2. **UTC Timestamps:** All datetime columns store UTC (`DATETIME2(3)` in SQL Server, `TIMESTAMPTZ` in PostgreSQL, ISO-8601 UTC in SQLite test DBs).
3. **Constraint Naming:** `PK_<table>`, `UQ_<table>_<purpose>`, `UX_<table>_<filtered_col>`, `FK_<table>_<ref>`, `CK_<table>_<rule>`, `IX_<table>_<purpose>`.
4. **No Destructive Audit Cascades:** Never cascade-delete `activity_logs`, `reports`, subtype report snapshots (`account_reports`, `manga_reports`, `comment_reports`), or `report_action_histories`.
5. **Migration Discipline:** Forward-only Alembic revisions in `database/migrations/versions/`. Never modify production/dev schema out-of-band without a corresponding revision.

---

## 2. Three-Way Schema Reconciliation (`Lab10` vs. Live `QL_DocTruyen.mdf` vs. Canonical ADRs)

During Phase 0 reconnaissance, the attached local database `QL_DocTruyen` (44 user tables + `sysdiagrams`, 0 rows) was inspected against Lab10's 39-table specification and ADR migrations `M-001`..`M-011`.

### 2.1 Existing Tables Already Present in `QL_DocTruyen.mdf` (44 User Tables)

| Domain | Tables in `QL_DocTruyen.mdf` | Status vs. Lab10 + ADRs |
|---|---|---|
| **Accounts & Auth** | `accounts`, `readers`, `admins`, `user_sessions`, `account_status_histories` *(+1 extra)* | **Drift detected** (see §2.2 items 4–5) |
| **Manga & Catalog** | `mangas`, `manga_alt_titles`, `creators`, `creator_biographies` *(+1 extra, satisfies M-005)*, `creator_links`, `manga_creators`, `tags`, `tag_names` *(+1 extra, satisfies M-005)*, `manga_tags`, `manga_links`, `manga_cover_arts`, `manga_stats`, `manga_stats_languages`, `manga_lineage`, `manga_content_vectors` *(+1 extra)*, `manga_moderation_logs` *(+1 extra)*, `chapters`, `chapter_pages`, `media_objects` | Mostly aligned; needs `M-004` GC cols & `M-007` tombstone |
| **ETL & CDC** | `etl_jobs`, `etl_job_items`, `manga_sync_subscriptions`, `cdc_events` | Check constraints need alignment (`INITIAL_IMPORT`/`DELETE`/`CANCELLED`/`PAUSED`) |
| **Reader & Progress** | `reader_settings`, `reading_status_records`, `reading_histories` | **CRITICAL GAP:** Missing `reader_progress` (`M-001` / `ADR-001`) |
| **Ratings** | `ratings`, `rating_histories` | Aligned (`UQ_ratings_reader_manga` & `CK_ratings_score(1..10)` already exist!) |
| **Comments** | `comments`, `comment_edit_histories`, `comment_reactions` | Missing `comments.parent_comment_id` (`M-002`) and `comment_edit_histories.previous_is_spoiler` (`M-003`) |
| **Moderation & Audit** | `reports`, `account_reports`, `manga_reports`, `comment_reports`, `report_action_histories`, `activity_logs` | Needs `M-006` (`manga_reports.ignore_future_reports` snapshot semantics) & `ADR-020` nullable/system actor |
| **Reading Lists** | `reading_lists`, `list_items` | Aligned (`UQ_reading_lists_owner_name` & `UQ_list_items_list_manga` already exist!) |

### 2.2 Required Phase 1 Forward Migrations (Prioritized)

| Migration ID | Priority | Target Tables | Exact Gap / Change Required | Linked ADR | Blocking Open Decision? |
|---|---|---|---|---|---|
| **`M-001`** | **Critical** | `reader_progress` *(new)* | Create `reader_progress(reader_account_id, manga_id, chapter_id, page_number, page_uid, pages_revision, updated_at)` with PK `(reader_account_id, manga_id)` and `CK_reader_progress_page (page_number >= 1)`. | `ADR-001` | No — approved canonical rule |
| **`M-002`** | High | `comments` | Add nullable `parent_comment_id UNIQUEIDENTIFIER NULL` self-FK to `comments(comment_id)` + index `(parent_comment_id, created_at)`. | `ADR-008` | No (MVP 1-level reply) |
| **`M-003`** | High | `comment_edit_histories` | Add `previous_is_spoiler BIT NOT NULL DEFAULT 0` to preserve spoiler flag across edit history. | `ADR-008` | No |
| **`M-004`** | High | `media_objects` | `UQ_media_objects_location(bucket, object_key)` already exists in `QL_DocTruyen`! Add GC lifecycle columns: `gc_status VARCHAR(20)`, `deleted_at DATETIME2(3) NULL`, `last_verified_at DATETIME2(3) NULL`. | `ADR-011`, `ADR-018` | No |
| **`M-005`** | Done (Verify) | `creator_biographies`, `tag_names` | Already created in `QL_DocTruyen.mdf`! Verify FK cascade rules and English fallback index. | `ADR-007` | No |
| **`M-006`** | Medium | `manga_reports` | Document/enforce `mangas.ignore_all_reports` as sole global switch; treat `manga_reports.ignore_future_reports` as immutable resolution snapshot only. | `ADR-006` | No |
| **`M-007`** | **Critical** | `mangas`, `manga_deletion_tombstones` *(new)* | Add `mangas.deletion_status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'` and durable `manga_deletion_tombstones(pool_manga_id PK, manga_id, deleted_at, delete_job_id, reason)` so delayed CDC events cannot resurrect deleted manga. | `ADR-011` | Partial (#5–#6 retention policy) |
| **`M-008`** | **Critical** | `accounts`, `user_sessions` | Reconcile `QL_DocTruyen` drift: (a) on `accounts`, add `failed_login_attempts INT NOT NULL DEFAULT 0`, `locked_at DATETIME2(3) NULL`, `locked_by_admin_account_id UNIQUEIDENTIFIER NULL FK -> admins(account_id)`, deprecate `locked_until` (`ADR-019`); (b) on `user_sessions`, replace `jwt_token_hash`/`is_active` with `refresh_token_hash VARCHAR(255) UNIQUE`, `user_agent NVARCHAR(500) NULL`, `revoke_reason VARCHAR(30) NULL`. | `ADR-003`, `ADR-019` | Partial (#1 7-day rule remains un-enforced) |
| **`M-009`** | Done (Verify) | `ratings` | Already enforced in `QL_DocTruyen.mdf` (`CK_ratings_score`, `UQ_ratings_reader_manga`). | `ADR-010` | No |
| **`M-010`** | Done (Verify) | `list_items` | Already enforced in `QL_DocTruyen.mdf` (`UQ_list_items_list_manga`). Add reconciliation check job. | `ADR-014` | No |
| **`M-011`** | High | `report_action_histories`, `outbox_events` *(new)*, FK retention | (a) Allow nullable `admin_account_id` + `actor_type VARCHAR(16)` (`ADMIN`/`SYSTEM`) on `report_action_histories` (`ADR-020`); (b) create transactional `outbox_events` table for reliable async email/search/CDC/GC; (c) align `etl_jobs` & `manga_sync_subscriptions` CHECK constraints with Lab10. | `ADR-011`, `ADR-020`, Round 3 | Yes (#5–#6 history/rating retention on manga delete) |

---

## 3. Why `QL_DocTruyen.mdf` Was NOT Modified During Initialization

Per Phase 3 scope rules:
- We **do not** prematurely alter the existing `QL_DocTruyen.mdf` production/baseline schema while Open Product Decisions (#1, #5, #6 in `12_ADR_CONFLICTS_AND_RISKS.md`) remain unconfirmed.
- Instead, this foundation delivers:
  1. Operational **Alembic** migration infrastructure (`database/alembic.ini`, `database/migrations/env.py`, initial foundation revision `0001_foundation_bootstrap.py`).
  2. Verified migration execution (`upgrade head` / `downgrade base` tested on clean isolated SQLite database + offline SQL preview via `alembic upgrade head --sql`).
  3. Read-only connectivity verification against local SQL Server `QL_DocTruyen` when configured.
  4. Clear Phase 1 execution path: stamp baseline revision on `QL_DocTruyen` (or create fresh DB from full DDL), then apply forward-only revisions `M-001`..`M-011` incrementally per `13_IMPLEMENTATION_ROADMAP.md`.

---

## 4. Transaction Boundary Standards

| Operation | Single ACID Transaction | Post-Commit Outbox Side Effects |
|---|---|---|
| Rating upsert / remove | `ratings` + `rating_histories` + `mangas.average_rating` | Recommendation signal refresh |
| Comment edit | `comment_edit_histories` + `comments` update | Cache invalidation |
| Comment reaction | `comment_reactions` + `comments.like_count`/`dislike_count` | Periodic reconciliation |
| List membership sync | `list_items` diff + `reading_lists.item_count` | List metadata stats cache invalidation |
| Report resolve/ignore | Target local mutation + `reports` + `report_action_histories` + `activity_logs` + `outbox_events` | Email notification, search index update, CDC cancel, media GC |
| ETL batch import | **One transaction per manga item** (`mangas`, relations, `chapters`, `chapter_pages`, `media_objects`, `manga_stats`, `manga_lineage`, `etl_job_items`) | Search indexing, content vector compute, CDC provider subscribe |
| Account lock | `accounts.status='LOCKED'` + revoke all `user_sessions` + `activity_logs` + `outbox_events` | Lock notification email |
