# Manga Reader UX/UI Benchmark & Implementation Pack

> **Mục tiêu:** biến các pattern UX/UI đã quan sát trên MangaDex, Comick, WEBTOON, MANGA Plus, Tapas, VIZ và một số nền tảng quản lý manga thành một đặc tả giao diện có thể triển khai, nhưng phải phù hợp với domain, database và use case hiện có của Manga Reader.
>
> **Thời điểm benchmark:** 2026-11-20. Giao diện website có thể thay đổi sau thời điểm này; agent phải kiểm tra lại trước khi triển khai nếu website tham chiếu đã đổi.

## 1. Cách sử dụng bộ tài liệu

Đây là gói bổ sung cho 15 tài liệu product/architecture/engineering trong thư mục cha. Không thay thế các tài liệu gốc.

Đọc theo thứ tự:

1. `00_UX_UI_ENTRYPOINT.md` — nguyên tắc sử dụng và thứ tự đọc.
2. `01_COMPETITOR_BENCHMARK_AND_PATTERN_CATALOG.md` — những pattern đã quan sát, nguồn và đánh giá phù hợp.
3. `02_VISUAL_DESIGN_SYSTEM_AND_COMPONENTS.md` — visual system, tokens, component contracts và states.
4. `03_INFORMATION_ARCHITECTURE_AND_SCREEN_SPECS.md` — IA và frame-level specs cho toàn bộ trang.
5. `04_ADVANCED_SEARCH_UX_SPEC.md` — đặc tả chi tiết nhất cho Advanced Search và discovery.
6. `05_READER_MANGA_DETAIL_LIBRARY_UX.md` — manga detail, chapter list, reader, history, library, profile, comment/rating entry points.
7. `06_RESPONSIVE_ACCESSIBILITY_AND_INTERACTION_QA.md` — responsive, accessibility, interaction conventions và acceptance test.
8. `07_ANTIGRAVITY_UX_EXECUTION_PROMPT.md` — prompt để giao agent khảo sát codebase và thực thi theo từng phase.
9. `08_SOURCE_REGISTER_AND_EVIDENCE.md` — URL nguồn, ngày kiểm tra, loại bằng chứng, mức độ tin cậy và giới hạn.

## 2. Thứ tự ưu tiên khi có xung đột

- Business rule, quyền, dữ liệu và state machine trong `../03_DOMAIN_RULES_AND_STATE_MACHINES.md` là ràng buộc nghiệp vụ.
- Database/contract trong `../04_DATABASE_SCHEMA_AND_MIGRATIONS.md` và `../05_PACKAGE_V2_ETL_CDC.md` quyết định dữ liệu nào thực sự có thể hiển thị/lọc.
- Use Case và frame/event contract trong `../02_SCREEN_FRAME_EVENT_FLOWS.md` là nguồn yêu cầu chức năng.
- Bộ UX/UI này quyết định cách trình bày, thứ bậc thông tin, tương tác, responsive, accessibility và các đề xuất UI mới.
- Nếu một UX pattern đòi hỏi dữ liệu/API chưa có, không được mock thành dữ liệu thật. Đánh dấu `DATA_GAP` và xử lý theo quyết định sản phẩm/migration.
- Nếu có xung đột giữa UX đề xuất và source requirement, giữ source requirement; tạo ADR hoặc đề nghị xác nhận thay vì âm thầm sửa nghiệp vụ.

## 3. Nhãn bắt buộc

Trong bộ tài liệu:

- **OBSERVED**: hành vi/nội dung đã nhìn thấy trực tiếp trên trang hoặc tài liệu chính thức.
- **SOURCE REQUIREMENT**: yêu cầu có trong các tài liệu hệ thống của dự án.
- **RECOMMENDATION**: đề xuất UX/UI của nhóm phân tích.
- **DATA GAP**: cần thêm trường dữ liệu, aggregate, endpoint hoặc migration.
- **OPEN DECISION**: chưa đủ căn cứ để chốt, cần sản phẩm xác nhận.
- **DEFERRED**: có giá trị nhưng chưa nên làm ở đợt UX/UI đầu tiên.

Không được biến `OBSERVED` của sản phẩm khác thành yêu cầu bắt buộc. Không được biến `RECOMMENDATION` thành source requirement.

## 4. Product direction được đề xuất

Manga Reader nên dùng **MangaDex làm structural reference chính**, đặc biệt ở:

- catalogue dựa trên metadata có cấu trúc;
- Advanced Search với include/exclude tags và các filter metadata;
- phân tách Genre / Theme / Format / Content;
- trang detail nhiều metadata, creator credits, alternative titles, recommendations;
- chapter list có lựa chọn ngôn ngữ và thứ tự rõ ràng;
- reader có nhiều display mode và settings được ghi nhớ;
- library, reading history, reading status và reading lists.

Bổ sung có chọn lọc:

- Comick: facet nâng cao (min/max chapter, min score, release-year range, hide items already in list), search filters dễ hiểu và result preview nhiều metadata.
- WEBTOON/Tapas: browse shelves, trending/popular, episode thumbnails, newest/oldest toggle, vertical reading và personalized recommendations.
- MANGA Plus: Favorite CTA, Available Languages, release schedule/next update, chapter list có mốc ngày và episode thumbnail.
- VIZ: editorial shelves như Top series, Fan favorites, Featured new titles.
- AniList: ý tưởng cải thiện custom lists và quản lý danh sách; đây là hướng tham khảo, không phải tính năng bắt buộc.

**Không sao chép pixel-perfect, logo, màu thương hiệu, text, artwork, component source hoặc bố cục độc quyền.** Mục tiêu là tái sử dụng pattern chức năng, sau đó thiết kế visual language riêng.

## 5. Quy tắc triển khai

1. Không code toàn bộ màn hình một lượt. Làm theo `07_ANTIGRAVITY_UX_EXECUTION_PROMPT.md`.
2. Trước khi sửa UI, agent phải đọc codebase hiện tại, xác định page/component/API đang tồn tại và tạo before/after inventory.
3. Không thay đổi API/data model chỉ vì muốn UI giống competitor. Chỉ đề xuất migration khi có `DATA GAP` và giải thích business value.
4. Mọi filter state phải deep-linkable bằng URL; refresh/back/forward không làm mất điều kiện tìm kiếm.
5. Mọi mutation phải thể hiện pending/success/failure và không optimistic update theo cách khiến dữ liệu sai.
6. Không dùng màu làm tín hiệu duy nhất. Các tag, content-rating, status và errors phải có text/icon/accessible label.
7. Reader ưu tiên nội dung truyện. Các điều khiển nâng cao được ẩn/thu gọn và chỉ xuất hiện khi user gọi.
8. Không tự sinh số liệu, rating, update date, chapter count hoặc release schedule.
9. Không hiển thị manga `HIDDEN` trong bất kỳ public surface, kể cả autocomplete, recommendations, card cache hoặc related lists.
10. `unknown` content rating không được tự động hiểu là `safe`.

## 6. Definition of UX/UI completion

Một màn hình không được coi là hoàn tất chỉ vì có screenshot đẹp. Phải có:

- hierarchy, responsive layout và component states;
- frame loading/skeleton, empty, error, permission denied, not-found và partial-data;
- interactions hoạt động, keyboard và focus behavior;
- URL/query state phù hợp;
- dữ liệu đúng với schema;
- accessibility cơ bản;
- test/acceptance criteria chạy được;
- visual regression hoặc screenshot review ở desktop, tablet và mobile.

