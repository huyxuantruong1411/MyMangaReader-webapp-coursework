# Manga Reader Web App — Agent Plan / Source of Truth

> **Mục đích:** Bộ tài liệu thực thi dành cho coding agent (Antigravity hoặc tương đương). Đây là bản hợp nhất có kiểm soát từ `Lab8.docx` (Use Case + Activity), `Lab9.docx` (Sequence + Class), `Lab10.docx` (Database + ERD) và `Pasted text(2).txt` (JSON Schema `manga-reader-package` v2.0).
>
> **Ngôn ngữ:** Tài liệu nghiệp vụ giữ thuật ngữ Việt/Anh song song. Tên entity, field, enum, endpoint và event dùng tiếng Anh theo contract.

## 1. Quy tắc đọc bộ plan

Agent phải đọc theo thứ tự sau trước khi code:

1. `01_PRODUCT_SCOPE_AND_REQUIREMENTS.md` — phạm vi, vai trò, module, use-case coverage.
2. `03_DOMAIN_RULES_AND_STATE_MACHINES.md` — quy tắc nghiệp vụ và trạng thái chuẩn.
3. `04_DATABASE_SCHEMA_AND_MIGRATIONS.md` — dữ liệu, ràng buộc, migration bắt buộc.
4. `12_ADR_CONFLICTS_AND_RISKS.md` — quyết định hòa giải mâu thuẫn; đây là nơi giải thích lý do của những điểm chuẩn hóa.
5. Đọc chuyên đề theo feature: `05_PACKAGE_V2_ETL_CDC.md`, `06_AUTH_SECURITY_MODERATION.md`, `07_READER_ENGINE_PROGRESS_MEDIA.md`, `08_CATALOG_SEARCH_RECOMMENDATIONS.md`, `09_SOCIAL_RATINGS_COMMENTS_LISTS.md`.
6. `02_SCREEN_FRAME_EVENT_FLOWS.md` — triển khai UI/UX theo từng frame, event, loading/error/empty state.
7. `10_API_CONTRACTS_AND_EVENTS.md` — giao tiếp backend.
8. `11_TEST_STRATEGY_ACCEPTANCE.md` — test và acceptance gate.
9. `13_IMPLEMENTATION_ROADMAP.md` — thứ tự triển khai, dependency và Definition of Done.

**Không đọc lướt để bắt đầu code.** Những tài liệu này được thiết kế có liên kết chéo; một yêu cầu thường tác động đồng thời UI, API, DB, audit, search index, cache và job nền.

## 2. Thứ bậc nguồn thông tin

Khi phát hiện khác biệt, agent phải áp dụng thứ bậc sau và ghi nhận vào ADR nếu khác biệt ảnh hưởng schema/API:

1. **JSON Schema v2.0** là contract giao tiếp dữ liệu manga/chapter/media giữa service nguồn và reader app. Không tự ý thêm field vào package v2.0.
2. **Lab10 DB** là thiết kế lưu trữ đích ban đầu, nhưng được phép đề xuất migration khi không đáp ứng được hành vi bắt buộc trong Lab8/Lab9.
3. **Lab9 sequence diagrams** mô tả thứ tự tương tác và side effect; đây là nguồn chính cho những bước hệ thống diễn ra sau event.
4. **Lab8 use cases** là nguồn chính về hành vi actor, precondition, postcondition, alternative flow, business rule và NFR.
5. **Lab8 activity diagrams** bổ sung nhánh quyết định/merge và thứ tự thao tác thực tế.
6. Những quyết định không có trong nguồn phải được ghi nhãn `PROPOSED` hoặc `OPEN`; không được giả vờ là yêu cầu gốc.

Nếu hai nguồn cùng cấp xung đột, không được âm thầm chọn một bên. Xem `12_ADR_CONFLICTS_AND_RISKS.md`.

## 3. Phân loại nội dung trong các tài liệu

- **SOURCE REQUIREMENT:** nội dung được nêu trực tiếp trong tài liệu đầu vào.
- **CANONICAL RULE:** cách diễn giải thống nhất được đề xuất cho toàn hệ thống nhằm loại bỏ mâu thuẫn.
- **PROPOSED DESIGN:** quyết định kỹ thuật cần để triển khai an toàn, nhưng nguồn chưa chốt.
- **OPEN PRODUCT DECISION:** vấn đề cần chủ sở hữu sản phẩm xác nhận trước khi production; agent được dùng mặc định nêu trong ADR cho MVP nhưng phải giữ khả năng đổi.

## 4. Nguồn đã rà soát

| Tài liệu | Nội dung | Phần đã sử dụng |
|---|---|---|
| `Lab8.docx` | 8 module use case, 65 bảng use case (bao gồm UC cha), sơ đồ hoạt động cuối tài liệu | Đặc tả actor/flow/BR/NFR; các activity diagram ETL, delete, report, search, metadata, recommendation, reader và các module người dùng |
| `Lab9.docx` | 16 sequence diagrams và sơ đồ lớp tổng quan + 7 package | API interaction, service boundary, sequence, class responsibility, trạng thái domain |
| `Lab10.docx` | 39 bảng dữ liệu và ERD theo phân hệ | Entity, field, type, nullability, PK/FK, quan hệ và ghi chú mapping |
| `Pasted text(2).txt` | JSON Schema draft 2020-12, `$id` `urn:manga-datalake:contract:manga-reader-package:2.0` | Contract root và 9 definitions liên quan manga/chapter/creator/tag/media/page/lineage/stats |

Tài liệu DOCX đã được trích xuất text/table và render để kiểm tra nội dung hình/sơ đồ nhúng. Số trang render có thể khác số trang trong mục lục do khổ giấy/font/layout, vì vậy tham chiếu use case bằng `UC-ID`, không tham chiếu số trang duy nhất.

## 5. Các nguyên tắc không được phá vỡ

1. `manga_id` và `chapter_id` là ID nội bộ; `pool_manga_id` và `pool_chapter_id` là ID ổn định từ contract. Không trộn hai lớp ID.
2. Không lấy `slug`, `title`, `chapter_number` hoặc URL ảnh làm primary key.
3. Không lưu password thô, OTP thô, refresh token thô hoặc JWT access token vào DB.
4. Account status `LOCKED` do Admin là trạng thái nghiệp vụ; không đồng nhất với rate-limit/temporary login cooldown.
5. Mọi admin action phải audit; report status, action và history phải cập nhật nhất quán.
6. Chỉ `PUBLIC` manga được trả ra trải nghiệm công khai, tìm kiếm và recommendation; `HIDDEN` không được lộ qua API phụ.
7. `unknown` content rating **không được coi là safe**.
8. `chapter_number` là chuỗi hiển thị; sort bằng `chapter_numeric`, sau đó `language` và tie-break ổn định.
9. Chapter image được tham chiếu bằng `bucket + object_key`; URL CDN/signed URL được tạo tại runtime, không ghi URL tạm vào contract.
10. ETL/CDC phải idempotent, có checksum, revision, retry và log per-item; lỗi một manga không được làm hỏng toàn batch.
11. `reading_histories` ghi nhận lần mở chapter; tiến độ tiếp tục đọc ở cấp page cần state riêng (ADR-001).
12. Rating hiện hành là một record/user/manga; lịch sử rating là append-only.
13. Comment xóa mềm; report snapshot và audit history không bị xóa theo comment/manga/account mục tiêu.
14. List là private theo hành vi class/sequence; không được suy diễn thành public community list khi DB chưa có visibility/share model.
15. Không tự điền những NFR số học bị bỏ trống trong Lab8. Xem mục 7.

## 6. Danh sách module và use case coverage

- Module 1 — Reader activity/admin: `UC-1`, `UC-1.1`…`UC-1.7`.
- Module 2 — Manga catalog administration: `UC-2`, `UC-2.1`…`UC-2.5`.
- Module 3 — Discovery: `UC-3`, `UC-3.1`…`UC-3.11`.
- Module 4 — Reader: `UC-4`, `UC-4.1`…`UC-4.9`.
- Module 5 — Comments: `UC-5`, `UC-5.1`…`UC-5.8`.
- Module 6 — Account: `UC-6`, `UC-6.1`…`UC-6.6`.
- Module 7 — Reading Lists: `UC-7`, `UC-7.1`…`UC-7.6`.
- Module 8 — List Items: `UC-8`, `UC-8.1`…`UC-8.5`.

Coverage matrix chi tiết nằm ở cuối `01_PRODUCT_SCOPE_AND_REQUIREMENTS.md` và được liên kết sang test case trong `11_TEST_STRATEGY_ACCEPTANCE.md`.

## 7. NFR thiếu giá trị số trong tài liệu nguồn

Trong Lab8 có nhiều câu `phản hồi dưới .`, `trong vòng .`, `truyện/trang`, `tối đa ...` nhưng số đã bị thiếu trong file. Không có cơ sở để tuyên bố đây là SLO gốc. Agent phải:

- tạo config có thể thay đổi (page size, autocomplete debounce/latency, API timeout, job retry, cache TTL, valid-view threshold);
- đo baseline thực tế bằng test/load test;
- đề xuất SLO theo môi trường ở `docs/ops` hoặc config, ghi là **project target**, không gắn nhãn requirement gốc;
- không hardcode các con số suy đoán vào business logic.

Activity diagram search có ghi autocomplete dropdown tối đa khoảng 300 ms; item-based diagram thể hiện Top-N tương đồng trong khoảng 500 ms. Xem là target được minh họa trong sơ đồ, nhưng phải đo và không khái quát thành SLO cho mọi API.

## 8. Agent protocol — bắt buộc trước mỗi PR/commit

1. Chọn các UC-ID đang triển khai.
2. Đọc canonical rules liên quan và ADR.
3. Trước khi code: ghi các entity, event, screen state và failure path bị ảnh hưởng.
4. Nếu sửa schema: tạo migration forward-only, kiểm tra dữ liệu cũ, unique/index/FK, rollback plan; không sửa schema trực tiếp ngoài migration.
5. Nếu sửa API: cập nhật OpenAPI/API contract, test auth/ownership, test idempotency và lỗi.
6. Nếu sửa event/job: xử lý duplicate, out-of-order, retry, poison event và replay.
7. Nếu sửa UI: kiểm tra loading/empty/error/forbidden/deleted/stale state, responsive và accessibility cơ bản.
8. Chạy test module + cross-module regression.
9. Cập nhật traceability matrix và changelog của plan; không sửa yêu cầu gốc mà không ghi ADR.
10. Mọi unknown phải là ticket/open decision; không tự bịa dữ liệu hoặc logic ẩn.

## 9. Cấu trúc đề xuất trong repository

```text
/docs
  /product
    00_README_AGENT_ENTRYPOINT.md
    01_PRODUCT_SCOPE_AND_REQUIREMENTS.md
    02_SCREEN_FRAME_EVENT_FLOWS.md
    03_DOMAIN_RULES_AND_STATE_MACHINES.md
  /architecture
    04_DATABASE_SCHEMA_AND_MIGRATIONS.md
    05_PACKAGE_V2_ETL_CDC.md
    10_API_CONTRACTS_AND_EVENTS.md
    12_ADR_CONFLICTS_AND_RISKS.md
  /features
    06_AUTH_SECURITY_MODERATION.md
    07_READER_ENGINE_PROGRESS_MEDIA.md
    08_CATALOG_SEARCH_RECOMMENDATIONS.md
    09_SOCIAL_RATINGS_COMMENTS_LISTS.md
  /quality
    11_TEST_STRATEGY_ACCEPTANCE.md
    13_IMPLEMENTATION_ROADMAP.md
```

## 10. Điều kiện hoàn tất một feature

Feature chỉ được xem là Done khi:
- use case cơ bản + alternative/exception path đã được implement;
- business rules được enforce ở server, không chỉ ở UI;
- migration/constraints/index phù hợp;
- audit/activity/event side effects chính xác;
- quyền sở hữu và role được kiểm tra server-side;
- trạng thái loading/empty/error/forbidden/not-found được xử lý;
- retry/duplicate/concurrency được kiểm tra nếu có ghi dữ liệu hoặc job;
- acceptance tests liên kết UC-ID có kết quả pass;
- docs, API schema và traceability cập nhật.
