# Design System Implementation Guide (`QL-DocTruyen`)

> **Reference:** `docs/agent-plan/Design/02_VISUAL_DESIGN_SYSTEM_AND_COMPONENTS.md` & `06_RESPONSIVE_ACCESSIBILITY_AND_INTERACTION_QA.md`  
> **Target Files:** `apps/web/src/styles/tokens.css`, `apps/web/src/styles/index.css`, `apps/web/src/components/MangaCard.tsx`, `apps/web/src/components/AppHeader.tsx`

---

## 1. Semantic Design Tokens (`apps/web/src/styles/tokens.css`)

The visual system retains a dark-first editorial reading palette with a high-contrast light theme toggle, plus dedicated independent reader canvas background presets.

### 1.1 Application Surface & Text Tokens
| CSS Variable | Dark Value | Light Value | Role |
|---|---|---|---|
| `--mr-bg-canvas` | `#0f1117` | `#f8fafc` | Page backdrop |
| `--mr-bg-surface` | `#171b24` | `#ffffff` | Primary cards, filter panels, headers |
| `--mr-bg-elevated` | `#1f2532` | `#f1f5f9` | Inputs, nested pills, raised menus |
| `--mr-bg-hover` | `#283041` | `#e2e8f0` | Interactive row/button hover state |
| `--mr-text-primary` | `#f1f5f9` | `#0f172a` | Headings & primary body copy |
| `--mr-text-secondary` | `#94a3b8` | `#475569` | Descriptions, metadata values |
| `--mr-text-muted` | `#64748b` | `#64748b` | Compact timestamps & secondary counters |
| `--mr-border-subtle` | `#273043` | `#e2e8f0` | Default card & list dividers |
| `--mr-border-strong` | `#3a465e` | `#cbd5e1` | Interactive control outlines |
| `--mr-accent` | `#38bdf8` | `#0284c7` | Primary CTAs, active nav, selected state |
| `--mr-accent-hover` | `#0ea5e9` | `#0369a1` | Primary CTA hover |
| `--mr-focus` | `#7dd3fc` | `#0369a1` | `:focus-visible` keyboard focus outline |
| `--mr-success` | `#34d399` | `#059669` | Included tags, safe badge, synced state |
| `--mr-warning` | `#fbbf24` | `#d97706` | Ratings, spoiler banner, suggestive rating |
| `--mr-danger` | `#f87171` | `#dc2626` | Excluded tags, erotica/pornographic, errors |
| `--mr-info` | `#60a5fa` | `#2563eb` | Informational banners & badges |

### 1.2 Independent Reader Canvas Tokens
Reader background theme is decoupled from the global app dark/light theme (`02_VISUAL_DESIGN_SYSTEM_AND_COMPONENTS.md` §2.1):
- `black`: `#050608` (OLED pure dark canvas)
- `dark`: `#0f1117` (default slate dark canvas)
- `gray`: `#1e2430` (low-contrast mid-gray canvas)
- `light`: `#f1f5f9` (high-brightness paper canvas)

---

## 2. Global Accessibility & Motion Rules (`apps/web/src/styles/index.css`)

1. **Keyboard Focus Ring:** Every interactive element (`a`, `button`, `input`, `select`, `textarea`, `[tabindex]`) renders a visible `2px solid var(--mr-focus)` outline with `2px` offset on `:focus-visible`.
2. **Sticky Header Clearance:** `scroll-padding-top: 4.5rem;` ensures anchor/focus scrolling is never hidden behind the sticky `AppHeader`.
3. **Reduced Motion:** Under `@media (prefers-reduced-motion: reduce)`, animations and transitions collapse to `0.01ms` (`06_RESPONSIVE_ACCESSIBILITY_AND_INTERACTION_QA.md` §2).

---

## 3. Core Component Contracts

### 3.1 `MangaCard` (`apps/web/src/components/MangaCard.tsx`)
Supports three layout variants via `variant?: "poster" | "compact" | "horizontal"`:
- **`poster` (Default Grid):**
  - 3:4 cover container (`aspect-[3/4]`) with lazy loading and graceful broken-image fallback placeholder (title initials + `"Cover Unavailable"`).
  - Top-left content rating pill with explicit text (`unknown` displayed as `"unclassified"` to distinguish from `safe`).
  - Top-right average rating badge (`★ 8.5`) shown only when `averageRating > 0`.
  - Bottom cover overlay showing latest chapter (`Ch. X · LANG`).
  - Body: 2-line clamped title, status/year/views row, optional creator roles, up to 3 genre/theme tags + `+N` overflow indicator, optional `actionSlot`.
- **`compact` (Dense Grid):**
  - Tighter padding and condensed metadata (title + status + latest chapter) for scanning larger result sets (`grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6`).
- **`horizontal` (Detailed List Mode):**
  - Side-by-side cover thumbnail (`w-24 sm:w-28`) and rich metadata column: full title, content rating + demographic + original language + status + year, creator credits, exported chapter count & available translation languages, 2-line synopsis excerpt, up to 5 tags, and latest chapter badge.

### 3.2 `TriStateTagPicker` (Inside `ExplorePage.tsx`)
- Grouped by `tags.tag_group` (`genre`, `theme`, `format`, `content`, `other`).
- Live tag search input filters tags across all groups without resetting current selections.
- Each tag cycles atomically: `Neutral` → `Include (+)` → `Exclude (−)` → `Neutral`.
- Visual + non-color cues:
  - **Include:** `+` prefix + `var(--mr-success)` border & text + `aria-label="Include tag <name> (currently included)"`
  - **Exclude:** `−` prefix + `var(--mr-danger)` border & text + `aria-label="Exclude tag <name> (currently excluded)"`
  - **Neutral:** `var(--mr-border-subtle)` border + `aria-label="Select tag <name>"`
- Per-group selected count summary and one-click `Clear group` button.

### 3.3 `ActiveFilterChip` Bar
- Displays one removable chip per active filter dimension (`Search`, `Include tag`, `Exclude tag`, `Tag mode`, `Content rating`, `Demographic`, `Status`, `Original lang`, `Chapter lang`, `Author`, `Artist`, `Year`, `Chapters`, `Min rating`, `Min views`, `Added within`, `Hide status`, `Hide lists`).
- Clicking `×` on any chip removes only that condition, resets `page=1`, and updates the URL immediately.

### 3.4 `AppHeader` & Mobile Navigation
- Desktop bar (`md:flex`): Brand, `Discover` (`Explore`, `Search`), `Personal` (`Library`, `Lists`, `History`, `Settings`), and conditional `Admin` link.
- Mobile quick-nav strip (`md:hidden`): Horizontal scrollable pill bar below the compact top bar exposing `Explore`, `Search`, `Library`, `Lists`, `History`, `Settings`, `Admin` so mobile viewports (`360px`–`430px`) never lose route access.
- Global search combobox: `Ctrl+K` / `Cmd+K` focus shortcut, grouped `MANGA` and `CREATOR` suggestions, `aria-activedescendant`, and `aria-live="polite"` result count announcement.
