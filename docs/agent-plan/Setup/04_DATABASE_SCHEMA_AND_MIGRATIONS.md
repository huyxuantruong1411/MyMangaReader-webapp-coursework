# Database Schema, Constraints & Migration Blueprint

> Lab10 baseline schema/ERD; field/type/null/key/description rows below are extracted from source tables. The design is retained while gaps required by use cases/sequence/class diagrams are identified as migrations.

## 1. Persistence conventions

- SQL timestamps use UTC `DATETIME2(3)` as in Lab10.
- Internal UUIDs are distinct from source/pool IDs. Stable source IDs have unique constraints.
- `activity_logs.target_type/target_id` is polymorphic and intentionally has no direct FK.
- Avoid cascades that erase audit/report evidence. Use explicit deletion ordering.
- Enums documented as `VARCHAR` require DB CHECK constraints or reference tables.
- Derived counters require transaction-safe updates and reconciliation jobs.

## 2. Complete source table inventory (39 tables)

### accounts

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| account_id | UNIQUEIDENTIFIER | No | PK | Khóa chính tài khoản; dùng chung cho Reader và Admin. |
| username | VARCHAR(50) | No | Unique | Tên đăng nhập duy nhất. |
| email | VARCHAR(254) | No | Unique | Địa chỉ email đăng nhập và nhận thông báo/xác thực. OTP chỉ tồn tại trong RAM, không lưu tại CSDL. |
| password_hash | VARCHAR(255) | No |  | Mật khẩu đã băm; không lưu mật khẩu thô. |
| status | VARCHAR(24) | No |  | Trạng thái: PENDING_VERIFICATION, ACTIVE, LOCKED. |
| failed_login_attempts | INT | No |  | Số lần đăng nhập thất bại liên tiếp. |
| locked_at | DATETIME2(3) | Yes |  | Thời điểm khóa tài khoản gần nhất (UTC); NULL khi tài khoản không bị khóa. |
| locked_by_admin_account_id | UNIQUEIDENTIFIER | Yes | FK | Tài khoản Admin thực hiện lần khóa hiện tại; FK đến admins(account_id), NULL khi không bị khóa. |
| lock_reason | NVARCHAR(500) | Yes |  | Lý do khóa hiện tại; bắt buộc khi status = LOCKED và được xóa khi mở khóa. |
| last_status_change_at | DATETIME2(3) | No |  | Thời điểm thay đổi trạng thái gần nhất (UTC); không phải bảng lịch sử trạng thái. |
| created_at | DATETIME2(3) | No |  | Thời điểm tạo tài khoản (UTC). |

### readers

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| account_id | UNIQUEIDENTIFIER | No | PK, FK | Khóa chính đồng thời là khóa ngoại đến accounts(account_id). |
| display_name | NVARCHAR(100) | No |  | Tên hiển thị của Độc giả. |
| avatar_url | NVARCHAR(1000) | Yes |  | Đường dẫn avatar. |
| bio | NVARCHAR(MAX) | Yes |  | Tiểu sử ngắn hiển thị trên hồ sơ. |
| birth_date | DATE | Yes |  | Ngày sinh. |
| is_birth_date_public | BIT | No |  | Cờ cho phép hiển thị ngày sinh công khai. |

### admins

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| account_id | UNIQUEIDENTIFIER | No | PK, FK | Khóa chính đồng thời là khóa ngoại đến accounts(account_id). |
| admin_code | VARCHAR(30) | No | Unique | Mã định danh Quản trị viên. |
| role_level | VARCHAR(30) | No |  | Cấp độ/vai trò quản trị theo phân quyền ứng dụng. |

### user_sessions

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| session_id | UNIQUEIDENTIFIER | No | PK | Khóa chính phiên đăng nhập. |
| account_id | UNIQUEIDENTIFIER | No | FK | Tài khoản sở hữu phiên. |
| refresh_token_hash | VARCHAR(255) | No | Unique | Hash của refresh token (không lưu token thô); access JWT chỉ mang session_id/JTI để tra cứu trạng thái phiên. |
| ip_address | VARCHAR(45) | Yes |  | Địa chỉ IPv4/IPv6 tại thời điểm tạo phiên. |
| created_at | DATETIME2(3) | No |  | Thời điểm tạo phiên (UTC). |
| expires_at | DATETIME2(3) | No |  | Thời điểm hết hạn phiên. |
| revoked_at | DATETIME2(3) | Yes |  | Thời điểm logout hoặc bị thu hồi; NULL nếu chưa thu hồi. Phiên còn hiệu lực khi revoked_at IS NULL và expires_at > UTC hiện tại. |
| user_agent | NVARCHAR(500) | Yes |  | Thông tin trình duyệt/thiết bị ở thời điểm tạo phiên (nếu có). |
| revoke_reason | VARCHAR(30) | Yes |  | Lý do thu hồi: LOGOUT, ACCOUNT_LOCK, PASSWORD_CHANGE, ADMIN_REVOKE... |

### activity_logs

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| log_id | UNIQUEIDENTIFIER | No | PK | Khóa chính nhật ký. |
| account_id | UNIQUEIDENTIFIER | Yes | FK | Tài khoản gây ra hoạt động; NULL nếu là sự kiện hệ thống hoặc tài khoản đã được ẩn danh. |
| event_type | VARCHAR(80) | No |  | Loại sự kiện: LOGIN, COMMENT, RATING, REPORT, LIST_ITEM_ADDED, ACCOUNT_LOCK... |
| target_type | VARCHAR(60) | Yes |  | Loại đối tượng bị tác động; quan hệ đa hình. |
| target_id | NVARCHAR(128) | Yes |  | ID đối tượng bị tác động; lưu chuỗi để hỗ trợ nhiều kiểu ID. |
| ip_address | VARCHAR(45) | Yes |  | Địa chỉ IP nguồn. |
| details_json | NVARCHAR(MAX) | Yes |  | Thông tin bổ sung dạng JSON, ví dụ lý do khóa/ẩn hoặc dữ liệu thay đổi. |
| created_at | DATETIME2(3) | No |  | Thời điểm ghi log (UTC). |

### reader_settings

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| settings_id | UNIQUEIDENTIFIER | No | PK | Khóa chính cấu hình. |
| reader_account_id | UNIQUEIDENTIFIER | No | FK, Unique | Mỗi Độc giả có tối đa một bộ cấu hình. |
| display_mode | VARCHAR(30) | No |  | VERTICAL_WEBTOON, SINGLE_PAGE hoặc DOUBLE_PAGE. |
| reading_direction | VARCHAR(3) | No |  | Hướng đọc: LTR hoặc RTL. |
| fit_mode | VARCHAR(20) | No |  | Căn ảnh: FIT_WIDTH, FIT_HEIGHT hoặc ORIGINAL. |
| preload_page_count | INT | No |  | Số trang tải trước; sơ đồ lớp đặt mặc định 3. |
| updated_at | DATETIME2(3) | No |  | Thời điểm cập nhật cấu hình. |

### media_objects

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| media_id | BIGINT IDENTITY(1,1) | No | PK | Khóa chính nội bộ cho một đối tượng media. |
| bucket | VARCHAR(63) | No |  | Tên bucket lưu trữ; tương ứng ReaderMediaRef.bucket. |
| object_key | NVARCHAR(1024) | No |  | Đường dẫn object trong bucket; tương ứng ReaderMediaRef.object_key. |
| content_type | VARCHAR(100) | Yes |  | MIME type, ví dụ image/jpeg hoặc image/webp. |
| width | INT | Yes |  | Chiều rộng ảnh theo pixel. |
| height | INT | Yes |  | Chiều cao ảnh theo pixel. |
| file_size | BIGINT | No |  | Dung lượng file theo byte. |
| md5_hash | VARCHAR(32) | Yes |  | MD5 hex phục vụ nhận diện trùng lặp. |
| sha256 | VARCHAR(64) | Yes |  | SHA-256 hex phục vụ kiểm tra toàn vẹn. |
| created_at | DATETIME2(3) | No |  | Thời điểm ghi nhận tham chiếu media. |

### mangas

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| manga_id | UNIQUEIDENTIFIER | No | PK | Khóa chính nội bộ của bộ truyện. |
| pool_manga_id | VARCHAR(80) | No | Unique | ID ổn định từ contract manga-reader-package; khóa định danh pool. |
| slug | VARCHAR(255) | No | Unique | Slug duy nhất dùng cho URL bộ truyện. |
| source_manga_id | VARCHAR(255) | No |  | ID bộ truyện tại hệ thống quản lý nguồn; phục vụ truy vết ETL. |
| mangadex_id | VARCHAR(64) | Yes | Unique | MangaDex manga UUID nếu nguồn cung cấp. |
| title | NVARCHAR(500) | No |  | Tên hiển thị chính của bộ truyện; metadata lưu một giá trị tiếng Anh mặc định. |
| description | NVARCHAR(MAX) | No |  | Synopsis dạng plain text/Markdown; một nội dung tiếng Anh mặc định, không tách theo ngôn ngữ. |
| publication_status | VARCHAR(20) | No |  | ongoing, completed, hiatus, cancelled hoặc unknown. |
| content_rating | VARCHAR(20) | No |  | safe, suggestive, erotica, pornographic hoặc unknown; unknown không được xem là an toàn. |
| publication_demographic | VARCHAR(20) | No |  | shounen, shoujo, seinen, josei, kodomo hoặc unknown. |
| original_language | VARCHAR(16) | Yes |  | Ngôn ngữ gốc ISO 639-1, có thể chứa vùng như pt-br. |
| year | SMALLINT | Yes |  | Năm xuất bản đầu tiên (1800–2200 theo JSON Schema). |
| published_start_date | NVARCHAR(100) | Yes |  | Ngày bắt đầu xuất bản dạng chuỗi tự do hoặc ISO theo nguồn. |
| published_end_date | NVARCHAR(100) | Yes |  | Ngày kết thúc xuất bản dạng chuỗi tự do hoặc ISO theo nguồn. |
| official_volumes | INT | Yes |  | Số volume chính thức từ nguồn; không đồng nhất với volume đã export. |
| official_chapters | INT | Yes |  | Số chapter chính thức từ nguồn; không đồng nhất với chapter đã export. |
| primary_cover_media_id | BIGINT | Yes | FK | MediaRef của ảnh bìa chính; tham chiếu media_objects. |
| visibility_status | VARCHAR(10) | No |  | Trạng thái hiển thị: PUBLIC hoặc HIDDEN. |
| is_cdc_enabled | BIT | No |  | Đã đăng ký tự động nhận chapter mới qua CDC hay chưa. |
| is_syncing | BIT | No |  | Đang trong tiến trình đồng bộ; dùng chặn thao tác xóa xung đột. |
| ignore_all_reports | BIT | No |  | Cờ bỏ qua các report truyện tương lai theo thiết kế lớp. |
| total_views | BIGINT | No |  | Tổng lượt xem hợp lệ; bộ đếm tổng hợp từ reading_histories. |
| average_rating | DECIMAL(6,3) | No |  | Điểm trung bình hiện hành; tính từ các rating chưa bị gỡ. |
| content_feature_vector_json | NVARCHAR(MAX) | Yes |  | Vector đặc trưng nội dung dạng JSON array cho content-based recommendation. |
| created_at | DATETIME2(3) | No |  | Thời điểm tạo bản ghi truyện. |
| updated_at | DATETIME2(3) | No |  | Thời điểm metadata/truyện cập nhật gần nhất. |

### manga_alt_titles

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| alt_title_id | BIGINT IDENTITY(1,1) | No | PK | Khóa chính bản ghi tên thay thế. |
| manga_id | UNIQUEIDENTIFIER | No | FK | Bộ truyện sở hữu tên thay thế. |
| alternative_title | NVARCHAR(500) | No |  | Một tên thay thế; tương ứng từng phần tử trong alt_titles[]. |
| display_order | SMALLINT | No |  | Thứ tự giữ ổn định theo payload nguồn. |

### creators

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| creator_id | VARCHAR(100) | No | PK | ID canonical dạng chuỗi theo contract (MangaDex UUID hoặc UUIDv5). |
| slug | VARCHAR(255) | No | Unique | Slug URL của Author/Artist. |
| name | NVARCHAR(200) | No |  | Tên hiển thị của Creator. |
| mangadex_id | VARCHAR(64) | Yes | Unique | MangaDex author UUID nếu biết. |
| biography | NVARCHAR(MAX) | Yes |  | Tiểu sử Creator duy nhất, mặc định tiếng Anh (biography.en từ JSON contract); không tạo bản ghi theo từng ngôn ngữ. |

### creator_links

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| creator_id | VARCHAR(100) | No | PK, FK | Creator sở hữu liên kết. |
| platform | VARCHAR(100) | No | PK | Tên nền tảng, ví dụ twitter, pixiv, youtube, website. |
| url | NVARCHAR(1000) | No |  | URL liên kết tương ứng platform. |

### manga_creators

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| manga_id | UNIQUEIDENTIFIER | No | PK, FK | Manga được ghi credit. |
| creator_id | VARCHAR(100) | No | PK, FK | Author/Artist được ghi credit. |
| role | VARCHAR(10) | No | PK | Vai trò: author hoặc artist; cùng một Creator có thể có hai dòng theo hai vai trò. |

### tags

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| tag_id | BIGINT IDENTITY(1,1) | No | PK | Khóa chính nội bộ của tag. |
| slug | VARCHAR(120) | No | Unique | Slug ổn định và duy nhất; tương ứng ReaderTag.slug. |
| source_tag_id | VARCHAR(100) | Yes |  | ID tag tại hệ thống nguồn nếu có. |
| mangadex_id | VARCHAR(64) | Yes |  | MangaDex tag UUID nếu có. |
| tag_group | VARCHAR(20) | No |  | Nhóm tag: genre, theme, format, content hoặc other. |
| name | NVARCHAR(200) | No |  | Tên Tag mặc định tiếng Anh (name.en từ JSON contract); một Tag chỉ lưu một tên hiển thị. |

### manga_tags

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| manga_id | UNIQUEIDENTIFIER | No | PK, FK | Manga được gắn nhãn. |
| tag_id | BIGINT | No | PK, FK | Tag được gắn cho manga. |

### manga_links

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| manga_link_id | BIGINT IDENTITY(1,1) | No | PK | Khóa chính liên kết ngoài. |
| manga_id | UNIQUEIDENTIFIER | No | FK | Manga sở hữu liên kết. |
| site | NVARCHAR(100) | No |  | Nhãn website, ví dụ MangaDex hoặc MyAnimeList. |
| url | NVARCHAR(1000) | No |  | URL tuyệt đối do nguồn cung cấp. |

### manga_cover_arts

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| cover_art_id | BIGINT IDENTITY(1,1) | No | PK | Khóa chính bản ghi cover art. |
| manga_id | UNIQUEIDENTIFIER | No | FK | Manga sở hữu ảnh bìa. |
| cover_id | VARCHAR(100) | Yes |  | ID cover tại hệ thống nguồn nếu có. |
| volume | NVARCHAR(40) | Yes |  | Nhãn volume của cover. |
| description | NVARCHAR(500) | Yes |  | Mô tả cover art; dùng một giá trị mặc định tiếng Anh, không tạo bản ghi theo locale. |
| media_id | BIGINT | No | FK | MediaRef của cover; tham chiếu media_objects. |

### manga_stats

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| manga_id | UNIQUEIDENTIFIER | No | PK, FK | Khóa chính đồng thời FK; mỗi manga có tối đa một bản thống kê. |
| chapter_count | INT | No |  | Số chapter được export, không phải số chapter chính thức. |
| page_count | INT | No |  | Tổng số page trong các chapter đã export. |
| total_size_bytes | BIGINT | No |  | Tổng dung lượng các page đã export (byte). |
| updated_at | DATETIME2(3) | No |  | Thời điểm tính lại thống kê. |

### manga_stats_languages

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| manga_id | UNIQUEIDENTIFIER | No | PK, FK | Manga sở hữu thống kê ngôn ngữ. |
| language_code | VARCHAR(16) | No | PK | Mã ngôn ngữ chapter; mỗi ngôn ngữ chỉ xuất hiện một lần. |

### manga_lineage

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| manga_id | UNIQUEIDENTIFIER | No | PK, FK | Khóa chính đồng thời FK đến mangas. |
| pool_revision | INT | No |  | Tăng sau mỗi thay đổi tại pool. |
| source_metadata_revision | INT | No |  | Revision metadata phía nguồn. |
| manifest_sha256 | VARCHAR(64) | No |  | Hash nội dung tổng hợp của manga pool. |
| published_at | DATETIME2(3) | Yes |  | Thời điểm lần đầu publish vào pool (UTC). |
| updated_at | DATETIME2(3) | Yes |  | Thời điểm pool thay đổi gần nhất (UTC). |

### chapters

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| chapter_id | UNIQUEIDENTIFIER | No | PK | Khóa chính nội bộ chapter. |
| manga_id | UNIQUEIDENTIFIER | No | FK | Manga sở hữu chapter; pool_manga_id từ payload được resolve sang manga_id khi ETL. |
| pool_chapter_id | VARCHAR(100) | No | Unique | Stable ID của chapter trong contract; khóa ngoài để upsert. |
| source_chapter_id | VARCHAR(255) | No |  | ID chapter tại hệ thống quản lý nguồn. |
| chapter_number | NVARCHAR(50) | No |  | Số hiển thị dạng chuỗi; có thể là 10.5, Extra, Prologue... |
| chapter_numeric | DECIMAL(18,6) | No |  | Giá trị số dùng sắp xếp; mặc định 0 theo contract. |
| volume | NVARCHAR(40) | Yes |  | Nhãn volume; có thể NULL. |
| title | NVARCHAR(500) | No |  | Tiêu đề chapter. |
| language | VARCHAR(16) | No |  | Ngôn ngữ ISO 639-1, có thể kèm vùng; mặc định en. |
| scanlation_group | NVARCHAR(255) | Yes |  | Tên nhóm dịch nếu có. |
| publish_at | DATETIME2(3) | Yes |  | Thời điểm phát hành chapter (UTC). |
| source | VARCHAR(100) | No |  | Provider nguồn chapter, mặc định mangadex. |
| source_id | VARCHAR(255) | Yes |  | ID chapter tại provider gốc. |
| page_count | INT | No |  | Tổng page được đóng gói trong chapter. |
| total_size_bytes | BIGINT | No |  | Tổng dung lượng file page theo byte. |
| pages_revision | INT | No |  | Tăng khi danh sách/nội dung page thay đổi. |
| manifest_sha256 | VARCHAR(64) | No |  | Checksum manifest chapter. |
| view_count | BIGINT | No |  | Số lượt xem hợp lệ đã ghi nhận. |
| updated_at | DATETIME2(3) | Yes |  | Thời điểm chapter cập nhật theo payload. |
| created_at | DATETIME2(3) | No |  | Thời điểm chapter được nạp vào DB. |

### chapter_pages

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| page_id | BIGINT IDENTITY(1,1) | No | PK | Khóa chính nội bộ page. |
| chapter_id | UNIQUEIDENTIFIER | No | FK | Chapter chứa page. |
| page_uid | VARCHAR(120) | No | Unique | Stable page identifier theo contract; khóa nhận diện khi đồng bộ. |
| page_number | INT | No |  | Thứ tự đọc bắt đầu từ 1; contract yêu cầu thứ tự liên tục 1..N. |
| filename | NVARCHAR(255) | No |  | Tên file ảnh gốc được đóng gói. |
| media_id | BIGINT | No | FK | MediaRef của page; tham chiếu bucket/object_key trong media_objects. |

### etl_jobs

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| job_id | UNIQUEIDENTIFIER | No | PK | Khóa chính tiến trình ETL. |
| requested_by_admin_id | UNIQUEIDENTIFIER | Yes | FK | Quản trị viên yêu cầu; NULL đối với job chạy lịch/CDC. |
| job_type | VARCHAR(24) | No |  | INITIAL_IMPORT, BATCH_IMPORT, RESYNC, CDC_UPSERT hoặc DELETE. |
| status | VARCHAR(20) | No |  | QUEUED, RUNNING, SUCCEEDED, PARTIAL_FAILED, FAILED hoặc CANCELLED. |
| source_system | VARCHAR(100) | Yes |  | Tên Service/package source được chọn. |
| batch_size | INT | No |  | Số gói manga xử lý trong một batch. |
| retry_count | INT | No |  | Số lần retry ở cấp job. |
| created_at | DATETIME2(3) | No |  | Thời điểm tạo job. |
| started_at | DATETIME2(3) | Yes |  | Thời điểm bắt đầu xử lý. |
| completed_at | DATETIME2(3) | Yes |  | Thời điểm kết thúc. |
| error_summary | NVARCHAR(MAX) | Yes |  | Tóm tắt lỗi tổng hợp của job. |

### etl_job_items

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| job_item_id | UNIQUEIDENTIFIER | No | PK | Khóa chính từng item của job. |
| job_id | UNIQUEIDENTIFIER | No | FK | Job cha. |
| manga_id | UNIQUEIDENTIFIER | Yes | FK | Manga đã nạp thành công; NULL khi gói chưa được tạo hoặc bản ghi bị xóa. |
| source_manga_id | VARCHAR(255) | No |  | ID manga ở hệ thống nguồn. |
| pool_manga_id | VARCHAR(80) | Yes |  | Stable pool ID trong ReaderManga. |
| contract_name | VARCHAR(100) | No |  | Tên contract package. |
| contract_version | VARCHAR(20) | No |  | Phiên bản contract JSON. |
| exported_at | DATETIME2(3) | Yes |  | Thời điểm Service nguồn export package (UTC). |
| payload_sha256 | VARCHAR(64) | Yes |  | Checksum payload nhận được. |
| manifest_sha256 | VARCHAR(64) | Yes |  | Manifest hash của pool manga. |
| status | VARCHAR(16) | No |  | QUEUED, PROCESSING, SUCCEEDED, FAILED hoặc SKIPPED. |
| attempt_count | INT | No |  | Số lần thử xử lý item. |
| checksum_validated | BIT | Yes |  | Kết quả xác minh checksum. |
| started_at | DATETIME2(3) | Yes |  | Thời điểm bắt đầu xử lý item. |
| completed_at | DATETIME2(3) | Yes |  | Thời điểm hoàn tất item. |
| error_message | NVARCHAR(MAX) | Yes |  | Chi tiết lỗi schema/checksum/storage hoặc upsert. |

### manga_sync_subscriptions

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| subscription_id | UNIQUEIDENTIFIER | No | PK | Khóa chính đăng ký CDC. |
| manga_id | UNIQUEIDENTIFIER | No | FK, Unique | Manga được đăng ký tự động đồng bộ. |
| provider_subscription_key | VARCHAR(255) | Yes | Unique (nếu có) | ID subscription/webhook do Service nguồn trả về; giá trị NULL được phép lặp. |
| status | VARCHAR(16) | No |  | ACTIVE, PAUSED, CANCELLED hoặc FAILED. |
| subscribed_at | DATETIME2(3) | No |  | Thời điểm đăng ký CDC. |
| unsubscribed_at | DATETIME2(3) | Yes |  | Thời điểm hủy đăng ký. |
| last_event_at | DATETIME2(3) | Yes |  | Thời điểm nhận event CDC gần nhất. |
| updated_at | DATETIME2(3) | No |  | Thời điểm cập nhật subscription. |

### cdc_events

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| event_id | UNIQUEIDENTIFIER | No | PK | Khóa chính event CDC. |
| manga_id | UNIQUEIDENTIFIER | Yes | FK | Manga liên quan nếu đã resolve; NULL nếu manga đã bị xóa/chưa import. |
| external_event_id | VARCHAR(255) | No | Unique | ID sự kiện phía gửi để xử lý idempotency. |
| pool_chapter_id | VARCHAR(100) | Yes |  | ID chapter pool liên quan nếu event gắn với chapter. |
| event_type | VARCHAR(40) | No |  | Loại sự kiện: CHAPTER_CREATED, CHAPTER_UPDATED, CHAPTER_DELETED, MANGA_METADATA_UPDATED... |
| status | VARCHAR(16) | No |  | PENDING, PROCESSING, PROCESSED hoặc FAILED. |
| retry_count | INT | No |  | Số lần retry event. |
| payload_sha256 | VARCHAR(64) | Yes |  | Checksum payload event. |
| payload_json | NVARCHAR(MAX) | Yes |  | Payload CDC gốc hoặc phần dữ liệu cần xử lý; lưu JSON hợp lệ. |
| received_at | DATETIME2(3) | No |  | Thời điểm nhận event (UTC). |
| processed_at | DATETIME2(3) | Yes |  | Thời điểm xử lý thành công. |
| last_error | NVARCHAR(MAX) | Yes |  | Lỗi gần nhất khi xử lý event. |

### reading_status_records

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| record_id | UNIQUEIDENTIFIER | No | PK | Khóa chính bản ghi trạng thái. |
| reader_account_id | UNIQUEIDENTIFIER | No | FK | Độc giả cập nhật trạng thái. |
| manga_id | UNIQUEIDENTIFIER | No | FK | Bộ truyện được theo dõi trạng thái. |
| status | VARCHAR(20) | No |  | READING, PLAN_TO_READ, COMPLETED, ON_HOLD hoặc DROPPED. |
| updated_at | DATETIME2(3) | No |  | Thời điểm cập nhật trạng thái gần nhất. |

### reading_histories

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| history_id | UNIQUEIDENTIFIER | No | PK | Khóa chính một lần mở chapter. |
| reader_account_id | UNIQUEIDENTIFIER | No | FK | Độc giả mở chapter. |
| chapter_id | UNIQUEIDENTIFIER | No | FK | Chapter được mở; manga được suy ra qua chapter.manga_id. |
| opened_at | DATETIME2(3) | No |  | Thời điểm mở chapter (UTC). |
| reading_duration_seconds | INT | No |  | Thời lượng đọc được ghi nhận cho lần mở; không đại diện vị trí trang. |
| is_valid_view | BIT | No |  | Đánh dấu lượt xem hợp lệ sau khi đạt ngưỡng nghiệp vụ. |

### ratings

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| rating_id | UNIQUEIDENTIFIER | No | PK | Khóa chính bản ghi rating. |
| reader_account_id | UNIQUEIDENTIFIER | No | FK | Độc giả chấm điểm. |
| manga_id | UNIQUEIDENTIFIER | No | FK | Bộ truyện được chấm điểm. |
| score | INT | No |  | Điểm số nguyên dương; mức tối đa lấy theo cấu hình thang điểm của ứng dụng. |
| is_removed | BIT | No |  | Cờ gỡ rating; rating bị gỡ không được tính vào trung bình. |
| updated_at | DATETIME2(3) | No |  | Thời điểm tạo/cập nhật rating gần nhất. |

### rating_histories

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| rating_history_id | UNIQUEIDENTIFIER | No | PK | Khóa chính lịch sử. |
| rating_id | UNIQUEIDENTIFIER | No | FK | Rating hiện hành mà lịch sử thuộc về. |
| previous_score | INT | Yes |  | Điểm trước thay đổi; NULL khi CREATE. |
| new_score | INT | Yes |  | Điểm sau thay đổi; NULL khi REMOVE. |
| action_type | VARCHAR(10) | No |  | CREATE, UPDATE hoặc REMOVE. |
| recorded_at | DATETIME2(3) | No |  | Thời điểm ghi nhận thay đổi. |

### comments

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| comment_id | UNIQUEIDENTIFIER | No | PK | Khóa chính bình luận. |
| reader_account_id | UNIQUEIDENTIFIER | No | FK | Độc giả tạo bình luận. |
| manga_id | UNIQUEIDENTIFIER | No | FK | Bộ truyện chứa bình luận; luôn lưu để truy vấn theo trang manga. |
| chapter_id | UNIQUEIDENTIFIER | Yes | FK | Chapter nếu bình luận nằm trong một chapter; NULL nếu bình luận ở cấp manga. |
| content | NVARCHAR(MAX) | No |  | Nội dung bình luận; chỉ kiểm tra không rỗng. |
| is_spoiler | BIT | No |  | Cờ spoiler do người viết chọn. |
| is_spoiler_locked_by_admin | BIT | No |  | Admin có thể ép gắn cờ spoiler. |
| is_edited | BIT | No |  | Đã từng được chỉnh sửa hay chưa. |
| is_deleted | BIT | No |  | Xóa mềm bình luận. |
| like_count | INT | No |  | Bộ đếm Like; đồng bộ với comment_reactions. |
| dislike_count | INT | No |  | Bộ đếm Dislike; đồng bộ với comment_reactions. |
| created_at | DATETIME2(3) | No |  | Thời điểm tạo bình luận. |
| updated_at | DATETIME2(3) | No |  | Thời điểm cập nhật bình luận gần nhất. |

### comment_edit_histories

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| edit_id | UNIQUEIDENTIFIER | No | PK | Khóa chính lịch sử chỉnh sửa. |
| comment_id | UNIQUEIDENTIFIER | No | FK | Bình luận được chỉnh sửa. |
| editor_reader_account_id | UNIQUEIDENTIFIER | No | FK | Độc giả thực hiện chỉnh sửa. |
| previous_content | NVARCHAR(MAX) | No |  | Nội dung trước khi chỉnh sửa. |
| edited_at | DATETIME2(3) | No |  | Thời điểm chỉnh sửa. |

### comment_reactions

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| reaction_id | UNIQUEIDENTIFIER | No | PK | Khóa chính reaction. |
| reader_account_id | UNIQUEIDENTIFIER | No | FK | Độc giả tương tác. |
| comment_id | UNIQUEIDENTIFIER | No | FK | Bình luận được tương tác. |
| reaction_type | VARCHAR(8) | No |  | Loại cảm xúc: LIKE hoặc DISLIKE. |
| updated_at | DATETIME2(3) | No |  | Thời điểm tạo hoặc đổi reaction. |

### reports

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| report_id | UNIQUEIDENTIFIER | No | PK | Khóa chính report. |
| reporter_reader_account_id | UNIQUEIDENTIFIER | No | FK | Độc giả gửi báo cáo. |
| report_type | VARCHAR(10) | No |  | Loại report: ACCOUNT, MANGA hoặc COMMENT. |
| reason_category | NVARCHAR(100) | No |  | Danh mục lý do vi phạm/lỗi do người gửi chọn. |
| description | NVARCHAR(MAX) | Yes |  | Mô tả bổ sung của người gửi. |
| status | VARCHAR(10) | No |  | PENDING, RESOLVED, IGNORED hoặc CLOSED. |
| resolution_note | NVARCHAR(1000) | Yes |  | Ghi chú kết quả xử lý của Admin. |
| action_taken | VARCHAR(50) | Yes |  | Hành động thực tế: LOCK_ACCOUNT, HIDE_MANGA, DELETE_MANGA, DELETE_COMMENT, IGNORE... |
| resolved_by_admin_account_id | UNIQUEIDENTIFIER | Yes | FK | Admin xử lý report; FK không cascade để bảo toàn tham chiếu kiểm duyệt. |
| created_at | DATETIME2(3) | No |  | Thời điểm gửi report. |
| resolved_at | DATETIME2(3) | Yes |  | Thời điểm xử lý/đóng report. |

### account_reports

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| report_id | UNIQUEIDENTIFIER | No | PK, FK | Khóa chính đồng thời FK đến reports(report_id). |
| target_account_id | UNIQUEIDENTIFIER | Yes | FK | Tài khoản bị report; có thể NULL nếu tài khoản đã bị xóa. |
| target_account_snapshot | NVARCHAR(200) | No |  | Tên/định danh tài khoản tại thời điểm report để giữ bằng chứng. |

### manga_reports

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| report_id | UNIQUEIDENTIFIER | No | PK, FK | Khóa chính đồng thời FK đến reports(report_id). |
| target_manga_id | UNIQUEIDENTIFIER | Yes | FK | Manga bị report; NULL khi manga đã bị xóa. |
| target_chapter_id | UNIQUEIDENTIFIER | Yes | FK | Chapter bị report nếu có; NULL nếu report ở cấp manga hoặc chapter đã bị gỡ. |
| target_manga_snapshot | NVARCHAR(500) | No |  | Tên/ID manga tại thời điểm report. |
| target_chapter_snapshot | NVARCHAR(250) | Yes |  | Số chapter/tiêu đề tại thời điểm report. |
| ignore_future_reports | BIT | No |  | Cờ bỏ qua report tương lai đối với đối tượng theo nghiệp vụ. |

### comment_reports

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| report_id | UNIQUEIDENTIFIER | No | PK, FK | Khóa chính đồng thời FK đến reports(report_id). |
| target_comment_id | UNIQUEIDENTIFIER | Yes | FK | Comment bị report; NULL nếu comment đã bị xóa. |
| target_comment_snapshot | NVARCHAR(500) | No |  | Trích đoạn/định danh comment tại thời điểm gửi report. |

### report_action_histories

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| action_history_id | UNIQUEIDENTIFIER | No | PK | Khóa chính lịch sử kiểm duyệt. |
| report_id | UNIQUEIDENTIFIER | No | FK | Report được xử lý. |
| admin_account_id | UNIQUEIDENTIFIER | No | FK | Admin thực hiện hành động. |
| action_type | VARCHAR(50) | No |  | Hành động kiểm duyệt được chọn. |
| previous_status | VARCHAR(10) | No |  | Trạng thái trước thao tác. |
| new_status | VARCHAR(10) | No |  | Trạng thái sau thao tác. |
| action_note | NVARCHAR(1000) | Yes |  | Ghi chú xử lý. |
| performed_at | DATETIME2(3) | No |  | Thời điểm xử lý (UTC). |

### reading_lists

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| list_id | UNIQUEIDENTIFIER | No | PK | Khóa chính list đọc. |
| owner_reader_account_id | UNIQUEIDENTIFIER | No | FK | Độc giả sở hữu list. |
| name | NVARCHAR(100) | No |  | Tên hiển thị list đọc. |
| normalized_name | NVARCHAR(150) | No |  | Tên đã chuẩn hóa để chống trùng trong phạm vi một chủ sở hữu. |
| description | NVARCHAR(500) | Yes |  | Mô tả list. |
| item_count | INT | No |  | Bộ đếm số manga hiện có; cập nhật cùng transaction với list_items. |
| created_at | DATETIME2(3) | No |  | Thời điểm tạo list. |
| updated_at | DATETIME2(3) | No |  | Thời điểm cập nhật list. |

### list_items

| Field | Type | Null | Key | Source description |
|---|---|---:|---|---|
| list_item_id | UNIQUEIDENTIFIER | No | PK | Khóa chính mục list. |
| list_id | UNIQUEIDENTIFIER | No | FK | List chứa manga. |
| manga_id | UNIQUEIDENTIFIER | No | FK | Manga được thêm vào list. |
| added_at | DATETIME2(3) | No |  | Thời điểm thêm manga vào list. |

## 3. Domain relationships and cardinality

- `accounts` 1:0..1 `readers`, and 1:0..1 `admins`; one shared account identity.
- `accounts` 1:N `user_sessions`, 1:N `activity_logs` (logs may have null account for system/anonymous events).
- `readers` 1:0..1 `reader_settings`; 1:N `reading_status_records`, `reading_histories`, `ratings`, `comments`, `reports`, `reading_lists`.
- `mangas` 1:N `manga_alt_titles`, `manga_links`, `manga_cover_arts`, `chapters`, `list_items`; N:M `creators` through `manga_creators`; N:M `tags` through `manga_tags`; 1:0..1 `manga_stats` and `manga_lineage`.
- `chapters` 1:N `chapter_pages`; each `chapter_page` references `media_objects`. Cover and primary cover also reference `media_objects`.
- `etl_jobs` 1:N `etl_job_items`; `mangas` 1:0..1 `manga_sync_subscriptions`; `mangas` 1:N `cdc_events`.
- `reports` supertype 1:0..1 subtype row in exactly one of `account_reports`, `manga_reports`, `comment_reports`; 1:N `report_action_histories`.
- `comments` 1:N `comment_edit_histories`, `comment_reactions`; comment parent-child relationship appears in UML but is absent from source SQL table (migration below).
- `reading_lists` 1:N `list_items`; unique `(list_id,manga_id)`.

## 4. Required constraints/indexes

### 4.1 Identity and ownership

- Unique: `accounts.username`, `accounts.email`; normalize before insert and choose a case-insensitive collation/normalized columns.
- Unique: `mangas.pool_manga_id`, `mangas.slug`, optional unique `mangas.mangadex_id` where non-null.
- Unique: `chapters.pool_chapter_id`; `chapter_pages.page_uid`; `(chapter_id,page_number)`.
- Unique: `creators.slug`, optional `creators.mangadex_id`; `tags.slug`; `manga_creators(manga_id,creator_id,role)`; `manga_tags(manga_id,tag_id)`.
- Unique: `reader_settings.reader_account_id`; `reading_status_records(reader_account_id,manga_id)`; `ratings(reader_account_id,manga_id)`; `comment_reactions(reader_account_id,comment_id)`; `list_items(list_id,manga_id)`; `reading_lists(owner_reader_account_id,normalized_name)`.
- Unique: `user_sessions.refresh_token_hash`; `etl_job_items` should unique `(job_id,pool_manga_id)` when pool ID present; `manga_sync_subscriptions.manga_id`; `cdc_events.external_event_id`.
- Ensure subtype PK/FK and exactly-one-subtype invariant for reports through application transaction + optional deferred trigger/check design.

### 4.2 Performance indexes (proposed)

| Table | Index | Purpose |
|---|---|---|
| `activity_logs` | `(account_id, created_at DESC)`, `(event_type, created_at DESC)`, `(target_type,target_id)` | Admin log filters and audit lookup |
| `reports` | `(status, created_at DESC)`, `(report_type,status,created_at DESC)` | Moderation queue |
| `reading_histories` | `(reader_account_id, opened_at DESC)`, `(chapter_id, opened_at DESC)` | Recent activity, eligibility, views |
| `reading_status_records` | `(reader_account_id,status)`, `(manga_id,status)` | Profile stats/recommendation |
| `chapters` | `(manga_id,chapter_numeric,language,pool_chapter_id)` | Chapter list and latest chapter |
| `chapter_pages` | unique `(chapter_id,page_number)`, `(media_id)` | Ordered page manifest |
| `mangas` | `(visibility_status,updated_at DESC)`, optional fulltext on title/description | Public catalogue |
| `manga_alt_titles` | normalized title index + `manga_id` | Search alt titles |
| `creators` / `manga_creators` | normalized creator name; `(creator_id,role,manga_id)` | Creator search/works |
| `manga_tags` | `(tag_id,manga_id)` | Tag filters |
| `list_items` | `(list_id,added_at DESC)`, `(manga_id)` | List contents and stats |
| `comments` | `(manga_id,created_at DESC)`, `(chapter_id,created_at DESC)`, `(parent_comment_id,created_at)` after migration | Comment list/thread |
| `comment_reactions` | unique `(reader_account_id,comment_id)` + `(comment_id,reaction_type)` | Reactions/count reconciliation |
| `etl_job_items` | `(job_id,status)`, `(pool_manga_id)` | Job dashboard/upsert |
| `cdc_events` | `(status,received_at)`, unique external event ID | Retry consumer |

Index choice should be confirmed against query plans and actual DB engine. Avoid duplicate indexes covered by primary/unique indexes.

## 5. Mapping: JSON package v2.0 → SQL

| Package field | SQL destination | Mapping note |
|---|---|---|
| `manga.pool_manga_id` | `mangas.pool_manga_id` | Stable upsert key; internal `manga_id` generated locally |
| `manga.slug`, `source_manga_id`, `mangadex_id`, `title`, `description`, `status`, `content_rating`, `publication_demographic`, `original_language`, dates, year, official counts | `mangas` | Map `status`→`publication_status`; validate enum; keep original source values |
| `manga.alt_titles[]` | `manga_alt_titles` | Preserve array order in `display_order` |
| `manga.creators[]` | `creators`, `creator_links`, `manga_creators` | Upsert creator by canonical `creator_id`; row in `manga_creators` per `(manga,creator,role)`; localized biography concern in ADR |
| `manga.tags[]` | `tags`, `manga_tags` | Map group; localized label concern in ADR |
| `manga.links[]` | `manga_links` | `site` + absolute `url` |
| `manga.primary_cover` | `media_objects` + `mangas.primary_cover_media_id` | Store `bucket/object_key`, metadata and hashes; no raw URL |
| `manga.cover_arts[]` | `media_objects` + `manga_cover_arts` | Cover fields plus media FK |
| `manga.stats` | `manga_stats`, `manga_stats_languages` | Derived from exported chapters/pages; update atomically |
| `manga.lineage` | `manga_lineage` | Revision/hash/date state |
| root `chapters[]` / each `ReaderChapter` | `chapters` | Resolve `pool_manga_id` to internal manga; upsert by `pool_chapter_id` |
| `chapter.pages[]` | `chapter_pages` + `media_objects` | Page identity/order/filename/media; enforce contiguous numbering |
| `ReaderMediaRef` | `media_objects` | Bucket/key is object identity; deduplicate by unique `(bucket,object_key)` (recommended) |

## 6. Migrations required before production

### M-001 — reader progress snapshot (high priority)

Add `reader_progress` (or a semantically equivalent table):

```sql
reader_progress(
  reader_account_id UNIQUEIDENTIFIER NOT NULL,
  manga_id UNIQUEIDENTIFIER NOT NULL,
  chapter_id UNIQUEIDENTIFIER NOT NULL,
  page_number INT NOT NULL,
  page_uid VARCHAR(255) NULL,
  pages_revision INT NOT NULL,
  updated_at DATETIME2(3) NOT NULL,
  CONSTRAINT PK_reader_progress PRIMARY KEY(reader_account_id,manga_id),
  CONSTRAINT CK_reader_progress_page CHECK(page_number >= 1)
)
```

FKs to readers/mangas/chapters. Ensure chapter belongs to manga in service (or composite FK design). Lab8/Lab9 require continue at exact page, while `reading_histories` only captures chapter/duration. Do not add page position to `reading_histories` as this would conflate event history and current state.

### M-002 — comment replies

Add nullable `comments.parent_comment_id` FK to `comments.comment_id`, index it; require same `manga_id`, same `chapter_id` and only root comment as parent for MVP (one-level reply proposed). Keep `chapter_id` nullable for manga-level comments.

### M-003 — comment edit snapshot completeness

Add `previous_is_spoiler BIT` to `comment_edit_histories`. Lab10 snapshots previous content but edit flow permits editing spoiler, so without it version history is incomplete. Add previous lock state only if Admin can edit/force-lock and the audit UI needs a full snapshot.

### M-004 — media object uniqueness and lifecycle

- Unique `(bucket,object_key)`.
- Add `reference_count`/GC task, or compute references before delete. Do not delete an object while any cover/page points at it.
- Optional `deleted_at`, `gc_status`, `last_verified_at` for safe async garbage collection.

### M-005 — localized Creator and Tag display data

Current SQL schema stores only one English biography/name; package supports localized object maps (`biography:{lang:text}`, `tag.name:{lang:text}`, English required for tag). Choose one:
- recommended normalized `creator_biographies(creator_id,language,text)` and `tag_localizations(tag_id,language,name)`; or
- JSON columns with schema validation. Preserve all supported locales.

Do not silently drop non-English locale fields from the v2.0 package.

### M-006 — report ignore future source-of-truth

Keep `mangas.ignore_all_reports` as the authoritative global flag. Deprecate or reinterpret `manga_reports.ignore_future_reports` (e.g. as a snapshot of the Admin choice at time of that report), but never allow both fields to independently control future report handling.

### M-007 — manga delete lifecycle/tombstone

Add a deletion state/job table or `mangas.deletion_status` + `delete_job_id` to prevent in-flight CDC re-import. Ensure `pool_manga_id` tombstone survives long enough to reject old events. Preserve audit/report snapshots even after manga entity is removed.

### M-008 — account lock reason and status consistency

Enforce `status='LOCKED'` implies `locked_at`, `locked_by_admin_account_id`, `lock_reason` non-null; non-locked state clears current-lock fields. Add account subtype invariant so normal Reader cannot be mistaken for Admin. Use audit logs for past lock/unlock events.

### M-009 — rating score and current uniqueness

Check `score BETWEEN 1 AND 10`; unique `(reader_account_id,manga_id)`; preserve removed rating as one current row or use status; `rating_histories` holds all changes.

### M-010 — list item uniqueness/count integrity

Unique `(list_id,manga_id)`. Maintain `item_count` under same transaction; add periodic reconciliation query.

### M-011 — explicit history retention policy

Define FK/delete behavior for `reading_histories`, progress, ratings, comments and report evidence. Destructive manga deletion cannot cascade away report snapshots/audit. A tombstone may retain stable IDs without retaining removed story content.

## 7. Deletion and FK policy matrix

| Data | Hide manga | Delete manga | Delete list | Delete comment | Lock account |
|---|---|---|---|---|---|
| Manga metadata | Keep | Remove/tombstone locally | Keep | — | Keep |
| Chapter/pages | Keep | Remove locally + queue media GC | Keep | — | Keep |
| Reading status/history/progress | Keep | Product decision; preserve as unavailable historical reference or anonymize | Keep | — | Keep |
| Ratings/rating history | Keep | Preserve audit/stat snapshot or detach; do not silently cascade evidence | Keep | — | Keep |
| Comments | Keep | UC-2.4 says related comments deleted; preserve report snapshots/audit | Keep | Soft delete | Keep |
| Reports | Keep | Preserve target snapshot and report record | Keep | Preserve report snapshot | Keep |
| List membership | Keep, omit hidden from public list results | Remove membership per UC-2.4 | Cascade membership only | — | Keep |
| Media objects | Keep | Async GC only when unreferenced | Keep | — | Keep |
| Sessions | — | — | — | — | Revoke all |

## 8. Transaction boundary guidance

- Rating: rating upsert + history insert + average update.
- Comment edit: comment row + edit history.
- Comment delete: comment flags + audit/event.
- Comment reaction: reaction row + counters.
- List membership: all diff inserts/deletes + item_count.
- Clone/merge list: new list + distinct items + count.
- Report moderation: target action + report status + action history + activity log; external side effects via outbox.
- ETL: one transaction per manga item (or staged import then atomic publication), not one transaction for entire batch.
- CDC event: event state + target upsert in one idempotent transaction; storage upload may be staged outside then finalized.

## 9. Integrity/reconciliation jobs

Automate checks for:

- `reading_lists.item_count == COUNT(list_items)`.
- `comments.like_count == COUNT(reactions LIKE)` and dislike equivalent.
- `mangas.average_rating == AVG(active ratings)` within rounding tolerance.
- `mangas.total_views` equals the agreed sum of valid view events.
- `chapters.page_count == COUNT(chapter_pages)`; page numbers contiguous `1..N`.
- `manga_stats` matches exported chapters/pages; languages sorted/distinct.
- `manga_sync_subscriptions` active state matches `mangas.is_cdc_enabled`.
- Every report has exactly one subtype row; status and resolved-by fields are consistent.
- `accounts.status=LOCKED` lock metadata populated; non-locked lock metadata cleared.

## 10. DB implementation note

The type names in Lab10 look SQL Server-oriented (`UNIQUEIDENTIFIER`, `NVARCHAR`, `DATETIME2`, `IDENTITY`). If a different database is selected, map semantics rather than textually copying types. Preserve UUID behavior, Unicode, timestamp precision, partial unique indexes where nullable IDs exist, FK deletion rules, JSON constraints and transactions.
