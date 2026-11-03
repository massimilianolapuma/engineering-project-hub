---
name: Engineering Project Hub
description: GitHub Primer, read as a natural extension of GitHub and never passed off as GitHub. Each page says one thing, lists projects worst first and keeps detail on demand; status is a small exact mark with an Octicon or a word, and unknown is a named, dashed outline.
colors:
  fgColor-default: '#1f2328'
  fgColor-muted: '#59636e'
  fgColor-accent: '#0969da'
  fgColor-onEmphasis: '#ffffff'
  bgColor-default: '#ffffff'
  bgColor-muted: '#f6f8fa'
  bgColor-neutral-muted: '#818b981f'
  bgColor-accent-muted: '#ddf4ff'
  bgColor-accent-emphasis: '#0969da'
  borderColor-default: '#d1d9e0'
  borderColor-muted: '#d1d9e0b3'
  borderColor-emphasis: '#818b98'
  fgColor-success: '#1a7f37'
  bgColor-success-muted: '#dafbe1'
  borderColor-success-muted: '#4ac26b66'
  fgColor-attention: '#9a6700'
  bgColor-attention-muted: '#fff8c5'
  borderColor-attention-muted: '#d4a72c66'
  fgColor-severe: '#bc4c00'
  bgColor-severe-muted: '#fff1e5'
  borderColor-severe-muted: '#fb8f4466'
  fgColor-danger: '#d1242f'
  bgColor-danger-muted: '#ffebe9'
  borderColor-danger-muted: '#ff818266'
  button-primary-bgColor-rest: '#1f883d'
  button-primary-bgColor-hover: '#1c8139'
  button-primary-fgColor-rest: '#ffffff'
  button-default-bgColor-rest: '#f6f8fa'
  button-default-bgColor-hover: '#eff2f5'
  button-default-fgColor-rest: '#25292e'
  underlineNav-borderColor-active: '#fd8c73'
  dark-fgColor-default: '#f0f6fc'
  dark-fgColor-muted: '#9198a1'
  dark-fgColor-accent: '#4493f8'
  dark-bgColor-default: '#0d1117'
  dark-bgColor-muted: '#151b23'
  dark-bgColor-neutral-muted: '#656c7633'
  dark-bgColor-accent-muted: '#388bfd1a'
  dark-bgColor-accent-emphasis: '#1f6feb'
  dark-borderColor-default: '#3d444d'
  dark-borderColor-muted: '#3d444db3'
  dark-borderColor-emphasis: '#656c76'
  dark-fgColor-success: '#3fb950'
  dark-bgColor-success-muted: '#2ea04326'
  dark-fgColor-attention: '#d29922'
  dark-bgColor-attention-muted: '#bb800926'
  dark-fgColor-severe: '#db6d28'
  dark-bgColor-severe-muted: '#db6d281a'
  dark-fgColor-danger: '#f85149'
  dark-bgColor-danger-muted: '#f851491a'
  dark-button-primary-bgColor-rest: '#238636'
  dark-button-primary-bgColor-hover: '#29903b'
  dark-button-default-bgColor-rest: '#212830'
  dark-button-default-fgColor-rest: '#f0f6fc'
  dark-underlineNav-borderColor-active: '#f78166'
typography:
  title-large:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif'
    fontSize: '2rem'
    fontWeight: 600
    lineHeight: '40px'
    fontFeature: 'tnum'
  title-medium:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif'
    fontSize: '1.25rem'
    fontWeight: 600
    lineHeight: '28px'
  title-small:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif'
    fontSize: '1rem'
    fontWeight: 600
    lineHeight: '24px'
  body-large:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif'
    fontSize: '1rem'
    fontWeight: 600
    lineHeight: '24px'
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif'
    fontSize: '0.75rem'
    fontWeight: 500
    lineHeight: '18px'
  mono:
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'
    fontSize: '0.75rem'
    fontWeight: 400
rounded:
  small: '3px'
  medium: '6px'
  full: '9999px'
spacing:
  base-size-4: '4px'
  base-size-8: '8px'
  base-size-12: '12px'
  base-size-16: '16px'
  base-size-24: '24px'
  base-size-32: '32px'
  base-size-48: '48px'
components:
  header-band:
    backgroundColor: '{colors.bgColor-muted}'
    textColor: '{colors.fgColor-default}'
  nav-item:
    textColor: '{colors.fgColor-default}'
    rounded: '{rounded.medium}'
    padding: '0 8px'
    height: '48px'
  box:
    backgroundColor: '{colors.bgColor-default}'
    rounded: '{rounded.medium}'
    padding: '16px 20px'
  box-header:
    backgroundColor: '{colors.bgColor-muted}'
    textColor: '{colors.fgColor-muted}'
    typography: '{typography.label}'
    padding: '10px 16px'
  label-success:
    backgroundColor: '{colors.bgColor-success-muted}'
    textColor: '{colors.fgColor-success}'
    typography: '{typography.label}'
    rounded: '{rounded.full}'
    padding: '0 7px'
    height: '20px'
  label-attention:
    backgroundColor: '{colors.bgColor-attention-muted}'
    textColor: '{colors.fgColor-attention}'
    typography: '{typography.label}'
    rounded: '{rounded.full}'
    padding: '0 7px'
    height: '20px'
  label-severe:
    backgroundColor: '{colors.bgColor-severe-muted}'
    textColor: '{colors.fgColor-severe}'
    typography: '{typography.label}'
    rounded: '{rounded.full}'
    padding: '0 7px'
    height: '20px'
  label-danger:
    backgroundColor: '{colors.bgColor-danger-muted}'
    textColor: '{colors.fgColor-danger}'
    typography: '{typography.label}'
    rounded: '{rounded.full}'
    padding: '0 7px'
    height: '20px'
  label-neutral:
    textColor: '{colors.fgColor-muted}'
    typography: '{typography.label}'
    rounded: '{rounded.full}'
    padding: '0 7px'
    height: '20px'
  label-unknown:
    textColor: '{colors.fgColor-muted}'
    typography: '{typography.label}'
    rounded: '{rounded.full}'
    padding: '0 7px'
    height: '20px'
  status-badge:
    typography: '{typography.label}'
    rounded: '{rounded.full}'
    padding: '0 10px 0 8px'
    height: '24px'
  status-icon:
    size: '16px'
  control-symbol:
    size: '24px'
    rounded: '{rounded.small}'
  dimension-bar:
    width: '32px'
    height: '20px'
    rounded: '2px'
  button-default:
    backgroundColor: '{colors.button-default-bgColor-rest}'
    textColor: '{colors.button-default-fgColor-rest}'
    rounded: '{rounded.medium}'
    padding: '6px 16px'
    height: '40px'
  button-default-hover:
    backgroundColor: '{colors.button-default-bgColor-hover}'
  button-primary:
    backgroundColor: '{colors.button-primary-bgColor-rest}'
    textColor: '{colors.button-primary-fgColor-rest}'
    rounded: '{rounded.medium}'
    padding: '6px 18px'
    height: '44px'
  button-primary-hover:
    backgroundColor: '{colors.button-primary-bgColor-hover}'
  button-invisible:
    textColor: '{colors.fgColor-accent}'
    rounded: '{rounded.medium}'
    padding: '6px 16px'
    height: '40px'
  input-field:
    backgroundColor: '{colors.button-default-bgColor-rest}'
    textColor: '{colors.fgColor-default}'
    rounded: '{rounded.medium}'
    padding: '0 12px'
    height: '40px'
  identity-initials:
    backgroundColor: '{colors.bgColor-neutral-muted}'
    textColor: '{colors.fgColor-default}'
    typography: '{typography.label}'
    rounded: '{rounded.full}'
    size: '32px'
---

# Design System: Engineering Project Hub

## Overview

**Creative North Star: "A natural extension of GitHub: legibility first"**

The hub is a reading instrument for a weekly portfolio review, dressed in GitHub Primer (`@primer/primitives` 11.10.0, `@primer/octicons`) so it feels like one more tab of a GitHub organisation. Each page says one thing first (a single sentence such as "3 of 4 projects need attention"), then shows the list sorted worst first, and keeps the detail one click away. Character comes from Primer's restraint: white or near-black page, hairline Box borders, one muted header band, Labels for state, Octicons for every symbol, and status colour only where a status is.

Status is a small, exact mark rather than a painted area: a 16px status Octicon, six 32px dimension bars whose height repeats the state, a Primer Label with an Octicon, a 24px control symbol. Primer's `success`, `attention`, `severe` and `danger` families colour those marks. Unknown is never a fill and never calm: no fill, a 1.5px dashed `--borderColor-emphasis` outline and `--fgColor-muted` text, with the cause named in words, never shown as zero. A project score (0–100) sits next to the status with its confidence ("measured 4 of 6") always visible; with insufficient data there is an em dash, never a 0.

Components use Primer functional tokens directly (`--fgColor-*`, `--bgColor-*`, `--borderColor-*`, `--button-*`, `--base-size-*`, `--borderRadius-*`, `--text-*`, `--fontStack-*`); `src/styles/tokens.css` only imports them and adds one hub token, `--status-col`. Shared base styles live in `src/styles/global.css`, page styles in each page's scoped `<style>`. The hub's earlier "Warm Graphite" system was retired in v0.10.0.

**Key Characteristics:**

- One dominant sentence per page, then the list worst first, detail on demand.
- Primer functional tokens only; light and dark through Primer colour modes.
- Status as small exact marks (status icon, dimension bars, Label, control symbol), always with an Octicon, a word or an accessible name.
- Unknown is a dashed outline with the cause in words: never a fill, never zero, never calmer than a gap.
- System font stack, no web fonts; monospace only for code, repositories, SHAs and versions.
- Flat Boxes with 1px borders and 6px corners; Labels fully rounded.
- Looks like GitHub, never claims to be GitHub.

## Colors

Primer's neutral greys and blue accent, with the four Primer status families reserved for status. The frontmatter carries the light value of each token and its `dark-` counterpart as resolved from `@primer/primitives` 11.10.0; code always references the CSS custom property, never the hex. Dark tints and muted borders are translucent (`#rrggbbaa`) and composite over the surface they sit on.

### Primary

- **Accent Blue** (`--fgColor-accent`): links, "How to read", invisible buttons, `accent-color` and `caret-color`, the focus ring (2px solid, 2px offset). Selection uses `--bgColor-accent-muted`; the skip link `--bgColor-accent-emphasis` with `--fgColor-onEmphasis`. Never a status.
- **Primary Button Green** (`--button-primary-bgColor-rest` / `-hover`, `--button-primary-fgColor-rest`): GitHub's green primary button, only for the one action that leaves for GitHub to propose or edit a catalog file. Green also means healthy; that is acceptable because status always carries an Octicon or a word.
- **UnderlineNav Coral** (`--underlineNav-borderColor-active`): the 2px underline under the current navigation item. Nothing else.

### Status

| Role               | Text / icon / mark    | Tint                        | Border                                |
| ------------------ | --------------------- | --------------------------- | ------------------------------------- |
| Healthy            | `--fgColor-success`   | `--bgColor-success-muted`   | `--borderColor-success-muted`         |
| Attention          | `--fgColor-attention` | `--bgColor-attention-muted` | `--borderColor-attention-muted`       |
| Critical           | `--fgColor-danger`    | `--bgColor-danger-muted`    | `--borderColor-danger-muted`          |
| Severity high only | `--fgColor-severe`    | `--bgColor-severe-muted`    | `--borderColor-severe-muted`          |
| Unknown            | `--fgColor-muted`     | none (transparent)          | 1.5px dashed `--borderColor-emphasis` |

Severity has its own scale and is always written as a word: critical uses `danger`, high `severe`, medium `attention`, low neutral (muted text, default border, no tint). Its icon is a 1–4 rising-bars glyph, never a health shape, and severity is never called a health state.

### Neutral

- **Page** (`--bgColor-default`): the page, every Box, cards, the run bar.
- **Muted Surface** (`--bgColor-muted`): the header band, Box and table headers, row hover, pressed filters, the YAML editor.
- **Neutral Wash** (`--bgColor-neutral-muted`): hover behind nav items and utility links, the language switch track, the coverage meter track, identity initials.
- **Default Border** (`--borderColor-default`): every Box, card, table, Label and row rule.
- **Muted Border** (`--borderColor-muted`): rows inside tables, sparkline guides.
- **Emphasis Border** (`--borderColor-emphasis`): the dashed unknown outline, hover on count filters, the scrollbar; it reaches 3:1 as a graphic.
- **Ink / Muted Ink** (`--fgColor-default`, `--fgColor-muted`): body text and secondary text (meta, confidence, column heads, nav icons, sparkline line).
- Buttons and form controls use Primer's own `--button-default-*`, `--button-danger-*`, `--button-invisible-*` and `--control-*` tokens.

### Named Rules

**The Accent Is Not Status Rule.** Blue is for links, focus and invisible buttons; coral only underlines the current tab; green fills only the primary button outside status marks. None of them ever marks a health state, a severity or a count.

**The Dashed Unknown Rule.** Unknown, not authorised and collection failed are drawn with no fill, a 1.5px dashed `--borderColor-emphasis` outline and `--fgColor-muted` text, and the cause is named. They are never filled, never green, never shown as 0, and never visually calmer than an optional gap. The 10px status dot is the one exception: a hollow 2px solid ring, because a dashed 10px circle reads as a loading spinner.

**The Tested Pair Rule.** Primer's own colours are used without substitutions. `tests/unit/tokens-contrast.test.ts` reads the pinned theme files in both themes, composites translucent tints, and asserts 4.5:1 for default, muted and accent text on the page and muted surfaces, for each status `fgColor` on its own muted tint, and for the primary button text; and 3:1 for the danger, attention, success marks and the emphasis border. A new text/background pair is added to that test before it ships.

## Typography

**Body Font:** `--fontStack-system` (Primer's stack: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; Primer lists "Mona Sans VF" first, used only if installed locally). No web font is downloaded.
**Mono Font:** `--fontStack-monospace` (ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono) only for code, repository names, SHAs and versions.

**Character:** GitHub's own UI type: the platform's native grotesque at 14px, semibold for titles, tabular figures wherever numbers line up.

### Hierarchy

Sizes come from Primer's `--text-title-size-*` and `--text-body-size-*` tokens; pages never set a literal font size.

- **Title large** (600, 2rem/40px): the score in the project header.
- **Title medium** (600, 1.25rem/28px): the page title (`h1`), the score in a list row.
- **Title small** (600, 1rem/24px): section titles (`h2`), environment versions, catalog editor titles.
- **Body large** (600, 1rem/24px): the lead sentence on the Portfolio, project names in the list, the brand name, count values.
- **Body** (400, 0.875rem, 1.5): lists, tables, forms, `h3`. Running text never goes below 14px.
- **Label** (500–600, 0.75rem): Labels, column heads, dimension abbreviations, confidence, notes, the run bar, the footer. 12px is the smallest size used; inline `code` never drops below it.

### Named Rules

**The Tabular Figures Rule.** Scores, counts, table cells, versions and relative times use `tabular-nums`. A partial count is marked as incomplete; an unknown count is a dash with accessible text, never 0.

## Layout

GitHub's large container: a centred column of at most 1280px with 24px gutters (16px at 720px and below), 32px top and 48px bottom padding. Spacing uses Primer's `--base-size-*` scale (4 / 8 / 12 / 16 / 24 / 32 / 48); sections are 32px apart, page heads 24px above content.

The header is one `--bgColor-muted` band with a bottom border: the brand row (Octicon `stack` at 24px and "Engineering Project Hub" in 16px semibold) with the tools on the right ("How to read" with `question`, the theme button, the EN/IT segmented control, the optional identity slot), then the UnderlineNav. Under it, the run bar on the page background: 12px muted text with the data source as a Label (attention tone for synthetic data), the last run as a relative time, and the authentication mode. When the snapshot is stale, a full-width Primer Flash (warning) appears under the run bar (`role="status"`, `alert` Octicon). The footer is a muted 12px line: app name and tagline on the left, "Not affiliated with GitHub · built with Primer" on the right.

Every page follows the same order: title, one lead sentence, then the list worst first, then secondary or collapsed sections, then a one-line legend linking to "How to read".

- **Portfolio:** title and lead on the left, status count filters on the right; one inline filter row with more filters in a disclosure; then one Box holding the project list: status icon, project, score with confidence, trend sparkline, six dimension bars (short labels once in the header), main reason.
- **Project:** breadcrumb; header with name, status Label, score and confidence; the reasons box, red first; dimension cards; environments as a DEV → UAT → PROD path; a components table; collapsible Workflows, Security, Controls coverage, Repository controls, Code quality and Collection errors.
- **Security, Versions, Workflows, What changed:** one Box per project, worst first, showing only what needs attention.
- **Data quality** and **Catalog** keep the same list and form structure in Box and FormControl looks.

### Named Rules

**The Status Column Rule.** A Label placed before text sits in a fixed 112px column (`--status-col`, the only hub token) so the text after it starts at the same x on every row.

### Responsive behaviour

- **≤720px:** gutters drop to 16px; the UnderlineNav is one row that scrolls sideways inside itself (the current item scrolled into view); the "How to read" label becomes visually hidden, its icon stays; generic tables become stacked label/value cards; the Portfolio filters fold into one disclosure.
- **≤640px:** the environments path stacks vertically and its arrows turn downward.
- The page never scrolls horizontally; tables that cannot wrap scroll inside their own container.

## Elevation & Depth

Flat, as GitHub's repository pages are. Depth comes from 1px `--borderColor-default` borders and the step from `--bgColor-default` to `--bgColor-muted`; there are no drop shadows, gradients or blur.

### Named Rules

**The Flat Box Rule.** Nothing floats. The only rings are insets that mark state: the pressed count filter (`inset 0 0 0 1px` in `--fgColor-default`), the Overdue Label (`inset 0 0 0 1px currentColor`) and an invalid catalog field (`0 0 0 1px` in `--fgColor-danger`).

## Shapes

Corners come from Primer: `--borderRadius-medium` (6px) for Boxes, cards, tables, buttons, inputs, nav hover plates and the focus ring's container; `--borderRadius-small` (3px) for control symbols, catalog issue rows and the focus ring; `--borderRadius-full` for Labels, the source Label, the coverage meter and identity initials. Dimension bars use a 2px corner. Borders are 1px; unknown outlines are 1.5px dashed. Status dots are 10px circles.

Icons are Octicons rendered to inline SVG at build time (`src/lib/octicon.ts`, 12, 16 or 24px, `currentColor`), decorative unless given a label. Status icons in Labels are 14px.

- **Health:** healthy `check-circle-fill`, attention `alert-fill`, critical `x-circle-fill`, unknown `question` (muted); overdue `clock`, not applicable `dash`, accepted `shield-check`.
- **Control symbols** (`SYMBOL_ICON`): ok `check-circle`, gap `alert`, stale `clock`, blind `question`, na `dash`, failed `x-circle`. Repository checks: pass `check`, fail `x`, unknown `question`, not applicable `dash`.
- **Navigation** (`NAV_ICON`): Portfolio `apps`, What changed `history`, Security `shield`, Versions `tag`, Workflows `workflow`, Data quality `database`, Catalog `book`, How to read `question`.
- **Shell:** brand mark `stack` (also the favicon, in `--fgColor-muted` per scheme); theme modes `device-desktop` / `sun` / `moon`; external links `link-external`; disclosure `chevron-right`, rotating 90° when open.

## Components

### Status icon

The 16px Octicon the status Labels use, in the state's `fgColor`: `x-circle-fill` (critical, `--fgColor-danger`), `alert-fill` (attention, `--fgColor-attention`), `check-circle-fill` (healthy, `--fgColor-success`) and the outline `question` for unknown (`--fgColor-muted`, never a fill). Each state has its own shape, so status never relies on colour. It replaced the 10px status dot on 2026-11-03 (owner decision). It has an accessible name and always sits next to text; in forced-colours mode the icon keeps its shape in `CanvasText`.

### Primer Label (status pill, badge, severity)

Primer's Label: 12px, weight 500, full radius, 1px border. Pills are 20px high with 0 7px padding; health badges are the large 24px size with 0 10px 0 8px padding. Each status variant uses its family's muted tint, `fgColor` and muted border, and carries its 14px Octicon before the word. Unknown has no fill, a 1.5px dashed `--borderColor-emphasis` border and muted text. Neutral (low severity, informative) is muted text on the default border. Overdue is the neutral Label with `clock`, bold, with a 1px `currentColor` inset ring: it is not a health state. Accepted is the neutral Label with `shield-check`.

### Control symbol

A 24×24 chip with `--borderRadius-small`, holding the Octicon from `SYMBOL_ICON`, with the same meaning on every page and an accessible name. ok, gap, stale and failed sit on their tone's muted tint with the tone's `fgColor`; blind has no fill and a 1.5px dashed `--borderColor-emphasis` outline; na is muted with no fill. The shape carries the meaning; colour only helps.

### Dimension bars

Six bars, 32px wide with a 4px gap and 2px corners, bottom-aligned in a 20px box, in a fixed order (Delivery, Versions, Security, Controls, Governance, Quality). Height repeats the state so colour is never the only carrier: the worse, the taller — critical 20px, attention 13px, healthy 7px. Unknown keeps the full 20px as a 1.5px dashed `--borderColor-emphasis` outline with no fill. Each bar has an accessible name ("Security: Critical"); the short labels appear once in the list header as abbreviations. In forced-colours mode the bars stay solid `CanvasText`.

### Score

The value in semibold tabular figures (`--text-title-size-medium` in a list row, `--text-title-size-large` with "/ 100" in the project header) and the confidence as `--fgColor-muted` 12px text ("measured 4 of 6"), always visible. With insufficient data: a muted em dash, "insufficient data" and the measured count.

### Sparkline and status strip

The sparkline is inline SVG on a fixed 0–100 scale: a 2px `--fgColor-muted` line with round caps, and the last collection as a 3.5px-radius dot in its status `fgColor` with a 2px page-coloured ring (no end dot when the last state is unknown). The large variant adds dashed `--borderColor-muted` 0 and 100 guides. A null score is a gap: the line breaks, never drops to 0; a lone point is a dot. Numbers and the state are always written next to it. The status strip is one 6px cell per collection (2px gap, 24px high), heights as in the dimension bars, unknown a dashed full-height outline.

### Coverage meter

A 180×8px fully rounded track on `--bgColor-neutral-muted`, a fill in the status `fgColor` and a 2px `--fgColor-default` tick at the threshold. Decorative; the number sits beside it. Unknown is a dashed `--borderColor-emphasis` track with no fill and no tick, never an empty bar that reads as 0%.

### Boxes and cards

Primer Box: `--bgColor-default`, 1px `--borderColor-default`, 6px corners, 16px 20px padding. Lists and tables have a muted header row (12px semibold muted text), rows split by borders with `--bgColor-muted` hover, as in GitHub's issue list. A table inside a card is part of the card, not a second box. Secondary sections are `<details>` with a summary row and the rotating `chevron-right`. Environment steps are bordered cards joined by an arrow; a behind step uses the attention muted tint and border, an unknown step is dashed.

### Buttons

Primer Button: default (`--button-default-*`, 6px corners, 6px 16px padding, at least 40px), small (32px), invisible (transparent, accent text, `--button-invisible-bgColor-hover`), danger (danger text on the default button, Primer danger hover). Primary is green (`--button-primary-*`), at least 44px, used only for the action that opens GitHub to propose or edit a catalog file. Disabled buttons drop to 55% opacity.

### Inputs / Fields

Primer FormControl look: label 12px semibold in `--fgColor-default` above the field; field on `--control-bgColor-rest` with `--control-borderColor-rest`, 6px corners, 0 12px padding, 40px high, 14px text, `--control-bgColor-hover` on hover. Selects draw a muted chevron. Invalid fields get a `--fgColor-danger` border and ring and a semibold danger message under them.

### Count filters

The status counts in the Portfolio title line are the status filter: default-surface buttons with a 1px border, 6px corners, at least 40px: status icon, 700 tabular value, label. Hover moves the border to `--borderColor-emphasis`; pressed (`aria-pressed=true`) uses an ink border, `--bgColor-muted` and the inset ink ring. Pressing the active count clears the filter.

### Navigation

Primer UnderlineNav inside the header band: icon plus label, 14px `--fgColor-default`, muted icons, 48px targets with 8px side padding; hover shows a `--bgColor-neutral-muted` plate; the current page is semibold with a 2px `--underlineNav-borderColor-active` underline (`CanvasText` in forced colours). No Counters on tabs. Utility links are invisible-button style; the theme toggle is a default button cycling Auto / Light / Dark with the icon of the current mode; the language switch is a two-button segmented control on `--bgColor-neutral-muted` with the current option raised on `--bgColor-default`.

### Themes

`<html data-color-mode="auto" data-light-theme="light" data-dark-theme="dark">`. Auto follows `prefers-color-scheme`; the toggle stores `light` or `dark` under the `eph-theme` localStorage key, and `public/theme-init.js` restores it before first paint (external script for the CSP). `color-scheme` follows the mode; `theme-color` is `#ffffff` light and `#0d1117` dark.

### Identity slot

Optional, off by default: enabled at build time with `PUBLIC_IDENTITY_SOURCE=cloudflare-access`. A fixed 32px slot at the end of the header tools shows the signed-in user's initials in a full-radius `--bgColor-neutral-muted` circle, with the full name only as visually hidden text and tooltip. No avatar image. If Access is absent or the call fails, the slot stays hidden and nothing shifts.

### Evidence Label (supply chain)

A Primer Label (20px, 12px weight 500, full radius) that always carries its word, with a 12px Octicon before it: **Verified** (`verified`, success muted tint and `fgColor`: CI verified it), **Present** (`check` in success colour on a neutral Label: it exists in GitHub or the registry, nobody verified it here), **Missing**, **Not verified** and **Failed** (`x` / `unverified`, attention muted tint), **Unknown** (`question`, no fill, 1.5px dashed `--borderColor-emphasis`, muted text: never "unsigned") and a muted "–" with visually hidden "Not applicable". An optional muted prefix names what it is about ("Signature", "Provenance"). A one-line legend in a `--bgColor-muted` box opens every supply-chain table.

### Source tag

A 20px tag with `--borderRadius-small` on `--bgColor-neutral-muted` with muted 12px text naming where a value comes from ("Dependency graph", "CI summary", "Harbor", "Manifest"); the accent variant (`--bgColor-accent-muted`, `--fgColor-accent`) marks a live external source (SonarQube, Argo CD). In Controls coverage the source is a muted "via …" line under the state.

### Supply chain fold

A `<details>` section like the others, after Repository controls and before Code quality. The summary hint is one sentence ("SBOM on 3 of 5 repositories · 0 unsigned images · 0 flagged licenses"). The body is the legend and one table row per repository: SBOM (bold tabular package count, source tag), license counts (name and right-aligned tabular count, custom licenses as "Custom *" with a footnote), release attestations (Evidence Labels plus "v1.4.0 · 1 of 1 asset"), images (one bordered 6px card per image and source with the path in monospace, the source tag and its Evidence Labels) and the CI summary state. At 720px and below rows stack as cards with the column name above each value. The Security page repeats it as one row per project.

### Environment cell (Versions)

Each environment step keeps its version and status Label, then a 12px line with the source tag (Argo CD in accent, Manifest neutral) and, with Argo CD, Sync (Synced success, Out of sync attention) and Health (Healthy and Progressing neutral, Degraded and Missing danger, Suspended attention) Labels. "Argo CD not authorised" is a dashed Unknown Label. "declared {version}" appears only when the declared and deployed versions differ; deployed images sit in a small disclosure.

### Providers card

On Data quality: a Box with one bordered tile per provider (SonarQube, Harbor, Argo CD) in an auto-fit grid, the name and its state Label (Available success, Partial attention, Not authorised and Unknown dashed, Off neutral) on one line and a muted "{purpose} · {n} read · {m} not readable" line under it. A small table lists repositories whose SBOM is not readable, with the reason as a dashed Label.

### Legend

One 12px muted line under each list: the four status icons (or the six control-symbol Octicons) with their names, and a link to "How to read".

## Do's and Don'ts

### Do:

- **Do** use Primer functional tokens directly; add a hub token only when Primer has no equivalent (today only `--status-col`).
- **Do** start each page with one sentence, then the list sorted worst first; put detail in `<details>` or on the project page.
- **Do** pair every status mark with an Octicon and a word or an accessible name; use `SYMBOL_ICON` with the same meaning everywhere.
- **Do** draw unknown with no fill, a 1.5px dashed `--borderColor-emphasis` outline and `--fgColor-muted` text, and name the cause.
- **Do** write severity as a word: critical `danger`, high `severe`, medium `attention`, low neutral.
- **Do** keep Labels before text in the 112px status column.
- **Do** keep touch targets at least 40px, and 44px for the primary button.
- **Do** add every new text/background pair to `tests/unit/tokens-contrast.test.ts` in both themes.
- **Do** keep the footer line "Not affiliated with GitHub · built with Primer".

### Don't:

- **Don't** pass as GitHub: no Octocat or `mark-github`, no "GitHub" as the product name, no "official".
- **Don't** render unknown, not authorised, collection failed or partial counts as 0, as a fill, or in green.
- **Don't** use the accent blue, the primary green or the UnderlineNav coral for status, or status colours for links.
- **Don't** draw severity with health shapes or call it a health state.
- **Don't** load web fonts, override Primer colours with hand-picked hex values, or set a literal font size.
- **Don't** add drop shadows, gradients, side-stripe borders or glassmorphism.
- **Don't** let colour be the only carrier of status.
- **Don't** set running text below 14px or any label below 12px.
