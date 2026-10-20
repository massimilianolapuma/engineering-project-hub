---
name: Engineering Project Hub
description: Warm Graphite, legibility first. Each page says one thing, lists projects worst first and keeps detail on demand; status is a small exact mark, and unknown is a named, dashed outline.
colors:
  ground: '#f6f5f3'
  surface: '#fffefc'
  surface-sunk: '#f6f5f3'
  hairline: '#e7e5e1'
  control-stroke: '#928d86'
  graphite-ink: '#1c1917'
  graphite-muted: '#57534e'
  unknown-stroke: '#8f8a83'
  teal-accent: '#047879'
  teal-tint: '#d8f5f5'
  on-accent: '#ffffff'
  vermilion: '#da4620'
  vermilion-text: '#a42e0c'
  vermilion-tint: '#fee9e4'
  ochre: '#c68206'
  ochre-text: '#804d0c'
  ochre-tint: '#feedc9'
  emerald: '#19966e'
  emerald-text: '#026548'
  emerald-tint: '#ddf5e9'
  night-ground: '#151311'
  night-surface: '#1c1a17'
  night-surface-sunk: '#181614'
  night-hairline: '#2c2925'
  night-control-stroke: '#746e66'
  night-graphite-ink: '#ece9e4'
  night-graphite-muted: '#a8a29e'
  night-unknown-stroke: '#7f786f'
  night-teal-accent: '#50bfbe'
  night-teal-tint: '#082c2c'
  night-on-accent: '#151311'
  night-vermilion: '#f57050'
  night-vermilion-text: '#ffac97'
  night-vermilion-tint: '#3b1d15'
  night-ochre: '#edb345'
  night-ochre-text: '#f2cb83'
  night-ochre-tint: '#38280a'
  night-emerald: '#4dbc92'
  night-emerald-text: '#8ad7b6'
  night-emerald-tint: '#112d21'
typography:
  headline:
    fontFamily: 'IBM Plex Sans, system-ui, sans-serif'
    fontSize: '1.375rem'
    fontWeight: 600
    lineHeight: '28px'
  lead:
    fontFamily: 'IBM Plex Sans, system-ui, sans-serif'
    fontSize: '1.0625rem'
    fontWeight: 600
    lineHeight: '24px'
  count:
    fontFamily: 'IBM Plex Sans, system-ui, sans-serif'
    fontSize: '1rem'
    fontWeight: 700
    fontFeature: 'tnum'
  card-title:
    fontFamily: 'IBM Plex Sans, system-ui, sans-serif'
    fontSize: '0.9375rem'
    fontWeight: 600
    lineHeight: '22px'
  title:
    fontFamily: 'IBM Plex Sans, system-ui, sans-serif'
    fontSize: '1.125rem'
    fontWeight: 600
    lineHeight: '24px'
  body:
    fontFamily: 'IBM Plex Sans, system-ui, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 400
    lineHeight: 1.5
  small:
    fontFamily: 'IBM Plex Sans, system-ui, sans-serif'
    fontSize: '0.8125rem'
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: 'IBM Plex Sans, system-ui, sans-serif'
    fontSize: '0.75rem'
    fontWeight: 600
    lineHeight: '16px'
  score:
    fontFamily: 'IBM Plex Sans, system-ui, sans-serif'
    fontSize: '1.125rem'
    fontWeight: 700
    lineHeight: '24px'
    fontFeature: 'tnum'
  score-header:
    fontFamily: 'IBM Plex Sans, system-ui, sans-serif'
    fontSize: '1.75rem'
    fontWeight: 700
    lineHeight: '34px'
    fontFeature: 'tnum'
  mono:
    fontFamily: 'IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace'
    fontSize: '0.8125rem'
    fontWeight: 400
rounded:
  sm: '4px'
  md: '8px'
  lg: '10px'
  pill: '999px'
spacing:
  '1': '4px'
  '2': '8px'
  '3': '12px'
  '4': '16px'
  '5': '24px'
  '6': '32px'
  '7': '40px'
  '8': '48px'
components:
  status-dot:
    size: '10px'
    rounded: '50%'
  dimension-bars:
    size: '32px x 10px'
    gap: '4px'
    rounded: '{rounded.sm}'
  status-pill-critical:
    backgroundColor: '{colors.vermilion-tint}'
    textColor: '{colors.vermilion-text}'
    typography: '{typography.label}'
    rounded: '{rounded.pill}'
    padding: '3px 10px'
  status-pill-attention:
    backgroundColor: '{colors.ochre-tint}'
    textColor: '{colors.ochre-text}'
    typography: '{typography.label}'
    rounded: '{rounded.pill}'
    padding: '3px 10px'
  status-pill-healthy:
    backgroundColor: '{colors.emerald-tint}'
    textColor: '{colors.emerald-text}'
    typography: '{typography.label}'
    rounded: '{rounded.pill}'
    padding: '3px 10px'
  status-pill-unknown:
    textColor: '{colors.graphite-muted}'
    typography: '{typography.label}'
    rounded: '{rounded.pill}'
    padding: '3px 10px'
  control-symbol:
    size: '24px'
    rounded: '{rounded.sm}'
  count-filter:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.graphite-ink}'
    rounded: '{rounded.md}'
    padding: '0 14px'
    height: '40px'
  list:
    backgroundColor: '{colors.surface}'
    rounded: '{rounded.lg}'
    padding: '14px 16px'
  card:
    backgroundColor: '{colors.surface}'
    rounded: '{rounded.lg}'
    padding: '16px 20px'
  input-field:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.graphite-ink}'
    rounded: '{rounded.md}'
    padding: '0 12px'
    height: '40px'
  button:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.graphite-ink}'
    rounded: '{rounded.md}'
    padding: '6px 16px'
    height: '40px'
  button-primary:
    backgroundColor: '{colors.teal-accent}'
    textColor: '{colors.on-accent}'
    rounded: '{rounded.md}'
    padding: '6px 18px'
    height: '44px'
  nav-link:
    textColor: '{colors.graphite-muted}'
    rounded: '{rounded.md}'
    padding: '8px 10px'
    height: '40px'
  nav-link-current:
    backgroundColor: '{colors.surface-sunk}'
    textColor: '{colors.graphite-ink}'
    rounded: '{rounded.md}'
    padding: '8px 10px'
    height: '40px'
---

# Design System: Engineering Project Hub

## Overview

**Creative North Star: "Warm Graphite: legibility first"**

Warm Graphite is a reading instrument for a weekly portfolio review. Each page says one thing first (a single sentence such as "3 of 4 projects need attention"), then shows the list sorted worst first, and keeps the detail one click away. Character comes from restraint and precision: warm neutral greys, generous padding, hairline borders, one teal accent, and status colours used only where a status is.

Status is a small, exact mark rather than a painted area: a 10px dot, five 32×10px dimension bars, a pill on a fixed tint, a 24px control symbol. Vermilion, ochre and emerald fill those marks; darker `*-text` variants carry any text on their tints. Unknown is never a fill and never calm: it is a dashed outline in a dedicated stroke colour, with the cause named in words. A project score (0–100) sits next to the status dot with its confidence ("measured 4 of 5") always visible; when data is insufficient there is an em dash, never a 0.

Light and dark themes share hues and character; dark lifts the fills and inverts the tints onto a warm near-black. Both follow `prefers-color-scheme` and can be overridden with `[data-theme]`. Every text and graphic pair, including the fixed pill tints, is held to WCAG 2.2 AA by `tests/unit/tokens-contrast.test.ts`. Tokens live in `src/styles/tokens.css`; shared base styles in `src/styles/global.css`; page-specific styles in each page's scoped `<style>`.

**Key Characteristics:**

- One dominant sentence per page, then the list worst first, detail on demand.
- Warm neutral greys; one teal accent for links, focus and the primary action, never for status.
- Status as small exact marks (dot, dimension bars, pill, control symbol), always paired with text or an accessible name.
- Unknown is a dashed outline with the cause in words: never a fill, never zero, never calmer than a gap.
- Score next to the status, with visible confidence; insufficient data shows a dash and says so.
- IBM Plex Sans with tabular figures; IBM Plex Mono only for code, repositories and versions.
- 8px controls, 10px cards and lists, 999px pills; 1px hairlines; no shadows, gradients or side stripes.

## Colors

Neutrals are warm greys with a slight brown undertone, so the page reads as paper rather than as a cold dashboard. Status hues are earthy (vermilion, ochre, emerald) and appear only on status marks. The light and dark values are in the frontmatter (`night-*` for dark); the CSS custom properties are given in brackets.

### Primary

- **Teal Accent** (`--accent`, `oklch(0.52 0.09 195)` light, `oklch(0.74 0.1 195)` dark): links, the focus ring, the skip link, text selection (on `--accent-tint`) and the single primary action ("Propose on GitHub"). Nothing else.

### Status

| State     | Fill (dots, bars, graphics)                   | Text on tint or surface              | Pill tint (light / dark)                        |
| --------- | --------------------------------------------- | ------------------------------------ | ----------------------------------------------- |
| Critical  | `--red` vermilion `oklch(0.6 0.19 35)`        | `--red-text` `oklch(0.48 0.16 35)`   | `oklch(0.95 0.03 35)` / `oklch(0.27 0.05 35)`   |
| Attention | `--amber` ochre `oklch(0.66 0.15 72)`         | `--amber-text` `oklch(0.47 0.1 65)`  | `oklch(0.95 0.05 85)` / `oklch(0.29 0.05 80)`   |
| Healthy   | `--green` emerald `oklch(0.6 0.12 165)`       | `--green-text` `oklch(0.45 0.1 165)` | `oklch(0.95 0.03 165)` / `oklch(0.27 0.04 165)` |
| Unknown   | no fill: 1.5px dashed `--unknown` (`#8f8a83`) | `--text-muted`                       | transparent                                     |

Dark fills: red `oklch(0.7 0.17 35)`, amber `oklch(0.8 0.14 80)`, green `oklch(0.72 0.12 165)`; dark text variants `oklch(0.82 0.11 35)`, `oklch(0.86 0.1 82)`, `oklch(0.82 0.09 165)`.

Severity keeps its own scale (critical / high / medium / low) with text labels and a rising-bars glyph; it may borrow the red and amber hues for critical and high badges, but it is never drawn with health shapes or called a health state.

### Neutral

- **Ground** (`--bg`): the page.
- **Surface** (`--surface`): cards, lists, the top bar, inputs and buttons.
- **Surface Sunk** (`--surface-2`): table heads, row hover, the current nav item, pressed filters.
- **Hairline** (`--border`): every 1px border and row rule.
- **Control Stroke** (`--border-strong`): input and button borders, at least 3:1 against the surface.
- **Graphite Ink / Graphite Muted** (`--text`, `--text-muted`): body text and secondary text (meta, confidence, column heads, nav at rest).
- **Unknown Stroke** (`--unknown`): the dashed outline of every unknown mark, at least 3:1 as a graphic.

### Named Rules

**The Accent Is Not Status Rule.** Teal is for links, focus rings and the single primary action. It never marks a health state, a severity or a count.

**The Dashed Unknown Rule.** Unknown, not authorised and collection failed are drawn with a 1.5px dashed `--unknown` outline and muted text, and the cause is named. They are never filled, never green, never shown as 0, and never visually calmer than an optional gap.

**The Fixed Tint Rule.** Pill and symbol tints are fixed OKLCH values per theme (not `color-mix`), so every `*-text` on its tint can be contrast-tested. Fills reach 3:1 on the surface as graphics; text variants reach 4.5:1 on their tint and on the surface.

## Typography

**Font:** IBM Plex Sans (self-hosted via `@fontsource/ibm-plex-sans`, weights 400/500/600/700; fallback system-ui, sans-serif) for everything.
**Mono:** IBM Plex Mono (`@fontsource/ibm-plex-mono`, 400/500; fallback ui-monospace, SFMono-Regular, Menlo) only for code, repository names, SHAs and versions.

**Character:** a technical grotesque with open counters that stays legible at 12–14px in dense lists; tabular figures keep scores and counts aligned down a column.

### Hierarchy

- **Headline** (600, 1.375rem/28px): the page title. One per page.
- **Lead** (600, 1.0625rem/24px): the one sentence under the title that says what matters.
- **Title** (600, 1.125rem/24px): section titles; card and form-group titles use 15px/22px.
- **Body** (400, 0.875rem, 1.5): lists, tables, reasons and forms. Running text never goes below 14px.
- **Small** (400, 0.8125rem): notes, filter results, secondary lines.
- **Label** (600, 0.75rem/16px): pills, column heads, dimension labels, confidence. 12px is the smallest size used.
- **Score** (700, tabular): 1.125rem/24px in a list row, 1.75rem/34px with "/ 100" in the project header.
- **Count** (700, tabular, 1rem): the number inside a status shortcut ("2 Critical") and the security severity totals.

Every size is a token in `src/styles/tokens.css`: `--fs-xs` 12px, `--fs-sm` 13px, `--fs-md` 14px, `--fs-card` 15px, `--fs-count` 16px, `--fs-lead` 17px, `--fs-lg` 18px, `--fs-xl` 22px, `--fs-score` 28px. Pages use the tokens, never a literal size.

### Named Rules

**The Tabular Figures Rule.** Scores, counts, versions in tables and times use `tabular-nums`. A partial count is marked as incomplete; an unknown count is a dash with accessible text, never 0.

## Layout

The shell is a centred column of at most 1200px with 24px side gutters (16px at 720px and below) and 32px top padding. A surface top bar holds the brand, the main navigation (Portfolio, Security, Versions, Workflows, Data quality, Catalog) and, on the right, "How to read", the theme toggle and the language switch; a run bar under it shows the data source and the last collection. Sections are separated by 32px.

Every page follows the same order: title, one lead sentence, then the list worst first, then secondary or collapsed sections, then a one-line legend that links to "How to read".

- **Portfolio:** title and lead on the left, status count filters on the right; one inline filter row (search, status, business unit, sort) with lifecycle and severity under "More filters"; then a single list in a 10px-radius surface: status dot, project, score with confidence, five dimension bars (short labels once in the header), main reason.
- **Project:** breadcrumb; header with name, status pill, score and confidence; a "Why it is critical / needs attention" box with reasons as sentences, red first; five dimension cards; environments as a DEV → UAT → PROD path; a components table; collapsible Workflows, Security, Coverage and Collection errors.
- **Security, Versions, Workflows:** one card per project, worst first, showing only what needs attention; healthy projects collapse into one line.
- **Data quality:** repository counts, then what could not be read grouped by cause with how to fix it.
- **Catalog:** side list of projects and discovered repositories, a form in bordered groups, and a proposal box with the one primary action.

Spacing follows a 4px base: 4 / 8 / 12 / 16 / 24 / 32 / 40 / 48. Cells are at least 8px × 10px of padding; list rows use 14px 16px.

### Named Rules

**The Status Column Rule.** A pill placed before text sits in a fixed 112px column (`--status-col`) so the text after it starts at the same x on every row, whatever the label length.

### Responsive behaviour

- **≤760px:** portfolio and workflow rows wrap into two lines (name, status and score first; bars and reason second). The page never scrolls horizontally.
- **≤720px:** generic tables become stacked label/value cards; side gutters drop to 16px.
- **≤640px:** the project header, the environments path (arrows turn downward), security cards and data-quality rows stack vertically.
- Tables that cannot wrap scroll inside their own container.

## Elevation & Depth

The system is flat. Surfaces are separated by 1px hairlines and by the step from ground to surface; there are no drop shadows, gradients or blur.

### Named Rules

**The Flat Surface Rule.** Nothing floats. The only inset ring (`inset 0 0 0 1px var(--text)`) marks a pressed state: the active count filter and the current project type in the catalog.

## Shapes

Radius is 4px for small marks (dimension bars, control symbols, focus ring), 8px for controls (inputs, buttons, nav items, count filters), 10px for cards, lists and tables, and 999px for pills. Borders are 1px; unknown outlines are 1.5px dashed. Status dots are 10px circles. Health shape icons (14px SVG on a 16px grid: circle with check, triangle with exclamation, octagon with ×, dashed square with a dash) remain inside pills and badges so status never depends on colour.

## Components

### Status dot

A 10px circle: filled vermilion, ochre or emerald, or a 1.5px dashed outline for Unknown. It has an accessible name and always sits next to text (a project name, a count, a pill). In forced-colours mode it gets a solid or dashed `CanvasText` border.

### Dimension bars

Five 32×10px bars with a 4px gap and 4px corners, in a fixed order: Delivery, Versions, Security, Coverage, Governance. Each bar has an accessible name ("Security risk: Critical"); the short labels appear once in the list header as abbreviations with their full names. Unknown is a dashed outline.

### Score

The score in 700 tabular figures with the confidence as visible secondary text ("measured 4 of 5"), so it is readable without hover. With insufficient data: an em dash and "insufficient data · measured 1 of 5". Header size adds "/ 100".

### Status pill

12px/600 text with a shape icon on a fixed tint, 999px radius, 3px 10px padding. Unknown is transparent with a dashed `--unknown` border and muted text. Before text it sits in the 112px status column.

### Control symbol

A 24px box with one of six glyphs, used with the same meaning on every page: ✓ enabled, ! required but not configured, ⧖ stale scan, ✕ failed, ? not visible (not authorised, unknown or collection failed), – not required or not applicable. The glyph carries the meaning and has an accessible name; colour (tint for ✓ ! ⧖ ✕, dashed outline for ?, none for –) is secondary.

### Count filters

The status counts in the Portfolio title line are also the status filter. Surface button, hairline border, 8px radius, at least 40px high: dot, 700 tabular value, label. Hover moves the border to the control stroke; pressed (`aria-pressed=true`) uses an ink border, the sunk surface and a 1px inset ink ring. Pressing the active count clears the filter.

### Portfolio row

One row per project in a single surface list: status dot, project link (600), score with confidence, dimension bars, one-line main reason. 14px 16px cells, hairline rules, sunk-surface hover. An unknown project has a dashed dot and dashed bars, and its reason names the cause with a link to Data quality.

### Dimension card and why box

On the project page, the why box lists the reasons as sentences, red first, each with a pill in the status column and a link to its section. Below it, five dimension cards (16px padding, 10px radius, hairline border) show dot, name, pill and a one-line summary, and link to the matching section.

### Environments path

DEV → UAT → PROD as cards (10px radius, 12px 16px padding, at least 140px wide) joined by muted arrows; each shows the version in IBM Plex Mono and whether it is aligned or behind. An unknown environment uses the dashed outline.

### Buttons

Secondary by default: surface ground, control-stroke border, 8px radius, at least 40px. One primary action per view, in teal with on-accent text and at least 44px high. Danger actions use red text and a red border, never a red fill.

### Inputs / Fields

Surface field, control-stroke border, 8px radius, 0 12px padding, at least 40px high, 0.875rem text. Labels are 12px/600 muted above the field. Invalid fields get a red border and a red message under them.

### Navigation

Surface top bar with a hairline under it. Links are 500 muted text in 40px targets with 8px corners; hover and the current page use ink on the sunk surface. The language switch is a bordered segmented control; the theme toggle cycles Auto / Light / Dark.

### Legend

One line under each list: the four status dots (or the six control symbols) with their names, and a link to "How to read", which holds the full explanation.

## Do's and Don'ts

### Do:

- **Do** start each page with one sentence, then the list sorted worst first; put detail in collapsible sections or on the project page.
- **Do** pair every status mark with a text label or an accessible name; use the six control symbols with the same meaning everywhere.
- **Do** draw unknown with the dashed `--unknown` outline and name the cause ("2 collection errors").
- **Do** show the score with its confidence as visible text, and an em dash with "insufficient data" when fewer than half the dimensions are measured.
- **Do** keep pills before text in the 112px status column.
- **Do** keep touch targets at least 40px, and 44px for the primary action.
- **Do** use IBM Plex Mono only for code, repository names, SHAs and versions.

### Don't:

- **Don't** render unknown, not authorised, collection failed or partial counts as 0, as a fill, or in green.
- **Don't** use teal for status, or status colours for links.
- **Don't** draw severity with health shapes or as health states; severity keeps its own scale and text labels.
- **Don't** add side-stripe borders to cards, gradients, gradient text, glassmorphism or heavy shadows.
- **Don't** add decorative KPI tiles that carry no decision.
- **Don't** let colour be the only carrier of status.
- **Don't** set running text below 14px or any label below 12px.
