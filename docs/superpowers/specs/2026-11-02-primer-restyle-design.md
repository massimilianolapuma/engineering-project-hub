# Primer restyle — the hub looks like a part of GitHub

Italiano: [../../it/superpowers/specs/2026-11-02-primer-restyle-design.md](../../it/superpowers/specs/2026-11-02-primer-restyle-design.md)

Status: approved by the owner on 2026-11-03 · Date: 2026-11-02 · Target release: v0.10.0 (released before the supply chain work)

## 1. Intent and why

The hub fills gaps in GitHub's own reporting: portfolio health by logical project, versions across environments, coverage of controls GitHub cannot see, supply chain evidence. A review of what GitHub publishes (built-in Copilot metrics and Security overview, the OSPO actions in `github-community-projects`, `org-metrics-dashboard`) found nothing that covers this scope, so the hub stays.

The owner wants people who open the hub next to a GitHub tab to feel it is the same product: same style, colours, icons and page structure, as if it were a natural extension of GitHub. The way to get there is GitHub's own open design system, **Primer** (MIT): its design tokens (`@primer/primitives`) and icons (Octicons).

This is **phase 1: a restyle**. Content, pages, data and rules stay as they are today. The owner will try the restyled hub at work and only then reopen structure and content (phase 2).

`PRODUCT.md` principles do not change: unknown is never zero, overall is always explained by its dimensions, the real risk is the most visible thing, read-only, static-first.

## 2. Goals, non-goals, anti-goals

Goals

- Every page looks like a GitHub page: Primer colours in light and dark, GitHub's system font stack, Octicons, GitHub-style header with underline tab navigation, bordered boxes, issue-list-style rows, Label and Counter badges, GitHub buttons.
- Warm Graphite is fully replaced: `tokens.css` is rebuilt on Primer tokens, `global.css` and every component use them, IBM Plex is removed.
- The **Portfolio score** (0–100, caps, confidence, insufficient data) and **all charts** (sparkline, dimension bars, status strip, trend, coverage meter) are kept with the same data and meaning; only their look changes.
- WCAG 2.2 AA in light and dark; status never by colour alone (symbol or label always present).
- The UI works the same under any hosting (Cloudflare Pages + Access today, GitHub Pages private later).

Non-goals (phase 1)

- No change to pages, sections, their order, copy, data, the snapshot schema or the collector. Restructuring is phase 2, after the owner's feedback.
- No change to the login. The move from Cloudflare Access to GitHub Pages with private visibility (GitHub Enterprise Cloud: org membership + SAML SSO, no Cloudflare, no OAuth App) is a separate project, done when the hub moves into the company organisation.
- No extra Primer themes (dimmed, high contrast, colourblind) in phase 1: light and dark only.
- No React, no Primer React, no `@primer/css`.

Anti-goals (failure even if it "works")

- **Passing as GitHub.** The hub looks like GitHub but never claims to be GitHub: no Octocat or GitHub logo, no "GitHub" as the product name, no "official". The hub keeps its own name with an Octicon as its mark. A page that impersonates GitHub is a trademark and phishing risk.
- Unknown rendered as zero, as healthy, or calmer than an optional gap (the dashed "unknown" treatment survives the restyle).
- A score that changes value or meaning because of the restyle.
- Colour as the only carrier of status.
- A half-migrated look: Warm Graphite hues, IBM Plex or old icons left on any page.

## 3. Constraints (from the project rules)

- Static Astro site, no runtime backend, no GitHub API calls and no tokens in the browser, read-only.
- No external services at runtime. CSP stays as in `src/layouts/Base.astro` and `public/_headers` (`script-src 'self'`, `img-src 'self' data:`, `font-src 'self'`, `connect-src 'self'`). Primer tokens and Octicons are bundled at build time; the system font stack needs no font files.
- Bilingual EN (default `/`) and IT (`/it/`): every new string in `src/i18n/en.ts` and `it.ts` (key parity test), every doc in EN and IT.
- Mock data only in the public repo; no real company names; protected hosting domain not mentioned.
- Output secret scan stays green (avoid UI strings shaped like `secret: …`).
- Dependencies pinned to exact versions, like the rest of `package.json`.

## 4. Decisions taken with the owner

1. **Primer replaces Warm Graphite** as the design system (owner, 2026-11-02).
2. **Keep the Portfolio score and the charts**; everything else is open for discussion, but only after the restyle is finished and tried at work (owner).
3. **Login:** Cloudflare Access with GitHub login stays while the hub is a personal project; it will be replaced by GitHub's official method inside the company organisation (owner). Phase 1 must not depend on Cloudflare.
4. **Design-first in Claude Design** (standing owner rule): Primer design system and page mockups in Claude Design, owner review, then code. The Claude Design links are private and are not committed.
5. **Restyle first** (owner, 2026-11-02): the restyle branches from `main` (v0.9.0 pages) and is released before the supply chain site work. The supply chain UI (Task 9 of `docs/superpowers/plans/2026-10-21-supply-chain-providers.md`) is then built straight in Primer, with its mockups in the Primer design system; no Warm Graphite artboards are made for it.
6. **Skills** (owner-confirmed): Claude Design, `impeccable`, `ui-ux-pro-max:design-system`, `dataviz`, `color-expert`, `web-design-guidelines`, `design:accessibility-review`. `frontend-design` is excluded (it pushes towards a distinctive look, the opposite of matching GitHub).

## 5. Visual system — Primer

### 5.1 Packages (my call)

- `@primer/primitives` (exact pin): import the CSS token files needed (functional colour themes light and dark, size, typography) from `src/styles/tokens.css`. Components use Primer functional tokens directly (`--fgColor-default`, `--bgColor-muted`, `--borderColor-default`, …).
- `@primer/octicons` (exact pin, the plain SVG package): an `Octicon.astro` component renders the SVG at build time. No runtime JS.
- Remove `@fontsource/ibm-plex-sans` and `@fontsource/ibm-plex-mono`.

### 5.2 Theme

Primer's mechanism replaces `[data-theme]`: `data-color-mode="auto|light|dark"` with `data-light-theme="light"` and `data-dark-theme="dark"` on `<html>`. The existing theme toggle (auto / light / dark) and `public/theme-init.js` keep their behaviour and storage, now writing `data-color-mode`. `theme-color` meta values follow Primer's page background.

### 5.3 Token mapping (my call; the Claude Design mockups may refine it)

| Hub role                                      | Primer token(s)                                                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Page background / box background / sunk areas | `--bgColor-default` / `--bgColor-default` / `--bgColor-muted`                                                                        |
| Borders / strong control borders              | `--borderColor-default` / `--borderColor-emphasis`                                                                                   |
| Text / secondary text                         | `--fgColor-default` / `--fgColor-muted`                                                                                              |
| Links, focus ring, selected tab underline     | `--fgColor-accent`, `--focus-outlineColor`, `--underlineNav-borderColor-active`                                                      |
| Primary action (e.g. "Propose on GitHub")     | Primer primary button (green), as on GitHub                                                                                          |
| Critical / attention / healthy                | `danger` / `attention` / `success` families (`--fgColor-*`, `--bgColor-*-muted`, `--bgColor-*-emphasis`, `--borderColor-*-emphasis`) |
| Unknown                                       | no fill, dashed `--borderColor-emphasis` outline, `--fgColor-muted` text (kept distinct from every state)                            |
| Severity critical / high / medium / low       | `danger` / `severe` / `attention` / neutral Labels, always with the word                                                             |
| Charts, categorical series                    | Primer data-visualisation tokens (`--data-<colour>-color-emphasis` / `-muted`); status-encoded marks use the status families above   |

The primary button being green while "healthy" is also green follows GitHub; it is acceptable because status always carries a symbol or label.

Exact token names are checked against the pinned `@primer/primitives` version; where a name differs, the builder picks the closest functional token and records it in `DESIGN.md`.

### 5.4 Typography and shape

- Font: Primer stacks `--fontStack-system` and `--fontStack-monospace`. Body 14px, line height per Primer; monospace for code, repository names and versions (as today). Tabular figures for scores and counts.
- Radius, spacing and borders from Primer size tokens (radius 6px on boxes and buttons, pills full). No shadows except Primer overlay shadows on menus.
- Content width: GitHub's large container (1280px max) with GitHub's gutters.

### 5.5 Icons

Every icon and status symbol becomes an Octicon with an accessible name. The six coverage symbols keep their meanings; proposed mapping (mockups confirm): enabled `check-circle`, required but not configured `alert`, stale scan `clock`, not visible `question`, scan failed `x-circle`, not applicable `dash`. Other icons follow GitHub usage (repo, workflow, shield, package, git-branch, rocket for deployments).

**Every symbol set moves to Octicons, not only coverage** (my call): the repository-controls marks (`RepositoryControlsSection.astro`), the stale mark in `QualitySection.astro`, all sets in `src/lib/symbols.ts`, and later the supply-chain evidence symbols (verified, present, missing/failed, unknown, not applicable), which follow the same rules when Task 9 is built. Rules: within one set every meaning has a **distinct shape**, not only a distinct colour (e.g. verified `verified` vs present `dot-fill`); unknown keeps the dashed treatment; every symbol keeps its visually hidden text. Tests that assert glyph characters (e.g. `⧖` in `tests/integration/site.test.ts`) are rewritten to assert the accessible name or a `data-symbol` attribute, not the glyph.

## 6. Page shell and components

### 6.1 Shell (counts as look, not structure: no page moves)

- **Header** as on current github.com, in both themes: hub Octicon mark + "Engineering Project Hub" on the left; on the right "How to read", theme toggle, language switch, and the optional identity slot (6.3).
- **Underline navigation** under the header, like a repository's tabs: the existing nav items in today's order, each with an Octicon. **No Counters on tabs in phase 1** (my call): choosing a number per tab is a content decision, deferred to phase 2. Current page has the active underline. Mobile: the tab row scrolls sideways, as on GitHub.
- **Run bar and stale banner stay** with the same content and visibility (my call: moving them would be a content change and would hide the risk): data source (synthetic when mock), last run as relative time with stale state, authentication mode. They sit directly under the underline navigation, styled as a GitHub subhead line with Labels; the stale banner becomes a Primer Flash (warning) with `role="status"` kept.
- **Footer** as on GitHub: links as today, and a short line "Not affiliated with GitHub · built with Primer" (EN/IT). It does not repeat the run bar.

### 6.2 Components (same props and behaviour, new look)

| Today                                                                        | Becomes                                                                                                                                      |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Cards, sections, tables                                                      | Primer Box: header row, rows separated by borders, issue-list rows for project lists                                                         |
| `Pill`, `StatusBadge`, `RiskPill`                                            | Primer Label (status variants), severity Labels                                                                                              |
| Counts                                                                       | Primer Counter                                                                                                                               |
| Buttons and filter buttons                                                   | Primer Button (default, primary, invisible) and SegmentedControl-like filter group                                                           |
| Collapsible sections                                                         | `<details>` styled as Primer Details/Box                                                                                                     |
| Breadcrumb                                                                   | Primer Breadcrumbs                                                                                                                           |
| Environments path DEV → UAT → PROD                                           | Primer Timeline-like horizontal steps (mockups decide)                                                                                       |
| `ScoreBadge`                                                                 | Same value and rules, Primer Label/Counter style, confidence as muted text                                                                   |
| `DimensionBars`, `Sparkline`, `StatusStrip`, `TrendSection`, `CoverageMeter` | Same SVG forms and data; colours from 5.3; gridlines and axes in `--borderColor-muted` / `--fgColor-muted`; Primer ProgressBar look for bars |
| `StatusDot`, `StatusIcon`, `ControlSymbol`                                   | Octicons (5.5) with status colour, accessible name unchanged                                                                                 |
| Catalog form                                                                 | Primer FormControl look (labels, inputs, selects, radio groups, validation messages)                                                         |

### 6.3 Optional identity slot (my call)

When the hosting exposes the signed-in user, the header shows their name (and initials in a circle), like GitHub's avatar position. Enabled at build time by a public setting (e.g. `PUBLIC_IDENTITY_SOURCE=cloudflare-access`), off by default (public demo, GitHub Pages). With Cloudflare Access a small same-origin script reads `/cdn-cgi/access/get-identity` (allowed by `connect-src 'self'`). No avatar image: GitHub avatars are cross-origin and the CSP stays `img-src 'self' data:`. If the call fails or the setting is off, the slot is empty and nothing breaks. Under future GitHub Pages private hosting there is no identity API, so the slot stays empty.

## 7. Process and deliverables

1. **Claude Design** — create a "Primer (hub)" design system from `@primer/primitives` light and dark values and the component list in 6.2; archive Warm Graphite as historical. Mockup canvas: all 9 pages (Portfolio, Project, Security, Versions, Workflows, Changes, Data quality, Catalog, How to read) in light, plus Portfolio and Project in dark and Portfolio at phone width. Owner review and approval before any code.
2. **Build** — tokens, shell, components, pages, in the order Portfolio + Project → Security → Versions → Workflows → Changes → Data quality → Catalog → How to read.
3. **Tests** — rewrite `tests/unit/tokens-contrast.test.ts` for Primer: it resolves the Primer values the hub uses (light and dark) and checks text 4.5:1, graphics and the unknown outline 3:1. Existing unit, integration and e2e tests stay green; e2e selectors updated only where markup changes. Visual check with Playwright in both themes and at phone width.
4. **Review** — `web-design-guidelines` and `design:accessibility-review` on the built pages; `impeccable` critique against the approved mockups.
5. **Docs** — `DESIGN.md` regenerated from the shipped build (impeccable documenter); ADR 0009 "Primer as the design system" (EN + IT); README and CHANGELOG; "How to read" updated for the new symbols. After any UI fix, update the Claude Design canvas and DS README too (standing owner rule).
6. **Release** — v0.10.0; the owner tries it at work and collects feedback for phase 2.

### 7.1 Sequencing with the supply chain work (my call, following decision 5)

- The restyle takes version **v0.10.0** and the next free ADR number at merge time (**0009**). The supply chain work moves to **v0.11.0**, and its plan's ADRs become 0010 and 0011. When `feat/supply-chain-providers` is rebased on the restyled `main`, its plan and spec are updated for the new version, ADR numbers, and "Primer tokens" instead of "Warm Graphite tokens" in Task 9.
- Collector-only commits already on `feat/supply-chain-providers` do not touch the site and are unaffected.

## 8. Left to the builder

- Exact Primer token names per role, within the mapping in 5.3, recorded in `DESIGN.md`.
- Which Octicon for each nav item and non-status icon.
- How Primer CSS files are imported (only the needed themes and size files, to keep CSS small).
- Whether `global.css` is split per component; class naming.
- Exact responsive breakpoints, following Primer's breakpoints.

## 9. Follow-ups (not in this project)

- **Supply chain v0.11.0**: rebase, then Task 9 built in Primer (7.1).
- **Phase 2 — structure and content**, from the owner's feedback at work. Score and charts are kept.
- **Login migration** to GitHub Pages with private visibility in the company organisation (GitHub Enterprise Cloud, SAML SSO).
- **GitHub App** stays the collector's identity; moving it into the company organisation is part of the login migration.
- Extra Primer themes (dimmed, high contrast, colourblind) if requested.
