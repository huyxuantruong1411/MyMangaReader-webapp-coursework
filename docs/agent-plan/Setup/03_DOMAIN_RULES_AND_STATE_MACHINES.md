# Canonical Domain Model, Business Rules & State Machines

## 1. Naming and identity rules

- `account_id`: internal identity shared by Reader and Admin account records.
- `reader_account_id` / `admin_account_id`: role-qualified foreign-key reference to `accounts.account_id` and subtype rows.
- `manga_id`: internal Reader database UUID.
- `pool_manga_id`: stable manga identity in package v2.0; unique in Reader DB; external upsert key.
- `chapter_id`: internal Reader database UUID.
- `pool_chapter_id`: stable chapter identity in package v2.0; unique; upsert key.
- `creator_id`: canonical string ID from package (MangaDex UUID or deterministic UUIDv5).
- `tag_id`: internal numeric key; `slug` stable unique external-facing tag identity.
- `media_id`: internal media reference to `(bucket, object_key)`.
- `slug`: URL alias, may change under explicit redirect strategy; never a foreign key identity.
- Display text is never authoritative identity.

## 2. Account lifecycle

### 2.1 States

```text
PENDING_VERIFICATION --(valid one-time OTP)--> ACTIVE
ACTIVE --(Admin locks with reason)--> LOCKED
LOCKED --(Admin unlocks with reason)--> ACTIVE
```

`PENDING_VERIFICATION`, `ACTIVE`, `LOCKED` are the only statuses in Lab10 `accounts.status`.

### 2.2 Transition invariants

- Register creates account in `PENDING_VERIFICATION`; never create authenticated session from a pending account.
- OTP verification requires a valid, unexpired, unconsumed credential bound to the account/email; success consumes it atomically and changes state to ACTIVE.
- Admin lock allowed only for Reader account in ACTIVE state; target Admin is rejected by UC-1.2.
- Lock requires non-empty reason. `locked_at`, `locked_by_admin_account_id`, `lock_reason` become non-null. `last_status_change_at` changes. Revoke every active session with `revoke_reason=ACCOUNT_LOCK`. Audit event must record Admin as actor and target Reader in polymorphic target fields.
- Unlock allowed only for LOCKED. Require note/reason. Set ACTIVE, clear current-lock fields; `last_status_change_at` changes. Keep audit history in `activity_logs` / relevant report action history; do not treat `accounts` current columns as history.
- Account being LOCKED prohibits login and all state-changing Reader operations (comment/rating/report/list/read progress etc.). Public profile read policy must be explicit; locked label can display per UC-1.1.

### 2.3 Temporary login throttling is a separate mechanism

- Password guessing/rate limit produces temporary rejection (and possibly Redis TTL state), not a moderation lock.
- Do not set `accounts.status=LOCKED` for a short brute-force cooldown unless product explicitly chooses that behavior and provides a clear Admin unlock process.
- `failed_login_attempts` may be persisted as a consecutive-failure counter, but cooldown/TTL should be shared cache state. Exact threshold/time missing in source.
- Same generic error for unknown identity and wrong password.

## 3. Session model

- Login creates `user_sessions` row; `refresh_token_hash` unique; access JWT carries session ID/JTI only.
- Session valid when `revoked_at IS NULL AND expires_at > UTC now` and owning account status ACTIVE.
- Logout: set revoked_at and `revoke_reason=LOGOUT`.
- Account lock: revoke every active row with `ACCOUNT_LOCK`.
- Password change: revoke other sessions with `PASSWORD_CHANGE`; current session rotate/reissue by explicit policy.
- Refresh rotates refresh-token hash; detect token reuse and revoke session family (proposed security hardening).
- Every protected API checks both JWT validity and database/cache session revocation state; a signed JWT alone is insufficient for immediate account lock invalidation.

## 4. Reader profile and privacy

- `readers` profile is 1:1 with `accounts`.
- `display_name` public; `avatar_url`, `bio` public subject to safety handling; `birth_date` only public when `is_birth_date_public=true` or requester is self/Admin.
- Email is private to self/Admin.
- Do not expose reporter identity to target Reader.
- Activity logs and report records are admin-only.

## 5. Manga lifecycle and visibility

### 5.1 Visibility state

```text
PUBLIC --(Admin hide)--> HIDDEN
HIDDEN --(Admin show)--> PUBLIC
PUBLIC/HIDDEN --(Admin delete workflow)--> DELETING/TOMBSTONED --> DELETED
```

The DB stores `PUBLIC|HIDDEN`; `DELETING/DELETED` may be represented by a job/tombstone column or separate delete job state (proposed) so a destructive workflow can be retried safely.

### 5.2 Invariants

- All Reader discovery/detail/chapter/recommendation endpoints require PUBLIC.
- Hide retains metadata/media/chapters and user records, but removes from reader-facing catalog/search/recommendations/list stats (per activity/sequence intent that hidden manga not be exposed).
- Show re-indexes and invalidates cache. Showing does not automatically reactivate CDC.
- Delete cancels CDC before deleting local data; source service remains untouched.
- Deletion must ensure in-flight CDC cannot recreate the manga. Use a tombstone or cancellation generation and serialize deletion against sync.
- If manga is syncing (`is_syncing=true`), activity diagram says block delete to avoid data loss/race.
- `ignore_all_reports` if true affects future manga reports; one authoritative field is recommended (see ADR-006). It must not prevent Admin from reviewing already-existing reports unless policy explicitly says so.

### 5.3 Content rating

Enum: `safe`, `suggestive`, `erotica`, `pornographic`, `unknown`.

- `unknown` is not safe; safe-only views exclude unknown.
- If age-aware filtering is implemented, determine age from DOB only if permitted; never disclose DOB in public APIs.
- Source uses both `content_rating` and `publication_demographic`; do not collapse demographic into content rating.

## 6. Chapter ordering and page identity

- `chapter_number` string may be `10.5`, `Extra`, `Prologue`; display only.
- `chapter_numeric` number is the primary sort key by contract description; order by `chapter_numeric`, `language`, and stable tie breaker (`pool_chapter_id` or `chapter_id`).
- Several chapter labels may share same numeric index; stable tiebreak is mandatory.
- `volume` may be null; never coerce null to numeric 0 for filtering/display.
- Chapter language is normalized lowercase code; may contain region, e.g. `pt-br`.
- Page numbering starts at 1 and must be contiguous through `N`; `page_uid` stable identity across package revisions as long as same page object logically remains.
- `pages_revision` increments when pages are edited. A reader's saved `page_uid` should be preferred for progress; if absent after new revision, fallback to nearest valid page index.

## 7. Reader settings domain

Enums:
- `display_mode`: `VERTICAL_WEBTOON`, `SINGLE_PAGE`, `DOUBLE_PAGE`.
- `reading_direction`: `LTR`, `RTL`.
- `fit_mode`: `FIT_WIDTH`, `FIT_HEIGHT`, `ORIGINAL`.
- `preload_page_count`: integer; DB model default 3. Validate positive and capped by config.

Invariants:
- Preference applies across chapters.
- Changing layout preserves page identity, not only current scroll pixel offset.
- Mobile narrow viewport may adapt double-page to fit or prompt user to use single/vertical.
- Anonymous preference stored locally; authenticated preference server-side.

## 8. Reading status and history/progress

### 8.1 Reading status

Enum: `READING`, `PLAN_TO_READ`, `COMPLETED`, `ON_HOLD`, `DROPPED`.

- One current state per `(reader_account_id, manga_id)`; unique constraint mandatory.
- Selecting same state is idempotent.
- Clearing state deletes row or marks inactive (choose one; recommended delete current row while audit/activity records the event only if needed).
- Status contributes to statistics and recommendation filters. User-based recommendation excludes completed/dropped; other states not automatically excluded unless requirement says so.

### 8.2 Reading history vs progress

- History: append-only record per chapter open/session; fields in Lab10: reader, chapter, opened_at, reading_duration_seconds, is_valid_view.
- Progress: one latest resume point per Reader/manga (recommended separate table), stores chapter and page position.
- `reading_histories` alone cannot support exact “continue at last page”; do not overload duration or infer page position.
- Anonymous reading policy: no `reading_histories` FK without account; optionally local-only progress or anonymous session table (not in source; out-of-scope unless needed).

### 8.3 Valid view

- UC-2.5 requires a view only after user actually loaded/opened a chapter and exceeded a configured time threshold, avoiding F5 spam.
- Record page/chapter open first; mark valid after threshold or evaluation worker. Exact duration and dedupe window are missing.
- `total_views`, `chapter.view_count` are materialized aggregates; reconcile by rebuild job.

## 9. Rating lifecycle

- One current rating per reader/manga; score 1..10 from Reader UC and sequence. DB should enforce `CHECK score BETWEEN 1 AND 10`.
- Create: no active rating → insert current row and history `CREATE(previous_score=NULL,new_score=x)`.
- Update: active rating → update row and history `UPDATE(previous_score=x,new_score=y)`.
- Remove: set `is_removed=true` (soft removal compatible with history) and append `REMOVE(previous_score=x,new_score=NULL)`.
- Average only includes current non-removed ratings.
- Rating endpoints check that at least one chapter has been opened by this Reader for the manga (Lab9 sequence). Do not substitute only a reading-status record.
- Average cache/`mangas.average_rating` must be atomically maintained or recomputed; guard against concurrent rating changes (transaction or aggregate queue).

## 10. Comment lifecycle and hierarchy

### 10.1 States/flags

Comment row flags: `is_spoiler`, `is_spoiler_locked_by_admin`, `is_edited`, `is_deleted`.

- Create: required non-empty text; sequence sets max 2,000 chars.
- Edit: only author; save previous version to history in same transaction; set `is_edited=true` and `updated_at`.
- Delete: owner or authorized Admin; soft delete. A deleted comment with children renders placeholder; otherwise omit.
- Spoiler: user can choose; Admin may force spoiler. If admin lock true, user cannot remove spoiler status.
- Comment may belong to manga (`chapter_id=NULL`) or a chapter.
- UML shows parent-child relation/replies, but DB table lacks parent FK. Proposed schema adds `parent_comment_id` self-FK; MVP recommends one-level reply (root + reply) unless deeper threads are explicitly wanted.

### 10.2 Edit history

`comment_edit_histories` is append-only; Lab10 stores previous content and actor/time. Recommended extension stores previous `is_spoiler` too, so a history view is a faithful snapshot. Do not overwrite old history.

### 10.3 Reactions

- At most one reaction row per `(reader_account_id, comment_id)`.
- Desired states: none / LIKE / DISLIKE.
- None→LIKE increments like; LIKE→DISLIKE decrements like and increments dislike; DISLIKE→none decrements dislike; same state click may toggle to none (proposed; keep API explicit).
- Update row and cached counts in one transaction; periodic reconciliation can compare count(*) aggregation.

## 11. Report lifecycle

Enum: `PENDING`, `RESOLVED`, `IGNORED`, `CLOSED`.

```text
PENDING --(Admin applied moderation action)--> RESOLVED
PENDING --(Admin chooses Ignore)-------------> IGNORED
PENDING --(target no longer exists)----------> CLOSED
```

- `CLOSED` is a system closure when target no longer exists (activity/sequence).
- `RESOLVED` indicates action applied; `IGNORED` means no target enforcement action.
- Every resolution/ignore/close records `report_action_histories` and timestamps/actor where applicable.
- Report target can be account, manga/chapter or comment; target snapshot remains after target deletion.
- Reporter self-report prohibited for account. Target and reporter IDs must not be conflated.
- Duplicate report throttling is required; exact policy thresholds not supplied.
- `action_taken` is a controlled enum/value catalogue, not arbitrary UI string.
- On manga report ignore-future choice, canonical source of truth is `mangas.ignore_all_reports` (see ADR-006).

## 12. Reading List lifecycle

- Each list belongs to one Reader owner; owner ID required.
- Name unique per owner after `normalized_name`; normalize trim, Unicode normalization, case-fold and whitespace collapse (algorithm must be stable; use DB collation or store canonical output).
- Description optional, max 500 characters per Lab10 field.
- List item unique per `(list_id,manga_id)`; add/remove is idempotent and changes `item_count` in same transaction.
- List visibility: canonical private/owner-only because sequence checks ownership and DB has no visibility field. The UC parent phrase mentions public community lists, but concrete sequence/class and CRUD behavior conflict; see ADR-009.
- Cloning multiple source lists verifies every list is owned by current Reader, deduplicates manga, optionally filters deleted/hidden content, creates a new list and leaves sources unchanged.
- `item_count` should reflect membership rows even if some manga are currently hidden; visible item count can be computed separately.
- Hidden manga omitted from reader-facing list detail and stats; whether it should remain in membership is an implementation choice. Recommended: keep membership on hide to allow re-show restore, omit hidden in rendered data/stats; delete removes membership.

## 13. Audit and activity event semantics

`activity_logs` is append-only. For admin lock/unlock/hide/show/delete/report actions:
- `account_id` = actor account (Admin) or null system actor.
- `target_type` + `target_id` = affected object.
- `event_type` = normalized stable code (e.g. `ACCOUNT_LOCK`, `ACCOUNT_UNLOCK`, `MANGA_HIDE`, `MANGA_SHOW`, `MANGA_DELETE`, `REPORT_RESOLVE`, `REPORT_IGNORE`).
- `details_json` includes schema version + reason + before/after state + correlation/job ID. Avoid storing passwords/tokens/OTP or unnecessary sensitive data.
- Every event has UTC timestamp and IP when applicable.
- Audit cannot be edited/deleted through application endpoints.

## 14. Recommendation candidate rules

- Candidate must be public, not current source manga, not already excluded by user state rule.
- Item-based: interaction co-occurrence from read/list/rating signals; fallback to content-based/popular when sparse.
- User-based: only authenticated Reader with sufficient interaction; anonymize user vectors; candidates liked by similar readers, but not already read/completed/dropped by current Reader.
- Content-based: vector from tags/genre/creators/synopsis TF-IDF/embedding; cosine similarity; cold-start independent of number of readers; recompute on metadata ingest/change.
- Do not promise recommendation “fairness” or personalization accuracy without offline evaluation; provide deterministic fallback and avoid blocking detail page.

## 15. Date/time / text normalization

- DB timestamps UTC `DATETIME2(3)` consistent with source notes.
- JSON ISO-8601 timestamps should parse with explicit timezone; persist UTC; return RFC3339.
- Normalize username/email before unique checks; preserve display casing separately if desired.
- Normalize search query for accents/case but never overwrite title/creator original display name.
- Avoid SQL injection by parameterized queries; do not use user-supplied sort strings as SQL fragments.
