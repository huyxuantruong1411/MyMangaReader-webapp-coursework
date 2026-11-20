# API Contracts, Command Semantics & Event Catalogue

> The source diagrams show representative routes/payloads and a service-based backend, but do not provide a complete formal OpenAPI spec. Routes below are a **proposed canonical API surface** that maps to the use cases and sequence diagrams. An agent may adapt path naming but must preserve semantics, authorization, idempotency and state transitions.

## 1. API conventions

### 1.1 Base rules

- Prefix `/api/v1` (versioning proposal).
- JSON request/response except multipart upload and media bytes.
- Timestamps RFC3339/ISO 8601 UTC.
- IDs: internal IDs in app APIs; stable pool IDs primarily in Admin ETL/diagnostics.
- Auth context derives `account_id`, role and session from verified session; do not accept a client owner ID as authority.
- Use HTTP status and stable `error.code`; front-end must not parse free-form error strings.
- Pagination standard: `page`, `pageSize`; bounded configurable page size; stable sorting.
- Filtering/sort values are allowlisted enums; parameterized SQL only.
- Mutations accept optional `Idempotency-Key` when request may be retried across a network.
- For optimistic concurrency, use `version`/ETag for resources that can be edited concurrently.

### 1.2 Response envelope

Success proposal:
```json
{
  "data": {},
  "meta": {"requestId": "..."}
}
```

Paginated:
```json
{
  "data": [],
  "meta": {"page": 1, "pageSize": 24, "total": 0, "hasNext": false, "requestId": "..."}
}
```

Error:
```json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Resource not found",
    "details": {"field": "..."}
  },
  "meta": {"requestId": "..."}
}
```

Do not expose SQL exception text, stack traces, storage credentials, session tokens or OTP in `details`.

### 1.3 Common error semantics

| HTTP | Stable code examples | Typical meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR`, `INVALID_FILTER`, `INVALID_PAGE` | Invalid input |
| 401 | `AUTHENTICATION_REQUIRED`, `SESSION_EXPIRED` | No valid session |
| 403 | `FORBIDDEN`, `ACCOUNT_LOCKED`, `EMAIL_NOT_VERIFIED` | Actor cannot perform action |
| 404 | `RESOURCE_NOT_FOUND`, `MANGA_NOT_FOUND`, `CHAPTER_NOT_FOUND` | Missing/hidden/private resource (avoid enumeration) |
| 409 | `DUPLICATE_RESOURCE`, `STATE_CONFLICT`, `REPORT_ALREADY_PROCESSED`, `STALE_REVISION` | Unique/state/version conflict |
| 413 | `UPLOAD_TOO_LARGE`, `PACKAGE_TOO_LARGE` | Payload/file limit |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | File/content type unsupported |
| 422 | `BUSINESS_RULE_VIOLATION`, `RATING_REQUIRES_READING` | Valid shape but invalid business state |
| 429 | `RATE_LIMITED`, `OTP_TOO_MANY_ATTEMPTS` | Rate limit |
| 502/503/504 | `UPSTREAM_UNAVAILABLE`, `UPSTREAM_TIMEOUT`, `STORAGE_UNAVAILABLE` | Dependency failure |

## 2. Authentication and account API

| Method | Path | Purpose | Guard |
|---|---|---|---|
| POST | `/auth/register` | Create pending account and OTP challenge | Anonymous + rate limit |
| POST | `/auth/verify-otp` | Verify email OTP and activate | Anonymous + rate limit |
| POST | `/auth/resend-otp` | Invalidate old OTP and send new | Pending account + rate limit |
| POST | `/auth/login` | Create session | Anonymous + rate limit |
| POST | `/auth/refresh` | Rotate refresh token | Valid refresh token |
| POST | `/auth/logout` | Revoke current session | Authenticated |
| GET | `/account/me` | Current profile | Authenticated |
| GET | `/accounts/{accountId}/profile` | Public profile view | Public fields only; Admin/self extended |
| PATCH | `/account/profile` | Update display name/bio/DOB visibility | Active Reader self |
| POST | `/account/avatar` | Upload/change avatar | Active Reader self; multipart |
| PUT | `/account/password` | Change password/revoke other sessions | Active Reader self |

### 2.1 Register request

```json
{"email":"reader@example.com","username":"reader-name","password":"<secret>"}
```

Return `202 Accepted` or `201 Created` with `{accountId,status:PENDING_VERIFICATION,verificationRequired:true}`. Never return OTP.

### 2.2 Verify OTP request

```json
{"email":"reader@example.com","code":"123456"}
```

Success changes account status to ACTIVE. Exact OTP length is a proposed choice; sequence specifies TTL 120 seconds and use case permits OTP or link.

### 2.3 Login request/response

```json
{"identifier":"reader-name-or-email","password":"<secret>"}
```

Response includes session metadata and access token only if using bearer access token; refresh token should be delivered in secure HttpOnly cookie when feasible. Never include refresh token in JSON logs or analytics.

### 2.4 Profile response privacy

Public response only includes permitted fields: `displayName`, `avatar`, `bio`, `birthDate` only when public, optional joined date. Self/Admin response may add email/status. Do not return report history to other users.

## 3. Discovery/catalog APIs

| Method | Path | Purpose |
|---|---|---|
| GET | `/manga` | Public paged listing by sort/filter |
| GET | `/manga/autocomplete?q=` | Max 10 quick suggestions |
| GET | `/manga/search?q=&mode=TITLE&page=` | Full-text/fuzzy title/alt-title search |
| GET | `/creators/search?q=&role=` | Creator search |
| GET | `/manga/{mangaId}` | Manga metadata detail (PUBLIC only) |
| GET | `/creators/{creatorId}` | Creator detail |
| GET | `/creators/{creatorId}/manga` | Public works with filter/sort/page |
| GET | `/manga/{mangaId}/chapters` | Ordered chapter list/filter |
| GET | `/manga/{mangaId}/recommendations?type=ITEM_BASED` | Item-based |
| GET | `/manga/{mangaId}/recommendations?type=CONTENT_BASED` | Content-based |
| GET | `/recommendations/me?type=USER_BASED` | User-based; active Reader |

### 3.1 Catalog query

Example:
```http
GET /api/v1/manga?page=1&pageSize=24&sort=UPDATED_DESC&includeTags=...&excludeTags=...&status=ongoing&language=ja&contentRating=safe
```

API must define stable semantics for Include/Exclude tags as `08_CATALOG_SEARCH_RECOMMENDATIONS.md`.

### 3.2 Autocomplete

Response suggestion type includes `MANGA` or `CREATOR`; if only manga autocomplete is implemented initially, keep API type extensible and do not mislabel creators. Public visibility always enforced.

### 3.3 Manga detail

Core response can include metadata, cover ref/media URL, creator roles, tags, publication fields, aggregate rating/stats. Personalized state (reading status/progress/current rating) should be separate optional self-only segment to prevent leaking account-specific values via public cache.

## 4. Reader APIs

| Method | Path | Purpose | Guard |
|---|---|---|---|
| GET | `/reader/open` | Resolve `START`, `CONTINUE`, `SELECT` and return manifest/settings | Public manga; optional Reader |
| GET | `/chapters/{chapterId}/pages` | Page manifest / media refs | Public manga |
| PUT | `/reader/progress` | Upsert current resume point | Active Reader |
| GET | `/reader/progress/{mangaId}` | Read resume state | Self |
| GET | `/reader/history` | Personal chapter-open history | Self |
| PUT | `/reader/settings` | Update display mode/direction/fit/preload | Active Reader |
| POST | `/reader/view-session/{historyId}/complete` | Mark valid view after threshold if server-verified | Active Reader |

### 4.1 Open request

```http
GET /api/v1/reader/open?mangaId=<id>&actionType=CONTINUE
```

For SELECT also include `chapterId`. Server verifies relationship and visibility. Response includes chosen chapter, page count/pages (or signed media endpoint), initial page, reader settings and history ID if authenticated.

### 4.2 Progress request

```json
{
  "mangaId":"<internal-id>",
  "chapterId":"<internal-id>",
  "pageNumber":17,
  "pageUid":"stable-page-uid",
  "pagesRevision":3,
  "clientSequence":42
}
```

API is a proposed extension required by UC-4.6; baseline Lab10 doesn't store exact page progress.

### 4.3 Reader settings request

```json
{
  "displayMode":"DOUBLE_PAGE",
  "readingDirection":"RTL",
  "fitMode":"FIT_WIDTH",
  "preloadPageCount":3
}
```

Validate enums/range. If anonymous preference is supported, persist client-side until login.

## 5. Reading status and rating APIs

| Method | Path | Purpose |
|---|---|---|
| PUT | `/manga/{mangaId}/reading-status` | Set desired current state |
| DELETE | `/manga/{mangaId}/reading-status` | Clear current state |
| GET | `/account/me/reading-status` | List current statuses |
| PUT | `/manga/{mangaId}/rating` | Create/update current rating |
| DELETE | `/manga/{mangaId}/rating` | Remove current rating (history REMOVE) |
| GET | `/manga/{mangaId}/rating` | Current Reader rating + aggregate |
| GET | `/account/me/rating-history` | Paginated rating change history |

Rating request:
```json
{"score":8}
```
Guard: active Reader + at least one persisted reading history open for a chapter in manga. `score` integer 1–10. Response includes current rating and current average.

Reading status request:
```json
{"status":"READING"}
```
Only one row per `(reader,manga)`. Repeated same value idempotent.

## 6. Comment and reaction APIs

| Method | Path | Purpose |
|---|---|---|
| GET | `/comments?mangaId=&chapterId=&page=` | List comments |
| POST | `/comments` | Create manga/chapter-level comment or reply |
| GET | `/comments/{commentId}` | Fetch for edit if owner |
| PUT | `/comments/{commentId}` | Edit content/spoiler |
| DELETE | `/comments/{commentId}` | Soft delete owner or Admin |
| GET | `/comments/{commentId}/history` | Read previous versions |
| PUT | `/comments/{commentId}/reaction` | Set desired reaction |
| POST | `/comments/{commentId}/reports` | Report comment |

Create request:
```json
{
  "mangaId":"...",
  "chapterId":null,
  "parentCommentId":null,
  "content":"...",
  "isSpoiler":false
}
```
Server validates manga/chapter relation, parent context, content 1–2000 characters, active Reader and sanitization.

Edit request:
```json
{"content":"updated text","isSpoiler":true}
```
Server checks owner and `is_spoiler_locked_by_admin` and appends edit history before update.

Reaction request:
```json
{"reactionType":"LIKE"}
```
Use `null` to remove reaction if desired-state semantics chosen. Avoid toggle semantics without explicit API contract.

## 7. Reading List APIs

| Method | Path | Purpose |
|---|---|---|
| GET | `/lists/my` | Search current Reader's lists |
| POST | `/lists` | Create list |
| GET | `/lists/{listId}` | View owned list and public contents |
| PATCH | `/lists/{listId}` | Update list details |
| DELETE | `/lists/{listId}` | Delete list and memberships |
| POST | `/lists/merge-create` | Clone/merge selected owned lists |
| GET | `/lists/{listId}/metadata-stats` | Dynamic metadata stats |
| GET | `/manga/{mangaId}/my-list-memberships` | Current membership across user's lists |
| PUT | `/manga/{mangaId}/my-list-memberships` | Synchronize desired selected list set |
| POST | `/lists/quick-create` | Quick create list from add-to-list modal |
| GET | `/lists/{listId}/manga` | Search/filter items within list |

Create list request:
```json
{"name":"Favorites","description":"..."}
```
Clone request:
```json
{
  "sourceListIds":["id-1","id-2"],
  "newName":"Merged favorites",
  "description":"...",
  "confirmEmpty":false
}
```
If all source lists empty, response `409 EMPTY_SOURCE_LISTS_CONFIRMATION_REQUIRED` with a safe confirmation prompt. After explicit retry set `confirmEmpty=true`.

Membership desired-state request:
```json
{"selectedListIds":["list-a","list-c"]}
```
Server removes prior memberships not selected and inserts missing ones. All list IDs must belong to caller. Idempotent.

Stats response should make formulas transparent:
```json
{
  "totalMangas":12,
  "totalExportedChapters":430,
  "tagDistribution":[{"tagSlug":"action","count":6,"percent":50.0}],
  "publicationStatusDistribution":[{"status":"ongoing","count":7,"percent":58.3}],
  "averageListRating":8.1,
  "ratedMangaCount":9,
  "topCreators":[{"creatorId":"...","name":"...","workCount":4,"roles":["author"]}],
  "calculatedAt":"..."
}
```

## 8. Reports/Admin APIs

| Method | Path | Purpose | Guard |
|---|---|---|---|
| POST | `/reports/account` | Create account report | Active Reader |
| POST | `/reports/manga` | Create manga/chapter report | Active Reader |
| POST | `/reports/comment` | Create comment report | Active Reader |
| GET | `/admin/reports` | Filter queue by type/status | Admin |
| GET | `/admin/reports/{reportId}` | Detail + target existence | Admin |
| POST | `/admin/reports/{reportId}/resolve` | Apply action/ignore | Admin |
| GET | `/admin/accounts` | Search accounts | Admin |
| GET | `/admin/accounts/{accountId}` | Protected account details | Admin |
| GET | `/admin/accounts/{accountId}/activity-logs` | Immutable activity query | Admin |
| GET | `/admin/accounts/{accountId}/reading-statistics` | User behavior statistics | Admin |
| POST | `/admin/accounts/{accountId}/lock` | Lock Reader | Admin |
| POST | `/admin/accounts/{accountId}/unlock` | Unlock Reader | Admin |
| POST | `/admin/manga/{mangaId}/hide` | Hide manga | Admin |
| POST | `/admin/manga/{mangaId}/show` | Show manga | Admin |
| POST | `/admin/manga/{mangaId}/delete` | Delete local copy | Admin |
| GET | `/admin/manga/statistics` | Interaction analytics | Admin |

Resolve request proposal:
```json
{
  "actionType":"HIDE_MANGA",
  "note":"...",
  "ignoreFutureReports":false
}
```
API validates action compatible with report subtype; `ignoreFutureReports` maps to the authoritative `mangas.ignore_all_reports`, not a second independent switch.

Lock request: `{"reason":"..."}`. Unlock request: `{"reason":"..."}`. Reason required.

## 9. Source import / ETL Admin APIs

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/external-sources` | List package sources ready for ETL (sequence) |
| POST | `/admin/etl-sync` | Create batch job with manga IDs and per-manga CDC choices |
| GET | `/admin/etl-jobs` | List jobs |
| GET | `/admin/etl-jobs/{jobId}` | Job aggregate + per-item status |
| POST | `/admin/etl-job-items/{jobItemId}/retry` | Retry eligible failed item |
| POST | `/admin/manga/{mangaId}/cdc/enable` | Subscribe source |
| POST | `/admin/manga/{mangaId}/cdc/disable` | Cancel subscription |

Batch request:
```json
{
  "items":[
    {"sourceMangaId":"...","poolMangaId":"pm_...","enableCdc":true},
    {"sourceMangaId":"...","poolMangaId":"pm_...","enableCdc":false}
  ]
}
```

Creation returns `202 Accepted` + `jobId`; processing is asynchronous. Do not keep the Admin HTTP request open until ETL finishes.

## 10. CDC event envelope proposal

The precise upstream webhook event schema is not included in the uploaded contract. Below is a minimum proposed envelope; it is **not** part of package v2.0 and must be agreed with upstream:
```json
{
  "eventId":"provider-event-unique-id",
  "eventType":"CHAPTER_CREATED",
  "occurredAt":"2026-01-01T12:00:00Z",
  "contractName":"manga-reader-package",
  "contractVersion":"2.0",
  "poolMangaId":"pm_...",
  "poolChapterId":"pc_...",
  "poolRevision":12,
  "payloadSha256":"...",
  "payload":{}
}
```

Requirement: unique `eventId`, signature/authentication, revision guard, replay/idempotency, retry metadata.

## 11. Event catalogue

| Event code | Producer | Consumer/side effect |
|---|---|---|
| `ACCOUNT_REGISTERED` | Auth service | Email outbox/OTP |
| `EMAIL_VERIFICATION_SUCCEEDED` | Auth service | Account activation, audit |
| `ACCOUNT_LOGIN_SUCCEEDED` | Auth service | Activity log |
| `ACCOUNT_LOCKED` | Admin/moderation | Revoke sessions, email, audit |
| `ACCOUNT_UNLOCKED` | Admin/moderation | Email, audit |
| `PASSWORD_CHANGED` | Account service | Revoke other sessions, security notice |
| `PROFILE_UPDATED` | Account service | Profile/cache update |
| `MANGA_IMPORTED` | ETL | Search index, recommendation features, catalog cache |
| `MANGA_HIDDEN` / `MANGA_SHOWN` | Admin moderation | Search/index/cache invalidation |
| `MANGA_DELETED` | Delete workflow | CDC cancellation, membership cleanup, media GC, index removal |
| `CHAPTER_UPSERTED` | ETL/CDC | Chapter list cache/index invalidation |
| `CDC_EVENT_RECEIVED` | Webhook receiver | Durable queue consumer |
| `CHAPTER_OPENED` | Reader | Reading history |
| `VALID_VIEW_RECORDED` | Reader/worker | View counters/statistics |
| `READING_PROGRESS_UPDATED` | Reader | Resume state |
| `READING_STATUS_CHANGED` | Reader | Stats/recommendation cache |
| `RATING_CREATED` / `RATING_UPDATED` / `RATING_REMOVED` | Rating service | Average/ranking/recommendation update |
| `COMMENT_CREATED` / `COMMENT_EDITED` / `COMMENT_DELETED` | Comment service | Comment cache/activity log |
| `COMMENT_REACTION_CHANGED` | Comment service | Reaction counters |
| `REPORT_SUBMITTED` | Report service | Moderation queue/activity log |
| `REPORT_RESOLVED` / `REPORT_IGNORED` / `REPORT_CLOSED` | Moderation | Target changes/audit/notifications |
| `LIST_CREATED` / `LIST_UPDATED` / `LIST_DELETED` | List service | List cache |
| `LIST_MEMBERSHIP_CHANGED` | List service | Counts/stats/recommendations |

Event handlers must be idempotent. Use an outbox for DB mutation → queue publication; do not publish an event before the transaction commits.

## 12. API contract test requirements

- Schema validate requests/responses.
- Verify 401/403/404/409 distinctions.
- Verify owner checks with tampered account/list IDs.
- Verify retries with same `Idempotency-Key` return same logical outcome.
- Verify concurrent mutation races (rating, list membership, comment reactions, report state).
- Verify public endpoints never return HIDDEN manga or private profile/list data.
- Verify all mutating Admin paths record audit event and correct actor/target.
