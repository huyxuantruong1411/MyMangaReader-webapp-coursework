# Catalog, Search, Filtering, Creator Pages & Recommendation System

## 1. Public catalog rules

- Public Reader queries return `mangas.visibility_status=PUBLIC` only.
- `HIDDEN` and deleted manga must be excluded from catalogue, autocomplete, full search, Creator works, recommendation candidates, chapter open, list stats and reader-facing metadata APIs.
- Admin endpoints can query all visibility statuses.
- Cards should not require full manga-detail payload; use a lightweight read model to avoid N+1 queries.
- Card fields: primary cover, title, latest chapter label, rating/aggregate values and relevant badges.

## 2. Catalogue listing (UC-3.1)

Sort options:
- latest chapter/update (default per source);
- views descending;
- average rating descending;
- title A–Z.

Rules:
- deterministic secondary sort (manga ID/pool ID) to avoid records jumping between pages on ties;
- pagination uses bounded page size configurable because numeric size missing from source;
- query returns total count only if affordable; cursor pagination may be preferable for high-volume lists but preserve page-based semantics if UI needs page numbers;
- `updated_at`/latest chapter update must be correctly maintained when CDC imports a new chapter.

## 3. Search design

### 3.1 Autocomplete

- Endpoint logically equivalent to `/api/manga/autocomplete?q=...`.
- Prefix/title/alt-title matching, accent/case-insensitive.
- Public mangas only.
- Lab9 sequence uses max 10 suggestions; activity diagram target indicates dropdown around 300ms.
- Debounce (e.g. 150–250ms proposed client tuning), cancel previous request and ignore stale response; the exact debounce number is not a source requirement.
- Empty query returns no suggestions or trending only if explicit product design.

### 3.2 Full-text search

- Endpoint logically equivalent to `/api/manga/search?q=...&page=...`.
- Search primary title + all alternative titles; fuzzy small typo tolerance; accent-insensitive; case-insensitive.
- Full result page can default around 24 per page in Lab9 sequence; activity diagram indicates 20–24 cards/page, so configure rather than scatter constant.
- Search service may be SQL FTS or engine such as Elasticsearch/OpenSearch; Lab8 describes search engine as example, not mandatory stack.
- Always re-check public visibility in canonical DB before returning or opening result.
- Ranking strategy should prioritize exact title, normalized prefix, alt title, fuzzy title, then popularity/updated time; record score internally.

### 3.3 Creator search

- Search Creator by normalized name; include both Author and Artist role credits.
- Result includes identity, role(s), and public works.
- Do not merge homonymous creators by name; canonical `creator_id` disambiguates.

## 4. Advanced filter model (UC-3.2)

Dimensions:
- Tags grouped into `format`, `genre`, `theme`, `content`, plus `other` fallback.
- Publication demographic: `shounen`, `shoujo`, `seinen`, `josei`, `kodomo`, `unknown`.
- Publication status: ongoing/completed/hiatus/cancelled/unknown.
- Publication year/year range.
- Original language.
- Content rating (distinct from demographic).
- Possibly Creator Author/Artist, if product chooses extension.

### 4.1 Include/exclude logic

Source says Include with AND/OR and Exclude (`NOT`) for tags but does not precisely define grouping. Recommended default:
- Selected included tags within a group use OR.
- Different selected tag groups combine with AND.
- Excluded tags combine with NOT (any excluded match disqualifies).
- A selected tag cannot be both included and excluded; client removes it from opposite set.
- Offer advanced “match all selected in group” switch if AND is required.
- Metadata dimensions combine with AND.

### 4.2 Content rating safety

- `unknown` is NOT safe according to package contract.
- If filter = safe only, include only `safe`, not `unknown`/null.
- `pornographic`/`erotica` never leak when a content filter or age gate should exclude them.
- If user birth date is private, server may use it for eligibility without returning it to client only if legal/privacy policy allows; otherwise age filter relies on user setting, not exposed DOB.

### 4.3 Filter response behavior

- Draft filters do not trigger request until Apply (activity diagram).
- Applying filters resets page to 1.
- Empty result prompts user to loosen constraints.
- Query parameters serialize filters so back/refresh restores state.
- Reject invalid/unknown group or enum values; do not ignore silently.

## 5. Manga detail aggregation

Metadata response includes:
- title + alt titles;
- primary/alternate cover arts;
- synopsis;
- Creator list and roles/links;
- tags with groups;
- publication status/demographic/content rating/original language/year/dates;
- official volume/chapter counts separately from exported chapter/page stats;
- rating average + interaction data;
- current Reader read status and progress only for authenticated self;
- chapter list;
- comments and recommendation previews through separate endpoints/loaders.

Use independent loading for recommendations/comments/chapter list to protect metadata first paint.

## 6. Creator page

- Creator header: canonical identity, display name, localized bio, social links.
- Works derived from `manga_creators` by creator ID; role display distinguishes script/writing vs art.
- Public works only.
- Filters by tags/status; sort latest/highest rating/views; pagination via AJAX/no full reload.
- A Creator may hold both roles for the same work; UI must show both without duplicate manga card (combine roles for card, preserve rows in DB).

## 7. Recommendation architecture

Three distinct recommendation paths are explicitly required. They may share a candidate filter/ranking response layer but must not silently collapse into one heuristic.

### 7.1 Shared candidate eligibility

- Source manga excluded from candidates.
- `visibility_status=PUBLIC` only.
- Exclude deleted/unavailable candidate records.
- Avoid duplicates between recommendation rows.
- If current Reader state is `COMPLETED` or `DROPPED`, do not recommend same manga again in user-based path; item/content rules may also personalize based on read status.
- Recommendation failure must not block manga detail screen; show popular/latest fallback.

### 7.2 Item-based collaborative filtering (UC-3.7)

Signals described: chapter read/history, list addition, ratings.

Flow:
1. Receive source `manga_id`.
2. Check interaction support/sparsity for source manga.
3. If enough interactions, read precomputed item-item similarity scores.
4. Filter source manga, hidden manga and invalid candidates.
5. Rank top N by similarity; optionally combine popularity as deterministic tie-break.
6. If too sparse, fallback to content-based then trending/popular.
7. Return source type (`ITEM_BASED` or fallback reason) for telemetry/QA.

Activity diagram indicates query of similarity matrix with a target around 500 ms; benchmark actual stack and make timeout configurable.

### 7.3 User-based collaborative filtering (UC-3.8)

Prerequisites:
- Reader authenticated and has reading history or ratings per use case; reading lists also provide interaction signal.
- New/empty profile fallback: popular/trending and prompt Reader to read/rate.

Flow:
1. Build sparse interaction vector from current Reader's history, rating and list data.
2. Find similar users using anonymized vectors; do not disclose identities of similar users.
3. Aggregate highly preferred mangas by similar user group.
4. Exclude current Reader's read/completed/dropped items as specified; exclude HIDDEN.
5. Rank and return.

Privacy: model service receives pseudonymous IDs or aggregate vectors; UI never names similar Readers.

### 7.4 Content-based filtering (UC-3.9)

Features named by source:
- tags/genres/themes/formats/content;
- Author/Artist;
- synopsis keywords via TF-IDF or embedding.

Flow:
1. Get feature vector for source manga or Reader interests.
2. Compute cosine similarity against other public manga.
3. Exclude source itself.
4. If score below threshold or no vector, fallback to same main tag and high rating.
5. Return ranked candidates and method/version.

ETL adds/revises content vector when metadata/chapter pool update makes relevant; model version should be recorded in result for reproducibility.

### 7.5 Recommendation evaluation

- Offline: precision@k, recall@k, coverage, diversity, cold-start coverage, latency.
- Online: click-through/open chapter, save-to-list, rating/reading status changes; do not optimize solely on clicks if it encourages clickbait.
- Use only permitted activity signals, minimize PII.
- Keep popularity fallback transparent and stable.

## 8. Search index synchronization

Trigger index update on:
- initial ETL/manga metadata upsert;
- alt title changes;
- Creator/tag membership changes;
- manga hide/show/delete;
- CDC metadata/chapter update that affects latest chapter/search sort.

Recommended transactional outbox:
- DB transaction writes entity changes + outbox row;
- indexer consumes outbox, upserts/removes search doc idempotently;
- record index version/last indexed revision;
- if indexing fails, retry without rolling back valid DB import; keep `index_pending` state and avoid falsely claiming fully searchable.

## 9. Catalog query APIs and caching

- Public catalog caches key by normalized query/filter/sort/page + visibility version.
- Invalidate on hide/show/delete and ingestion/CDC updates.
- Cache must not bypass current visibility checks for sensitive or newly hidden content; include short TTL or version validation.
- Query filters parameterized; sort fields mapped from allowlisted enum to server expressions.
- Avoid per-card Creator/tag/chapter query; fetch via joins/aggregation/batched loaders.
