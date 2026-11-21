# Antigravity Prompt — UX/UI Audit, Benchmark Adaptation & Incremental Implementation

Copy the complete prompt below to Antigravity after the main Manga Reader project has been opened. Ensure the `manga-reader-agent-plan/ux-ui/` directory is present in the repository/workspace.

---

## PROMPT START

# ROLE

You are a Principal Product Designer, Senior UX Engineer, Design Systems Architect and Senior Frontend Engineer working on the existing Manga Reader Web Application.

You are NOT designing an unrelated new product and must NOT replace the current application with a competitor clone.

Your task is to audit the current application, compare it against the provided UX/UI benchmark, and incrementally improve its user experience and interface while preserving all existing business logic, data contracts, permissions, and product requirements.

# REQUIRED DOCUMENTS

You MUST read these documents completely before modifying the UI:

## Existing product and engineering plan

- `manga-reader-agent-plan/00_README_AGENT_ENTRYPOINT.md`
- `manga-reader-agent-plan/01_PRODUCT_SCOPE_AND_REQUIREMENTS.md`
- `manga-reader-agent-plan/02_SCREEN_FRAME_EVENT_FLOWS.md`
- `manga-reader-agent-plan/03_DOMAIN_RULES_AND_STATE_MACHINES.md`
- `manga-reader-agent-plan/04_DATABASE_SCHEMA_AND_MIGRATIONS.md`
- `manga-reader-agent-plan/05_PACKAGE_V2_ETL_CDC.md`
- `manga-reader-agent-plan/06_AUTH_SECURITY_MODERATION.md`
- `manga-reader-agent-plan/07_READER_ENGINE_PROGRESS_MEDIA.md`
- `manga-reader-agent-plan/08_CATALOG_SEARCH_RECOMMENDATIONS.md`
- `manga-reader-agent-plan/09_SOCIAL_RATINGS_COMMENTS_LISTS.md`
- `manga-reader-agent-plan/10_API_CONTRACTS_AND_EVENTS.md`
- `manga-reader-agent-plan/11_TEST_STRATEGY_ACCEPTANCE.md`
- `manga-reader-agent-plan/12_ADR_CONFLICTS_AND_RISKS.md`
- `manga-reader-agent-plan/13_IMPLEMENTATION_ROADMAP.md`
- `manga-reader-agent-plan/14_HANDOFF_MANIFEST.md`

## UX/UI benchmark and specifications

- `manga-reader-agent-plan/ux-ui/00_UX_UI_ENTRYPOINT.md`
- `manga-reader-agent-plan/ux-ui/01_COMPETITOR_BENCHMARK_AND_PATTERN_CATALOG.md`
- `manga-reader-agent-plan/ux-ui/02_VISUAL_DESIGN_SYSTEM_AND_COMPONENTS.md`
- `manga-reader-agent-plan/ux-ui/03_INFORMATION_ARCHITECTURE_AND_SCREEN_SPECS.md`
- `manga-reader-agent-plan/ux-ui/04_ADVANCED_SEARCH_UX_SPEC.md`
- `manga-reader-agent-plan/ux-ui/05_READER_MANGA_DETAIL_LIBRARY_UX.md`
- `manga-reader-agent-plan/ux-ui/06_RESPONSIVE_ACCESSIBILITY_AND_INTERACTION_QA.md`
- `manga-reader-agent-plan/ux-ui/08_SOURCE_REGISTER_AND_EVIDENCE.md`

Also read `07_ANTIGRAVITY_UX_EXECUTION_PROMPT.md` itself as execution protocol.

# NON-NEGOTIABLE CONSTRAINTS

1. The current application is the product being improved. Inspect and preserve it.
2. Do not rewrite architecture, backend, database, authentication or APIs simply to make a visual component easier.
3. Do not copy MangaDex, Comick, WEBTOON, Tapas or another brand pixel-for-pixel. Reuse functional patterns and implement the project's own design language.
4. Source requirements and domain rules override competitor conventions.
5. Do not fabricate missing metadata, chapter counts, rating values, creator identities, translation languages, schedules or recommendation scores.
6. Public reader surfaces must never expose `HIDDEN` mangas, including autocomplete, search, cached cards, recommendations or detail prefetch.
7. `unknown` content rating must never be silently treated as `safe`.
8. Do not confuse original language with chapter translation language.
9. Do not confuse official chapter counts with the exported chapter count.
10. Do not confuse reading status, follow/update subscription, custom list membership and reading progress.
11. Existing route URLs/deep links must remain compatible unless a migration/redirect is explicitly documented and tested.
12. If an interaction requires backend/data that does not exist, mark `DATA_GAP`, create a proposal and do not implement fake data.
13. Do not implement the entire redesign in one pass. Execute phases and verify each phase.
14. Do not claim visual or functional completion without running the application and inspecting real rendered states.

# PHASE 0 — CURRENT APPLICATION UX INVENTORY

Before coding:

1. Inspect the complete repository and current running app.
2. Identify frontend framework, routing, UI library, styling system, state/query system and testing setup.
3. Identify all current user-facing routes and Admin routes.
4. Map routes to current pages/components/API calls.
5. Run the application if possible.
6. Capture current screenshots at representative widths (mobile 390px, tablet 768px, desktop 1440px).
7. Exercise key flows: global search, advanced filters, manga detail, chapter list, reader, reading status, list, comments, rating and profile.
8. Identify issues in hierarchy, density, navigation, responsiveness, accessibility and state feedback.
9. Check whether existing components/tokens are reusable or should be refactored.

Create:

`docs/ux-ui/UX_AUDIT_BEFORE.md`

Include:
- Route inventory.
- Component inventory.
- Screenshots or screenshot paths.
- Existing design tokens/components.
- UX problems grouped by severity.
- Existing behaviors that must not regress.
- Data/API gaps.
- Recommended change sequence.

Do not start large UI refactoring until this inventory exists.

# PHASE 1 — DESIGN SYSTEM FOUNDATION

Follow `02_VISUAL_DESIGN_SYSTEM_AND_COMPONENTS.md`.

1. Create semantic design tokens in one central location.
2. Establish consistent typography, spacing, radius, surfaces, borders and state colors.
3. Support dark and light app themes if the current architecture allows it.
4. Keep reader background preference independent from app theme.
5. Establish component conventions for buttons, inputs, selects, chips, cards, dialogs, drawers, tabs, accordions, skeletons, empty states and errors.
6. Ensure tokens are used by actual components; avoid unused token catalogues.
7. Create a small UI style-guide/dev route or storybook only if appropriate for the current stack.
8. Verify contrast, focus and disabled/loading states.

Deliver:
- `docs/ux-ui/DESIGN_SYSTEM_IMPLEMENTATION.md`
- Updated components/tokens.
- Visual regression baseline for reusable components where feasible.

# PHASE 2 — GLOBAL SHELL AND NAVIGATION

Implement shell based on `03_INFORMATION_ARCHITECTURE_AND_SCREEN_SPECS.md`.

Requirements:
- Desktop navigation grouped by Discover / Personal / Community or Social / Admin as appropriate.
- Mobile navigation specifically designed for mobile use.
- Search access remains easy to find.
- Admin links hidden for non-Admin users, but backend authorization remains mandatory.
- Active navigation state is obvious.
- Avoid duplicate navigation or excessive sticky chrome.
- Preserve current deep links.

Test navigation at mobile, tablet and desktop widths.

# PHASE 3 — ADVANCED SEARCH FIRST-CLASS EXPERIENCE

This is the highest-priority UX feature.

Follow `04_ADVANCED_SEARCH_UX_SPEC.md` exactly and cross-check `08_CATALOG_SEARCH_RECOMMENDATIONS.md`.

Implement in this order:

1. Search title field over primary + alternative titles.
2. Filter panel with grouped tag taxonomy (Genre, Theme, Format, Content, Other).
3. Include / Exclude / Neutral states for tags.
4. Explicit any/all semantics; displayed semantics must match backend query semantics.
5. Content Rating, Demographic, Authors, Artists.
6. Original Language and Translated Chapter Language as separate controls.
7. Year range and Publication Status.
8. Exported Chapter Count range.
9. Minimum Rating.
10. Sort, view mode and active filter chips.
11. URL serialization and browser back/forward restoration.
12. Responsive mobile filter sheet with sticky Apply / Clear.
13. Empty, loading, error, retry and invalid filter states.

Use current DB mapping:
- `mangas.title`, `manga_alt_titles`.
- `tags`, `manga_tags` and `tag_group`.
- `mangas.content_rating`, `publication_demographic`, `publication_status`, `original_language`, `year`.
- `creators`, `manga_creators.role`.
- `chapters.language` or `manga_stats_languages`.
- `manga_stats.chapter_count`.
- `mangas.average_rating`, `total_views`, `created_at`, `updated_at`.
- `reading_status_records` and `list_items` for private personalized exclusion filters.

Critical:
- Current schema has no canonical `work_type` (Manga/Manhwa/Manhua) field.
- Current documented `manga_stats` has no `followed_count`.
- Do not show these as functional filters until data source and migration are approved.
- `manga_stats.chapter_count` is exported count, not official count.
- Do not treat `unknown` content rating as safe.

Create tests for the filter semantics and route serialization.

# PHASE 4 — SEARCH RESULTS AND CATALOGUE

Improve result card/list readability:
- Cover/title/status/content rating/genre tags/latest chapter/score as actual data permits.
- Grid/list view toggle where useful.
- Comfortable and compact density where implemented.
- Pagination/load more behavior consistent with backend.
- Stable sort tie-breakers and no visual card jumping.
- Image lazy loading and ratio placeholders.
- Result empty state supports loosening filters.

Avoid showing too much metadata in every card. Users should be able to scan the title quickly and open detail for full metadata.

# PHASE 5 — MANGA DETAIL AND CREATOR PAGE

Use `03_INFORMATION_ARCHITECTURE_AND_SCREEN_SPECS.md`:
- Strong top hero with cover/title/creators/actions.
- Author vs Artist separation.
- Tags grouped semantically.
- Publication metadata and content rating.
- Synopsis collapse/expand.
- Rating summary.
- Read First / Continue based on actual progress.
- Chapter list controls and language labels.
- Comments and recommendations sections/tabs.
- External links only if valid and present.

Do not show an Art gallery tab if the current data source only contains cover art.

Creator pages must combine the same manga when one Creator is both Author and Artist, while still showing role labels.

# PHASE 6 — READER UX

Follow `05_READER_MANGA_DETAIL_LIBRARY_UX.md` and existing reader plan.

Priorities:
1. Make reading canvas visually dominant.
2. Simplify toolbar to primary controls; advanced options go into Reader Settings.
3. Preserve mode, direction and fit preferences.
4. Preserve page position on mode/viewport changes.
5. Progressive page loading, retries per page and stable placeholders.
6. Reliable previous/next chapter behavior within selected language.
7. Reader progress uses stable page identity, not only scroll pixels.
8. Mobile touch/swipe interactions must not cause accidental chapter changes.
9. Ensure double-page pairing and first-page handling are deterministic.
10. Provide accessible keyboard controls and help.

Do not fake exact progress if `reader_progress` migration/API is not implemented. Mark progress gap and prioritize the domain migration according to the main plan.

# PHASE 7 — LIBRARY, LISTS, HISTORY AND SOCIAL SURFACES

Improve:
- Reading status library.
- Custom reading list overview/detail/add/remove/clone flows.
- Reading history and Continue action.
- Comments/spoiler/reply/reaction states.
- Rating form and history access rules.

Keep statuses and membership concepts separate. Respect private owner-only list policy. Confirm destructive actions and use server-authoritative ownership checks.

# PHASE 8 — HOME DISCOVERY AND RECOMMENDATIONS

Organize home into purposeful shelves:
- Continue Reading.
- Latest Updates.
- Recently Added.
- Popular or Highly Rated if aggregate data is reliable.
- Similar to this manga.
- Recommended for you only when personalized recommendation signal exists.

If a recommender is in cold start, use Popular/Recently Updated fallback and label accurately.
Do not fill the home with endless carousels. Each shelf needs a clear purpose and “View all”.

# PHASE 9 — RESPONSIVE AND ACCESSIBILITY AUDIT

Follow `06_RESPONSIVE_ACCESSIBILITY_AND_INTERACTION_QA.md`.

Test at:
- 360 × 800
- 390 × 844
- 430 × 932
- 768 × 1024
- 1024 × 768
- 1366 × 768
- 1440 × 900
- 1920 × 1080

Test:
- Keyboard navigation.
- Focus visible and not obscured.
- Autocomplete semantics.
- Tag include/exclude semantics.
- Drawer/modal focus management.
- Text contrast.
- Touch sizes.
- Reduced motion.
- Long titles/creator names.
- Empty/error/loading states.

# PHASE 10 — TESTING AND REPORT

For every phase:
- Run lint.
- Run type checks.
- Run relevant unit/component tests.
- Run integration/API tests where relevant.
- Run end-to-end tests for critical flows.
- Capture before/after screenshots at target viewports.
- Fix regressions before proceeding.

Create:
- `docs/ux-ui/UX_AUDIT_AFTER.md`
- `docs/ux-ui/UX_IMPLEMENTATION_REPORT.md`
- `docs/ux-ui/UX_ACCEPTANCE_MATRIX.md`

The final report must document:
1. What changed.
2. Which benchmark patterns were adopted and why.
3. Which patterns were rejected and why.
4. Which original requirements were preserved.
5. Routes/components affected.
6. API/data model changes (if any) with ADR/migration reference.
7. Responsive and accessibility test results.
8. Screenshot paths.
9. Known issues and data gaps.
10. Remaining work ordered by priority.

# EXECUTION PROTOCOL

- Work incrementally and autonomously.
- If repository already has coherent working patterns, adapt instead of replacing them.
- Ask no broad preference questions; make reversible decisions and document them.
- Do not claim done when visual polish has not been inspected in a real browser.
- If browser screenshot capability is available, use it. Otherwise provide exact manual verification steps and do not invent screenshots.
- Prioritize correctness and consistency over flashy animation.

Your overall outcome must be a coherent MangaDex-inspired but independently branded Manga Reader experience, with Advanced Search as a first-class feature and all interactions grounded in the existing Manga Reader domain model.

## PROMPT END

