# Reader, Manga Detail, Chapter List, Library & Social UX

## 1. Reader experience goals

- The manga page is the primary content; controls are secondary.
- Settings persist consistently across chapters according to `reader_settings`.
- Switching layout preserves current page identity/position.
- Chapter navigation is reliable, visible and reversible.
- Loading is progressive; do not wait for every page before showing the first usable page.
- User must be able to distinguish image loading, image failure, unavailable chapter, and end of chapter.
- Desktop keyboard, mobile touch and long-strip scrolling must not interfere with one another.

## 2. Reader layout modes

### 2.1 Shared reader shell

Top chrome (can auto-hide):
- Back to manga/detail.
- Manga title + chapter display label.
- Chapter selector / chapter list trigger.
- Previous chapter / Next chapter.
- Settings button.
- Report chapter/manga action only if included by product policy.

Canvas:
- Reader background configurable separately from site theme.
- Current mode determines width and page flow.
- Images are centered or aligned according to fit/direction settings.
- Reserve dimensions/aspect ratio to avoid layout shift where width/height metadata exists.

Bottom/edge controls:
- Page progress / progress indicator.
- Next chapter CTA at end.
- Back to top / page jump where supported.
- Hide/restore UI affordance.

### 2.2 Vertical Webtoon

- Stack pages in page_number order with no accidental gaps unless reader gap setting requests one.
- Use `loading=lazy` / intersection observer or equivalent, with preload around viewport.
- Preload count default is currently specified as 3 in DB design; expose as advanced setting only if useful.
- Track current page by stable `page_uid` or page identity, not raw scroll pixel only.
- Save progress after meaningful position change and debounce; flush on page visibility change/unload best-effort, but server should not depend exclusively on unload events.
- On very long chapter, use placeholder/virtualization only if it preserves natural scroll and current anchor; aggressive virtual unmount can break progress tracking.
- Mobile swipe-to-next-chapter must be opt-in or conservative; avoid accidental chapter changes while user is scrolling/zooming.

### 2.3 Single Page

- One page visible at a time.
- Previous/Next page controls visible on hover/toolbar or tap zones; mobile controls have minimum touch target.
- RTL changes navigation order only; it must not rewrite underlying `page_number`.
- Page counter: `current / total`, accessible name.
- Clicking image should not always advance if it may interfere with zoom or selection; provide setting for tap zones.

### 2.4 Double Page

- Page pairing rules depend on reading direction, first-page cover/spread policy and total count.
- Do not blindly pair [1,2], [3,4] without defining whether first page is solo.
- `DOUBLE_PAGE` on narrow screens: auto-fit or suggest SINGLE_PAGE/VERTICAL_WEBTOON; do not produce unreadably small pages.
- Never duplicate or skip a page when changing direction or resizing.
- Preserve current page anchor when entering/exiting double-page mode.
- Cover/spread handling is an OPEN DECISION if package provides no spread metadata.

### 2.5 Fit modes

- FIT_WIDTH: page width fits available canvas, aspect ratio intact.
- FIT_HEIGHT: page height fits available viewport minus chrome, aspect ratio intact.
- ORIGINAL: natural pixel size; overflow/pan behavior defined consistently.
- A maximum width cap can be used on wide monitors to avoid overly stretched narrow scans; this is a proposed UX preference, not source requirement.
- Never stretch non-uniformly.

## 3. Reader setting controls and state persistence

Current DB design has:
- `display_mode`: VERTICAL_WEBTOON / SINGLE_PAGE / DOUBLE_PAGE.
- `reading_direction`: LTR / RTL.
- `fit_mode`: FIT_WIDTH / FIT_HEIGHT / ORIGINAL.
- `preload_page_count`: default 3.

UI requirements:
- Settings panel grouped by Display, Direction, Image Fit, Loading/Performance, Interface.
- Preview changes immediately.
- Save to authenticated Reader settings; if anonymous reading is allowed, persist locally and migrate/merge only through a defined policy after sign-in.
- On API save failure: current session preview may remain, but show save failed and offer retry; do not claim cross-device sync succeeded.
- If setting is changed while progress is being persisted, update layout and progress in one coordinated state transition; debounce writes with revision/version guard to prevent stale overwrite.

## 4. Reader event / frame sequence

### 4.1 Opening a chapter

1. User selects Read First / Continue / chapter row.
2. App requests reader bootstrap data: manga core summary, chapter metadata, ordered page manifest, settings and progress.
3. Server verifies manga is PUBLIC and chapter belongs to manga.
4. If no chapter or no pages, return domain state (`NO_CHAPTERS`, `NO_PAGES`) and show message rather than blank canvas.
5. Render reader chrome + page skeleton placeholders immediately.
6. Request first visible pages/media delivery refs.
7. Load first page; set it visible; then preload `preload_page_count` further pages.
8. Record reading history for an authenticated Reader; do not create foreign-key-invalid anonymous history.
9. Begin progress tracking after page identity is known.

### 4.2 Page loading states

Each page component has states:
- `IDLE`: not requested.
- `LOADING`: spinner/skeleton placeholder; preserve page ratio when known.
- `LOADED`: image rendered.
- `RETRYABLE_ERROR`: failed; Retry button; next/previous still usable.
- `UNAVAILABLE`: page or chapter no longer exists; explain and provide Back to chapter list.

Avoid an infinite global spinner because one page fails. One failed page should not block all later pages.

### 4.3 Progress save

- Progress snapshot stores chapter ID, page identifier/index, display location if needed, updated_at and a version/revision.
- Save only when current page/anchor meaningfully changes; debounce (proposed 1–3 seconds depending mode; tune after profiling).
- Use idempotent upsert per Reader + Manga.
- Server validates that page belongs to chapter/manga.
- If chapter pages_revision changes due ETL/CDC, resolve saved progress by stable page_uid; if missing, choose nearest page_number or chapter start according to fallback rule and record that resolution.
- If concurrent devices update progress, use version/updated_at policy and avoid older writes overwriting newer state.
- Exact page-progress migration is documented in `../04_DATABASE_SCHEMA_AND_MIGRATIONS.md` M-001; implement before promising Continue to the same page.

### 4.4 Next / previous chapter

- Resolve chapter order within manga and selected language/group context.
- If no next chapter in current language, show a state that explains language-specific boundary; optionally offer another available language but do not silently switch.
- At last page of chapter: clear end-of-chapter CTA with Next Chapter if available, or return to title / chapter list.
- Previous/next must use numeric chapter ordering and deterministic language tie-breakers, not lexical string order.

## 5. Chapter list UX

### 5.1 Toolbar

- Language filter (default from Reader preference or most recently used language).
- Scanlation group/provider filter only if useful and data has values.
- Sort newest/oldest; default should be defined by product and consistent with Read First / Continue.
- Search chapter label/title if chapter count large.
- Pagination or virtualized list with stable ordering.

### 5.2 Chapter row / group

Show:
- `Ch. 10.5` / `Extra` / `Prologue` (display text), optional title.
- Volume if set.
- Chapter translation language.
- Scanlation group.
- Uploaded/published time.
- Page count where useful.
- Read indicator and current progress for signed-in user.
- Optional comment count if available.

Never show internal IDs. Use `chapter_numeric` only for sort, never display in place of chapter_number.

### 5.3 Multiple translations

Two possible layouts:
1. Filter by language, then show one chapter row per matching chapter.
2. Group same logical chapter number into an expandable parent containing language/group variants.

Preferred MVP: language filter + visible language in every row. Grouping is P1 because the source may have multiple chapter variants with ambiguous equivalence; don't collapse different sources if they are not guaranteed to be same logical chapter.

### 5.4 Long chapter list

- Sticky toolbar remains available.
- Pagination preserves sort and language.
- On changing page, announce result range and move focus to list heading.
- Do not auto-navigate to reader when clicking comment count; separate actions.

## 6. Manga detail actions: reading status vs follow vs list

Use separate concepts:

- **Reading status:** READING, PLAN_TO_READ, COMPLETED, ON_HOLD, DROPPED (current app DB enum; do not expose unsupported RE_READING unless model is updated).
- **Follow updates:** subscription to updates/feed if the app supports it; current database sync tables are about manga-source CDC, not reader follow. Do not reuse `manga_sync_subscriptions` for user follows.
- **Custom Reading List:** user-owned collection of manga; private owner-only in current canonical MVP.
- **Favorite/bookmark:** if desired, this may map to reading status or be separate; don't add a new concept without product decision.

Detail CTA should make the main action clear:
- no progress: `Read from beginning`;
- progress exists: `Continue reading` as primary; `Start from beginning` secondary;
- no chapter: disabled Read with explanation;
- status action is separate.

## 7. Rating and comments entry points

### 7.1 Rating

- Detail page displays current average and number of ratings.
- User action “Rate this manga” opens rating control.
- If the system requires a chapter-open event before rating, show a concise explanation and server decides eligibility.
- No data: show no rating state, not zero stars.
- Show rating history only to owner or authorized Admin; don't expose another user's private rating timeline.

### 7.2 Comments

- Manga-level comments and chapter-level comments must be visibly scoped.
- New comment form labels the context (“Bình luận về truyện” or “Bình luận chapter X”).
- Spoiler toggle is adjacent to submit controls, with warning copy.
- Spoiler content initially masked; reveal button announces spoiler.
- Replies use the current one-level nesting proposal unless ADR changes.
- Edit/delete controls appear only for own comments or Admin, but server is authoritative.
- Deleted root with replies can show placeholder to preserve thread context.
- Like/dislike controls display selected state; use explicit desired state to support idempotent API.
- Report action opens dedicated reason form; do not mix with Delete.

## 8. Library and list UX details

### 8.1 Reading library

Tabs: Reading, Plan to Read, Completed, On Hold, Dropped. Counts reflect current records. If there are no items in a tab, provide a one-line explanation and `Explore manga` action.

### 8.2 Custom lists

- List overview shows title, item count, description, cover collage.
- Detail shows `Add manga`, search within list, sorting and item actions.
- Add-to-list modal supports selecting multiple lists without creating duplicate membership.
- If user has no list, create a list inline and then add current manga.
- Clone lists flow previews deduplicated result count before confirm.
- Private owner-only: no public visibility toggle in MVP.

### 8.3 List analytics

Existing Use Case asks stats by tags, publication status, average rating, creators, total manga/chapter counts.
- Display date context: “calculated from current list contents”.
- Empty list uses dedicated empty-state, not zero-filled charts.
- For unknown tags/rating fields, show “Unknown / no rating” bucket instead of silently dropping records.
- Explain official chapters vs exported chapters.
- Charts need accessible text/table equivalent.

## 9. Reading history and continue surfaces

- History is event chronology; progress is the latest resume point. Don't conflate them.
- Detail page Continue CTA reads from progress snapshot, not most recent history open alone.
- History page can show a “Resume” action if the chapter remains public and readable.
- Deleted/hidden manga/chapter history: follow retention policy; don't expose content; show unavailable entry only if allowed and useful.
- Clear history must not accidentally delete progress unless product explicitly specifies that linkage.

## 10. Reader settings and user-experience acceptance

1. Reader loads first page without waiting for all chapter images.
2. One bad page doesn't freeze the entire chapter.
3. Vertical mode scrolls in page order and tracks stable page identity.
4. Single-page mode supports previous/next with correct direction.
5. Double-page mode doesn't duplicate/skip pages at first/last pair.
6. Resize/mode switch preserves reading position.
7. Settings apply immediately and persist only when server/local save succeeds.
8. Mobile swipe does not accidentally change chapter while scrolling.
9. Chapter language is explicit and never silently changes at chapter boundary.
10. Continue action opens exact saved page if progress exists.
11. Stale page progress after pages_revision update resolves deterministically.
12. Read First handles no chapters with disabled/empty state.
13. Hidden manga cannot be opened through cached chapter route.
14. Rating eligibility is explained; server is authoritative.
15. Comment spoiler is hidden by default and accessible.
16. Reading status, follow updates, custom lists remain separate concepts.

