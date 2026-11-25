# Từ điển Backend API, Hạ tầng & Cơ sở dữ liệu (`QL-DocTruyen`)

> **Dự án:** Hệ thống Đọc truyện Manga & Webtoon — Manga Reader (`QL-DocTruyen`)  
> **Khảo sát source:** ngày 25/11/2026 (sau commit `d90e788` — rà soát toàn bộ hệ thống)  
> **Phạm vi:** 83 file Python FastAPI + SQLAlchemy 2.x Async trong `apps/api/src/manga_reader/`, Alembic migrations trong `database/migrations/`, và CSDL SQL Server 2022 (`QL_DocTruyen`, 50 bảng, 10 T-SQL triggers, hệ thống covering indexes).  
> **Mục đích:** tài liệu tra cứu kỹ thuật đầy đủ cho toàn bộ bề mặt HTTP API (`/api/v1/*`), cấu trúc phân tầng Modular Monolith 12 module, các lớp Adapter hạ tầng và từ điển chi tiết từng bảng dữ liệu / chỉ mục / trigger.

---

## 1. Kiến trúc Modular Monolith & Chuẩn Envelope API

### 1.1 Khởi tạo ứng dụng & Middleware Pipeline

Tại `create_app()` ([main.py#L23-L80](../../apps/api/src/manga_reader/main.py#L23-L80)), FastAPI gắn theo thứ tự:
1. `CorrelationIdMiddleware` ([correlation.py#L18-L34](../../apps/api/src/manga_reader/middleware/correlation.py#L18-L34)): tiếp nhận hoặc sinh `X-Request-ID`, gán vào contextvar `correlation.py` để tự động đi kèm mọi dòng log JSON và `activity_logs`.
2. `StructuredAccessLogMiddleware` ([access_log.py#L15-L37](../../apps/api/src/manga_reader/middleware/access_log.py#L15-L37)): log thời gian phản hồi, method, path và status code.
3. `CORSMiddleware`: cho phép `credentials=True` phục vụ cookie `HttpOnly` (`mr_refresh_token`) trên localhost & production origin.
4. `register_exception_handlers()` ([error_handlers.py#L37-L105](../../apps/api/src/manga_reader/api/v1/error_handlers.py#L37-L105)): dịch toàn bộ ngoại lệ miền kế thừa `AppError` ([errors.py#L12-L115](../../apps/api/src/manga_reader/common/errors.py#L12-L115)) sang JSON chuẩn, không làm lộ SQL thô hay stack trace.

### 1.2 Cấu trúc JSON Envelope (`envelopes.py`)

| Loại Envelope | Cấu trúc | Định nghĩa |
|---|---|---|
| `SuccessEnvelope[T]` | `{ "data": T, "meta": { "requestId", "timestampUtc" } }` | [envelopes.py#L25-L27](../../apps/api/src/manga_reader/api/v1/envelopes.py#L25-L27) |
| `PaginatedEnvelope[T]` | `{ "data": T[], "meta": { "requestId", "timestampUtc", "page", "pageSize", "total", "hasNext" } }` | [envelopes.py#L30-L32](../../apps/api/src/manga_reader/api/v1/envelopes.py#L30-L32) |
| `ErrorEnvelope` | `{ "error": { "code", "message", "details" }, "meta": { "requestId", "timestampUtc" } }` | [envelopes.py#L41-L43](../../apps/api/src/manga_reader/api/v1/envelopes.py#L41-L43) |

### 1.3 Bảng mã lỗi chuẩn hóa (`errors.py`)

| Class lỗi (`errors.py`) | HTTP Status | `error.code` mặc định | Ngữ cảnh sử dụng tiêu biểu |
|---|---:|---|---|
| `ValidationAppError` | `400` | `VALIDATION_ERROR` / `INVALID_FILTER` / `INVALID_OTP` | Sai định dạng email/username/mật khẩu, bộ lọc năm/chương ngược, OTP sai |
| `AuthenticationRequiredError` | `401` | `AUTHENTICATION_REQUIRED` / `SESSION_EXPIRED` / `INVALID_CREDENTIALS` | Thiếu JWT, JWT hết hạn, phiên đã thu hồi, phát hiện reuse refresh token |
| `ForbiddenError` | `403` | `FORBIDDEN` / `MEDIA_FORBIDDEN` | Không phải Admin, chỉnh sửa tài nguyên người khác, bucket/chữ ký media sai |
| `AccountLockedError` | `403` | `ACCOUNT_LOCKED` | Tài khoản bị Admin khóa khi login/refresh/reset password |
| `EmailNotVerifiedError` | `403` | `EMAIL_NOT_VERIFIED` | Đăng nhập hoặc tương tác khi đang `PENDING_VERIFICATION` |
| `ResourceNotFoundError` | `404` | `RESOURCE_NOT_FOUND` / `MANGA_NOT_FOUND` / `NO_CHAPTERS` | Truyện `HIDDEN`/`TOMBSTONED`, chương không thuộc truyện, Reading List của người khác |
| `ConflictError` | `409` | `STATE_CONFLICT` / `DUPLICATE_RESOURCE` / `MANGA_IS_SYNCING` / `PROGRESS_CONFLICT` / `EMPTY_SOURCE_LISTS_CONFIRMATION_REQUIRED` | Trùng email/username/tên list, xóa truyện đang đồng bộ, progress cũ đến trễ |
| `PayloadTooLargeError` | `413` | `PACKAGE_TOO_LARGE` / `UPLOAD_TOO_LARGE` | Avatar > 5MB, Package ETL > 50MB |
| `BusinessRuleError` | `422` | `BUSINESS_RULE_VIOLATION` / `RATING_REQUIRES_READING` / `SPOILER_LOCKED_BY_ADMIN` / `SELF_REPORT_FORBIDDEN` | Rate khi chưa đọc chương, bỏ cờ spoiler khi Admin đã khóa, tự report mình |
| `ContractVersionUnsupportedError` / `ContractValidationError` | `422` | `CONTRACT_VERSION_UNSUPPORTED` / `CONTRACT_VALIDATION_FAILED` | Sai phiên bản `manga-reader-package:2.0` hoặc đánh số trang không liên tục |
| `RateLimitedError` | `429` | `RATE_LIMITED` / `OTP_RESEND_COOLDOWN` / `OTP_TOO_MANY_ATTEMPTS` | Quá 10 lần login/300s, gửi lại OTP dưới 60s, quá 20 report/300s |
| `UpstreamUnavailableError` / `StorageUnavailableError` | `503` / `404` | `UPSTREAM_UNAVAILABLE` / `STORAGE_UNAVAILABLE` / `MEDIA_NOT_FOUND` | MinIO/S3 hoặc dịch vụ nguồn ngoài không phản hồi |

---

## 2. Cấu trúc 12 Module Nghiệp vụ & Hạ tầng (`AppContainer`)

Composition root `AppContainer` ([container.py#L26-L100](../../apps/api/src/manga_reader/infrastructure/container.py#L26-L100)) đấu nối sạch toàn bộ adapter dựa trên Pydantic `Settings` ([settings.py#L32-L200](../../apps/api/src/manga_reader/config/settings.py#L32-L200)):

| Thành phần | Adapter cấu hình | File nguồn & Dòng | Trách nhiệm chính |
|---|---|---|---|
| **Database** | `DatabaseManager` (`mssql+aioodbc` / `sqlite+aiosqlite` / `postgresql+asyncpg`) | [database.py#L54-L124](../../apps/api/src/manga_reader/infrastructure/database.py#L54-L124) | Pool kết nối async, chuẩn đặt tên `IX_/UQ_/CK_/FK_/PK_` khớp SQL Server 2022, bật `use_setinputsizes=False` với MSSQL để bind chuẩn Unicode `NVARCHAR` tiếng Việt |
| **Cache & Rate Limit** | `RedisCacheAdapter` / `InMemoryCacheAdapter` + `CacheRateLimiter` | [cache.py#L46-L220](../../apps/api/src/manga_reader/infrastructure/cache.py#L46-L220) | Lưu hash OTP TTL 120s, cooldown 60s, đếm giới hạn tốc độ login & report |
| **Object Storage & Signing** | `S3CompatibleStorageAdapter` (MinIO AWS4 HMAC) / `LocalDevStorageAdapter` + `MediaUrlSigner` | [storage.py#L27-L414](../../apps/api/src/manga_reader/infrastructure/storage.py#L27-L414) | Lưu ảnh bìa, avatar, trang đọc theo `(bucket, object_key)`; ký URL động TTL 300s (`ADR-018`) |
| **Outbound Email** | `SmtpEmailAdapter` (`smtp.gmail.com:587` STARTTLS) / `DevConsoleEmailAdapter` | [email.py#L26-L168](../../apps/api/src/manga_reader/infrastructure/email.py#L26-L168) | Gửi email OTP HTML xác thực tài khoản, đặt lại mật khẩu và thông báo Lock/Unlock |
| **Audit & Outbox** | `append_activity_log` + `enqueue_outbox_event` | [audit_outbox.py#L18-L72](../../apps/api/src/manga_reader/infrastructure/audit_outbox.py#L18-L72) | Ghi log bất biến (kèm `redact_mapping`) và outbox idempotent trong cùng transaction |
| **Worker Boundary** | `BackgroundWorkerBoundary` | [runner.py#L36-L109](../../apps/api/src/manga_reader/workers/runner.py#L36-L109) | Registry chuẩn hóa Correlation ID & metrics cho tác vụ chạy nền |

**Danh sách 12 Domain Modules (`apps/api/src/manga_reader/modules/`):**
1. `account_auth` (M1 & M6): Đăng ký, OTP, Đăng nhập/Refresh/Logout, Quên mật khẩu, Hồ sơ, Upload Avatar, Đổi mật khẩu, Admin Lock/Unlock.
2. `manga_creator` (M2): Quản lý hiển thị (`HIDE`/`SHOW`) và Xóa cục bộ an toàn + Tombstone (`MangaLifecycleService`).
3. `catalog_discovery` (M3): Danh mục, Lọc Include/Exclude, Tìm kiếm & Autocomplete không dấu, Chi tiết Manga, Chương & Creator.
4. `etl_cdc` (M2): Kiểm duyệt JSON Schema Draft 2020-12 (`manga-reader-package:2.0`), Batch ETL cô lập lỗi, CDC Webhook & Tombstone guard.
5. `reader_engine` (M4): Mở chương (`START`/`CONTINUE`/`SELECT`), Manifest trang ký HMAC, Hybrid MangaDex/Pillow fallback, `reader_progress`, `reader_settings`, Valid view threshold.
6. `reading_status_history` (M3 & M4): Enum trạng thái đọc `READING`/`PLAN_TO_READ`/`COMPLETED`/`ON_HOLD`/`DROPPED`.
7. `ratings` (M4): Chấm điểm 1–10 (bắt buộc đã mở chương), lịch sử `CREATE/UPDATE/REMOVE`, tính lại trung bình cộng.
8. `comments_reactions` (M5): Bình luận truyện/chương, reply 1 cấp, cờ Spoiler & Admin khóa cờ, lịch sử sửa bất biến, xóa mềm giữ khung, Reaction `LIKE/DISLIKE/null`.
9. `reading_lists` (M7 & M8): CRUD & Clone/Merge danh sách đọc riêng tư, đồng bộ nhiều list idempotent, trả `coverUrl` & `previewCovers` ký HMAC từ truyện bên trong (`null`/`[]` khi rỗng), tìm/lọc nội bộ không dấu và thống kê Metadata động.
10. `moderation_reporting` (M1, M4, M5, M6): Gửi báo cáo Account/Manga/Comment (rate-limit, chống tự report, cờ ignore future reports), hàng đợi & xử lý nguyên tử cho Admin (`AUTO_CLOSE` khi target thiếu).
11. `recommendations` (M3): 3 thuật toán Cosine trên vector tương tác & TF-IDF (`ITEM_BASED`, `USER_BASED`, `CONTENT_BASED`) + `POPULAR_FALLBACK`.
12. `admin_analytics` (M1 & M2): Nhật ký kiểm toán bất biến, thống kê hành vi Reader, thống kê tương tác kho truyện và đối soát bộ đếm `reconcile_counters`.

---

## 3. Danh mục Toàn bộ HTTP Endpoints (`/api/v1`)

Mọi route dưới đây được mount qua `api_v1_router` ([api/v1/router.py#L25-L36](../../apps/api/src/manga_reader/api/v1/router.py#L25-L36)) với tiền tố cấu hình `settings.api_prefix = "/api/v1"`.

### 3.1 Health & Observability (`api/v1/health.py`)

| Method | Path (`/api/v1...`) | Dependency Guard | Handler & Service | Vị trí |
|---|---|---|---|---|
| `GET` | `/health` | Public | `liveness_check` | [health.py#L42-L57](../../apps/api/src/manga_reader/api/v1/health.py#L42-L57) |
| `GET` | `/health/ready` | Public | `readiness_check` (DB + Cache + Storage check) | [health.py#L60-L102](../../apps/api/src/manga_reader/api/v1/health.py#L60-L102) |

### 3.2 Module `account_auth` (`modules/account_auth/`)

| Method | Path (`/api/v1...`) | Dependency Guard | Service Method | Vị trí |
|---|---|---|---|---|
| `POST` | `/auth/register` | Public | `AuthService.register` | [router.py#L101-L117](../../apps/api/src/manga_reader/modules/account_auth/presentation/router.py#L101-L117) |
| `POST` | `/auth/verify-otp` | Public | `AuthService.verify_otp` | [router.py#L120-L131](../../apps/api/src/manga_reader/modules/account_auth/presentation/router.py#L120-L131) |
| `POST` | `/auth/resend-otp` | Public | `AuthService.resend_otp` | [router.py#L134-L142](../../apps/api/src/manga_reader/modules/account_auth/presentation/router.py#L134-L142) |
| `POST` | `/auth/forgot-password` | Public | `AuthService.request_password_reset` | [router.py#L145-L156](../../apps/api/src/manga_reader/modules/account_auth/presentation/router.py#L145-L156) |
| `POST` | `/auth/verify-reset-otp` | Public | `AuthService.verify_password_reset_otp` | [router.py#L159-L167](../../apps/api/src/manga_reader/modules/account_auth/presentation/router.py#L159-L167) |
| `POST` | `/auth/reset-password` | Public | `AuthService.confirm_password_reset` | [router.py#L170-L185](../../apps/api/src/manga_reader/modules/account_auth/presentation/router.py#L170-L185) |
| `POST` | `/auth/login` | Public | `AuthService.login` (gắn cookie `mr_refresh_token`) | [router.py#L188-L205](../../apps/api/src/manga_reader/modules/account_auth/presentation/router.py#L188-L205) |
| `POST` | `/auth/refresh` | Cookie / Body | `AuthService.refresh_session` | [router.py#L208-L226](../../apps/api/src/manga_reader/modules/account_auth/presentation/router.py#L208-L226) |
| `POST` | `/auth/logout` | `get_authenticated_principal` | `AuthService.logout` (xóa cookie) | [router.py#L229-L242](../../apps/api/src/manga_reader/modules/account_auth/presentation/router.py#L229-L242) |
| `GET` | `/account/me` | `get_authenticated_principal` | `AuthService.get_profile` | [router.py#L245-L253](../../apps/api/src/manga_reader/modules/account_auth/presentation/router.py#L245-L253) |
| `GET` | `/accounts/{account_id}/profile` | `get_current_principal` | `AuthService.get_profile` | [router.py#L256-L265](../../apps/api/src/manga_reader/modules/account_auth/presentation/router.py#L256-L265) |
| `GET` | `/profiles/{username}` | `get_current_principal` | `AuthService.get_profile` | [router.py#L268-L277](../../apps/api/src/manga_reader/modules/account_auth/presentation/router.py#L268-L277) |
| `PATCH` | `/account/profile` | `get_authenticated_principal` | `AuthService.update_profile` | [router.py#L280-L298](../../apps/api/src/manga_reader/modules/account_auth/presentation/router.py#L280-L298) |
| `POST` | `/account/avatar` | `get_authenticated_principal` | `AuthService.update_avatar` (multipart + Pillow) | [router.py#L301-L314](../../apps/api/src/manga_reader/modules/account_auth/presentation/router.py#L301-L314) |
| `PUT` | `/account/password` | `get_authenticated_principal` | `AuthService.change_password` | [router.py#L317-L333](../../apps/api/src/manga_reader/modules/account_auth/presentation/router.py#L317-L333) |
| `GET` | `/admin/accounts` | `get_admin_principal` | `AuthService.admin_list_accounts` | [router.py#L336-L364](../../apps/api/src/manga_reader/modules/account_auth/presentation/router.py#L336-L364) |
| `GET` | `/admin/accounts/{account_id}` | `get_admin_principal` | `AuthService.get_profile` | [router.py#L367-L376](../../apps/api/src/manga_reader/modules/account_auth/presentation/router.py#L367-L376) |
| `POST` | `/admin/accounts/{account_id}/lock` | `get_admin_principal` | `AuthService.admin_lock_account` | [router.py#L379-L396](../../apps/api/src/manga_reader/modules/account_auth/presentation/router.py#L379-L396) |
| `POST` | `/admin/accounts/{account_id}/unlock` | `get_admin_principal` | `AuthService.admin_unlock_account` | [router.py#L399-L416](../../apps/api/src/manga_reader/modules/account_auth/presentation/router.py#L399-L416) |

### 3.3 Module `catalog_discovery` & `recommendations`

| Method | Path (`/api/v1...`) | Dependency Guard | Service Method | Vị trí |
|---|---|---|---|---|
| `GET` | `/tags` | Public | `CatalogDiscoveryService.list_tags` | [catalog/router.py#L25-L31](../../apps/api/src/manga_reader/modules/catalog_discovery/presentation/router.py#L25-L31) |
| `GET` | `/manga` | `get_current_principal` | `CatalogDiscoveryService.list_catalog` (25+ bộ lọc) | [catalog/router.py#L34-L109](../../apps/api/src/manga_reader/modules/catalog_discovery/presentation/router.py#L34-L109) |
| `GET` | `/manga/autocomplete` | Public | `CatalogDiscoveryService.autocomplete` | [catalog/router.py#L112-L119](../../apps/api/src/manga_reader/modules/catalog_discovery/presentation/router.py#L112-L119) |
| `GET` | `/manga/search` | Public | `CatalogDiscoveryService.search_manga` | [catalog/router.py#L122-L146](../../apps/api/src/manga_reader/modules/catalog_discovery/presentation/router.py#L122-L146) |
| `GET` | `/creators/search` | Public | `CatalogDiscoveryService.search_creators` | [catalog/router.py#L149-L157](../../apps/api/src/manga_reader/modules/catalog_discovery/presentation/router.py#L149-L157) |
| `GET` | `/creators/{creator_id}` | Public | `CatalogDiscoveryService.get_creator_detail` | [catalog/router.py#L160-L167](../../apps/api/src/manga_reader/modules/catalog_discovery/presentation/router.py#L160-L167) |
| `GET` | `/creators/{creator_id}/manga` | Public | `CatalogDiscoveryService.list_creator_manga` | [catalog/router.py#L170-L205](../../apps/api/src/manga_reader/modules/catalog_discovery/presentation/router.py#L170-L205) |
| `GET` | `/manga/{manga_id_or_slug}` | `get_current_principal` | `CatalogDiscoveryService.get_manga_detail` | [catalog/router.py#L208-L218](../../apps/api/src/manga_reader/modules/catalog_discovery/presentation/router.py#L208-L218) |
| `GET` | `/manga/{manga_id_or_slug}/chapters` | Public | `CatalogDiscoveryService.list_manga_chapters` | [catalog/router.py#L221-L241](../../apps/api/src/manga_reader/modules/catalog_discovery/presentation/router.py#L221-L241) |
| `GET` | `/manga/{manga_id}/recommendations` | Public | `RecommendationService.recommend_for_manga` (`ITEM_BASED`/`CONTENT_BASED`) | [rec/router.py#L19-L32](../../apps/api/src/manga_reader/modules/recommendations/presentation/router.py#L19-L32) |
| `GET` | `/recommendations/me` | `get_active_reader_principal` | `RecommendationService.recommend_user_based` | [rec/router.py#L35-L45](../../apps/api/src/manga_reader/modules/recommendations/presentation/router.py#L35-L45) |

### 3.4 Module `etl_cdc` & `manga_creator`

| Method | Path (`/api/v1...`) | Dependency Guard | Service Method | Vị trí |
|---|---|---|---|---|
| `GET` | `/admin/external-sources` | `get_admin_principal` | `EtlCdcService.list_external_sources` | [etl/router.py#L42-L48](../../apps/api/src/manga_reader/modules/etl_cdc/presentation/router.py#L42-L48) |
| `POST` | `/admin/etl-sync` | `get_admin_principal` | `EtlCdcService.create_and_execute_batch_job` (`202`) | [etl/router.py#L51-L63](../../apps/api/src/manga_reader/modules/etl_cdc/presentation/router.py#L51-L63) |
| `GET` | `/admin/etl-jobs` | `get_admin_principal` | `EtlCdcService.list_jobs` | [etl/router.py#L66-L86](../../apps/api/src/manga_reader/modules/etl_cdc/presentation/router.py#L66-L86) |
| `GET` | `/admin/etl-jobs/{job_id}` | `get_admin_principal` | `EtlCdcService.get_job_detail` | [etl/router.py#L89-L97](../../apps/api/src/manga_reader/modules/etl_cdc/presentation/router.py#L89-L97) |
| `POST` | `/admin/etl-job-items/{job_item_id}/retry` | `get_admin_principal` | `EtlCdcService.retry_job_item` (`202`) | [etl/router.py#L100-L113](../../apps/api/src/manga_reader/modules/etl_cdc/presentation/router.py#L100-L113) |
| `POST` | `/admin/manga/{manga_id}/cdc/enable` | `get_admin_principal` | `EtlCdcService.toggle_cdc(..., True)` | [etl/router.py#L116-L126](../../apps/api/src/manga_reader/modules/etl_cdc/presentation/router.py#L116-L126) |
| `POST` | `/admin/manga/{manga_id}/cdc/disable` | `get_admin_principal` | `EtlCdcService.toggle_cdc(..., False)` | [etl/router.py#L129-L139](../../apps/api/src/manga_reader/modules/etl_cdc/presentation/router.py#L129-L139) |
| `POST` | `/webhooks/cdc` | `X-Webhook-Signature` | `EtlCdcService.receive_cdc_event` (`202`) | [etl/router.py#L142-L152](../../apps/api/src/manga_reader/modules/etl_cdc/presentation/router.py#L142-L152) |
| `GET` | `/admin/manga` | `get_admin_principal` | `MangaLifecycleService.admin_list_manga` | [etl/router.py#L155-L178](../../apps/api/src/manga_reader/modules/etl_cdc/presentation/router.py#L155-L178) |
| `POST` | `/admin/manga/{manga_id}/hide` | `get_admin_principal` | `MangaLifecycleService.hide_manga` | [etl/router.py#L181-L194](../../apps/api/src/manga_reader/modules/etl_cdc/presentation/router.py#L181-L194) |
| `POST` | `/admin/manga/{manga_id}/show` | `get_admin_principal` | `MangaLifecycleService.show_manga` | [etl/router.py#L197-L213](../../apps/api/src/manga_reader/modules/etl_cdc/presentation/router.py#L197-L213) |
| `POST` | `/admin/manga/{manga_id}/delete` | `get_admin_principal` | `MangaLifecycleService.delete_manga` | [etl/router.py#L216-L229](../../apps/api/src/manga_reader/modules/etl_cdc/presentation/router.py#L216-L229) |

### 3.5 Module `reader_engine` & `reading_status_history`

| Method | Path (`/api/v1...`) | Dependency Guard | Service Method | Vị trí |
|---|---|---|---|---|
| `GET` | `/reader/open` | `get_current_principal` | `ReaderService.open_reader` | [reader/router.py#L60-L77](../../apps/api/src/manga_reader/modules/reader_engine/presentation/router.py#L60-L77) |
| `GET` | `/chapters/{chapter_id}/pages` | Public | `ReaderService.get_chapter_pages` | [reader/router.py#L80-L87](../../apps/api/src/manga_reader/modules/reader_engine/presentation/router.py#L80-L87) |
| `PUT` | `/reader/progress` | `get_active_reader_principal` | `ReaderService.upsert_progress` | [reader/router.py#L90-L108](../../apps/api/src/manga_reader/modules/reader_engine/presentation/router.py#L90-L108) |
| `GET` | `/reader/progress/{manga_id}` | `get_active_reader_principal` | `ReaderService.get_progress` | [reader/router.py#L111-L121](../../apps/api/src/manga_reader/modules/reader_engine/presentation/router.py#L111-L121) |
| `POST` | `/reader/view-session/{history_id}/complete` | `get_active_reader_principal` | `ReaderService.complete_view_session` | [reader/router.py#L124-L142](../../apps/api/src/manga_reader/modules/reader_engine/presentation/router.py#L124-L142) |
| `GET` | `/reader/settings` | `get_active_reader_principal` | `ReaderService.get_settings` | [reader/router.py#L145-L152](../../apps/api/src/manga_reader/modules/reader_engine/presentation/router.py#L145-L152) |
| `PUT` | `/reader/settings` | `get_active_reader_principal` | `ReaderService.update_settings` | [reader/router.py#L155-L171](../../apps/api/src/manga_reader/modules/reader_engine/presentation/router.py#L155-L171) |
| `GET` | `/reader/history` | `get_active_reader_principal` | `ReaderService.get_history` | [reader/router.py#L174-L195](../../apps/api/src/manga_reader/modules/reader_engine/presentation/router.py#L174-L195) |
| `PUT` | `/manga/{manga_id}/reading-status` | `get_active_reader_principal` | `ReaderService.set_reading_status` | [reader/router.py#L198-L211](../../apps/api/src/manga_reader/modules/reader_engine/presentation/router.py#L198-L211) |
| `DELETE` | `/manga/{manga_id}/reading-status` | `get_active_reader_principal` | `ReaderService.clear_reading_status` | [reader/router.py#L214-L224](../../apps/api/src/manga_reader/modules/reader_engine/presentation/router.py#L214-L224) |
| `GET` | `/account/me/reading-status` | `get_active_reader_principal` | `ReaderService.list_my_reading_statuses` | [reader/router.py#L227-L234](../../apps/api/src/manga_reader/modules/reader_engine/presentation/router.py#L227-L234) |
| `GET` | `/media/{bucket}/{object_key:path}` | HMAC Signature (`exp`, `sig`) | `stream_signed_media` (+ Lazy Hybrid Fallback) | [reader/router.py#L378-L416](../../apps/api/src/manga_reader/modules/reader_engine/presentation/router.py#L378-L416) |

### 3.6 Module `ratings` & `comments_reactions`

| Method | Path (`/api/v1...`) | Dependency Guard | Service Method | Vị trí |
|---|---|---|---|---|
| `GET` | `/manga/{manga_id}/rating` | `get_current_principal` | `RatingService.get_manga_rating` | [ratings/router.py#L29-L39](../../apps/api/src/manga_reader/modules/ratings/presentation/router.py#L29-L39) |
| `PUT` | `/manga/{manga_id}/rating` | `get_active_reader_principal` | `RatingService.upsert_rating` | [ratings/router.py#L42-L55](../../apps/api/src/manga_reader/modules/ratings/presentation/router.py#L42-L55) |
| `DELETE` | `/manga/{manga_id}/rating` | `get_active_reader_principal` | `RatingService.remove_rating` | [ratings/router.py#L58-L68](../../apps/api/src/manga_reader/modules/ratings/presentation/router.py#L58-L68) |
| `GET` | `/account/me/rating-history` | `get_active_reader_principal` | `RatingService.list_my_rating_history` | [ratings/router.py#L71-L92](../../apps/api/src/manga_reader/modules/ratings/presentation/router.py#L71-L92) |
| `GET` | `/comments` | `get_current_principal` | `CommentService.list_comments` | [comments/router.py#L43-L75](../../apps/api/src/manga_reader/modules/comments_reactions/presentation/router.py#L43-L75) |
| `POST` | `/comments` | `get_active_reader_principal` | `CommentService.create_comment` | [comments/router.py#L78-L96](../../apps/api/src/manga_reader/modules/comments_reactions/presentation/router.py#L78-L96) |
| `PUT` | `/comments/{comment_id}` | `get_active_reader_principal` | `CommentService.edit_comment` | [comments/router.py#L99-L116](../../apps/api/src/manga_reader/modules/comments_reactions/presentation/router.py#L99-L116) |
| `GET` | `/comments/{comment_id}/history` | Public | `CommentService.get_edit_history` | [comments/router.py#L119-L126](../../apps/api/src/manga_reader/modules/comments_reactions/presentation/router.py#L119-L126) |
| `DELETE` | `/comments/{comment_id}` | `get_active_reader_principal` | `CommentService.soft_delete_comment` | [comments/router.py#L129-L139](../../apps/api/src/manga_reader/modules/comments_reactions/presentation/router.py#L129-L139) |
| `PUT` | `/comments/{comment_id}/reaction` | `get_active_reader_principal` | `CommentService.set_reaction` | [comments/router.py#L142-L158](../../apps/api/src/manga_reader/modules/comments_reactions/presentation/router.py#L142-L158) |

### 3.7 Module `reading_lists`

| Method | Path (`/api/v1...`) | Dependency Guard | Service Method | Vị trí |
|---|---|---|---|---|
| `GET` | `/lists/my` | `get_active_reader_principal` | `ReadingListService.list_my_lists` | [lists/router.py#L42-L50](../../apps/api/src/manga_reader/modules/reading_lists/presentation/router.py#L42-L50) |
| `POST` | `/lists` | `get_active_reader_principal` | `ReadingListService.create_list` | [lists/router.py#L53-L65](../../apps/api/src/manga_reader/modules/reading_lists/presentation/router.py#L53-L65) |
| `POST` | `/lists/quick-create` | `get_active_reader_principal` | `ReadingListService.create_list` | [lists/router.py#L68-L80](../../apps/api/src/manga_reader/modules/reading_lists/presentation/router.py#L68-L80) |
| `POST` | `/lists/merge-create` | `get_active_reader_principal` | `ReadingListService.merge_create_list` | [lists/router.py#L83-L100](../../apps/api/src/manga_reader/modules/reading_lists/presentation/router.py#L83-L100) |
| `GET` | `/lists/{list_id}` | `get_active_reader_principal` | `ReadingListService.get_list_detail` | [lists/router.py#L103-L113](../../apps/api/src/manga_reader/modules/reading_lists/presentation/router.py#L103-L113) |
| `PATCH` | `/lists/{list_id}` | `get_active_reader_principal` | `ReadingListService.update_list` | [lists/router.py#L116-L133](../../apps/api/src/manga_reader/modules/reading_lists/presentation/router.py#L116-L133) |
| `DELETE` | `/lists/{list_id}` | `get_active_reader_principal` | `ReadingListService.delete_list` | [lists/router.py#L136-L144](../../apps/api/src/manga_reader/modules/reading_lists/presentation/router.py#L136-L144) |
| `GET` | `/lists/{list_id}/manga` | `get_active_reader_principal` | `ReadingListService.list_items_filtered` | [lists/router.py#L147-L183](../../apps/api/src/manga_reader/modules/reading_lists/presentation/router.py#L147-L183) |
| `DELETE` | `/lists/{list_id}/manga/{manga_id}` | `get_active_reader_principal` | `ReadingListService.remove_item_from_list` | [lists/router.py#L186-L199](../../apps/api/src/manga_reader/modules/reading_lists/presentation/router.py#L186-L199) |
| `GET` | `/lists/{list_id}/metadata-stats` | `get_active_reader_principal` | `ReadingListService.get_metadata_stats` | [lists/router.py#L202-L212](../../apps/api/src/manga_reader/modules/reading_lists/presentation/router.py#L202-L212) |
| `GET` | `/manga/{manga_id}/my-list-memberships` | `get_active_reader_principal` | `ReadingListService.get_manga_memberships` | [lists/router.py#L215-L228](../../apps/api/src/manga_reader/modules/reading_lists/presentation/router.py#L215-L228) |
| `PUT` | `/manga/{manga_id}/my-list-memberships` | `get_active_reader_principal` | `ReadingListService.sync_manga_memberships` | [lists/router.py#L231-L250](../../apps/api/src/manga_reader/modules/reading_lists/presentation/router.py#L231-L250) |

### 3.8 Module `moderation_reporting` & `admin_analytics`

| Method | Path (`/api/v1...`) | Dependency Guard | Service Method | Vị trí |
|---|---|---|---|---|
| `POST` | `/reports/account` | `get_active_reader_principal` | `ModerationReportingService.submit_account_report` | [moderation/router.py#L52-L68](../../apps/api/src/manga_reader/modules/moderation_reporting/presentation/router.py#L52-L68) |
| `POST` | `/reports/manga` | `get_active_reader_principal` | `ModerationReportingService.submit_manga_report` | [moderation/router.py#L71-L88](../../apps/api/src/manga_reader/modules/moderation_reporting/presentation/router.py#L71-L88) |
| `POST` | `/reports/comment` | `get_active_reader_principal` | `ModerationReportingService.submit_comment_report` | [moderation/router.py#L91-L107](../../apps/api/src/manga_reader/modules/moderation_reporting/presentation/router.py#L91-L107) |
| `GET` | `/admin/reports` | `get_admin_principal` | `ModerationReportingService.admin_list_reports` | [moderation/router.py#L110-L137](../../apps/api/src/manga_reader/modules/moderation_reporting/presentation/router.py#L110-L137) |
| `GET` | `/admin/reports/{report_id}` | `get_admin_principal` | `ModerationReportingService.admin_get_report_detail` | [moderation/router.py#L140-L148](../../apps/api/src/manga_reader/modules/moderation_reporting/presentation/router.py#L140-L148) |
| `POST` | `/admin/reports/{report_id}/resolve` | `get_admin_principal` | `ModerationReportingService.admin_resolve_report` | [moderation/router.py#L151-L169](../../apps/api/src/manga_reader/modules/moderation_reporting/presentation/router.py#L151-L169) |
| `GET` | `/account/me/reading-statistics` | `get_authenticated_principal` | `AdminAnalyticsService.get_reader_statistics` | [analytics/router.py#L24-L34](../../apps/api/src/manga_reader/modules/admin_analytics/presentation/router.py#L24-L34) |
| `GET` | `/admin/activity-logs` | `get_admin_principal` | `AdminAnalyticsService.query_activity_logs` | [analytics/router.py#L37-L60](../../apps/api/src/manga_reader/modules/admin_analytics/presentation/router.py#L37-L60) |
| `GET` | `/admin/accounts/{account_id}/activity-logs` | `get_admin_principal` | `AdminAnalyticsService.query_activity_logs` | [analytics/router.py#L63-L89](../../apps/api/src/manga_reader/modules/admin_analytics/presentation/router.py#L63-L89) |
| `GET` | `/admin/accounts/{account_id}/reading-statistics` | `get_admin_principal` | `AdminAnalyticsService.get_reader_statistics` | [analytics/router.py#L92-L105](../../apps/api/src/manga_reader/modules/admin_analytics/presentation/router.py#L92-L105) |
| `GET` | `/admin/manga/statistics` | `get_admin_principal` | `AdminAnalyticsService.get_manga_interaction_statistics` | [analytics/router.py#L108-L119](../../apps/api/src/manga_reader/modules/admin_analytics/presentation/router.py#L108-L119) |
| `POST` | `/admin/reconcile` | `get_admin_principal` | `AdminAnalyticsService.reconcile_counters` | [analytics/router.py#L122-L129](../../apps/api/src/manga_reader/modules/admin_analytics/presentation/router.py#L122-L129) |

---

## 4. Từ điển 47 Bảng Nghiệp vụ & 3 Bảng Hệ thống (`QL_DocTruyen`)

Trên SQL Server 2022 (`QL_DocTruyen`), `sys.tables WHERE is_ms_shipped = 0` hiện có **50 bảng** (`47` bảng ORM khai báo trong `models_auth.py`, `models_catalog.py`, `models_reader_social.py` + 3 bảng hạ tầng `alembic_version`, `schema_foundation_metadata`, `sysdiagrams`). Kiểu `GUID` & `UTCDateTime` ([orm/types.py#L15-L70](../../apps/api/src/manga_reader/infrastructure/orm/types.py#L15-L70)) cùng các cột `Unicode`/`UnicodeText` bảo đảm tương thích đồng thời SQL Server (`UNIQUEIDENTIFIER`, `DATETIME2`, `NVARCHAR` hỗ trợ đầy đủ tiếng Việt NFC) và SQLite test/dev.

### 4.1 Nhóm Tài khoản, Phiên, Nhật ký & Outbox (`models_auth.py` — 7 bảng)

| Bảng | ORM Class & Dòng | Khóa & Cột trọng yếu |
|---|---|---|
| `accounts` | `AccountModel` ([models_auth.py#L26-L53](../../apps/api/src/manga_reader/infrastructure/orm/models_auth.py#L26-L53)) | PK `account_id`; Unique `username`, `email`; `status` (`PENDING_VERIFICATION`/`ACTIVE`/`LOCKED`), `failed_login_attempts`, `locked_at`, `lock_reason` |
| `readers` | `ReaderModel` ([models_auth.py#L56-L70](../../apps/api/src/manga_reader/infrastructure/orm/models_auth.py#L56-L70)) | PK/FK `account_id`; `display_name`, `avatar_bucket`, `avatar_object_key`, `bio`, `birth_date`, `is_birth_date_public` |
| `admins` | `AdminModel` ([models_auth.py#L73-L82](../../apps/api/src/manga_reader/infrastructure/orm/models_auth.py#L73-L82)) | PK/FK `account_id`; Unique `admin_code`; `role_level` |
| `user_sessions` | `UserSessionModel` ([models_auth.py#L85-L101](../../apps/api/src/manga_reader/infrastructure/orm/models_auth.py#L85-L101)) | PK `session_id`; Unique `refresh_token_hash`; `expires_at`, `revoked_at`, `revoke_reason` (`LOGOUT`/`PASSWORD_CHANGE`/`PASSWORD_RESET`/`ACCOUNT_LOCK`/`TOKEN_REUSE`) |
| `account_status_histories` | `AccountStatusHistoryModel` ([models_auth.py#L104-L122](../../apps/api/src/manga_reader/infrastructure/orm/models_auth.py#L104-L122)) | PK `history_id`; `action_type` (`LOCK`/`UNLOCK`), `reason`, bảo vệ bởi trigger `51010` |
| `activity_logs` | `ActivityLogModel` ([models_auth.py#L125-L142](../../apps/api/src/manga_reader/infrastructure/orm/models_auth.py#L125-L142)) | PK `log_id`; `event_type`, `target_type`, `target_id`, `ip_address`, `details_json`, bất biến tuyệt đối (`INSTEAD OF UPDATE, DELETE` `51011`) |
| `outbox_events` | `OutboxEventModel` ([models_auth.py#L145-L165](../../apps/api/src/manga_reader/infrastructure/orm/models_auth.py#L145-L165)) | PK `event_id`; Unique `idempotency_key`; `status` (`PENDING`/`PROCESSED`/`FAILED`), `payload_json` |

### 4.2 Nhóm Kho Truyện, Media, Chương & ETL/CDC (`models_catalog.py` — 24 bảng)

| Bảng | ORM Class & Dòng | Mục đích & Bất biến chính |
|---|---|---|
| `media_objects` | `MediaObjectModel` ([models_catalog.py#L30-L58](../../apps/api/src/manga_reader/infrastructure/orm/models_catalog.py#L30-L58)) | Định danh media chuẩn `(bucket, object_key)` (`ADR-018`), kích thước, MD5/SHA256, `gc_status` (`ACTIVE`/`PENDING_GC`/`DELETED`) |
| `mangas` | `MangaModel` ([models_catalog.py#L61-L123](../../apps/api/src/manga_reader/infrastructure/orm/models_catalog.py#L61-L123)) | Bảng lõi truyện: `pool_manga_id`, `slug`, `mangadex_id`, `publication_status`, `content_rating`, `publication_demographic`, `visibility_status`, `deletion_status`, `is_cdc_enabled`, `is_syncing`, `ignore_all_reports`, `total_views`, `average_rating` |
| `manga_deletion_tombstones` | `MangaDeletionTombstoneModel` ([models_catalog.py#L126-L136](../../apps/api/src/manga_reader/infrastructure/orm/models_catalog.py#L126-L136)) | PK `pool_manga_id`; ngăn webhook CDC tái tạo truyện đã xóa (`ADR-011`) |
| `manga_alt_titles` | `MangaAltTitleModel` ([models_catalog.py#L139-L151](../../apps/api/src/manga_reader/infrastructure/orm/models_catalog.py#L139-L151)) | Tên phụ đa ngôn ngữ (`language_code` + `alternative_title` + `display_order`) |
| `creators`, `creator_biographies`, `creator_links`, `manga_creators` | ([models_catalog.py#L154-L198](../../apps/api/src/manga_reader/infrastructure/orm/models_catalog.py#L154-L198)) | Danh mục Tác giả/Họa sĩ, tiểu sử đa ngôn ngữ, mạng xã hội và liên kết `(manga_id, creator_id, role IN ('author','artist'))` |
| `tags`, `tag_names`, `manga_tags` | ([models_catalog.py#L201-L243](../../apps/api/src/manga_reader/infrastructure/orm/models_catalog.py#L201-L243)) | Hệ thống 4 nhóm Tag (`genre`, `theme`, `format`, `content`, `other`) và quan hệ N-N |
| `manga_links`, `manga_cover_arts` | ([models_catalog.py#L246-L276](../../apps/api/src/manga_reader/infrastructure/orm/models_catalog.py#L246-L276)) | Liên kết ngoài an toàn & thư viện Cover Art từng tập kèm `volume`, `locale`, `media_id` |
| `manga_stats`, `manga_stats_languages` | ([models_catalog.py#L279-L302](../../apps/api/src/manga_reader/infrastructure/orm/models_catalog.py#L279-L302)) | Đếm chương/trang/dung lượng đã xuất khẩu và bảng tra nhanh ngôn ngữ chương theo truyện |
| `manga_lineage`, `manga_content_vectors`, `manga_moderation_logs` | ([models_catalog.py#L305-L349](../../apps/api/src/manga_reader/infrastructure/orm/models_catalog.py#L305-L349)) | Theo dõi `pool_revision`, vector TF-IDF cho Content-based Recommendation và log `HIDE`/`SHOW`/`DELETE` |
| `chapters`, `chapter_pages` | ([models_catalog.py#L352-L415](../../apps/api/src/manga_reader/infrastructure/orm/models_catalog.py#L352-L415)) | Chương sắp xếp tất định bằng `chapter_numeric` (`DECIMAL(18,6)`), `volume`, `language`, `pages_revision`, và trang `1..N` (`page_uid`) |
| `etl_jobs`, `etl_job_items`, `manga_sync_subscriptions`, `cdc_events` | ([models_catalog.py#L418-L534](../../apps/api/src/manga_reader/infrastructure/orm/models_catalog.py#L418-L534)) | Quản lý job Batch Import v2.0, kiểm checksum, đăng ký CDC per-manga và hàng đợi khử trùng lặp event webhook |

### 4.3 Nhóm Độc giả, Tương tác, Kiểm duyệt & Lists (`models_reader_social.py` — 16 bảng)

| Bảng | ORM Class & Dòng | Mục đích & Bất biến chính |
|---|---|---|
| `reader_settings` | `ReaderSettingsModel` ([models_reader_social.py#L26-L50](../../apps/api/src/manga_reader/infrastructure/orm/models_reader_social.py#L26-L50)) | Chế độ mặc định (`VERTICAL_WEBTOON`/`SINGLE_PAGE`/`DOUBLE_PAGE`), hướng (`LTR`/`RTL`), co giãn (`FIT_WIDTH`/`FIT_HEIGHT`/`ORIGINAL`), `preload_page_count` (mặc định 3) |
| `reader_progress` | `ReaderProgressModel` ([models_reader_social.py#L53-L75](../../apps/api/src/manga_reader/infrastructure/orm/models_reader_social.py#L53-L75)) | PK kép `(reader_account_id, manga_id)`: lưu điểm đọc tiếp chính xác (`chapter_id`, `page_number`, `page_uid`, `client_sequence`) tách rời bảng lịch sử (`ADR-001`) |
| `reading_status_records` | `ReadingStatusRecordModel` ([models_reader_social.py#L78-L98](../../apps/api/src/manga_reader/infrastructure/orm/models_reader_social.py#L78-L98)) | Unique `(reader_account_id, manga_id)`: 1 trong 5 trạng thái đọc cá nhân |
| `reading_histories` | `ReadingHistoryModel` ([models_reader_social.py#L101-L119](../../apps/api/src/manga_reader/infrastructure/orm/models_reader_social.py#L101-L119)) | Nhật ký append-only mỗi lần mở chương, `reading_duration_seconds`, `is_valid_view` kích hoạt trigger đếm view |
| `ratings`, `rating_histories` | ([models_reader_social.py#L122-L156](../../apps/api/src/manga_reader/infrastructure/orm/models_reader_social.py#L122-L156)) | Điểm `1..10`, cờ `is_removed`, lịch sử `CREATE/UPDATE/REMOVE` |
| `comments`, `comment_edit_histories`, `comment_reactions` | ([models_reader_social.py#L159-L229](../../apps/api/src/manga_reader/infrastructure/orm/models_reader_social.py#L159-L229)) | Cây bình luận 1 cấp, check constraint `spoiler_lock_invariant`, ảnh chụp chỉnh sửa kèm `previous_is_spoiler`, phản ứng duy nhất mỗi `(reader, comment)` |
| `reports`, `account_reports`, `manga_reports`, `comment_reports`, `report_action_histories` | ([models_reader_social.py#L232-L322](../../apps/api/src/manga_reader/infrastructure/orm/models_reader_social.py#L232-L322)) | Mô hình kế thừa bảng cha-con cho 3 loại report + snapshot bất biến + lịch sử xử lý (`ADMIN`/`SYSTEM`) |
| `reading_lists`, `list_items` | ([models_reader_social.py#L325-L362](../../apps/api/src/manga_reader/infrastructure/orm/models_reader_social.py#L325-L362)) | Danh sách đọc riêng tư độc quyền, duy nhất `normalized_name` per owner, đếm `item_count` |

---

## 5. Chỉ mục Tối ưu Hóa (`IX_*`) & 10 T-SQL Triggers trên SQL Server

### 5.1 Covering Indexes tăng tốc truy vấn thực tế (`QL_DocTruyen`)

Kết quả truy vấn trực tiếp từ `sys.indexes` trên SQL Server 2022 xác nhận hệ thống đã được đánh các chỉ mục then chốt sau (bên cạnh các index FK/Unique chuẩn từ ORM):

| Bảng | Tên Index | Cấu trúc cột (Keys) | Mục đích tối ưu |
|---|---|---|---|
| `mangas` | `IX_mangas_sort_updated` | `(visibility_status, deletion_status, latest_chapter_at DESC, updated_at DESC, manga_id)` | Phân trang 2 pha mặc định theo cập nhật mới nhất không cần sort bảng lớn |
| `mangas` | `IX_mangas_sort_views` | `(visibility_status, deletion_status, total_views DESC, manga_id)` | Phân trang nhanh theo lượt xem cao nhất (`VIEWS_DESC`) & Recommendation loader |
| `mangas` | `IX_mangas_sort_rating` | `(visibility_status, deletion_status, average_rating DESC, total_views DESC, manga_id)` | Xếp hạng Top Rated không quét toàn bảng |
| `mangas` | `IX_mangas_sort_created` | `(visibility_status, deletion_status, created_at DESC, manga_id)` | Mục `"Recently Added"` trên HomePage & Explore |
| `mangas` | `IX_mangas_sort_title` | `(visibility_status, deletion_status, title ASC, manga_id)` | Sắp xếp bảng chữ cái `TITLE_ASC` / `TITLE_DESC` |
| `mangas` | `IX_mangas_filter` | `(visibility_status, publication_status, original_language, year)` | Lọc kết hợp trạng thái xuất bản, ngôn ngữ gốc, năm phát hành |
| `manga_stats_languages` | `IX_manga_stats_languages_lang` | `(language_code, manga_id)` | Lọc truyện có chương tiếng `vi`/`en` trong sub-millisecond không cần quét bảng `chapters` |
| `chapters` | `IX_chapters_manga_volume` | `(manga_id, volume, chapter_numeric)` | Gom nhóm và lọc chương theo Volume / `chapter_numeric` trên trang chi tiết |
| `reports` | `IX_reports_filter` | `(report_type, status, created_at DESC)` | Hàng đợi Moderation Reports lọc mặc định `PENDING` mới nhất trước |

### 5.2 Toàn bộ 10 T-SQL Triggers cưỡng chế quy tắc nghiệp vụ (`sys.triggers`)

| Tên Trigger | Bảng & Thời điểm | Mã lỗi (`THROW`) | Quy tắc nghiệp vụ bảo vệ |
|---|---|---|---|
| `trg_account_status_histories_guard` | `account_status_histories` (`AFTER INSERT`) | `51010` | Cấm khóa/mở khóa tài khoản nằm trong bảng `admins` (`UC-1.2`). |
| `trg_activity_logs_immutable` | `activity_logs` (`INSTEAD OF UPDATE, DELETE`) | `51011` | Bảo vệ nhật ký hoạt động bất biến 100%, không cho phép sửa hoặc xóa (`UC-1.4`). |
| `trg_ratings_require_reading_history` | `ratings` (`AFTER INSERT`) | `51012` | Chỉ cho phép chấm điểm nếu tài khoản đã có bản ghi mở chương trong `reading_histories` (`UC-4.7`). |
| `trg_ratings_recalculate_average` | `ratings` (`AFTER INSERT, UPDATE`) | — | Tự động tính lại `mangas.average_rating` loại trừ các bản ghi `is_removed = 1`. |
| `trg_reading_histories_count_valid_views` | `reading_histories` (`AFTER INSERT, UPDATE`) | — | Chỉ cộng `+1` vào `chapters.view_count` và `mangas.total_views` khi `is_valid_view` chuyển từ `0 -> 1` (tránh cộng đúp với Python khi chạy SQL Server). |
| `trg_comment_reactions_sync_counts` | `comment_reactions` (`AFTER INSERT, UPDATE, DELETE`) | — | Đồng bộ nguyên tử `comments.like_count` và `comments.dislike_count` (`UC-5.8`). |
| `trg_list_items_sync_item_count` | `list_items` (`AFTER INSERT, DELETE`) | — | Đồng bộ lại `reading_lists.item_count` và `updated_at` mỗi khi thêm/gỡ item (`UC-8.3`, `UC-8.4`). |
| `trg_account_reports_guard` | `account_reports` (`AFTER INSERT`) | `51014` | Ngăn độc giả tự report tài khoản của chính mình (`UC-6.6`). |
| `trg_comment_reports_guard` | `comment_reports` (`AFTER INSERT`) | `51015`, `51016` | Chặn tự report bình luận của mình (`51015`) và chặn gửi report trùng khi đã có report `PENDING` (`51016`) (`UC-5.7`). |
| `trg_mangas_cleanup_before_delete` | `mangas` (`INSTEAD OF DELETE`) | `51017` | Chặn xóa nếu `is_syncing = 1` (`51017`), tự đóng report `PENDING` thành `CLOSED`, gỡ FK `manga_reports`, xóa comments trước khi xóa `mangas` (`UC-2.4`). |
