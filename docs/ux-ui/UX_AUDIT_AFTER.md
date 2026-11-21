# UX/UI & Functional Codebase Audit — AFTER (`QL-DocTruyen`)

> **Completion Date:** 2026-11-21  
> **Quality Gate Status:** `pnpm check:all` PASSED (`eslint`, `ruff check`, `prettier`, `ruff format`, `tsc`, `mypy`, 7 contract tests, 14 web Vitest tests, 25 API Pytest tests, production Vite build) + `pytest -m live_mssql` PASSED (`1/1`)

---

## 1. Functional Bugs Resolved (All 5 Confirmed Fixed)

| Bug ID | Summary | Verification Evidence |
|---|---|---|
| **BUG-01** | `CatalogDiscoveryService.list_catalog` now validates and handles `GROUP_OR`, `ALL_AND` / `AND`, and `ANY_OR` / `OR` matching modes. | Covered by `test_advanced_search_and_bug_fixes` in `apps/api/tests/integration/test_full_e2e_acceptance.py` (`ALL_AND` returns `chronicles-of-the-azure-blade` only; `GROUP_OR` returns both `chronicles-of-the-azure-blade` and `starlight-atelier`). |
| **BUG-02** | `ExplorePage.tsx` uses canonical `["shounen", "shoujo", "seinen", "josei", "kodomo", "unknown"]` demographics (multi-select) instead of invalid `"none"`. | Covered by `test_advanced_search_and_bug_fixes` (`demographic=shounen,shoujo,kodomo` HTTP 200). |
| **BUG-03** | `CatalogDiscoveryService.search_creators` normalizes `role.strip().lower()`, and `SearchPage.tsx` uses `"author"` / `"artist"` option values. | Covered by `test_advanced_search_and_bug_fixes` (`role=AUTHOR` HTTP 200) and `App.test.tsx` (`SearchPage` option value assertions). |
| **BUG-04** | Removed unsupported `RE_READING` reading status from `MangaDetailPage.tsx` so UI strictly enforces the canonical 5-value enum (`READING`, `PLAN_TO_READ`, `COMPLETED`, `ON_HOLD`, `DROPPED`). | Covered by `App.test.tsx` (`renders manga detail without unsupported RE_READING status and with clickable tags`). |
| **BUG-05** | `CommentService.list_comments` accepts both `TOP` and `TOP_LIKED` when sorting by `like_count.desc()`. | Covered by `test_advanced_search_and_bug_fixes` (`sort=TOP_LIKED` puts liked comment first). |

---

## 2. Upgraded Screens & Architecture (After)

### 2.1 Global Shell & Navigation (`AppHeader.tsx`, `tokens.css`, `index.css`)
- Added responsive mobile navigation bar (`md:hidden`) directly below the compact header bar with links to `Explore`, `Search`, `Library`, `My Lists`, `History`, `Settings`, and conditional `Admin`.
- Added `Ctrl+K` / `Cmd+K` global shortcut to focus header search input, clear (`✕`) button, grouped `Manga Titles` vs `Authors & Artists` autocomplete dropdown, `aria-activedescendant`, and `aria-live="polite"` suggestion count announcement.
- Added semantic CSS tokens `--mr-bg-hover`, `--mr-focus`, `--mr-info`, `--mr-max-width: 1320px`, `:focus-visible` keyboard focus outlines, `scroll-padding-top: 4.5rem`, and `@media (prefers-reduced-motion: reduce)` handling.

### 2.2 First-Class Advanced Search (`ExplorePage.tsx` at `/explore` and `/search/advanced`)
- **Title & Alt-Title Search:** Dedicated query form (`q`) with quick discovery presets (`Top Rated (8.0+)`, `Completed Series`, `Safe Only`, `Has Vietnamese Chapters`, `Has English Chapters`).
- **View Modes:** `Grid` (`poster`), `Compact` (`compact`), and `List` (`horizontal` showing cover, creators, synopsis snippet, exported chapter count, available languages, and tags) persisted in `localStorage`.
- **Removable Active Filter Chips:** Every applied filter renders as a single-click removable chip above the results grid.
- **Full Schema-Backed Filter Panel:**
  - Separate `Author` and `Artist` inputs with live creator autocomplete (`apiClient.searchCreators`).
  - `Year From` / `Year To` with client & server validation (`yearFrom <= yearTo`).
  - `Exported Ch. Min` / `Exported Ch. Max` (`manga_stats.chapter_count`, explicitly separated from `official_chapters`) with client & server validation (`chaptersMin <= chaptersMax`).
  - `Minimum Score` (`ratingMin`) + `"Also include unrated titles"` toggle (`includeUnrated`), `Minimum Valid Views` (`viewsMin`), and `Added to Catalog` window (`addedDays`).
  - Multi-select `Content Rating` (`safe` strictly excludes `unknown`; `unknown` labeled `"unknown (not classified)"`), `Publication Demographic`, and `Publication Status`.
  - Strictly separated `Original Language` (`mangas.original_language`) vs `Has Translated Chapters In` (`chapters.language`).
  - Authenticated-only `My Reading Data` exclusions: `Hide titles in my Reading Status Library` (`hideInStatus`) and `Hide titles already in any Custom Reading List` (`hideInLists`).
  - Live-searchable tri-state tag selector (`Neutral` → `+ Include` → `− Exclude` → `Neutral`) with per-group selected counts, `Clear <group>`, and explicit `Tag matching mode` (`GROUP_OR`, `ALL_AND`, `ANY_OR`).

### 2.3 Personal Reading Library (`/library` — `LibraryPage.tsx`)
- Dedicated authenticated library route decoupled from custom Reading Lists (`05_READER_MANGA_DETAIL_LIBRARY_UX.md` §6 & §8.1).
- Backed by enriched `GET /api/v1/account/me/reading-status` returning full card metadata, reading status, and exact saved `ReaderProgressModel` resume checkpoint.
- Provides 5 canonical status tabs + `All` with live counts, title search, sort (`Recently Updated`, `Title A–Z`, `Highest Rated`), Grid/List view toggle, inline status dropdown, and direct `Continue` chapter/page CTA.

### 2.4 Home, Manga Detail, Reader, History & Lists
- **HomePage & Full-Catalog Pagination (`HomePage.tsx`, `ExplorePage.tsx`):** Added `Continue Reading` shelf, `Recently Added` (`CREATED_DESC`) shelf, transparent fallback description on `Recommended For You`, total catalog counter badge (`86,867 titles · 3,620 pages`), and shared `CatalogPagination` bar (`← Previous`, windowed page numbers `1 ... p ... 3,620`, `Next →`, and direct `Go to page` jump input) on both Home (`24` titles/page) and `/explore` (`24` titles/page).
- **Full SQL Server `QL_DocTruyen` + Zero-Copy MinIO (`import_local_mangalibrary.py`, `storage.py`, `router.py`):** Synced all 86,866 `MangaLibrary` titles (+1 `unknown` sample = 86,867), 1,762,156 chapters, 70,012 MinIO `manga-media` addresses (zero disk copying), 49,937 creators, 76 tags, 617 accounts, and full social/history/rating/comment/list/report tables, with SQL Server query/index optimizations in `CatalogDiscoveryService`, `RecommendationService`, and `AdminAnalyticsService`.
- **MangaDetailPage:** Prioritized `Continue Reading (Page X)` CTA when progress exists, added collapsible synopsis toggle for descriptions >280 chars, displayed `"Chưa có đánh giá"` / `"No ratings"` when `ratingCount === 0`, made tags clickable links to `/explore?includeTags=...`, safely rendered `http(s)` external links, and added chapter search + volume filter + progress badge on chapter rows.
- **ChapterReaderPage:** Added independent Reader Canvas Background presets (`Pure Black`, `Dark Slate`, `Soft Gray`, `Paper Light`), top-bar Chapter Quick-Selector dropdown, `Focus (F)` toolbar-hide mode with floating restore trigger, `Solo cover in double-page` pairing toggle, and `Webtoon Page Gap` control.
- **HistoryPage & ReadingListDetailPage:** Added date-bucket grouping (`Today`, `Yesterday`, `This Week`, date) and title filter to History; added 2-step delete confirmation, `readingStatus` filter, and visible-vs-stored count clarity to Reading List Detail.

---

## 3. Live Browser Verification Status & Manual QA Checklist

- **Observed Before IDE Restart (`1440×900` Desktop on `http://127.0.0.1:5173/`):** Home rendered cleanly against `QL_DocTruyen` + MinIO `manga-media` with 24/24 images loaded (`brokenImgCount: 0`), `scrollWidth: 1425 <= 1440` (no horizontal overflow), `headerHeight: 57`, and HTTP 200 responses. Observed >2s cold query latency on `UPDATED_DESC`/`CREATED_DESC`, subsequently optimized in `CatalogDiscoveryService.list_catalog` (`IX_mangas_visibility_updated` ordering + direct `with_only_columns(func.count(MangaModel.manga_id))`).
- **Remaining Interactive Live Checks (Blocked by `chrome_devtools` MCP disconnection after IDE server restart):** Visually inspect the restarted app (`pnpm dev:api` and `pnpm dev:web`) at desktop (`1440×900`), tablet (`768×1024`), and mobile (`390×844` & `360×800`) viewports across:
  1. Home (`/`) Hero badge (`86,867 titles · 3,620 pages`), page switching & direct `Go to page` jump under `Latest Updated`, plus Header `Ctrl+K` autocomplete & mobile navigation bar scrolling.
  2. `/explore` and `/search/advanced` filter panel, tri-state tags, active filter chips, `Grid` / `Compact` / `List` switching, and `3,620`-page pagination bar.
  3. `/library` status tabs and inline status updates.
  4. `/manga/:slug` chapter filters, tag links, and synopsis expand/collapse.
  5. `/manga/:slug/chapter/:chapterId` focus mode (`F`), reader background presets, and double-page solo cover pairing.
