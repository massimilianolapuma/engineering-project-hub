# Quality dimension (test coverage) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sixth, optional, non-critical health dimension `quality`. It is fed by a `hub-quality-summary` CI artifact (line coverage) and by GitHub Code Quality finding counts. The existing `coverage` dimension is relabelled "Controls coverage".

**Architecture:**

- **Provider:** two new read-only `SourceProvider` calls for the summary artifact and the Code Quality findings and setup. The GitHub and mock providers implement them; the GitHub one unzips the artifact without a new dependency.
- **Collector:** a normaliser turns provider results into per-repository quality states, and a pure evaluator produces `qualityHealth`.
- **Overall status and score:** they learn about "optional dimensions", which count only when measured.
- **Snapshot:** schema 1.3 → 1.4.
- **Astro site:** renders the new section, card and bar.

**Tech Stack:** TypeScript 6, Zod 4, @octokit/rest 22, Node `zlib`, Astro 7, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-21-quality-dimension-test-coverage-design.md` (IT mirror under `docs/it/`). Read it first. This plan does not repeat its rationale.

## Global Constraints

- Read-only, GET only. Never call a write endpoint, never trigger workflows.
- No new runtime dependency. Unzip with `node:zlib` (`inflateRawSync`).
- Strict Zod schemas on every published field.
  - Never publish file paths, finding messages, rule text, raw reports or raw API payloads. Publish only counts, percentages, SHAs, ISO dates and allow-listed `https://github.com/...` links.
  - Text goes through `scrubIdentifier` and links through `sanitizeUrl` (`collector/src/sanitizers/sanitize.ts`).
- Unknown ≠ 0, 403 ≠ no data, ambiguous 404 = unknown. A not-visible component never counts as 0%.
- Defaults are copied verbatim from the spec:
  - `quality.greenThresholdPercent: 80`
  - `quality.amberThresholdPercent: 60`
  - `quality.missingReportIsAmber: true`
  - `freshness.qualityReportStaleDays: 14`
  - `overall.optionalDimensions: [quality]`
  - `score.weights.quality: 10`
- The artifact name is exactly `hub-quality-summary`, the file is exactly `quality-summary.json`, and the zip cap is 64 KB (65 536 bytes).
- Snapshot `SNAPSHOT_SCHEMA_VERSION = '1.4'`, and `SUPPORTED_SNAPSHOT_SCHEMA_VERSIONS = ['1.4']` only.
- Every UI string is EN + IT. Key parity is tested by `tests/unit/i18n.test.ts`.
- Every new doc has both an EN and an IT version.
- Commits use Conventional Commits; author `massilp <3519719+massilp@users.noreply.github.com>`; branch `feat/quality-dimension`.
- Never use or kill port 4321. For e2e, run `sed s/4321/4377/g playwright.config.ts > playwright.tmp.config.ts` and use that config.

## Review Focus

1. **Newer artifact on a non-default branch.** The collector must still pick the newest artifact whose run `head_branch` is the default branch. Pinned in Task 1.
2. **Monorepo repository shared by the coordinator and several components.** Lines are counted once. Every component row shows the same report with `sharedRepository: true`. Pinned in Task 2.
3. **`lines.valid: 0`.** The component is not applicable; the report must never produce 0% or a division by zero. Pinned in Task 2.
4. **403 on the artifacts list** (token without Actions: read). The state is `not-authorised` with reason `quality-report-not-authorised`, never `missing`. Pinned in Task 1 and Task 2.
5. **A summary that fails validation.** Each of these makes the report `invalid`, adds an `invalid-data` collection error, and leaks nothing:
   - `repository` differs from the repo being read (case-insensitive compare);
   - extra keys;
   - zip larger than 64 KB or missing the file;
   - a secret-looking `tool` value (scrubbed or rejected).

   Pinned in Task 1 and Task 3.

---

### Task 1: Summary contract, zip reader, provider calls

**Files:**

- Modify: `shared/model/contracts.ts` (add the summary contract)
- Create: `collector/src/util/zip.ts`
- Modify: `collector/src/providers/types.ts` (DTOs and three `SourceProvider` methods)
- Modify: `collector/src/providers/github/github-provider.ts`
- Modify: `collector/src/providers/mock/mock-provider.ts` (fixture keys and methods)
- Test: `tests/unit/zip.test.ts` (new), `tests/unit/github-provider.test.ts`, `tests/unit/normalizers.test.ts` (contract parse)

**Interfaces:**

- Produces, in `shared/model/contracts.ts`:
  - `QualitySummarySchema`: strict, with fields
    `schemaVersion: z.literal('1.0')`, `repository`, `ref`, `commitSha` (40 hex), `generatedAt` (ISO), `tool` (≤ 40 chars), `format: z.enum(['cobertura','lcov','opencover','jacoco','other'])`, `lines: { covered: int ≥ 0, valid: int ≥ 0 }` with the refine `covered ≤ valid`.
  - `type QualitySummary`.
- Produces, in `collector/src/util/zip.ts`:
  - `readZipEntry(zip: Uint8Array, name: string, maxBytes: number): string`.
  - It throws `ZipError` (exported class) when: the archive is corrupt, the entry is absent, the uncompressed size is over `maxBytes`, or the method is not 0 (stored) or 8 (deflate).
  - It reads the End Of Central Directory record and then the central directory, matches the entry name exactly (so `../x` never matches), and inflates with `inflateRawSync`.
- Produces, in `types.ts`:
  ```ts
  export interface QualitySummaryArtifactDTO {
    /** null when the newest default-branch artifact has expired and no live one exists. */
    summaryText: string | null;
    createdAt: string | null;
    runUrl: string | null;
  }
  export interface CodeQualityFindingDTO { category: string; severity: string }
  export interface CodeQualitySetupDTO { state: string }
  // SourceProvider gains:
  getQualitySummary(repo: string, branch: string): Promise<ProviderResult<QualitySummaryArtifactDTO>>;
  listCodeQualityFindings(repo: string): Promise<ProviderResult<CodeQualityFindingDTO[]>>;
  getCodeQualitySetup(repo: string): Promise<ProviderResult<CodeQualitySetupDTO>>;
  ```
- `getQualitySummary` return rules:
  - no artifact for that branch → `fail({classification:'not-found', httpStatus:404})`;
  - artifact larger than 65 536 bytes, or a `ZipError` → `fail({classification:'invalid-data'})`.
- Mock fixture keys (on `RepoFixture`):
  - `qualitySummary?: { summary: unknown; createdAt: string; expired?: boolean; runId: number } | ErrorFixture`. The mock serialises `summary` with `JSON.stringify` (relative `@now` tokens are resolved first).
  - `codeQualityFindings?: CodeQualityFindingDTO[] | ErrorFixture`.
  - `codeQualitySetup?: CodeQualitySetupDTO | ErrorFixture`.

- [ ] **Step 1: Write failing tests**
  - `zip.test.ts`. Build fixtures in-test with `deflateRawSync` plus hand-written local and central headers (a test helper `makeZip(entries)` in `tests/helpers/factories.ts`). Tests:
    - `reads a deflated entry`
    - `reads a stored entry`
    - `throws when entry absent`
    - `throws when uncompressed size > maxBytes`
    - `does not match "../quality-summary.json"`
    - `throws on truncated archive`
  - `github-provider.test.ts`, mocking Octokit as the existing tests do:
    - `getQualitySummary picks newest artifact whose workflow_run.head_branch is the default branch` (input: a newer artifact on `feature/x` plus an older one on `main`; expect the `main` one's text);
    - `getQualitySummary returns summaryText null when only expired artifacts exist on the branch`;
    - `getQualitySummary classifies 403 as not-authorised`;
    - `getQualitySummary rejects size_in_bytes > 65536 as invalid-data without downloading`;
    - `listCodeQualityFindings sends X-GitHub-Api-Version 2026-03-10 and maps rule.category / rule.severity only` (assert the DTO has exactly those two keys).
  - `normalizers.test.ts`:
    - `QualitySummarySchema rejects extra keys`
    - `rejects covered > valid`
    - `rejects non-hex commitSha`

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run tests/unit/zip.test.ts tests/unit/github-provider.test.ts tests/unit/normalizers.test.ts`.
  Expected: FAIL (missing modules and methods).

- [ ] **Step 3: Implement**
  - Contract and `readZipEntry` as above.
  - GitHub provider:
    - `rest.actions.listArtifactsForRepo({ owner, repo, name: 'hub-quality-summary', per_page: 30 })`, then filter on `workflow_run.head_branch === branch` and sort by `created_at` descending.
    - Download with `rest.actions.downloadArtifact({ ..., archive_format: 'zip' })`, convert to `Uint8Array`, then `readZipEntry(buf, 'quality-summary.json', 65536)`.
    - `runUrl`: `https://github.com/{owner}/{repo}/actions/runs/{workflow_run.id}`.
    - Code Quality calls go through `this.client.request('GET /repos/{owner}/{repo}/code-quality/findings', { state: 'open', per_page: 100, headers: { 'X-GitHub-Api-Version': '2026-03-10' } })` with the existing pagination helper, and `GET …/code-quality/setup`.
    - Errors go through the existing `classifyGitHubError`.
  - Mock provider: missing keys → not-found, which is the existing `pick` default.

- [ ] **Step 4: Run the tests again**

  Same command. Expected: PASS. Also run `npm run typecheck`: PASS.

- [ ] **Step 5: Commit**
      `git commit -m "feat(collector): read hub-quality-summary artifacts and Code Quality findings"`

---

### Task 2: Quality model, policies, catalog and evaluator

**Files:**

- Modify: `shared/model/enums.ts`
  - Add the reason codes (spec §5.4, ten codes).
  - Add `'codeQuality'` to `CapabilitySchema`.
  - Leave `DimensionSchema` alone until Task 3.
- Modify: `shared/model/snapshot.ts`
  - Add `QualityHealthSchema` and `type QualityHealth`.
  - Add `'quality-summary'` and `'code-quality'` to `CollectionErrorSchema.source`.
- Modify: `shared/model/policies.ts`
  - Add the `quality` block and `freshness.qualityReportStaleDays`.
- Modify: `shared/model/catalog.ts`
  - Add an optional `testCoverage: z.enum(['required','not-applicable'])` on `ComponentConfigSchema` and `CoordinatorConfigSchema`.
- Create: `collector/src/normalizers/quality.ts`
- Create: `collector/src/evaluators/quality.ts`
- Modify: `config/policies.yaml` (the new block, with comments), then run `npm run schema:generate`
- Test: `tests/unit/quality.test.ts` (new), `tests/unit/config.test.ts`

**Interfaces:**

- Consumes: Task 1 DTOs and `QualitySummarySchema`.
- Produces, in `collector/src/normalizers/quality.ts`:
  ```ts
  export type RepoQualityState =
    'readable' | 'stale' | 'missing' | 'expired' | 'invalid' | 'not-authorised' | 'unknown';
  export interface RepoQuality {
    repository: string;
    state: RepoQualityState;
    linesCovered: number | null;
    linesValid: number | null;
    commitSha: string | null;
    generatedAt: string | null;
    tool: string | null;
    runUrl: string | null;
  }
  export function normaliseQualitySummary(
    repository: string,
    result: ProviderResult<QualitySummaryArtifactDTO>,
    policies: Policies,
    now: Date,
  ): { quality: RepoQuality; error: CollectionError | null };
  export function isCoverageApplicable(
    type: ComponentType | 'coordinator',
    override?: 'required' | 'not-applicable',
  ): boolean;
  ```
  - **State mapping:**
    - not-found → `missing`
    - `summaryText === null` → `expired`
    - not-authorised → `not-authorised`
    - invalid-data, a JSON or schema failure, or a repository mismatch → `invalid`, plus an `invalid-data` error with source `quality-summary`
    - other errors → `unknown`
    - `generatedAt` older than `qualityReportStaleDays` → `stale`
  - `tool` goes through `scrubIdentifier`.
  - **Applicability:** true for `service`, `webapp`, `worker`, `library`, `coordinator`; false for `deployment`, `infrastructure`, `other`. An override always wins.
- Produces, in `snapshot.ts`, `QualityHealthSchema = HealthResultSchema.extend({...}).strict()` with:
  - aggregates: `percentage: number 0–100 nullable` (1 decimal), `linesCovered`, `linesValid`, `measured`, `applicable`, `notVisible`, `stale` (ints), `collectedAt`;
  - `perComponent: { componentId, state: RepoQualityState | 'not-applicable', sharedRepository: boolean, percentage|null, linesCovered|null, linesValid|null, commitSha|null, generatedAt|null, tool|null, runUrl|null }[]`;
  - `findings: { state: 'available'|'not-configured'|'not-authorised'|'unknown', reliability: nullableCount, maintainability: nullableCount, bySeverity: { error, warning, note, none: nullableCount } }`.
- Produces, in `collector/src/evaluators/quality.ts`:

  ```ts
  export interface QualityInput {
    components: { componentId: string; repository: string; applicable: boolean }[]; // coordinator first
    repos: Map<string, RepoQuality>; // key = repository.toLowerCase()
    findings: Map<string, ProviderResult<CodeQualityFindingDTO[]>>;
    setup: Map<string, ProviderResult<CodeQualitySetupDTO>>;
    collectedAt: string;
  }
  export function evaluateQuality(input: QualityInput, policies: Policies): QualityHealth;
  ```
  - **Algorithm** (spec §5.4):
    - A component whose repo `linesValid === 0` counts as not applicable.
    - Aggregate Σ over **unique repositories** with state `readable` or `stale`.
    - Status:
      - no applicable component → grey with `quality-not-applicable`;
      - all applicable not visible → grey;
      - otherwise use the thresholds, then the at-most-amber cap for any stale report or (when `missingReportIsAmber`) any not-visible component. The cap never upgrades red.
    - Reasons: one per code, `params.components` = comma-joined component ids.
    - Status reason levels: red for below-red, amber for below-threshold, stale and not-visible codes; `info` for the rest.

- [ ] **Step 1: Write failing tests** (`tests/unit/quality.test.ts`, numbers from the spec mock)
  - `beta-like project: coordinator 456/1200 + api 5998/8400 + web missing + helm not applicable → percentage 67.2, status amber, reasons include quality-below-threshold and quality-report-missing(components "web")`
  - `alpha-like project: 14400/17000 → 84.7, green, quality-all-above-threshold`
  - `monorepo: coordinator, web, api, worker on one repo 2900/5000 → percentage 58, linesValid 5000 (not 20000), every perComponent.sharedRepository true`
  - `stale 58% stays red and adds quality-report-stale` (generatedAt now-20d)
  - `stale 85% is capped at amber`
  - `lines.valid 0 → component not-applicable, percentage null, no NaN`
  - `all applicable not visible → grey`
  - `not-authorised → quality-report-not-authorised, never quality-report-missing`
  - `missingReportIsAmber false → missing does not cap, reason level info`
  - `findings: 403 → state not-authorised, counts null; setup state "not-configured" → findings.state not-configured`
  - `normaliseQualitySummary: repository mismatch → invalid + invalid-data error`
  - `normaliseQualitySummary: tool "ghp_exampleSecretValue" is scrubbed` (use `tests/helpers/canaries.ts`)
  - `isCoverageApplicable('deployment') false, ('worker') true, override wins`
  - `config.test.ts`: `policies default quality thresholds 80/60, stale 14 days`; `catalog accepts testCoverage on coordinator and component, rejects other values`

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run tests/unit/quality.test.ts tests/unit/config.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the schemas, the normaliser and the evaluator per the Interfaces above. Then run `npm run schema:generate`.

- [ ] **Step 4: Run the tests and checks**

  Same command, then `npm run typecheck && npm run validate:config`. Expected: PASS.

- [ ] **Step 5: Commit**
      `git commit -m "feat(model): quality health evaluator and policies"`

---

### Task 3: Wire `quality` into collection, overall status, score and snapshot 1.4

**Files:**

- Modify: `shared/model/enums.ts`
  - `DimensionSchema` adds `'quality'`.
  - `SNAPSHOT_SCHEMA_VERSION = '1.4'`, `SUPPORTED_… = ['1.4']`, with a history comment `1.4: quality dimension`.
- Modify: `shared/model/policies.ts`
  - `overall.optionalDimensions` defaults to `['quality']`.
  - A refine rejects any dimension listed as both required and optional.
  - `score.weights.quality` defaults to `10`.
- Modify: `shared/model/snapshot.ts`
  - `ProjectSnapshot.qualityHealth: QualityHealthSchema`.
  - `ProjectSummary.quality: { status, percentage|null, measured, applicable }`.
  - `dataFreshness.staleSources[].source` adds `'quality-report'`.
- Modify: `collector/src/collectors/collect.ts`
  - `RepoData` gains `qualitySummary`, `codeQualityFindings`, `codeQualitySetup`.
  - They are fetched in `collectRepository` with `branch`, and `skipped(repo)` is used when the repo fails.
- Modify: `collector/src/build-snapshot.ts` (build the `QualityInput` from `uniqueRepos`, call the evaluator, wire overall, score, freshness and summary).
- Modify: `collector/src/evaluators/health.ts` (`evaluateOverall`) and `collector/src/evaluators/score.ts` (optional dimensions).
- Modify: `collector/src/run.ts` (the `codeQuality` capability aggregates from the findings results).
- Modify: `config/policies.yaml` (commented `optionalDimensions`, `weights.quality`).
- Modify: `config/projects/*.yaml` only if an override is needed. The demo needs none: Beta helm is a `deployment`.
- Modify: `fixtures/github/*.json`. Add `qualitySummary` and `codeQualityFindings` with **these exact values**:

  | Repository                | Summary                              | Findings                          |
  | ------------------------- | ------------------------------------ | --------------------------------- |
  | project-alpha-coordinator | 2100/2500                            | 0 reliability / 0 maintainability |
  | project-alpha-backend     | 6800/8000                            | 0 / 2                             |
  | project-alpha-frontend    | 3780/4500                            | 0 / 1                             |
  | project-alpha-worker      | 1720/2000                            | 0 / 0                             |
  | project-beta-coordinator  | 456/1200                             | 0 / 2                             |
  | project-beta-api          | 5998/8400                            | 1 / 6                             |
  | project-beta-web          | none                                 | 0 / 1                             |
  | platform-mono             | 2900/5000, `generatedAt: "@now-20d"` |                                   |
  - All other summaries use `generatedAt: "@now-2d"`.
  - `tool`: `coverlet` (.NET-like), `vitest` (web, frontend), `pytest-cov` (worker).
  - Gamma is untouched: its repos are already unavailable.
  - Every finding fixture has a matching `codeQualitySetup: {state: "configured"}`.

- Then run `npm run fixtures:update` (golden snapshots) and `npm run validate:snapshots`.
- Test: `tests/unit/score.test.ts`, `tests/unit/evaluators.test.ts`, `tests/integration/collector.test.ts` (`schemaVersion` "1.4" at lines ~332-340), `tests/integration/site.test.ts` (~806-812, version literal only).

**Interfaces:**

- Consumes: `evaluateQuality`, `normaliseQualitySummary`, `isCoverageApplicable` (Task 2).
- Produces:
  - `evaluateOverall(dimensions: Record<Dimension, HealthStatus>, policies)`: grey optional dimensions add no reason and are excluded from the all-green check; measured optional dimensions behave like non-critical required ones.
  - `evaluateScore`: the required set is `requiredDimensions ∪ (optionalDimensions that are not grey)`.

- [ ] **Step 1: Write failing tests**
  - `score.test.ts`:
    - `grey optional quality does not change value, measured or required` (same input as an existing 5-dimension case, plus grey quality → identical score);
    - `measured quality counts with weight 10`;
    - `red quality makes overall at most amber` (`evaluators.test.ts`).
  - `config.test.ts`: `quality in both requiredDimensions and optionalDimensions is rejected`.
  - `collector.test.ts`, on the mock run:
    - `beta qualityHealth.percentage 67.2 status amber`;
    - `alpha 84.7 green`;
    - `platform 58 red with quality-report-stale and staleSources contains quality-report`;
    - `gamma quality grey and overall/score unchanged vs a run without quality`;
    - `summary.quality matches snapshot`;
    - `canary in a fixture summary tool never reaches output` (extend the existing canary-provider test).

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run tests/unit/score.test.ts tests/unit/evaluators.test.ts tests/integration/collector.test.ts`.
  Expected: FAIL.

- [ ] **Step 3: Implement** the wiring. Regenerate the schemas, the fixtures and the golden snapshots.

- [ ] **Step 4: Run the full check**

  Run: `npm run lint && npm run typecheck && npm test && npm run validate:snapshots`. Expected: all PASS.

- [ ] **Step 5: Commit**
      `git commit -m "feat(collector): quality dimension in snapshots (schema 1.4)"`

---

### Task 4: Site: Quality card, section, sixth bar, relabel

**Files:**

- Modify: `src/i18n/en.ts`, `src/i18n/it.ts`. EN / IT values:

  | Key                            | EN                  | IT                    |
  | ------------------------------ | ------------------- | --------------------- |
  | `dimensions.coverage`          | `Controls coverage` | `Copertura controlli` |
  | `dimensions.quality`           | `Quality`           | `Qualità`             |
  | `dimensionBars.short.coverage` | `Ctrl`              | `Ctrl`                |
  | `dimensionBars.short.quality`  | `Qual`              | `Qual`                |
  - A `reasons.*` string for each of the ten new codes.
  - A `project.quality.*` block for the card line, section title, tiles, table headers, states, shared-report note and legend:
    - EN copy: "Tests: {pct}% of lines · threshold {threshold}%", "Code quality", "Not visible", "Does not mean 0%.", "Shared repository report".
    - IT copy as in the canvas "Proposta A".
  - `howToRead` entries for Quality.
  - Remove any other "Security coverage" / "Copertura sicurezza" wording; `coverageCol` becomes "Controls" / "Controlli".

- Modify: `src/pages/[...lang]/index.astro:33-43` (`DIMS` and `healthOf` add `quality`; `statusOf` reads `p.quality.status`).
- Modify: `src/pages/[...lang]/projects/[id].astro`:
  - `dims` list (:57): add `{ dim: 'quality', anchor: 'quality', health: s.qualityHealth }`;
  - a new `<section id="quality">` after the coverage details. Mirror the canvas board `QualityA.dc.html`: three tiles, the per-component table, the legend.
- Create: `src/components/CoverageMeter.astro`.
  - Props: `{ percentage: number | null; status: HealthStatus | 'grey'; threshold: number }`.
  - A 180×8 track, a fill, and a threshold tick. `aria-hidden`: the number is always rendered next to it by the caller.
  - Unknown renders a dashed track.
- Modify: `src/pages/[...lang]/how-to-read.astro:29`, `src/pages/[...lang]/data-quality.astro` (list missing / expired / invalid / not-authorised reports from `qualityHealth.perComponent`), `src/lib/policies.ts` (defaults for the new blocks).
- Test: `tests/integration/site.test.ts`, `tests/e2e/smoke.spec.ts`, `tests/unit/i18n.test.ts` (parity is automatic).

- [ ] **Step 1: Write failing tests**
  - `site.test.ts`:
    - `project-beta page has #quality with "67.2%" or "67%" and the text "Does not mean 0%."`;
    - `label "Controls coverage" present and "Security coverage" absent on EN pages; "Copertura controlli" on IT`;
    - `portfolio row has six dimension bars`;
    - `data-quality lists project-beta web as missing report`;
    - `percentages render with the number next to every meter` (no `.meter` without a sibling number).
  - `smoke.spec.ts`: `project page: Quality card links to #quality` (desktop and Pixel 7).

- [ ] **Step 2: Run them and see them fail**

  Run: `npm run ci:build && npx vitest run tests/integration/site.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the pages, the component and the strings, following the Warm Graphite tokens (`DESIGN.md`).

- [ ] **Step 4: Run the full check**

  Run: `npm run lint && npm run typecheck && npm test && npm run ci:build && npx playwright test -c playwright.tmp.config.ts`. Expected: all PASS. Delete `playwright.tmp.config.ts` afterwards.

- [ ] **Step 5: Commit**
      `git commit -m "feat(ui): quality dimension card, section and portfolio bar"`

---

### Task 5: Docs, ADR, changelog, design upkeep

**Files:**

- Modify (EN, and the IT mirror under `docs/it/`):
  - `docs/configuration.md`: the `quality` policies, `optionalDimensions`, `weights.quality`, catalog `testCoverage`, the summary contract, and its JSON Schema `config/schema/quality-summary.schema.json` (generate it with `scripts/generate-json-schema.ts`).
  - `docs/security.md`: new sources and the permissions Actions: read and Code Quality read. Record the exact fine-grained / App permission name **as verified in Task 1**, or "not documented" plus the observed behaviour. List what is never published.
  - `docs/architecture.md`: data flow and trust boundary rows. Fix the stale "currently `1.0`" at :145 to `1.4`.
  - `docs/operations.md`: a minimal CI step that writes `quality-summary.json` from a Cobertura file and uploads `hub-quality-summary` (retention 30 days, default branch only).
  - `README.md` / `README.it.md`: the dimensions list. "SonarQube provider" stays in the roadmap.
  - `PRODUCT.md`, `DESIGN.md`: six bars, the meter pattern.
- Create: `docs/architecture/adr/0005-test-coverage-from-ci-summary-artifact.md`, plus its IT copy.
  - Check the next free ADR number with `ls docs/architecture/adr`.
  - Title from spec §5.9.
- Modify: `CHANGELOG.md`, `## [Unreleased]` section: Added (quality dimension, summary contract, Code Quality counts), Changed (snapshot 1.4, "Controls coverage" label).
- Design upkeep, outside the repo:
  - Update the Claude Design canvas board `QualityA.dc.html` and the Warm Graphite DS README so they match the build (meter, sixth bar, labels).
  - Re-read the artifact files first; they change remotely.
  - Never put artifact links in the repo.

- [ ] **Step 1: Write and update the docs.**

- [ ] **Step 2: Check them**

  Run: `npx prettier --check . && npm run validate:config && npm test`. Expected: PASS. EN/IT files link to each other.

- [ ] **Step 3: Commit**
      `git commit -m "docs: quality dimension, summary contract and ADR"`

- [ ] **Step 4: Push and open the PR**

  Push the branch and open a PR with `GH_TOKEN=$(gh auth token --user massilp) gh pr create`. Title: `feat: quality dimension with test coverage from CI (schema 1.4)`. The owner merges.
