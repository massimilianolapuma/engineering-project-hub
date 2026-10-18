---
name: Engineering Project Hub
description: The project portfolio drawn as a surveyed map sheet. Measured ground is inked by status, and ground that was not surveyed is hatched and named.
colors:
  sheet-white: '#fdfdfb'
  sheet-tint: '#f2f3ef'
  sheet-hover: '#f6f7f3'
  void-ground: '#ecede8'
  hairline: '#d5d7d0'
  hairline-strong: '#a9aca3'
  hairline-faint: '#e6e8e2'
  linework-ink: '#1d1f21'
  ink-muted: '#45484b'
  ink-tertiary: '#585c5f'
  ink-data: '#26292b'
  contour-brown: '#7d4f24'
  water-blue: '#1a5f9e'
  water-blue-ink: '#ffffff'
  road-red: '#a92d22'
  ochre: '#855400'
  woodland-green: '#36612a'
  survey-grey: '#55595c'
  burnt-sienna: '#9a3f12'
  icon-ink: '#ffffff'
  night-sheet: '#171a18'
  night-sheet-tint: '#1f2320'
  night-sheet-hover: '#1b1e1c'
  night-void-ground: '#121412'
  night-hairline: '#2c312d'
  night-hairline-strong: '#4c544c'
  night-hairline-faint: '#222623'
  night-ink: '#ecede7'
  night-ink-muted: '#b3b6ae'
  night-ink-tertiary: '#9a9d95'
  night-ink-data: '#dfe0da'
  night-contour-brown: '#c89a6a'
  night-water-blue: '#79b0e6'
  night-water-blue-ink: '#101211'
  night-road-red: '#f08d80'
  night-ochre: '#e3b35a'
  night-woodland-green: '#8fc77a'
  night-survey-grey: '#a6a9a1'
  night-burnt-sienna: '#f0a070'
  night-icon-ink: '#101211'
typography:
  headline:
    fontFamily: 'Public Sans, system-ui, sans-serif'
    fontSize: '1.5rem'
    fontWeight: 700
    lineHeight: 1.25
  title:
    fontFamily: 'Public Sans, system-ui, sans-serif'
    fontSize: '1.125rem'
    fontWeight: 700
    lineHeight: 1.25
  body:
    fontFamily: 'Public Sans, system-ui, sans-serif'
    fontSize: '0.8125rem'
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: 'tnum'
  cell-reason:
    fontFamily: 'Public Sans, system-ui, sans-serif'
    fontSize: '0.75rem'
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: 'Public Sans, system-ui, sans-serif'
    fontSize: '0.75rem'
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: '0.08em'
  grid-ref:
    fontFamily: 'Public Sans, system-ui, sans-serif'
    fontSize: '0.6875rem'
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: '0.04em'
  mono:
    fontFamily: 'Geist Mono, ui-monospace, SFMono-Regular, Menlo, monospace'
    fontSize: '0.85em'
    fontWeight: 400
rounded:
  sm: '2px'
  md: '3px'
spacing:
  '1': '4px'
  '2': '8px'
  '3': '12px'
  '4': '16px'
  '5': '24px'
  '6': '32px'
components:
  badge-critical:
    textColor: '{colors.road-red}'
    rounded: '{rounded.sm}'
    padding: '3px 10px 3px 7px'
  badge-attention:
    textColor: '{colors.ochre}'
    rounded: '{rounded.sm}'
    padding: '3px 10px 3px 7px'
  badge-healthy:
    textColor: '{colors.woodland-green}'
    rounded: '{rounded.sm}'
    padding: '3px 10px 3px 7px'
  badge-unknown:
    backgroundColor: '{colors.sheet-white}'
    textColor: '{colors.survey-grey}'
    rounded: '{rounded.sm}'
    padding: '3px 10px 3px 7px'
  pill:
    backgroundColor: '{colors.sheet-tint}'
    textColor: '{colors.linework-ink}'
    rounded: '{rounded.sm}'
    padding: '2px 8px 2px 6px'
  pill-blind:
    backgroundColor: '{colors.sheet-white}'
    textColor: '{colors.linework-ink}'
    rounded: '{rounded.sm}'
    padding: '2px 8px 2px 6px'
  sheet-count:
    backgroundColor: '{colors.sheet-white}'
    textColor: '{colors.linework-ink}'
    rounded: '{rounded.sm}'
    padding: '4px 12px'
    height: '36px'
  sheet-count-pressed:
    backgroundColor: '{colors.sheet-tint}'
    textColor: '{colors.linework-ink}'
    rounded: '{rounded.sm}'
    padding: '4px 12px'
    height: '36px'
  sheet-cell:
    textColor: '{colors.linework-ink}'
    typography: '{typography.cell-reason}'
    rounded: '0px'
    padding: '8px 12px 12px'
  sheet-plate:
    backgroundColor: '{colors.sheet-white}'
    textColor: '{colors.linework-ink}'
    rounded: '0px'
    padding: '8px'
  input-field:
    backgroundColor: '{colors.sheet-white}'
    textColor: '{colors.linework-ink}'
    rounded: '{rounded.sm}'
    padding: '6px 10px'
    height: '36px'
  nav-link:
    textColor: '{colors.ink-muted}'
    padding: '8px 12px'
  nav-link-current:
    textColor: '{colors.linework-ink}'
    padding: '8px 12px'
---

# Design System: Engineering Project Hub

## Overview

**Creative North Star: "The Survey Sheet"**

The portfolio is a surveyed territory, drawn with the grammar of a 1:25,000 topographic sheet. Projects are numbered rows, dimensions are lettered columns (A Overall, B Delivery, C Version, D Security risk, E Security coverage, F Governance), and every cell is a parcel of ground that was either measured, and inked by its status, or not surveyed, and hatched and named as such. Sheet furniture (the double neatline, grid letters, row numbers, the title bar, the footer imprint, margin notes and the legend) is drawn in contour brown. Data is set in linework ink. Water blue is reserved for links and focus.

The sheet is dense and flat. There are no shadows or floating cards, and corners are square. Hairline rules separate cells, a 2px ink rule sets column A off from B–F, and status is carried by a pale tint of the ground rather than by coloured boxes or edges. Unknown is never blank, never zero and never calm. It is drawn with a 45° survey hatch, and a row where nothing was measured collapses into one heavy hatched "void" band. That band is the darkest silhouette on the sheet.

Two themes describe the same sheet. Light is sheet white by day. Dark is the same sheet read at night, with lifted inks and a darker void ground. Both follow `prefers-color-scheme` and can be overridden with `[data-theme]`. Every text pair is held to WCAG AA by `tests/unit/tokens-contrast.test.ts`.

**Key Characteristics:**

- Grid letters A–F across, row numbers down, and a grid reference (for example B1) in the corner of every cell.
- Each cell holds one status chip and one line of reason, plus a metric where one exists.
- Status uses a pale ground tint, a distinct shape icon and a text label, so it never depends on colour alone.
- Hatch marks ground that was not surveyed. The void band marks a row where nothing was measured.
- Contour-brown furniture, linework-ink data, water-blue links.
- Square corners (2–3px), hairline rules, tabular figures and no shadows.

## Colors

The palette is a survey sheet's: off-white paper, near-black linework, brown contours, blue water, and the red, ochre and green used for roads, outcrops and woodland, here reassigned to Critical, Attention and Healthy.

### Primary

- **Contour Brown** (light / dark values in frontmatter: `contour-brown`, `night-contour-brown`): the sheet's own colour. Use it for the double neatline around the sheet, the grid-letter row, row numbers, the sheet title bar and footer imprint, section heads in the margin (`Sheet notes`, `Legend`), margin-note references, the current-page underline in the top nav, the pressed state of the count filters, the plates' borders and the hatch strokes. Use it for nothing else.

### Secondary

- **Water Blue** (`water-blue`, `night-water-blue`): links, the 3px focus ring, the skip link fill and the "Mock data" source mark. It is never used for status.

### Tertiary (status inks)

- **Road Red** (`road-red`): Critical. Also used for critical severity and for margin-note references on red cells.
- **Ochre** (`ochre`): Attention, and the edge of a blind spot. Medium severity uses the same ink.
- **Woodland Green** (`woodland-green`): Healthy.
- **Survey Grey** (`survey-grey`): Unknown, not authorised, not configured, and low or unknown severity.
- **Burnt Sienna** (`burnt-sienna`): high severity only. It sits between ochre and road red on the severity scale and never stands for a health state.
- Status grounds are derived, not picked. Each tint is `color-mix(in srgb, <ink> var(--tint), var(--surface))` with `--tint` at 13% in light and 16% in dark. Badge borders mix the ink at 35% into transparent.

### Neutral

- **Sheet White** (`sheet-white`, `night-sheet`): page and surface. The page is the sheet, so the two share one value.
- **Sheet Tint** (`sheet-tint`, `night-sheet-tint`): the grid-letter row, the row-number gutter, the run bar, generic pills and the pressed count.
- **Sheet Hover** (`sheet-hover`): the table-row hover ground.
- **Void Ground** (`void-ground`, `night-void-ground`): the ground beneath the heavy void hatch.
- **Hairline / Hairline Strong / Hairline Faint**: cell rules and input strokes, hover strokes, and the faintest dividers.
- **Linework Ink / Ink Muted / Ink Tertiary / Ink Data**: body text and reasons, secondary lines (metrics, meta, nav at rest), grid refs inside cells, and dense numeric text.
- **Icon Ink** (`icon-ink`): the glyph knocked out of a filled status icon. It is white by day and near-black at night.

### Named Rules

**The Contour Brown Rule.** Brown draws the sheet and never the data. If something is a status, a link or a value, it is not brown.

**The Never-Zero Ground Rule.** Ground that was not measured is drawn with the survey hatch: the light hatch (`--hatch`, frame at 30%, 1px strokes every 7px) for a single unknown cell or tile, and the void hatch (`--hatch-void`, frame at 62% light / 34% dark, 1.5px strokes every 6px over void ground) for a row where nothing was measured. Unknown is never left blank, tinted green, or rendered as 0.

**The Ground Carries Status Rule.** Inside a tinted cell the chip loses its box (no background, no border, no left padding). The tint is the status. Column A keeps its boxed chip because it summarises the row.

## Typography

**Body Font:** Public Sans (self-hosted, weights 400/500/600/700; fallback system-ui, sans-serif)
**Label/Mono Font:** Geist Mono (self-hosted, 400/500; fallback ui-monospace, SFMono-Regular, Menlo) for code, SHAs and versions

**Character:** Public Sans is a neutral, public-service grotesque, so it reads like the lettering on a government survey sheet. Every figure is tabular so counts line up down a column.

### Hierarchy

- **Headline** (700, 1.5rem, 1.25): the page title ("Portfolio"). It is the only large type on the sheet.
- **Title** (700, 1.125rem, 1.25): section titles on inherited pages.
- **Body** (400, 0.8125rem, 1.5, tabular): table and form text, notes and legend. Long leads cap at 70ch.
- **Cell reason** (400, 0.75rem, 1.4): the single-line reason and metric inside a sheet cell. The column-A reason steps up to 0.8125rem/500.
- **Label** (700, 0.75rem, uppercase, 0.08em tracking): sheet furniture, meaning the sheet title bar, footer imprint, grid letters, margin heads, column heads and margin-note refs. It is drawn in contour brown (column heads use muted ink).
- **Grid ref** (600, 0.6875rem, 0.04em, tertiary ink): the cell's own reference (A1, D2) in its top-right corner.

### Named Rules

**The Tracked Furniture Rule.** Small, tracked uppercase type belongs to the sheet's furniture: grid letters, column heads, margin heads and imprints. It always names a real structure (a section, a column, a reference). It is never decoration above a heading.

**The Tabular Figures Rule.** Counts, percentages, references and times always use `tabular-nums`. A partial count is prefixed with ≥, and an unknown count is shown as a dash with accessible text. It is never shown as 0.

## Layout

The shell is a max 1440px column with 16px side gutters and 24px top padding. On the portfolio, a title line carries the headline and lead on the left and the count filters on the right. Below it is one compact filter row (search grows to fill; extra filters sit behind a "More filters" disclosure). Then comes the sheet layout: a two-column grid of `minmax(0, 1fr) 300px` with a 24px gap. The sheet sits on the left, and the margin (sheet notes, then legend) sits on the right.

The sheet is a table. A "Sheet 1 · Portfolio" title bar comes first, followed by the grid-letter row (A–F), the column-head row, and then one row per project. The project cell has a 28px row-number gutter in sheet tint. Column widths are 15% for the project and 17% for Overall, and cells are at least 120px. Cell padding is 8px 12px 12px, with 4px between a cell's stacked parts. A row whose dimensions are all unknown collapses B–F into a single band cell (`colspan`) and centres a plate in it.

Spacing follows a 4px base: 4 / 8 / 12 / 16 / 24 / 32. Sections are separated by 32px.

Responsive behaviour:

- **≤1240px:** the margin drops below the sheet and sheet notes come before the legend. Margin blocks tile at a minimum of 260px. Table rows become stacked cards separated by contour-brown rules, and the void band spans the full width.
- **≤720px:** each row card gets its own contour-brown frame with square corners and a 12px gap between cards.

## Elevation & Depth

The system is completely flat (`--shadow: none`). Depth comes from line weight and ground: hairlines between cells, a 2px ink rule after column A, a contour-brown double neatline around the sheet (a 1px border plus a 1px outline offset 3px), and the light-to-heavy hatch ladder for what is unknown. Plates (sheet-white boxes with a 1px brown border) lift text off the void hatch by contrast, not by shadow.

### Named Rules

**The Flat Sheet Rule.** Nothing floats. The only inset line is the 2px contour-brown underline on a pressed count filter, and it marks state, not elevation.

## Shapes

Corners are nearly square: 2px for chips, counts and focus rings, and 3px for inherited cards, tiles and tables. Sheet cells, plates, the band and the mobile row cards have 0px corners. The Unknown chip and the grey pill use a dashed stroke, while the blind-spot pill uses a solid ochre stroke. Status icons are 14px SVGs on a 16px grid, and each state has its own silhouette:

- **Healthy:** filled circle with a knocked-out check.
- **Attention:** filled triangle with a knocked-out exclamation mark.
- **Critical:** filled octagon with a knocked-out ×.
- **Unknown / not authorised:** dashed open square with a dash.
- **Blind spot:** solid open square crossed by three 45° hatch strokes, in ochre.
- **Not configured / not applicable (muted):** a single horizontal stroke.
- **Info (in progress):** open clock circle.
- **Severity:** four rising bars filled from 1 (low) to 4 (critical). The unknown level uses dashed empty bars.

## Components

### Status badge (health)

A compact square chip that pairs the shape icon with a text label and a screen-reader description.

- **Shape:** 2px corners and a 1px border. Gap is 6px, weight 600, line height 1.2.
- **Sizes:** sm (2px 8px 2px 6px, 0.75rem), md (3px 10px 3px 7px, 0.8125rem), lg (6px 14px 6px 10px, 0.875rem, 18px icon).
- **Critical / Attention / Healthy:** the status ground tint with status ink, plus a border of the ink at 35%.
- **Unknown:** a sheet-white ground with survey-grey ink and a dashed survey-grey border.
- **In a sheet cell:** follows the Ground Carries Status Rule.

### Pill (control, workflow, version and severity states)

- **Style:** sheet tint ground, linework ink, hairline border, weight 500, 0.75rem.
- **Variants:** muted uses muted ink. Grey uses a sheet-white ground and a dashed grey border. Blind uses a sheet-white ground, a solid ochre border and weight 600. Severity critical and high mix their ink into the border at 45% and 40%.
- **In a sheet cell:** wraps, with the icon top-aligned.

### Count filters

The counts in the title line are also the filter controls.

- **Style:** sheet-white button, hairline border, 2px corners, at least 36px high. The value is 700 with tabular figures and is followed by the status icon and label.
- **Hover:** the border moves to hairline strong.
- **Pressed (`aria-pressed=true`):** contour-brown border, sheet-tint ground, a 2px inset brown underline and weight 600.

### Sheet cell (signature)

- **Content:** a head line (chip on the left, grid ref on the right), an optional metric line (muted, tabular), and one reason line.
- **Ground:** the status tint for red, amber and green. Grey cells use the light hatch over sheet white.
- **Column A:** wider, followed by a 2px linework-ink rule. Its reason is one step larger.

### Void band (signature)

- A row where every dimension is unknown spans B–F with the heavy void hatch. Its A cell joins the void, and its content sits on a sheet-white plate with a brown border.
- The band label is a plate centred in the band (max 46ch, 12px 16px padding). It states "Not surveyed", gives the reason, shows the open-alert counts as dashes, and links to access and collection errors.

### Margin notes and legend

- **Sheet notes:** an ordered list keyed by grid reference (B1, D1, B4–F4) in a 56px ref column. Refs use the label style in contour brown (road red for red cells) and link to the cell anchor.
- **Sheet legend:** a 28×18px swatch for each ground (red, amber and green tints, the void hatch with a dashed grey edge, and the light hatch with an ochre edge for a blind spot), each next to its badge and description. Icon-only keys cover not authorised and not configured, and a policy note closes the legend.
- **Margin heads:** the label style in contour brown with a 1px brown underline.

### Inputs / Fields

- **Style:** sheet-white field, hairline border, 2px corners, 6px 10px padding, at least 36px high. Labels are 600 at 0.8125rem.
- **Focus:** a global 3px water-blue outline at 2px offset with 2px corners.

### Navigation

- **Top bar:** sheet white with a hairline under it. The brand is 700 linework ink. Links are 0.8125rem/500 in muted ink with a 2px transparent underline.
- **Hover:** ink, with the underline in hairline strong.
- **Current page:** ink at 700 with a contour-brown underline.
- **Run bar:** a sheet-tint strip under the top bar showing the data-source mark (water-blue 1px outlined chip) and the last collector run.
- **Theme toggle and language switch:** sheet-tint or hairline-bordered controls with 2px corners.

## Do's and Don'ts

### Do:

- **Do** give every cell a grid reference (column letter + row number) and key every margin note to one.
- **Do** put exactly one status chip and one reason line in each cell. Add a metric line only when a measured value exists.
- **Do** draw unknown ground with `--hatch`, and collapse a fully unknown row into a `--hatch-void` band with its text on a sheet-white plate.
- **Do** pair every status colour with its shape icon and a text label. Use the four-bar glyph for severity.
- **Do** keep sheet furniture (neatline, grid letters, row numbers, margin heads, imprints) in contour brown, with links and focus in water blue.
- **Do** derive status grounds with `color-mix` at `--tint` (13% light, 16% dark) rather than picking new tint hexes.
- **Do** keep corners at 2–3px and sheet cells, plates and bands at 0px.

### Don't:

- **Don't** render unknown, not authorised, collection failed or partial counts as 0, as blank ground or in green.
- **Don't** use health shapes or health tones for severity. Burnt sienna is high severity only.
- **Don't** let a blind spot (a required control the collector cannot see) look calmer than an optional gap. Keep its solid ochre edge and hatched icon.
- **Don't** mark status with a coloured side edge on a tile or cell. The ground tint carries it.
- **Don't** use drop shadows or floating cards anywhere on the sheet.
- **Don't** use contour brown for status, values or links.
