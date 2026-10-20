# UI redesign v0.5.0 — "Warm Graphite", legibility first

Italiano: [../../it/superpowers/specs/2026-10-20-ui-redesign-v0.5.0-design.md](../../it/superpowers/specs/2026-10-20-ui-redesign-v0.5.0-design.md)

Status: approved by the owner on 2026-10-20 · Date: 2026-10-20 · Target release: v0.5.0

## 1. Intent and why

The v0.4.0 "Survey Sheet" world (map-sheet metaphor: 45° hatching, A–F grid references, contour brown, margin notes, big legend) gave the portal character but made it hard to digest: at first glance every element competes at the same volume and the eye has no entry point. The owner looked at it with mock data and found the screens visually heavy and the concepts hard to read.

v0.5.0 replaces that world. The goal is that each page says one thing first, then shows the list, then the detail only on demand. Character comes from restraint and precision, not from a metaphor.

The product principles in `PRODUCT.md` do not change: unknown is never zero, overall is always explained by its dimensions, the real risk is the most visible thing, read-only, static-first.

## 2. Goals, non-goals, anti-goals

Goals

- A first viewport that is understood in about three seconds on every page.
- One visual system ("Warm Graphite") applied to all pages: Portfolio, Project, Security, Versions, Workflows, Data quality, Catalog, plus a new "How to read" page.
- A project **score** (0–100) to rank and compare projects, consistent with the health status.
- Unknown / not authorised / blind spots stay explicit and distinct, with a lighter visual treatment than today's hatching.
- WCAG 2.2 AA in light and dark themes; status never by colour alone.

Non-goals

- No history or trend: the score ranks today's snapshot only. A "What changed since last collection" view is roadmap (needs stored snapshots), not v0.5.0.
- No re-implementation of GitHub's alert triage: the full alert list lives in GitHub Security Overview.
- No change to the collector's data sources, permissions or sanitisation.

Anti-goals (failure even if it "works")

- A score that makes a project with an open critical issue look good.
- A score shown for a project whose data we mostly could not read.
- Unknown rendered as zero, as healthy, or as visually calmer than an optional gap.
- A page where colour is the only carrier of status.
- Generic AI-dashboard tells: side-stripe colour borders on cards, glassmorphism, gradient text, decorative KPI tiles with no decision behind them.

## 3. Constraints (unchanged, from the project rules)

- Static Astro site, no runtime backend, no GitHub API calls and no tokens in the browser, read-only by design.
- No external commercial services at runtime: fonts are self-hosted via `@fontsource/*`.
- Bilingual EN (default `/`) and IT (`/it/`): every new string in `src/i18n/en.ts` and `it.ts` (key parity test), every doc in EN and IT.
- Mock data only in the public repo; the private deploy repo builds the same code with real data.
- No real company or customer names anywhere; the protected hosting domain is not mentioned in the public repo.
- Output secret scan stays green: avoid UI strings shaped like `secret: …` / `secret = …` (they trip the `credential-assignment` pattern).

## 4. Decisions taken with the owner

1. **Portfolio = compact list (layout "B").** One row per project, sorted worst first: status dot, name, score, five dimension bars (Delivery, Versions, Security, Coverage, Governance), one-line main reason. Detail lives on the Project page, not in the row.
2. **Score** for ranking and comparing (section 6). It sits next to the status dot; it never replaces the dimensions.
3. **Scope: all sections.** Priority order of work: Portfolio + Project → Security → Versions → Workflows → Data quality → Catalog. Plus a new "How to read" page.
4. **Palette: Warm Graphite** (section 5), chosen over Slate & Signal, Ink & Cobalt, Oat & Indigo and Paper & Ink.
5. **Security = per project ("B")**, with a portfolio summary sentence on top. The hub shows what GitHub does not: grouping by logical project, coverage including non-GitHub controls, declared blind spots. Full alert lists link out to GitHub; only critical and high alerts are listed in the hub (on the Project page).
6. **Project page** as mocked: header with status, score and confidence; "Why it is critical/attention" in sentences; five dimension cards; environments as a DEV → UAT → PROD path; components table; remaining sections collapsed.
7. **"How to read" page** replaces the per-page legend: state meanings, unknown vs not authorised vs not configured vs not applicable, score formula, thresholds. Pages keep a one-line legend with a link to it.
8. **"What changed"** goes to the roadmap, not v0.5.0.
9. **Claude Design is the visual reference.** Warm Graphite is kept as a design system in the owner's Claude Design account (it replaces the earlier design system as the source of tokens), and the owner approved a hi-fi mockup canvas of all seven pages (Portfolio, Project, Security, Versions, Workflows, Data quality, Catalog) on 2026-10-20. Layout, copy tone and component treatment follow that canvas; this document wins where they differ on rules. The canvas links are private and are not committed to this public repository.

## 5. Visual system — Warm Graphite

Tokens are defined in `src/styles/tokens.css` (light + dark, `prefers-color-scheme` with `[data-theme]` override, as today). Values below are the approved mock values; the builder tunes lightness only as needed to pass the contrast test, keeping hue and character.

Neutrals

| Token                                    | Light     | Dark      |
| ---------------------------------------- | --------- | --------- |
| `--bg`                                   | `#f6f5f3` | `#151311` |
| `--surface`                              | `#fffefc` | `#1c1a17` |
| `--surface-2`                            | `#f6f5f3` | `#181614` |
| `--border`                               | `#e7e5e1` | `#2c2925` |
| `--text`                                 | `#1c1917` | `#ece9e4` |
| `--text-muted`                           | `#57534e` | `#a8a29e` |
| `--border-strong` (control borders, 3:1) | `#928d86` | `#746e66` |
| `--unknown` (dashed outline, 3:1)        | `#8f8a83` | `#7f786f` |

Accent (links, focus, primary action only; never status): teal `oklch(0.52 0.09 195)` light, `oklch(0.74 0.1 195)` dark.

Status (fills for dots and bars; `*-text` for text on tints)

| State                     | Light fill / text                                     | Dark fill / text                                |
| ------------------------- | ----------------------------------------------------- | ----------------------------------------------- |
| Critical (red, vermilion) | `oklch(0.6 0.19 35)` / `oklch(0.48 0.16 35)`          | `oklch(0.7 0.17 35)` / `oklch(0.82 0.11 35)`    |
| Attention (amber, ochre)  | `oklch(0.66 0.15 72)` / `oklch(0.47 0.1 65)`          | `oklch(0.8 0.14 80)` / `oklch(0.86 0.1 82)`     |
| Healthy (green, emerald)  | `oklch(0.6 0.12 165)` / `oklch(0.45 0.1 165)`         | `oklch(0.72 0.12 165)` / `oklch(0.82 0.09 165)` |
| Unknown                   | no fill, 1.5px dashed `--unknown` outline, muted text | same                                            |

Pill tints (fixed values, not color-mix, so they can be contrast-tested): red `oklch(0.95 0.03 35)` / `oklch(0.27 0.05 35)`, amber `oklch(0.95 0.05 85)` / `oklch(0.29 0.05 80)`, green `oklch(0.95 0.03 165)` / `oklch(0.27 0.04 165)` (light / dark). Status fills reach 3:1 on `--surface` as graphics (the light amber was darkened to ochre for this); every `*-text` reaches 4.5:1 on its tint and on `--surface`.

Status pills placed before text (list reasons, workflow rows) sit in a fixed-width column so the text after them always starts at the same x, whatever the label length (owner feedback on the mockup). Severity keeps its own scale (critical / high / medium / low), never drawn with health tones; the builder may reuse the red/amber hues for critical/high badges as text labels, with the bar glyph or label always present.

Typography: **IBM Plex Sans** (400/500/600/700) for everything, tabular figures for scores and counts; **IBM Plex Mono** (400/500) only for code, repository names and versions. Replace `@fontsource/public-sans` and `@fontsource/geist-mono` with `@fontsource/ibm-plex-sans` and `@fontsource/ibm-plex-mono`. Body text ≥ 14px, line height ≈ 1.5; small labels ≥ 12px.

Shape and space: radius 8px (controls, pills 999px), 10px (cards, tables); 1px borders; no heavy shadows; no side-stripe borders; generous padding (pills ≥ 4px × 10px, cells ≥ 8px × 10px).

Status symbols (coverage and controls), used everywhere with the same meaning: ✓ enabled · ! required but not configured · ⧖ stale scan · ? not visible (not authorised / unknown / collection failed) · ✕ scan failed (the control ran and failed) · – not required / not applicable. Six symbols in all; "How to read" and the Security legend list all six. Each symbol has an accessible name; colour is secondary.

Removed from v0.4.0: `--hatch`, `--hatch-void`, `--frame` brown, grid references, sheet neatline, margin notes, sheet legend variant, Public Sans.

## 6. Score

Purpose: rank and compare projects in today's snapshot. Computed by the collector (new evaluator alongside the health evaluators), published in the snapshot, only rendered by the site.

Formula (my call, documented and configurable):

- Points per measured dimension: green 100, amber 60, red 20. Grey (not measured) is excluded, never counted as 0.
- Weighted mean over measured dimensions. Default weights: delivery 25, version 15, security 30, coverage 15, governance 15.
- **Caps keep the number consistent with status:** overall red → score ≤ 49; overall amber → score ≤ 89; overall grey (some required dimension unknown, none red or amber) → score ≤ 89 as well, so a partly unreadable project never ranks with fully healthy ones (my call). Any red project is therefore always below any amber or grey one.
- A green project is always 100 (green requires every required dimension green). This is intended (my call): the score separates the projects that need attention; healthy ones tie at the top and are ordered by name.
- **Not applicable is not unknown** (my call): a dimension that is grey only because there is nothing to measure (e.g. delivery reason `no-critical-workflows`) is excluded from both `measured` and `required`, so it neither lowers confidence nor pushes a project into "insufficient data". Grey for any other reason (not authorised, unknown, collection failed) counts as not measured.
- **Confidence:** `measured / required` dimensions, shown next to the score ("measured 4 of 5").
- **Insufficient data:** if fewer than half of the required dimensions are measured, no number: the site shows "— insufficient data" and sorts these projects in their own group, never at the bottom as if they were fine.
- Rounded to an integer.

Mock outcome (sanity check): Beta ≈ 38, Alpha ≈ 76, Platform ≈ 88, Gamma = insufficient data.

Configuration: optional `score` block in `config/policies.yaml` (`weights`, `points`, `caps`, `minMeasuredRatio`) with the defaults above, so policies `schemaVersion` stays `1.0`. Snapshot schema bumps to **1.3**: `PortfolioIndex` project summary and `ProjectSnapshot` gain `score: { value: number | null, measured: number, required: number }`. Docs (EN + IT) describe the formula; the "How to read" page shows it.

## 7. Pages

All pages: one dominant sentence or block at the top, then the list sorted worst first, detail on demand. Header keeps nav, theme toggle and language switch. Mobile: rows wrap (name + status + score on line one, bars + reason on line two); no horizontal page scroll; tables that cannot wrap scroll inside their own container.

**Portfolio.** Title + one sentence ("3 of 4 projects need attention"), counts as filter buttons (critical, attention, healthy, unknown). Filters: search, status, business unit, sort (score default) inline; lifecycle and severity under "More filters". List columns: status dot, project (link), score with confidence on hover/secondary text, five dimension bars with labels once in the header and an accessible name per bar, main reason. Unknown project row: dashed dot and dashed bars, reason states the cause ("2 collection errors"), link to data quality. One-line legend under the list with link to "How to read". Footer: collected at (UTC), "synthetic data" when mock.

**Project.** Breadcrumb; header with name, status pill, score and confidence, business unit, lifecycle, coordinator; "Why it is <status>" box listing red reasons first as sentences with links; five dimension cards (status, one-line summary, link to its section); environments path DEV → UAT → PROD with version and aligned/behind; components table (version and drift, CI, alerts, coverage symbols); collapsible sections: Workflows, Security (critical and high alerts listed with links, others as counts + "Open in GitHub"), Coverage per control, Collection errors.

**Security.** Summary sentence ("1 open critical alert · 3 required controls we cannot see"); portfolio severity totals with an "incomplete counts" note when any project is partly unreadable; one card per project, worst first: status, coverage "2 of 4 required", severity counts, blind spots as explicit chips, control symbols, links to the project and to GitHub. Portfolio coverage matrix as a secondary, collapsed section. No full alert table.

**Versions (as mocked).** Summary sentence ("2 projects have PROD behind · 1 declared version does not match"); one card per project, worst first: coordinator version and its source, environments path, then a "To check" table only for problems (manifest vs submodule vs latest release, unmapped submodule with a link to the catalog), each explained in a sentence; aligned components collapsed into one line; fully aligned projects are a single line; unknown projects a dashed card with the cause.

**Workflows (as mocked).** Summary sentence; only catalog-critical workflows; per project, worst first, the problem rows only: fixed-width status pill (failed, missing, stale, not visible), workflow name and file, repository, what happened with a link; successful ones collapsed into a count; all-green projects a single line. A note states the portal reads runs and never triggers them.

**Data quality (as mocked).** Summary sentence; repository counts (in catalog, fully read, partly read, unreadable); "What we could not read, by cause" grouped by classification (403, 404 with the note that a 404 may mean missing access) listing project, source, repositories, plus how to fix (grant read access); stale sources with age; unmapped submodules with a catalog link; collection capabilities as pills; run details collapsed last.

**Catalog (as mocked).** Same behaviour as today (edit in the UI, propose as a pull request, discovery only proposes, nothing saved, no GitHub calls). Side list of projects with pending-change badge and "New project", discovered repositories with "Use"; form with fieldsets General, Project type (segmented radios with help), Components (rows with remove), Environments, Workflows, Security controls; a "Proposal" box with validation pill, change summary and actions, primary "Propose on GitHub" (accent), "Download YAML", "Discard changes".

**How to read (new).** State meanings, the six symbols, the distinctions unknown / not authorised / not configured / not applicable, the score formula and caps, thresholds summarised from `policies.yaml`, link to docs. EN + IT, in nav as a secondary link (footer or header utility).

## 8. Left to the builder

- Responsive details the mockups do not show (phone layouts), within section 7's rules.
- Final lightness tuning of tokens if the contrast test disagrees with the computed values.
- Icon drawing for status dots and symbols (SVG, consistent stroke).
- Component split (e.g. `ScoreBadge`, `DimensionBars`, `ControlSymbol`, `ReasonList`) and CSS organisation.
- Whether score confidence is a tooltip, secondary text, or both (must be accessible without hover).

## 9. Verification

- Unit: score evaluator (weights, caps, grey exclusion, insufficient data, rounding) with the mock projects; contrast test extended to the new tokens and tints in both themes; i18n key parity.
- Golden snapshots regenerated (schema 1.3); unsupported-schema test still passes.
- Integration: build contains all pages including "How to read"; output secret scan clean.
- E2E (Playwright, desktop + mobile): Portfolio filters and sort, unknown row rendering, project page sections open/close, keyboard focus.
- Claude Design verification round: built pages compared with the approved canvas; owner comments addressed before release.
- Design checks: impeccable critique on Portfolio compared with v0.4.0's 25/40; `web-design-guidelines` audit; screenshots at 375, 768, 1280 px in light and dark reviewed before release.
- Regenerate `DESIGN.md` and `.impeccable/design.json` from the shipped build; update the surface brief; README (EN + IT) and CHANGELOG.
- Done means (my call): impeccable critique on Portfolio ≥ 32/40 with no open P0/P1 issue; `web-design-guidelines` audit with no accessibility or focus finding left; contrast, unit, integration and e2e suites green; screenshots reviewed by the owner.

## 10. Release

v0.5.0 from `feat/ui-redesign-v0.5.0` via PR (owner merges; owner sets any secrets). After merge, Claude creates the GitHub release `v0.5.0`, then bumps the reusable workflow SHA and `hub-ref` in `.github/workflows/deploy-hub.yml` of the private deploy repository (same flow as v0.3.0) and verifies the deploy run and the access-protected redirect. v0.4.0 is not deployed to the protected site (owner's choice).
