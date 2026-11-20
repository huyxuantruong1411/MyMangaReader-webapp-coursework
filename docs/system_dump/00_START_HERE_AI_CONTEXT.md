# MangaLibrary System, Database & Storage Architecture Handoff

Generated: `2026-11-18T10:02:06.354235Z`

Tài liệu này mô tả đầy đủ toàn bộ hệ thống backend, kiến trúc database SQL Server, object storage MinIO, cách truy cập dữ liệu ảnh (không dump binary), API contracts và toàn bộ metadata đã trích xuất để bất kỳ AI agent hoặc kỹ sư nào đều có thể hiểu, kết nối trực tiếp hoặc dựng DB mới + chuyển dữ liệu sang môi trường mới (PostgreSQL / SQL Server / SQLite).

---

## 1. Index các file trong gói Dump (`system_dump/`)

| File | Mục đích sử dụng cho AI Agent / Developer |
|------|-----------------------------------------|
| `00_START_HERE_AI_CONTEXT.md` | Tài liệu tổng hợp kiến trúc, bảng, quan hệ, storage, lưu ý migration (đọc đầu tiên) |
| `01_connection_and_storage_access.json` | Thông tin kết nối SQL Server local, MinIO endpoint/credentials, FastAPI port, đường dẫn thư mục |
| `02_database_schema_full.json` | Chi tiết toàn bộ 31 bảng, cột, kiểu dữ liệu MSSQL & PostgreSQL, PK/FK/Index, thống kê enum & 5 dòng mẫu |
| `03_database_ddl_mssql.sql` | SQL Server DDL dựng mới từ live DB theo đúng thứ tự topological FK |
| `04_database_ddl_postgres.sql` | PostgreSQL 15+ DDL tương đương (UUID, TIMESTAMPTZ, BOOLEAN, TEXT, Indexes, FKs) |
| `05_backend_openapi_and_routes.json` | Full OpenAPI 3.1 JSON (102 endpoints, 31 schemas) + danh sách WebSocket & Auth config |
| `06_storage_inventory.json` | Danh sách toàn bộ 1,116 objects hiện có trên MinIO (key, byte size, proxy URL — không tải blob) |
| `data_manifest.json` | Mục lục các file `.jsonl.gz`, thứ tự nạp FK, cột bị loại (BLOB), SHA-256 checksum |
| `data_jsonl_gz/*.jsonl.gz` | Dữ liệu toàn bộ bảng (trừ binary image BLOB & `sysdiagrams`), nén gzip JSON Lines |
| `migrate_to_postgres.py` | Script mẫu nạp `data_jsonl_gz/` vào PostgreSQL theo đúng thứ tự bảng |
| `export_subset_tool.py` | Script chuẩn Python stdlib để trích xuất tập con (VD: chỉ manga có bìa MinIO) ra SQLite |

---

## 2. Kiến trúc hệ thống & Kết nối thực tế trên máy

### Backend (FastAPI + uv)
- **Thư mục**: `D:\work\Android\coursework\manga_backend` (chỉ dùng `uv`, virtualenv tại `manga_backend/.venv`)
- **Framework**: FastAPI + Uvicorn + SQLAlchemy 2.x Async (aioodbc)
- **Port API**: `http://0.0.0.0:8010` (Android Emulator trỏ vào `http://10.0.2.2:8010/`)
- **Auth**: JWT HS256 (`python-jose`), password hash `bcrypt`
- **Realtime**: WebSocket `/ws/chat/{room_id}?token=<jwt>`

### Database (Microsoft SQL Server)
- **Engine**: Microsoft SQL Server 2022 (RTM-GDR) (KB5132747) - 16.0.1220.3 (X64)  (Express Edition (64-bit))
- **Host / Port**: `desktop-hkipi1m:1433`
- **Database**: `MangaLibrary` (Schema: `dbo`, Collation: `SQL_Latin1_General_CP1_CI_AS`)
- **Driver**: `ODBC Driver 17 for SQL Server` (`mssql+aioodbc` trong app, `pyodbc` khi dump/migrate)
- **Thống kê**: ~**3,868,469** dòng dữ liệu không chứa BLOB (nén còn **245.71 MB** trong `data_jsonl_gz/`)

### Object Storage (MinIO — Image & Media Access)
- ⚠️ **Không dump file ảnh nhị phân** vì dung lượng lớn; thông tin truy cập đầy đủ:
- **Endpoint S3**: `http://localhost:9010` (SSL: `False`), **Console UI**: `http://localhost:9011`
- **Bucket**: `manga-media` | **Tổng objects**: `1116` (`1049.68 MB`)
- **Docker**: `manga_backend/services/minio/docker-compose.yml` (container `mangalibrary-minio`, script `minio.ps1`)
- **Thư mục lưu file trên host**: `D:\work\Android\coursework\manga_backend\services\minio\data`
- **Phân bổ prefix trong bucket**:
  - `avatars/`: 7 objects (0.04 MB)
  - `chat/`: 12 objects (14.64 MB)
  - `covers/`: 1097 objects (1035.0 MB)

### Quy tắc liên kết DB ↔ Storage / CDN
1. **Ảnh bìa Manga (`Covers`)**:
   - Bảng `dbo.Covers` có `68,787` dòng; trong đó `1,097` dòng trỏ tới MinIO (`url LIKE 'covers/%'`, VD `covers/<manga_id>/<cover_file>`), được FastAPI stream qua route `/api/v1/media/covers/...`.
   - `681` dòng trong `Covers` vẫn còn cột binary `image_data` cũ (`VARBINARY(MAX)` — đã loại khỏi dump JSONL). Ngoài ra còn có bảng legacy `dbo.MangaCover` (454 dòng binary BLOB) không còn được FastAPI ORM sử dụng.
   - Fallback ảnh bìa khi MinIO không có object: client/backend có thể dựng URL MangaDex CDN `https://uploads.mangadex.org/covers/{manga_id}/{fileName}` qua `/api/v1/proxy/image?url=...` hoặc trả ảnh PNG mặc định tại `/api/v1/media/fallback/cover.png`.
2. **Trang đọc truyện (`Chapter`)**:
   - Thử tìm trên MinIO prefix `chapters/<chapter_id>/` -> nếu chưa có thì gọi MangaDex At-Home API (`/api/v1/manga/{manga_id}/chapters/{chapter_id}`) -> fallback `/api/v1/media/fallback/page_<n>.png`.
3. **Avatar người dùng (`User`) & Ảnh Chat (`ChatMessage`)**:
   - `User.Avatar` / `User.AvatarObjectKey` -> `avatars/<user_id>.<ext>` -> `/api/v1/media/avatars/...`.
   - `ChatMessage.MediaUrl` -> `chat/<room_id>/<uuid>.jpg` -> `/api/v1/media/chat/...`.

---

## 3. Toàn bộ danh sách bảng DB theo Thứ tự Topological Nạp dữ liệu

| Level | Bảng | Số dòng | Reserved MB | PK | Vai trò / Ghi chú |
|-------|------|--------:|------------:|----|-------------------|
| 0 | `Manga` | 86,866 | 21.51 | `MangaId` | Active ORM |
| 0 | `MangaTopicAnalysis` | 72,945 | 9.57 | `MangaId` | Legacy/Unmapped ORM |
| 0 | `Covers` | 68,787 | 648.64 | `cover_id` | Active ORM |
| 0 | `Creator` | 49,937 | 6.08 | `CreatorId` | Active ORM |
| 0 | `MangaCovers` | 1,400 | 2.32 | `cover_id` | Legacy/Unmapped ORM |
| 0 | `User` | 614 | 0.32 | `UserId` | Active ORM |
| 0 | `MangaCover` | 454 | 489.33 | `MangaId, CoverId, FileName` | Legacy/Unmapped ORM |
| 0 | `Tag` | 76 | 0.07 | `TagId` | Active ORM |
| 1 | `Chapter` | 1,780,598 | 233.13 | `ChapterId` | Active ORM |
| 1 | `MangaTag` | 416,406 | 16.76 | `MangaId, TagId` | Active ORM |
| 1 | `MangaRelated` | 368,565 | 25.07 | `MangaId, RelatedId, Type` | Active ORM |
| 1 | `MangaLink` | 334,010 | 30.20 | `LinkId` | Active ORM |
| 1 | `MangaAltTitle` | 240,601 | 19.07 | `AltTitleId` | Active ORM |
| 1 | `MangaAvailableLanguage` | 118,027 | 4.38 | `LangId` | Active ORM |
| 1 | `CreatorRelationship` | 107,514 | 6.20 | `Id` | Active ORM |
| 1 | `MangaDescription` | 101,248 | 89.33 | `DescriptionId` | Active ORM |
| 1 | `MangaStatistics` | 86,866 | 7.88 | `StatisticId` | Active ORM |
| 1 | `UserMangaStatus` | 6,347 | 0.70 | `UserId, MangaId` | Active ORM |
| 1 | `Rating` | 5,295 | 0.57 | `RatingId` | Active ORM |
| 1 | `List` | 20 | 0.07 | `ListId` | Active ORM |
| 1 | `ChatRoom` | 4 | 0.07 | `RoomId` | Active ORM |
| 1 | `UserPresence` | 3 | 0.07 | `UserId` | Active ORM |
| 1 | `Friendship` | 1 | 0.07 | `UserId, FriendId` | Active ORM |
| 2 | `ReadingHistory` | 15,307 | 1.95 | `HistoryId` | Active ORM |
| 2 | `Comment` | 4,972 | 1.63 | `CommentId` | Active ORM |
| 2 | `ListFollower` | 182 | 0.07 | `ListId, UserId` | Active ORM |
| 2 | `ListManga` | 137 | 0.07 | `ListId, MangaId` | Active ORM |
| 2 | `ChatMessage` | 38 | 0.07 | `MessageId` | Active ORM |
| 2 | `ChatRoomMember` | 10 | 0.07 | `RoomId, UserId` | Active ORM |
| 3 | `CommentReaction` | 1,195 | 0.20 | `ReactionId` | Active ORM |
| 3 | `Report` | 44 | 0.07 | `ReportId` | Active ORM |

---

## 4. Cảnh báo Toàn vẹn Tham chiếu khi tạo DB mới (RẤT QUAN TRỌNG)

Khi chuyển dữ liệu sang một DB mới (đặc biệt PostgreSQL có ràng buộc khóa ngoại nghiêm ngặt):
- `Covers.manga_id` không có FK trong MSSQL nhưng toàn vẹn 100% (số orphan = `0`).
- **`MangaRelated.RelatedId` có `330,813` ID tham chiếu tới Manga chưa nằm trong tập 86,866 bộ đã crawl** -> KHÔNG được tạo FK strict trên cột `RelatedId`.
- **`CreatorRelationship.RelatedId` có `8,218` orphan ID** -> giữ logic mềm không đặt FK strict trên `RelatedId`.
- **`MangaCovers.manga_id` (bảng legacy 1,400 dòng) có `560` orphan ID** -> bỏ qua hoặc không đặt FK strict.
- Cột nhị phân ảnh `Covers.image_data` (648 MB bảng) và `MangaCover.ImageData` (489 MB bảng) được loại bỏ khỏi `data_jsonl_gz/` để dump nhẹ & nhanh.

---

## 5. Phân bố giá trị Enum / Trạng thái chính trong DB

- **Manga.Status**: `completed`: 62,805, `ongoing`: 20,643, `cancelled`: 2,270, `hiatus`: 1,148
- **Manga.ContentRating**: `safe`: 67,441, `suggestive`: 11,009, `erotica`: 8,416
- **Manga.PublicationDemographic**: `<NULL>`: 39,435, `shounen`: 16,043, `seinen`: 13,467, `shoujo`: 11,886, `josei`: 6,035
- **Manga.OriginalLanguage**: `ja`: 69,189, `ko`: 8,243, `zh`: 5,838, `en`: 2,170, `id`: 472, `zh-hk`: 281, `fr`: 133, `th`: 81
- **Chapter.TranslatedLang_top15**: `en`: 773,744, `pt-br`: 212,981, `es-la`: 211,275, `vi`: 91,275, `ru`: 88,829, `fr`: 85,997, `pl`: 79,032, `id`: 48,057
- **Covers.locale_top15**: `ja`: 53,964, `ko`: 6,050, `zh`: 4,257, `en`: 2,622, `id`: 398, `zh-hk`: 305, `fr`: 214, `<NULL>`: 204
- **Tag.GroupName**: `theme`: 37, `genre`: 25, `format`: 12, `content`: 2
- **User.Role**: `user`: 611, `Admin`: 3
- **List.Visibility**: `public`: 14, `private`: 6
- **UserMangaStatus.Status**: `reading`: 6,229, `completed`: 73, `plan_to_read`: 45
- **Friendship.Status**: `pending`: 1
- **Report.Status**: `pending`: 34, `ignored`: 6, `resolved`: 4
- **ChatRoom.Type**: `direct`: 3, `group`: 1
- **ChatMessage.MessageType**: `image`: 20, `text`: 18
