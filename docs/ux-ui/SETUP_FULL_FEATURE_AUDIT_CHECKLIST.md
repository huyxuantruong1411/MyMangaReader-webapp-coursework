# Full Functional & SQL Server Compatibility Audit Checklist (`docs/agent-plan/Setup/00..14`)

Tài liệu này lập checklist đối chiếu toàn bộ yêu cầu chức năng trong 15 tài liệu đặc tả [Setup](file:///d:/work/TH-PTTK/QL-DocTruyen/docs/agent-plan/Setup/01_PRODUCT_SCOPE_AND_REQUIREMENTS.md), [Domain Rules](file:///d:/work/TH-PTTK/QL-DocTruyen/docs/agent-plan/Setup/03_DOMAIN_RULES_AND_STATE_MACHINES.md), [API Contracts](file:///d:/work/TH-PTTK/QL-DocTruyen/docs/agent-plan/Setup/10_API_CONTRACTS_AND_EVENTS.md) và [Test Strategy](file:///d:/work/TH-PTTK/QL-DocTruyen/docs/agent-plan/Setup/11_TEST_STRATEGY_ACCEPTANCE.md) với codebase thực tế (12 backend modules + React frontend) đang kết nối trực tiếp SQL Server `QL_DocTruyen` và MinIO `manga-media`.

---

## 1. Các lỗi tương thích SQL Server (`mssql+aioodbc`) & Trigger đã phát hiện và khắc phục

1. **Lỗi `.is_(False)` / `.is_(True)` sinh cú pháp `IS 0` / `IS 1` trên T-SQL (`ProgrammingError 102` — lỗi trực tiếp gây HTTP 500 ở `/manga/:slug`)**
   - **Nguyên nhân gốc:** SQLAlchemy 2.0 trên dialect `mssql+aioodbc` biên dịch `.is_(False)` / `.is_(True)` thành `col IS 0` / `col IS 1`, trong khi T-SQL chỉ chấp nhận `IS NULL` / `IS NOT NULL` cho toán tử `IS` và bắt buộc dùng `= 0` / `= 1` cho cột `BIT`.
   - **Khắc phục (14 vị trí trên 7 service):** Chuyển sang `== false()` / `== true()` (`from sqlalchemy import false, true`) để sinh `= 0` / `= 1` tương thích cả SQL Server, SQLite và PostgreSQL:
     - [catalog_discovery/application/service.py](file:///d:/work/TH-PTTK/QL-DocTruyen/apps/api/src/manga_reader/modules/catalog_discovery/application/service.py) (2 chỗ `RatingModel.is_removed`)
     - [comments_reactions/application/service.py](file:///d:/work/TH-PTTK/QL-DocTruyen/apps/api/src/manga_reader/modules/comments_reactions/application/service.py) (`CommentModel.is_deleted`)
     - [ratings/application/service.py](file:///d:/work/TH-PTTK/QL-DocTruyen/apps/api/src/manga_reader/modules/ratings/application/service.py) (3 chỗ `RatingModel.is_removed`)
     - [reader_engine/application/service.py](file:///d:/work/TH-PTTK/QL-DocTruyen/apps/api/src/manga_reader/modules/reader_engine/application/service.py) (`ReadingHistoryModel.is_valid_view`)
     - [reading_lists/application/service.py](file:///d:/work/TH-PTTK/QL-DocTruyen/apps/api/src/manga_reader/modules/reading_lists/application/service.py) (`RatingModel.is_removed`)
     - [recommendations/application/service.py](file:///d:/work/TH-PTTK/QL-DocTruyen/apps/api/src/manga_reader/modules/recommendations/application/service.py) (`RatingModel.is_removed`)
     - [admin_analytics/application/service.py](file:///d:/work/TH-PTTK/QL-DocTruyen/apps/api/src/manga_reader/modules/admin_analytics/application/service.py) (5 chỗ `RatingModel.is_removed` & `CommentModel.is_deleted`)

2. **Chia nguyên (`INT`) của `AVG(score)` trong T-SQL**
   - **Nguyên nhân:** `func.avg(RatingModel.score)` trên cột `INT` bị T-SQL làm tròn xuống số nguyên (`AVG(8, 9) = 8` thay vì `8.500`).
   - **Khắc phục:** Dùng `func.avg(cast(RatingModel.score, Numeric(9, 3)))` trong [ratings/application/service.py](file:///d:/work/TH-PTTK/QL-DocTruyen/apps/api/src/manga_reader/modules/ratings/application/service.py) và [admin_analytics/application/service.py](file:///d:/work/TH-PTTK/QL-DocTruyen/apps/api/src/manga_reader/modules/admin_analytics/application/service.py).

3. **Xóa truyện/chapter với `FK_reader_progress_chapters_chapter_id` (`ON DELETE NO ACTION`), giới hạn 2.100 tham số và `INSTEAD OF DELETE` trigger (`trg_mangas_cleanup_before_delete`)**
   - **Nguyên nhân:** SQL Server đặt `FK_reader_progress_chapters_chapter_id` là `ON DELETE NO ACTION` để tránh multiple cascade paths; `session.delete(manga)` kiểm tra `rowcount == 1` dễ gây `StaleDataError` với trigger `SET NOCOUNT ON`; `chapter_ids` truyền vào `.in_(...)` có thể vượt 2.100 tham số.
   - **Khắc phục:** Trong [manga_creator/application/service.py](file:///d:/work/TH-PTTK/QL-DocTruyen/apps/api/src/manga_reader/modules/manga_creator/application/service.py) và [etl_cdc/application/service.py](file:///d:/work/TH-PTTK/QL-DocTruyen/apps/api/src/manga_reader/modules/etl_cdc/application/service.py): dùng subquery cho `ChapterPageModel`, xóa `ReaderProgressModel` trước khi xóa chapter/manga, xóa `CommentModel` con trước gốc, sau đó `expunge(manga)` + Core `delete(MangaModel)`.

4. **Thứ tự flush `MangaStatsModel` trước `MangaStatsLanguageModel`**
   - **Khắc phục:** Gọi `await session.flush()` ngay sau `session.add(MangaStatsModel(...))` trong `_recompute_manga_stats` ([etl_cdc/application/service.py](file:///d:/work/TH-PTTK/QL-DocTruyen/apps/api/src/manga_reader/modules/etl_cdc/application/service.py)) để thỏa mãn `FK_manga_stats_languages_manga_stats`.

5. **Guard trùng report bình luận & tự report bình luận (`trg_comment_reports_guard` 51015/51016)**
   - **Khắc phục:** Kiểm tra ở tầng ứng dụng trong [moderation_reporting/application/service.py](file:///d:/work/TH-PTTK/QL-DocTruyen/apps/api/src/manga_reader/modules/moderation_reporting/application/service.py) để trả về mã chuẩn `422 SELF_REPORT_FORBIDDEN` và `409 DUPLICATE_REPORT` trước khi T-SQL trigger ném lỗi 500.

6. **Reset `client_sequence = 0` khi chuyển chapter trong Reader**
   - **Khắc phục:** Đặt lại `prog_row.client_sequence = 0` khi mở chapter mới bằng `SELECT` trong [reader_engine/application/service.py](file:///d:/work/TH-PTTK/QL-DocTruyen/apps/api/src/manga_reader/modules/reader_engine/application/service.py) để tránh lỗi `409 PROGRESS_CONFLICT` khi client bắt đầu sequence từ 1 ở chapter mới.

7. **Content-Based Recommendation cho toàn bộ 86.867 truyện & giới hạn `.in_(...)` 2.100 tham số**
   - **Khắc phục:**
     - [recommendations/application/service.py](file:///d:/work/TH-PTTK/QL-DocTruyen/apps/api/src/manga_reader/modules/recommendations/application/service.py): Tính on-the-fly TF-IDF vector từ tags/creators/demographic/title/description nếu truyện chưa có sẵn dòng trong `manga_content_vectors`.
     - [catalog_discovery/application/service.py](file:///d:/work/TH-PTTK/QL-DocTruyen/apps/api/src/manga_reader/modules/catalog_discovery/application/service.py), [comments_reactions/application/service.py](file:///d:/work/TH-PTTK/QL-DocTruyen/apps/api/src/manga_reader/modules/comments_reactions/application/service.py), [admin_analytics/application/service.py](file:///d:/work/TH-PTTK/QL-DocTruyen/apps/api/src/manga_reader/modules/admin_analytics/application/service.py): thay danh sách ID lớn trong `.in_(...)` bằng subquery hoặc giới hạn batch `<= 1500`.

---

## 2. Checklist đối chiếu toàn bộ yêu cầu từ `docs/agent-plan/Setup/00..14`

### Module 1 & Module 6 — Tài khoản, Xác thực, Bảo mật & Quản trị tài khoản (`account_auth`, `UC-1.1..1.5`, `UC-6.1..6.6`)

| ID | Yêu cầu | Endpoint / Thành phần | Bảng / Trigger liên quan |
|---|---|---|---|
| AUTH-001..005 | Đăng ký, chuẩn hóa email/username, băm Argon2id | `POST /api/v1/auth/register` | `accounts`, `readers`, `reader_settings` |
| AUTH-006..011 | Xác thực OTP 1 lần (TTL 120s trong cache), gửi lại OTP + cooldown | `POST /api/v1/auth/verify-otp`, `POST /api/v1/auth/resend-otp` | `accounts.status`, `outbox_events` |
| AUTH-012..020 | Đăng nhập email/username, khóa `PENDING_VERIFICATION`/`LOCKED`, refresh rotation, reuse revoke, logout | `POST /api/v1/auth/login`, `/refresh`, `/logout` | `user_sessions` |
| AUTH-021..026 | Admin khóa/mở khóa Reader kèm lý do, thu hồi toàn bộ session tức thì, cấm khóa Admin | `POST /api/v1/admin/accounts/{id}/lock`, `/unlock` | `account_status_histories`, `trg_account_status_histories_guard` (51010) |
| AUTH-027..035 | Hồ sơ công khai/riêng tư (ẩn DOB/email người khác), chặn spoof tên Admin/Mod/System, sanitize XSS, upload avatar kiểm tra MIME thực (`JPG/PNG/WebP`), đổi mật khẩu & thu hồi session khác | `GET /account/me`, `GET /accounts/{id}/profile`, `PATCH /account/profile`, `POST /account/avatar`, `PUT /account/password` | `readers`, `media_objects`, `user_sessions` |

### Module 2 & Module 4 — ETL/CDC Package v2.0 & Vòng đời Truyện (`etl_cdc`, `manga_creator`, `UC-2..2.5`)

| ID | Yêu cầu | Endpoint / Thành phần | Bảng / Trigger liên quan |
|---|---|---|---|
| ETL-001..018 | Danh sách package nguồn ngoài, Batch ETL cô lập lỗi per-manga (savepoint), kiểm tra JSON Schema v2.0 (`additionalProperties:false`), idempotent upsert qua `pool_manga_id` & `pool_chapter_id` | `GET /admin/external-sources`, `POST /admin/etl-sync`, `GET /admin/etl-jobs`, `GET /admin/etl-jobs/{id}`, `POST /admin/etl-job-items/{id}/retry` | `etl_jobs`, `etl_job_items`, `mangas`, `chapters`, `chapter_pages`, `manga_stats`, `manga_stats_languages` |
| ETL-019..026 | Bật/tắt CDC per manga, webhook idempotent (`external_event_id`), chặn revision cũ hơn, hỗ trợ `CHAPTER_DELETED`, chặn hồi sinh manga đã xóa bằng tombstone | `POST /admin/manga/{id}/cdc/enable`, `/disable`, `POST /webhooks/cdc` | `manga_sync_subscriptions`, `cdc_events`, `manga_deletion_tombstones` |
| UC-2.1..2.2 | Ẩn (`HIDDEN`) & Hiện (`PUBLIC`) truyện giữ nguyên dữ liệu lịch sử, hiện truyện KHÔNG tự bật lại CDC | `GET /admin/manga`, `POST /admin/manga/{id}/hide`, `/show` | `mangas`, `manga_moderation_logs`, `activity_logs` |
| UC-2.4 / ETL-023 | Xóa truyện an toàn cục bộ (không động upstream): chặn khi `is_syncing=1`, hủy CDC, tạo tombstone, gỡ FK report, cập nhật list count, đánh dấu media GC | `POST /admin/manga/{id}/delete` | `trg_mangas_cleanup_before_delete` (51017), `manga_deletion_tombstones`, `list_items` |

### Module 3 & Module 11 — Discovery, Tìm kiếm nâng cao, Creator & Gợi ý (`catalog_discovery`, `recommendations`, `UC-3..3.11`)

| ID | Yêu cầu | Endpoint / Thành phần | Bảng / Lưu ý |
|---|---|---|---|
| CAT-001..004 | Danh mục công khai chỉ trả `PUBLIC` + `ACTIVE`, sort đa tiêu chí, phân trang 3.620+ trang (`86.867` đầu truyện) | `GET /api/v1/manga`, `GET /api/v1/tags` | `mangas`, `manga_stats`, `tags`, `tag_names` |
| CAT-005..010 | Autocomplete (<=10 kết quả) & Search full-text/fuzzy không dấu trên tiêu đề chính + tên phụ (`manga_alt_titles`) | `GET /api/v1/manga/autocomplete`, `GET /api/v1/manga/search` | `mangas`, `manga_alt_titles`, `creators` |
| CAT-011..015 | Tìm kiếm Creator theo vai trò `author`/`artist` (không phân biệt hoa thường), trang chi tiết Creator + tác phẩm gộp dual-role không nhân đôi card | `GET /api/v1/creators/search`, `GET /api/v1/creators/{id}`, `GET /api/v1/creators/{id}/manga` | `creators`, `creator_biographies`, `creator_links`, `manga_creators` |
| CAT-016..021 | Bộ lọc nâng cao: `includeTags`/`excludeTags` xung đột trả `400`, `tagMode` (`GROUP_OR`, `ALL_AND`, `ANY_OR`), `demographic`, `status`, `contentRating` (`safe` loại trừ `unknown`), ngôn ngữ gốc & chapter, năm, số chapter exported, điểm, lượt xem, ngày thêm, `hideInStatus`, `hideInLists` | `GET /api/v1/manga`, [ExplorePage.tsx](file:///d:/work/TH-PTTK/QL-DocTruyen/apps/web/src/pages/ExplorePage.tsx) | `mangas`, `manga_tags`, `reading_status_records`, `list_items` |
| UC-3.5 | Chi tiết truyện đầy đủ (bìa, alt titles, creators, tags, links, exported stats, official volumes/chapters, rating, viewerState riêng) | `GET /api/v1/manga/{mangaIdOrSlug}`, `GET /api/v1/manga/{id}/chapters` | `mangas`, `ratings`, `reader_progress`, `reading_histories` |
| CAT-022..029 | 3 thuật toán gợi ý: `ITEM_BASED` CF, `CONTENT_BASED` TF-IDF (precomputed + on-the-fly fallback), `USER_BASED` ẩn danh (loại truyện đã `COMPLETED`/`DROPPED`/đã đọc) | `GET /api/v1/manga/{id}/recommendations`, `GET /api/v1/recommendations/me` | `manga_content_vectors`, `reading_histories`, `ratings`, `reading_status_records` |

### Module 4 & Module 6 (Reader) — Đọc truyện, Tiến độ, Lượt xem hợp lệ & Trạng thái đọc (`reader_engine`, `reading_status_history`, `UC-3.10..3.11`, `UC-4..4.6`)

| ID | Yêu cầu | Endpoint / Thành phần | Bảng / Trigger liên quan |
|---|---|---|---|
| READ-001..011 | Sắp xếp chapter theo `chapter_numeric`, `language`, `pool_chapter_id`; hỗ trợ `START` (đọc từ đầu), `CONTINUE` (tiếp tục đúng trang + fallback `page_uid`), `SELECT` (chọn chapter); dựng page manifest liên tục `1..N` + stream proxy ký HMAC (MinIO zero-copy / MangaDex fallback / lazy WebP) | `GET /reader/open`, `GET /chapters/{id}/pages`, `GET /media/{bucket}/{objectKey}` | `chapters`, `chapter_pages`, `media_objects`, `reader_progress` |
| READ-012..021 | Cài đặt `VERTICAL_WEBTOON`/`SINGLE_PAGE`/`DOUBLE_PAGE`, `LTR`/`RTL`, `FIT_WIDTH`/`FIT_HEIGHT`/`ORIGINAL`, `preloadPageCount`, lưu theo user & giữ đúng trang khi đổi layout | `GET /reader/settings`, `PUT /reader/settings`, [ReaderPage.tsx](file:///d:/work/TH-PTTK/QL-DocTruyen/apps/web/src/pages/ReaderPage.tsx) | `reader_settings` |
| READ-026..034 | Lưu tiến độ trang chính xác (`reader_progress`) tách biệt khỏi lịch sử mở chapter (`reading_histories`), từ chối sequence cũ (`409 PROGRESS_CONFLICT`), reset sequence khi chuyển chapter, ghi nhận lượt xem hợp lệ sau ngưỡng thời gian + chống spam F5 | `PUT /reader/progress`, `GET /reader/progress/{mangaId}`, `POST /reader/view-session/{id}/complete`, `GET /reader/history` | `reader_progress`, `reading_histories`, `trg_reading_histories_count_valid_views` |
| UC-3.10 | Trạng thái đọc cá nhân (`READING`, `PLAN_TO_READ`, `COMPLETED`, `ON_HOLD`, `DROPPED`; không chứa `RE_READING`), xóa trạng thái, trang Thư viện `/library` | `PUT /manga/{id}/reading-status`, `DELETE /manga/{id}/reading-status`, `GET /account/me/reading-status` | `reading_status_records`, [LibraryPage.tsx](file:///d:/work/TH-PTTK/QL-DocTruyen/apps/web/src/pages/LibraryPage.tsx) |

### Module 5 & Module 7 (Social) — Đánh giá & Bình luận (`ratings`, `comments_reactions`, `UC-4.7..4.8`, `UC-5..5.8`)

| ID | Yêu cầu | Endpoint / Thành phần | Bảng / Trigger liên quan |
|---|---|---|---|
| SOC-001..007 | Chỉ chấm điểm (`1..10`) sau khi đã mở ít nhất 1 chapter (`422 RATING_REQUIRES_READING`), ghi lịch sử `CREATE`/`UPDATE`/`REMOVE`, tính trung bình thập phân `DECIMAL(6,3)`, loại bỏ rating đã gỡ | `GET /manga/{id}/rating`, `PUT /manga/{id}/rating`, `DELETE /manga/{id}/rating`, `GET /account/me/rating-history` | `ratings`, `rating_histories`, `trg_ratings_require_reading_history` (51012), `trg_ratings_recalculate_average` |
| SOC-008..029 | Bình luận cấp truyện/chapter, reply 1 cấp, lọc & sort (`NEWEST`, `OLDEST`, `TOP_LIKED`/`TOP`), chỉnh sửa lưu lịch sử kèm trạng thái `previousIsSpoiler`, khóa spoiler bởi Admin không cho tự gỡ, xóa mềm giữ placeholder khi có reply, reaction `LIKE`/`DISLIKE`/`null` đồng bộ nguyên tử | `GET /comments`, `POST /comments`, `PUT /comments/{id}`, `GET /comments/{id}/history`, `DELETE /comments/{id}`, `PUT /comments/{id}/reaction` | `comments`, `comment_edit_histories`, `comment_reactions`, `trg_comment_reactions_sync_counts` |

### Module 7 & Module 8 (Lists) — Danh sách đọc riêng tư & Thống kê động (`reading_lists`, `UC-7..7.6`, `UC-8..8.5`)

| ID | Yêu cầu | Endpoint / Thành phần | Bảng / Trigger liên quan |
|---|---|---|---|
| LIST-001..013 | Danh sách riêng tư owner-only (người khác truy cập nhận `404`), trùng tên chuẩn hóa theo owner trả `409`, tìm kiếm trong My Lists, clone/merge nhiều list loại trùng truyện & cảnh báo nguồn rỗng (`409 EMPTY_SOURCE_LISTS_CONFIRMATION_REQUIRED`) | `GET /lists/my`, `POST /lists`, `POST /lists/quick-create`, `GET/PATCH/DELETE /lists/{id}`, `POST /lists/merge-create` | `reading_lists`, `list_items` |
| LIST-014..028 | Đồng bộ idempotent membership qua nhiều list, tìm/lọc trong từng list (title/creator/tag/status/readingStatus/sort), xóa item không ảnh hưởng history/rating, thống kê metadata động (`totalExportedChapters`, tỉ lệ tag, phân bố status, điểm TB các truyện có đánh giá, top creators, message rỗng chuẩn; tự bỏ qua truyện `HIDDEN`) | `GET /lists/{id}/manga`, `DELETE /lists/{id}/manga/{mangaId}`, `GET /lists/{id}/metadata-stats`, `GET/PUT /manga/{id}/my-list-memberships` | `reading_lists`, `list_items`, `trg_list_items_sync_item_count` |

### Module 1 & Module 9 & Module 12 — Báo cáo, Kiểm duyệt & Thống kê hệ thống (`moderation_reporting`, `admin_analytics`, `UC-1.4..1.7`, `UC-4.9`, `UC-5.7`, `UC-6.6`)

| ID | Yêu cầu | Endpoint / Thành phần | Bảng / Trigger liên quan |
|---|---|---|---|
| MOD-001..024 | Gửi report Account/Manga/Comment có snapshot, chặn tự report & trùng report pending, tôn trọng cờ `mangas.ignore_all_reports` (auto-`IGNORED`), queue Admin lọc theo type/status, tự đóng `CLOSED` nếu đối tượng không còn tồn tại, xử lý nguyên tử trong cùng transaction (`LOCK_ACCOUNT`, `HIDE_MANGA`, `DELETE_MANGA`, `DELETE_COMMENT`, `FORCE_SPOILER`, `IGNORE`) + ghi `report_action_histories` | `POST /reports/{account|manga|comment}`, `GET /admin/reports`, `GET /admin/reports/{id}`, `POST /admin/reports/{id}/resolve` | `reports`, `account_reports`, `manga_reports`, `comment_reports`, `report_action_histories`, `trg_account_reports_guard` (51014), `trg_comment_reports_guard` (51015/51016) |
| UC-1.4 / 1.5 / 2.5 | Nhật ký hoạt động bất biến (`INSTEAD OF UPDATE, DELETE` trigger), thống kê độc giả tách `chapterOpens` vs `validViews`, thống kê tương tác toàn cục/theo tag/manga, job đối soát bộ đếm | `GET /account/me/reading-statistics`, `GET /admin/accounts/{id}/reading-statistics`, `GET /admin/activity-logs`, `GET /admin/accounts/{id}/activity-logs`, `GET /admin/manga/statistics`, `POST /admin/reconcile` | `activity_logs`, `trg_activity_logs_immutable` (51011) |


---

## 3. Kết quả kiểm chứng thực tế

Tất cả các kiểm tra dưới đây được chạy sau lần chỉnh sửa code cuối cùng:

- **Lint & Format:** `pnpm lint` (`eslint` + `ruff`) và `pnpm format:check` (`prettier` + `ruff format --check`, 98 file Python) — **Pass**.
- **Typecheck:** `pnpm typecheck` (`tsc` cho `@manga-reader/contracts` & `@manga-reader/web` + `mypy src` strict trên 83 file Python) — **Pass**.
- **Contracts & Frontend Tests:**
  - `packages/contracts`: `vitest run` — **7 passed**.
  - `apps/web`: `vitest run` ([App.test.tsx](file:///d:/work/TH-PTTK/QL-DocTruyen/apps/web/tests/App.test.tsx)) — **14 passed** (lần chạy đầu gặp 1 worker timeout khi đang chạy nối tiếp sau typecheck; lần chạy lại đơn lẻ pass đủ 14/14).
- **Backend & Live SQL Server `QL_DocTruyen` + MinIO Tests:**
  - `uv --directory apps/api run pytest` — **26 passed in 179.71s**, bao gồm 2 test live trên `QL_DocTruyen` trong [test_live_mssql_optional.py](file:///d:/work/TH-PTTK/QL-DocTruyen/apps/api/tests/integration/test_live_mssql_optional.py):
    1. `test_live_mssql_catalog_detail_search_recs_and_minio_read_only`: kiểm tra danh mục 86.866+ truyện, tags, Advanced Search (`GROUP_OR`/`ALL_AND`, demographic, `safe != unknown`), autocomplete, search, creator, stream cover ký HMAC từ MinIO `manga-media`, `CONTENT_BASED`/`ITEM_BASED` recommendation, và xác nhận `GET /api/v1/manga/mysterious-disappearances` trả về `200 OK` (fix lỗi `Incorrect syntax near '0'`).
    2. `test_live_mssql_full_12_module_end_to_end_and_triggers`: kiểm tra end-to-end toàn bộ 12 module cùng tất cả trigger SQL Server (`trg_account_status_histories_guard`, `trg_activity_logs_immutable`, `trg_ratings_require_reading_history`, `trg_ratings_recalculate_average`, `trg_reading_histories_count_valid_views`, `trg_comment_reactions_sync_counts`, `trg_list_items_sync_item_count`, `trg_mangas_cleanup_before_delete`) và dọn sạch hoàn toàn dữ liệu kiểm thử tạm (`Leftover test accounts: 0`, `Total mangas: 86867`).
- **Production Build & Dump:** `pnpm build` và `pnpm dump:context` (174 source files) — **Pass**.
- **Live HTTP API Check (`http://127.0.0.1:8020` đang chạy nền):** `GET /api/v1/health` (`status: ok`) và `GET /api/v1/manga/mysterious-disappearances` (`200 OK`, `ratingCount: 128`, `averageRating: 7.688`, `exportedChapterCount: 255`).
- **Live Chrome Browser UI (`http://localhost:5173`):** Chưa chạy được bước kiểm tra trực tiếp trên Chrome trong phiên này do `chrome_devtools` MCP server chưa kết nối sau khi restart session.
