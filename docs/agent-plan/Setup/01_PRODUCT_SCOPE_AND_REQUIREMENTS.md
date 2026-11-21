# Product Scope, Personas & Requirements Traceability

## 1. Product definition

Hệ thống là web application đọc manga/webtoon được nạp metadata và chapter package từ một service truyện bên ngoài. Hệ thống đọc không chịu trách nhiệm crawl hay xử lý ảnh nguồn; Admin quyết định manga nào được import. Ứng dụng cung cấp discovery, đọc chapter, tài khoản, lịch sử/tiến độ, đánh giá, bình luận, report/moderation và reading list.

### 1.1 Boundary

**In scope:**
- Reader web UI + API + database.
- Admin area và moderation workflow.
- Ingest package contract `manga-reader-package` v2.0.
- Background ETL, subscription CDC, message queue/retry.
- Object storage/CDN delivery cho cover và chapter images.
- Catalog/search/filter/recommendation.
- Auth/account/settings/session.
- Reader settings, reading history/progress.
- Rating/comment/reaction/report/list.
- Activity/audit logs và interaction statistics.

**Out of scope / upstream responsibility:**
- Crawl nguồn ngoài; chọn website crawling.
- Làm sạch ảnh nguồn, edit/upscale, watermark và đóng gói dữ liệu raw. Service upstream cung cấp package đã xử lý.
- Xóa nội dung nguồn trên service upstream khi Admin xóa khỏi reader app. Delete chỉ tác động dữ liệu cục bộ.

## 2. Personas and permission boundary

### 2.1 Reader (Độc giả)

Có thể:
- Duyệt manga `PUBLIC`, tìm kiếm, lọc, xem metadata và Creator.
- Mở chapter, đổi chế độ reader, lưu reader preferences.
- Khi đăng nhập: lưu tiến độ/reading history, trạng thái đọc, rating, comment, reaction, report, quản lý list.
- Xem hồ sơ công khai; xem trường riêng tư của chính mình.

Không thể:
- Xem log quản trị, email riêng tư của người khác, thông tin report nội bộ.
- Khóa/mở khóa user hoặc thực thi moderation.
- Xem/chỉnh sửa list của người khác theo canonical MVP.
- Comment/rate/report khi account đang `LOCKED` hoặc chưa `ACTIVE`.

### 2.2 Admin (Quản trị viên)

Có thể:
- Xem account detail, logs, reader statistics.
- Xem và xử lý report ACCOUNT/MANGA/COMMENT.
- Lock/unlock reader account, hide/show/delete manga.
- Chọn external package để ETL và bật/tắt CDC per manga.
- Xem interaction statistics.

Không mặc định được:
- Khóa Admin khác qua luồng khóa Reader; UC-1.2 nêu rõ từ chối target là Admin.
- Tùy tiện sửa/xóa audit log.
- Thực hiện thao tác hủy dữ liệu upstream.

`admins.role_level` có trong DB nhưng ma trận quyền chi tiết không được đặc tả. MVP đề xuất Admin có toàn bộ permission quản trị, đồng thời vẫn enforce role guard ở backend; mở rộng role granular bằng policy sau.

### 2.3 External Manga Service

Actor/service bên ngoài:
- Trả danh mục package sẵn sàng ETL.
- Trả package theo contract v2.0.
- Hỗ trợ đăng ký webhook/stream CDC per manga và gửi event khi chapter/metadata thay đổi.
- Không được quyền tự import manga vào Reader DB ngoài luồng Admin đã duyệt.

### 2.4 System actors

- ETL worker / CDC consumer / retry worker.
- Message Queue.
- Cache/Redis (OTP, rate limit, optional hot data).
- Object Storage (bucket/key).
- CDN (delivery pages/cover).
- Email queue/worker/provider.
- Search index / recommendation computation.

## 3. Main navigation and frames

### 3.1 Public/Reader navigation

- Home / Discovery.
- Manga list/search and advanced filters.
- Manga detail (metadata, chapters, comments, recommendations, read status, rating).
- Creator detail.
- Reader frame.
- Reader account: sign up, verify email, login, profile, settings, stats, reading history, rating history.
- My Lists: overview, list detail, create/edit/delete/clone, add/remove manga, stats.

### 3.2 Admin navigation

- Admin dashboard.
- Reader/account lookup + account detail.
- Activity logs + reader statistics.
- Reports: queue, detail, action panel.
- Manga management: list/detail, hide/show/delete, interaction stats.
- Source import: external sources, selection queue, ETL job status, per-item result, CDC state.

### 3.3 Screen states

Every data screen must implement at least:
- initial/loading/skeleton;
- populated;
- empty (first-use and zero result should have distinct copy where useful);
- error/retry;
- forbidden/ownership denied;
- not found/deleted/hidden;
- stale/refreshing when asynchronous job changes state.

## 4. Feature requirements by module

### Module 1 — Quản lý hoạt động độc giả

| UC | Requirement summary | Main rules / outcome |
|---|---|---|
| UC-1 | Hub quản lý hoạt động theo role | Reader chỉ self/public profile; Admin có log, lock/unlock, moderation |
| UC-1.1 | Xem chi tiết tài khoản | Public display name/avatar/bio; DOB theo privacy; email và thông tin nhạy cảm chỉ self/Admin |
| UC-1.2 | Khóa tài khoản | Chỉ Admin; chỉ account Reader active; bắt buộc reason; target Admin bị từ chối; revoke all sessions; email + audit |
| UC-1.3 | Mở khóa tài khoản | Chỉ Admin; target đang locked; bắt buộc note/reason; log actor + email; có câu cooldown 7 ngày chưa rõ (ADR) |
| UC-1.4 | Xem activity log | Admin-only, filter event/time, sorted newest-first, pagination; log immutable |
| UC-1.5 | Reader statistics | Self Reader hoặc Admin target; dựa history/status/rating; tag/creator/time/total/average; empty state khi mới |
| UC-1.6 | Xem reports | Admin-only; filter 3 report types + statuses; detail chứa reporter/target/reason/options |
| UC-1.7 | Update report state | Action phải cập nhật status + action history + target side effect trong một transaction/command boundary |

### Module 2 — Quản lý truyện trên hệ thống

| UC | Requirement summary | Main rules / outcome |
|---|---|---|
| UC-2 | Hub manga management | Admin quản lý visibility/import/delete/stats |
| UC-2.1 | Ẩn truyện | `visibility_status=HIDDEN`; giữ dữ liệu; exclude public browse/search/recommendation; thao tác từ moderation cũng phải audit |
| UC-2.2 | Hiện truyện | `visibility_status=PUBLIC`; không tự bật CDC; audit |
| UC-2.3 | Chọn source tải truyện | List package ready → select manga → per-manga CDC toggle → background ETL → validate/hash → upsert → optionally subscribe |
| UC-2.4 | Xóa truyện | Check `is_syncing`; if sync then block/disable delete; confirm + reason; cancel CDC; local metadata/chapter/comment removal; list refs removed; media cleanup async; audit; upstream untouched |
| UC-2.5 | Interaction stats | Views, list additions, ratings, average rating, comments; date/tag/manga filters; valid views only |

### Module 3 — Quản lý chọn truyện đọc / Discovery

| UC | Requirement summary | Main rules / outcome |
|---|---|---|
| UC-3 | Discovery hub | browse/filter/search/recommend/detail/status/history; only public data |
| UC-3.1 | Xem danh sách truyện | cards with cover/title/latest chapter/rating; sort latest update/views/rating/title; pagination |
| UC-3.2 | Lọc danh sách | Tag groups Format/Genre/Theme/Content; demographic; publication status; year; content rating; language; include/exclude semantics |
| UC-3.3 | Search title | title + alternative titles; autocomplete while typing; fulltext/fuzzy/case/accent insensitive |
| UC-3.4 | Search Author/Artist | query Creator catalogue and works; support author and artist roles separately |
| UC-3.5 | Manga detail metadata | Cover/title/alt titles/creators/tags/status/year/synopsis/rating/stats/reading status/chapter list/comments/recommendations |
| UC-3.6 | Creator detail | identity, bio, social links, public manga works, filters/sort/page via AJAX |
| UC-3.7 | Item-based recommendation | collaborative item similarity from read/list/rating signals; exclude current manga/hidden; cold-start fallback content-based/popular |
| UC-3.8 | User-based recommendation | login + interaction history; similar anonymous profiles; exclude read/completed/dropped candidates; new-user popular fallback |
| UC-3.9 | Content-based recommendation | tags/creator/synopsis TF-IDF or embedding + cosine; fallback same main tag/high-rated; recompute on ETL |
| UC-3.10 | Update reading status | single current status per reader/manga; enum READING/PLAN_TO_READ/COMPLETED/ON_HOLD/DROPPED; allow clear |
| UC-3.11 | Reading history | logged-in personal history from chapter opens, chronological; continue action references progress state |

### Module 4 — Quản lý đọc truyện

| UC | Requirement summary | Main rules / outcome |
|---|---|---|
| UC-4 | Reader workflow | open chapter, settings, progress, rating and manga report |
| UC-4.1 | Display chapter list | display chapter number/title/volume/language/scanlation/publish date; stable numeric order |
| UC-4.2 | Filter chapters | at minimum language/volume and order; exact UI fields not fully fixed—make filter extensible |
| UC-4.3 | Select chapter | validate chapter belongs to manga and manga public; fetch page manifest and media URLs; retry/report if image data fails |
| UC-4.4 | Display mode | vertical/single/double; LTR/RTL; fit width/height/original; live apply; preserve page position; persist user prefs; mobile fallback |
| UC-4.5 | Read first | first sortable chapter (include prologue/special if index says earliest); if none disable; open page 1 and record session |
| UC-4.6 | Continue reading | resume most recent manga progress at chapter+page; currently DB only records chapter-open/duration, conflict requires progress table |
| UC-4.7 | Rate manga | score 1–10; must have opened at least one chapter (sequence guard); one current rating per user/manga; update aggregate excluding removed |
| UC-4.8 | Rating history | list CREATE/UPDATE/REMOVE event records in time order |
| UC-4.9 | Report manga/chapter | create report with reason/category + description; chapter optional; anti-spam |

### Module 5 — Quản lý comment

| UC | Requirement summary | Main rules / outcome |
|---|---|---|
| UC-5 | Comment hub | view/filter/create/edit/delete/report/react, moderation flag |
| UC-5.1 | Filter comments | filter by chapter/parent/reaction/time sort; only non-deleted displayed; exact UI filters are not completely specified |
| UC-5.2 | Create comment | manga-level (`chapter_id=NULL`) or chapter-level; can reply; content required; sequence max 2,000 chars; is_spoiler input |
| UC-5.3 | Spoiler flag | user can flag; Admin can force; if locked by admin user cannot unflag |
| UC-5.4 | Edit comment | only owner; save previous content in edit history; preserve original timestamp and update modified timestamp |
| UC-5.5 | Comment history | show previous versions, actor and edit time; no update/deletion of history |
| UC-5.6 | Delete comment | owner can soft-delete; when replies exist show deleted placeholder, otherwise hide; Admin delete via report |
| UC-5.7 | Report comment | logged-in reader; report target snapshot, anti-spam |
| UC-5.8 | Like/Dislike | one reaction/reader/comment; changing type must adjust counts atomically; remove reaction supported as reset |

### Module 6 — Quản lý thông tin độc giả / Auth

| UC | Requirement summary | Main rules / outcome |
|---|---|---|
| UC-6 | Account hub | registration/login/verify/profile/security/account report |
| UC-6.1 | Update avatar | image upload/crop/storage; listed formats JPG/PNG/WebP; max size absent—config + validate |
| UC-6.2 | Update display profile | display name, bio, DOB, DOB visibility; forbid spoof names Admin/Moderator/System; sanitize bio; DOB not future |
| UC-6.3 | Update password | require current password + matching strong new password; hash; revoke other sessions |
| UC-6.4 | Login | email or username; password; failed login limit; only ACTIVE can establish session; LOCKED denied; pending verification prompts OTP |
| UC-6.5 | Verify email | OTP or verification link in use case, sequence specifically OTP; one-use/time-limited; activate account |
| UC-6.6 | Report account | cannot self-report; category + description; log reporter; rate limit; target snapshot |

### Module 7 — Quản lý Reading List

| UC | Requirement summary | Main rules / outcome |
|---|---|---|
| UC-7 | List management | personal list CRUD/search/view/clone; ownership enforced |
| UC-7.1 | Search list | scope to owner’s own lists in the sequence; no other user lists revealed |
| UC-7.2 | View list | owner check; list metadata + paginated public mangas only |
| UC-7.3 | Create list | logged-in; name required; normalized unique name per owner; optional description |
| UC-7.4 | Edit list | owner only; validate new normalized name; preserve items/list identity |
| UC-7.5 | Delete list | owner only + confirmation; delete list membership, not underlying manga/user history/rating |
| UC-7.6 | Clone/merge lists | select one or many owned source lists; dedupe manga; warn if source lists empty; create new list transactionally; preserve originals |

### Module 8 — Manga in Reading List

| UC | Requirement summary | Main rules / outcome |
|---|---|---|
| UC-8 | List item hub | search/filter/add/remove/stats for manga membership |
| UC-8.1 | Search within list | title and Creator; scope only to list’s manga |
| UC-8.2 | Filter within list | tag/status/reading status/sort; filters operate only within list |
| UC-8.3 | Add to list | can select multiple owned lists; optional quick create; unique (list,manga); repeated request idempotent |
| UC-8.4 | Remove from list | only membership removed; never remove reading history/rating/comments |
| UC-8.5 | List metadata stats | dynamic current snapshot: manga/chapter count, tag percentages, publication status, average rating, top creators; empty state |

## 5. Cross-cutting acceptance rules

- Public catalog endpoints require `visibility_status=PUBLIC` in query predicate, not only UI filtering.
- All Reader mutating actions require authenticated `ACTIVE` account. Anonymous browsing/reading may be permitted by default; personal features require sign-in.
- All Reader-owned resources validate owner ID from session context, never trust an owner ID sent by the browser.
- Every mutating admin action writes `activity_logs` and (where report-related) `report_action_histories`.
- External IDs must be retained for source traceability; package stable IDs drive idempotent ingestion.
- Counters and derived aggregates must have a clear source-of-truth and be transactionally maintained or rebuilt from source rows.
- Date/time stored UTC; render in user locale; preserve source `date-time` offsets by normalizing to UTC instant.

## 6. Use case coverage index

| Module | IDs | Detail document |
|---|---|---|
| M1 Reader activity | UC-1…UC-1.7 | `06_AUTH_SECURITY_MODERATION.md`, `03_DOMAIN_RULES_AND_STATE_MACHINES.md` |
| M2 Manga management | UC-2…UC-2.5 | `05_PACKAGE_V2_ETL_CDC.md`, `08_CATALOG_SEARCH_RECOMMENDATIONS.md`, `06_AUTH_SECURITY_MODERATION.md` |
| M3 Discovery | UC-3…UC-3.11 | `08_CATALOG_SEARCH_RECOMMENDATIONS.md`, `07_READER_ENGINE_PROGRESS_MEDIA.md` |
| M4 Reader | UC-4…UC-4.9 | `07_READER_ENGINE_PROGRESS_MEDIA.md`, `09_SOCIAL_RATINGS_COMMENTS_LISTS.md` |
| M5 Comments | UC-5…UC-5.8 | `09_SOCIAL_RATINGS_COMMENTS_LISTS.md`, `06_AUTH_SECURITY_MODERATION.md` |
| M6 Account | UC-6…UC-6.6 | `06_AUTH_SECURITY_MODERATION.md` |
| M7 Lists | UC-7…UC-7.6 | `09_SOCIAL_RATINGS_COMMENTS_LISTS.md` |
| M8 List contents | UC-8…UC-8.5 | `09_SOCIAL_RATINGS_COMMENTS_LISTS.md` |

## 7. Source gaps — don't invent

The following are intentionally unresolved in source and need configuration/product confirmation:
- exact values for many NFR latency thresholds and pagination size;
- exact minimum password length/complexity (source sentence missing number);
- exact avatar max upload size and dimensions;
- exact title/bio length limits (some text says example but value missing);
- precise valid-view threshold and duplicate-view window;
- exact report categories for all three target types;
- report rate limit values and lock duration;
- exact reading progress save interval;
- whether lists can be made public (sequence and DB point to owner-only/private); canonical MVP is private;
- exact filter Include semantics within/between tag groups; recommended: selected tags inside same mode are OR by default, different groups AND, excludes NOT;
- whether chapter selection by reader direction affects page index or only layout; canonical: it changes page order/pairing, not underlying page identity.
