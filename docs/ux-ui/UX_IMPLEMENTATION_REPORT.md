# UX/UI & Engineering Implementation Report (`QL-DocTruyen`)

> **Date:** 2026-11-21  
> **Scope:** Full-stack functional remediation + UX/UI upgrade + full SQL Server `QL_DocTruyen` (86,867 manga / 1.76M chapters) & zero-copy MinIO (`manga-media`) integration grounded in `docs/agent-plan/Setup/00..14`, `docs/agent-plan/Design/00..08`, and `D:\work\Android\coursework`

---

## 1. Summary of Changes by Layer

### 1.1 Backend (`apps/api/src/manga_reader/`)
- **`modules/catalog_discovery/__init__.py`:** Extended `CatalogSortOption` enum to include `TITLE_DESC`, `CREATED_DESC`, `YEAR_DESC`, `YEAR_ASC`, `CHAPTERS_DESC`, `RELEVANCE`.
- **`modules/catalog_discovery/application/service.py`:**
  - Fixed `BUG-01`: `list_catalog` now explicitly handles `GROUP_OR`, `ALL_AND` / `AND`, and `ANY_OR` / `OR` tag modes, rejecting unknown modes with `400 INVALID_FILTER`.
  - Fixed `BUG-03`: `search_creators` normalizes `role.strip().lower()` before validating against `("author", "artist")`.
  - Enriched `build_manga_cards` (batched, zero N+1) with `description` snippet, `exportedChapterCount` (`MangaStatsModel`), `chapterLanguages` (`MangaStatsLanguageModel` + `ChapterModel`), and deduplicated `creators` (`MangaCreatorModel` + `CreatorModel`).
  - Extracted shared `_score_title_match` helper used by both `list_catalog(q=...)` and `search_manga(q=...)`.
  - Added schema-backed Advanced Search predicates: `q`, multi-select `demographic` / `status` / `originalLanguage`, `chapterLanguage`, `author`, `artist`, `chaptersMin`/`chaptersMax`, `ratingMin` + `includeUnrated`, `viewsMin`, `addedDays`, `hideInStatus`, `hideInLists` (for authenticated `viewer`), and range validation (`yearFrom <= yearTo`, `chaptersMin <= chaptersMax`).
- **`modules/catalog_discovery/presentation/router.py`:** Exposed new Advanced Search query parameters on `GET /api/v1/manga` with optional `SecurityPrincipal = Depends(get_current_principal)`.
- **`modules/comments_reactions/application/service.py`:** Fixed `BUG-05` by accepting both `TOP` and `TOP_LIKED` in `list_comments`.
- **`infrastructure/storage.py` & `infrastructure/container.py`:** Implemented real async AWS SigV4 `S3CompatibleStorageAdapter` streaming directly from MinIO (`127.0.0.1:9010`, bucket `manga-media`) without copying image files to local disk, plus in-memory MinIO fallback for `LocalDevStorageAdapter` on `manga-media`.
- **`modules/reader_engine/presentation/router.py` & `application/service.py`:** Added in-memory lazy cover/avatar resolution (`covers/`, `avatars/` via MangaDex CDN / generated WebP without disk bloat under MinIO), lazy 1..N chapter page manifest creation for archival chapters, SQL Server trigger-aware valid view counting (`trg_reading_histories_count_valid_views`), and enriched `GET /api/v1/account/me/reading-status` via `CatalogDiscoveryService.build_manga_cards` and `ReaderProgressModel`.
- **`modules/catalog_discovery/application/service.py`, `recommendations/application/service.py` & `admin_analytics/application/service.py`:** Scaled all queries to 86,867 manga / 1.76M chapters (`ROW_NUMBER()` latest-chapter lookup, SQL `ilike` & count-threshold caps avoiding 2,100-param `IN` limits, `IX_mangas_visibility_updated` index ordering, direct `with_only_columns(func.count(MangaModel.manga_id))`, bounded 300-item TF-IDF candidate pool, and grouped admin stats/reconciliation).
- **`database/seeds/import_local_mangalibrary.py` & `.env`:** Reconciled local `QL_DocTruyen.mdf` schema (`M-001..M-011`, triggers preserved) and set-based synced 86,866 `MangaLibrary` titles (+1 `unknown` sample = 86,867), 1,762,156 chapters, 70,012 MinIO `media_objects`, 49,937 creators, 76 tags, 617 accounts, and full social/history/rating/comment/list/report datasets.

### 1.2 Frontend (`apps/web/src/`)
- **`styles/tokens.css` & `styles/index.css`:** Added semantic hover/focus/info tokens, `:focus-visible` outline, `scroll-padding-top`, and `prefers-reduced-motion`.
- **`services/apiTypes.ts` & `services/apiClient.ts`:** Added `ReadingLibraryEntry`, expanded `MangaCardItem`, added `listMyReadingStatuses()`, and expanded `listCatalog()` query parameters.
- **`components/MangaCard.tsx`:** Added `poster`, `compact`, and `horizontal` variants, broken-cover image fallback, `unknown` -> `"unclassified"` rating badge clarity, and `+N` tag overflow chip.
- **`components/AppHeader.tsx`:** Added `Ctrl+K` / `Cmd+K` search shortcut, grouped `MANGA` / `CREATOR` autocomplete suggestions, ARIA combobox + live region announcements, `/library` link, and responsive mobile nav bar.
- **`app/router.tsx`:** Registered `/search/advanced` alias for `ExplorePage` and authenticated `/library` route for `LibraryPage`.
- **`features/discovery/ExplorePage.tsx` & `HomePage.tsx`:** Fixed `BUG-02` (`DEMOGRAPHICS`), added `CatalogPagination` (numbered page buttons + `Go to page` direct jump across 86,867 titles / 3,620 pages on both `/` `24/page` and `/explore` `24/page`), title query bar, quick presets, grid/compact/list view toggle, removable active filter chips, author/artist creator autocomplete pickers, separate original vs chapter language filters, exported chapter & score/views/added-date filters, personal exclusion toggles, tag search input, per-group clear action, client-side range validation, `Continue Reading` shelf, `Recently Added` shelf, and transparent fallback labeling on `Recommended For You`.
- **`features/discovery/SearchPage.tsx`:** Fixed `BUG-03` lowercase `author`/`artist` role options, added manga search pagination, and added quick pivot link to `/explore`.
- **`features/manga/MangaDetailPage.tsx`:** Fixed `BUG-04` (removed unsupported `RE_READING`), added collapsible synopsis, `"Chưa có đánh giá"` empty rating state, clickable tag links to `/explore`, safe external links, chapter search & volume filter, and progress badge on active chapter row.
- **`features/reader/ChapterReaderPage.tsx`:** Added independent reader background presets (`black`/`dark`/`gray`/`light`), chapter quick-selector dropdown, `Focus (F)` toolbar-hide mode, double-page solo cover toggle, and webtoon page gap control.
- **`features/account/LibraryPage.tsx`:** Created dedicated Personal Reading Library screen with 5 canonical status tabs, search/sort/view toggles, inline status updates, and resume CTAs.
- **`features/account/HistoryPage.tsx` & `features/lists/ReadingListDetailPage.tsx`:** Added date grouping & title search in History; added 2-step delete confirmation, `readingStatus` filter, and visible-vs-stored count clarity in Reading List Detail.

---

## 2. Benchmark Patterns Adopted vs Intentionally Rejected

| Pattern | Benchmark Source | Decision | Rationale |
|---|---|---|---|
| Grouped tri-state Include/Exclude tags + explicit mode selector | MangaDex + Android Coursework (`TagSelectorDialog`) | **Adopted** | Matches canonical `tags.tag_group` (`genre`/`theme`/`format`/`content`/`other`) and prevents hidden API/UI semantic drift. |
| Min/Max exported chapters, min score, year range, hide in my library/lists | Comick | **Adopted** | Directly backed by `manga_stats.chapter_count`, `mangas.average_rating`, `mangas.year`, `reading_status_records`, and `list_items`. |
| Separate Original Language vs Translated Chapter Language + Creator pickers | MangaDex + MANGA Plus | **Adopted** | Directly backed by `mangas.original_language`, `chapters.language`, and `manga_creators.role`. |
| Continue Reading, Recently Added, Latest Updates shelves + Oldest/Newest toggle | WEBTOON + VIZ | **Adopted** | Uses real `reading_histories`/`reader_progress` and deterministic timestamps without fake curations. |
| Reader independent canvas themes, focus mode, chapter dropdown | MangaDex + MANGA Plus + Tapas | **Adopted** | Decouples reader backdrop from global theme and keeps canvas primary. |
| `Work Type` (Manga/Manhwa/Manhua) filter | Comick | **Rejected (`DATA_GAP`)** | `mangas` table has no canonical `work_type` column; cannot reliably infer from language/tags. |
| `Most Followed` sort/filter & `Next Update Schedule` | MangaDex / MANGA Plus | **Rejected (`DATA_GAP`)** | `manga_stats` has no `followed_count`; contract v2.0 has no upcoming release schedule field. |
| `RE_READING` status & public Reading List sharing | AniList / MangaDex | **Rejected** | Canonical DB enum excludes `RE_READING` and canonical MVP restricts lists to private owner-only (`ADR-009`). |

---

## 3. Preserved Domain & Security Invariants

1. Every public catalog, search, autocomplete, and detail query strictly enforces `visibility_status = 'PUBLIC'` and `deletion_status = 'ACTIVE'`.
2. Filtering by `contentRating=safe` strictly excludes `unknown`-rated manga.
3. `reader_progress` remains decoupled from append-only `reading_histories`.
4. Reading status, custom reading lists, and reading progress remain independent concepts.
5. `exportedChapterCount` (`manga_stats.chapter_count`) and `officialChapters` (`mangas.official_chapters`) remain distinctly labeled.

---

## 4. Automated Verification Results (`pnpm check:all` & Live MSSQL)

Executed after final edits:
- **Lint (`eslint` + `ruff check`):** Passed (0 warnings/errors).
- **Format (`prettier --check` + `ruff format --check`):** Passed (98 API files + all TS/TSX/CSS/JSON files formatted).
- **Typecheck (`tsc -b --noEmit` + `mypy src`):** Passed (0 issues across 83 Python source files + strict TypeScript).
- **Tests (`pnpm test` + `pytest -m live_mssql`):**
  - `@manga-reader/contracts` (Vitest): **7 passed (7)**
  - `@manga-reader/web` (Vitest + Testing Library): **14 passed (14)**
  - `@manga-reader/api` (Pytest unit + integration + E2E): **25 passed (25)**
  - `test_live_mssql_optional.py` (`QL_DocTruyen` SQL Server connectivity): **1 passed (1)**
- **Production Build (`pnpm build`):** Passed (`@manga-reader/contracts` + Vite bundle built cleanly).
