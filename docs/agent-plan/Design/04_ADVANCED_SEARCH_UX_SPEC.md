# Advanced Search UX Specification

> Đây là đặc tả trọng tâm để xây dựng trang Advanced Search của Manga Reader. Mục tiêu là lấy cấu trúc mạnh của MangaDex, bổ sung các facet hữu ích từ Comick, nhưng chỉ expose bộ lọc mà hệ thống có dữ liệu và semantics rõ ràng.

## 1. Product objective

Người đọc phải có thể tìm một bộ truyện không nhớ chính xác tên bằng cách kết hợp metadata họ còn nhớ:

- Có tag/genre/theme nào;
- Tránh tag/content nào;
- Thuộc demographic nào;
- Trạng thái xuất bản;
- Ngôn ngữ gốc;
- Có chapter dịch ở ngôn ngữ nào;
- Author/Artist;
- Năm xuất bản;
- Có bao nhiêu chapter đã được import;
- Điểm đánh giá tối thiểu;
- Sắp xếp theo update, rating, views hoặc title.

Advanced Search phải phục vụ cả người tìm nhanh và người biết chính xác metadata.

## 2. Screen architecture

### 2.1 Desktop layout

- Page title: `Advanced Search` / `Tìm truyện nâng cao`.
- Search title field ở trên cùng, hỗ trợ primary title và alternative titles.
- Filter rail 300–340px bên trái; có thể collapse.
- Main results panel bên phải.
- Top result toolbar: result count, sort, view mode, active filters summary.
- Active filter chips nằm trên result grid, không chỉ ở trong sidebar.
- Bottom pagination hoặc infinite “Load more”; chọn một UX thống nhất với API và history support.

### 2.2 Mobile layout

- Search input hiển thị full width.
- Nút `Bộ lọc` với số lượng active filters.
- Result toolbar gọn: sort + grid/list.
- Filter sheet mở gần full-height, section accordion; search trong tag/creator list; footer sticky `Xóa tất cả` và `Hiển thị N kết quả`.
- Không auto-apply mỗi lần chọn một tag trên mobile; dùng draft state và explicit Apply để tránh gọi API liên tục.
- Khi sheet mở: lock body scroll, giữ focus trong sheet, Escape/close đưa focus về nút Filter.

## 3. Filter taxonomy and mapping

### 3.1 Title query

**UI:** text input `Tên truyện hoặc tên khác`.

**Data:** `mangas.title` + `manga_alt_titles.alternative_title`.

**Behavior:**
- Case-insensitive, accent-insensitive.
- Match exact/prefix before fuzzy.
- Debounce suggestions only in global autocomplete; on Advanced Search, submit when Enter/Search/Apply.
- Empty string does not constrain results.
- Query remains visible after filtering and pagination.

### 3.2 Tags (Genre / Theme / Format / Content / Other)

**UI group:**
- Genre
- Theme
- Format
- Content
- Other (collapse by default unless values present)

Each tag has three states:
1. Neutral — not applied.
2. Include — manga must satisfy selected inclusion logic.
3. Exclude — manga with this tag is removed.

Suggested interaction:
- Click Neutral → Include.
- Click Include → Exclude.
- Click Exclude → Neutral.
- State must be readable in accessible text (e.g. “Include: Romance”, “Exclude: Harem”), icon and border; not color only.
- For users who prefer explicit buttons, open a context menu / tag row controls with Include, Exclude, Clear.
- Search within tags; display selected count per group.
- “Clear group” removes include and exclude state for that group.

**Data:** `tags.tag_group`, `tags.slug`, `tags.name`, `manga_tags`.

**Semantics — must be consistent with current canonical project plan:**
- Included tags within the same group use OR by default (`match_any`): manga has at least one included tag in that group.
- A group may expose `Match any` / `Match all`. `Match all` means all included tags in that group must exist on the manga.
- Different groups combine using AND. Example: (Genre has Action OR Romance) AND (Theme has Revenge) AND (Format has Full Color).
- Excluded tags combine using NOT ANY. If a manga has any excluded tag, it is excluded.
- Different non-tag dimensions combine with AND.
- A tag cannot be both included and excluded; switching state removes it from the opposite set atomically.

**Important competitor difference:** MangaDex API documentation describes default included tag mode as AND and excluded mode as OR. This project's current proposed canonical plan uses OR within group / AND across groups / exclusion NOT. The UX must explicitly communicate the chosen mode, and the backend must implement the project's canonical rule; do not quietly assume MangaDex API default. See `01_COMPETITOR_BENCHMARK...` and the source register.

### 3.3 Content Rating

**UI:** multi-select or radio/select. Values:
- Safe
- Suggestive
- Erotica
- Pornographic
- Unknown / Not classified

Recommended default:
- Apply the product's documented content visibility default, not an implicit “all”.
- For a general audience default, include only `safe` and require opt-in to broader levels if the product has a legal/age policy.
- Show a visible indicator when broader ratings are enabled.
- `unknown` is not safe and must not leak into safe-only results.

**Data:** `mangas.content_rating` enum.

`unknown`/NULL handling must follow `03_DOMAIN_RULES_AND_STATE_MACHINES.md` and security/product policy. Do not infer safety from absence.

### 3.4 Publication Demographic

**UI:** multi-select chips: Shounen, Shoujo, Seinen, Josei, Kodomo, Unknown.

**Data:** `mangas.publication_demographic`.

Semantics: OR among selected values; dimension combines with all other filter dimensions via AND. “None/Unknown” is its own value, not a synonym for unclassified content rating.

### 3.5 Authors and Artists

**UI:** two separate searchable multi-select controls.
- `Author` search by name.
- `Artist` search by name.
- Each selected Creator chip displays name and role.
- If same creator has both roles, user may choose a role-specific chip or the product can resolve the same creator ID across both based on selected control.

**Data:** `creators` + `manga_creators.role`.

Semantics recommended:
- Multiple authors within Author control: OR by default (any chosen author is credited).
- Multiple artists within Artist control: OR by default.
- If both Author and Artist have at least one selection: AND across those dimensions (must satisfy one of selected authors and one of selected artists).
- Search results from autocomplete must disambiguate homonymous Creator by a secondary hint (role, work count, alternative spelling if available); identity uses `creator_id`, never name.

### 3.6 Original Language

**UI:** searchable multiselect; label must state `Ngôn ngữ gốc`.

**Data:** `mangas.original_language`.

- Supports ISO 639-1 lower-case; region suffix may occur (e.g. `pt-br`).
- Render human-readable localized language label and optionally flag; never flag only.
- “Unknown” is separate and not a wildcard.
- This does not filter translation chapters.

### 3.7 Translated Chapter Language

**UI:** searchable multiselect; label `Có chapter dịch bằng` / `Translation language`.
- Optional toggle “Must have at least one chapter in selected language”. Default ON when one or more language selected.
- Result card can show language count or selected matching language only if data exists.

**Data:** `chapters.language` (EXISTS query), optionally `manga_stats_languages.language_code` aggregate.

Important distinctions:
- `mangas.original_language` tells original work language.
- `chapters.language` is language of a chapter translation/export.
- Do not use the same dropdown for both.

### 3.8 Publication Year

**UI:** From / To numeric inputs (four-digit integer).

**Data:** `mangas.year`.

Rules:
- Inclusive range.
- Validate 1800–2200 per package schema; if source year null, do not match a concrete range.
- From must be <= To.
- Single year can use same From/To.
- Do not confuse `published_start_date` free-form source field with normalized `year`.

### 3.9 Publication Status

**UI:** multi-select: Ongoing, Completed, Hiatus, Cancelled, Unknown.

**Data:** `mangas.publication_status`.

Semantics: OR within selected values. Unknown distinct from null; normalize at ingestion according to package schema and mapping.

### 3.10 Exported Chapter Count (Comick-inspired)

**UI:** `Số chapter đã có trên hệ thống` with Min / Max numeric fields.

**Data:** `manga_stats.chapter_count`.

Rules:
- Distinguish **exported/available chapters** from `mangas.official_chapters` (official count from metadata).
- This should not be titled simply “Official chapters”.
- Min >= 0, max >= 0, min <= max.
- If manga_stats row missing, treat as unknown and define whether unknown items are excluded under active range; recommended exclude from bounded range and present missing-data state if relevant.
- “Include manga with no imported chapters” maps to `chapter_count = 0` or missing stats after explicit normalization, not official_chapters=0.

### 3.11 Minimum Rating (Comick-inspired)

**UI:** select or numeric range `Điểm đánh giá tối thiểu`.

**Data:** `mangas.average_rating` (check score scale and data quality first).

Rules:
- Use only active ratings; average must come from canonical aggregate.
- If zero ratings / no valid average, display `Chưa có đánh giá`; do not treat as 0.
- Slider should use actual scale configured in app, not hardcoded to 10 unless verified.
- Filter `minimum score >= X` excludes unrated content unless there is an explicit “include unrated” toggle.

### 3.12 Added to Catalog Date (Comick-inspired)

**UI:** quick ranges (7 days, 30 days, 3 months, 1 year) and optional custom date.

**Data:** `mangas.created_at` (internal insert time).

Label must be `Mới được thêm vào hệ thống`, not `Ngày xuất bản`.

### 3.13 Recently Updated / Latest Chapter

**UI:** optional time window or sort only.

**Data:** `mangas.updated_at` / latest `chapters.publish_at` / source update timestamp; confirm which field is reliably advanced by CDC before using it.

If latest chapter timestamp is not maintained, calculate max publish_at with an indexed materialized aggregate or omit time filter. Don't run a heavy per-row max query over an unbounded dataset at interactive latency.

### 3.14 Work Type (Manga / Manhwa / Manhua / Webtoon)

**UI:** reserve a possible future filter, but do not expose it as a real filter yet.

**DATA GAP:** current package contract / DB schema does not expose a canonical `work_type` field. `publication_demographic` is not work type; original language does not reliably determine it; `format` tags may describe Full Color/Long Strip but not always Manga/Manhwa/Manhua.

Options:
- Add canonical `work_type` to source package and DB (preferred if source data can authoritatively provide it).
- Or use a clearly labelled inferred classification with provenance/confidence (not recommended for initial UI).
- Or omit until data exists.

Default: omit in P0.

### 3.15 Hide manga already in my Library / Lists

**UI:** toggles under `My reading data`:
- Hide manga with a reading status.
- Hide manga already in any of my custom lists.
- Optionally filter to only not-started/started if product chooses.

**Data:** `reading_status_records`, `list_items`, `reading_lists`.

Auth required. Anonymous UI should either hide these toggles or show sign-in affordance; no false disabled filter.

Define `in my list` precisely: membership in any custom list is different from having a reading status. Do not merge them.

## 4. Sort controls

Expose a curated set, not every backend field:

| UI label | Source field / aggregate | Availability |
|---|---|---|
| Recently updated | latest chapter publish/updated timestamp or maintained manga update field | P0 after confirming maintained timestamp |
| Most viewed | `mangas.total_views` | P0 if counter is valid |
| Highest rated | `mangas.average_rating` | P0 with unrated handling |
| Title A–Z / Z–A | normalized title | P0 |
| Newest added | `mangas.created_at` | P1 |
| Publication year | `mangas.year` | P1 |
| Most followed | no current `manga_stats.followed_count` field in documented schema | DATA GAP |
| Most chapters | `manga_stats.chapter_count` | P1 |
| Relevance | search service relevance score | P0 for text query; otherwise don't display |

Every sort must have deterministic tie-breaker (e.g. manga_id) so pagination doesn't shuffle ties.

## 5. Default sort

- On plain catalogue/no text search: Recently Updated descending if the underlying aggregate is maintained; otherwise Newest Added descending.
- On text query: Relevance descending.
- On a saved filter without text: Most Relevant only if actual ranking function exists; otherwise Recently Updated.
- Never default to rating if it suppresses new/unrated manga.

## 6. Result controls and cards

### 6.1 Header row

- `N kết quả` only if total count is returned; otherwise “Kết quả” + pagination metadata.
- Sort select.
- Grid/List toggle, preference stored locally.
- Filter panel collapse/open.
- Active filter count.

### 6.2 Grid card

- Cover, title, publication status, content rating if needed, short tag summary, latest chapter label if available, average rating/count if available.
- Max 3 visible tags; additional count chip `+N`.
- No raw synopsis longer than 2 lines.

### 6.3 List row

- Cover thumbnail, title + alt title only if helpful, creators/roles, status/year, chapter count + languages, score, latest update.
- Use fixed columns with responsive wrap, never clip title/creator to unreadable text.

## 7. Filter apply state machine

States:
- `APPLIED`: current filters match URL and displayed results.
- `DRAFT`: user has changed filter values but not applied.
- `APPLYING`: request in flight; disable duplicate apply.
- `RESULTS`: response accepted.
- `EMPTY`: response valid but no results.
- `ERROR`: recoverable failure; preserve draft and last valid URL.

Transitions:
1. On route load, parse URL into applied state.
2. Open filter panel: clone applied state into draft.
3. User changes filter: update draft only; show selected counts.
4. Clear group: clear one group in draft.
5. Clear all: reset draft to default filter state.
6. Apply: validate ranges/enums; if invalid show field errors without request.
7. Serialize canonical query params; set page=1; update URL using replace/push according to whether user initiated a new search.
8. Fetch results; ignore stale request responses using request ID / abort controller.
9. Success: mark applied, render results and count.
10. Empty: show “No results match these filters” with `Clear one or more filters` suggestions; keep active chips.
11. Error: preserve filters and show retry; do not clear results unless they are unsafe/stale.
12. Browser back/forward: rehydrate applied filters from URL and refetch.

## 8. URL query contract recommendation

Example illustrative URL (exact naming can adapt to backend):

`/search/advanced?q=monster&tagInclude=romance,drama&tagExclude=harem&tagMode=any&demographic=seinen&status=completed&contentRating=safe&originalLanguage=ja&chapterLanguage=en&yearFrom=1995&yearTo=2010&chaptersMin=20&ratingMin=7.5&sort=updated_desc&page=1`

Rules:
- Stable slug/enum values, not display labels.
- Multi-values sorted/canonicalized before serialization.
- Empty/default values omitted.
- Invalid enum values rejected/stripped with visible notice if significant.
- Do not serialize account IDs, private list IDs or personal info into public URLs.
- URL contains query conditions, not unsaved sensitive data.
- Browser refresh restores exact applied state.

## 9. API/query mapping matrix

| UX field | Query source | Query shape idea | Index/optimization |
|---|---|---|---|
| title | mangas + alt_titles | title/alt title search | full-text/trigram/search index |
| tags | tags + manga_tags | include/exclude set predicates | `(tag_id,manga_id)` index |
| demographic/status/rating | mangas | exact enum predicates | composite filter indexes as workload shows |
| original language | mangas.original_language | IN list | index if high use |
| chapter language | chapters / manga_stats_languages | EXISTS or precomputed distinct set | `(language,manga_id)` or mapping index |
| creator author/artist | manga_creators + creators | EXISTS role & ID | `(creator_id,role,manga_id)` index |
| year | mangas.year | inclusive range | index with other common filters |
| chapter count | manga_stats.chapter_count | numeric range | index if frequently queried |
| average rating | mangas.average_rating | >= min | index if useful after explain plan |
| added date | mangas.created_at | range | index |
| total views | mangas.total_views | ORDER BY | index/materialized counter strategy |
| in my status | reading_status_records | NOT EXISTS / EXISTS | `(reader_account_id,manga_id)` unique |
| in my list | list_items + reading_lists | NOT EXISTS across owned lists | `(list_id,manga_id)` plus owner index |

## 10. Performance and loading

- Debounce text input; not every filter toggling should fire network requests before Apply.
- Keep previous results visible but visually marked loading if that helps; don't show stale title cards after security visibility change.
- Cache taxonomy (tags/languages/demographics) with version/TTL; refresh if package import adds tags.
- Use pagination/cursor; result card images lazy-load and preserve aspect ratio.
- Avoid N+1 queries for creator/tag/chapter metadata.
- If total count is expensive, show approximate/no total; never fabricate exact count.
- Facet counts are P2 unless query infrastructure supports them cheaply and accurately.

## 11. Advanced Search acceptance criteria

1. A user can search by primary title and alternative title.
2. User can include and exclude a tag and the UI clearly shows the state.
3. A tag cannot accidentally remain included and excluded simultaneously.
4. Include any/all semantics displayed match the backend request semantics.
5. Multiple tag groups combine according to canonical rule.
6. User can filter content rating, demographic, original language, publication status, year range.
7. User can separately filter translated chapter language.
8. User can search and select Author and Artist without merging homonymous creators.
9. Year range and chapter-count range validate min <= max.
10. Minimum rating correctly excludes or optionally includes unrated entries.
11. `unknown` content rating never appears in safe-only results.
12. Hidden manga never appears in search, even if cached.
13. Applying a filter resets page to 1.
14. URL refresh/back/forward restores applied filters.
15. Mobile sheet has sticky Apply/Clear and does not lose focused action under safe-area/browser UI.
16. Empty results preserves all filters and provides recoverable actions.
17. Unsupported work type/follower count filters are not shown before source data exists.
18. `chapter_count` and `official_chapters` are labelled distinctly.

