---
version: 1
slug: "src-pages-lang-index-astro"
primary_target: "src/pages/[...lang]/index.astro"
related_targets: ["src/layouts/Base.astro","src/styles/tokens.css","src/styles/global.css"]
---

# Surface brief: Portfolio (and shared shell)

Scope: Portfolio page (`/`, `/it/`) as first surface of a replacement visual world; the shell, tokens and shared components carry the world to every other page. Visitor mode: Operate.
Audience and job: engineering leads in a weekly portfolio review; find which project is at risk, why, and what is not known. Constraints: read-only static site, EN/IT, WCAG 2.2 AA, no JS beyond existing filters, CSP `script-src 'self'`, fonts self-hosted.
Unresolved: per-page worst-first ordering and URL-synced filters (P2, out of scope for this round).

## Direction contract

THESIS: The portfolio is a surveyed territory. Every project × dimension cell is ground that was measured (inked by status) or not surveyed (hatched and named). Refuses the category default of a KPI-tile row over a table of rounded status pills.

OWN-WORLD: Sheet white ground, linework ink, contour brown for the sheet frame, grid references and margin furniture, water blue for links and focus, road red for Critical, ochre for Attention, woodland green for Healthy, a 45° survey hatch for Unknown and blind spots. Square-cornered cells and chips, hairline rules, Public Sans with tabular figures, small tracked uppercase for grid references and legend heads. Status keeps its shape icons.

STORY: The lead sees the sheet, reads Beta's red row and its B1 note, sees Gamma as a hatched "not surveyed" band, and opens the project from the row.

FIRST VIEWPORT: Standard top nav. Title line with counts that act as filters. Compact filter row. The sheet dominates: grid letters A–F across (Overall, Delivery, Version, Security risk, Coverage, Governance), row numbers down, each cell = status chip + one-line reason; all-unknown rows collapse into one hatched band. Right margin: legend and sheet notes keyed by grid reference.

FORM: Survey Sheet (IGM 1:25,000 sheet grammar), position 1 on the ordered list, chosen as IMPECCABLE’S PICK. seed:6cd4b101f4994421

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
