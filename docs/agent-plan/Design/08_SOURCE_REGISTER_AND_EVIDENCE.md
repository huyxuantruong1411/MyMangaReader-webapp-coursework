# Source Register & Evidence Notes

> Sources checked on 2026-11-20 unless a publication date is stated. Web interfaces are dynamic; content below records what was observed during this benchmark, not a permanent guarantee.

## 1. First-party product sources

| Product | Source | Type | What was used | Confidence / limitations |
|---|---|---|---|---|
| MangaDex | https://mangadex.org/titles | Live current page | Advanced Search visible controls, collapsible filters, tag include mode, result cards | High for visible labels/sections at capture time; does not prove hidden interactions or query logic |
| MangaDex | https://mangadex.org/ | Live current page | Navigation, homepage shelves, quick search shortcut | High for visible current navigation |
| MangaDex | https://mangadex.org/title/dc07afaa-643a-4bf4-a9d0-b21ecc101736/i-met-the-male-lead-in-prison | Live current detail page | Detail hierarchy, actions, rating distribution, creator roles, metadata groups, alternative titles, tabs | High for example page; content density differs by manga |
| MangaDex API docs | https://api.mangadex.org/docs/03-manga/search/ | Official API docs | Advanced search parameters, include/exclude tags, filtering dimensions, sort concepts | High for documented API contract; API defaults must not be confused with UI label |
| MangaDex API docs repository | https://gitlab.com/mangadex-pub/mangadex-api-docs/-/blob/main/3-enumerations.md | Official project docs repository | Demographic/status/content rating/language values and order options | High for current documented enums at crawl time |
| MangaDex API chapter feed | https://api.mangadex.org/docs/04-chapter/feed/ | Official API docs | Chapter feed attributes and language filtering | High for API capabilities |
| MangaDex Forum | https://forums.mangadex.org/threads/read-this-first-list-of-planned-features-changes-tweaks.2029269/ | First-party community forum | Roadmap/known proposed tweaks, not necessarily released | Medium; planned items may change or remain unshipped |
| WEBTOON | https://www.webtoons.com/en/ | Live current page | Trending/popular shelves and ranking cards | High for visible page at capture time |
| WEBTOON | https://m.webtoons.com/app/en/notice/detail?isNoticePage=true&noticeNo=3405 | Official product notice, 2025-05-14; updated 2025-06-24 | Series home changes, episode sort oldest/newest, search exploration, categories, thumbnails | High for announced change; reflects a particular rollout/version |
| WEBTOON | https://m.webtoons.com/en/notice/detail?noticeNo=3751 | Official system/recommender notice, roughly 2 months before capture | Recommendation input signals and user controls | High for company's disclosed summary; does not reveal exact model architecture/weights |
| MANGA Plus | https://mangaplus.shueisha.co.jp/titles/100269 | Live current title page | Favorite, available languages, schedule, chapter list, thumbnails and counts | High for example current title; page access/chapters vary by territory/series |
| MANGA Plus | https://mangaplus.shueisha.co.jp/faq/eng/ | Official FAQ | Reader scroll direction setting, update schedule information, browser notes | High for documented user-facing options |
| Tapas | https://tapas.io/ | Live current homepage at capture time | Featured comics, category labels, navigation, artwork-led discovery | High for visible page; platform has announced end of service on 2027-03-31, so use as historical pattern reference only |
| Tapas | https://help.tapas.io/hc/en-us/articles/115004574674-How-do-I-get-my-comic-featured | Official help | Mobile-friendly vertical comic guidance | High for creator guidance; not a full technical reader spec |
| Tapas | https://tapas.io/newsfeed | Official current newsfeed | End-of-service notice dated Oct 01, 2026 appears in latest news list; official forum notice states end date 2027-03-31 | High that shutdown has been announced; actual operational status may change |
| Tapas | https://forums.tapas.io/t/site-update-website-change-notes/43569/285 | Official community forum notice | End-of-service date 2027-03-31 | High as a first-party forum notice; re-check official FAQ before future reliance |
| Tapas | https://help.tapas.io/hc/en-us/articles/360052569214-How-to-select-your-genres | Official help | Genre/category selection concept | High for help content; app taxonomy may evolve |
| VIZ | https://www.viz.com/series | Official catalogue page | Editorial shelves (Top series, Fan favorites, Featured new) | High for visible page; access/catalog differs by region |
| AniList | https://anilist.co/forum/ | Official forum roadmap/changelog, last updated 2026-11-16 | UI overhaul, improved search, custom list rework ideas | Medium-high for roadmap status; roadmap items are not guaranteed release features |
| W3C | https://www.w3.org/TR/WCAG22/ | Normative accessibility standard | WCAG 2.2 requirements and accessibility baseline | High; normative standard |
| W3C | https://www.w3.org/WAI/WCAG22/quickref/ | W3C quick reference | Practical success criteria reference | High |

## 2. Additional live URLs inspected

- Comick current home: https://comick.dev/
- Comick advanced search: https://comick.dev/search
- Comick detail example: https://comick.dev/comic/my-ex-boyfriend-became-my-overprotective-fake-lover
- WEBTOON series/episode list example: https://www.webtoons.com/en/fantasy/the-tyrant-wants-to-be-good/list?title_no=5201
- Tapas series/reader example: https://tapas.io/series/i-shall-master-this-family/info

Comick note: `comick.io` showed a move notice to `comick.dev`; new benchmark links use `.dev`.

## 3. Community feedback (qualitative, not normative)

Sources:
- https://forums.mangadex.org/threads/mangadex-v3-is-coming.32754/page-11
- https://forums.mangadex.org/threads/mangadex-v3-is-live-and-a-general-site-update.70134/page-18

These historical discussions include user feedback about reader clutter, sidebar/bottom-bar visibility, long-strip behavior, page scaling, mobile chapter-list truncation, preference persistence, and accidental swipe navigation. They are old and anecdotal, so they are used as **risk prompts** (what to test), not as representative statistical evidence or a statement about the current MangaDex design.

## 4. Search/retrieval evidence IDs available in the conversation

For traceability in conversation citations:
- `turn135531search0` / `turn135531search1`: WEBTOON “New Series Home Is Here!” official notice.
- `turn135531search3`: WEBTOON recommender system disclosure.
- `turn135531search8`: MANGA Plus FAQ (reader direction settings / schedule).
- `turn282848search0`: MangaDex official API documentation repository enums.
- `turn135531search12`: VIZ series page and editorial shelves.
- `turn135531search2`: AniList roadmap/changelog as of 2026-11-16.
- `turn135531search4`, `turn135531search7`: WCAG 2.2 and quick reference.

MangaDex live UI and official API details were also inspected directly through rendered first-party URLs listed above. Use those links rather than assuming that a search snippet is a full interaction specification.

## 5. Current competitor-status caveat

Tapas is included only for useful legacy/transition UX patterns (especially mobile-friendly vertical reading and community/discovery). As of 2026-11-20, Tapas has announced the end of service for 2027-03-31; do not treat it as a long-term active competitor benchmark without checking the current notice again. Sources: [Tapas Newsfeed](https://tapas.io/newsfeed) and [Tapas official forum notice](https://forums.tapas.io/t/site-update-website-change-notes/43569/285).

## 6. What this benchmark does NOT claim

- It does not claim every notable manga or webtoon website was inspected.
- It does not claim a statistically ranked list of the “most popular” services worldwide; no comparable traffic or active-user dataset was collected.
- It does not claim hidden states or account-specific interactions were tested where authentication was unavailable.
- It does not copy proprietary design tokens, assets, code, logos, or exact screenshots.
- It does not infer backend behavior solely from visual labels.
- It does not guarantee competitor features remain unchanged after 2026-11-20.
- It does not claim a proposed Manga Reader feature exists in the current codebase.

## 7. Confidence levels

- **High:** first-party page/docs directly show the relevant current visible UI or documented behavior.
- **Medium:** first-party roadmap/notice indicates a feature direction, or one live example represents a larger class of pages.
- **Low / Anecdotal:** isolated community comments, old forum posts, or third-party implementation examples. These guide test hypotheses only.

