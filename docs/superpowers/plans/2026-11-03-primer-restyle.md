# Primer restyle (v0.10.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Warm Graphite design system with GitHub Primer (`@primer/primitives` tokens + Octicons) so every page looks like a part of GitHub, without changing pages, data, score or charts.

**Architecture:**

- **Design first:** a Primer design system and a mockup canvas in Claude Design, approved by the owner before any code (Task 0). Approved deviations are recorded in this plan's "Mockup decisions" section and win over the defaults below.
- **Tokens:** `src/styles/tokens.css` imports Primer CSS (base size and typography, functional size and typography, light and dark themes). A one-off codemod replaces every legacy token (`--text`, `--space-2`, `--red-tint`, …) with its Primer token across `src/`. Theme switching moves to Primer's `data-color-mode`.
- **Icons:** a pure `octiconSvg()` helper wraps `@primer/octicons`; `Octicon.astro` renders it at build time. Every symbol set moves to Octicons.
- **Look, not structure:** class names and markup hooks used by tests stay; components and pages are restyled through `global.css` and scoped styles. Only the shell (header, underline nav, run bar, footer) gets new markup.

**Tech Stack:** Astro 7, TypeScript 6, Vitest, Playwright. New dependencies: `@primer/primitives` 11.10.0, `@primer/octicons` 19.40.0. Removed: `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono`.

**Spec:** `docs/superpowers/specs/2026-11-02-primer-restyle-design.md` (IT mirror under `docs/it/`). Read it first. Section numbers (§) refer to the spec.

## Before you start

- Branch `feat/primer-restyle` from `main` (v0.9.0), already created with the spec commit. Supply chain work (`feat/supply-chain-providers`) is **not** merged and must not be: this release goes first (§4 decision 5, §7.1).
- Task 0 is a gate: Tasks 1–8 do not start until the owner approves the mockups.

## Global Constraints

- Restyle only: no change to pages, sections, order, copy (except the new strings below), data, snapshot schema, collector, score values or chart data (§2).
- No React, no Primer React, no `@primer/css`. Exact pins: `"@primer/primitives": "11.10.0"`, `"@primer/octicons": "19.40.0"`.
- CSP unchanged (`src/layouts/Base.astro` and `public/_headers`): `script-src 'self'`, `img-src 'self' data:`, `connect-src 'self'`. No CDN, no web font download: the Primer system stack falls back to OS fonts.
- Components use Primer functional tokens directly. After Task 1, `src/` contains **no** legacy token names and **no** hex / `oklch()` / `rgb()` colour literals outside SVG `fill="currentColor"`. The only hub-specific custom property left is `--status-col`.
- Unknown keeps no fill and a dashed `--borderColor-emphasis` outline with `--fgColor-muted` text, everywhere (§5.3).
- Status never by colour alone: every status mark keeps its visually hidden text or `aria-label`.
- No GitHub logo, no Octocat, no "GitHub" as product name, no "official" (§2 anti-goals).
- Every UI string EN + IT (`tests/unit/i18n.test.ts` parity). Every new or changed doc EN + IT (plans excepted, as before).
- **Never run `npm run ci:build` or `npm run collect:mock`**: they overwrite `public/data` (the owner's real snapshot, git-ignored). Site tests build from `fixtures/snapshots`. Manual build: `SNAPSHOT_DIR=fixtures/snapshots npx astro build --outDir "$(mktemp -d)"`.
- Never use or kill port 4321. For e2e: `sed 's/4321/4377/g' playwright.config.ts > playwright.tmp.config.ts && npx playwright test -c playwright.tmp.config.ts`, then delete `playwright.tmp.config.ts` (and `.e2e-dist/`), never commit them.
- Commits: Conventional Commits, `git -c user.name=massilp -c user.email=3519719+massilp@users.noreply.github.com commit`, no attribution trailers. `npx prettier --write` on touched files before each commit. Do not push until Task 8.
- After any UI change that diverges from the approved canvas, update the Claude Design canvas and the Primer DS README too (standing owner rule). Claude Design links never go into the repo.

## Review Focus

1. **No JS / blocked storage.** Primer themes only apply under `[data-color-mode][data-light-theme|data-dark-theme]`. If the attributes are set only by script, a page with JS off or storage blocked renders unstyled. Expected: `<html>` is server-rendered with `data-color-mode="auto" data-light-theme="light" data-dark-theme="dark"`. Pinned in Task 1.
2. **Saved preference from v0.9.0.** A visitor with `localStorage['eph-theme'] = 'dark'` keeps dark after upgrade; any other stored value falls back to auto. Pinned in Task 1.
3. **Translucent dark tints.** Primer dark `bgColor-*-muted` and `borderColor-muted` are alpha colours. Expected: status text stays ≥ 4.5:1 on its tint composited over both `bgColor-default` and `bgColor-muted`. Pinned in Task 1.
4. **Windows high contrast.** Octicons use `currentColor`; the unknown outline must stay dashed and visible under `forced-colors: active`. Pinned in Task 2.
5. **Identity endpoint misbehaves.** Cloudflare Access may answer `/cdn-cgi/access/get-identity` with an HTML login page, a 401, or JSON without a name. Expected: the slot stays empty, nothing throws, nothing shifts. Pinned in Task 3.

## Mockup decisions

_Filled in at the end of Task 0 with every approved deviation from this plan (icon names, layout of the environments path, score badge look, nav icons, brand mark). Later tasks read this section first._

---

### Task 0: Primer design system and mockups in Claude Design (owner gate)

**Files:** none in the repo, except this plan's "Mockup decisions" section.

**Interfaces:**

- Produces: an approved Claude Design canvas (9 pages light, Portfolio + Project dark, Portfolio at 390px) and the filled "Mockup decisions" section.

- [ ] **Step 1: Load the confirmed skills' guidance.** Invoke `ui-ux-pro-max:design-system` and `impeccable` (shape mode) for the DS; `dataviz` for chart artboards; `color-expert` for light/dark status pairs.
- [ ] **Step 2: Read the current references.** `DESIGN.md`, `PRODUCT.md`, spec §5–§6, and the existing Warm Graphite canvas in Claude Design (from the owner's memory notes) for page content. Use real mock-data content from `fixtures/snapshots`.
- [ ] **Step 3: Create the "Primer (hub)" design system in Claude Design** from `@primer/primitives` 11.10.0 values (light and dark themes, size, typography) and the component list in spec §6.2. Mark Warm Graphite as historical in its README.
- [ ] **Step 4: Build the mockup canvas.** Artboards: Portfolio, Project, Security, Versions, Workflows, Changes, Data quality, Catalog, How to read (light); Portfolio and Project (dark); Portfolio at 390px. Shell per spec §6.1 (header, underline nav with Octicons and no Counters, run bar under the nav, Flash for stale, footer line). Symbols per spec §5.5.
- [ ] **Step 5: Owner review.** Share the canvas, wait for comments, iterate until the owner approves. Do not start Task 1 before approval.
- [ ] **Step 6: Record the decisions.** Fill "Mockup decisions" above (icon names per nav item and per symbol, brand mark Octicon, env path treatment, score badge treatment, anything that overrides a default here).
- [ ] **Step 7: Commit.**

```bash
git add docs/superpowers/plans/2026-11-03-primer-restyle.md
git -c user.name=massilp -c user.email=3519719+massilp@users.noreply.github.com commit -m "docs(plan): record approved Primer mockup decisions"
```

---

### Task 1: Primer tokens, legacy token codemod, theme mechanism, contrast test

**Files:**

- Modify: `package.json`, `package-lock.json` (add the two Primer packages, remove the two `@fontsource/ibm-plex-*`)
- Rewrite: `src/styles/tokens.css`
- Modify: every file under `src/` that uses a legacy token (24 files; `global.css`, components, pages)
- Modify: `src/layouts/Base.astro` (`<html>` attributes, `theme-color` metas), `public/theme-init.js`, `src/scripts/theme-toggle.ts`
- Rewrite: `tests/unit/tokens-contrast.test.ts`
- Create: `tests/unit/legacy-tokens.test.ts`
- Modify: `tests/e2e/smoke.spec.ts` (theme test, lines ~104–115)
- Test: `tests/integration/site.test.ts` (html attributes)

**Interfaces:**

- Produces: Primer tokens available on every page; `document.documentElement.dataset.colorMode` is `'auto' | 'light' | 'dark'`; storage key stays `eph-theme`.

- [ ] **Step 1: Write `tests/unit/legacy-tokens.test.ts` (failing).**

```ts
// Walks src/**/*.{astro,css,ts}. Fails on any legacy token or colour literal.
const LEGACY = /var\(--(bg|surface|surface-2|border|border-strong|text|text-muted|unknown|accent|on-accent|accent-tint|(red|amber|green)(-text|-tint)?|space-\d|radius-(sm|md|lg|pill)|font-(sans|mono)|fs-[a-z]+)\)/;
const LITERAL = /#[0-9a-f]{3,8}\b|oklch\(|rgba?\(/i;
it('src uses no legacy Warm Graphite token', ...)          // expect no file matches LEGACY
it('src has no colour literals (Primer tokens only)', ...) // expect no match of LITERAL in css/style blocks
it('tokens.css imports Primer and keeps only --status-col', ...) // imports the 8 files of Step 4; no other custom property
it('IBM Plex is gone', ...)                                 // package.json and src contain no "ibm-plex"
```

- [ ] **Step 2: Rewrite `tests/unit/tokens-contrast.test.ts` (failing until Step 4).** Read `node_modules/@primer/primitives/dist/css/functional/themes/{light,dark}.css`, take the first selector block of each, resolve `var(--x)` references within the file, parse `#rrggbb` and `#rrggbbaa` (alpha composited over the given background). Keep the existing luminance/contrast helpers (drop oklch). Assertions, both themes:

| Foreground                                                                                         | Background(s)                                                                   | Min |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --- |
| `fgColor-default`, `fgColor-muted`, `fgColor-accent`                                               | `bgColor-default`, `bgColor-muted`                                              | 4.5 |
| `fgColor-danger` / `-attention` / `-success` / `-severe`                                           | own `bgColor-*-muted` composited over `bgColor-default` **and** `bgColor-muted` | 4.5 |
| `fgColor-danger`, `fgColor-attention`, `fgColor-success`, `borderColor-emphasis` (unknown outline) | `bgColor-default`, `bgColor-muted`                                              | 3   |
| `button-primary-fgColor-rest`                                                                      | `button-primary-bgColor-rest`                                                   | 4.5 |

If a pair fails, do not hand-tune a value: switch that role to the nearest stronger Primer token (e.g. `-emphasis` instead of `-muted`), apply it in Step 3's mapping, and note it for `DESIGN.md` (Task 8).

- [ ] **Step 3: Run both tests.** `npx vitest run tests/unit/legacy-tokens.test.ts tests/unit/tokens-contrast.test.ts` → FAIL (legacy tokens present, Primer not installed).

- [ ] **Step 4: Install and rewrite `tokens.css`.** `npm install --save-exact @primer/primitives@11.10.0 @primer/octicons@19.40.0 && npm uninstall @fontsource/ibm-plex-sans @fontsource/ibm-plex-mono`. `tokens.css` becomes a header comment plus these imports and `:root { --status-col: 112px; }`:

```css
@import '@primer/primitives/dist/css/base/size/size.css';
@import '@primer/primitives/dist/css/base/typography/typography.css';
@import '@primer/primitives/dist/css/functional/size/size.css';
@import '@primer/primitives/dist/css/functional/size/radius.css';
@import '@primer/primitives/dist/css/functional/size/border.css';
@import '@primer/primitives/dist/css/functional/typography/typography.css';
@import '@primer/primitives/dist/css/functional/themes/light.css';
@import '@primer/primitives/dist/css/functional/themes/dark.css';
```

`body` in `global.css`: `font-family: var(--fontStack-system); font-size: var(--text-body-size-medium); color: var(--fgColor-default); background: var(--bgColor-default)`; add `color-scheme: light` / `dark` under the two Primer theme selectors.

- [ ] **Step 5: Codemod the legacy tokens.** One-off script in the session scratchpad (never committed), replacing `var(--old` with `var(--new` using a lookahead so `--text` does not match `--text-muted` (`/--text(?![\w-])/`). Mapping:

| Legacy                                              | Primer                                                                                                                             |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `--bg`, `--surface`                                 | `--bgColor-default`                                                                                                                |
| `--surface-2`                                       | `--bgColor-muted`                                                                                                                  |
| `--border` / `--border-strong`                      | `--borderColor-default` / `--borderColor-emphasis`                                                                                 |
| `--text` / `--text-muted`                           | `--fgColor-default` / `--fgColor-muted`                                                                                            |
| `--unknown`                                         | `--borderColor-emphasis`                                                                                                           |
| `--accent` / `--accent-tint`                        | `--fgColor-accent` / `--bgColor-accent-muted`                                                                                      |
| `--on-accent` and every `background: var(--accent)` | **manual**: Primer primary button tokens `--button-primary-bgColor-rest` / `-hover` / `--button-primary-fgColor-rest` (4 sites)    |
| `--red` / `--red-text` / `--red-tint`               | `--fgColor-danger` / `--fgColor-danger` / `--bgColor-danger-muted`                                                                 |
| `--amber` / `--amber-text` / `--amber-tint`         | `--fgColor-attention` / `--fgColor-attention` / `--bgColor-attention-muted`                                                        |
| `--green` / `--green-text` / `--green-tint`         | `--fgColor-success` / `--fgColor-success` / `--bgColor-success-muted`                                                              |
| `--space-1…8`                                       | `--base-size-4`, `-8`, `-12`, `-16`, `-24`, `-32`, `-40`, `-48`                                                                    |
| `--radius-sm` / `-md` / `-lg` / `-pill`             | `--borderRadius-small` / `-medium` / `-medium` / `-full`                                                                           |
| `--font-sans` / `--font-mono`                       | `--fontStack-system` / `--fontStack-monospace`                                                                                     |
| `--fs-xs`, `--fs-sm`                                | `--text-body-size-small` (12px)                                                                                                    |
| `--fs-md`                                           | `--text-body-size-medium` (14px)                                                                                                   |
| `--fs-card`, `--fs-count`, `--fs-lead`              | `--text-body-size-large` (16px)                                                                                                    |
| `--fs-lg` / `--fs-xl` / `--fs-score`                | `--text-title-size-small` (16) / `--text-title-size-medium` (20) / `--text-title-size-large` (32; Task 4 may scale the score down) |

Also replace any remaining literal colours (SVG `stroke="var(--surface)"` in `StatusIcon.astro` → `var(--bgColor-default)`).

- [ ] **Step 6: Theme mechanism.**
  - `Base.astro`: `<html lang={locale} data-color-mode="auto" data-light-theme="light" data-dark-theme="dark">`; `theme-color` metas `#ffffff` (light) and `#0d1117` (dark).
  - `public/theme-init.js`: if `eph-theme` is `'light'` or `'dark'`, set `document.documentElement.dataset.colorMode` to it; otherwise leave `auto`.
  - `src/scripts/theme-toggle.ts`: `current()` reads `dataset.colorMode`; `auto` sets `dataset.colorMode = 'auto'` and removes the key; same cycle, labels and storage key.
  - Remove every `[data-theme]` selector from CSS (the legacy-tokens test also fails on `data-theme`; add that pattern).

- [ ] **Step 7: Integration test for the html attributes.** In `tests/integration/site.test.ts`, for `index.html` and `it/index.html`: `expect(html).toMatch(/<html[^>]*data-color-mode="auto"[^>]*data-light-theme="light"[^>]*data-dark-theme="dark"/)`.

- [ ] **Step 8: Update the e2e theme test.** `tests/e2e/smoke.spec.ts` "the chosen theme survives navigation": assert `data-color-mode` = `dark` instead of `data-theme`. Add "a legacy stored theme still applies": `page.addInitScript(() => localStorage.setItem('eph-theme', 'dark'))`, load `/`, expect `data-color-mode` = `dark`; with `'purple'` expect `auto`.

- [ ] **Step 9: Run everything.** `npx vitest run` → PASS (including the two token tests and the existing site tests, whose class hooks are unchanged). `npm run typecheck && npm run lint` → clean. e2e on port 4377 → PASS.

- [ ] **Step 10: Commit.** `feat(ui): Primer tokens and colour modes replace Warm Graphite`

---

### Task 2: Octicons and every symbol set

**Files:**

- Create: `src/lib/octicon.ts`, `src/components/Octicon.astro`, `src/types/primer-octicons.d.ts`
- Modify: `src/lib/symbols.ts`, `src/components/ControlSymbol.astro`, `src/components/Legend.astro`, `src/components/StatusIcon.astro`, `src/components/StatusDot.astro`, `src/components/RepositoryControlsSection.astro` (lines ~27–28, ~280), `src/components/QualitySection.astro` (lines ~89, ~263), `src/scripts/catalog-editor.ts` (lines ~445, ~955–972, ~1264), `src/pages/[...lang]/catalog.astro` (icon templates)
- Test: `tests/unit/octicon.test.ts` (new), `tests/unit/symbols.test.ts`, `tests/integration/site.test.ts` (lines ~429, ~452–460, ~633, ~1488)

**Interfaces:**

- Produces:
  - `octiconSvg(name: OcticonName, opts?: { size?: 12 | 16 | 24; label?: string; className?: string }): string` — SVG string; `aria-hidden="true"` without `label`, `role="img"` + `aria-label` with it; `fill="currentColor"`.
  - `Octicon.astro` props `{ name: OcticonName; size?: 12 | 16 | 24; label?: string; class?: string }`.
  - `symbols.ts`: `type SymbolKey = 'ok' | 'gap' | 'stale' | 'blind' | 'na' | 'failed'`; `SYMBOL_ICON: Record<SymbolKey, OcticonName>` = `{ ok: 'check-circle', gap: 'alert', stale: 'clock', blind: 'question', na: 'dash', failed: 'x-circle' }` (unless Mockup decisions say otherwise); `controlSymbol(state, required): { key: SymbolKey; tone: ControlSymbolTone }`. `ControlGlyph` and `GLYPH_KEY` are removed.

- [ ] **Step 1: Write `tests/unit/octicon.test.ts` (failing).** `octiconSvg('check')` contains `aria-hidden="true"` and `fill="currentColor"`; `octiconSvg('check', { label: 'Pass' })` contains `role="img"` and `aria-label="Pass"` and no `aria-hidden`; size 24 gives `width="24"`; every value of `SYMBOL_ICON` exists in the package (`expect(() => octiconSvg(n)).not.toThrow()`); an unknown name throws.
- [ ] **Step 2: Update `tests/unit/symbols.test.ts`** to the `{ key, tone }` shape with the same cases (`enabled` → `{ key: 'ok', tone: 'green' }`, required `stale` → `{ key: 'stale', tone: 'amber' }`, optional `stale` → `{ key: 'na', tone: 'muted' }`, `not-authorised` → `{ key: 'blind', tone: 'unknown' }`, …).
- [ ] **Step 3: Update the glyph assertions in `tests/integration/site.test.ts`** to assert `data-symbol="<key>"` plus the accessible name instead of `⧖`, `?`, `–` characters (e.g. line ~633: `data-state="stale"[\s\S]*?data-symbol="stale"[\s\S]*?Container scanning`). Keep the "not-applicable chart reads –, never 0%" check as a `data-symbol="na"` + visually hidden "Not applicable" check.
- [ ] **Step 4: Run.** `npx vitest run tests/unit/octicon.test.ts tests/unit/symbols.test.ts` → FAIL.
- [ ] **Step 5: Implement `src/lib/octicon.ts`** over `@primer/octicons` (`octicons[name].toSVG({ width, 'aria-label', class })`), and `src/types/primer-octicons.d.ts` declaring the default export as `Record<string, { toSVG(o?: Record<string, string | number>): string }>`; `OcticonName` is a string union of the names the hub uses, exported from `octicon.ts`.
- [ ] **Step 6: Implement `Octicon.astro`** as `<Fragment set:html={octiconSvg(name, { size, label, className })} />`.
- [ ] **Step 7: Migrate the symbol sets.** Each mark keeps its wrapper (`.sym sym--<tone>`, `role="img"`, `aria-label`) and gets `data-symbol={key}` and an `<Octicon>` instead of the glyph:
  - `ControlSymbol.astro` and `Legend.astro`: `SYMBOL_ICON[key]`.
  - `RepositoryControlsSection.astro`: pass `check`, fail `x`, unknown `question` (dashed `.sym--unknown`).
  - `QualitySection.astro`: stale `clock`.
  - `StatusIcon.astro` health tones: green `check-circle-fill`, amber `alert-fill`, red `x-circle-fill`, grey/unknown `question` inside the dashed outline; keep the `class="icon icon--<tone>"` on the `<svg>` (via `className`). Severity keeps its rising-bars SVG (a data glyph, never a health shape; spec §5.3 labels always carry the word).
  - `catalog.astro`: render `<template data-icon="check">` and `<template data-icon="x">` with `<Octicon>`; `catalog-editor.ts` clones them instead of writing `✓` / `✕` text (`aria-hidden` kept).
- [ ] **Step 8: Forced colours.** In `ControlSymbol.astro` keep `@media (forced-colors: active)` with `.sym { border: 1px solid CanvasText }` and `.sym--unknown { border-style: dashed }`. Add to `tests/unit/legacy-tokens.test.ts`: the built CSS (or `ControlSymbol.astro` source) contains a `forced-colors` block with `border-style: dashed` for `.sym--unknown`.
- [ ] **Step 9: Run everything.** `npx vitest run`, `npm run typecheck`, `npm run lint`, e2e on 4377 → PASS. `grep -rnE "[✓⧖✕]" src` → no output.
- [ ] **Step 10: Commit.** `feat(ui): Octicons for every status and control symbol`

---

### Task 3: Shell — header, underline nav, run bar, footer, optional identity

**Files:**

- Modify: `src/layouts/Base.astro`, `src/styles/global.css` (topbar / mainnav / runbar / stale-banner / footer sections), `src/lib/routes.ts`, `src/i18n/en.ts`, `src/i18n/it.ts`, `public/favicon.svg`, `.github/workflows/rw-hub-cloudflare-deploy.yml` (build step env)
- Create: `src/lib/identity.ts`, `src/scripts/identity.ts`
- Test: `tests/unit/identity.test.ts` (new), `tests/integration/site.test.ts`, `tests/e2e/smoke.spec.ts` (nav scroll tests keep `.mainnav`)

**Interfaces:**

- Consumes: `Octicon.astro`, `OcticonName` (Task 2).
- Produces:
  - `NAV_ICON: Record<PageKey, OcticonName>` in `routes.ts`, defaults `{ portfolio: 'apps', changes: 'history', security: 'shield', versions: 'tag', workflows: 'workflow', dataQuality: 'database', catalog: 'book', howToRead: 'question' }`.
  - `parseIdentity(body: unknown): { name: string; initials: string } | null` in `src/lib/identity.ts`.
  - i18n keys `d.footer.notAffiliated` (EN "Not affiliated with GitHub · built with Primer", IT "Non affiliato a GitHub · realizzato con Primer") and `d.nav.signedInAs` (EN "Signed in as {name}", IT "Accesso come {name}").

- [ ] **Step 1: Write `tests/unit/identity.test.ts` (failing).** `parseIdentity({ name: 'Ada Lovelace', email: 'ada@example.com' })` → `{ name: 'Ada Lovelace', initials: 'AL' }`; `{ email: 'grace.hopper@example.com' }` → `{ name: 'grace.hopper', initials: 'GH' }`; `null`, `'<html>…'`, `{}`, `{ name: '' }`, `{ name: 42 }` → `null`; names are trimmed and capped at 64 chars. In `tests/unit/octicon.test.ts` add: every value of `NAV_ICON` renders with `octiconSvg` without throwing.
- [ ] **Step 2: Write the integration assertions (failing).** For `index.html` (EN) and `it/index.html`:
  - nav `<nav class="mainnav">` holds one `<svg` per item and no `class="Counter"`;
  - footer contains the `notAffiliated` string in the page language;
  - with the default build env there is no `data-identity` element and no `/cdn-cgi/` string;
  - `.runbar` and `[data-stale-banner][role="status"]` still exist;
  - no `octocat`, `mark-github` or `logo-github` icon anywhere in the built site.
- [ ] **Step 3: Run.** `npx vitest run tests/unit/identity.test.ts tests/integration/site.test.ts` → FAIL.
- [ ] **Step 4: Implement the shell in `Base.astro`** (keep `.topbar`, `.brand`, `.mainnav`, `.utility-link`, `.theme-toggle`, `.langswitch`, `.runbar`, `.stale-banner`, `.footer` class hooks):
  - header row per current github.com: brand = Octicon mark (Mockup decisions; default `project`) + app name; tools on the right.
  - `.mainnav` as Primer UnderlineNav: each link `<Octicon name={NAV_ICON[k]} />` + label; active link gets the `--underlineNav-borderColor-active` underline; the row scrolls sideways on phones (existing `main-nav.ts` keeps working).
  - `.runbar` directly under the nav as a subhead line; the source chip becomes a Label (`synthetic` = attention Label); stale banner styled as a Primer Flash warning (`--bgColor-attention-muted`, `--borderColor-attention-muted`), `role="status"` kept.
  - footer: existing text plus `d.footer.notAffiliated`.
  - `public/favicon.svg`: the same Octicon mark as the brand, `fill="#59636e"` (static file, outside `src/`).
- [ ] **Step 5: Identity slot.** In `Base.astro`, only when `import.meta.env.PUBLIC_IDENTITY_SOURCE === 'cloudflare-access'`: render `<span class="identity" data-identity hidden></span>` in the tools and import `src/scripts/identity.ts`, which `fetch('/cdn-cgi/access/get-identity', { credentials: 'same-origin' })`, reads JSON only when `content-type` includes `application/json`, passes it to `parseIdentity`, and on success fills an initials circle (`aria-hidden`) + visually hidden `signedInAs` text and removes `hidden`. Any failure: leave it hidden, no console error. The slot has a fixed width in CSS so nothing shifts. Add `PUBLIC_IDENTITY_SOURCE: cloudflare-access` to the build step env in `rw-hub-cloudflare-deploy.yml` (the GitHub Pages workflow does not set it).
- [ ] **Step 6: Run everything.** `npx vitest run`, `npm run typecheck`, `npm run lint`, e2e on 4377 (nav scroll tests) → PASS. Manual check: `PUBLIC_IDENTITY_SOURCE=cloudflare-access SNAPSHOT_DIR=fixtures/snapshots npx astro build --outDir "$(mktemp -d)"` contains `data-identity`.
- [ ] **Step 7: Commit.** `feat(ui): GitHub-style header, underline nav and optional identity`

---

### Task 4: Shared components — Box, Label, Counter, Button, Details, Breadcrumbs, forms, score

**Files:**

- Modify: `src/styles/global.css` (cards, tables, `.disclosure`, buttons, filters, breadcrumbs, forms, `.pill*`, `.badge*`), `src/components/{Pill,StatusBadge,RiskPill,ScoreBadge,StatusDot,UnknownValue,ErrorState,ErrorsTable,SlaMeta,RiskPanel,ExtLink}.astro`
- Test: `tests/integration/site.test.ts`, Playwright screenshots (not committed)

**Interfaces:**

- Consumes: Primer tokens (Task 1), `Octicon.astro` (Task 2).
- Produces: unchanged component props and class hooks; Primer look per spec §6.2.

- [ ] **Step 1: Pin the invariants (failing only if broken).** Add to `site.test.ts`: the Project page score for the mock project still reads `40` (`class="score__value"`), Gamma still shows insufficient data and never `0`; the Portfolio order of project ids is unchanged from the v0.9.0 golden (read the ids in DOM order from `index.html` and compare with a literal array taken from the current build before any change).
- [ ] **Step 2: Restyle.** Mapping (spec §6.2): `.card`, sections and tables → Primer Box (1px `--borderColor-default`, `--borderRadius-medium`, header row on `--bgColor-muted`, rows separated by borders, project list rows like the Issues list); `.pill`, `.badge`, StatusBadge, RiskPill → Primer Label (status variants, severity `danger` / `severe` / `attention` / neutral, always with the word); counts → Counter; buttons → Primer Button (default, primary = green button tokens, invisible); filter groups → SegmentedControl look; `details.disclosure` → Box with summary row and chevron Octicon; breadcrumb → Primer Breadcrumbs; catalog form controls → FormControl look; ScoreBadge → same number and rules, Label/Counter look, confidence as `--fgColor-muted` text (size per Mockup decisions). Unknown everywhere: no fill, dashed `--borderColor-emphasis`.
- [ ] **Step 3: Visual check.** Build from fixtures, serve on port 4377, Playwright screenshots of Portfolio and Project in light and dark at 1280px and 390px; compare with the approved artboards; fix differences or record approved deviations in "Mockup decisions" and the canvas.
- [ ] **Step 4: Run everything.** `npx vitest run`, `npm run typecheck`, `npm run lint`, e2e on 4377 → PASS.
- [ ] **Step 5: Commit.** `feat(ui): Primer Box, Label, Button and form styles for shared components`

---

### Task 5: Charts in Primer colours

**Files:**

- Modify: `src/components/{DimensionBars,Sparkline,StatusStrip,TrendSection,CoverageMeter}.astro`, chart rules in `src/styles/global.css`
- Test: `tests/integration/site.test.ts` (existing `dimbars`, `meter` assertions), `tests/unit/legacy-tokens.test.ts`

**Interfaces:**

- Consumes: Primer status families and `--data-<colour>-color-emphasis` / `-muted` tokens.
- Produces: same SVG forms, data and accessible names.

- [ ] **Step 1: Load `dataviz`** and apply its mark specs within Primer tokens: status-encoded marks (dimension bars, status strip, coverage meter states) use the status families; categorical series (trend lines) use `--data-blue|purple|orange|teal-color-emphasis` in that order; gridlines `--borderColor-muted`, axis text `--fgColor-muted`; bars take the Primer ProgressBar look (track `--bgColor-neutral-muted`, rounded `--borderRadius-full`); unknown bars keep the dashed outline.
- [ ] **Step 2: Add a guard test** in `legacy-tokens.test.ts`: chart components reference only `--fgColor-*`, `--bgColor-*`, `--borderColor-*` or `--data-*` colour tokens.
- [ ] **Step 3: Run everything.** `npx vitest run` (existing `dimbars__bar--<tone>`, `meter--unknown`, `aria-hidden` assertions unchanged), typecheck, lint → PASS. Screenshot Portfolio (bars, sparklines) and Project (trend, coverage) in both themes; compare with the canvas.
- [ ] **Step 4: Commit.** `feat(ui): charts use Primer status and data-visualisation colours`

---

### Task 6: Pages I — Portfolio, Project, Security, Versions

**Files:**

- Modify: page-scoped styles and only presentational markup in `src/pages/[...lang]/index.astro`, `src/pages/[...lang]/projects/[id].astro`, `src/pages/[...lang]/security.astro`, `src/pages/[...lang]/versions.astro`
- Test: `tests/integration/site.test.ts`, `tests/e2e/smoke.spec.ts`

**Interfaces:**

- Consumes: Tasks 1–5. Class hooks and `data-*` attributes asserted by tests stay.

- [ ] **Step 1: Per page, compare with its artboard** (1280px, 390px, and dark for Portfolio and Project) and adjust page styles: GitHub container (max-width 1280px, Primer gutters), page title as Primer heading, lead sentence `--fgColor-muted`, lists as Issues-like Box rows, environments path DEV → UAT → PROD per Mockup decisions.
- [ ] **Step 2: Phone width.** No horizontal page scroll at 390px on the four pages: add an e2e assertion per page `document.documentElement.scrollWidth <= window.innerWidth`.
- [ ] **Step 3: Run everything.** vitest, typecheck, lint, e2e on 4377 → PASS.
- [ ] **Step 4: Commit.** `feat(ui): Primer restyle of Portfolio, Project, Security and Versions`

---

### Task 7: Pages II — Workflows, Changes, Data quality, Catalog, How to read

**Files:**

- Modify: `src/pages/[...lang]/{workflows,changes,data-quality,catalog,how-to-read}.astro` (styles, presentational markup), `src/i18n/en.ts`, `src/i18n/it.ts` (How to read symbol wording only if it names a glyph character)
- Test: `tests/integration/site.test.ts`, `tests/e2e/catalog.spec.ts`, `tests/e2e/smoke.spec.ts`

**Interfaces:**

- Consumes: Tasks 1–5.

- [ ] **Step 1: Per page, compare with its artboard** and adjust styles as in Task 6. Catalog keeps its behaviour (edit, propose as PR, download YAML, discard); "Propose on GitHub" is the green primary button.
- [ ] **Step 2: How to read.** The symbols section shows the six Octicon symbols with their meanings (`data-symbol` per row, existing test at line ~1488 updated to the new markup); any copy that names a glyph character ("⧖", "?") is rewritten to name the meaning, in EN and IT.
- [ ] **Step 3: Phone width.** Same 390px no-horizontal-scroll e2e assertion for the five pages.
- [ ] **Step 4: Run everything.** vitest, typecheck, lint, e2e on 4377 (including `catalog.spec.ts`) → PASS. `npm run scan:output` against a fixtures build dir if the script accepts one; otherwise skip and note it.
- [ ] **Step 5: Commit.** `feat(ui): Primer restyle of Workflows, Changes, Data quality, Catalog and How to read`

---

### Task 8: Review, accessibility, docs, PR

**Files:**

- Rewrite: `DESIGN.md` (and its sidecar if any)
- Create: `docs/architecture/adr/0009-primer-design-system.md`, `docs/it/architecture/adr/0009-primer-design-system.md`
- Modify: `README.md`, `docs/it/` README counterpart if present, `CHANGELOG.md`, `PRODUCT.md` only if it names Warm Graphite

**Interfaces:**

- Consumes: the finished build.

- [ ] **Step 1: Reviews.** Run `web-design-guidelines` and `design:accessibility-review` on all 9 built pages (light and dark), and an `impeccable` critique (finish reviewer) against the approved canvas. Fix every material finding; re-run vitest, typecheck, lint, e2e.
- [ ] **Step 2: Half-migration sweep.** `grep -rniE "warm graphite|ibm plex|plex|oklch|data-theme" src public` → only historical mentions in comments are allowed, none in code. Screenshot all 9 pages in both themes and attach them to the PR body as a checklist (not committed).
- [ ] **Step 3: `DESIGN.md`.** Regenerate from the shipped build with the `impeccable-documenter` agent: Primer tokens per role (with any substitutions from Task 1 Step 2), Octicon per symbol and nav item, unknown treatment, the "not GitHub" brand rule.
- [ ] **Step 4: ADR 0009 "Primer as the design system"** (EN + IT): context (owner decision 2026-11-02, GitHub look, no existing GitHub dashboard covers the scope), decision (`@primer/primitives` + Octicons, no React, system fonts, no GitHub marks), consequences (Warm Graphite retired, supply chain v0.11.0 builds in Primer, phase 2 and login migration follow). Check `ls docs/architecture/adr` first and take the next free number if 0009 is taken.
- [ ] **Step 5: README and CHANGELOG.** README screenshots/description mention the GitHub-style UI built with Primer and "not affiliated with GitHub"; CHANGELOG `## [Unreleased]` entry for the restyle (the version bump to 0.10.0 happens in the separate release PR, as for previous releases).
- [ ] **Step 6: Claude Design upkeep.** Update the canvas artboards and the Primer DS README for every deviation shipped (re-read the artifact files first; they may have been edited remotely).
- [ ] **Step 7: Commit, push, PR.** `docs: Primer design system ADR, DESIGN.md and changelog`; `git push -u origin feat/primer-restyle`; `gh pr create` (as `massilp`: prefix commands with `GH_TOKEN=$(gh auth token --user massilp)`) with summary, the screenshot checklist and a note that `feat/supply-chain-providers` must be rebased afterwards and its plan renumbered to v0.11.0 / ADRs 0010–0011 (spec §7.1).
