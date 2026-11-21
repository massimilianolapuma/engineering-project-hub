# Component deployments (versions per environment) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A component marked `deployments: true` shows, per environment, the version its own repository's GitHub Deployments say is running; the push script can record a deploy by tag.

**Architecture:** `scripts/report-deployment.sh` accepts `REF` instead of `SHA`. A new collector step, after the umbrella chart reads, reads the deployments of each flagged component's repository once per project environment, reusing the ledger read of `environment-states.ts` (extended with a third outcome). The snapshot (1.12) carries the result on the component; the existing components × environments table renders those components as a second group, with or without an umbrella chart.

**Tech Stack:** bash + curl + jq + openssl (script), TypeScript (tsx), zod 4, Astro 7, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-20-component-deployments-design.md` (IT: `docs/it/superpowers/specs/…`). Read it first; this plan does not repeat its rationale.

## Global Constraints

- Read-only GETs through the existing `SourceProvider.listDeployments` / `listDeploymentStatuses`; no new provider method, no new permission.
- At most **20** components with `deployments: true` per project (validation error above). Per component and environment: one list call and at most `MAX_STATUS_READS` (10) status reads.
- Nothing changes for a project with no flagged component: its goldens change only by the schema version and the new `environmentVersions: null`.
- Unreadable is **unknown**, never "not deployed"; `none` only when the environment has no deployment at all.
- A cell read from deployments is always marked as deployed (or "declared by hand"), also under a column whose header says "declared".
- Public repo: synthetic fixtures only (`example-org`); never commit `public/data`, `config.local/`, real names.
- EN + IT for every UI string and doc. Never run `npm run ci:build`, `collect:mock` or `build` (they overwrite `public/data`); goldens via `npm run fixtures:update`.
- Commits: Conventional Commits, on branch `feat/component-deployments` (rename the worktree branch, which already holds the spec commit).

## Review Focus

1. **Environment name differs from its id** (`{ id: svil, githubEnvironment: dev }`): the component read asks GitHub for `dev`, and the snapshot entry says `dev` so the cell title can name it. → test in Task 3.
2. **Component tag prefix** (`releaseTagPrefix: db-v`, deployment made from tag `db-v0.9.0`, payload without `version`) → version `0.9.0`. → test in Task 3.
3. **Failed deploy after a good one** → current stays the good one; **the 10 newest all failed** → `no-success`, never `none`. → tests in Task 3.
4. **Shared repository written with different case** (`Example-Org/Alpha-DB` vs `example-org/alpha-db`) is still shared → validation error. → test in Task 2.
5. **Narrow screens and no umbrella chart**: at 412 px the table with the group row scrolls inside its region; a project without an umbrella chart has no "Umbrella (main)" column. → e2e and site test in Task 6.

---

### Task 1: Push script accepts `REF`

**Files:**

- Modify: `scripts/report-deployment.sh`
- Test: `tests/unit/report-deployment-script.test.ts`

**Interfaces:**

- Produces: environment contract of the script: exactly one of `SHA` (`^[0-9a-f]{40}$`, unchanged) or `REF` (`^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$`, no `..`). With `REF` the create body has `ref: <REF>` and the lookup query has `ref=<REF>` (URL-encoded) and no `sha=`.

- [ ] **Step 1: Failing tests** (same fake GitHub server and `run(env)` helper as the existing tests; add the request query to what the fake records if it is not there)
  - `it('records a deploy by tag with REF')`: env without `SHA`, `REF: 'v0.9.0'`, `VERSION: '0.9.0'` → exit 0; the POST `/deployments` body has `ref === 'v0.9.0'` and `payload.version === '0.9.0'`; the GET `/deployments` path contains `ref=v0.9.0` and does not contain `sha=`.
  - `it('URL-encodes a REF with a slash')`: `REF: 'release/v1.0'` → the GET path contains `ref=release%2Fv1.0`.
  - `it('refuses SHA and REF together, and neither')`: both set → exit code ≠ 0, stderr contains `set exactly one of SHA or REF`, **zero** HTTP calls; same for neither.
  - `it('refuses an invalid REF before any call')`: each of `'../x'`, `'a..b'`, `'-x'`, `'v 1'`, `'a'.repeat(101)` → exit ≠ 0, stderr contains `REF must be a tag or branch name`, zero calls.
  - `it('a REF GitHub does not know is not recorded and does not fail')`: `createStatus = 422` → exit 0, stdout contains `not recorded (HTTP 422)`.
  - `it('is idempotent with REF')`: run twice → one deployment, second stdout contains `already recorded`.
- [ ] **Step 2:** `npx vitest run tests/unit/report-deployment-script.test.ts` → FAIL.
- [ ] **Step 3:** Implement in the script: replace `: "${SHA:?}"` with the one-of check (before the token request); validate `REF`; a variable holding the ref sent to GitHub (`SHA` or `REF`) used in the create body; the lookup uses `--data-urlencode "sha=$SHA"` or `--data-urlencode "ref=$REF"`. Update the header comment (`SHA or REF`).
- [ ] **Step 4:** run the test file → PASS (all earlier tests unchanged and green). `shellcheck scripts/report-deployment.sh` if available → no new warning.
- [ ] **Step 5: Commit** `feat(ledger): report a deployment by tag (REF) in the push script`

---

### Task 2: Catalog flag, snapshot 1.12 contract, catalog editor

**Files:**

- Modify: `shared/model/catalog.ts` (ComponentConfigSchema, project `superRefine`)
- Modify: `shared/model/snapshot.ts` (ComponentSnapshotSchema), `shared/model/enums.ts` (1.12)
- Modify: `src/lib/catalog-editor-core.ts` (keep `deployments` on save, next to `chartDependency`)
- Regenerate: `config/schema/*.json` (`npm run schema:generate`), `fixtures/snapshots/**` (`npm run fixtures:update`)
- Test: `tests/unit/config.test.ts`, `tests/unit/catalog-editor.test.ts`

**Interfaces:**

- Produces (catalog): `component.deployments?: boolean` (`z.boolean().optional()`: absent stays absent, so `catalog.json` does not change for other projects).
- Produces (validation, in the project `superRefine`):
  - more than 20 components with `deployments: true` → issue path `['components']`, message `at most 20 components with deployments: true`;
  - a flagged component whose `repository`, compared in lower case, equals the coordinator's or another component's → issue path `['components', i, 'deployments']`, message `not allowed when the repository is shared with the coordinator or another component`.
- Produces (snapshot), exported type `ComponentEnvironmentVersion`:
  - `ComponentEnvironmentStateSchema = z.enum(['ok','none','no-success','not-found','not-authorised','unknown'])`
  - `ComponentEnvironmentVersionSchema = z.object({ environmentId: string (max 100), environment: string (max 255) /* GitHub environment name read */, state, version: string|null (max 100), ref: string|null (max 100), revision: string|null /* 7 hex, as environment.deployment.revision */, deployedAt: ISO datetime|null, declared: boolean }).strict()`
  - `component.environmentVersions: ComponentEnvironmentVersion[] (max 50) | null`
  - `SNAPSHOT_SCHEMA_VERSION = '1.12'`, `SUPPORTED_SNAPSHOT_SCHEMA_VERSIONS = ['1.12']`, comment line `// 1.12: component versions per environment from the component's own GitHub deployments (component.environmentVersions).`

- [ ] **Step 1: Failing tests**
  - `config.test.ts`: `it('accepts deployments: true on a component with its own repository')`; `it('rejects deployments: true on a repository shared with the coordinator or another component')` (three cases: monorepo component in the coordinator repository; two components in one repository; the same with `Example-Org/Alpha-DB` vs `example-org/alpha-db`) → error message as above; `it('rejects more than 20 components with deployments: true')` (21 flagged components, each its own repository).
  - `catalog-editor.test.ts`: `it('keeps deployments when a project is saved')` → `projectToYaml(draftOf(project))` re-parsed keeps `deployments: true`, and a component without the flag has no `deployments` key in the YAML.
- [ ] **Step 2:** `npx vitest run tests/unit/config.test.ts tests/unit/catalog-editor.test.ts` → FAIL.
- [ ] **Step 3:** Implement the schemas, the two validations, the editor field and the version bump. In `collector/src/normalizers/versions.ts` `toComponents` set `environmentVersions: null` for now (Task 4 fills it).
- [ ] **Step 4:** `npm run schema:generate && npm run fixtures:update && npx tsc --noEmit -p tsconfig.json && npx vitest run` → PASS after updating the schema-version assertions (`1.11` → `1.12` in `tests/integration/collector.test.ts`, `tests/integration/site.test.ts`, `tests/unit/policy-check.test.ts`). The goldens differ only by the version and `environmentVersions: null`.
- [ ] **Step 5: Commit** `feat(model): deployments flag on components and snapshot 1.12 contract`

---

### Task 3: Collector reads the deployments of flagged components

**Files:**

- Modify: `collector/src/collectors/environment-states.ts` (extract the ledger read)
- Create: `collector/src/collectors/component-deployments.ts`
- Modify: `collector/src/collectors/collect.ts` (RawProjectData), `collector/src/run.ts` (call after `collectUmbrellaCharts`)
- Test: `tests/unit/component-deployments.test.ts`, `tests/unit/ledger-signal.test.ts` (unchanged, must stay green)

**Interfaces:**

- Consumes: `component.deployments` (Task 2); `raw.umbrella.main` (`ProviderResult<FileDTO>`), `parseUmbrellaChart`, `mapChartToComponents` from `collector/src/normalizers/umbrella-chart.ts`.
- Produces, in `environment-states.ts`:
  - `LedgerCurrent` gains `declared: boolean` (`payload?.declared ?? false`);
  - `export interface LedgerRead { current: LedgerCurrent | null; /** Deployments of the environment after the source filter. */ candidates: number }`
  - `export async function readLedger(provider: SourceProvider, repository: string, environment: string, opts: { tagPrefix: string; sources?: readonly string[] }): Promise<ProviderResult<LedgerRead> | null>` (null when the provider has no deployments methods). It holds the code that is today inside the `github-deployments` branch of `readEnvironmentState`; that branch calls it and maps `ok({current})` to today's `ok(current)`, so `EnvironmentState` does not change.
- Produces, in `component-deployments.ts`:
  - `export interface ComponentDeploymentRead { environmentId: string; environment: string; result: ProviderResult<LedgerRead> }`
  - `export type ComponentDeploymentsRaw = Map<string /* componentId */, ComponentDeploymentRead[]>`
  - `export async function collectComponentDeployments(ctx: CollectContext, raws: RawProjectData[]): Promise<void>` → sets `raw.componentDeployments` (absent when the project has no flagged component).
  - `RawProjectData.componentDeployments?: ComponentDeploymentsRaw`
- Rules: environment name = `env.githubEnvironment ?? env.id` (never the project signal's `environment` or `sources`); `tagPrefix` = `component.releaseTagPrefix ?? 'v'`; a flagged component is **skipped** (no call, no map entry) only when `raw.umbrella?.main` is ok, parses, and `mapChartToComponents(...).byComponent` has it; a component whose repository could not be read (`raw.repos` entry with `repo.ok === false`) is skipped too, as `collectEnvironmentStates` does. Each read goes through `call(ctx, 'component-deployments:<project>:<component>:<env>', …)`.

- [ ] **Step 1: Failing tests** (`component-deployments.test.ts`, mock provider built as in `tests/unit/ledger-signal.test.ts`)
  - `it('reads one result per project environment for a flagged component')` → entries in environment order, `environmentId` and `environment` set.
  - `it('asks GitHub for githubEnvironment when it differs from the id')` → environment `{ id: 'svil', githubEnvironment: 'dev' }` calls `listDeployments(repo, 'dev')`, entry `{ environmentId: 'svil', environment: 'dev' }`.
  - `it('ignores the environment and sources of the project deploy signal')` → project signal `{ type: 'github-deployments', repository: 'coordinator', environment: 'production', sources: ['azure-devops'] }`; the component read uses the id and counts a `github-actions` deployment.
  - `it('takes the version from the payload, else from the tag with the component prefix')` → payload `version: '0.9.0'` wins; no payload version, `ref: 'db-v0.9.0'`, `releaseTagPrefix: 'db-v'` → `0.9.0`; `ref: 'main'` → `version: null, ref: 'main'`.
  - `it('keeps the newest successful deployment when a newer one failed')` → `current` is the older success, `candidates: 2`.
  - `it('reports candidates without a current when the 10 newest have no success')` → 11 deployments, statuses `failure` → `current: null, candidates: 11`.
  - `it('an environment with no deployment gives current null and candidates 0')`.
  - `it('carries declared: true from a hand-declared record')`.
  - `it('does not read a component that the umbrella chart on main contains')` → zero `listDeployments` calls for it; `it('reads it when the main chart could not be read')`.
  - `it('makes no call for a project without flagged components')` → `raw.componentDeployments` undefined.
  - `it('a failed list is kept as the failed result')` → `result.ok === false`, classification `not-authorised`.
- [ ] **Step 2:** `npx vitest run tests/unit/component-deployments.test.ts` → FAIL.
- [ ] **Step 3:** Implement as in Interfaces.
- [ ] **Step 4:** `npx vitest run tests/unit/component-deployments.test.ts tests/unit/ledger-signal.test.ts && npx tsc --noEmit -p tsconfig.json` → PASS.
- [ ] **Step 5: Commit** `feat(collector): read the GitHub deployments of components deployed on their own`

---

### Task 4: Snapshot build

**Files:**

- Create: `collector/src/normalizers/component-deployments-model.ts`
- Modify: `collector/src/normalizers/versions.ts` (`toComponents`: new parameter), `collector/src/build-snapshot.ts`
- Test: `tests/unit/component-deployments-model.test.ts`

**Interfaces:**

- Consumes: `ComponentDeploymentsRaw`, `LedgerRead` (Task 3); `ComponentEnvironmentVersion` (Task 2).
- Produces: `export function componentEnvironmentVersions(ctx: BuildContext, raw: RawProjectData): Map<string, ComponentEnvironmentVersion[]>` (only components present in `raw.componentDeployments`). `toComponents(…, umbrellaByComponent, environmentVersionsByComponent = new Map())` sets `environmentVersions: map.get(comp.id) ?? null`.
- State mapping: result not ok → `not-found` / `not-authorised` by classification, else `unknown`; ok with `current` → `ok`; ok, `current` null, `candidates === 0` → `none`; ok, `current` null, `candidates > 0` → `no-success`. Fields other than `environmentId`, `environment`, `state`, `declared` are null unless `ok`. `ref` and `version` through `scrubIdentifier(…, 100)`, `environment` through `scrubIdentifier(…, 255)`, `revision` = first 7 characters of a full SHA (as `toLedgerDeployment`).
- Collection errors: a failed read → `recordError(ctx, <component repository>, <componentId>, 'deploy-signal', result)`, once per repository and classification (same `seen` check as in `build-snapshot.ts`).

- [ ] **Step 1: Failing tests**: one test per state of the mapping above (six states) with the exact output object; `it('records one deploy-signal error per repository and classification')` (three environments not authorised → one error); `it('a component without reads has environmentVersions null')` (through `toComponents`).
- [ ] **Step 2:** run → FAIL. **Step 3:** implement and wire in `build-snapshot.ts` next to `umbrellaModel`. **Step 4:** `npx vitest run && npx tsc --noEmit -p tsconfig.json` → PASS.
- [ ] **Step 5: Commit** `feat(collector): component environment versions in the snapshot`

---

### Task 5: Demo data and goldens

**Files:**

- Modify: `config/projects/project-alpha.yaml` (component `helm`: add `deployments: true`)
- Modify: `fixtures/github/example-org__project-alpha-helm.json` (`deployments`, `deploymentStatuses`)
- Regenerate: `fixtures/snapshots/**` (`npm run fixtures:update`)
- Test: `tests/integration/collector.test.ts`

**Interfaces:**

- Produces (demo, Project Alpha, component `helm`, latest release `v0.9.0`; environments `dev`, `test`, `uat`, `prod`):

  | Environment | Fixture                                                                                                     | Expected entry                 |
  | ----------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------ |
  | `dev`       | one deployment, `ref: main`, `payload: {}`, creator `github-actions[bot]`, status `success`                 | `ok`, version null, ref `main` |
  | `test`      | one deployment, `ref: v0.9.0`, ledger payload source `azure-devops`, `version: 0.9.0`, status `success`     | `ok`, `0.9.0`, declared false  |
  | `uat`       | one deployment, ledger payload `declared: true`, `version: 0.8.0`, status `success`                         | `ok`, `0.8.0`, declared true   |
  | `prod`      | newest: `version: 0.9.0`, status `failure`; older: `version: 0.8.0`, status `success` (both `azure-devops`) | `ok`, `0.8.0`, declared false  |

  Ledger payloads follow `shared/model/deployments-ledger.ts` (`ledger: 1`, `runId`, `runUrl` on `https://dev.azure.com/example-org/…`, `attempt`, `finishedAt`, `kind: 'deploy'`). Timestamps in the fixtures' `@now-<n>h` form.

- [ ] **Step 1: Failing test** in `collector.test.ts`: `it('Project Alpha: the helm component carries its own environment versions')` → the four entries of the table; every other Alpha component and every component of the other projects has `environmentVersions === null`.
- [ ] **Step 2:** run → FAIL. **Step 3:** add config and fixtures, `npm run validate:config && npm run fixtures:update`. **Step 4:** `npx vitest run` → PASS (golden diffs limited to Alpha's `helm`).
- [ ] **Step 5: Commit** `feat(demo): Project Alpha helm chart deployed on its own`

---

### Task 6: Versions page, i18n, CSV

**Files:**

- Modify: `src/lib/umbrella-matrix.ts`, `src/components/UmbrellaMatrix.astro`
- Modify: `src/pages/[...lang]/versions.astro` (lines using `s.coordinator.umbrellaChart` to show the table or the path), `src/pages/[...lang]/projects/[id].astro` (the "Components by environment →" link)
- Modify: `src/i18n/en.ts`, `src/i18n/it.ts` (`versionsPage.matrix`), `src/lib/exports.ts` (versions CSV)
- Test: `tests/unit/umbrella-matrix.test.ts`, `tests/integration/site.test.ts`, `tests/e2e/smoke.spec.ts`

**Interfaces:**

- Consumes: `component.environmentVersions` (Task 2), demo data (Task 5).
- Produces in `umbrella-matrix.ts`:
  - `export function hasMatrix(s: ProjectSnapshot): boolean` → `s.coordinator.umbrellaChart != null || s.components.some((c) => c.environmentVersions != null)`. The two pages use it wherever they test `s.coordinator.umbrellaChart` for the table, the environment path and the link.
  - `matrixOf(s)` returns null only when `!hasMatrix(s)`. `Matrix` gains `hasUmbrella: boolean` and `own: OwnRow[]`.
  - `export interface OwnCell { state: ComponentEnvironmentVersion['state']; version: string | null; branch: { ref: string; sha: string } | null /* ok without a version; sha = the entry's `revision` */; declared: boolean; deployedAt: string | null; environment: string; waiting: boolean }`
  - `export interface OwnRow { componentId: string; name: string; latest: string | null; cells: OwnCell[] }` (one cell per project environment, in order).
  - `waiting`: the cell's version is lower (semver) than the nearest version on its left; the walk starts from `normaliseVersion(latest)`; cells without a version are skipped, never guessed.
  - A component with `environmentVersions != null` is in `own` and never in `rows` or `outside`. Without an umbrella chart: `rows`, `outside`, `unmapped` empty, `hasUmbrella` false.
- Rendering (`UmbrellaMatrix.astro`): the chart line and the "Umbrella (main)" column only when `hasUmbrella`; own rows after the umbrella rows, preceded by a group row (`<tr class="um-group">` with one `<th scope="colgroup" colspan=…>`) only when `hasUmbrella`; own rows carry `data-component` and `data-own`; their "Umbrella (main)" cell is the muted dash with `t.notInUmbrella`. Cell: version + deployed mark (an existing Octicon + visually hidden text, `title` = `deployed <date>` via the existing date format); a declared record uses a **different** Octicon and `t.ownDeclared`; branch deployment as `f(d.sources.refAt, branch)`; `none` → muted dash, title `f(t.ownNone, { env })`; other states → `EvidenceLabel level="unknown"` with `t.reason[state]`. Each `<td>` has `data-env` and `data-state`. A second legend line (`t.ownLegend`) when `own.length > 0`.
- i18n keys added under `versionsPage.matrix` (EN / IT):
  - `ownGroup`: `Deployed on their own` / `Deployati per conto proprio`
  - `ownDeployed`: `deployed` / `deployato`
  - `ownDeclared`: `declared by hand` / `dichiarato a mano`
  - `ownNone`: `No deployment recorded for environment {env}` / `Nessun deployment registrato per l'ambiente {env}`
  - `notInUmbrella`: `Not in the umbrella chart` / `Non nell'umbrella chart`
  - `ownLegend`: `Deployed: read from the GitHub Deployments of the component's own repository.` / `Deployato: letto dai GitHub Deployments del repository del componente.`
  - `reason['no-success']`: `No successful deployment among the newest 10` / `Nessun deployment riuscito tra i 10 più recenti`
- CSV (`exports.ts`): one `component-environment` row per own row and environment whose state is `ok`: `item_id` `<componentId>@<envId>`, `version` (null for a branch deployment), `version_source` = `deployment`, or `declared` when `declared`; `chart_ref` not applicable. No new header.

- [ ] **Step 1: Failing tests**
  - `umbrella-matrix.test.ts`: `it('Alpha: helm is an own row, not outside the umbrella')` (cells: dev branch `main`, test `0.9.0`, uat `0.8.0` declared, prod `0.8.0`); `it('marks an own cell below the nearest version on its left, starting from the latest release')` (uat waiting, prod not; a row with latest `v0.9.0` and first environment `0.8.0` waits there); `it('builds the table for a project without an umbrella chart')` (`hasUmbrella` false, `rows` empty, `own` length 1); `it('is null without an umbrella chart and without flagged components')`; `it('none, no-success and failed reads keep their state and never a version')`; `it('never lists a flagged component among the umbrella rows when main could not be read')`.
  - `site.test.ts`: versions page EN — Alpha card contains `Deployed on their own`, a row `data-own` for `helm`, `declared by hand`; IT page contains `Deployati per conto proprio`; `Outside the umbrella (1)` no longer appears for Alpha; `versions.csv` has a row `helm@test` with `version_source` `deployment` and `helm@uat` with `declared`; a project built from a modified golden with no umbrella chart and one flagged component renders the table without `Umbrella (main)` and without `class="vpath"`.
  - `smoke.spec.ts`: at 412 px the Alpha table region scrolls inside itself and the page has no horizontal scroll; the group row is visible; axe has no new violation on the Versions page (EN and IT).
- [ ] **Step 2:** run → FAIL. **Step 3:** implement.
- [ ] **Step 4:** `npx vitest run && npx astro check && npx playwright test` → PASS (stop any local preview on :4321 first). `npm run lint && npm run format:check` → clean.
- [ ] **Step 5: Commit** `feat(site): own-deployment rows in the components by environment table`

---

### Task 7: Docs, changelog, final review, PR

**Files:**

- Modify: `docs/deployments-ledger.md`, `docs/it/deployments-ledger.md` (push section: `SHA` or `REF`, the deploy-by-version example of spec §5.1, the rule "exactly one")
- Modify: `docs/configuration.md`, `docs/it/configuration.md` (new section "Component versions from the component's own deployments" / "Versioni dei componenti dai deployment del componente": the flag, the environment name rule, the two validation errors, the states, the limit of 20)
- Modify: `CHANGELOG.md` (`## [Unreleased]`: `### Changed` snapshot 1.12 needs a re-collect; `### Added` the feature, the script `REF`, the demo)
- Modify: `README.md`, `README.it.md` only if they list the Versions page features (one line)

- [ ] **Step 1:** Write the docs. `npm run format:check` → clean.
- [ ] **Step 2:** Full verification: `npx vitest run`, `npm run lint`, `npm run typecheck`, `npm run format:check`, `npx playwright test` → all green.
- [ ] **Step 3:** Fresh reviewer on the most capable model, with the spec and this plan's Review Focus. One fix pass for Critical and Important findings, each with a failing test first. Minors are listed for the owner.
- [ ] **Step 4: Commit** `docs: component deployments and REF in the push script`. Push, open the PR to `main`, check the failed checks and code scanning. Merge, release v0.20.0 and the deploy repository pin wait for the owner.
