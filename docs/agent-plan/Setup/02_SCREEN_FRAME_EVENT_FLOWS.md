# Screen / Frame / Event Flow Specification

> Tài liệu này biến use case và activity/sequence diagram thành checklist giao diện cụ thể. Mỗi frame phải có: entry event, guards, request, response binding, user action, state transition, failure state và side effect. Không được coi giao diện hoàn tất chỉ vì render được happy path.

## 1. Global shell and shared frame rules

### 1.1 Shared shell

- Header: logo/home, global search, account menu (anonymous: Login/Register; authenticated: Profile, Reading history, My lists, Settings, Logout); Admin role thấy Admin entry.
- Main content frame: route title/breadcrumb, responsive max-width, skeleton on initial fetch.
- Toast/inline feedback: mutation success/failure; do not use toast as sole place for a validation error that needs correction.
- Modal: confirm destructive action, report input, lock/unlock, delete list, delete manga.
- Side panels/popovers: advanced filters and reader settings.
- All protected routes must handle expired session: refresh token once under concurrency lock; if refresh fails, clear session and route to login while preserving safe return URL.

### 1.2 Client/server state separation

- Client state: modal open, filter draft, reader display preference preview, selected list checkboxes, unsaved form values.
- Server state: account status, permissions, report status, list owner, current rating, comment flags/reactions, manga visibility, job status, reading progress.
- Never trust cached client state for authorization. Re-fetch/validate when committing a mutation.
- Query cache invalidation after a mutation must include affected aggregate views: manga detail rating/average; list item count and list stats; report queue + target state; account profile + active sessions; chapter list + latest chapter card after CDC.

## 2. Discovery frames

### 2.1 Home / Manga catalogue frame (UC-3, UC-3.1)

**Frame regions**
1. Featured/continue/recommendation strips if available.
2. Search input.
3. Advanced filter drawer.
4. Sort select (`UPDATED_DESC` default, `VIEWS_DESC`, `RATING_DESC`, `TITLE_ASC`).
5. Manga card grid/list: cover, title, latest chapter if known, average rating, minimal status labels.
6. Pagination/load-more controls.

**Entry flow**
1. Router enters catalogue with URL query params.
2. Parse/validate page, sort and filters; invalid values reset to defaults rather than generating unsafe query fragments.
3. Request public manga page.
4. Render skeleton cards; lazy-load cover images.
5. On success show cards; preserve URL state so refresh/back button restores selection.
6. On zero items show catalog empty state (not the same as no search results).
7. On failure show retry; do not display stale hidden entries from client cache.

**Events**
- `SORT_CHANGED`: update URL/query; reset page to 1; request new page.
- `PAGE_CHANGED`: request page; scroll/focus result heading.
- `MANGA_CARD_OPENED`: navigate to canonical manga slug/id route.
- `FILTER_DRAWER_OPENED`: copy active filters into draft form.
- `FILTER_APPLY`: validate and serialize tags/demographic/status/year/content rating/language; reset page; fetch.
- `FILTER_CLEAR`: reset draft and active filters; fetch base catalogue.

**Filter semantics (canonical proposal)**
- Include tags selected in the same group use OR unless an explicit AND mode is selected.
- Different tag groups and other dimensions combine with AND.
- Exclude tag matches combine as NOT.
- Exclude always wins over include if a tag is accidentally in both lists; UI should prevent this conflict.
- Missing `content_rating` or `unknown` must not be included in a “safe only” selection.

### 2.2 Global search frame (UC-3.3, UC-3.4)

**Input behavior**
1. Focus search field; preserve existing query text.
2. User types. Debounce requests (activity diagram target indicates dropdown within about 300 ms; configurable). Ignore stale responses by request sequence ID.
3. Call autocomplete using a normalized non-empty query; return max 10 suggestions as in Lab9 sequence.
4. Suggestion categories can include Manga, Creator and/or query mode; source specifically requires manga title autocomplete and an Author/Artist mode. Keep mode explicit rather than mixing unlabelled entities.
5. Arrow keys navigate, Enter chooses highlighted suggestion, Escape closes dropdown, click selects.
6. Submit Enter/search button calls full search; title search covers primary and alternative titles; Creator search resolves creator name and role.

**Result frame**
- Display query, active mode, result count if known, pagination.
- `MANGA` result: cards; `CREATOR` result: creator list and their public works.
- No results: spelling suggestion and option to remove filters.
- Network timeout: keep typed query, show retry; autocomplete failure must not block explicit submit.

**Data rules**
- Case-insensitive, accent-insensitive/fuzzy for title and alt titles.
- Only `PUBLIC` manga in normal reader-facing results.
- Creator page works filtered to `PUBLIC` only.
- Search index must be updated after ETL/metadata update, hide/show/delete and creator/tag relationship change.

### 2.3 Manga detail frame (UC-3.5)

**Frame hierarchy**
1. Top/cover area: primary cover, alternative cover option if product UI uses it, title, alt titles.
2. Creator credit: link to Author/Artist detail; same Creator may be credited as both roles.
3. Metadata chips: tags grouped by Genre/Theme/Format/Content, demographic, publication status, original language, year, content rating.
4. Synopsis.
5. Aggregate values: average rating, views, chapter/page counts when available.
6. Reader controls: reading-status selector, Read First, Continue (if progress exists).
7. Chapter list (filter/sort/pagination).
8. Comments section.
9. Recommendation panels (item/content/user depending context and login).
10. Report action.

**Entry sequence**
- Resolve slug or manga ID; fetch manga detail only if `PUBLIC`.
- If missing, hidden, or deleted, show not-found/hidden page; never expose hidden title in error payload.
- Fetch metadata core; chapter list may load independently/lazily.
- When logged in, fetch reading status, progress, current rating and whether rating eligibility is met.
- Fetch recommendations; do not block first paint if recommendation service is slow.
- Load cover lazily; placeholder if absent, image fallback if broken.

**Events**
- `CREATOR_LINK_CLICKED` → creator detail.
- `TAG_CLICKED` → catalogue with tag filter applied.
- `READ_FIRST_CLICKED` → resolve first chapter server-side and navigate reader.
- `CONTINUE_CLICKED` → resolve saved progress; fallback to Read First if no progress (sequence says first chapter if no history).
- `READ_STATUS_SELECTED` → require login; upsert one current status.
- `RATE_CLICKED` → open rating panel; server enforces prior chapter open.
- `REPORT_MANGA_CLICKED` → report modal.
- `CHAPTER_ROW_CLICKED` → chapter reader route.

**Concurrency edge**
- If Admin hides/deletes manga after detail is fetched but before chapter open, chapter-open API rechecks visibility and rejects. Client clears cached detail.

### 2.4 Creator detail frame (UC-3.6)

- Header: creator display name, localized biography fallback, external links.
- Works area: only public manga; role label Author/Artist where relevant.
- Filters: tag, publication status; sort newest/highest rating/views; pagination/AJAX.
- `FILTER_CHANGED` / `SORT_CHANGED` resets page to 1 and refreshes works without full page reload.
- Unknown Creator → 404; no works → empty state, not error.

## 3. Reader frame (UC-4)

### 3.1 Initial reader route and entry frame

Inputs: `mangaId`, `chapterId` optional, `actionType` (`START`, `CONTINUE`, `SELECT`).

1. Route resolves requested action; no action defaults to SELECT only if explicit chapter ID exists.
2. Server verifies manga exists and `PUBLIC`; chapter belongs to manga.
3. `START`: chooses earliest `chapter_numeric`, then language and stable tie-break.
4. `CONTINUE`: retrieves reader progress snapshot (canonical ADR) for current manga; if absent use first chapter.
5. `SELECT`: use exact chapter requested.
6. If no chapter exists, return a domain result `NO_CHAPTERS`; do not render a blank reader canvas.
7. Load chapter manifest (page order, page number, page UID, media refs), settings and progress location.
8. Reader shell appears with title/chapter nav, settings, page viewport and footer/toolbar as product layout dictates.
9. Initial visible page(s) load; next `preload_page_count` is prefetched (DB default = 3).
10. Create a reading-history open record for signed-in Reader; anonymous session behavior should be configurable but must not create a Reader foreign key.

### 3.2 Reader canvas by mode

**VERTICAL_WEBTOON**
- Stack pages vertically in chapter sequence.
- Load near viewport first; lazy load subsequent images.
- Track active page by intersection/scroll anchor; persist page progress with debounce + on page unload/visibility change.

**SINGLE_PAGE**
- One logical page visible at a time.
- Next/previous controls move by page identity; RTL reverses navigation order, not the underlying page numbering.

**DOUBLE_PAGE**
- Pair pages based on configured reading direction and spread rules; do not duplicate/skip pages.
- On narrow mobile viewport, auto-fit or show suggestion to switch to single/vertical (source alternative flow).
- First/last page pairing needs deterministic behavior. Do not infer cover-spread handling without product decision.

**Fit modes**
- `FIT_WIDTH`: scale to viewport width; preserve aspect ratio.
- `FIT_HEIGHT`: scale to available height; preserve aspect ratio.
- `ORIGINAL`: render natural pixels subject to viewport overflow/zoom policy.
- Never distort aspect ratio.

### 3.3 Reader toolbar/settings frame (UC-4.4)

1. User opens Reader Settings.
2. Show display mode, reading direction, fit mode, preload count if exposed; source default 3.
3. Changing a setting previews immediately; no full page reload.
4. Capture current page identity before changing layout.
5. Recompute page arrangement and restore same page identity/anchor after re-layout.
6. Persist account reader_settings when authenticated. For anonymous users use local preference storage. On login, decide conflict policy; proposed: server profile wins unless no settings row exists.
7. API failure: retain optimistic local display but show save error and retry; avoid reverting page position.

### 3.4 Chapter navigation frame (UC-4.1–UC-4.3)

- Chapter panel displays chapter number string, title, volume, language, scanlation group and publish time when known.
- Sort `chapter_numeric ASC`, then language, then stable ID; if user selects descending, reverse complete stable order.
- Chapter number is display-only (`10.5`, `Extra`, `Prologue` valid); never parse only the string to sort.
- Chapter filter at least supports language and volume (proposed UI default); preserve manga identity and sort in URL.
- Next/Previous chapter controls on chapter end; page last → next chapter; on first page previous → previous chapter. If unavailable, disable or explain.
- If target chapter is deleted/updated during navigation, refetch chapter list and explain chapter unavailable.

### 3.5 Image loading frame

For each `ReaderPage`:
1. Resolve `ReaderMediaRef.bucket/object_key` to a CDN or signed image URL via media service.
2. Fetch only after visible/within prefetch window.
3. Show per-page skeleton/placeholder with aspect ratio metadata if known.
4. On failure, retry with bounded attempts/backoff; then show error placeholder and retry affordance.
5. Do not replace image with blank space or crash entire chapter.
6. Report entry point may open manga/chapter report form.
7. Cache immutable objects by revision/hash; avoid stale content after `pages_revision` changes.
8. If hash mismatch at ingestion, do not expose that page to readers.

### 3.6 Progress and view event frame

- `reading_histories` records each chapter open, opened_at and reading_duration_seconds; `is_valid_view` determined by configured threshold/anti-refresh rule.
- `reader_progress` stores latest progress location separately (recommended): reader, manga, chapter, page index or page_uid, updated_at.
- Save progress on meaningful page transition, debounced while scrolling, on tab hidden/unload best-effort, plus explicit navigation.
- Progress writes must be monotonic in a single active reader session; reject stale delayed updates from old chapter/session.
- Reading history can append multiple sessions; progress upsert updates one current resume point per (reader,manga).
- Counters `mangas.total_views` / `chapters.view_count` update only after view qualifies; avoid counting reload/F5 as multiple views (dedupe policy configurable).

## 4. Account and profile frames

### 4.1 Registration frame (UC-6.4/6.5; Lab9 sequence 11)

1. User opens Register.
2. Fields: email, username, password, confirm password (confirm may be client-only).
3. Client performs format checks; server repeats all validation.
4. Submit `register`; server normalizes email/username, checks unique constraints, hashes password, creates `PENDING_VERIFICATION` account + Reader profile.
5. Generate short-lived, one-time email OTP; store only hashed OTP in shared Redis/cache, not SQL; expiry in sequence = 120 seconds.
6. Enqueue email delivery; return state “verification email sent” without waiting for provider.
7. User enters OTP; submit verify.
8. Server checks exact email/account binding, TTL, attempt limits, constant-time hash compare; atomically consume OTP and activate account.
9. If expired/wrong, show inline error and resend action; resend invalidates old OTP and rate-limits.
10. On success show success and route to login/home; only ACTIVE can log in.

### 4.2 Login frame (UC-6.4; Lab9 sequence 12)

1. User enters email or username + password.
2. Server normalizes identity and checks rate limit before expensive auth.
3. Find account; if missing or password mismatch, return same generic credential error to prevent user enumeration.
4. If `LOCKED`, deny and show safe moderation message (reason/duration only if policy permits; schema has no unlock expiry).
5. If `PENDING_VERIFICATION`, deny session and present resend verification.
6. If ACTIVE, reset failed attempt counter, create user session, store hashed refresh token; issue access JWT with session ID/JTI; add LOGIN activity log.
7. Redirect to return URL only if same-origin/safe; otherwise home.

### 4.3 Profile view/edit frames (UC-1.1, UC-6.1, UC-6.2)

**Profile view:** display name/avatar/bio; birth date only if public or self; email only self/Admin; lock status/violation history only Admin/self under documented privacy.

**Avatar change:**
1. Select file → validate extension and MIME (JPG/PNG/WebP) plus size/dimensions from config.
2. Optional crop preview.
3. Upload to isolated media storage path; re-encode/strip metadata if image processor exists.
4. Persist media object reference/URL only after upload success.
5. Keep previous avatar until new object is ready; async garbage-collect old unreferenced object.

**Profile edit:**
- Validate `display_name` non-empty and length; block reserved impersonation names (`Admin`, `Moderator`, `System`) with case/normalization checks.
- Bio is optional; sanitize HTML and render safely; script tags must not execute.
- Birth date cannot be future; unreasonable ages require validation policy (source omits exact max).
- Save `is_birth_date_public`; public profile API redacts DOB when false.

### 4.4 Password change frame (UC-6.3)

- Require current password, new password and confirmation.
- Server verifies current password, applies configurable password policy, disallows old password reuse, hashes new password with an approved password hashing algorithm.
- Revoke all other sessions with reason `PASSWORD_CHANGE`; current session may be reissued/retained after rotation. Source says other devices logout; record policy explicitly.
- Send security notification (recommended), but this email was not explicitly specified in source.

## 5. Comments and rating frames

### 5.1 Rating frame (UC-4.7/4.8)

- Display existing rating if any.
- Select integer 1–10; if user has not opened any chapter of this manga, disable or explain and server rejects.
- Submit creates or updates one rating row and appends rating history; show new average after server response.
- Remove rating marks `is_removed=true` (or equivalent domain remove) and appends REMOVE history; no average contribution.
- History screen paginates by recorded_at and labels Create/Update/Remove.

### 5.2 Comment list frame (UC-5.1/5.5)

- Query by manga and optional chapter, pagination, sort/filter.
- Hide `is_deleted=true` content. When a deleted root has replies, render placeholder to preserve thread; without replies it may be omitted.
- Show spoiler content behind reveal affordance; if `is_spoiler_locked_by_admin=true`, retain spoiler treatment regardless of user choice.
- Owner sees Edit/Delete actions; other readers do not.
- History button available when `is_edited=true`; records read-only.

### 5.3 Comment compose/edit modal (UC-5.2/5.3/5.4)

- Compose: content required, 1..2000 characters per sequence; spoiler checkbox.
- If chapter-scoped, include chapter context.
- If reply is allowed, identify parent comment and prevent reply to deleted/invalid parent.
- On save: sanitize/escape, validate ownership/parent, persist and log; render new comment.
- Edit: prefill current content and spoiler status; only owner; server loads current row then atomically adds edit history + update. If Admin has locked spoiler, user cannot uncheck it.
- On API failure preserve draft.

### 5.4 Comment reaction frame (UC-5.8)

- Render `like_count`, `dislike_count`, current reader reaction.
- Click Like/Dislike sets desired reaction. Same current reaction click may remove it (proposed reset semantics); opposite click switches.
- Server mutation is idempotent desired-state, transactionally updates `comment_reactions` and counters. Client always trusts returned counts/current reaction; do not locally decrement stale counts without confirmation.

## 6. Report moderation frames

### 6.1 Report queue (UC-1.6)

- Admin-only route.
- Filters: report type ACCOUNT/MANGA/COMMENT and status PENDING/RESOLVED/IGNORED/CLOSED.
- Each row: type, target snapshot, reporter, reason, created time, status.
- Default view `PENDING` (activity diagram shows pending filter).
- Pagination, newest first; no list for unauthorized user.

### 6.2 Report detail (Lab9 sequence 2; activity diagram)

1. Open report detail by ID.
2. Server fetches report + subtype snapshot + reporter + target current state.
3. If target missing/deleted, transition to CLOSED, set resolved_at, append action history/system audit and show “target no longer exists”; no target action controls.
4. If target exists, show reason, description, reporter, target snapshot/current data.
5. If suspicious report spam, Admin may open account activity log filtered for REPORT events.
6. Show target-specific actions: Account Lock/Ignore; Manga Hide/Delete/Ignore (and global future-report ignore); Comment Delete/Force Spoiler/Lock Account/Ignore as indicated by activity diagram.
7. Admin chooses action and supplies required note/reason.
8. Server validates action against report type, rechecks target existence, performs target action and updates report status/history atomically as far as same DB transaction permits.
9. For external side effects (email, CDC cancellation, storage cleanup), write outbox/job then commit; do not call network while holding DB transaction.
10. Refresh queue and target frame; show final state.

### 6.3 Lock/unlock frame (UC-1.2/1.3)

- Lock dialog shows identity, current state, required reason field and final confirmation.
- Reject target Admin. Recheck target is ACTIVE to avoid duplicate lock.
- Commit status LOCKED, lock metadata, revoke all active sessions, activity log; enqueue notification.
- Unlock dialog requires reason/note; target must be LOCKED; set ACTIVE, clear current lock fields, log and notify.
- `7 days` note is unresolved; MVP must not silently enforce. See ADR.

## 7. Manga Admin and ETL frames

### 7.1 Manga management list/detail (UC-2.1/2.2/2.4/2.5)

- Search by title, source ID, pool ID, slug; display visibility, CDC, sync status, latest chapter, rating/views.
- Hide action: confirmation if needed, set HIDDEN; reindex/remove public search docs; invalidate caches; audit.
- Show action: set PUBLIC; reindex; invalidate caches; audit; do not automatically re-enable CDC.
- Delete action: check `is_syncing`; if true show “đang đồng bộ, không thể xóa” and disabled action. Else show permanent warning + required reason. After confirmation cancel CDC first, mark tombstoning/deleting, delete local relations/contents, enqueue storage garbage collection, remove list refs, write audit.
- Stats screen: date range + tag + manga filters; metrics Views/Added-to-list/Ratings/Avg rating/Comments; no data state.

### 7.2 Source selection / ETL wizard (UC-2.3; Lab9 sequence 1; activity p75)

1. Admin opens import wizard.
2. Call external source endpoint to list packages ready for import.
3. If source timeout/unavailable, show connection error and Retry; never display stale “ready” selection as current.
4. Render package list and metadata preview; choose one or more mangas.
5. Configure CDC per manga (not just one ambiguous global toggle); default off.
6. Confirm selection; create `etl_jobs` + `etl_job_items`; return job ID immediately.
7. Background worker fetches each package, verifies contract, checksum and media manifest.
8. Invalid item: rollback only that manga item, store detailed error and mark FAILED; continue batch.
9. Valid item: upsert metadata, covers, creators/tags/chapters/pages/media, lineage and stats; compute content vector; update search index.
10. If CDC requested, register webhook/stream and persist subscription status.
11. Job terminal status SUCCEEDED/PARTIAL_FAILED/FAILED; UI shows per-manga result.
12. When CDC arrives, process idempotently; network gap triggers queue/retry; do not lose event.

### 7.3 Delete flow (activity p76)

- If manga currently syncing (`is_syncing=true`), block delete before confirmation, avoiding races.
- If not syncing, require reason and confirmation.
- Cancel CDC subscription; ensure an in-flight callback cannot recreate deleted manga (tombstone/epoch/lock check).
- Remove metadata, chapters, related comments and reading-list refs.
- Media deletion is background operation; don't block Admin UI.
- Audit record includes target manga, reason, actor, before/after, job ID.

## 8. Reading List frames

### 8.1 My Lists overview (UC-7.1)

- Require login.
- Search list name; show name, owner (self), item_count, description excerpt.
- Only query owner ID from session; never accept arbitrary `ownerId`.
- Empty and zero search results distinct.

### 8.2 List detail (UC-7.2)

- Route `/lists/{listId}`; backend resolves ownership.
- If not owner, 403/404 according to privacy policy; do not leak list name existence.
- Display list name/description/count and paginated `PUBLIC` manga items.
- Hidden manga omitted; list item_count must be defined consistently as actual membership count or visible count. Canonical: `item_count` reflects membership rows, while UI visible public count may be lower; expose both only if needed.
- tabs: items, filters/search, metadata stats.

### 8.3 Create/edit/delete list forms (UC-7.3/7.4/7.5)

- Name required, trimmed, normalized for uniqueness per owner; description optional max 500 by schema.
- Edit verifies owner and name conflict excluding current list.
- Delete requires confirm and removes list_items only; not manga/history/rating/comment. Update counters transactionally.

### 8.4 Clone/merge list frame (UC-7.6; Lab9 sequence 14)

1. Display current user's lists as source candidates.
2. Select one or more source lists.
3. Enter target list name/description.
4. Check all source IDs belong to owner.
5. If no sources selected, show validation.
6. If all selected lists are empty, show warning and require explicit confirmEmpty.
7. Gather existing eligible manga IDs, deduplicate.
8. Insert new list + list items in one transaction; update item_count.
9. Leave source lists unchanged.
10. Return new list detail; on duplicate name keep dialog open and display field error.

### 8.5 Add/remove manga memberships frame (UC-8.3/8.4; Lab9 sequence 15)

- On manga detail, fetch current memberships across current user's lists.
- Show checklist; optional quick-create list action if none exists.
- User changes desired selected list IDs; submit a desired-state set (not additive-only ambiguous payload).
- Server validates manga is public/exists and each selected list belongs to caller.
- Compute `toAdd = desired - existing`, `toRemove = existing - desired`; apply atomically, enforce unique (list,manga), maintain count.
- If unchecking an existing list, communicate that the manga will be removed from that list.
- Return final membership map; repeated same request should produce no duplicates or count drift.

### 8.6 List metadata stats frame (UC-8.5; Lab9 sequence 16)

- Check owner; fetch current list membership.
- Aggregate on current PUBLIC mangas: total titles, exported chapter count, tag distribution percent, publication status, average rating, most frequent Creator.
- Empty list: display “Danh sách chưa có truyện nào để thống kê”.
- Render charts and numeric summary; charts require textual/table alternative.
- Stats must be dynamic against current list; caching may be used only with membership/manga-update invalidation.

## 9. Admin reader statistics and activity log frames

- Reader detail: Admin opens account lookup and sees public profile plus protected details.
- Activity log filter: event type, time range, pagination. Event rows immutable, include time/action/target/IP when known.
- Reader stats: top tags, weekly/monthly frequency, unique manga/chapter counts, avg rating, frequent creators. Empty reader shows “not enough data” and discovery CTA.
- Metrics are derived only from real chapter opens and valid status actions; do not count arbitrary UI scroll events as reading history.
