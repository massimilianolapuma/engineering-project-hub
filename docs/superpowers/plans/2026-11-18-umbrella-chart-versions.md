# Umbrella chart component versions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per project, show which version of each component is in the umbrella Helm chart on main, at the latest release and in each environment, as a components × environments table on the Versions page.

**Architecture:** A collector step reads the coordinator's umbrella `Chart.yaml` (default branch, latest release tag, one tag per distinct environment version, max 10) after the v0.18.0 environment states; a pure normalizer parses it and maps dependencies to components; the snapshot (1.11) carries the result on the coordinator, components and environments; the Versions page renders it.

**Tech Stack:** TypeScript (tsx), zod 4, yaml, Astro 7, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-18-umbrella-chart-versions-design.md` (IT: `docs/it/superpowers/specs/…`). Read it first; this plan does not repeat its rationale.

## Global Constraints

- Read-only GETs through the existing `SourceProvider.getFile(repo, path, ref?)`; never contact Harbor/OCI.
- At most **10** tag reads per project for environments (distinct versions, newest first); the rest `skipped`.
- Chart text ≤ `MAX_VALUE_FILE_BYTES` (64 KiB, `shared/yaml-value.ts`); parse with `{ maxAliasCount: 100, uniqueKeys: false, logLevel: 'error' }`.
- Nothing changes for projects without `coordinator.umbrellaChart` (goldens of `platform`, `project-beta`, `project-gamma` change only by `schemaVersion`/`collectorVersion`-style fields and the new `null` fields).
- Unknown is never "not deployed" and never guessed from another column.
- Public repo: synthetic fixtures only (`example-org`); never commit `public/data`, `config.local/`, screenshots of real data.
- EN + IT for every UI string and doc. Never run `npm run ci:build`, `collect:mock` or `build` locally (they overwrite `public/data`); goldens via `npm run fixtures:update`.
- Commits: Conventional Commits, on branch `feat/umbrella-chart-versions` (create from `origin/main` after the spec PR or include the spec commit).

## Review Focus

1. **Monorepo components** share the coordinator's repository name: rule 2 (repo name match) must apply only when exactly one component has that repository, else several components map to one dependency. → test in Task 2.
2. **Two environments on the same version** (TEST and DEV both 1.4.0) → one read, both environments get the same `componentVersions`. → test in Task 3.
3. **Prerelease / `v`-prefixed versions** (`umbrella: v1.5.0-rc.1`, dependency `version: v2.0.0`) → tag `v1.5.0-rc.1`; dependency version normalised to `2.0.0`. → tests in Tasks 2 and 3.
4. **No GitHub Release, only tags** → the release read uses `coordinator.latestRelease.tag` whatever its `kind`; no release and no tag → no release read, `component.umbrella.release = null`. → test in Task 3.
5. **Narrow screens**: the table at 412 px scrolls inside its container, page has no horizontal scroll. → e2e in Task 6.

---

### Task 1: Catalog, snapshot 1.11 contract, catalog editor

**Files:**

- Modify: `shared/model/catalog.ts` (CoordinatorConfigSchema, ComponentConfigSchema, VersionSourceSchema)
- Modify: `shared/model/snapshot.ts` (coordinator, ComponentSnapshotSchema, EnvironmentSnapshotSchema, CollectionError source)
- Modify: `shared/model/enums.ts` (1.11)
- Modify: `src/lib/catalog-editor-core.ts` (keep the two new fields on save)
- Regenerate: `config/schema/*.json` (`npm run schema:generate`)
- Test: `tests/unit/config.test.ts`, `tests/unit/catalog-editor.test.ts`

**Interfaces:**

- Produces (catalog): `coordinator.umbrellaChart?: { path: string /* relativePath */; tagPrefix: string /* default 'v', max 50 */ }`; `component.chartDependency?: string` (max 100, `/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/`); `VersionSourceSchema = z.enum(['auto','submodule','manifest','release','umbrella'])`.
- Produces (snapshot), exported types `UmbrellaChartState`, `UmbrellaChartSummary`, `ComponentUmbrella`, `EnvironmentComponentVersions`:
  - `UmbrellaChartStateSchema = z.enum(['ok','not-found','invalid','not-authorised','unknown'])`
  - `coordinator.umbrellaChart: { path: string; state: UmbrellaChartState; chartVersion: string|null; unmapped: string[] /* max 50 */; aliases: string[] /* max 50 */ } | null`
  - `component.umbrella: { inUmbrella: boolean; main: string|null; release: string|null; conflict: boolean } | null`
  - `component.effectiveVersionSource` adds `'umbrella'`
  - `environment.componentVersions: { ref: string; state: UmbrellaChartState | 'skipped'; versions: { componentId: string; version: string|null; conflict: boolean }[] /* max 100 */ } | null`
  - CollectionError `source` adds `'umbrella-chart'`
  - `SNAPSHOT_SCHEMA_VERSION = '1.11'`, `SUPPORTED_SNAPSHOT_SCHEMA_VERSIONS = ['1.11']` (comment line `// 1.11: umbrella chart component versions (...)`).

- [ ] **Step 1: Failing tests**
  - `config.test.ts`: `it('accepts coordinator.umbrellaChart with a default tag prefix and component.chartDependency')` → parsed `umbrellaChart` equals `{ path: 'deploy/helm/alpha/Chart.yaml', tagPrefix: 'v' }`; `chartDependency: 'alpha-api'` kept; `umbrellaChart: { path: '/abs' }` and `{ path: 'a/../b' }` rejected; `versionSource: umbrella` accepted.
  - `catalog-editor.test.ts`: `it('keeps umbrellaChart and chartDependency when a project is saved')` → `projectToYaml(draftOf(project))` re-parsed with `ProjectConfigSchema` deep-equals the original fields.
- [ ] **Step 2:** `npx vitest run tests/unit/config.test.ts tests/unit/catalog-editor.test.ts` → FAIL.
- [ ] **Step 3: Implement** the schemas above; add `umbrellaChart?` to the draft coordinator and `chartDependency?` to `DraftComponent`, copied in `projectToDraft`/`componentToDraft` and emitted by `toProjectInput` (same treatment as `sonarProjectKey`). Snapshot fields are required-nullable; existing builders set them to `null` until Task 4 (`toComponents` → `umbrella: null`, `toEnvironments` → `componentVersions: null`, coordinator → `umbrellaChart: null`) so the build stays green.
- [ ] **Step 4:** `npm run schema:generate && npm run fixtures:update && npx tsc --noEmit -p tsconfig.json && npx vitest run` → PASS after updating schema-version assertions (`1.10` → `1.11` in `tests/integration/collector.test.ts`, `tests/integration/site.test.ts`, `tests/unit/policy-check.test.ts`).
- [ ] **Step 5: Commit** `feat(model): umbrella chart catalog fields and snapshot 1.11 contract`

### Task 2: Chart parser and dependency mapping (pure)

**Files:**

- Create: `collector/src/normalizers/umbrella-chart.ts`
- Test: `tests/unit/umbrella-chart.test.ts`

**Interfaces:**

- Produces:
  - `interface ChartDependency { name: string; alias: string | null; version: string | null /* normalised semver, else raw text */ }`
  - `interface ParsedChart { version: string | null; dependencies: ChartDependency[] }`
  - `parseUmbrellaChart(text: string): ParsedChart | null` — `null` = invalid (YAML error, too large, `dependencies` not an array, an entry without string `name`).
  - `interface ChartMapping { byComponent: Map<string, { version: string | null; conflict: boolean }>; unmapped: string[]; aliases: string[] }`
  - `mapChartToComponents(config: ProjectConfig, chart: ParsedChart): ChartMapping`

Mapping rules (spec §5.1), per component, first match wins: (1) `chartDependency` equals an entry's `alias`, else entries with that `name`; (2) entries whose `name` equals the repository name without owner — **only if no other component has the same repository**; non-aliased entries considered first, aliased entries with the same name join the group; (3) entries whose `name` equals the component id. A group whose versions differ → `{ version: null, conflict: true }`. When `chartDependency` names an alias, the other entries with the same `name` go to `aliases` (as `alias ?? name`), not `unmapped`. Entries matched by no component → `unmapped` (`alias ?? name`). Components not matched are absent from `byComponent`.

- [ ] **Step 1: Failing tests** in `tests/unit/umbrella-chart.test.ts`:
  - `parses version and dependencies, normalising v-prefixed versions` — `version: 0.11.8`, deps `[{name:'p-api', version:'v0.15.0'}, {name:'p-api', alias:'p-api-services', version:'0.15.0'}]` → `{ version: '0.11.8', dependencies: [{name:'p-api',alias:null,version:'0.15.0'},{name:'p-api',alias:'p-api-services',version:'0.15.0'}] }`.
  - `keeps a range as text` — `version: ~1.2` → `'~1.2'`.
  - `returns null for invalid charts` — `'::'`, `dependencies: {}`, `dependencies: [{version: 1.0.0}]`, a 70 KiB text.
  - `accepts a chart without dependencies` → `dependencies: []`.
  - `maps by repository name, then id, with zero configuration` — components `api` (repo `o/p-api`), `web` (repo `o/other`, id `web`), dep names `p-api`, `web`, `extra` → `byComponent` api→`0.15.0`, web→version; `unmapped: ['extra']`.
  - `counts lockstep aliases once and flags diverging ones as a conflict` — same name, versions equal → `{version:'0.15.0',conflict:false}`; versions `0.15.0`/`0.16.0` → `{version:null,conflict:true}`.
  - `chartDependency on an alias maps only that entry and lists the other as an alias` → `byComponent.get(x).version` of the alias; `aliases` contains the non-chosen entry; `unmapped` does not.
  - `does not map monorepo components by the shared repository name` — two components with repository `o/mono` and a dep `mono` → neither mapped by rule 2; `unmapped: ['mono']`.
- [ ] **Step 2:** `npx vitest run tests/unit/umbrella-chart.test.ts` → FAIL.
- [ ] **Step 3: Implement** both functions (YAML via `yaml.parse` with the Global Constraints options; versions through `normaliseVersion` + `parseVersion`, raw text kept when not semver).
- [ ] **Step 4:** same command → PASS.
- [ ] **Step 5: Commit** `feat(collector): parse umbrella charts and map dependencies to components`

### Task 3: Collector reads (main, release tag, environment tags)

**Files:**

- Create: `collector/src/collectors/umbrella-chart.ts`
- Modify: `collector/src/collectors/collect.ts` (RawProjectData), `collector/src/run.ts` (call after `collectEnvironmentStates`)
- Test: `tests/unit/umbrella-collect.test.ts`

**Interfaces:**

- Consumes: `toEnvironments(...)` and `parseManifest(ctx, raw)` from `collector/src/normalizers/versions.ts` (call `parseManifest` with a scratch `{ errors: [] }`-shaped context so no error is recorded twice; check the `BuildContext` type for the exact fields), `raw.environmentStates`, `raw.argocd`, `raw.repos[0].release` / `.tag`.
- Produces:
  - `interface ChartRead { ref: string; file: ProviderResult<FileDTO> }`
  - `RawProjectData.umbrella?: { main: ProviderResult<FileDTO>; release: ChartRead | null; environments: Map<string /* env id */, ChartRead | 'skipped'> }`
  - `MAX_UMBRELLA_TAG_READS = 10`
  - `environmentVersionRefs(raw: RawProjectData, tagPrefix: string): Map<string /* env id */, string /* tag */>` — semver versions only (from `toEnvironments(...).version`), so LAB-style branch deployments and unknowns get none.
  - `collectUmbrellaCharts(ctx: CollectContext, raws: RawProjectData[]): Promise<void>` — skips projects without `umbrellaChart` and unreadable coordinators; reads via `call(ctx, \`chart:${repo}@${ref}\`, …)`; release ref = `tagPrefix`-independent: the coordinator's `release.ok ? release.data.tagName : tag?.ok ? tag.data.name : null`; distinct env tags sorted by semver desc, first 10 read, the rest `'skipped'`.

- [ ] **Step 1: Failing tests** (fake provider recording `getFile(repo, path, ref)` calls):
  - `reads main, the release tag and one tag per distinct environment version` — envs DEV 1.4.0 (versions-file), TEST 1.4.0, PROD 1.3.0, LAB branch deployment → calls: `(path, undefined)`, `(path, 'v1.4.0')` once, `(path, 'v1.3.0')`; DEV and TEST share the same `ChartRead`; LAB absent.
  - `uses the tag fallback when there is no release, and skips the release read when there is neither`.
  - `reads at most 10 environment tags, newest first, the rest skipped` — 12 envs with distinct versions → 10 reads of the highest, 2 `'skipped'`.
  - `builds the tag from tagPrefix and keeps prereleases` — `tagPrefix: 'release-'`, env `1.5.0-rc.1` → ref `release-1.5.0-rc.1`.
  - `does nothing without umbrellaChart` → no calls, `raw.umbrella` undefined.
- [ ] **Step 2:** `npx vitest run tests/unit/umbrella-collect.test.ts` → FAIL.
- [ ] **Step 3: Implement**, wire `await collectUmbrellaCharts(ctx, raws)` in `run.ts` right after `collectEnvironmentStates`.
- [ ] **Step 4:** same command → PASS; `npx vitest run` → PASS.
- [ ] **Step 5: Commit** `feat(collector): read the umbrella chart on main, at the release and per environment`

### Task 4: Snapshot build

**Files:**

- Modify: `collector/src/normalizers/versions.ts` (`toComponents`, `toEnvironments`), `collector/src/build-snapshot.ts`
- Create (if it keeps `versions.ts` focused): `collector/src/normalizers/umbrella-model.ts`
- Test: `tests/unit/umbrella-model.test.ts`

**Interfaces:**

- Consumes: Task 2 `parseUmbrellaChart`, `mapChartToComponents`; Task 3 `raw.umbrella`.
- Produces: `umbrellaModel(ctx: BuildContext, raw: RawProjectData): { summary: UmbrellaChartSummary | null; components: Map<string, ComponentUmbrella>; environments: Map<string, EnvironmentComponentVersions> }`; `toComponents(ctx, raw, manifest, submodules, umbrella?: Map<string, ComponentUmbrella>)`; `toEnvironments(..., states, componentVersions?: Map<string, EnvironmentComponentVersions>)`.

Rules: state from `ProviderResult` (404 → `not-found`, 403 → `not-authorised`, other errors → `unknown`), parse failure → `invalid`. `component.umbrella = null` when no `umbrellaChart`; else `inUmbrella` from the **main** mapping, `main`/`release` versions from the main/release mappings, `conflict` true if either mapping flags it. Effective version: `versionSource: umbrella` → only `umbrella.release`; `auto` with `umbrellaChart` → `umbrella.release` → pin → manifest; `effectiveVersionSource: 'umbrella'`. Errors: `recordError(ctx, coordinatorRepo, undefined, 'umbrella-chart', result)` once per classification (same dedupe as the v0.18.0 deploy-signal block in `build-snapshot.ts`); a tag 404 is reported (a configured environment version whose tag is missing is a real problem).

- [ ] **Step 1: Failing tests** in `tests/unit/umbrella-model.test.ts`:
  - `publishes the chart on main, unmapped and aliases` → `summary` `{ path, state:'ok', chartVersion:'1.5.0', unmapped:['extra'], aliases:[] }`.
  - `uses the release chart as the auto version source and falls back to the pin when the component is not in it`.
  - `versionSource umbrella stays unknown when the release read failed` → `effectiveVersion: null`, `effectiveVersionSource: 'unknown'`.
  - `fills environment component versions, conflict cells and skipped environments`.
  - `reports a missing environment tag once as an umbrella-chart collection error`.
  - `changes nothing without umbrellaChart` → all three `null`.
- [ ] **Step 2:** `npx vitest run tests/unit/umbrella-model.test.ts` → FAIL.
- [ ] **Step 3: Implement** and pass the maps from `buildProjectSnapshot`.
- [ ] **Step 4:** `npx vitest run` → PASS.
- [ ] **Step 5: Commit** `feat(collector): component versions per environment in the snapshot`

### Task 5: Demo data and goldens

**Files:**

- Modify: `config/projects/project-alpha.yaml` (add `umbrellaChart: { path: deploy/helm/alpha/Chart.yaml }`)
- Modify: `fixtures/github/example-org__project-alpha-coordinator.json` (`files["deploy/helm/alpha/Chart.yaml"]` and `@v1.4.0`, `@v1.3.0` variants)
- Regenerate: `fixtures/snapshots/**` (`npm run fixtures:update`)
- Test: `tests/integration/collector.test.ts`

Demo content (spec §5.5): main chart `version: 1.5.0`, deps backend 1.4.0, frontend 2.1.0, worker 1.2.0, `alpha-legacy-reports` 0.3.0 (unmapped); `v1.4.0` same as main except version 1.4.0; `v1.3.0` frontend 2.0.3. Check the Alpha fixture first for the real dependency names (repository names of backend/frontend/worker) and its environment versions (DEV/TEST/UAT 1.4.0, PROD 1.3.0 in today's goldens), and its frontend latest release (make it newer than 2.1.0 if it is not, so ▲ shows).

- [ ] **Step 1: Failing test** `collector.test.ts`: `it('umbrella demo: Alpha has per-environment component versions')` → golden `project-alpha.json`: `coordinator.umbrellaChart.state === 'ok'`, `unmapped` contains `alpha-legacy-reports`; PROD `componentVersions.ref === 'v1.3.0'` with frontend `2.0.3`; TEST and UAT share ref `v1.4.0`; `platform.json` `coordinator.umbrellaChart === null`.
- [ ] **Step 2:** run → FAIL. **Step 3:** add fixtures, `npm run validate:config && npm run fixtures:update`. **Step 4:** `npx vitest run` → PASS (fix any golden-count assertions only if the change is intended).
- [ ] **Step 5: Commit** `feat(demo): umbrella chart for Project Alpha`

### Task 6: Versions page, i18n, CSV

**Files:**

- Create: `src/components/UmbrellaMatrix.astro`, `src/lib/umbrella-matrix.ts`
- Modify: `src/pages/[...lang]/versions.astro`, `src/pages/[...lang]/projects/[id].astro` (one link "Components by environment →" to the project's Versions card `#v-<id>` under the environments path, only with `umbrellaChart`), `src/i18n/en.ts`, `src/i18n/it.ts`, `src/lib/exports.ts`
- Test: `tests/unit/umbrella-matrix.test.ts`, `tests/integration/site.test.ts`, `tests/e2e/smoke.spec.ts`

**Interfaces:**

- Produces: `matrixOf(s: ProjectSnapshot): Matrix | null` in `src/lib/umbrella-matrix.ts` with `Matrix = { environments: { id; name; ref: string|null; status; header: 'declared'|'deployed'|'branch'|'unknown'; branch: {ref;sha}|null }[]; rows: { componentId; name; latest: string|null; main: string|null; cells: { version: string|null; reason: 'not-found'|'invalid'|'not-authorised'|'unknown'|'skipped'|'conflict'|'no-version'|null; waiting: boolean }[]; latestWaiting: boolean }[]; outside: { componentId; name; version: string|null }[]; unmapped: string[] } | null` (null without `umbrellaChart`). `waiting` = this cell is lower (semver) than the previous column's value; `latestWaiting` = latest release above `main`. `header`: `versions-file`/`manifest` → declared, `argocd`/`github-deployments` with a version → deployed, `branchDeployment(e)` → branch.

UI (spec §5.4): check cards render `<UmbrellaMatrix open>` **instead of** the `<ol class="vpath">`; aligned/unknown cards render it inside a closed `<details class="vmatrix">`. ▲ = Octicon `arrow-up` + visually hidden text; legend line. Unknown cells = existing dashed `EvidenceLabel level="unknown"` with the reason in `title`. Table in a `div` with `overflow-x: auto`. i18n keys under `d.versions.matrix` in both languages (title "Components by environment"/"Componenti per ambiente", columns, `outside`, `unmapped`, `legend`, reasons). CSV: `row_type: 'component-environment'` rows (one per component × environment with a read), `version` = cell version, `environment_source` = env source, `item_id` = `<componentId>@<envId>`; new trailing column `chart_ref` (empty elsewhere).

- [ ] **Step 1: Failing tests**
  - `umbrella-matrix.test.ts`: from the Alpha golden: frontend row `latestWaiting` per demo, PROD cell `{version:'2.0.3', waiting:true}`, `outside` lists Alpha components not in the chart, `unmapped: ['alpha-legacy-reports']`; `matrixOf(platform)` → null; a `skipped` env gives `reason:'skipped'` cells; a branch env gives `header:'branch'` and `reason:'no-version'` cells.
  - `site.test.ts`: versions page EN — Alpha card (check) contains `Components by environment` and no `class="vpath"`; IT page contains `Componenti per ambiente`; `versions.csv` has `component-environment` rows and the `chart_ref` header.
  - `site.test.ts`: Alpha project page links to `/versions/#v-project-alpha`; Beta project page has no such link.
  - `smoke.spec.ts` (mobile project): `versions page: the components table causes no horizontal scroll at 412 px`.
- [ ] **Step 2:** run the three → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `npx vitest run && npx astro check && npx playwright test` → PASS (stop any local preview on :4321 first).
- [ ] **Step 5: Commit** `feat(ui): components by environment on the Versions page`

### Task 7: Docs, changelog, real-data check

**Files:**

- Modify: `docs/configuration.md`, `docs/it/configuration.md` (section "Component versions from an umbrella chart" / "Versioni dei componenti da un chart umbrella": catalog fields, mapping rules, reads and bound, limits: `condition`, branch environments), `docs/operations.md`, `docs/it/operations.md` (upgrading to snapshot 1.11), `CHANGELOG.md` (`[Unreleased]`: Changed schema 1.11; Added feature)

- [ ] **Step 1:** write the docs; `npx prettier --check .` → clean.
- [ ] **Step 2: Real-data check (owner's machine, local only):** add `umbrellaChart: { path: infrastructure/helm/<name>/Chart.yaml }` to the local catalog in `config.local/`, run `npm run refresh:local -- --gh-user <corporate login>`, open `/versions/`: expect TEST/SVIL at the main-release chart, PROD at its older tag, LAB as `main @ sha`, data-db and shared libraries under "outside the umbrella", the aliased component counted once. Do not commit anything from `config.local/` or `public/data`.
- [ ] **Step 3:** `npm run lint && npm run typecheck && npx vitest run && npm run format:check` → PASS.
- [ ] **Step 4: Commit** `docs: umbrella chart component versions (EN/IT)`; push; open the PR with the template (Testing: `npm run build` not run locally, CI runs it).
