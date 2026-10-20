# UI redesign v0.5.0 (Warm Graphite) Implementation Plan

> Working document for agents, English only (specs and user docs are EN + IT).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the v0.4.0 "Survey Sheet" UI with the approved Warm Graphite system on all pages, add a project score computed by the collector, and add a "How to read" page.

**Architecture:** The collector gains a pure `evaluateScore` evaluator; its result travels in the snapshot (schema 1.3) to the static Astro site, which only renders it. The site gets new tokens, four small shared components (status dot, score, dimension bars, control symbol) and rewritten pages following the approved Claude Design canvas.

**Tech Stack:** TypeScript, Zod 4, Astro 7 (static), Vitest, Playwright, native CSS (OKLCH tokens), `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono`.

**Spec:** `docs/superpowers/specs/2026-10-20-ui-redesign-v0.5.0-design.md` (IT: `docs/it/superpowers/specs/…`). Read it before any task; section numbers below refer to it.

## Global Constraints

- Branch `feat/ui-redesign-v0.5.0`; commits authored `massilp <3519719+massilp@users.noreply.github.com>`; conventional commit messages; the owner merges PRs.
- Static site, read-only: no GitHub API calls or tokens in the browser, no runtime backend, no external services at runtime (fonts via `@fontsource`, no Google Fonts link).
- Every UI string in both `src/i18n/en.ts` and `src/i18n/it.ts` (parity test `tests/unit/i18n.test.ts`); every doc in EN and IT.
- Unknown is never zero, never green-looking; status never by colour alone (text label + shape always present).
- No UI string shaped like `secret: …` / `secret = …` (output scan `credential-assignment` fails the build).
- No real company/customer names; synthetic `example-org` data only; no Claude Design links or the previous design-system name in the repo.
- WCAG 2.2 AA in light and dark; body text ≥ 14px, smallest label 12px; touch targets ≥ 40px (44px for primary actions).
- No side-stripe borders on cards, no gradients, no glassmorphism, no heavy shadows.
- Status pills that precede text sit in a fixed-width column (112px) so the following text aligns.
- Local e2e: if port 4321 is busy (another local preview), run Playwright with a temporary config copy using another port and delete it afterwards; never kill the other process.

## Review Focus

1. A project grey overall with 4 green + 1 unreadable dimension must score ≤ 89 and show "measured 4 of 5", never 100 — test in Task 1 (`caps grey overall at 89`).
2. A project whose only grey dimension is delivery `no-critical-workflows` must not lose confidence (required 4, measured 4) — test in Task 1.
3. Portfolio sort must never put an "insufficient data" project after healthy ones — test in Task 4 (`sorts insufficient data right after red projects`).
4. Dark theme: every new text/background and status-fill pair must pass the contrast test, including fixed pill tints — Task 2 extends `tokens-contrast.test.ts` to both themes.
5. Mobile width (Pixel 7): portfolio rows and project dimension cards must wrap without horizontal page scroll — e2e assertion in Task 4 (`no horizontal scroll at phone width`) and Task 5.

---

### Task 1: Project score in the collector and snapshot (schema 1.3)

**Files:**

- Create: `collector/src/evaluators/score.ts`, `tests/unit/score.test.ts`
- Modify: `shared/model/policies.ts` (add `score` block), `shared/model/snapshot.ts` (add `ProjectScoreSchema`, `score` on `ProjectSnapshotSchema` and `ProjectSummarySchema`), `shared/model/enums.ts:6-7` (`SNAPSHOT_SCHEMA_VERSION = '1.3'`, `SUPPORTED_SNAPSHOT_SCHEMA_VERSIONS = ['1.3']`), `shared/model/index.ts` (exports), `collector/src/build-snapshot.ts` (call after `evaluateOverall`, ~line 238; copy into `toProjectSummary`), `config/policies.yaml` (commented `score:` block with defaults), `config/schema/*` via `npm run schema:generate`, golden `fixtures/snapshots/**` via `npm run fixtures:update`, `docs/configuration.md`, `docs/it/configuration.md` (formula section), any test fixture that hard-codes `schemaVersion: '1.2'`.

**Interfaces:**

- Produces: `ProjectScoreSchema` / `type ProjectScore = { value: number | null; measured: number; required: number }` (value integer 0–100); `ProjectSnapshot.score: ProjectScore`; `ProjectSummary.score: ProjectScore`; `evaluateScore(dimensions: Record<Dimension, HealthResult>, overall: HealthStatus, policies: Policies): ProjectScore` in `collector/src/evaluators/score.ts`; `NOT_APPLICABLE_REASON_CODES: readonly ReasonCode[] = ['no-critical-workflows']`.
- Policies `score` defaults (whole block optional, `.strict()`): `weights { delivery: 25, version: 15, security: 30, coverage: 15, governance: 15 }`, `points { green: 100, amber: 60, red: 20 }`, `caps { red: 49, amber: 89, grey: 89 }`, `minMeasuredRatio: 0.5`.

- [ ] **Step 1: Write failing tests** in `tests/unit/score.test.ts` using `PoliciesSchema.parse` of the repo `config/policies.yaml` and hand-built `HealthResult`s:
  - `scores the mock projects`: Beta dims (red, amber, red, amber, amber; overall red) → `{ value: 38, measured: 5, required: 5 }`; Alpha (green, amber, amber, amber, green; amber) → 76; Platform (green, green, amber, green, green; amber) → 88; Gamma all grey (reasons not-authorised) overall grey → `{ value: null, measured: 0, required: 5 }`.
  - `caps red overall at 49`: four green + security red, overall red → 49.
  - `caps grey overall at 89`: four green + coverage grey (reason `required-control-not-authorised`), overall grey → `{ value: 89, measured: 4, required: 5 }`.
  - `healthy project scores 100`: all green → 100.
  - `not applicable is excluded from confidence`: delivery grey with only reason `no-critical-workflows`, others green, overall grey → `{ measured: 4, required: 4 }` and value 89 (grey cap).
  - `insufficient data below half`: 2 measured of 5 → `value: null`; 3 of 5 → number.
  - `uses configured weights`: custom policies with security weight 100, others 0 → equals that dimension's points (subject to cap).
- [ ] **Step 2: Run** `npx vitest run tests/unit/score.test.ts` — expect FAIL (module not found).
- [ ] **Step 3: Implement** the schema changes and `evaluateScore`: required = `policies.overall.requiredDimensions` minus not-applicable dimensions; measured = required dimensions whose status ≠ grey; `value = null` if `required === 0 || measured / required < minMeasuredRatio`; else `Math.min(Math.round(Σ weight·points / Σ weight over measured), caps[overall] ?? 100)`.
- [ ] **Step 4: Run** `npx vitest run tests/unit/score.test.ts` — expect PASS.
- [ ] **Step 5: Wire into `build-snapshot.ts`** (pass the five `HealthResult`s and `overallHealth.status`), add `score` to `toProjectSummary`; run `npm run schema:generate && npm run fixtures:update`; check `fixtures/snapshots/index.json` shows scores 88/76/38/null; update docs EN/IT configuration with the formula and caps (copy from spec §6).
- [ ] **Step 6: Run** `npm run typecheck && npx vitest run` — expect all green (site tests may still pass since pages ignore `score`).
- [ ] **Step 7: Commit** `feat(collector): project score with caps and confidence (snapshot 1.3)`.

### Task 2: Warm Graphite tokens, fonts and base styles

**Files:**

- Modify: `src/styles/tokens.css` (rewrite), `src/styles/global.css` (remove Survey Sheet block, hatch usage, sheet/legend-variant styles; restyle base elements), `package.json` / lockfile (add `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono`; remove `@fontsource/public-sans`, `@fontsource/geist-mono`), `tests/unit/tokens-contrast.test.ts`.

**Interfaces:**

- Produces CSS custom properties used by all later tasks: `--bg --surface --surface-2 --border --border-strong --text --text-muted --unknown --accent --on-accent --red --red-text --red-tint --amber --amber-text --amber-tint --green --green-text --green-tint --font-sans --font-mono --radius-sm(4px) --radius-md(8px) --radius-lg(10px) --radius-pill(999px) --space-1..--space-8 (4,8,12,16,24,32)`, values exactly as spec §5 (light in `:root`, dark in both `@media (prefers-color-scheme: dark) :root:not([data-theme='light'])` and `:root[data-theme='dark']`). Keep `--link`/`--focus` as aliases of `--accent` and `--grey` as alias of `--unknown` so untouched pages still render until their task. Classes: `.pill .pill--red|amber|green|unknown`, `.card`, `.muted`, `.mono`, `.status-col` (112px fixed column helper).

- [ ] **Step 1: Rewrite the contrast test**: the parser must read `oklch()` and hex (convert OKLCH→sRGB as in spec §5 values); assertions per theme: `text`, `text-muted`, `accent` ≥ 4.5 on `surface`, `bg`, `surface-2`; `red-text`, `amber-text`, `green-text` ≥ 4.5 on `surface` and on their `*-tint`; `red`, `amber`, `green`, `unknown`, `border-strong` ≥ 3 on `surface`; `on-accent` ≥ 4.5 on `accent`. Remove the color-mix tint tests.
- [ ] **Step 2: Run** `npx vitest run tests/unit/tokens-contrast.test.ts` — expect FAIL (tokens missing).
- [ ] **Step 3: Install fonts and rewrite tokens.css/global.css** to the values above; body 14px/1.5, focus ring `2px solid var(--accent)` offset 2px.
- [ ] **Step 4: Run** the contrast test — PASS; `npm run build:site` succeeds (`SNAPSHOT_DIR=fixtures/snapshots`).
- [ ] **Step 5: Commit** `feat(ui): Warm Graphite tokens, IBM Plex fonts and base styles`.

### Task 3: Shared components, layout and nav

**Files:**

- Create: `src/components/StatusDot.astro`, `src/components/ScoreBadge.astro`, `src/components/DimensionBars.astro`, `src/components/ControlSymbol.astro`, `src/lib/symbols.ts`, `tests/unit/symbols.test.ts`
- Modify: `src/layouts/Base.astro` (nav order, "How to read" utility link, drop default per-page Legend), `src/lib/routes.ts` (`PageKey` adds `'howToRead'` → `how-to-read/`), `src/components/Legend.astro` (one-line strip + link only; remove `sheet` variant), `src/components/Pill.astro`/`StatusBadge.astro` (Warm Graphite classes), `src/i18n/en.ts`/`it.ts` (`nav.howToRead`, `legend.*` one-liners, `score.*`).

**Interfaces:**

- `controlSymbol(state: ControlState, required: boolean): { glyph: '✓' | '!' | '⧖' | '?' | '–' | '✕'; tone: 'green' | 'amber' | 'unknown' | 'muted' | 'red' }` in `src/lib/symbols.ts`: enabled → ✓ green; failed → ✕ red; stale → ⧖ amber (if required, else –); not-configured / configured-not-run → ! amber if required else – muted; not-authorised / unknown / collection-failed → ? unknown; not-applicable → – muted.
- `<StatusDot status: HealthStatus label: string />` (role="img", aria-label; dashed outline for grey).
- `<ScoreBadge score: ProjectScore locale: Locale size?: 'row' | 'header' />` renders value (tabular) + confidence line `score.measured` = "measured {m} of {r}" / "misurato {m} di {r}"; null → "—" + `score.insufficient` = "insufficient data" / "dati insufficienti".
- `<DimensionBars dims: { dimension: Dimension; status: HealthStatus }[] locale />`: five 32×10 bars, 4px gap, each `role="img"` with `aria-label="{dimension}: {status label}"`; grey = dashed outline.
- `<ControlSymbol state required locale label? />` uses `controlSymbol`.
- Nav order: `['portfolio', 'security', 'versions', 'workflows', 'dataQuality', 'catalog']`; `howToRead` is a header utility link, not in the main nav.

- [ ] **Step 1: Write `tests/unit/symbols.test.ts`** covering every `ControlState` × required true/false with the mapping above.
- [ ] **Step 2: Run** it — FAIL.
- [ ] **Step 3: Implement** `symbols.ts`, the four components, layout/nav/routes/legend changes and i18n keys (EN + IT).
- [ ] **Step 4: Run** `npx vitest run tests/unit/symbols.test.ts tests/unit/i18n.test.ts && npm run typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(ui): shared status, score, dimension and control components`.

### Task 4: Portfolio page

**Files:**

- Modify: `src/pages/[...lang]/index.astro` (rewrite per spec §7 Portfolio and the canvas), `src/scripts/portfolio-filters.ts` (default sort by score), `src/i18n/en.ts`/`it.ts` (`portfolio.*`: remove survey-sheet keys `sheetTitle gridKey notSurveyed notSurveyedBody notesTitle noNotes surveyedAt causeRepos blindSpot secretsBlind noteMore` if unused; add `lead` = "{n} of {total} projects need attention" / "{n} progetti su {total} chiedono attenzione", `reasonColumn`, `scoreColumn`, `dimensionsColumn`, `scoreHelp`), `src/lib/score.ts` (new), `tests/integration/site.test.ts`, `tests/e2e/smoke.spec.ts`.

**Interfaces:**

- Consumes: Task 1 `ProjectSummary.score`; Task 3 components.
- Produces: `scoreSortKey(score: ProjectScore): number` in `src/lib/score.ts` = `score.value ?? 49.5` (insufficient data sorts right after red, before amber; ties by name). Rows carry `data-project`, `data-health`, `data-score` (empty string when null).

- [ ] **Step 1: Update tests**: site test — portfolio contains `data-score="38"` for Beta and `data-score=""` for Gamma, row order Beta, Gamma, Alpha, Platform; Gamma row shows "insufficient data" and no `>0<` count; legend one-liner links to `how-to-read/`; no `sheet__` classes. Unit test in `tests/unit/score.test.ts`: `sorts insufficient data right after red projects`. E2E (smoke): count buttons filter (Critical → 1 row, aria-pressed true); search narrows to 1; `no horizontal scroll at phone width` (`document.documentElement.scrollWidth <= innerWidth` on mobile project).
- [ ] **Step 2: Run** `npx vitest run tests/integration/site.test.ts tests/unit/score.test.ts` — FAIL.
- [ ] **Step 3: Implement** the page: title + lead, counts as `<button aria-pressed>`, filter row (search, status, business unit, sort default score; lifecycle + severity in "More filters"), table columns status dot / project + BU / ScoreBadge / DimensionBars / reason (pill in `.status-col` + main reason sentence from `topReason`), one-line legend, footer (collected at UTC, synthetic when mock).
- [ ] **Step 4: Run** the tests again plus e2e (`npm run test:e2e`, see port note) — PASS.
- [ ] **Step 5: Commit** `feat(ui): portfolio as a compact list with score`.

### Task 5: Project page

**Files:**

- Modify: `src/pages/[...lang]/projects/[id].astro`, `src/i18n/en.ts`/`it.ts` (`project.*`: `whyTitle` = "Why it is {status}" / "Perché è {status}", `dimensionCards`, `environmentsPath`, `openInGitHub`, `otherAlertsOnGitHub`), `tests/integration/site.test.ts`, `tests/e2e/smoke.spec.ts`.

**Interfaces:** Consumes `ProjectSnapshot.score`, Task 3 components, existing `ReasonList`/`EffectiveVersion`/`ErrorsTable`.

- [ ] **Step 1: Update tests**: Beta page contains header score `38`, "measured 5 of 5", "Why it is Critical", the five dimension cards linking to `#workflows #environments #security #coverage #errors`, environments in order DEV→UAT→PROD with PROD "behind"; security section lists only critical and high findings plus a GitHub link for the rest; collapsed `<details>` for Workflows, Security, Coverage, Collection errors. Gamma page shows "insufficient data" and the cause. E2E: existing blocking-component assertion updated to the new copy; phone width no horizontal scroll.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** per spec §7 Project and the canvas.
- [ ] **Step 4: Run** tests + e2e — PASS.
- [ ] **Step 5: Commit** `feat(ui): project page with why-box, dimension cards and environments path`.

### Task 6: Security page

**Files:** Modify `src/pages/[...lang]/security.astro`, i18n `securityPage.*` (`lead` = "{critical} open critical alert(s) · {blind} required controls we cannot see", `incompleteCounts`, `coverageOf` = "Coverage: {available} of {required} required", `openInGitHub`, `notZero` = "This does not mean zero alerts."), `tests/integration/site.test.ts`.

- [ ] **Step 1: Update tests**: totals 1/4/7/5; "incomplete" note present; one `<article>` per project in the portfolio order (Beta, Gamma, Alpha, Platform, via `scoreSortKey`); Beta shows "Not authorised (403)" chip and ⧖ container; Gamma shows "does not mean zero alerts"; no full findings `<table class="table--findings">`; portfolio coverage matrix inside a closed `<details>`; keep "Details withheld" behaviour for private findings where titles appear.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** per spec §7 Security. **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(ui): security page per project with blind spots`.

### Task 7: Versions page

**Files:** Modify `src/pages/[...lang]/versions.astro`, i18n `versionsPage.*` (`lead`, `toCheck`, `alignedCollapsed` = "{n} aligned components", `mismatchSentence`, `unmappedSentence`), `tests/integration/site.test.ts`.

- [ ] **Step 1: Update tests**: Beta card shows the environments path with PROD behind, a "To check" table with the API service manifest/submodule mismatch and `tools/legacy-scripts` unmapped (link to catalog), aligned components inside `<details>`; Platform is a single-line card; Gamma dashed card with cause.
- [ ] **Step 2–4:** run (FAIL) → implement per spec §7 Versions → run (PASS).
- [ ] **Step 5: Commit** `feat(ui): versions page focused on what to check`.

### Task 8: Workflows page

**Files:** Modify `src/pages/[...lang]/workflows.astro`, i18n `workflowsPage.*` (`lead`, `readOnlyNote` = "The portal reads runs; it never triggers them.", `okCollapsed` = "{n} critical workflows succeeded", `allOk`), `tests/integration/site.test.ts`.

- [ ] **Step 1: Update tests**: only critical workflows; Beta shows three problem rows (failed `ci-main.yml` on `project-beta-api` with run link, missing `rel-release.yml` on `project-beta-web`, stale `cd.yml` on `project-beta-helm`) each with a pill in `.status-col`; successes collapsed with count; Alpha and Platform single-line "all succeeded"; Gamma "not visible".
- [ ] **Step 2–4:** FAIL → implement per spec §7 Workflows → PASS.
- [ ] **Step 5: Commit** `feat(ui): workflows page showing only what needs attention`.

### Task 9: Data quality page

**Files:** Modify `src/pages/[...lang]/data-quality.astro`, i18n `dataQualityPage.*` (`lead`, `byCause`, `notFoundNote` = "A 404 can mean the repository is missing or access is: we cannot tell.", `howToFix`, `repoCounts`), `tests/integration/site.test.ts`.

- [ ] **Step 1: Update tests**: repository counts 12 / 7 / 3 / 2; errors grouped by classification (`not-authorised` 4, `not-found` 1) with project, source and repositories; stale sources with dates; unmapped submodule with catalog link; capabilities as pills; run details in `<details>`; Italian page heading "Qualità dati".
- [ ] **Step 2–4:** FAIL → implement per spec §7 Data quality → PASS.
- [ ] **Step 5: Commit** `feat(ui): data quality grouped by cause`.

### Task 10: Catalog page restyle

**Files:** Modify `src/pages/[...lang]/catalog.astro` and catalog styles in `src/styles/global.css` (`.ce*` classes), i18n `catalogEditor.*` only if a label changes (`proposal`, `proposeOnGitHub`), `tests/integration/site.test.ts`, `tests/e2e/catalog.spec.ts`.

**Interfaces:** Do not change `src/lib/catalog-editor-core.ts` behaviour or the `data-ce-*` hooks used by `src/scripts/catalog-editor.ts`.

- [ ] **Step 1: Run the existing catalog tests** (`npx vitest run tests/unit/catalog-editor.test.ts tests/integration/site.test.ts` and `npx playwright test tests/e2e/catalog.spec.ts`) to capture the baseline — PASS.
- [ ] **Step 2: Restyle** per spec §7 Catalog: side list with pending badge, discovered repositories with "Use", fieldsets, segmented project-type radios, proposal box with primary "Propose on GitHub" (accent, ≥44px) and secondary actions.
- [ ] **Step 3: Run** the same tests — PASS (update only selectors that referenced removed classes).
- [ ] **Step 4: Commit** `feat(ui): catalog editor in Warm Graphite`.

### Task 11: "How to read" page

**Files:** Create `src/pages/[...lang]/how-to-read.astro`; modify i18n `howToRead.*`, `tests/integration/site.test.ts` (`VIEWS` adds `how-to-read`), `tests/e2e/smoke.spec.ts` (navigation list).

- [ ] **Step 1: Update tests**: `/how-to-read/` and `/it/how-to-read/` render; contain the four states with dots, the six control symbols with meanings, the unknown / not authorised / not configured / not applicable distinctions, the score formula with weights and caps read from policies (values 25/15/30/15/15, 49/89/89, 0.5), thresholds summary (staleness days from `policies.yaml`).
- [ ] **Step 2–4:** FAIL → implement (values rendered from the parsed policies, not hard-coded) → PASS.
- [ ] **Step 5: Commit** `feat(ui): how to read page`.

### Task 12: Cleanup, docs and design records

**Files:** Modify `src/lib/tones.ts` (drop unused tones), remove dead components/CSS (`HealthTile`, `SeverityKpis`, `PinCell`, `Count` only if no longer imported), `README.md`, `README.it.md` (Portfolio/score/how-to-read rows, screenshots text; roadmap gains "What changed since last collection"), `CHANGELOG.md` `[Unreleased]` (Added: score, How to read; Changed: Warm Graphite UI, nav order, snapshot 1.3, fonts; Removed: Survey Sheet), `PRODUCT.md` (no principle change; mention score in Capabilities), `DESIGN.md` + `.impeccable/design.json` (regenerate with the impeccable documenter agent from the built site), `.impeccable/surfaces/src-pages-lang-index-astro.md` (new direction contract for Warm Graphite), commit the IT spec and this plan if not yet committed.

- [ ] **Step 1: Run** `npm run lint && npm run typecheck && npm run format:check && npx vitest run && npm run ci:build` — all PASS, `scan:output` clean.
- [ ] **Step 2: Regenerate design records** (documenter) and update docs EN/IT.
- [ ] **Step 3: Commit** `docs: Warm Graphite design records, README and changelog`.

### Task 13: Verification and PR

- [ ] **Step 1: Screenshots** with Playwright of every page at 375, 768, 1280 px in light and dark (scratchpad, not committed); compare with the approved Claude Design canvas; fix differences that break spec rules.
- [ ] **Step 2: Design checks**: `/impeccable critique` on Portfolio (target ≥ 32/40, no P0/P1); `web-design-guidelines` audit on `src/pages/**` and `src/components/**` (no accessibility or focus finding left); fix and re-run.
- [ ] **Step 3: Claude Design verification round**: upload the built pages' screenshots to the canvas as a new row (or share links), ask the owner to comment; address comments.
- [ ] **Step 4: Full suite** `npx vitest run && npm run test:e2e && npm run ci:build` — PASS; push branch; open PR "feat(ui): Warm Graphite redesign and project score (v0.5.0)" with summary, screenshots list and test output; owner merges.
- [ ] **Step 5 (after merge, separate release PR as for v0.4.0):** bump `VERSION`, `package.json`, `SECURITY.md` supported versions to 0.5.x, golden `collectorVersion` 0.5.0, CHANGELOG `[0.5.0] - <date>`; after the owner merges: `gh release create v0.5.0 --target <merge sha>`; update both SHAs in the private deploy repo's `.github/workflows/deploy-hub.yml` (`uses: …rw-hub-cloudflare-deploy.yml@<sha> # v0.5.0` and `hub-ref`), push, verify the deploy run is green and the protected host still redirects (302) to the access login.
