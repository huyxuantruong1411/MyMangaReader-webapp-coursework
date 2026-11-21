# Architecture Decision Records, Conflict Register & Adversarial Review

> Đây là tài liệu quan trọng nhất để tránh agent “tự chọn một cách hiểu” khác nhau trong mỗi module. Các quyết định bên dưới là bản chuẩn hóa đề xuất cho MVP. `SOURCE` ghi lại xung đột thực tế; `DECISION` ghi hành vi dùng trong code; `REVISIT` nêu điều kiện cần xác nhận.

## 1. Conflict register (tóm tắt)

| ID | Chủ đề | Nguồn A | Nguồn B | Rủi ro nếu không chốt | Quyết định |
|---|---|---|---|---|---|
| ADR-001 | Continue reading page position | UC-4.6/reader setting nói giữ chapter + page; sequence đọc tiếp tục | `reading_histories` chỉ có chapter/time, ghi rõ không lưu page | Không thể resume đúng page; agent giả lập từ duration | Tách `reader_progress` khỏi history |
| ADR-002 | Lock/unlock 7 ngày | UC-1.3 Alternative Flow: chỉ được khóa/mở khóa sau 7 ngày | Basic flow nói unlock ngay khi Admin xác nhận; DB không có lock expiry | Không biết cooldown tính từ đâu, trạng thái bất đồng bộ | Không enforce cooldown MVP; nếu yêu cầu thì cần thêm `unlock_not_before` |
| ADR-003 | Account lock vs login throttle | DB status PENDING/ACTIVE/LOCKED, lock Admin persistent | login sequence thể hiện temporary lockout/try again after time | Brute-force biến account thành LOCKED sai nghĩa | Admin lock DB; throttling TTL trong cache |
| ADR-004 | OTP medium/storage/TTL | UC cho phép OTP hoặc verification link; Lab10 nói RAM only | Lab9 sequence chọn OTP/Redis and TTL 120s | Triển khai email link hay OTP, local RAM không scale | OTP flow canonical, shared Redis, one-use TTL 120s |
| ADR-005 | Report status vocabulary | UC gọi “Chờ xử lý/Đã xử lý/Đã bỏ qua” | DB/UML có PENDING/RESOLVED/IGNORED/CLOSED; sequence tự close missing target | Trạng thái giao diện/API lệch nhau | Dùng 4 enum; map labels; CLOSED cho target missing |
| ADR-006 | Future report suppression | `mangas.ignore_all_reports` | `manga_reports.ignore_future_reports` | Hai flag cạnh tranh, một màn hình bật mà worker không biết flag nào | `mangas.ignore_all_reports` là source of truth; subtype field deprecated/snapshot |
| ADR-007 | Localized creator/tag data | JSON biography/name là map đa ngôn ngữ | DB chỉ có biography/name English scalar | Dữ liệu locale bị mất không thể phục hồi | Preserve all locale via normalized child tables/JSON DB fields |
| ADR-008 | Comment replies/edit history | Class UML có parent-child; UC nói reply, history | SQL `comments` thiếu `parent_comment_id`; edit history chỉ có previous content | Không lưu thread; history bỏ mất spoiler state | Add parent FK; add previous_is_spoiler; MVP one-level reply |
| ADR-009 | Reading list privacy | Parent UC mô tả tìm list công khai/community | Sequence 13/14/15 kiểm owner; class/DB không có visibility/share | Rò rỉ private list hoặc cần schema thiếu | MVP private owner-only; public sharing là feature mới |
| ADR-010 | Rating scale and eligibility | UC & sequence nêu 1–10, requires reading history | DB `score INT` + description “scale from config”; no check/unique stated in table | Thang điểm không đồng nhất, duplicate rating | Canonical 1–10, one row/user/manga, chapter-open history gate |
| ADR-011 | Manga delete and historical records | UC-2.4 nói delete manga/chapter/images/comments and remove list refs | history/rating/report FKs and evidence need preservation | Cascade delete audit/history, orphan media, CDC recreate | Tombstone + explicit deletion graph + async media GC, preserve report snapshots |
| ADR-012 | Optional chapters/full snapshot | Root JSON `chapters` not required | ETL full import often treats package as whole snapshot | Metadata-only package could delete all chapters | Missing chapters = no chapter mutation; explicit empty only if snapshot completeness agreed |
| ADR-013 | Chapter ordering | package says sort numeric then language; chapter_number string may be `Extra` | UI labels can be non-numeric | Incorrect lexical sort/unstable order | Sort by numeric, language, stable ID; label string display only |
| ADR-014 | List count vs hidden records | List stats only visible/public items; DB item_count counts all membership rows | Hide retains manga/list relationship; delete removes refs | Item count changes without membership mutation | DB item_count=membership rows; visible list count computed separately |
| ADR-015 | NFRs missing numeric values | Many UC NFR cells contain blank values | diagrams show examples ~300ms/~500ms | Agent invents targets/ hardcodes guessed values | Configurable; label diagram values as indicative; benchmark before setting SLO |
| ADR-016 | `reading_histories` view counting | One row per chapter open; is_valid_view after threshold | reading frequency stats count opened vs valid views in different descriptions | Counting F5 or undercounting reading behavior | Separate open event from valid view aggregate; document metrics semantics |
| ADR-017 | Creator dual role | JSON says person with both roles appears twice per `(creator_id,role)` | DB one creator row with role in `manga_creators` | Duplicate creator entity or lose role | One Creator identity; two credit rows when both roles |
| ADR-018 | Media URL vs object identity | Contract only bucket/object_key | UI needs URL | Store expiring or unsafe source URL as DB identity | Resolve signed/CDN URL at runtime |
| ADR-019 | `locked_at` vs `locked_until` in class diagram | Lab10 table has `locked_at`; ERD/class representation shows `locked_until` / temporary lock concept | Login cooldown and admin lock merged | schema mismatch and expiration semantics | Retain `locked_at` for manual lock; TTL cooldown separate; add expiry only if admin sanction needs it |
| ADR-020 | Report subtype missing target action actor for auto-close | DB action history has non-null Admin FK | sequence auto-closes when target missing (system) | Can't record auto-close consistently | Add system actor/nullability or dedicated system activity log; preserve report transition |

## 2. Detailed Architecture Decision Records

### ADR-001 — Separate current reader progress from reading history

**Status:** ACCEPTED for proposed canonical implementation.

**Source conflict:**
- UC-4.6 promises Continue at chapter and position/page last read.
- UC-4.4 NFR says changing reader mode preserves page index.
- Lab9 sequence 5 retrieves reading progress and sequence 6 updates chapter + duration, but the payload described in diagram lacks page number.
- Lab10 `reading_histories` schema stores only chapter ID, open time, duration and valid view; explanatory note says latest history opens the chapter from first page, and that it does not represent page position.
- Lab9 class package for Reader shows progress-like `lastPageIndex` property, strengthening the requirement for an exact resume field.

**Decision:**
- Keep `reading_histories` append-only as one event per chapter-open session.
- Add `reader_progress` unique per Reader/manga storing chapter, page number, stable page UID, page revision, updated time.
- Continue uses `reader_progress`; if absent, fallback to first chapter.
- Progress writes are debounced and concurrency-guarded; they do not append a history row for every scroll.

**Consequences:**
- Requires DB migration and progress API.
- Supports reader mode changes and cross-device resume.
- Page revision reconciliation must map missing UID to nearest page index.

**Rejected alternative:** Put `last_page_index` on `reading_histories`. It conflicts with event-history semantics and cannot unambiguously represent one current resume point when multiple open sessions exist.

### ADR-002 — Do not enforce ambiguous 7-day lock/unlock rule in MVP

**Status:** ACCEPTED as safe default; OPEN for product confirmation.

**Source conflict:** UC-1.3 alternative flow says “Tài khoản chỉ được mở khóa hoặc khóa sau 7 ngày”, without identifying whether 7 days is minimum lock duration, cooldown between repeated locks, or unlock waiting time. Basic flow permits Admin unlock on action; DB has only `locked_at`, no `unlock_not_before`.

**Decision:** Admin lock/unlock remain immediate and explicit, with reason required and audit. Do not introduce a hidden 7-day block.

**If product confirms a 7-day minimum sanction:** add `unlock_not_before` (UTC), Admin UI countdown and override permission/audit. Clarify whether repeat lock uses a separate cooldown.

### ADR-003 — Persistent moderation lock vs temporary login throttle

**Status:** ACCEPTED.

- `accounts.status=LOCKED` is an Admin sanction requiring lock reason, actor and audit; revoked sessions.
- Temporary anti-brute-force cooldown is a cache/Redis key with TTL and per-IP/account rate policy. It does not mutate account status.
- `failed_login_attempts` may be persisted as consecutive failures but cannot substitute for expiration state.
- If the product later wants a persisted automatic account lock, give it a separate `lock_source` and expiry semantics; do not silently overload `locked_by_admin_account_id`.

### ADR-004 — OTP implementation

**Status:** ACCEPTED.

- OTP-based verification is canonical for MVP because Lab9 sequence specifies OTP.
- TTL exactly 120 seconds is shown in the sequence; treat this as source behavior.
- OTP is one-time and bound to one account/email challenge; shared Redis/cache required for multi-instance deployment.
- SQL never stores OTP. Store only a keyed hash in Redis where practical.
- Mail sends asynchronously through queue.
- UC allows verification link as an alternative, but it is not part of MVP sequence. Add link mode only as a separate explicit product feature.

### ADR-005 — Canonical report states

**Status:** ACCEPTED.

Use database enums `PENDING`, `RESOLVED`, `IGNORED`, `CLOSED`.

UI labels:
- PENDING → Chờ xử lý.
- RESOLVED → Đã xử lý.
- IGNORED → Đã bỏ qua.
- CLOSED → Đã đóng / Đối tượng không còn tồn tại.

CLOSED is not a substitute for IGNORED. It indicates no moderation action could be applied because the target has disappeared.

### ADR-006 — One source of truth for ignoring future manga reports

**Status:** ACCEPTED with migration/cleanup.

- `mangas.ignore_all_reports` is global authoritative state for whether future manga reports are ignored/suppressed.
- `manga_reports.ignore_future_reports` must not independently govern routing; migrate/deprecate or rename to an immutable snapshot `ignore_future_reports_at_resolution` only if history needs it.
- Admin action must update authoritative manga flag and report outcome in the same command transaction.
- Existing reports remain reviewable unless explicit product policy says otherwise.

### ADR-007 — Preserve localized metadata from package

**Status:** ACCEPTED as data-integrity decision; schema design choice open.

Contract stores Creator biography and Tag name as language-keyed maps. Lab10 scalar English columns are lossy.

Recommended normalized tables:
- `creator_biographies(creator_id, language_code, biography_text)`;
- `tag_localizations(tag_id, language_code, name)`.

Alternative: validated JSON columns. Either way, preserve all languages, require English tag label as schema says, and use fallback priority (requested language → English → deterministic first available). Do not use localized display name as identity.

### ADR-008 — Add comment parent relation and spoiler history

**Status:** ACCEPTED.

- Add `parent_comment_id` self-FK because Lab9 class diagram and UC comment behavior show replies.
- MVP permits one level of reply to a root comment; deeper threads can be added after UX decision.
- Add `previous_is_spoiler` to edit history because editing may update spoiler status. Keep existing previous_content.
- Root deletion with replies shows placeholder.

### ADR-009 — Reading lists private in MVP

**Status:** ACCEPTED as conservative privacy default; OPEN product capability.

- The parent UC-7 description mentions searching public community lists, but the concrete sequence diagram for list detail checks ownership and rejects non-owner; source class/DB has no visibility/share permission field.
- MVP all lists are private and owner-only. This matches detailed operational sequence and avoids leaking personal collections.
- To support public list discovery later, add `visibility` enum, share policy/permission model, owner display, moderation/reporting and access tests. Do not infer public by route alone.

### ADR-010 — Rating score and eligibility

**Status:** ACCEPTED.

- Score range 1–10; DB `CHECK` constraint.
- One current row per Reader/manga.
- Server checks at least one chapter-open history row before rating. Source does not require a minimum valid-view duration.
- Every create/update/remove appends rating history and updates aggregate atomically.

### ADR-011 — Safe local manga deletion

**Status:** ACCEPTED; high-risk workflow.

- Hide is reversible and preserves data.
- Delete is destructive only in Reader system; upstream remains untouched.
- Check `is_syncing`; block delete while sync is in progress as activity diagram states.
- Cancel CDC subscription before final content cleanup; tombstone/pool ID prevents delayed CDC resurrection.
- Preserve report snapshots, report history and audit; do not cascade away evidence.
- Remove list references; delete related comments as UC-2.4 says.
- Images deleted asynchronously after checking media references; never block Admin UI.
- Reading history/rating retention requires product/legal policy. MVP should either preserve unavailable historical references with tombstone IDs or anonymize; do not cascade unknown foreign keys.

### ADR-012 — Missing `chapters` property is not an empty chapter set

**Status:** ACCEPTED.

Root schema requires `manga` and `exported_at`, not `chapters`. `chapters` missing means no chapter instructions in this payload. Do not delete current chapters. An explicit empty `chapters:[]` may be interpreted as an empty full snapshot only if source guarantees full export completeness; absent that guarantee, preserve existing chapter rows and require an explicit deletion event.

### ADR-013 — Stable chapter order

**Status:** ACCEPTED.

Use `chapter_numeric`, then language, then stable ID; display `chapter_number` untouched. Prologue/Extra ordering must be supplied through numeric value. The front end must not reimplement string parsing inconsistently.

### ADR-014 — Distinguish list membership count from visible count

**Status:** ACCEPTED.

- `reading_lists.item_count` reflects rows in `list_items`.
- Hide does not remove membership; hidden item is omitted in public list presentation and stats.
- If UI needs visible item count, calculate as separate response metric.
- Delete removes membership rows and updates stored count.

### ADR-015 — NFR numbers remain configurable until measured

**Status:** ACCEPTED.

- Preserve concrete design cues from diagrams (~300ms autocomplete; ~500ms item recommendation) as targets to benchmark, not blanket production SLOs.
- Blank numeric NFRs in Lab8 remain open; agent must not invent fixed values in code.
- Page sizes, retry limits, cache TTL, view threshold, upload limits, password length and rate thresholds are configuration values until approved.

### ADR-016 — Separate chapter opens from valid views

**Status:** ACCEPTED.

- History row records open.
- `is_valid_view` flips only after a configured qualifying duration/activity; valid views feed engagement counters.
- Reader statistics can report opens and valid views separately; the UI must label them.
- Dedupe prevents refresh spam, but exact dedupe window remains configuration.

### ADR-017 — One Creator entity, many role credits

**Status:** ACCEPTED.

JSON says same creator with both roles appears twice in package rows (one per role). SQL design supports one creator entity and `manga_creators` rows with role. Upsert Creator once by ID, write both role relations; UI deduplicates manga card and displays both credits.

### ADR-018 — Bucket/object key is media identity

**Status:** ACCEPTED.

Media contract has no URL field. Store bucket/object key; resolve trusted signed/CDN URL at runtime. Prevent arbitrary URL storage, URL expiry issues and source-host leaks.

### ADR-019 — Manual locked state vs temporary lock-until

**Status:** ACCEPTED.

Lab10's account table includes `locked_at`; some class/ERD representation shows `locked_until`. Keep `locked_at` for manual Admin lock and separate login throttle TTL in Redis. Do not add `locked_until` as a manual lock expiry until the 7-day sanction semantics are confirmed.

### ADR-020 — System-driven report closure audit

**Status:** ACCEPTED with schema adjustment.

Lab9 sequence auto-closes a report when target already deleted; `report_action_histories.admin_account_id` is non-null. Add nullable actor FK or represent automated closure in `activity_logs` with `account_id=NULL` and a `SYSTEM_REPORT_CLOSED` details payload. Prefer nullable system actor in `report_action_histories` if complete report status history is required. Do not fake a human Admin ID.

## 3. Adversarial review rounds

### Round 1 — Source fidelity check

**Question:** Did the unified plan accidentally replace what the documents actually say with generic “best practice” assumptions?

Findings and fixes:
- The plan explicitly labels proposed API paths, reply depth, list visibility, average list rating formula, valid-view threshold and upload limits as proposed/configurable rather than source facts.
- It preserves contract `2.0` strictness, field enumerations and optional fields instead of loosening package validation.
- It separates upstream data preparation from Reader ingestion.
- It records the 7-day statement as ambiguous rather than inventing a duration rule.
- It retains 4 report statuses and maps UI labels.

**Residual risk:** The exact numeric fields missing in Lab8 cannot be reconstructed. They remain open/configurable by design.

### Round 2 — Cross-layer contradiction check

**Question:** Can a single end-to-end flow satisfy UI → API → DB → event worker without relying on a field/table absent from the schema?

Findings and fixes:
- Continue reading now requires `reader_progress` migration; screen, API and DB references are aligned.
- Comment replies now require `parent_comment_id`; thread UI and API cannot silently rely on a non-existent column.
- Edit history preserves spoiler state in addition to old text.
- Localized package data has a normalized storage proposal rather than silently truncating locale maps.
- Delete/missing-target closure includes a system actor or nullable Admin ID, so no fabricated administrator is required.
- Future report suppression has one authoritative field.

**Residual risk:** Manga delete history/rating retention is still an explicit policy decision because source says full deletion but audit/FK integrity implies some references must remain. The plan mandates a tombstone or historical reference strategy, not an untracked cascade.

### Round 3 — Concurrency, idempotency and retry check

**Question:** What happens when the same action/event is submitted twice or two actors act concurrently?

Findings and fixes:
- ETL uses stable pool keys, revision guards and one item transaction; batch failure isolation preserved.
- CDC stores unique external event ID, uses revision ordering and tombstones.
- Rating/list/reaction writes have unique constraints and desired-state semantics.
- Report resolution re-checks PENDING under lock/optimistic concurrency.
- Lock checks current account state and revokes all sessions; a concurrent login/refresh must recheck status.
- External email, provider CDC registration/cancel, media GC and search indexing use outbox/retry instead of network work inside DB transaction.

**Residual risk:** Exact outbox table and job lease columns are not in Lab10 baseline; they are proposed implementation infrastructure. Agent must add these if using durable async processing.

### Round 4 — Privacy/security check

**Question:** Can hidden/private data leak through secondary paths even if the main page is correct?

Findings and fixes:
- Public visibility predicate is required on search, recommendations, Creator pages, chapter open, lists/stats.
- Lists default private; owner checks server-side.
- Account DOB/email/report logs are scoped to self/Admin.
- User-based recommendation anonymizes neighbor profiles.
- Webhook auth, object-key allowlist, XSS handling, rate limit and session revocation included.

**Residual risk:** Public read for locked accounts and anonymous view accounting need product policy; public content should not be mistaken for a successful authenticated session.

### Round 5 — Deletion/data recovery check

**Question:** Can a delete or partial ETL fail halfway and leave orphan files, dangling FKs, stale search documents or a resurrected manga?

Findings and fixes:
- Delete blocked during active sync.
- CDC unsubscribe/tombstone rejects delayed resurrection.
- Media GC waits until references are zero.
- Outbox/retry handles index and provider operations.
- Reports/audit survive target removal via snapshots.
- Per-manga ETL transaction/staging prevents partial visibility.

**Residual risk:** Exact retention/purge schedule and storage reference implementation are not in source; define operations policy before production.

## 4. Global risks and severity

| Risk | Severity | Why | Mitigation |
|---|---|---|---|
| Resume position missing in DB | Critical | Core Read Continue behavior impossible | ADR-001 migration before reader feature release |
| Package importer silently drops locale/optional fields | High | Permanent source data loss | Schema-level mapping test and locale tables |
| Async CDC resurrects deleted manga | Critical | Violates Admin deletion | Tombstone, subscription cancel, event revision guard |
| Hidden manga leaks via search/recommendation | High | Visibility/moderation bypass | Central public query scope + cross-path tests |
| Account lock not revoking all sessions | Critical | Locked user remains active | Session revocation and session checks on every request |
| Report status/action divergence | High | Moderation history becomes untrustworthy | Atomic status/action/log transaction |
| Counter drift (ratings/reactions/list count/views) | High | Incorrect stats and recommendations | Transactions + reconciliation jobs |
| Private list accessible by copied URL | High | Privacy violation | Owner guard and default-private contract |
| Corrupt page manifest | High | Reader skips/duplicates pages | Strict ingest checks and quarantining |
| NFR thresholds guessed | Medium | Unreliable performance promises | Config + benchmark + explicit SLO decision |

## 5. Decisions requiring product-owner confirmation before production

1. Is a 7-day minimum lock period required? If yes, does Admin have an override?
2. Are reading lists public/community-shareable or private only? MVP plan defaults private.
3. Should account and manga report categories be exact enumerated values? Who maintains the list?
4. What is the valid-view threshold and deduplication time window?
5. What is the retention policy for reading history, ratings and anonymized references after manga deletion?
6. Should deleted manga remove user ratings and statuses or preserve historical stats/tombstones?
7. How should `DOUBLE_PAGE` pair cover/first/final page, and how should adjacent chapter language fallback work?
8. What are target upload limits, password policy, page size, rate limits, retry ceilings, cache TTLs and latency SLOs?
9. Should OTP always be 120 seconds; does product also want email link verification?
10. Should user-based recommendation exclude only COMPLETED/DROPPED or also READING/PLAN_TO_READ?

Until confirmed, use the MVP defaults in this plan and keep each as config or isolated policy, not scattered conditionals.
