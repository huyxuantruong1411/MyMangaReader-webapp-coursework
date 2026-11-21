# UX/UI & Functional Acceptance Matrix (`QL-DocTruyen`)

> **Reference Criteria:** `docs/agent-plan/Design/04_ADVANCED_SEARCH_UX_SPEC.md` §11 & `05_READER_MANGA_DETAIL_LIBRARY_UX.md` §10  
> **Verification Date:** 2026-11-20

---

## 1. Advanced Search Acceptance Criteria (`04_ADVANCED_SEARCH_UX_SPEC.md` §11)

| # | Criterion | Status | Verification Coverage |
|---|---|---|---|
| 1 | Search by primary title and alternative title (case & accent insensitive) | **Pass** | `test_advanced_search_and_bug_fixes` (`q=Bien+Nien+Su+Lam+Kiem`) + `ExplorePage.tsx` `q` param |
| 2 | Include and exclude tags with clear state (text/icon + color) | **Pass** | `ExplorePage.tsx` tri-state tags + `App.test.tsx` tag cycling assertion |
| 3 | Tag cannot remain included and excluded simultaneously | **Pass** | `ExplorePage.tsx` `cycleTag` atomic transition + backend `INVALID_FILTER` guard |
| 4 | Displayed Include any/all semantics match backend query semantics | **Pass** | `BUG-01` fixed; tested in `test_advanced_search_and_bug_fixes` (`GROUP_OR` vs `ALL_AND`) |
| 5 | Multiple tag groups combine according to canonical rule | **Pass** | `CatalogDiscoveryService.list_catalog` `GROUP_OR` group subquery intersection |
| 6 | Filter content rating, demographic, original language, status, year range | **Pass** | `BUG-02` fixed; `test_advanced_search_and_bug_fixes` + `ExplorePage.tsx` |
| 7 | Separately filter translated chapter language (`chapters.language`) | **Pass** | `test_advanced_search_and_bug_fixes` (`chapterLanguage=vi`) + `ExplorePage.tsx` |
| 8 | Search and select Author and Artist without merging homonymous creators | **Pass** | `CreatorPickerField` + `author` / `artist` role-scoped filters tested in `test_advanced_search_and_bug_fixes` |
| 9 | Year range and exported chapter-count range validate min <= max | **Pass** | Client inline validation in `ExplorePage.tsx` + backend `400 INVALID_FILTER` tested in Pytest |
| 10 | Minimum rating excludes unrated entries unless explicitly included | **Pass** | `ratingMin` + `includeUnrated` in `CatalogDiscoveryService.list_catalog` and `ExplorePage.tsx` |
| 11 | `unknown` content rating never appears in `safe`-only results | **Pass** | Verified in `test_e2e_1_3_4_5_full_platform_lifecycle` (`safe` excludes `unknown`) |
| 12 | `HIDDEN` manga never appears in search or public surfaces | **Pass** | Enforced in all `CatalogDiscoveryService` queries + verified in `test_e2e_1_3_4_5_full_platform_lifecycle` |
| 13 | Applying a filter resets page to 1 | **Pass** | `ExplorePage.tsx` `applyFilters`, `handleTitleSearch`, `setSort`, and chip removal all set `page=1` |
| 14 | URL refresh / back / forward restores applied filters | **Pass** | All filter state derived from `useSearchParams()` + `/search/advanced` route alias |
| 15 | Filter panel action controls remain accessible via sticky footer | **Pass** | Sticky footer (`Reset All` / `Apply Filters`) in `ExplorePage.tsx` |
| 16 | Empty results preserve filters and provide recoverable actions | **Pass** | Active filter chips remain visible above `EmptyState` with `Clear All Conditions` CTA |
| 17 | Unsupported `work_type` / `followed_count` filters are NOT shown | **Pass** | Explicitly omitted and marked `DATA_GAP` in `UX_IMPLEMENTATION_REPORT.md` |
| 18 | `chapter_count` (exported) and `official_chapters` labeled distinctly | **Pass** | `ExplorePage.tsx` (`Exported Ch. Min/Max`), `MangaDetailPage.tsx` (`Official Chapters` vs `Exported Chapters`) |

---

## 2. Reader, Detail & Library Acceptance Criteria (`05_READER_MANGA_DETAIL_LIBRARY_UX.md` §10)

| # | Criterion | Status | Verification Coverage |
|---|---|---|---|
| 1 | Reader loads first page without waiting for all chapter images | **Pass** | `ChapterReaderPage.tsx` progressive `PageImage` rendering + lazy loading |
| 2 | One failed page does not freeze chapter; independent per-page retry | **Pass** | `PageImage` local `failed` & `Retry Image` state |
| 3 | Vertical mode scrolls in page order and tracks stable page identity | **Pass** | `IntersectionObserver` tracking `data-page-number` + `pageUid` progress saves |
| 4 | Single-page mode supports prev/next respecting LTR/RTL | **Pass** | `ChapterReaderPage.tsx` `ArrowLeft`/`ArrowRight` + `App.test.tsx` |
| 5 | Double-page mode handles pairing deterministically (with optional solo cover) | **Pass** | `visibleSpreadPages` pairing logic in `ChapterReaderPage.tsx` |
| 6 | Mode switch preserves exact active page identity | **Pass** | Verified by `App.test.tsx` (`preserves exact active page when switching Reader display modes`) |
| 7 | Settings persist and sync cleanly; independent reader background preset | **Pass** | `localStorage` + `PUT /api/v1/reader/settings` + independent `mr_reader_bg_theme` |
| 8 | Chapter language is explicit and chapter quick-selector respects language | **Pass** | `ChapterReaderPage.tsx` chapter dropdown queries `language: payload.chapter.language` |
| 9 | Continue action opens exact saved page if progress exists | **Pass** | Verified in `test_e2e_1_3_4_5_full_platform_lifecycle` (`initialPage == 3`) |
| 10 | Reading Status, Custom Lists, and Reading Progress remain separate | **Pass** | Dedicated `/library` (`LibraryPage.tsx`), `/reading-lists` (`ReadingListsPage.tsx`), `/history` (`HistoryPage.tsx`) |
| 11 | Unsupported `RE_READING` status not exposed | **Pass** | `BUG-04` fixed; verified in `App.test.tsx` (`LibraryPage` and `MangaDetailPage`) |
| 12 | Rating eligibility explained; server enforces `RATING_REQUIRES_READING` | **Pass** | Verified in `test_e2e_1_3_4_5_full_platform_lifecycle` + `MangaDetailPage.tsx` |
| 13 | Comment spoiler hidden by default & edit history/deleted placeholder preserved | **Pass** | Verified in `test_e2e_1_3_4_5_full_platform_lifecycle` (`[Bình luận đã bị xóa]`) + `BUG-05` `TOP_LIKED` test |
| 14 | Private lists return 404 to non-owners & empty stats show Vietnamese message | **Pass** | Verified in `test_e2e_1_3_4_5_full_platform_lifecycle` + `App.test.tsx` |
