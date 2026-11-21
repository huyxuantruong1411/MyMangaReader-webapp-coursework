# Ratings, Comments, Reactions, Reports from Reader & Reading Lists

## 1. Rating subsystem (UC-4.7/4.8)

### 1.1 Data semantics

- `ratings` represents current user rating for a manga.
- `rating_histories` represents immutable history of rating changes.
- One current row per `(reader_account_id,manga_id)`.
- Score is integer 1..10 from UC and Lab9 sequence; add database check.
- `is_removed=true` indicates removed current rating; it must not affect `average_rating`.

### 1.2 Eligibility

Lab9 sequence explicitly checks reading history before rating. Canonical condition: the current Reader must have at least one persisted chapter-open event for the manga. Do not treat merely selecting a reading status or opening manga metadata as read eligibility.

The source does not state that the open must cross valid-view duration threshold. Use “opened a chapter” to align the sequence; if stricter “read N seconds” is later desired, create a product decision and update all tests/UI copy.

### 1.3 Create/update/remove

- No current rating: insert rating, append `CREATE(previous_score=NULL,new_score=x)`.
- Existing active rating: update score, append `UPDATE(previous_score=old,new_score=new)`.
- Remove: set `is_removed=true`, append `REMOVE(previous_score=old,new_score=NULL)`.
- Re-add after remove: either restore same row with CREATE-like history or a new row; recommended restore same unique current row and append CREATE with previous null. Preserve history chronology.
- All changes happen in one transaction.
- Recompute/adjust manga average in same transaction or via versioned aggregate job; API returns authoritative rating+average.

### 1.4 Rating history frame

- Require self Reader or Admin-authorized stats view; do not expose individual other users' rating histories.
- Sort by `recorded_at DESC`, stable tie-break by history ID.
- Show action labels and old/new values; `REMOVE` means current rating no longer contributes.

## 2. Comment subsystem (UC-5)

### 2.1 Scope and target

A comment belongs to a manga and optionally a chapter:
- `manga_id` is always stored for fast manga-level queries.
- `chapter_id=NULL` means manga-level comment.
- `chapter_id!=NULL` means chapter-scoped comment and chapter must belong to same manga.
- UML shows replies/parent-child. DB source omits parent FK; add `parent_comment_id` per migration proposal.

### 2.2 Create (UC-5.2)

1. User must be authenticated and ACTIVE.
2. User chooses manga-level or chapter-level context; if reply, `parent_comment_id` points to a valid non-deleted root.
3. Content required; Lab9 sequence validates max 2,000 characters.
4. Apply safe rendering/sanitization; persist `is_spoiler`, default false; persist author and timestamps.
5. Record activity log event and return created comment.
6. UI inserts it into comment list and clears draft only after success.

Proposed validation:
- trim whitespace to detect empty content;
- preserve meaningful line breaks;
- do not allow raw executable HTML/JS;
- server validates content length after Unicode normalization by code points/graphemes policy (choose one consistently).

### 2.3 Replies

- Self-FK `parent_comment_id` must refer to comment with same manga and chapter context.
- For MVP, allow only one-level nesting (`parent_comment_id` points to root; no reply-to-reply) to keep UI and soft-delete semantics clear. This is a proposed rule because UML shows parent-child but not depth.
- Deleting a root with replies results in placeholder `[Bình luận đã bị xóa]`; no replies means it can be omitted.
- Deleting a parent does not cascade delete replies.

### 2.4 Spoiler flag (UC-5.3)

- `is_spoiler` = current flag.
- `is_spoiler_locked_by_admin` = Admin-enforced lock; if true, Reader cannot toggle spoiler off.
- Create form checkbox lets user mark spoiler.
- Edit form can change spoiler only when not locked by Admin.
- Admin force spoiler sets both `is_spoiler=true` and `is_spoiler_locked_by_admin=true`.
- If Admin unlock function is later added, require a separate permission/action/audit event; not specified in the current use cases.
- UI must hide spoiler content until reveal; screen readers/accessibility should receive a clear spoiler label.

### 2.5 Edit (UC-5.4/5.5)

1. Author clicks Edit; client fetches latest comment if not already current.
2. Server checks `reader_account_id == currentReader`, comment not deleted, account ACTIVE.
3. Form prefilled with text/spoiler status.
4. On submit server revalidates; transaction inserts `comment_edit_histories(previous_content, previous_is_spoiler, editor, edited_at)` then updates `comments.content/is_spoiler/is_edited/updated_at`.
5. UI shows Edited label and history view.
6. Edit-history endpoint returns previous versions in descending time or chronological order; pick one presentation, keep stable ordering. History is read-only.

The base DB table has only previous content, while edit flow can change spoiler; migrate to preserve spoiler version state.

### 2.6 Delete (UC-5.6)

- Reader can soft-delete only own comment; Admin may delete through moderation.
- Set `is_deleted=true`; preserve author, timestamps, reactions and edit history as needed for evidence, but do not display content.
- UI placeholder logic depends on replies (see above).
- A second delete call returns idempotent state; it must not decrement counters twice.

### 2.7 Filter/list comments (UC-5.1)

- Filter by manga, chapter (including chapter-null), sorting/time and any implemented filter chips.
- Never return deleted content except placeholder state when a deleted parent has visible replies.
- Use pagination; stable sort key.
- Owner-specific action controls are computed server-side or from authenticated actor context; never expose edit action as a security assumption.

## 3. Comment reactions (UC-5.8)

### 3.1 State model

`none`, `LIKE`, `DISLIKE` per `(reader_account_id,comment_id)`.

State transitions:

| Before | Desired | DB operation | Counter effect |
|---|---|---|---|
| none | LIKE | insert LIKE | like +1 |
| none | DISLIKE | insert DISLIKE | dislike +1 |
| LIKE | DISLIKE | update reaction | like -1, dislike +1 |
| DISLIKE | LIKE | update reaction | dislike -1, like +1 |
| LIKE | none | delete reaction | like -1 |
| DISLIKE | none | delete reaction | dislike -1 |
| same | same | no-op or toggle-to-none by explicit API action | no-op unless reset explicit |

Prefer explicit desired-state endpoint (`PUT /comments/{id}/reaction` with `reactionType=LIKE|DISLIKE|null`) so retries are idempotent. If click-to-toggle behavior is adopted, API contract must say so explicitly.

### 3.2 Concurrency

- Unique `(reader_account_id,comment_id)`.
- Row lock/upsert transaction; update counts from before vs after state.
- Never trust client-provided counts.
- Reconciliation job recalculates cached counts from reactions.
- Deleted comment may disallow new reactions; existing reactions may be preserved or removed by policy. Canonical: disallow new reaction and keep history/counters for audit until retention cleanup.

## 4. Report interactions from Reader

- Report submit only by active authenticated Reader.
- Account report cannot target current Reader.
- Manga report can specify chapter.
- Comment report captures comment snapshot; a deleted target can still be reviewed by snapshot.
- Rate limit repeated submissions; source explicitly mentions temporary blocking for fake repeated reports.
- On success display report submitted confirmation; do not expose Admin internal status to reported target.
- Reader does not see other people's report payload or reporter identity.

## 5. Reading List model (UC-7)

### 5.1 List entity

Fields from Lab10:
- `list_id`, `owner_reader_account_id`, `name`, `normalized_name`, `description`, `item_count`, `created_at`, `updated_at`.
- Owner-only mutation.
- Name required; normalized unique per owner; description optional.
- Private owner-only is canonical MVP (sequence/class diagram). A public/community list model would need visibility and permission schema that is absent.

### 5.2 Create/edit/delete

**Create:**
- Require ACTIVE Reader.
- Trim and normalize name; non-empty; check unique name per owner with DB constraint.
- Description optional, max 500 per DB field.
- Insert with count 0.

**Edit:**
- Verify owner.
- Update name/normalized name/description; if conflict show field-level validation.
- Preserve list ID, items and creation time.

**Delete:**
- Owner only + explicit confirmation.
- Delete membership rows then list; no cascading effect on manga, ratings, comments, reading history or progress.
- Repeated delete may return 404/idempotent missing result.

### 5.3 Search lists (UC-7.1)

- Query only by current Reader owner ID.
- Search list name; optionally other metadata fields mentioned in UC but fields must exist before supported.
- Show title, owner label (self), item count, description excerpt.
- Must not include lists from other users despite parent UC's wording about public community lists; see ADR-009.

### 5.4 View list (UC-7.2; Lab9 sequence 13)

- Verify list exists, then verify owner. To avoid enumeration, API may return 404 for non-owner.
- Fetch list items, join manga rows; only `PUBLIC` manga are exposed in reader list view.
- Paginate and preserve stable order (e.g. `added_at DESC, list_item_id`).
- `item_count` in DB counts membership rows. If hidden mangas are omitted from visible response, provide a separate `visible_item_count` if UI needs it; don't silently redefine stored count.

### 5.5 Clone/merge list (UC-7.6; Lab9 sequence 14)

- Source: one or more existing lists owned by current Reader.
- New list name must be unique within owner; description optional.
- If no source selection, validation error.
- If all selected lists empty, warn and require explicit `confirmEmpty=true` (sequence diagram).
- Gather manga IDs; drop duplicates; omit deleted/nonexistent mangas. Hidden manga policy: recommended omit at clone time while retaining memberships in source lists.
- Create list + insert distinct rows + item_count in one transaction.
- Source lists remain unchanged; return new list ID and count.

## 6. Manga membership in lists (UC-8)

### 6.1 Search/filter within a list

- Search title and Author/Artist among only the current list's manga.
- Filter tags/status/read status and sort rating/date added as UC text indicates.
- Tag filter options should derive from tags of currently visible list contents.
- Empty list: show empty list rather than error.

### 6.2 Add to multiple lists (UC-8.3; Lab9 sequence 15)

1. Open “Add to list” from manga detail.
2. Fetch all current Reader lists and current membership state for manga.
3. Render checklist.
4. If no list exists or user chooses quick create, create list with unique name; do not lose current selection state.
5. User selects desired list set.
6. Submit all selected list IDs (desired-state semantics).
7. Server validates manga and each list owner; diff against existing membership.
8. Insert missing pairs, delete unchecked pairs, maintain counts transactionally.
9. Return final memberships and updated counts.

Unchecking an existing membership is destructive removal; UI text must communicate this. Repeated submit must not duplicate rows or change counts.

### 6.3 Remove from a list (UC-8.4)

- Verify owner, list membership and manga.
- Delete only the `list_items` row; decrement item_count once.
- Never change reading status, history, progress, rating or comment.

## 7. List metadata stats (UC-8.5; Lab9 sequence 16)

Compute dynamically against currently visible/eligible manga in list:
- number of manga;
- sum of exported chapters (from manga_stats, not official chapter counts);
- tag distribution percent (define denominator explicitly; recommended percent of manga containing each tag, values may sum >100% when multiple tags per manga);
- publication status distribution;
- average rating (recommended average of each eligible manga's aggregate rating, excluding zero-rated manga; alternatively weighted rating count—must be specified before implementation);
- most frequent Creator/Author/Artist (combine roles but show role counts separately if useful).

Empty list → exact empty state: “Danh sách chưa có truyện nào để thống kê”.

### 7.1 Denominator definitions

Avoid ambiguous chart percentages:
- `tag_share = (count of eligible manga with tag / eligible manga count) * 100`.
- status share denominator = eligible manga count.
- average list rating: choose one method and use consistently. Proposed simple mean of each manga's `average_rating` for manga with at least one rating; display sample size.
- top creators: count distinct eligible manga credited to each creator; count Author and Artist roles separately or show combined work count.

These denominator decisions are proposed because source names metrics but does not fully define formulas.

## 8. Counter and cache consistency

- All list membership writes and `item_count` change occur in one transaction.
- `item_count` should be periodically reconciled from `list_items`.
- Hide manga: keep membership rows but hide manga from public list view and statistics; show again restores visibility.
- Delete manga: UC-2.4 explicitly removes all list references; perform bulk deletion and recalc affected list counts transactionally or via consistent deletion job.
- Cached stats invalidated when membership, manga visibility, tags/status/creators, rating average or exported chapter counts change.
- If async stats cache is returned, include calculation timestamp and clear stale indicator.

## 9. Required social test cases

See `11_TEST_STRATEGY_ACCEPTANCE.md` sections 6–8 for detailed scenarios; at minimum test:
- rating without open history rejected;
- rating update/remove history correctness;
- comment edit history before update and spoiler flag preservation;
- owner-only edit/delete;
- soft delete with/without replies;
- reaction transitions and count correctness under concurrency;
- list clone dedup/empty confirm/ownership;
- list selected-set synchronization and idempotency;
- hidden manga omission and delete cleanup;
- statistics denominators and zero-data states.
