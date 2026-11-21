# UX/UI & Functional Codebase Audit — BEFORE (`QL-DocTruyen`)

> **Audit Date:** 2026-11-20  
> **Audited Source:** `exports/codebase-dump/` (`00_AI_AUDIT_INDEX.md` .. `09_ARCHITECTURE_AND_SCHEMA_DOCS.md`, 173 files, 29,480 lines) + live repository (`apps/api`, `apps/web`, `packages/contracts`, `database`)  
> **Reference Benchmarks:** `docs/agent-plan/Setup/00..14`, `docs/agent-plan/Design/00..08`, and `D:\work\Android\coursework` (`MyMangaReader` + `manga_backend`)

---

## 1. Executive Summary

The initialized `QL-DocTruyen` repository provides a **Production-Oriented Modular Monolith** with strong architectural boundaries:
- **Backend (`apps/api/`):** Python 3.13, FastAPI, Pydantic v2, SQLAlchemy 2.x Async, Alembic, Pillow, organized into 12 domain modules (`account_auth`, `manga_creator`, `catalog_discovery`, `etl_cdc`, `reader_engine`, `reading_status_history`, `ratings`, `comments_reactions`, `moderation_reporting`, `reading_lists`, `recommendations`, `admin_analytics`).
- **Database (`database/` + ORM):** 47 relational tables implementing Lab8/Lab9/Lab10 + ADR reconciliations `M-001..M-011`.
- **Contracts (`packages/contracts/`):** Pinned JSON Schema Draft 2020-12 (`manga-reader-package:2.0`) with Ajv validator & fixtures.
- **Frontend (`apps/web/`):** React 19, TypeScript strict, Vite, React Router v7, TanStack Query v5, Tailwind CSS v4 across 4 layout boundaries (`PublicLayout`, `ReaderShellLayout`, `AuthenticatedLayout`, `AdminLayout`).

However, deep code inspection revealed **5 concrete functional bugs** (frontend/backend contract mismatches that silently fail or throw HTTP 422 errors) and **high-impact UX/UI gaps** when evaluated against `docs/agent-plan/Design/00..08` and the Android coursework reference (`D:\work\Android\coursework`).

---

## 2. Functional Bugs Discovered (Critical / High Priority)

Every bug below is directly verified in the current codebase and must be fixed before/during UI upgrades.

| ID | Severity | Frontend Location | Backend Location | Root Cause & Impact | Required Fix |
|---|---|---|---|---|---|
| **BUG-01** | **High** | `apps/web/src/features/discovery/ExplorePage.tsx:389` | `apps/api/src/manga_reader/modules/catalog_discovery/application/service.py:266` | UI sends `tagMode="ALL_AND"` when user picks *"Match ALL Included Tags"*, but backend checks `if tag_mode.upper() == "AND":`. Any other value falls silently into `GROUP_OR`. | Update backend `list_catalog` to validate and handle `GROUP_OR`, `ALL_AND`/`AND`, and `ANY_OR`/`OR` explicitly. |
| **BUG-02** | **High** | `apps/web/src/features/discovery/ExplorePage.tsx:15` | `apps/api/src/manga_reader/modules/catalog_discovery/application/service.py:42` | Frontend `DEMOGRAPHICS` array contains `"none"`, while `MangaModel` check constraint and backend `VALID_DEMOGRAPHICS` define `{"shounen", "shoujo", "seinen", "josei", "kodomo", "unknown"}`. Selecting `"none"` causes HTTP `422 INVALID_FILTER`, and `"kodomo"` / `"unknown"` are missing. | Align frontend demographics to canonical `["shounen", "shoujo", "seinen", "josei", "kodomo", "unknown"]` and support multi-select demographic filtering on backend. |
| **BUG-03** | **High** | `apps/web/src/features/discovery/SearchPage.tsx:116-117` | `apps/api/src/manga_reader/modules/catalog_discovery/application/service.py:451` | `SearchPage.tsx` sends `role="AUTHOR"` / `role="ARTIST"`, while `CatalogDiscoveryService.search_creators` strictly compares `if role not in ("author", "artist"):` without case-folding, returning HTTP `422`. | Normalize `role.strip().lower()` in `search_creators` and use lowercase `"author"` / `"artist"` values in `SearchPage.tsx`. |
| **BUG-04** | **High** | `apps/web/src/features/manga/MangaDetailPage.tsx:19` | `apps/api/src/manga_reader/modules/reading_status_history/__init__.py:10-15` | `MangaDetailPage.tsx` exposes `{ value: "RE_READING", label: "Re-Reading" }`, which violates `ReadingStatus` enum and `reading_status_enum` DB constraint (`READING`, `PLAN_TO_READ`, `COMPLETED`, `ON_HOLD`, `DROPPED`). Selecting it returns HTTP `422`. Also explicitly prohibited by `05_READER_MANGA_DETAIL_LIBRARY_UX.md` §6. | Remove `RE_READING` from `READING_STATUSES` in `MangaDetailPage.tsx`. |
| **BUG-05** | **Medium** | `apps/web/src/features/manga/CommentsSection.tsx:532` | `apps/api/src/manga_reader/modules/comments_reactions/application/service.py:108` | `CommentsSection.tsx` sends `sort="TOP_LIKED"`, while `CommentService.list_comments` checks `if sort.upper() == "TOP":`. Selecting *"Most Liked"* silently falls back to newest sort. | Update `CommentService.list_comments` to accept `sort.upper() in ("TOP", "TOP_LIKED")`. |

---

## 3. Existing Routes & Component Inventory (Before)

### 3.1 Routes Inventory
| Route | Component | Layout Boundary | Status Before |
|---|---|---|---|
| `/` | `HomePage` | `PublicLayout` | Basic Hero + Latest Updated + Top Rated + Recommended For You. Missing **Continue Reading** and **Recently Added** shelves; no explicit fallback labeling clarity. |
| `/explore` | `ExplorePage` | `PublicLayout` | Basic collapsible drawer (`demographic`, `status`, `language`, `yearFrom`, `yearTo`, `contentRating`, tri-state `tags`). Missing `/search/advanced` alias, title query (`q`), Author/Artist filter, translated chapter language filter, min/max exported chapter count, min rating, min views, added date window, hide-already-in-library toggles, active filter chips, grid/list view toggle, and tag search box. |
| `/search` | `SearchPage` | `PublicLayout` | Title search + Creator search (`BUG-03` on role filter). Missing pagination UI and quick pivot to Advanced Search. |
| `/manga/:slug` | `MangaDetailPage` | `PublicLayout` | Good core layout, but has `BUG-04` (`RE_READING`), shows `★ 0.00` when `ratingCount === 0`, tags are not clickable links to explore, synopsis lacks collapse/expand for long text, external links are not rendered, chapter list lacks chapter search/volume filter and progress badge. |
| `/author/:creatorId/:slug` | `AuthorDetailPage` | `PublicLayout` | Functional bio + localized bio selector + deduplicated works with combined `creatorRoles`. |
| `/profile/:username` | `ProfilePage` | `PublicLayout` | Functional public profile + conditional DOB privacy + Report Account button. |
| `/login`, `/register` | `LoginPage`, `RegisterPage` | `PublicLayout` | Complete auth + OTP + Dev OTP preview + demo autofill. |
| `/manga/:slug/read`, `/manga/:slug/chapter/:chapterId` | `ChapterReaderPage` | `ReaderShellLayout` | Supports `VERTICAL_WEBTOON`, `SINGLE_PAGE`, `DOUBLE_PAGE` (`LTR`/`RTL`), fit modes, preload, exact page preservation, page retry. Missing independent reader background presets (`Black`/`Dark`/`Gray`/`Light`), chapter quick-selector dropdown in top bar, focus mode (`F` key / hide UI), and double-page solo cover toggle. |
| `/history` | `ReadingHistoryPage` | `AuthenticatedLayout` | Flat chronological list; lacks date grouping (`Today`, `Yesterday`, `Earlier`) and search filter. |
| `/library` | *(Missing)* | *(Missing)* | Backend endpoint `GET /api/v1/account/me/reading-status` exists, but no `/library` route or UI screen exists (`03_INFORMATION_ARCHITECTURE_AND_SCREEN_SPECS.md` §9). |
| `/reading-lists` | `ReadingListsPage` | `AuthenticatedLayout` | Functional list overview, create, clone/merge with empty-source confirmation. |
| `/reading-lists/:listId` | `ReadingListDetailPage` | `AuthenticatedLayout` | Functional items filter + dynamic metadata stats. Missing delete confirmation dialog, `readingStatus` filter dropdown, and visible-vs-total count distinction. |
| `/settings` | `AccountSettingsPage` | `AuthenticatedLayout` | Functional 5 tabs: Profile & Avatar, Security, Reader Preferences, Rating History, My Reading Stats. |
| `/admin`, `/admin/accounts`, `/admin/manga`, `/admin/reports`, `/admin/etl` | `AdminPages` | `AdminLayout` | Functional admin dashboard, account lock/unlock & logs, manga hide/show/delete, moderation report queue, and on-hold ETL console. |

### 3.2 Reusable Components & Design Tokens Inventory
- `apps/web/src/styles/tokens.css`: Defines dark-first and light theme tokens (`--mr-bg-canvas`, `--mr-bg-surface`, `--mr-bg-elevated`, `--mr-bg-reader`, `--mr-text-*`, `--mr-border-*`, `--mr-accent*`, `--mr-danger`, `--mr-warning`, `--mr-success`). Missing semantic `--mr-bg-hover`, `--mr-focus`, `--mr-info`, and global `:focus-visible` / `prefers-reduced-motion` rules in `index.css`.
- `apps/web/src/components/AppHeader.tsx`: Desktop nav hidden on mobile (`hidden md:flex`) with **no mobile navigation menu or bottom nav**, making `/explore`, `/history`, `/reading-lists`, and `/settings` unreachable from header on mobile (`<768px`). Missing `Ctrl+K` shortcut and aria-live announcements.
- `apps/web/src/components/MangaCard.tsx`: Single poster card layout only (`aspect-[3/4]`). Does not handle image load errors cleanly, lacks `+N` overflow chip indicator, and lacks `compact` / `horizontal` list variants.

---

## 4. UX/UI Gaps vs Benchmark & Implementation Playbook

### 4.1 Priority 0 — First-Class Advanced Search (`04_ADVANCED_SEARCH_UX_SPEC.md` + `D:\work\Android\coursework`)
Compare `ExplorePage.tsx` against `04_ADVANCED_SEARCH_UX_SPEC.md` and `SearchFragment.java` + `TagSelectorDialog.java`:
1. **Missing Metadata Filters (backed by real DB tables)**:
   - Title / Alternative Title (`q` over `mangas.title` + `manga_alt_titles`)
   - Separate **Original Language** (`mangas.original_language`) vs **Translated Chapter Language** (`chapters.language`)
   - Separate **Author** and **Artist** creator pickers (`creators` + `manga_creators.role`)
   - **Exported Chapter Count** min/max (`manga_stats.chapter_count` — explicitly distinguished from `official_chapters`)
   - **Minimum Score** (`mangas.average_rating`)
   - **Minimum Views** (`mangas.total_views`) & **Added to Catalog Window** (`mangas.created_at`)
   - **Hide Already in My Library / Lists** (`reading_status_records`, `list_items` for authenticated users)
2. **Missing Tag Picker Ergonomics**:
   - Search input inside tags (`76` tags in local DB is hard to scan without live filtering)
   - Selected count badge per tag group + `Clear group` button
   - Explicit accessible state text (`Include: Action`, `Exclude: Harem`) rather than relying only on color
3. **Missing Result Toolbar & Chips**:
   - Removable **Active Filter Chips** bar above results
   - **View Mode Toggle** (`Comfortable Grid`, `Compact Grid`, `Horizontal List`)
   - Additional Sort options (`TITLE_DESC`, `CREATED_DESC`, `YEAR_DESC`, `YEAR_ASC`, `CHAPTERS_DESC`, `RELEVANCE`)
   - URL deep-link sync on `/explore` and alias `/search/advanced`
4. **DATA GAPS Strictly Excluded (Do NOT Implement Fake Filters)**:
   - `Work Type (Manga / Manhwa / Manhua)`: `mangas` schema has no canonical `work_type` column (`04_ADVANCED_SEARCH_UX_SPEC.md` §3.14).
   - `Most Followed`: `manga_stats` schema has no `followed_count` column (`04_ADVANCED_SEARCH_UX_SPEC.md` §4).

### 4.2 Priority 1 — Navigation, Library, Detail, Reader & Home
1. **Navigation (`AppHeader.tsx`)**: Add responsive mobile navigation bar (`<768px`), add `Library` (`/library`) link, add `Ctrl+K` / `Cmd+K` search focus shortcut, group autocomplete suggestions.
2. **Personal Reading Library (`LibraryPage.tsx` at `/library`)**: Expose `GET /api/v1/account/me/reading-status` enriched with card metadata and reading progress across 5 canonical tabs (`READING`, `PLAN_TO_READ`, `COMPLETED`, `ON_HOLD`, `DROPPED`).
3. **Manga Detail (`MangaDetailPage.tsx`)**: Fix `BUG-04`, clickable tag links, collapsible long synopsis, `"No ratings yet"` when unrated, valid external links rendering, chapter search & volume filter, current progress highlight on chapter row.
4. **Reader (`ChapterReaderPage.tsx`)**: Independent reader canvas background (`Black`, `Dark`, `Gray`, `Light`), quick chapter selector dropdown, focus mode (`F` key / hide toolbar), solo cover page offset toggle for double-page spread.
5. **Home & History (`HomePage.tsx`, `HistoryPage.tsx`, `ReadingListDetailPage.tsx`)**: Add `Continue Reading` and `Recently Added` shelves on Home; date group badges & title search on History; delete confirmation & `readingStatus` filter on Reading List Detail.

---

## 5. Step-by-Step Execution Sequence for AI Agents

1. **Phase 1 — Backend Fixes & Query Expansion**:
   - Fix `BUG-01`, `BUG-03`, `BUG-05`.
   - Expand `CatalogDiscoveryService.list_catalog` & `build_manga_cards` and `/api/v1/manga` router query parameters while preserving all `PUBLIC` / `ACTIVE` / `safe != unknown` invariants.
   - Enrich `ReaderService.list_my_reading_statuses` for `/library`.
2. **Phase 2 — Design System & Core Components**:
   - Upgrade `tokens.css`, `index.css`, `MangaCard.tsx`, `AppHeader.tsx`.
3. **Phase 3 — First-Class Advanced Search**:
   - Fix `BUG-02` and upgrade `ExplorePage.tsx` + register `/search/advanced` alias in `router.tsx`; fix `BUG-03` in `SearchPage.tsx`.
4. **Phase 4 — Detail, Reader, Home, Library & Lists**:
   - Fix `BUG-04` and upgrade `MangaDetailPage.tsx`, `ChapterReaderPage.tsx`, `HomePage.tsx`, `LibraryPage.tsx`, `HistoryPage.tsx`, `ReadingListDetailPage.tsx`.
5. **Phase 5 — Tests, Quality Gate & Reports**:
   - Expand Pytest (`apps/api/tests/`) and Vitest (`apps/web/tests/App.test.tsx`).
   - Run `pnpm format:write && pnpm check:all`.
   - Run `pnpm dump:context` and author post-implementation reports (`UX_AUDIT_AFTER.md`, `UX_IMPLEMENTATION_REPORT.md`, `UX_ACCEPTANCE_MATRIX.md`).
