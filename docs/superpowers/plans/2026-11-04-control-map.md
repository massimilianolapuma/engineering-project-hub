# Control map (v0.16.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-project map of 25 technical controls on the 0–5 assessment scale, with DORA and ISO 27001 references, a control score, delivery metrics from per-environment deploy signals, and a heatmap page — never a compliance claim.

**Architecture:**

- **Model first** (`shared/model/control-map.ts`): the check catalogue (ids, areas, references, default ladders), levels, the snapshot `controlMap` block (schema 1.9), the policies and catalog additions.
- **Collector:** four new readings (resolved-at dates of closed alerts, push protection flag, GitHub environments, deploy signals) and one new parse of already-fetched workflow files (OIDC). A pure evaluator then turns the project snapshot into levels, a score and per-business-unit medians.
- **Site:** a new `controls/` page (heatmap and cell detail), a project block, How to read, a CSV export, Prometheus metrics and a Grafana panel.

**Tech Stack:** TypeScript 6, Zod, Octokit, Astro 7, Vitest, Playwright. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-04-control-map-design.md` (IT mirror in `docs/it/`). Read §4–§5. Section numbers (§) refer to the spec.

## Before you start

- Branch `feat/compliance-heatmap` from `main` at v0.15.0 (`5f31f58`); the session runs inside the worktree `../ehub-wt-v0110`.
- Release values: **v0.16.0**, snapshot schema **1.9** (`SUPPORTED_SNAPSHOT_SCHEMA_VERSIONS = ['1.9']`, as earlier bumps did: the hub always re-collects), ADR **0014**.
- **Owner instruction (2026-11-04): "procedi fino alla fine".** Mockups are generated from the built page for post-hoc review (as in v0.14.0), and the PR is merged when CI is green.

## Global Constraints

- **Never a compliance claim** (spec anti-goal 1, C5): no visible EN/IT text, CSV header or metric HELP says "compliant", "compliance with", "conforme" or "conformità" as a claim. References are shown as "related" / "collegati".
- **Unknown ≠ zero** (C2): a check whose source is unreadable has a null level ("not visible"); "% of repositories" checks are computed over readable repositories ("k of n readable"); fewer than half readable → null.
- **Not applicable** only by the rules of §5.4. `required: false` controls still count (owner decision).
- **Audience gating** (C9): the control map (page, CSV, metrics, snapshot `controlMap`) is produced only when `publication.audience === 'restricted'` or `run.dataSource === 'mock'`.
- **Read-only:** new API calls are GET only. Workflow files are the ones already fetched (no new file reads for OIDC).
- **Language:** every string EN + IT; docs EN + IT (plans excepted). Synthetic data only (no real company, BU, team or project names; the owner's real versions-file example is generic: `environments/<env>.yaml`, key `umbrella`).
- **Data safety:** never run `npm run ci:build` / `collect:mock`; goldens via `npm run fixtures:update`; never use port 4321 (e2e on 4377 via temp config, then delete it and `.e2e-dist/`); podman only.
- **Commits:**
  - `git -c user.name=massilp -c user.email=3519719+massilp@users.noreply.github.com commit`;
  - Conventional Commits, no attribution trailers;
  - `npx prettier --write` before each commit.

## Review Focus

1. **A project where most repositories are unreadable (403).** Expected: "% of repositories" checks show "k of n readable", and they are null when fewer than half were read. They are never lowered by the unreadable repositories. Pinned in Task 2.
2. **A versions file with a non-semver value, a rollback, and a formatting-only commit.** Expected: the non-semver commit is skipped and noted; the rollback counts as a failure; the formatting commit is ignored. Pinned in Task 4.
3. **A public deployment with real data.** Expected: no `controls/` page, no CSV, no metrics and no `controlMap` in the snapshot. Pinned in Tasks 5 and 6.
4. **A delivery environment with `deploySignal: external`, or none.** Expected: the four delivery checks are null with the reason "deployed by external pipelines", and they are never 0. Pinned in Task 4.
5. **A catalog saved from the editor after adding `deploySignal`.** Expected: the fields survive the save. Pinned in Task 1.

---

### Task 1: Model — check catalogue, levels, snapshot block, policies and catalog fields

**Files:**

- Create: `shared/model/control-map.ts` (export from `shared/model/index.ts`)
- Modify:
  - `shared/model/enums.ts`: schema `1.9`;
  - `shared/model/snapshot.ts`: `ProjectSnapshot.controlMap`, `ProjectSummary.controlMap`, both `.nullable()`;
  - `shared/model/policies.ts`: `controlMap` block;
  - `shared/model/catalog.ts`: `EnvironmentConfigSchema.deploySignal`, `.delivery`, `.githubEnvironment`; `ProjectConfigSchema.controlMap.notApplicable`;
  - `src/lib/catalog-editor-core.ts`: keep the new fields on save;
  - `config/schema/*.json` (`npm run schema:generate`).
- Test: `tests/unit/control-map-model.test.ts`, `tests/unit/catalog-editor.test.ts`

**Interfaces:**

- Produces (from `@model/index`):
  - `CONTROL_AREAS = ['supply-chain','vulnerabilities','secrets','change-access','delivery','evidence'] as const`.
  - `CONTROL_CHECKS: readonly CheckDef[]`, the 25 checks of spec §5.2 in table order. A `CheckDef` is `{ id: CheckId; area: Area; dora: string[]; iso: string[] }`, with the exact references of the spec tables (e.g. `dora: ['art. 8', 'RTS art. 4–5', 'RTS art. 16']`, `iso: ['5.9', '5.21']`).
  - `CheckIdSchema` is a `z.enum` of the 25 ids.
  - `type Level = 0|1|2|3|4|5`.
  - `ControlCellSchema`:
    - `check: CheckId`;
    - `level: 0..5 | null`;
    - `state: 'measured' | 'not-visible' | 'not-applicable'`;
    - `value: number | null`;
    - `unit: 'percent'|'count'|'per-week'|'hours'|'days'|'level'`;
    - `readable: { k: int; n: int } | null`;
    - `reason: ReasonCode | null`, where `ReasonCode = 'source-unreadable'|'too-few-readable'|'external-pipelines'|'no-deploy-signal'|'no-object'|'catalog-not-applicable'|'needs-permission'|'no-argocd'|'insufficient-events'`;
    - `note: string | null` (≤ 200 chars, e.g. the catalog n/a reason);
    - `environment: string | null`;
    - `signal: 'workflow'|'versions-file'|'argocd'|'release'|'external' | null`.
    - Strict.
  - `ControlMapSchema`: `{ cells: ControlCell[] (25, check order), score: int 0–100 | null, measured: int, applicable: int, areas: Record<Area, { score: int|null; measured: int; applicable: int }> }`.
  - `ControlMapSummarySchema`: `{ score, measured, applicable, levels: Record<CheckId, Level | null | 'n/a'> }`.
  - `policies.controlMap`: `{ enabled: boolean = true; windows: { frequencyDays: 1–90 = 30; trendDays: 7–365 = 90 }; thresholds: Partial<Record<CheckId, number[]>> = {} }`. A thresholds entry overrides that check's ladder, with 5 ascending (or descending, per check) numbers for levels 1–5.
  - Environment `deploySignal`, a discriminated union on `type`:
    - `{ type: 'workflow'; workflow: <trackedWorkflows id> }`;
    - `{ type: 'versions-file'; repository: 'coordinator' | <component id>; path: relativePath; key: string (dot path, ≤ 100); tagPrefix: string = 'v' }`;
    - `{ type: 'argocd' }`, `{ type: 'release' }`, `{ type: 'external' }`.
    - Defaults to `external`.
  - Environment `delivery: boolean` and `githubEnvironment: string ≤ 255`, both optional.
  - `ProjectConfig.controlMap: { notApplicable: { check: CheckId; reason: string 1–200 }[] }`, defaulting to `{ notApplicable: [] }`.
  - At most one environment per project with `delivery: true` (superRefine, message `only one delivery environment`); a `workflow` signal must reference an existing tracked workflow id.

- [ ] **Step 1: Write the failing tests:**
  - `CONTROL_CHECKS` has 25 entries, ids unique, in spec order. Every entry has ≥ 1 ISO reference and ≥ 1 DORA reference. No reference string contains "compliant".
  - The catalog accepts the spec §5.3 example. It rejects two `delivery: true` environments, a `workflow` signal naming an unknown workflow, a `versions-file` signal without `key`, and a `controlMap.notApplicable` item without a reason.
  - `PoliciesSchema` defaults `controlMap` to `{ enabled: true, windows: { frequencyDays: 30, trendDays: 90 }, thresholds: {} }`.
  - `ControlCellSchema` rejects `level: 6` and an unknown reason.
  - Catalog editor: a project whose environment has `deploySignal`, `delivery` and `githubEnvironment` round-trips unchanged through the editor's serialise function.
- [ ] **Step 2: Run** `npx vitest run tests/unit/control-map-model.test.ts tests/unit/catalog-editor.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, then `npm run schema:generate`.
- [ ] **Step 4: Run** the tests plus `npx vitest run tests/unit/json-schema.test.ts tests/unit/config.test.ts`. Expected: PASS. The schema bump breaks the goldens and site tests until Task 5; that is expected, so do not run the full suite here.
- [ ] **Step 5: Commit** `feat(model): control map checks, levels and catalog deploy signals`.

---

### Task 2: Evaluator for the checks on existing data (pure)

**Files:**

- Create: `collector/src/evaluators/control-map.ts`, `collector/src/evaluators/control-map-ladders.ts`
- Test: `tests/unit/control-map.test.ts`

**Interfaces:**

- Consumes: Task 1 types; `ProjectSnapshot` (fields mapped in the research notes: `securityControls[].controls[]`, `supplyChain.repositories[]`, `repositoryControls.repositories[].checks[]`, `securityHealth`, `qualityHealth`, `dataFreshness`, `environments[]`).
- Produces:
  - `levelFor(check: CheckId, value: number, override?: number[]): Level`: the default ladders of spec §5.2. Higher-is-better checks use ascending thresholds; for lower-is-better checks (ages, rates, times, counts of problems) the ladder is descending.
  - `ratioOverReadable(states: ('pass'|'fail'|'unknown')[]): { value: number | null; readable: { k: number; n: number }; reason: ReasonCode | null }`: null with `too-few-readable` when `k < n/2`; `n = 0` gives `no-object`.
  - `evaluateControlMap(input: ControlMapInput, policies: Policies['controlMap']): ControlMap`, where `ControlMapInput = { snapshot: ProjectSnapshot; project: ProjectConfig; extras: ControlMapExtras }` and `ControlMapExtras` is produced by Tasks 3–4 (Task 2 passes `emptyExtras()`: every new-source field null, so those checks come out null with `needs-permission` or `no-deploy-signal`).
  - `scoreOf(cells: ControlCell[]): { score: number | null; measured: number; applicable: number }`: round(mean × 20), or null when `measured < applicable / 2`.
  - `businessUnitMedian(cells: ControlCell[][]): (Level | null)[]` (median of known levels per check, half rounding down).
- Per-check rules (value → level via `levelFor`), all over unique repositories unless stated:
  - `sbom-coverage`: `sbom.state` available or partial counts as pass, not-configured counts as fail, the rest unknown.
  - `image-signature`: distinct digests with `signature === 'verified'` over images with a known signature; no images gives n/a (`no-object`).
  - `build-provenance`: `attestations.withProvenance > 0` passes, `none` fails; not-applicable or off gives n/a.
  - `license-policy`: flagged = 0 and `policies.supplyChain.sbom.flaggedLicenses.length > 0` gives 5; flagged = 0 without a policy gives 3; flagged > 0 gives 1; unknown without any readable SBOM.
  - `dependency-scanning`, `sast`, `container-scanning`, `iac-scanning`, `dast`: control state `enabled` passes; `not-configured`, `configured-not-run` and `failed` fail; `stale` fails for `sast` (outside the window) and passes for the others; `not-applicable` on every component gives n/a.
  - `vulnerability-age`: `remediation.overdue.critical + high`, with level 5 when 0 and nothing within 7 days of its due date (`securityFindings[].sla.dueAt`).
  - `secret-scanning`: the secretScanning control enabled ratio. Level 4 needs push protection (Task 3), so without Task 3 data the level is capped at 3 and `note: 'push protection not read'`.
  - `exposed-secrets`: `openSecretAlerts` (null gives not visible).
  - `branch-protection`: a repository passes when `branch-protected`, `pull-request-required` and `force-push-blocked` all pass.
  - `required-checks`: `status-checks-required`.
  - `pipeline-integrity`: `actions-pinned` and `reusable-workflows-current`.
  - `config-drift`: environments with `deployment.sync` synced over environments with a known sync; no Argo CD mapping gives not visible (`no-argocd`).
  - `test-coverage`: `qualityHealth.percentage`.
  - `evidence-freshness`: sources read and not stale over all evidence sources of the project (the per-source flags listed in the research notes).
  - Applicability by catalog: `controlMap.notApplicable` entries give n/a with `catalog-not-applicable` and the reason as `note`.

- [ ] **Step 1: Write the failing tests** (hand-built snapshot fragments via `tests/helpers/factories.ts`):
  - **Ladders:** the threshold edges for each ladder kind (e.g. `levelFor('sbom-coverage', 85) === 4`, `84.9 → 3`, `100 → 5`, `0 → 0`; `levelFor('lead-time', 24) === 4`, `24.1 → 3`).
  - **Partial reads:** `ratioOverReadable(['pass','unknown','unknown'])` gives `{ value: null, reason: 'too-few-readable' }`, and `['pass','fail','unknown']` gives value 50 with readable `{ k: 2, n: 3 }`.
  - **No images:** `image-signature` is n/a with `no-object`.
  - **Required false still counts:** an `sbom` control with `required: false` and state `not-configured` gives level 0 (not n/a).
  - **Catalog n/a:** `controlMap.notApplicable: [{check:'dast', reason:'no web UI'}]` gives n/a with note `no web UI`.
  - **Score:** `scoreOf` with levels [4,4,2,null] and applicable 4 gives 67 (round(10/3 × 20)), measured 3; with 1 of 4 measured, the score is null.
  - **Median:** `businessUnitMedian([[4],[2],[null]])` gives `[3]` (median of 4 and 2, rounded down).
- [ ] **Step 2: Run** `npx vitest run tests/unit/control-map.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(collector): control map evaluator on existing evidence`.

---

### Task 3: New readings — resolved alerts, push protection, environments, OIDC

**Files:**

- Modify:
  - `collector/src/providers/types.ts`: `RepositoryDTO.pushProtection: 'enabled'|'disabled'|null`; a `resolvedAt: string|null` on the code scanning, Dependabot and secret scanning DTOs; new `listEnvironments(repo)`;
  - `collector/src/providers/github/github-provider.ts`: map `security_and_analysis.secret_scanning_push_protection.status`, `fixed_at`/`dismissed_at`/`resolved_at`, and `GET /repos/{o}/{r}/environments`;
  - `collector/src/providers/mock/mock-provider.ts` and fixtures: keys `environments`, `pushProtection`, resolved dates on some closed alerts;
  - `shared/model/findings.ts`: `resolvedAt: utcDate | null` on findings;
  - `collector/src/normalizers/repository-controls-model.ts` (or a new `collector/src/normalizers/workload-identity.ts`): `detectWorkloadIdentity(parsed workflows)`.
- Test: `tests/unit/control-map-sources.test.ts`, `tests/unit/github-provider.test.ts`

**Interfaces:**

- Produces `ControlMapExtras` per project (built in `build-snapshot.ts`):
  - `pushProtection: ('enabled'|'disabled'|null)[]` per unique repository;
  - `environments: Map<repository, { name: string; protected: boolean; branchPolicy: boolean }[] | null>`, where null means unreadable or a 403 (`needs-permission`);
  - `resolvedMedianDays: number | null`: the median of `resolvedAt − detectedAt` over critical/high findings resolved within `trendDays`; null when none are resolved or no dates are available;
  - `workloadIdentity: { deploying: number; oidc: number } | null`;
  - `deploy` (Task 4).
- OIDC rule (spec §5.2 definitions):
  - **deploying:** uses `azure/login`, `aws-actions/configure-aws-credentials`, `google-github-actions/auth`, or has a job `environment:`;
  - **OIDC:** `permissions['id-token'] === 'write'` (at job or workflow level) and the login step's `with` has none of `creds`, `credentials_json`, `aws-secret-access-key`, `client-secret`.
- `environment-separation` ladder exactly as in spec §5.2. The production environment is the `delivery` one (or the last) mapped by `githubEnvironment ?? id`.
- `security-mttr` thresholds in days (5 ≤ 1, 4 ≤ 7, 3 ≤ 30, 2 ≤ 90, 1 > 90).

- [ ] **Step 1: Write the failing tests:**
  - **OIDC:** a workflow with `id-token: write` and `azure/login` without `creds` counts as OIDC; one with `with: { creds: ${{ secrets.AZ }} }` counts as long-lived; a workflow with neither login nor environment is not deploying. No deploying workflow gives `workload-identity` n/a (`no-object`).
  - **Environment separation:** levels 0–5 on hand-built inputs; a 403 gives null with `needs-permission`.
  - **Push protection:** all enabled at 100% gives `secret-scanning` level 5; scanning enabled with push protection null gives level 3 with a note.
  - **Security MTTR:** resolved findings 2 and 10 days after detection give a median of 6, so level 4.
  - **Provider:** `getRepository` maps the push protection status; `listEnvironments` maps `protection_rules` (required reviewers or wait timer) to `protected` and `deployment_branch_policy` to `branchPolicy`; a 403 gives a `not-authorised` result.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** A new collection error source value: `github-environments`.
- [ ] **Step 4: Run** `npx vitest run tests/unit/control-map-sources.test.ts tests/unit/github-provider.test.ts tests/unit/control-map.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(collector): read push protection, environments, resolved alerts and OIDC usage`.

---

### Task 4: Deploy signals and delivery metrics

**Files:**

- Create: `collector/src/collectors/deploy-signals.ts`, `collector/src/evaluators/delivery-metrics.ts`
- Modify:
  - `collector/src/providers/types.ts` + GitHub + mock: `listCommitsForPath(repo, path, since)` (`GET /repos/{o}/{r}/commits?path=&since=&per_page=100`, first page only) and `listReleases(repo)` (published releases with `published_at`, first 100);
  - `collector/src/providers/external/argocd.ts`: keep `status.history[].deployedAt` (deploy events only).
- Test: `tests/unit/deploy-signals.test.ts`, `tests/unit/delivery-metrics.test.ts`

**Interfaces:**

- Produces:
  - `type DeployEvent = { at: string; kind: 'deploy' | 'failure' | 'rollback'; version: string | null; leadHours: number | null }`.
  - `collectDeploySignal(provider, project, environment, now, windows): Promise<{ events: DeployEvent[]; signal; reason: ReasonCode | null; notes: string[] }>`, with one mode per signal type:
    - `workflow`: completed runs of the tracked workflow on the default branch within the window. `success` is a deploy and `failure` a failure. Lead time is `run.updatedAt − commit date of run.sha`, read via the existing `compareCommits` or the commit date from the run.
    - `versions-file`: commits on the path within the window (oldest first). Read the file at each commit (`getFile(repo, path, sha)`), parse YAML or JSON, and take `key`.
      - Higher semver than the previous value is a deploy; lower is a rollback; equal is ignored.
      - A non-semver value: skip that commit and add a note `non-semver value at <short sha>`.
      - Lead time: the tag `${tagPrefix}${version}` commit date (`getLatestTag`/`listTags` lookup) up to the promotion commit date.
    - `argocd`: history `deployedAt` entries are deploys. CFR and TTR are null (`insufficient-events`), as is lead time.
    - `release`: releases are deploys. CFR, TTR and lead time are null.
    - `external`: no events, reason `external-pipelines`.
  - `deliveryMetrics(events, signal, windows, now): { frequencyPerWeek: number|null; leadHoursMedian: number|null; cfrPercent: number|null; ttrHoursMedian: number|null }`:
    - frequency over `frequencyDays`;
    - the others over `trendDays`;
    - CFR = (failures + rollbacks) / (deploys + failures);
    - TTR = median time from a failure to the next deploy, and for rollbacks from the rolled-back deploy to the rollback.
    - Fewer than 1 deploy in the window: frequency 0 (a measured zero, since the signal was readable), the others null.

- [ ] **Step 1: Write the failing tests** with a fixed `now` and a fake provider:
  - **Versions file:** the commit sequence `0.4.0 → 0.5.0 → 0.5.0 (formatting) → 0.4.0 (rollback) → 0.5.1 → "latest"` gives 2 deploys (0.5.0, 0.5.1), 1 rollback, 1 note `non-semver value`, and CFR = 1/3 → 33.3.
  - **Workflow:** runs success, failure, success 2 h later give 2 deploys and 1 failure; TTR is 2 h; CFR is 33.3.
  - **External:** gives `reason: 'external-pipelines'` and no events; the evaluator turns the four delivery cells null with that reason and `environment: 'PROD'`.
  - **No environments:** the delivery checks are n/a (`no-object`).
  - **Lead time:** tag created 2026-01-10T10:00Z, promotion 2026-01-11T10:00Z gives 24 h, so level 4.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** Wire it into `ControlMapExtras.deploy` and the evaluator's delivery checks.
- [ ] **Step 4: Run** `npx vitest run tests/unit/deploy-signals.test.ts tests/unit/delivery-metrics.test.ts tests/unit/control-map.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(collector): deploy signals per environment and delivery metrics`.

---

### Task 5: Snapshot integration, goldens, metrics, CSV

**Files:**

- Modify:
  - `collector/src/build-snapshot.ts`: compute `controlMap` and its summary when gated (C9), else null;
  - `collector/src/run.ts` / index builder: business-unit aggregates are computed in the site from summaries, no index field;
  - `collector/src/outputs/prometheus.ts`: `hub_project_control_score`, `hub_project_control_level{project,check}`, `hub_project_control_measured` (added to `METRIC_FAMILIES` after `hub_project_measure_known`, omitted when null or not gated);
  - `examples/grafana/engineering-project-hub.json` (via the generator) gains a "Control score" panel;
  - `src/pages/exports/control-map.csv.ts` (new; same CSV helpers as the other exports);
  - mock config and fixtures:
    - `config/projects/*.yaml`: deploy signals of every type across the demo projects, at least one `external`, one `versions-file` with a rollback, one `workflow`, and one `controlMap.notApplicable`;
    - `fixtures/github/*`: environments, push protection, resolved dates, versions-file commits and files, releases.
- Regenerate: `fixtures/snapshots/**` (`npm run fixtures:update`).
- Test: `tests/integration/collector.test.ts`, `tests/unit/prometheus.test.ts`, `tests/unit/grafana-dashboard.test.ts`, `tests/integration/site.test.ts` (CSV only)

- [ ] **Step 1: Write the failing tests:**
  - The golden index has `schemaVersion: '1.9'`, and every project summary has a `controlMap` with 25 level keys.
  - The demo project with the `external` prod has its four delivery cells null with `external-pipelines`.
  - The versions-file project has `change-failure-rate` measured.
  - A run with `audience: public` and `dataSource: github` (the collector integration's GitHub-shaped mock run) has `controlMap: null` everywhere and no `hub_project_control_*` series.
  - The CSV has the header `project,business_unit,check,area,level,state,value,unit,readable,source_environment,collected_at` and one row per project × check.
  - No visible string in the CSV says "compliant".
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement**, then run `npm run fixtures:update`.
- [ ] **Step 4: Run** the full suite: `npx vitest run`. Expected: PASS. Fix the test expectations that changed only because of the schema bump (version strings), and ledger each one.
- [ ] **Step 5: Commit** `feat: control map in snapshots, metrics and CSV (schema 1.9)`.

---

### Task 6: Page "Control map", project block, How to read

**Files:**

- Create:
  - `src/pages/[...lang]/controls.astro`;
  - `src/lib/control-map-view.ts` (pure: rows grouped by business unit with medians, filters, cell text);
  - `src/scripts/control-map.ts` (filters and the cell-detail disclosure; no `innerHTML`).
- Modify:
  - `src/lib/routes.ts`: `PageKey 'controls'`, path `controls/`, NAV after `security`, icon `checklist` (add it to `OCTICON_NAMES`), `navFor` also hides it when the map is off or not gated;
  - `src/pages/[...lang]/projects/[id].astro`: a "Controls" block with the score and a link;
  - `src/pages/[...lang]/how-to-read.astro`: `#control-map`, covering levels, n/a vs not visible, signals and "not a compliance assessment";
  - `src/i18n/en.ts`, `it.ts`: a `controlMap` block (check names, areas, levels, reasons, lede, references);
  - `src/styles/global.css`.
- Test: `tests/integration/site.test.ts`, `tests/unit/control-map-view.test.ts`, `tests/e2e/control-map.spec.ts`

Page per spec §5.5:

- **Lede:** exact text of spec §5.5.
- **Heatmap:** a `<table>` with a `<caption>`; columns are grouped by area with `<th scope="colgroup">`; rows are each business unit (median, `<th scope="rowgroup">`) followed by its projects.
- **Cells:** each cell is a `<button>` showing the level number, with a `data-level` colour class. Not visible is hatched with the text "–" plus `aria-label` "Not visible: <reason>"; n/a is empty with `aria-label` "Not applicable".
- **Score column:** the score with "measured N of M".
- **Cell detail:** in a `<details>`-style panel (one per project row, filled by the script from `data-*` attributes rendered at build): level name, value with unit, threshold, source and age, environment and signal, DORA and ISO references, and links to the project page anchors.
- **Legend, references and export:** the levels legend; a "References" table (check, area, DORA, ISO); the CSV link.
- **Filters:** business unit, area, `?team=`.
- **Colour scale:** sequential, single hue; validate it with the dataviz skill's `scripts/validate_palette.js` in light and dark; the number is always visible.

- [ ] **Step 1: Write the failing tests:**
  - **Site:** `controls/index.html` and `it/controls/index.html` exist. The nav has `controls/` after `security/`. The lede is present. 25 column headers appear. The external project's delivery cells carry `aria-label` "Not visible: deployed by external pipelines". The visible text has none of `compliant`, `conforme`, `conformità`. A build with `audience: public` and real-looking data (the index's `dataSource` set to github) has no `controls/` directory and no nav link.
  - **View:** BU medians and filter logic.
  - **e2e:**
    - keyboard: Tab to a cell, Enter opens the detail with the references;
    - `?team=` filters the rows;
    - at 390px the page does not scroll sideways (only the table wrapper scrolls).
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** Then build the golden site, screenshot it (light, dark, 390px, detail open) and fix any drift.
- [ ] **Step 4: Run** the site, view, i18n and token-contrast tests, then e2e on port 4377. Expected: PASS.
- [ ] **Step 5: Commit** `feat(site): control map page`.

---

### Task 7: Docs, ADR 0014, canvas

**Files:**

- Create: `docs/control-map.md` and `docs/it/control-map.md` (every check, its ladder, source, references, signals and how to configure them, applicability, the not-a-compliance-assessment statement); `docs/architecture/adr/0014-control-map.md` and the IT version.
- Modify: `docs/configuration.md` and IT (`deploySignal`, `delivery`, `githubEnvironment`, `controlMap`), `docs/architecture.md` and IT (ADR list), `docs/security.md` and IT (new read permissions: environments, `security_and_analysis`), README and IT (one paragraph), CHANGELOG (Unreleased).

- [ ] **Step 1: Re-check the references** on the official texts (RTS 2024/1774 article titles, DORA arts. 8–13 and 24–25, ISO 27001:2022 Annex A titles) and fix any mismatch in `CONTROL_CHECKS` and the docs. Record the date in the docs' Sources.
- [ ] **Step 2: Write** the docs and the ADR; run prettier and lint.
- [ ] **Step 3: Canvas:** add a "Control map" row to the Claude Design canvas from the built page (light, dark, 390px, cell detail) for the owner's post-hoc review. No link goes in the repo.
- [ ] **Step 4: Full verification:** lint, typecheck, `npx vitest run`, e2e, actionlint. Expected: all green.
- [ ] **Step 5: Commit** `docs: control map and ADR 0014`.

---

### Task 8: Final review and merge

- [ ] **Step 1:** Fresh reviewer (most capable model) with this plan's Review Focus, the spec and the ledger. One fix pass for Critical/Important findings, each with a failing test first.
- [ ] **Step 2:** Push, open the PR, check the failed checks and code scanning (Advanced Security), merge when green (owner instruction). The v0.16.0 release waits for the owner.
