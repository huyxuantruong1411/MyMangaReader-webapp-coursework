# Competitor UX/UI Benchmark & Pattern Catalog

> Benchmark đại diện, không tuyên bố khảo sát tuyệt đối mọi website đọc truyện trên toàn thế giới. Phạm vi chọn các sản phẩm có pattern bổ ích cho mô hình Manga Reader: community manga catalogue, aggregator/tracker, official publisher apps, vertical webtoon platforms và manga database.

## 1. Executive synthesis

### 1.1 Phân vai tham chiếu

| Sản phẩm | Vai trò benchmark | Pattern hữu ích nhất | Mức độ áp dụng |
|---|---|---|---|
| [MangaDex](https://mangadex.org/) | Primary structural reference | Advanced Search, tag taxonomy, manga metadata, creator, chapter language/feed, reader/library | Rất cao |
| [Comick](https://comick.dev/) | Advanced discovery / tracker | Min/max chapters, min score, release date range, tag include/exclude, library-aware filter, rich results | Cao, có điều kiện dữ liệu |
| [WEBTOON](https://www.webtoons.com/en/) | Discovery và vertical reading | Trending/popular shelves, category browsing, episode sort, personalized suggestions | Cao |
| [MANGA Plus](https://mangaplus.shueisha.co.jp/) | Publisher detail / update | Favorite, available languages, update schedule, chapter list, episode counts | Cao |
| [Tapas](https://tapas.io/) | Historical / transitional vertical comic reference | Long-strip reading, mobile-friendly content, creator/community discovery | Trung bình; platform đã thông báo đóng dịch vụ 2027-03-31 |
| [VIZ](https://www.viz.com/series) | Editorial discovery | Top series, fan favorites, featured/new shelves, curated merchandising | Trung bình |
| [AniList](https://anilist.co/) | Catalog/list management | Rich manga list workflows, custom-list ideas, search roadmap | Trung bình, một phần là roadmap |

### 1.2 Design thesis cho Manga Reader

Manga Reader không nên biến thành bản sao của WEBTOON (visual-first infinite vertical feed) hoặc của VIZ/MANGA Plus (publisher catalogue và access restrictions). Sản phẩm hiện tại gần MangaDex/Comick hơn: một **metadata-driven manga discovery and reading system** với chapter aggregation, language selection, user-generated interaction và personal library.

Vì vậy:

1. Catalogue/Advanced Search là công cụ cốt lõi, không phải trang phụ.
2. Manga detail phải cung cấp đủ metadata để đánh giá truyện trước khi đọc.
3. Reader phải ít gây nhiễu, nhưng vẫn cho phép tùy chỉnh sâu.
4. Chapter language, group/source và chapter number phải rõ ràng vì hệ thống nhập dữ liệu từ package/ETL.
5. Recommendation phải được trình bày có nhãn phương pháp/nguồn phù hợp; không biến toàn bộ thành một băng chuyền “For You” khó giải thích.
6. Personal library phải cho người đọc nhận ra nhanh truyện nào đang đọc, đã đọc, có tiến độ hoặc có chapter mới.

## 2. MangaDex — primary benchmark

### 2.1 Global navigation and discovery

**OBSERVED (2026-11-20):** navigation phân chia Home, Feed, nhóm Follows (Updates, Library, MDLists, My Groups, Reading History), nhóm Titles (Advanced Search, Recently Added, Latest Updates, Random), Community (Forums, Groups). Global quick search có `Ctrl K` hint và input tìm kiếm.

**Áp dụng:**
- Tổ chức nav theo nhiệm vụ người dùng: Discover, Updates, Library, Lists, History.
- Không nhét mọi route vào dropdown ẩn. Giữ đường đến Search, Library và Updates ngắn.
- Trên mobile, dùng bottom navigation cho 4–5 mục chính hoặc menu compact; không cố giữ desktop sidebar.
- Search global có thể hỗ trợ shortcut `Ctrl/Cmd + K`, nhưng shortcut không thay thế search route và phải không cản input khi user đang gõ trong textbox.

### 2.2 Advanced Search

**OBSERVED:** trang `/titles` có các trường/section:
- Sort by
- Filter tags (label “Include any”)
- Content Rating
- Magazine Demographic
- Authors
- Artists
- Original languages
- Publication year
- Publication Status
- Has translated chapters / language choice
- Search / Reset filters / I'm feeling lucky
- Filters có thể thu gọn/mở.

**Giá trị:** đưa một lượng lớn metadata vào cùng một workflow nhưng chia theo các nhóm quen thuộc. Filter quan trọng nhất (tags, rating, demographic, creator, language) có thể tìm thấy mà không cần query syntax.

**Điểm cần cải tiến cho Manga Reader:**
- Display số filter đang active và chips để remove nhanh.
- Làm rõ Include any / Include all / Exclude; không để chữ “Include any” mà logic bên dưới không giải thích.
- Phân biệt rõ Original language của tác phẩm và translation language của chapter.
- Không đặt Content Rating lẫn với Genre; đây là kiểm soát nội dung.
- Trên mobile, dùng full-height filter sheet có sticky Apply/Clear thay vì panel bị cắt theo viewport.
- Search result phải giữ filter trong URL để share/deep-link/back.

### 2.3 Quan trọng: không nhầm UI label với API semantics

**OBSERVED trong tài liệu API MangaDex:** API có `includedTags[]` / `excludedTags[]`. API docs nêu default included tags mode là **AND**, excluded tags mode là **OR**. Website UI label “Include any” và API mode là hai tầng khác nhau; không suy ra rằng backend API luôn chạy OR chỉ vì nhãn trên giao diện có chữ “any”.

**RECOMMENDATION:** Manga Reader phải thể hiện semantics trực tiếp trong UI. Có thể giữ canonical logic đang đề xuất trong plan hiện tại (OR trong cùng nhóm tag; AND giữa các nhóm; exclusion loại bất kỳ tag exclude nào), nhưng nên có selector “Match any / Match all” ở mỗi tag scope hoặc một mode toàn cục. Không được hiển thị `Include any` nhưng truy vấn chạy AND.

Nguồn API: [MangaDex API — Searching for a manga](https://api.mangadex.org/docs/03-manga/search/) và [MangaDex API enums](https://gitlab.com/mangadex-pub/mangadex-api-docs/-/blob/main/3-enumerations.md).

### 2.4 Manga detail

**OBSERVED:** detail page chứa cover, title, alternative title, creators tách Author/Artist, Add To Library, Start Reading, Report, Upload Chapter (vai trò có quyền), rating score/histogram, interactions/counts, tags được chia Genre/Theme/Format, publication status/year, synopsis, tác giả/họa sĩ, external links (Read or Buy / Track), alternative titles theo locale, recommendation, tab Chapters / Comments / Art / Recommendations.

**Áp dụng:**
- Dùng hero metadata + primary actions trên đầu trang.
- Không buộc synopsis phải nằm trong modal; đặt ngay trong detail với expand/collapse.
- Phân nhóm tag như schema hiện tại: genre/theme/format/content/other (MangaDex page đang render ba nhóm Genre/Theme/Format cho ví dụ quan sát; Manga Reader còn có Content/Other theo schema).
- Creator links phải phân biệt role, nhưng nếu cùng creator có hai role trên một manga thì không render hai card creator trùng lặp.
- Tabs/anchors phải deep-linkable và có loading độc lập.
- Show rating distribution chỉ khi có dataset đủ; nếu không chỉ hiển thị aggregate score và số lượt đánh giá.

### 2.5 Chapter list / language

**OBSERVED:** MangaDex API chapter feed có các thuộc tính chapter number, volume, language, group, publishAt và có thể lọc theo `translatedLanguage[]`. Detail page có tab Chapters.

**Áp dụng:**
- Chapter table/list có filter translation language, group, sort direction và pagination/virtualization.
- Chapter number là string hiển thị; sắp xếp theo numeric key, không sort lexical.
- Chapter row phải thể hiện language, scanlation group, publish time, chapter title và read/progress indicator khi có dữ liệu.
- Nếu nhiều translation của cùng chapter number, group chúng vào một logical chapter section hoặc giữ rows nhưng phải làm dễ nhận diện ngôn ngữ/group.

### 2.6 Library / follows / history

**OBSERVED:** navigation tách Updates, Library, MDLists, Reading History. API docs phân biệt Reading List status và Follows list.

**Áp dụng:**
- Không nhập “đánh dấu đang đọc” và “theo dõi cập nhật” thành một trường trạng thái duy nhất.
- Library là nơi quản lý trạng thái đọc (Reading, On Hold, Plan to Read, Completed, Dropped, Re-reading theo nhu cầu app), còn Updates/Following là tùy chọn nhận cập nhật.
- Reading History nên trả lời “đã mở chapter nào / lần gần nhất” và có link continue.
- Reading Lists là nhóm tự tổ chức, không đồng nhất với status.

## 3. Comick — advanced discovery and tracker benchmark

### 3.1 Advanced search

**OBSERVED tại [Comick Search](https://comick.dev/search):** tab Latest / Popular; Genres; Tags (“Select 2 times to exclude”); Demographic; Created at; Type; Min chapters; Max chapters; Min score; Status; Released From/To; Hide comics in my list; Include comics without chapters.

Result cards show cover, title, number of chapters, latest upload age, year, alternate titles, synopsis, score and certain ranking information.

**Áp dụng:**
- Thêm min/max exported chapter count vì app có `manga_stats.chapter_count`.
- Thêm minimum score vì app có `mangas.average_rating`.
- Thêm range năm phát hành vì app có `mangas.year`.
- “Hide in my list” map được một phần bằng `reading_status_records` và/hoặc `list_items`, nhưng phải làm rõ user chọn hide manga nào: đã có trong Reading Status hay nằm trong bất kỳ custom list nào.
- “Include comics without chapters” map được bằng `manga_stats.chapter_count = 0`, phân biệt với `official_chapters = 0/NULL`.
- “Created at” nên có nhãn rõ là “Added to this catalog” và query theo `mangas.created_at`, không giả làm publication date.

### 3.2 Tag include/exclude interaction

**OBSERVED:** Comick dùng gợi ý thao tác chọn tag hai lần để exclude. Đây là affordance ngắn gọn nhưng có thể khó phát hiện nếu chỉ dùng double-click không có chú giải.

**RECOMMENDATION:** dùng 3 trạng thái hiển thị trực tiếp (Neutral → Include → Exclude → Neutral) kèm badge/text, hover/focus tooltip “Click to include; click again to exclude; click again to clear”. Trên mobile, trạng thái có thể được chọn qua menu nhỏ/segmented action để không phụ thuộc hover. Chỉ một trạng thái/tag; khi include và exclude, UI tự loại tag khỏi trạng thái cũ.

### 3.3 Detail / chapter list / community

**OBSERVED:** Comick detail hiển thị Origination, Demographic, Published, Status, Translation, followers, synopsis, Author/Artist, Genres, publishers, Tracker refs; tabs Comments / Reviews / Discussions; chapters có lựa chọn language, count/range/page, table với chapter, upload time, group và user.

**Áp dụng:**
- Nêu metadata gọn trước, chi tiết nâng cao sau.
- Chapter table cần thông tin provenance (language/group/source) vì app của bạn có ETL nhiều nguồn.
- Comments/Reviews/Discussions là ba khái niệm khác nhau; app hiện có Comment và Rating, không tạo Discussion forum mới nếu chưa có Use Case/data model.

### 3.4 Data limitations

- Comick `Type` (Manga/Manhwa/Manhua/Others) không thể map chắc chắn vào `publication_demographic`; đây là hai chiều metadata khác nhau.
- Current DB schema không có `work_type` riêng trong `mangas`; không được suy ra từ original language hoặc long-strip tag.
- `manga_stats` hiện chỉ có chapter_count/page_count/total_size_bytes, không có followed_count. Vì vậy sort/filter theo follower count chỉ thực hiện nếu bổ sung aggregate có nguồn đáng tin cậy.

## 4. WEBTOON — discovery and episode reading

### 4.1 Home discovery

**OBSERVED:** home có Trending & Popular series và ranking cards; series/episode pages cho thấy category labels, poster art, rank movement. Official May 2025 notice mô tả cải tiến Series Home: sorting episodes by oldest/newest; search results explored by Trending or Popular; desktop ranking has Trending/Popular/Originals/CANVAS; category terminology và rectangular episode thumbnail.

Nguồn: [WEBTOON — New Series Home Is Here!](https://m.webtoons.com/app/en/notice/detail?isNoticePage=true&noticeNo=3405).

**Áp dụng:**
- Home Manga Reader có shelves: Continue Reading, Latest Updates, Popular This Week, Recently Added, Highly Rated, Curated/Random Discovery, Personalized Recommendations.
- Mỗi shelf có `View all` và sort context, không tạo vô số carousel ngang lặp lại.
- Ranking phải có period selector (day/week/month/all time) chỉ khi underlying aggregates hỗ trợ.
- Chapter/episode list có Newest / Oldest toggle, giữ vị trí sau khi đảo sort.
- Thumbnail chapter dùng khi dữ liệu có; fallback không làm row height nhảy liên tục.

### 4.2 Recommender UX

**OBSERVED:** WEBTOON mô tả non-personalized recommender dựa vào views, reading intervals/days/episode count và attributes như genres, update recency, ratings. Personalized systems dùng reading history, reading patterns, preferences/tags, followed creators, interaction/click patterns; người dùng có thể exclude title khỏi recommendations và điều chỉnh preference/consent.

Nguồn: [WEBTOON — Recommender system notice](https://m.webtoons.com/en/notice/detail?noticeNo=3751).

**Áp dụng:**
- Tách “Similar to this manga” (content/item) khỏi “Recommended for you” (user-based).
- Cho user `Not interested`/hide recommendation nếu UX/ADR cho phép; action phải lưu preference, không chỉ dismiss ở client.
- Khi không đủ dữ liệu người dùng, chuyển sang Popular/Recently Updated và ghi rõ “Popular now” thay vì giả cá nhân hóa.
- Không cần triển khai mô hình phức tạp để làm UI. Frontend cần handle source type và fallback reason từ recommendation API.

## 5. MANGA Plus — title update and language UX

**OBSERVED:** detail có title, author, content rating, summary, Add to Favorite, Available Languages, Update Schedule, release date/time, notice về số chapter mới nhất có thể xem, Chapter List, thumbnail, chapter date/title/count và comment link.

Sources:
- [MANGA Plus title detail example](https://mangaplus.shueisha.co.jp/titles/100269)
- [MANGA Plus FAQ](https://mangaplus.shueisha.co.jp/faq/eng/)

FAQ xác nhận user có thể đổi horizontal/vertical scroll direction trong Settings; schedule hiển thị ở trang detail khi được cung cấp.

**Áp dụng:**
- Trên manga detail, có “Available chapter languages” hoặc language chips nếu nhiều `chapters.language`.
- Có favorite/follow action riêng với reading status.
- Latest chapter row hiển thị ngày cập nhật và chapter title.
- Nếu phía nguồn có schedule metadata thật, hiển thị `Next update`; hiện contract v2.0/DB của bạn chưa có lịch phát hành kế tiếp rõ ràng, nên không tự suy ra lịch từ chapter interval.
- Không bê restriction 3 chapters / availability / purchase model của publisher vào app.

## 6. Tapas — vertical consumption and mobile-first (historical / sunset caution)

**CURRENT STATUS CHECK (2026-11-20):** Tapas đã công bố End of Service Notice/FAQ; nguồn cộng đồng chính thức ghi ngày kết thúc dịch vụ là **2027-03-31**. Vì vậy Tapas chỉ nên được dùng như một tài liệu tham khảo về pattern/UX đã có, không nên coi là sản phẩm đang phát triển dài hạn hay dùng roadmap của nó để định hướng. Cần kiểm tra lại tình trạng này trước khi sử dụng benchmark ở thời điểm tương lai.

**OBSERVED UI PATTERNS:** Tapas website có primary navigation Comics, Novels, Community, Mature, More; series/home surfaces dùng featured artwork, category/type badges và long-scroll comic content. Help/creator docs nhấn mạnh mobile-friendly vertical scrolling.

Sources:
- [Tapas](https://tapas.io/)
- [Tapas mobile-friendly comic guidance](https://help.tapas.io/hc/en-us/articles/115004574674-How-do-I-get-my-comic-featured)
- [Tapas genre selection](https://help.tapas.io/hc/en-us/articles/360052569214-How-to-select-your-genres)

**Áp dụng (chỉ lấy pattern, không phụ thuộc nền tảng):**
- Vertical Webtoon mode phải là first-class reader mode, không phải hack CSS.
- Ảnh chapter được lazy-load theo viewport, giữ thứ tự sequence và reserve aspect ratio để tránh layout shift.
- Trên mobile, reader controls tự ẩn khi scroll nhưng có cách gọi lại rõ ràng.
- Featured content có thể dùng cho home, nhưng không để artwork carousel chiếm nhiều viewport đến mức che Continue Reading/Updates.

## 7. VIZ — curated editorial shelves

**OBSERVED:** VIZ Series page có các shelves Top series and titles, Fan favorites, Featured new series and titles, VIZ Originals và các nhóm sản phẩm khác.

Nguồn: [VIZ — Manga Series & Titles](https://www.viz.com/series).

**Áp dụng:**
- Có thể tổ chức home theo shelf có ý nghĩa: Staff picks/curated, Highest Rated, New to Catalog, Recently Updated, Popular.
- Mỗi shelf cần title, mô tả ngắn, sort rule, source và “See all”.
- Không fake editorial curation nếu không có Admin curation workflow; ban đầu dùng algorithmic labels “Top rated / Recently updated”.

## 8. AniList — list and product-roadmap reference

**OBSERVED:** AniList roadmap/changelog cập nhật ngày 2026-11-16 ghi nhận UI overhaul và improved search đang tiến hành, cùng ý tưởng custom list rework/decks, manga tracking per volume, mass edit tools. Đây là roadmap status, không đảm bảo feature đã release.

Nguồn: [AniList Roadmap & Changelog](https://anilist.co/forum/).

**Áp dụng:**
- Reading Lists trong app có thể phát triển theo hướng reorder / bulk add/remove / bulk status action.
- Không tự triển khai list sharing/public/decks do canonical MVP của app đang là private owner-only và schema chưa thể hiện visibility/share permission đầy đủ.

## 9. Pattern được chọn cho Manga Reader

| Pattern | Nguồn tham chiếu | Quyết định | Priority |
|---|---|---|---|
| Advanced filters grouped by metadata | MangaDex, Comick | Adopt, adapt to schema | P0 |
| Include/exclude tag states | MangaDex API, Comick | Adopt with explicit semantics | P0 |
| Original language vs chapter language | MangaDex, MANGA Plus | Adopt | P0 |
| Result cards show cover/title/status/tags/score | MangaDex, Comick | Adopt, configurable density | P0 |
| Creator Author/Artist separation | MangaDex, Comick | Adopt | P0 |
| Chapter list language + sort | MangaDex, WEBTOON, MANGA Plus | Adopt | P0 |
| Reader vertical/single/double modes | MangaDex, MANGA Plus, Tapas | Adopt per current DB settings | P0 |
| Continue Reading shelf | WEBTOON/Tapas pattern + project requirement | Adopt using reader progress | P0 |
| Update feed grouped by recent releases | MangaDex, Comick, MANGA Plus | Adopt | P1 |
| Ranking/time windows | WEBTOON, Comick | Adopt only if counters support | P1 |
| Hide recommendations / “Not interested” | WEBTOON | Product decision + preference model | P2 |
| Search presets | Product recommendation | local saved presets first | P2 |
| Work type Manga/Manhwa/Manhua filter | Comick | Needs schema/data source | P2 / DATA GAP |
| Follow count filter/sort | MangaDex/Comick | Needs reliable aggregate | P2 / DATA GAP |
| Release schedule | MANGA Plus | Only with source schedule data | P2 / DATA GAP |

## 10. Patterns intentionally rejected

- Infinite autoplay carousel or multiple carousels stacked: distracts from discovery and wastes vertical space.
- Reader with permanently visible complex sidebar: competes with manga pages and hurts mobile.
- All metadata crammed into every result card: too dense; use concise card + optional detail/list view.
- Tag selection by undocumented double-click only: not discoverable/accessibility-friendly.
- Global “Mature” filter hidden in a browser cookie only: preference should be accessible, understandable and handled on server/query layer; content rating `unknown` needs explicit handling.
- One single status field for read state, follows and custom lists: these are distinct product concepts.
- Fake “For You” recommendation labels when using global popular list.
- Relying only on hover tooltips: mobile and keyboard users need visible controls.

