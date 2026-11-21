# Information Architecture & Screen / Frame Specifications

> Mỗi page phải implement cả states và events, không chỉ layout tĩnh. Các frame sau là đề xuất cấu trúc UX; route hiện hữu của codebase cần được khảo sát trước khi đổi.

## 1. Information architecture

### 1.1 Global navigation groups

**Discover**
- Home / Discover
- Advanced Search
- Recently Added
- Latest Updates
- Popular / Top Rated (nếu counters đủ)
- Random Discovery

**Personal**
- Continue Reading
- Reading Library / Status
- Reading Lists
- Reading History
- Preferences / Reader Settings

**Social and detail**
- Manga detail tabs: Chapters, Comments, Art (nếu có dữ liệu), Recommendations
- Creator detail
- User profile

**Admin**
- Accounts, manga catalogue management, ETL jobs, reports, activity logs, analytics.
- Admin navigation must be role-gated and visually distinct, but share design tokens.

### 1.2 Route map recommendation

Use existing routes if already in production; route list below is a canonical recommendation, not permission to break current deep links.

| Route | Screen | Auth |
|---|---|---|
| `/` | Discover Home | Public |
| `/explore` | Manga catalogue | Public |
| `/search` | Global title/creator search | Public |
| `/search/advanced` | Advanced Search | Public |
| `/manga/:slug` | Manga detail | Public (PUBLIC manga only) |
| `/manga/:slug/chapters` | Chapter-list anchor/tab | Public |
| `/manga/:slug/comments` | Manga comments anchor/tab | Public read; authenticated write |
| `/chapter/:chapterId` | Reader | Public or app policy |
| `/author/:creatorId/:slug` | Creator detail | Public |
| `/library` | Personal reading status view | Auth |
| `/lists` | My reading lists | Auth |
| `/lists/:listId` | Reading list detail | Owner-only per canonical MVP |
| `/history` | Reading history | Auth |
| `/profile/:username` | Public profile | Public with privacy filtering |
| `/settings` | Account + reader preferences | Auth |
| `/admin/...` | Admin workspace pages | Admin |

## 2. Shared page lifecycle

Every data-driven page must follow:

1. Route enters and parses route/query parameters.
2. Validate parameters against enums/ranges; invalid values are normalized or rejected with a clear fallback.
3. Render stable skeleton matching final layout dimensions.
4. Fetch public data; protected pages check session and role server-side.
5. Bind response to screen; avoid flicker and layout shift.
6. If partial sections fail, keep primary content and show local retry state in failed section.
7. On mutation, show pending state on the triggering control; prevent duplicate submit; on success update authoritative server state and dependent caches.
8. On failure, preserve the user's input/filter draft and show recoverable error.
9. Preserve scroll/focus when query changes where appropriate.

## 3. Discover Home

### 3.1 Desktop frame regions

1. Global header.
2. Page intro: “Khám phá truyện” + one concise sentence + global search.
3. Continue Reading shelf (only for authenticated users with `reader_progress`; don't render empty placeholder for anonymous users).
4. Latest Updates shelf / feed preview.
5. Popular or Top Rated shelf (only when data source is valid; define period if shown).
6. Recently Added shelf.
7. Recommendation shelf (label source: For You / Similar to [title] / Popular fallback).
8. Footer/help/legal.

Avoid more than 4–5 shelves on first viewport. Home should be scannable; “View all” opens a full listing route with filter/sort context.

### 3.2 Home card content

- Cover, title, main genre/tag (max 2–3 labels), status, latest uploaded chapter (if available), language label if it helps disambiguate.
- Optional average rating + count when the values are real and populated.
- Avoid large synopsis text on every shelf; use 1–2 line snippet only in featured content.

### 3.3 Events

- `CONTINUE_CARD_CLICKED`: open saved chapter + page progress.
- `SHELF_VIEW_ALL_CLICKED`: route to shelf listing with appropriate sort/filter.
- `MANGA_CARD_OPENED`: route to canonical detail.
- `RECOMMENDATION_DISMISSED`: only if recommendation preference API exists; otherwise don't render fake dismiss affordance.
- `HOME_REFRESHED`: refetch latest shelf data without clearing unrelated client state.

### 3.4 States

- Anonymous: no Continue Reading; show discovery shelves.
- New account: explain library/reading history will fill as user reads; do not show empty charts.
- Shelf has no data: hide optional shelf or show purposeful state, not an empty carousel shell.
- One shelf API fails: that shelf shows local Retry; rest of home stays interactive.

## 4. Global Search

### 4.1 Search entry overlay / command palette

- Open from header input, keyboard shortcut if supported, or search icon on mobile.
- Focus input automatically; trap focus only while true modal dialog is open.
- Search types/modes are explicit: Titles, Creators (Authors/Artists), optionally All.
- Typeahead starts after minimum query length (current plan: at least 2 chars) and debounces around 300ms; this is app-specific requirement/plan, not copied from competitor.
- Show max 10 suggestions (Lab9 sequence). Group by type with labels. Each title suggestion can show cover, title, relevant alt title/highlight, status/content rating. Creator suggestion shows name, role, number of public works if available.
- Keyboard: Arrow Up/Down, Enter, Escape, Tab; screen-reader live announcement for result count.

### 4.2 Full result page

- Heading “Search results” + exact query + mode.
- Active filters (if search deep-links to advanced filters) displayed as removable chips.
- Sort and view toggle (grid/list) if useful.
- Result count if available.
- Title results and creator results use different card/list components.
- No result state: keep query, suggest removing some filters, show related titles only if real data/algorithm exists.

## 5. Advanced Search / Explore

See `04_ADVANCED_SEARCH_UX_SPEC.md` for complete control-level behavior.

### 5.1 Desktop

- Header/title row + optional title query field.
- Left filter panel (300–340px) with grouped accordions and visible selected counts.
- Main results panel: sort, view mode, result count, active-filter chips, MangaCard grid or horizontal list.
- Sticky filter panel may scroll independently only if it does not create nested-scroll conflict; main page should remain scrollable.
- Apply button in filter panel if using draft state; “Reset” and “Search” visible without needing to scroll to the bottom.

### 5.2 Mobile

- Main results page with `Filter (n)` button above results.
- Filter sheet with section accordions, search within tag list, sticky footer `Clear all` / `Show results`.
- Keep unsaved filter draft separate from applied URL state; closing via X can prompt only if changes would be lost (avoid needless dialog for every close).
- Filter sheet height respects safe areas; no action button hidden under mobile browser bars.

## 6. Manga detail page

### 6.1 Desktop frame

**Hero (top):**
- Cover panel (primary cover; optional alternate cover selection only if multiple cover arts exist).
- Main title and alt-title line.
- Creator credits: Author and Artist, each clickable; combine role labels if same Creator has multiple roles.
- Meta row: publication status, demographic, year, original language, content rating.
- Primary actions: Read First/Continue; Add to Library/Change Reading Status; Report.
- Secondary action menu: share/copy link; add to reading list; external links if present.

**Main content sections:**
1. Synopsis (collapsible if long).
2. Tags grouped Genre / Theme / Format / Content / Other.
3. Rating summary + rating distribution if supported.
4. Key stats (exported chapter/page counts separate from official counts; never label official chapter count as available chapters).
5. Chapter list with language and sorting.
6. Comments.
7. Recommendations.
8. External tracker/read-buy links when available from contract.

Tabs or anchored navigation can be used for Chapters / Comments / Art / Recommendations. Only render “Art” if `manga_cover_arts` or any art content source actually supports it; cover art alone is not a general art gallery. Don't add a tab that is always empty.

### 6.2 Mobile detail

- Cover and title remain prominent but do not consume entire first screen.
- Actions become stacked/scrollable action row; Read/Continue remains first.
- Metadata chips wrap or group in expandable details.
- Chapters and comments use anchors/tabs that can be reached by sticky subnav without obscuring focused content.
- Avoid two-column metadata labels that become unreadable on narrow phone.

### 6.3 Detail frame event sequence

1. Enter `/manga/:slug`; resolve canonical manga ID.
2. Server checks `visibility_status=PUBLIC`; hidden or deleted must not leak metadata.
3. Load detail core (title/cover/creators/tags/summary/publication metadata).
4. Load chapters, ratings, comments, recommendation summaries independently.
5. If authenticated, load user reading status, reader progress, current rating and list membership separately.
6. Read action selection:
   - no progress → `Read First`;
   - valid progress → `Continue Reading` with chapter/page label;
   - no chapters → disabled state with explanation.
7. On `Add to Library`, show status menu; on `Add to List`, list picker modal.
8. Chapter row click re-validates manga visibility and chapter membership on server.
9. On tab/anchor change, URL reflects tab for share/back; page does not refetch core detail unnecessarily.

### 6.4 Edge states

- No cover: fallback art placeholder.
- No synopsis: “Chưa có mô tả” only if useful; don't create a giant blank card.
- No creator: omit section or show data unavailable; don't invent Unknown Artist profile.
- No chapters: show clear no-chapter notice and disabled Read First.
- Multiple languages: display preferred language, other language groups available.
- Hidden/deleted: 404/generic unavailable state; no sensitive reason for public user.
- External link not URL-valid: don't render clickable link.

## 7. Creator detail

Frame:
- Creator name, localized biography, external/social links.
- Role chips or filters Author / Artist / Both.
- Public works list/grid.
- Filter tags/status and sort latest/highest rating/views only where values exist.
- Combine duplicate manga cards if creator has both Author and Artist roles in `manga_creators`; preserve role labels.
- Empty state “Chưa có tác phẩm công khai” rather than error.

## 8. Updates / Feed

Recommended sections:
- Followed manga updates (if follow feature is actually part of user account model).
- Recent chapters from public mangas.
- Filters: language, date range, read/unread, manga title.
- Each row: cover mini, manga title, chapter number/title, language, group/source, publish time, read/progress marker.
- Group same manga's consecutive updates where that improves scanability; do not collapse distinct translations if user needs to choose.
- A click on comments must not accidentally navigate to reader; keep row and auxiliary actions separate (also aligns with MangaDex community backlog note).

## 9. Library / Reading Status

- Tabs or filter pills for `READING`, `PLAN_TO_READ`, `COMPLETED`, `ON_HOLD`, `DROPPED`; only show `RE_READING` if data model supports it in the app's domain (current DB status enum may not include; check source before enabling).
- Sort: last updated, title, rating, recently added; only where supported.
- Card/list density toggle.
- Per-title quick status action.
- Do not mix follow/notification subscription with status.
- Hide/Show controls must have confirmation or undo if destructive.

## 10. Reading Lists

### 10.1 Lists overview

- Header “Reading Lists” + Create List.
- Cards: list title, description snippet, item count, updated date, cover collage of first 3–4 items if available.
- Search/filter own lists.
- Owner-only private MVP; do not show public share toggles unless visibility schema and product decision exist.

### 10.2 List detail

- List title, description, item count, Edit list.
- Manga items with added date, reading status if available, progress if available.
- Search within list, filter by metadata, sort, bulk select (later P1/P2).
- Add manga action opens search modal with multi-select.
- Duplicate add: no-op/visible “already in list” state, counts unchanged.
- Clone/merge list flow: select source lists, deduplicate manga, preview resulting count, confirm; source lists untouched.

### 10.3 Empty / error states

- Empty list: explain how to add manga and show CTA.
- Hidden manga: follow canonical rule from main plan; do not silently redefine item_count. Distinguish total membership from currently visible items when necessary.
- Non-owner: return 404/not-found for private lists; don't reveal list name or owner.

## 11. Reading History

- Timeline/list newest first.
- Group by date; each entry: manga cover/title, chapter label/language, opened time, continue action, last known page progress if available.
- Filter by date/title; clear history is a destructive action and must use confirmation and retention policy.
- Clicking a history entry should reopen the chapter at saved progress if progress snapshot exists, otherwise open chapter from beginning.

## 12. Profile and Settings

Profile public section:
- Display name, avatar, bio, join date only if allowed, public reading stats only if privacy settings permit.
- Never expose email, DOB or activity log.

Settings:
- Profile/Avatar.
- Account/email/password.
- Privacy & visibility.
- Reader preferences (display mode, direction, fit, preload count).
- Theme, language, reduced-motion preference if user can override.
- Sessions/security if functionality exists.

## 13. Admin UX frame standards

Admin pages should use dense data table layouts, advanced filters, batch selection only where workflow supports, and explicit action confirmation.

### 13.1 Report queue
- Tabs: Account / Manga / Comment report.
- Status filters: pending/processing/resolved/ignored according to canonical report state mapping.
- Row: report type, target, reporter, created time, reason/category, status, action menu.
- Detail drawer/modal includes immutable target snapshot and report history.
- Quick actions: resolve, ignore, inspect target, lock account, hide manga, delete comment where permitted.
- If target deleted, show snapshot and mark target unavailable; do not lose case evidence.

### 13.2 ETL jobs
- Job list: status, type, requested by, source, created/started/finished time, success/fail counts.
- Detail: per-item outcomes, retry attempts, validation/checksum failure reason, trace/correlation ID.
- Actions: retry failed item/job if safe, inspect logs, cancel queued job if allowed.
- Destructive delete and sync actions require confirmation and show current `is_syncing` guard.

### 13.3 Admin account and manga tables
- Search by identity/title/slug/ID; state filter; paginated table.
- Detail side panel contains safe fields and audit trail.
- Dangerous action reason input required; show exact target before confirm.
- No user-provided raw HTML.

## 14. Cross-screen state consistency

- Manga hide/unhide invalidates catalogue, search, creator works, recommendations, public list view, and detail caches.
- New CDC chapter invalidates latest chapter snippets, chapter list, updates feed, search sort and Continue/Read First state if appropriate.
- Rating updates refresh manga detail score/distribution and recommendation signals.
- Reading status updates refresh Library and list item contextual badges.
- Progress updates refresh Continue Reading, History and manga detail Continue CTA.
- List add/remove refreshes item_count, list stats and Add to List state.
- Comment create/edit/delete/reaction updates only the appropriate comment count/thread and Admin report views.

