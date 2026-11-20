# Reader Engine, Chapter Navigation, Progress & Media Delivery

## 1. Responsibilities

The Reader feature owns:
- resolving manga/chapter actions (`START`, `CONTINUE`, `SELECT`);
- ordered chapter/page manifest retrieval;
- display mode/layout/direction/fit settings;
- progressive image loading and retry behavior;
- reading history event creation and progress snapshot persistence;
- valid view qualification and chapter/manga view counters;
- next/previous chapter navigation.

It does not own crawling, image cleaning/upscaling/watermarking, or source package creation. Those are upstream service responsibilities.

## 2. Chapter catalogue and ordering

### 2.1 Chapter list response

For each chapter return at minimum:
- `chapter_id` internal ID;
- `pool_chapter_id` for trace/debug only if exposed;
- `chapter_number` display string;
- `chapter_numeric` sort key if client sorts;
- `volume`, `title`, `language`, `scanlation_group`, `publish_at`;
- `page_count` and availability state.

### 2.2 Sorting

Canonical order:
```sql
ORDER BY chapter_numeric ASC, language ASC, pool_chapter_id ASC
```
If `pool_chapter_id` is absent in a local/manual chapter, use `chapter_id` as stable final tie-breaker. For descending sort reverse all sort keys consistently. Do not parse `chapter_number` string to approximate order. `Prologue` and `Extra` sort according to upstream `chapter_numeric`; never hardcode their relative order.

### 2.3 Language/volume selection

- Same numeric chapter in different languages may produce multiple rows.
- The chapter selector should expose language and scanlation metadata.
- Filter by language/volume must not silently choose a different chapter ID than displayed.
- A “latest chapter” card must use publication/order semantics agreed with product; default based on ordered chapter list + publish/update timestamp, not alphabetical string.

## 3. Open chapter algorithm

Input command: `mangaId`, optional `chapterId`, `actionType` (`START`, `CONTINUE`, `SELECT`).

```pseudo
openReader(reader?, mangaId, actionType, chapterId?):
  manga = getManga(mangaId)
  require manga exists and visibility == PUBLIC
  chapters = get ordered chapters for manga
  if chapters.empty: return NO_CHAPTERS
  if actionType == START:
      chapter = chapters.first()
      page = 1
  else if actionType == CONTINUE:
      if reader exists:
          progress = get reader_progress(reader, manga)
      else:
          progress = none
      if progress exists and its chapter still belongs to manga and is readable:
          chapter = progress.chapter
          page = resolve saved page_uid/page_number against current chapter revision
      else:
          chapter = chapters.first()
          page = 1
  else if actionType == SELECT:
      require chapterId exists
      chapter = get chapter and require chapter.manga_id == manga.id
      page = 1 (or optional explicit requested page if a deep link is supported)
  validate page manifest is internally consistent
  if reader is active:
      append reading_history(opened_at, chapter_id, duration=0, is_valid_view=false)
      upsert reader_progress to current starting page if source policy says open starts progress
  return chapter + page manifest + reader settings + progress
```

Security/consistency requirements:
- Re-check `PUBLIC` at open endpoint, regardless of detail page cache.
- Chapter must belong to requested manga; prevents arbitrary chapter ID access through mismatched manga path.
- A stale progress chapter that has been deleted or moved must fall back gracefully to first available chapter and update saved state.
- If manga is hidden during reading, subsequent progress writes should follow product policy. Recommended: stop further authenticated mutations and show “manga unavailable” after next access check; do not reveal hidden content through an old route indefinitely.

## 4. Exact progress persistence

### 4.1 Separation of concerns

`reading_histories` is an event/audit stream of chapter opens:
- `history_id`, `reader_account_id`, `chapter_id`, `opened_at`, `reading_duration_seconds`, `is_valid_view`.
- one row per chapter-open session (as Lab10 notes).
- records that user opened a chapter; it does not identify a page.

`reader_progress` is current state:
- unique `(reader_account_id,manga_id)`;
- latest `chapter_id`, `page_number`, optional `page_uid`, `pages_revision`, `updated_at`.
- upserted during reading.

This distinction is mandatory if “Continue reading” must resume at the exact page. See ADR-001.

### 4.2 Progress update events

Client emits `PROGRESS_CHANGED` when:
- vertical scroll active page changes meaningfully;
- single/double page navigation moves to a new logical page;
- chapter navigation succeeds;
- reader tab becomes hidden/closing (best-effort flush);
- periodic debounce checkpoint triggers.

Progress payload proposal:
```json
{
  "mangaId": "<internal-id>",
  "chapterId": "<internal-id>",
  "pageNumber": 17,
  "pageUid": "<stable-page-uid-or-null>",
  "pagesRevision": 3,
  "clientSequence": 42
}
```

Server:
- derives Reader ID from session;
- validates chapter belongs to manga and page number exists in current manifest;
- if pageUid is supplied, confirms it maps to that page/current or compatible revision;
- rejects updates from a stale chapter/session sequence (use updated_at/version or client sequence scoped to session);
- upserts one progress row;
- does not create a new reading history row for every progress update.

### 4.3 Resume after package update

- Try exact `page_uid` first if present in new chapter revision.
- Else if same page revision, use `page_number`.
- Else clamp old page number to `1..new_page_count` and show note if page mapping changed.
- If the saved chapter is deleted, choose nearest next available chapter based on chapter order; if none, previous; if none, first. This fallback is proposed; make deterministic and test it.

## 5. Image delivery pipeline

### 5.1 Package to reader path

1. ETL validates `ReaderMediaRef` bucket/object key and file hash.
2. Store metadata in `media_objects`; store page relation in `chapter_pages`.
3. API resolves page reference to internal media ID.
4. Media service authorizes access to a public manga and returns CDN path or signed URL.
5. Browser requests image from CDN/object storage.

Object URLs should not be persisted as stable package identity. CDN URL may expire; client refreshes via media endpoint when 401/403/404 is expected due to expiry/move.

### 5.2 Image UI states

- not requested: placeholder with reserved aspect ratio if width/height known;
- queued/loading: shimmer/skeleton;
- loaded: image with correct aspect ratio;
- transient failure: retry automatically within configured budget;
- permanent failure: error placeholder with Retry and Report manga affordances;
- missing page manifest: chapter-level error with return to chapter list.

One broken image must not fail all chapter pages. Prefetch cancellation should happen on rapid chapter/page changes.

### 5.3 Lazy load and preload

- Use browser lazy-load/IntersectionObserver for page images outside viewport.
- `preload_page_count` default 3 per Lab10 diagram; define whether includes current visible page or the next three pages (recommended: next 3 beyond visible page/spread).
- Keep memory bounded; release far-offscreen decoded bitmaps when necessary.
- Do not prefetch the entire chapter by default.
- Use immutable cache key incorporating page UID + `pages_revision` or content hash.

### 5.4 CDN and storage security

- Private bucket by default; signed URL or edge auth for public Reader API.
- Object key validation rejects traversal/control characters and enforces bucket allowlist.
- MIME sniff decoded content; extension is not enough.
- Verify file size, dimensions, hash and image decode before publish.
- Do not expose admin-only raw object keys unnecessarily.
- Media object garbage collection only after reference count is zero and retention period passes.

## 6. Reader display state machine

### 6.1 Enums

```text
DisplayMode: VERTICAL_WEBTOON | SINGLE_PAGE | DOUBLE_PAGE
ReadingDirection: LTR | RTL
FitMode: FIT_WIDTH | FIT_HEIGHT | ORIGINAL
```

### 6.2 Mode behavior

- VERTICAL_WEBTOON: sequential pages in one vertical strip; scroll position maps to active page.
- SINGLE_PAGE: one page displayed; next/previous keys move exactly one page.
- DOUBLE_PAGE: deterministic two-page spreads, honoring direction; avoid showing same page twice and avoid skipped final page.
- LTR: forward navigation advances page order left-to-right; RTL reverses visual placement/navigation direction according to manga reader expectations. Underlying `page_number` remains source order.
- Fit Width/Height/Original preserve image aspect ratio.

The contract page numbering is 1-indexed reading order. It does not explicitly define first spread/cover pairing; keep this a renderer policy behind unit tests.

### 6.3 Live settings change

1. Capture active page UID/page number and visible anchor.
2. Update preview layout locally.
3. Recompute spreads/flow.
4. Restore anchor to same page identity.
5. Persist settings asynchronously.
6. On save failure show unsaved state; keep current display to avoid jarring rollback.

Settings apply across subsequent chapters.

## 7. Previous/next chapter

- At final page of a chapter, Next navigates to next ordered chapter if available.
- At first page, Previous navigates previous ordered chapter if available.
- Respect selected language policy: prefer same language if present in adjacent chapter; if absent, either show chooser or deterministic fallback. Source doesn't define this; use a language selection preference and expose actual language label.
- Create new `reading_histories` row when a chapter is opened through transition; update progress to page 1/new chapter.
- If next chapter not available, show disabled control or “latest chapter” state.

## 8. Valid view and anti-refresh rules

Source requires a valid view only when Reader has actually loaded/opened the chapter and crossed a duration threshold to avoid repeated refresh spam. Exact threshold/window absent.

Recommended design:
- Create reading session record at chapter open.
- Track active reading duration excluding hidden tab/background idle time where practical.
- Mark `is_valid_view=true` once configured threshold is met and minimum content loaded.
- Enforce idempotency so one open session can mark valid once.
- Optional dedupe key: reader + chapter + time bucket/session; avoid suppressing legitimate later reading sessions without product approval.
- Increment chapter/manga counters exactly once per valid history event.
- Anonymous users: decide whether to count using ephemeral anonymous session identifier; source DB only stores reader FK, so do not insert fake Reader ID.
- Store threshold/dedupe policy in config and tune with analytics, not hardcode guessed values.

## 9. Reader error catalog

| Error code | Condition | UI recovery |
|---|---|---|
| `MANGA_NOT_FOUND` | missing/hidden manga | Return to catalogue; no hidden metadata |
| `CHAPTER_NOT_FOUND` | deleted/stale chapter | Refresh chapter list; select another chapter |
| `NO_CHAPTERS` | empty manga chapter collection | Metadata remains; Read First disabled |
| `PAGE_MANIFEST_INVALID` | page numbers/count inconsistent | Chapter-level retry/report; do not render partial corrupt sequence silently |
| `MEDIA_NOT_FOUND` | object missing | Per-page error + retry/report |
| `MEDIA_FORBIDDEN` | invalid signature/permission | Refresh signed URL once, then error |
| `MEDIA_CHECKSUM_MISMATCH` | corrupted asset | Quarantine asset; Admin/ETL alert; don't keep retrying |
| `PROGRESS_CONFLICT` | stale client sequence/revision | Refresh saved progress and continue current local session |
| `SETTINGS_SAVE_FAILED` | preference API failed | Keep local preview; retry save |

## 10. Reader telemetry and analytics

Capture events with privacy control:
- `CHAPTER_OPENED` (history ID, Reader ID if authenticated, chapter ID, source action).
- `PROGRESS_UPDATED` (page number, no full reading content).
- `VALID_VIEW_RECORDED`.
- `READER_SETTINGS_CHANGED`.
- `CHAPTER_NAVIGATED`.
- `PAGE_LOAD_FAILED` with media ID/error code.

Do not use every scroll event as a server-side analytics row; aggregate progress client-side and checkpoint.
