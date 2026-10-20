---
version: 2
slug: "src-pages-lang-index-astro"
primary_target: "src/pages/[...lang]/index.astro"
related_targets: ["src/layouts/Base.astro","src/styles/tokens.css","src/styles/global.css","src/components/StatusDot.astro","src/components/ScoreBadge.astro","src/components/DimensionBars.astro","src/components/ControlSymbol.astro","src/components/Legend.astro"]
---

# Surface brief: Portfolio (and shared shell)

Scope: Portfolio page (`/`, `/it/`) as the first surface of the Warm Graphite system; the shell, tokens and shared components (status dot, score, dimension bars, control symbol, one-line legend) carry it to Project, Security, Versions, Workflows, Data quality, Catalog and How to read. Visitor mode: Operate.
Audience and job: engineering leads in a weekly portfolio review; find which project is at risk, why, and what is not known, in about three seconds. Constraints: read-only static site, EN/IT, WCAG 2.2 AA in light and dark, no JS beyond filters, relative time and theme, CSP `script-src 'self'`, fonts self-hosted via `@fontsource`.
Unresolved: "What changed since last collection" (needs stored snapshots, roadmap); URL-synced filters (P2).

## Direction contract

THESIS: Legibility first. The page says one thing ("3 of 4 projects need attention"), then lists projects worst first, then leaves the detail to the project page. Character comes from restraint and precision, not from a metaphor. Refuses decorative KPI tiles, side-stripe cards, gradients and glass.

OWN-WORLD: Warm neutral greys (ground `#f6f5f3`, surface `#fffefc`, ink `#1c1917`), one teal accent for links, focus and the primary action only, vermilion / ochre / emerald for status fills with darker text variants on fixed tints. Unknown is a 1.5px dashed outline with the cause in words, never a fill and never zero. IBM Plex Sans with tabular figures; IBM Plex Mono only for code, repositories and versions. 8px controls, 10px lists and cards, 999px pills, 1px hairlines, no shadows.

STORY: The lead reads the sentence, sees Beta first with a red dot, score 38 and two red bars, reads its one-line reason, notices Gamma right after it with a dashed dot, "— insufficient data" and "2 collection errors", and opens Beta from the row.

FIRST VIEWPORT: Standard top nav (Portfolio, Security, Versions, Workflows, Data quality, Catalog; "How to read", theme and language at the right). Title with the lead sentence on the left and the four status counts as filter buttons on the right. One inline filter row (search, status, business unit, sort by score) with lifecycle and severity under "More filters". The list dominates: status dot, project, score with "measured n of m", five dimension bars with labels once in the header, main reason. One-line legend under the list links to How to read.

FORM: Compact list (one row per project, sorted worst first by score; insufficient-data projects grouped right after the critical ones, never at the bottom). Rows wrap into two lines at phone width without horizontal page scroll.

SCORE: 0–100 from the collector, weighted mean of measured dimensions, capped by status (red ≤ 49, amber and grey ≤ 89); confidence always visible as text; fewer than half measured shows an em dash and "insufficient data".

FINISH: unreviewed and undocumented is unfinished; this build ends with the critique on Portfolio (target ≥ 32/40, no open P0/P1), the web interface guidelines audit, screenshots at 375, 768 and 1280 px in light and dark, and DESIGN.md plus `.impeccable/design.json` regenerated from the shipped code.
