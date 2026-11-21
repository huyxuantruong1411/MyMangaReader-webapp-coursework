# Visual Design System & Component Contracts

> Tất cả token dưới đây là **RECOMMENDATION**, không phải giá trị đo đạc từ MangaDex. Mục tiêu là tạo một giao diện độc lập, hơi hướng dark editorial/library, có độ tương phản tốt và có thể chuyển light theme.

## 1. Visual principles

1. **Content first:** cover và metadata giúp tìm truyện; reader canvas ưu tiên trang truyện.
2. **Information density with hierarchy:** catalogue có thể dense, nhưng nhóm thông tin theo thứ bậc; không để mọi label cùng trọng lượng.
3. **Quiet chrome:** navigation, borders, badges và toolbar phải tiết chế.
4. **Predictable interaction:** thao tác cùng loại hoạt động giống nhau trên tất cả trang.
5. **Responsive by intent:** mobile là layout được thiết kế riêng, không phải desktop bị co nhỏ.
6. **Accessible by default:** focus, labels, contrast, keyboard và touch targets không phải phần polish cuối.
7. **Data honesty:** null/unknown/unsupported phải được thể hiện rõ; không suy đoán metadata.

## 2. Design tokens

### 2.1 Color roles

Đề xuất dark-first; luôn có light theme. Các giá trị hex là điểm xuất phát, agent phải kiểm tra contrast bằng công cụ trước khi chốt.

| Token | Dark | Light | Mục đích |
|---|---|---|---|
| `color.canvas` | `#111418` | `#F4F6F7` | Page background |
| `color.surface.1` | `#191E23` | `#FFFFFF` | Main card/panel |
| `color.surface.2` | `#222930` | `#EDF1F3` | Raised/secondary panel |
| `color.surface.3` | `#2A333B` | `#E4EAED` | Hover/selected background |
| `color.border.subtle` | `#303A43` | `#D8E0E4` | Default separators |
| `color.border.strong` | `#46535D` | `#AEBBC3` | Emphasis separators |
| `color.text.primary` | `#F2F5F6` | `#172027` | Main text |
| `color.text.secondary` | `#BCC6CC` | `#46545E` | Supporting text |
| `color.text.muted` | `#8F9BA4` | `#65737D` | Metadata/disabled-adjacent text (not for critical info) |
| `color.accent` | `#47B3A7` | `#147D73` | Primary action/active state |
| `color.accent.hover` | `#62C5B9` | `#0F6D65` | Hover/active |
| `color.focus` | `#89D8CF` | `#087F77` | Visible keyboard focus |
| `color.success` | `#55B985` | `#167547` | Success |
| `color.warning` | `#E5B45D` | `#946000` | Warning |
| `color.danger` | `#E17D7D` | `#B42318` | Destructive/error |
| `color.info` | `#79AEE8` | `#175CD3` | Informational |

Rules:
- Accent is for primary action, selected navigation, links and focus. Do not use it for every badge.
- Status colors are paired with icon/text; never color-only.
- Content rating badges use neutral label + icon; `pornographic`/`unknown` must not be hidden behind an indistinct gray chip.
- Manga cover art can contain any colors; keep card chrome neutral.
- In reader, background preference (black/dark/gray/light) is reader-specific and must not be inferred from app theme.

### 2.2 Typography

Use a high-legibility sans-serif for interface text; allow system font fallback. Keep Japanese/CJK font fallback robust.

| Token | Size / line height | Usage |
|---|---|---|
| `type.xs` | 12 / 16 | timestamps, compact metadata |
| `type.sm` | 14 / 20 | labels, captions, chip text |
| `type.base` | 16 / 24 | body, forms, descriptions |
| `type.lg` | 18 / 28 | section intro, prominent metadata |
| `type.xl` | 20 / 28 | card/section title |
| `type.2xl` | 24 / 32 | page section title |
| `type.3xl` | 30 / 38 | page title |
| `type.4xl` | 36 / 44 | optional marketing/feature heading only |

- Default body size must remain at least 16px on mobile for reading comfort, except compact metadata.
- Long synopsis uses 16px/1.6 line height, not compressed card typography.
- Manga title text wraps to max 2 lines in cards; show full title on detail page.
- Do not force uppercase labels for long translated metadata.

### 2.3 Spacing / radius / elevation

- Base spacing step: 4px.
- Common spacing: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
- Radius: `sm=6`, `md=10`, `lg=14`, `xl=18`; cover images generally square corner or small 4–6px radius to retain artwork character.
- Borders over shadows. Use subtle shadow only for popover/modal/raised surface.
- Do not nest too many card-within-card surfaces.

### 2.4 Layout / breakpoints

Recommended breakpoint tokens (tune to actual app CSS framework):

- `bp.mobile`: `<600px`
- `bp.tablet`: `600–899px`
- `bp.desktop`: `900–1199px`
- `bp.wide`: `>=1200px`

Recommended layout sizes:
- Standard content max-width: 1320px.
- Wide content max-width: 1480px.
- Reading text/synopsis measure: 65–85 characters per line.
- Main app side rail (if used): 232–256px expanded; 64–72px collapsed.
- Advanced search filter rail: 300–340px at wide desktop; collapses to drawer below 1024px.
- Reader canvas: width governed by fit mode, not shared catalogue max-width.

Don't treat these as rigid if current app already has a coherent grid; preserve existing layout logic unless the UX audit shows it is the root cause.

## 3. Global shell

### 3.1 Desktop

Header content:
- Brand/home link.
- Primary nav: Discover, Updates, Library, Lists.
- Global search (can activate command-style search panel).
- Theme control.
- Account menu / Login.
- Admin link only for authorized Admin.

Navigation behavior:
- Current route visibly active.
- Secondary nav (if needed) appears within page context.
- Avoid duplicated nav labels at top and left rail.
- Header may be sticky but must not take excessive vertical space.

### 3.2 Mobile

- Compact top bar: logo, search icon/input entry, account avatar/menu.
- Bottom navigation candidate: Home/Discover, Search, Updates, Library, Profile. Keep to max five destinations; Lists and History can be under Library/Profile.
- Bottom nav must not overlap focus targets or reader page navigation.
- Advanced filters use full-height drawer/bottom sheet with sticky footer (Apply / Clear).
- Chapter row has at least two visual lines rather than clipping important group/language text.

## 4. Component library contracts

### 4.1 MangaCard

Variants:
- `poster`: cover-dominant, for compact discovery grid.
- `horizontal`: cover left, metadata right, for search/list mode.
- `compact`: cover + title + latest chapter, for dense update shelf.
- `continue-reading`: cover + current status/progress + Continue CTA.

Required information hierarchy:
1. Cover (with fixed aspect ratio 2:3 or source-provided cover ratio if known; do not crop cover unless specified).
2. Title.
3. Publication status/content-rating indicators where relevant.
4. Highest-value metadata (latest chapter, rating, tag summary) depending on variant.
5. Optional synopsis snippet (max 2–3 lines with ellipsis; full synopsis is on detail page).

Interactions:
- Main card tap/click opens detail.
- Action menu (add to list, update status, hide recommendation) must not hijack main link.
- If nested interactive elements are inside card, do not wrap everything in a single anchor; use accessible separate controls.
- Card skeleton reserves cover and text dimensions.
- Broken cover uses designed fallback, not browser broken-image icon.

### 4.2 MetadataChip / TagChip

Tag groups are explicit: `genre`, `theme`, `format`, `content`, `other`.
- Tag chip is clickable only where navigation/filtering exists; keyboard focus visible.
- Content-rating chips are not tag chips and have separate component style.
- Include/exclude filter state badges must show text or icon semantics (Include/Exclude), not rely on green/red alone.
- Long tags truncate gracefully; full label available via accessible text/title.

### 4.3 RatingSummary

- Display average score, number of ratings and rating distribution if available.
- If no ratings, show “Chưa có đánh giá”, not 0/10.
- If stale aggregate update is possible, API remains authoritative; UI must not calculate new mean from current user's rating alone.
- Rating form needs clear selected score and save/cancel affordance.

### 4.4 FilterControl family

- `SearchableMultiSelect`: creator/language/tag selection with search, selected chips, clear-all.
- `TriStateTagPicker`: Neutral / Include / Exclude; accessible explicit state.
- `RangeInput`: from/to year or min/max chapters; numeric validation, no inverted range.
- `SegmentedControl`: any/all semantics, newest/oldest, grid/list.
- `FilterAccordion`: label, selected count, collapse state persisted for current session.
- `ActiveFilterChip`: removes exactly one condition and updates URL.
- `FilterSummary`: shows active filter count and current search query.

### 4.5 ChapterRow

Must be able to show:
- chapter display label (`chapter_number` plus optional title);
- volume (if known);
- language code/flag + readable language text;
- scanlation group/source when known;
- publish time (relative + absolute tooltip or accessible text);
- reader progress/read state (only if authenticated state exists);
- optional comment count if actual data exists.

Do not show `source_id` or internal `pool_chapter_id` in normal UI.
Do not truncate chapter number/title/group so severely that two translations cannot be distinguished.

### 4.6 ReaderToolbar and ReaderSettings

Controls should be grouped by frequency:
- Always visible: back/title, chapter selector or previous/next, settings entry.
- Quick controls: display mode, fit mode, reading direction, theme/background, show/hide UI.
- Advanced: preload count, tap zones/swipe, page gap, scroll speed/step if implemented.

Use a settings panel rather than a permanent sidebar. The toolbar may auto-hide while reading but must reappear on pointer/tap/keyboard and never trap focus.

### 4.7 Feedback components

Define consistent components:
- page skeleton;
- inline loading;
- empty state with next action;
- recoverable error with Retry;
- permission denied state;
- not-found/hidden state;
- destructive confirmation dialog;
- toast for concise success/failure (not sole validation channel);
- field-level validation message.

## 5. Content density modes

Provide two layout density choices where useful:
- `Comfortable`: more spacing, synopsis excerpt, metadata labels.
- `Compact`: tighter row heights for users who browse many entries.

This is most useful in chapter lists, library and search results. Do not introduce a global density preference before proving value; can start with per-list view toggle stored locally.

## 6. Iconography and imagery

- Use one icon family consistently (Lucide or existing project standard); do not mix emoji with outline icons in functional controls.
- Flags can supplement readable language names but must not be sole language identifier.
- Use cover art as artwork; never use generated replacement art when real cover exists.
- For missing art, provide a neutral cover-placeholder showing title/initial safely.
- Do not embed third-party copyrighted site screenshots as product background assets.

## 7. Motion

- Prefer short, low-amplitude transitions (120–200ms) for menus/panels.
- Avoid animated carousels that move without user input.
- Respect `prefers-reduced-motion`.
- Page image loading should not animate every image into view in a way that distracts or causes scroll shifts.
- Auto-hiding reader toolbar should fade/translate minimally and remain discoverable.

## 8. Design tokens implementation requirements

Agent must:
1. Place tokens in one source of truth (CSS variables/theme file/design tokens package).
2. Use semantic names; no raw hex values scattered through components.
3. Support dark/light app theme.
4. Keep reader background preference separate from app theme.
5. Define tokens for disabled, hover, active, focus, selected, error and loading.
6. Add visual token docs and a small style-guide/dev page if project framework supports it.
7. Verify contrast using computed styles for actual text/background combinations.

