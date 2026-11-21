# Responsive, Accessibility, Interaction Rules & UX QA

## 1. Responsive verification matrix

Test at minimum:

| Class | Viewport example | Must verify |
|---|---|---|
| Small mobile | 360 × 800 | filter sheet, card/title wrapping, bottom nav safe area, reader tap targets |
| Common mobile | 390 × 844 | manga detail actions, chapter language filter, vertical reader |
| Large mobile | 430 × 932 | compact nav, detail sections, reader toolbar |
| Tablet portrait | 768 × 1024 | filter drawer, two-column cards, double-page fallback |
| Tablet landscape | 1024 × 768 | compact filter rail, results width, reader controls |
| Laptop | 1366 × 768 | full navigation, results density, chapter table |
| Desktop | 1440 × 900 | advanced search rail + grid, detail layout |
| Wide desktop | 1920 × 1080 | content max-width, image fit, reader canvas |

No screenshot should have horizontal page scroll except an intentional reader image pan/zoom area.

## 2. WCAG baseline

Target WCAG 2.2 AA for the application UI.

Critical checks:
- Text contrast ratio meets WCAG AA for actual font size/weight.
- Focus visible for keyboard users and not obscured by sticky header/footer.
- Controls have accessible names, roles and values.
- Images/cover art have useful alt text; decorative art is ignored by screen readers.
- Every form field has a label, hint/error association and correct invalid state.
- Color is never the only signal for status, content rating, include/exclude, read/unread or error.
- Modal/drawer has focus management and returns focus to opener.
- Keyboard-only operation for autocomplete, filters, menus, chapter list and reader.
- Respect reduced motion.
- Touch targets meet WCAG 2.2 minimum target-size requirement where applicable; aim for 44×44 CSS px for frequently used mobile controls where layout permits.

Official reference: [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/) and [WCAG Quick Reference](https://www.w3.org/WAI/WCAG22/quickref/).

## 3. Keyboard interaction map

### Global
- `Ctrl+K` / `Cmd+K`: open global search if no conflicting browser/platform behavior; user can still focus normally.
- `Escape`: close current popover/dialog/drawer; return focus to trigger.
- `Tab` / `Shift+Tab`: logical focus sequence.

### Autocomplete
- Arrow Up/Down moves active option.
- Enter selects active option or submits explicit query if none active.
- Escape closes suggestions but preserves text.
- `aria-activedescendant` or equivalent pattern for combobox.
- Announce number of suggestions and no-results state.

### Advanced Search
- Space/Enter toggles tag state on focused chip.
- Include/exclude state is announced (`Included`, `Excluded`, `Not selected`).
- Multi-select uses native listbox/checkbox behavior or a fully tested custom accessible pattern.
- Filter section accordion supports Enter/Space and aria-expanded.
- Apply button receives focus after user submits from mobile sheet only if results are not hidden behind modal; otherwise close and focus results heading.

### Reader
- Left/Right arrow for previous/next page only when a single/double page reader is focused and key is not used in text input.
- `F` or another documented shortcut may toggle focus mode only if no conflict; show shortcuts in help.
- `Escape` closes settings/popovers before leaving reader.
- Do not bind `Space` globally if it prevents scroll in vertical reader.
- Shortcuts are discoverable via help/tooltip and can be disabled.

## 4. Focus management

- After route transition, set focus to page heading or main content landmark, not body arbitrarily.
- After pagination, focus list heading or announce results update; avoid forcing top-of-page for every minor filter change.
- On modal open, focus first meaningful control; contain Tab within modal; return to trigger on close.
- On error, associate message with form or use live region if it is an async section error.
- Sticky headers and footers must not conceal the focused component.

## 5. Loading, empty and error states

### Loading
- Use skeleton that mirrors final component dimensions.
- Do not show “No results” while request is pending.
- Preserve old results with loading indicator during sort/filter when beneficial; mark them stale/inert if visibility could change.

### Empty
- No search results: show query/filter context and next action.
- Empty personal library: explain status and point to Explore.
- Empty list: Add manga CTA.
- Empty history: suggest opening a chapter.
- Empty recommendation: fallback to trending/latest if available.
- No chapters: disable reader actions.
- No comments: first comment CTA if authenticated.

### Error
- Network error: retry; preserve query and filter state.
- 401: refresh session once per concurrency lock; if failed, route to login with safe return path.
- 403: show permission denied; hide action controls when role already known, but server response remains authoritative.
- 404: page not found / unavailable, no sensitive object metadata leak.
- 409: conflict/duplicate/stale version; explain how to resolve.
- 422: field-level validation errors.
- 429: rate limit message and retry guidance; don't spam retry automatically.
- 5xx: local error state and correlation ID exposed to support only as appropriate.

## 6. Content display rules

- Title/synopsis text must be escaped/sanitized; don't render untrusted HTML directly.
- For markdown synopsis, use a constrained renderer, no arbitrary scripts or unsafe embeds.
- Unicode/canonical variants and long alt titles must not break layout.
- Show timestamps in user's locale; store/send UTC.
- Chapter number can be `10.5`, `Extra`, `Prologue`, etc.; UI must not assume integer.
- Long creator/group names wrap/ellipsis with title/accessible name.
- Content rating `unknown` visible as “Not classified” when relevant.

## 7. Interaction state invariants

For every interactive component, define:
- `idle`;
- `hover` (pointer only);
- `focus-visible`;
- `pressed`;
- `selected/active`;
- `disabled`;
- `loading`;
- `error`.

A component may omit hover on touch, but keyboard focus cannot be omitted. Disabled controls need explanation where the reason is not obvious.

## 8. UX telemetry (privacy-aware, optional)

Events to consider for measuring UX:
- `search_opened`, `search_submitted`, `advanced_filter_applied`, `filter_cleared`;
- `result_opened`, `result_empty_after_filter`;
- `manga_detail_read_first`, `manga_detail_continue`;
- `chapter_language_changed`, `reader_mode_changed`, `reader_image_retry`;
- `add_to_library`, `add_to_list`, `reading_status_changed`;
- `recommendation_opened`, `recommendation_dismissed` if feature exists.

Do not log raw sensitive profile fields, comment bodies, search terms if they can reveal sensitive interests, or raw IP into product analytics. Follow privacy policy and retention policy.

## 9. Visual review procedure

For each page, take screenshots at mobile, tablet, desktop widths after data-loaded and with one error/empty state.

Review:
- spacing and alignment;
- type scale and hierarchy;
- card ratio and image cropping;
- focus order and hover state;
- sticky header/footer overlap;
- long title and metadata wrap;
- loading-to-loaded layout shift;
- contrast and focus visibility;
- reader image display at multiple aspect ratios;
- no hidden actions behind sticky UI.

Use actual app data or deterministic test fixtures. Do not screenshot only empty placeholders and claim the layout is complete.

## 10. Functional acceptance test matrix

### Navigation / search
- Global search works via pointer, keyboard and mobile nav.
- Search overlay preserves query when closed/reopened as specified.
- Stale autocomplete response cannot replace newer query result.
- Title vs creator search mode is explicit.
- Advanced search state survives refresh and browser back/forward.

### Metadata
- Creator Author/Artist role does not duplicate identity incorrectly.
- Tags are grouped correctly.
- Content rating and demographic remain distinct.
- Original language and chapter translation language remain distinct.
- Hidden manga is absent from public results.

### Reader
- `Read First` uses server-side earliest chapter rule.
- `Continue` uses progress snapshot.
- Page layout switch preserves stable page position.
- Page retries operate independently.
- Double-page pairing obeys defined first-page policy.
- Wrong language doesn't get selected implicitly.

### Lists and comments
- Add/remove manga updates item count exactly once.
- Duplicate membership is idempotent.
- Private lists return no content to non-owners.
- Spoiler is masked by default.
- Deleted root comment preserves thread placeholder if replies exist.

### Admin
- Destructive operations have reason/confirmation where required.
- Report evidence persists if target deleted.
- Admin route and controls are server-authorized.

## 11. UX performance budgets (proposed, not source NFR)

These are suggested targets to measure and tune, not original business requirements:
- Search typing-to-suggestion perceived response: ~300ms debounce + network budget; p95 endpoint response should be measured separately.
- Main content skeleton appears immediately after route parse.
- Detail primary metadata should render before non-critical recommendations/comments.
- First reader page should render independently from entire chapter preload.
- Avoid layout shift from cover/page image load by fixed aspect-ratio reservation.
- Image delivery should use responsive sizes/CDN/object storage strategy from main architecture plan.

Do not label these as guaranteed SLO until environment and baseline measurements exist.

