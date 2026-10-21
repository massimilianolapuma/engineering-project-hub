# Repository controls (v0.8.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add read-only repository controls to the collector, the snapshot and the site:

- six named checks per repository (actions pinned to a SHA, reusable workflows current, branch protected, pull request required, force push blocked, status checks required);
- an OpenSSF Scorecard summary;
- discovery hints from custom properties and topics.

The checks feed Governance through policies that default to `info`.

**Architecture:**

- **Provider:** new read-only `SourceProvider` calls:
  - branch rules;
  - workflow directory and file at a ref;
  - Scorecard analysis;
  - custom property values;
  - optional classic protection.

  `getBranchHead` also maps `protected`.

- **Normaliser:** a pure normaliser parses `uses:` references.
- **Evaluator:** a pure evaluator produces per-repository checks and Governance reasons.
- **Collector:** `collect.ts` gathers the raw data. Reusable-workflow targets are resolved with memoised release and tag calls.
- **Discovery:** it gains hints and a `grouped` proposal kind.
- **Snapshot:** schema 1.4 → 1.5.
- **Site:** a "Repository controls" section on the project page.

**Tech Stack:** TypeScript 6, Zod 4, @octokit/rest 22, `yaml` 2.9, Astro 7, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-21-repository-controls-design.md` (IT mirror under `docs/it/`). Read it first. This plan does not repeat its rationale. Section numbers (§) refer to the spec.

## Before you start: v0.7.0 lands first

This plan executes **after v0.7.0 (history, trends, "What changed", CSV export) is merged into `main`**. Rebase `feat/repo-controls` on `main` first: `git fetch && git rebase origin/main`.

v0.7.0 changes files this plan touches, so line numbers and surrounding code will differ:

- `src/i18n/en.ts` / `it.ts` (new `changes*`, `trend*`, nav keys);
- `src/layouts/Base.astro` / nav;
- `shared/model/snapshot.ts` (shared primitives may have moved to `shared/model/primitives.ts`, e.g. `isoDate`, `nullableCount`, `httpsUrl`);
- `collector/src/run.ts` / `writers/write-snapshots.ts` (history and changes writing);
- `scripts/update-golden-snapshots.ts` (history fixture);
- the golden files.

**Adapt to what is there.** Keep the interfaces below. Import primitives from wherever they live. Never revert v0.7.0 code. If v0.7.0 is **not** merged, skip Task 7 and note it in the PR body.

## Global Constraints

- Read-only, GET only. Never call a write endpoint. The classic protection call (`GET …/branches/{branch}/protection`) is made **only** when `policies.repositoryControls.readClassicProtection === true`.
- No new runtime dependency. Parse YAML with the existing `yaml` package (`parse(text, { maxAliasCount: 100, uniqueKeys: false, logLevel: 'error' })`).
- Workflow text, step names, `run:`, `with:`, `env:` and expressions are **never** stored in a DTO that leaves `collector/src/normalizers/workflow-refs.ts`, and never published.
  - Published action data is limited to:
    - `target` rebuilt from validated parts (`owner/repo[/path]`, or `owner/repo/.github/workflows/file.yml`, or `docker://image`);
    - `ref` (≤ 100 chars, validated);
    - the workflow file name (`^[A-Za-z0-9._-]+\.ya?ml$`).
  - All of them go through `scrubIdentifier`.
- Custom properties: keep only the three configured keys. Every other property is dropped inside the provider call's consumer (discovery) before anything is stored.
- Unknown ≠ fail ≠ 0. 403 → `not-authorised`. Ambiguous 404 → `unknown`, except that a 404 on `.github/workflows` means "no workflows" (not applicable).
- Defaults, copied verbatim from spec §5.7:
  - every `repositoryControls.checks.<id>: info`
  - `unknownEnforcedCheck: info`
  - `exemptActionOwners: []`
  - `maxWorkflowFiles: 30` (1–100)
  - `readClassicProtection: false`
  - `enabled: true`
- Bounds:
  - workflow file ≤ 262 144 bytes (existing `MAX_FILE_BYTES`);
  - 200 refs per file and 1 000 per repository;
  - 50 distinct referenced repositories per run;
  - 1 page of 100 rules;
  - `unpinnedRefs` ≤ 20 and `reusableWorkflows` ≤ 20 per repository;
  - Scorecard `failingChecks` ≤ 20.
- Snapshot `SNAPSHOT_SCHEMA_VERSION = '1.5'`, `SUPPORTED_SNAPSHOT_SCHEMA_VERSIONS = ['1.5']` only. The policies `schemaVersion` stays `'1.0'`.
- Every UI string is EN + IT (parity: `tests/unit/i18n.test.ts`). Every new or changed doc has an EN and an IT version.
- **Never run `npm run ci:build` or `npm run collect:mock`**: they overwrite `public/data` (the owner's real snapshot, gitignored).
  - Goldens: `npm run fixtures:update`.
  - A manual site build: `SNAPSHOT_DIR=fixtures/snapshots npx astro build --outDir "$(mktemp -d)"`.
- Never use or kill port 4321. For e2e:
  - run `sed 's/4321/4377/g' playwright.config.ts > playwright.tmp.config.ts` and `npx playwright test -c playwright.tmp.config.ts`;
  - delete `playwright.tmp.config.ts` (and `.e2e-dist/`) afterwards and never commit them.
- Containers: podman only (none are needed here).
- Commits: Conventional Commits, author `git -c user.name=massilp -c user.email=3519719+massilp@users.noreply.github.com commit`, branch `feat/repo-controls`. Do not push until Task 8.

## Review Focus

1. **D6, absent rule while `protected: true`.** Absent rule + `protected: true` + classic not read → `unknown`, never `fail` and never `pass`. Pinned in Task 3.
2. **The classic protection call is never made by default.** Assert the Octokit mock is not called when the flag is off. Pinned in Task 2.
3. **Untrusted workflow YAML.**
   - An alias bomb, a 300 KB file, `uses: ${{ … }}`, `uses: ../../x@v1`, `uses: owner/repo@` and a canary in a step name: none may crash the collector, and none may leak.
   - `target` is always rebuilt, never copied.

   Pinned in Task 1.

4. **Governance unchanged by default.** Every golden `governanceHealth.status` and `overall` equals the pre-change golden. Pinned in Task 4.
5. **Monorepo.** `platform-mono` is evaluated once. `componentIds` = `["coordinator","web","api","worker"]`, and the counts are not ×4. Pinned in Task 4.
6. **Discovery leaks.** The unconfigured property `cost-center: CC-1234` never appears in `catalog.json`. Pinned in Task 5.
7. **Workflow text never published.** The fixture markers `marker-step-7f3e` and `marker-run-7f3e` never appear in any output. Pinned in Task 4 and Task 6.

---

### Task 1: Workflow reference parser and reusable-workflow currency (pure)

**Files:**

- Create: `collector/src/normalizers/workflow-refs.ts`
- Test: `tests/unit/workflow-refs.test.ts` (new)

**Interfaces (produces):**

```ts
export type UsesKind = 'local' | 'action' | 'reusable-workflow' | 'docker' | 'invalid';
export interface UsesRef {
  kind: UsesKind;
  /** Rebuilt from validated parts; null for local / invalid. */
  target: string | null;
  owner: string | null;
  repo: string | null;
  ref: string | null;
  pinned: boolean; // false for local / invalid
}
export interface ParsedWorkflow {
  file: string;
  refs: UsesRef[];
  capped: boolean;
  unparsable: boolean;
}
export const MAX_REFS_PER_FILE = 200;
export const MAX_REFS_PER_REPO = 1000;
export function classifyUses(raw: unknown): UsesRef;
export function parseWorkflow(file: string, text: string): ParsedWorkflow;

export type ReusableStatus = 'current' | 'behind' | 'untagged' | 'floating' | 'unknown';
export interface TargetVersions {
  latest: string | null; // tag name of latest release or latest tag, raw
  tags: { name: string; sha: string }[] | null; // null = not read / not visible
  visible: boolean;
}
export function reusableStatus(
  ref: string,
  target: TargetVersions,
): { status: ReusableStatus; latest: string | null };
```

- `classifyUses` follows the spec §5.2 table and regexes exactly.
  - A string containing `${{`, whitespace, `..`, or without `@` (when not `./` or `docker://`) → `invalid`.
  - Pinned = `/^[0-9a-f]{40}$/.test(ref)`. Docker is pinned iff `@sha256:[0-9a-f]{64}$`.
- `parseWorkflow` walks only `jobs.*.uses` and `jobs.*.steps[*].uses`. Non-object `jobs` → no refs. A YAML parse error → `unparsable: true`, `refs: []`. More than 200 refs → keep 200, `capped: true`.
- `reusableStatus` follows spec §5.3. `latest` returned is `normaliseVersion(target.latest)` displayed with the original tag text (return the raw tag name, e.g. `v2.4.0`).

- [ ] **Step 1: Write failing tests** (`tests/unit/workflow-refs.test.ts`)
  - `classifyUses`, one `it` per row:
    - `'./.github/actions/lint'` → `{kind:'local', pinned:false, target:null}`
    - `'actions/checkout@v4'` → `{kind:'action', target:'actions/checkout', ref:'v4', pinned:false}`
    - `'actions/checkout@0123456789abcdef0123456789abcdef01234567'` → pinned `true`
    - `'actions/checkout@0123456789ABCDEF0123456789abcdef01234567'` → pinned `false` (uppercase)
    - `'actions/checkout@0123456'` → pinned `false` (short SHA)
    - `'github/codeql-action/upload-sarif@v3'` → `{kind:'action', target:'github/codeql-action/upload-sarif'}`
    - `'example-shared/ci-templates/.github/workflows/build.yml@v2.1.0'` → `{kind:'reusable-workflow', target:'example-shared/ci-templates/.github/workflows/build.yml', owner:'example-shared', repo:'ci-templates', ref:'v2.1.0', pinned:false}`
    - `'docker://alpine:3.20'` → `{kind:'docker', target:'docker://alpine', pinned:false}`
    - `'docker://alpine@sha256:' + 'a'.repeat(64)` → pinned `true`
    - `'${{ matrix.action }}'`, `'owner/repo@'`, `'../../x@v1'`, `'owner/repo'`, `'owner/repo@v1 ; rm -rf'`, `42`, `null` → `invalid`
    - `'a/b/c/d/e/f/g@v1'` (6 path segments) → `invalid`
  - `parseWorkflow`:
    - `'reads job-level and step-level uses only'`: YAML with `jobs.build.uses` (reusable), `jobs.test.steps` = 3 steps (`actions/checkout@<D>`, `run: echo hi`, `./local`), and a top-level `on.workflow_call` block → 3 refs (reusable, action, local) in document order.
    - `'invalid YAML → unparsable'`: `'jobs: [:'` → `{unparsable:true, refs:[]}`.
    - `'alias bomb does not hang'`: a billion-laughs style document with 10 levels × 10 aliases → returns within 1 s with `unparsable: true`.
    - `'caps at 200 refs'`: 250 steps → 200 refs, `capped: true`.
    - `'step name canary never in output'`: a step `name` set to each value of `CANARIES` (`tests/helpers/canaries.ts`); `JSON.stringify(result)` contains none of them.
  - `reusableStatus`, with `tags = [{name:'v2.4.0', sha:A}, {name:'v2.3.0', sha:B}, {name:'v2.1.0', sha:C}]` and `latest:'v2.4.0'`, `visible:true`:
    - `'v2.4.0'` → `current`
    - `'v2.1.0'` → `{status:'behind', latest:'v2.4.0'}`
    - `'v2.5.0-rc.1'` → `current`
    - `'v2'` → `current`
    - `'v1'` → `behind`
    - `A` → `current`
    - `C` → `behind`
    - `'f'.repeat(40)` → `untagged`
    - `'main'` → `floating`
    - `{visible:false}` → `unknown`
    - `{latest:null, tags:[]}` → `unknown`
  - with A = `a1b2c3d4e5f60718293a4b5c6d7e8f9012345678`, B = `b2c3d4e5f60718293a4b5c6d7e8f901234567890`, C = `c3d4e5f60718293a4b5c6d7e8f9012345678901a`, D = `0123456789abcdef0123456789abcdef01234567`.

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run tests/unit/workflow-refs.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement** `workflow-refs.ts` per the Interfaces. No I/O.

- [ ] **Step 4: Run the tests again**

  Same command, then `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

  `git commit -m "feat(collector): parse workflow uses references and reusable workflow currency"`

---

### Task 2: Provider calls (GitHub and mock)

**Files:**

- Modify: `collector/src/providers/types.ts`
- Modify: `collector/src/providers/github/github-provider.ts`
- Modify: `collector/src/providers/mock/mock-provider.ts`
- Test: `tests/unit/github-provider.test.ts`, `tests/unit/mock-provider.test.ts` (create if absent; otherwise add to `tests/unit/normalizers.test.ts`)

**Interfaces (produces), in `types.ts`:**

```ts
export interface CommitRefDTO { sha; htmlUrl; committedAt; /** null when not reported. */ protected?: boolean | null }
export interface BranchRuleDTO { type: string; requiredApprovals: number | null }
export interface ClassicProtectionDTO {
  pullRequestReviews: boolean; requiredApprovals: number | null;
  statusChecks: boolean; forcePushBlocked: boolean; deletionBlocked: boolean;
}
export interface CustomPropertyDTO { name: string; value: string | string[] | null }
// SourceProvider gains:
listDirectory(repo: string, path: string, ref?: string): Promise<ProviderResult<DirectoryEntryDTO[]>>; // ref added
getBranchRules(repo: string, branch: string): Promise<ProviderResult<BranchRuleDTO[]>>;
getClassicBranchProtection(repo: string, branch: string): Promise<ProviderResult<ClassicProtectionDTO | null>>; // 404 → ok(null)
getLatestScorecardAnalysis(repo: string): Promise<ProviderResult<CodeScanningAnalysisDTO | null>>;
getCustomPropertyValues(repo: string): Promise<ProviderResult<CustomPropertyDTO[]>>;
```

- Update the `getFile` doc comment: the allow-list adds `.github/workflows/<name>` (`<name>` matches `^[A-Za-z0-9._-]+\.ya?ml$`).
- Export `export const WORKFLOW_FILE = /^[A-Za-z0-9._-]+\.ya?ml$/` from `types.ts` and use it in both the collector and the provider.

**GitHub provider:**

- `getBranchHead` maps `protected: data.protected ?? null`.
- `listDirectory`: passes `ref` when given.
- `getFile`: when `path` starts with `.github/workflows/`, it throws `InvalidData` unless the remainder matches `WORKFLOW_FILE` (defence in depth).
- `getBranchRules`:
  - `this.client.request('GET /repos/{owner}/{repo}/rules/branches/{branch}', { owner, repo, branch, per_page: 100 })`;
  - map `type` and `parameters?.required_approving_review_count ?? null` (only for `pull_request`, else null);
  - drop everything else.
- `getClassicBranchProtection`:
  - `rest.repos.getBranchProtection` → map `!!required_pull_request_reviews`, `required_pull_request_reviews?.required_approving_review_count ?? null`, `!!required_status_checks`, `allow_force_pushes?.enabled === false`, `allow_deletions?.enabled === false`;
  - 404 → `ok(null)` through `guard(…, () => ok(null))`.
- `getLatestScorecardAnalysis`: `rest.codeScanning.listRecentAnalyses({ owner, repo, tool_name: 'Scorecard', per_page: 1 })`. Empty → `ok(null)`; 404 → `ok(null)`.
- `getCustomPropertyValues`: `this.client.request('GET /repos/{owner}/{repo}/properties/values', …)` → `{ name: property_name, value }`.

**Mock provider (new `RepoFixture` keys):**

- `head.protected?: boolean`
- `branchRules?: BranchRuleDTO[] | ErrorFixture` (absent → `ok([])`)
- `classicProtection?: ClassicProtectionDTO | null | ErrorFixture` (absent → `ok(null)`)
- `scorecardAnalysis?: CodeScanningAnalysisDTO | null | ErrorFixture` (absent → `ok(null)`)
- `customProperties?: CustomPropertyDTO[] | ErrorFixture` (absent → `ok([])`)

`listDirectory` ignores `ref`. Workflow directories and files use the existing `directories['.github/workflows']` and `files['.github/workflows/<f>']`.

- [ ] **Step 1: Write failing tests** (`github-provider.test.ts`, mocking Octokit/fetch as the existing tests do)
  - `getBranchRules requests per_page 100 and maps only type and requiredApprovals`: input rules `[{type:'pull_request', parameters:{required_approving_review_count:2, dismiss_stale_reviews_on_push:true}, ruleset_id:7}, {type:'non_fast_forward'}]` → `[{type:'pull_request', requiredApprovals:2}, {type:'non_fast_forward', requiredApprovals:null}]`. Assert `Object.keys` of each item equals `['type','requiredApprovals']`.
  - `getBranchRules encodes a branch with a slash`: branch `release/1.x` → the request URL ends with `/rules/branches/release%2F1.x`.
  - `getBranchRules 403 → not-authorised; 404 → not-found`.
  - `getBranchHead maps protected true/false and missing → null`.
  - `getClassicBranchProtection 404 → ok(null); maps allow_force_pushes.enabled false → forcePushBlocked true`.
  - `getLatestScorecardAnalysis sends tool_name=Scorecard and per_page=1; [] → ok(null)`.
  - `getCustomPropertyValues maps property_name/value (string, array, null)`.
  - `getFile rejects .github/workflows/../secrets.yml and .github/workflows/a/b.yml without calling the API`: assert fetch was not called and the result is `invalid-data`.
  - `listDirectory forwards ref`.
  - Mock provider: `absent branchRules → ok([]); $error 403 fixture → not-authorised`.

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run tests/unit/github-provider.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the calls above. Errors go through the existing `classifyGitHubError` and `guard`.

- [ ] **Step 4: Run the tests again**

  Same command, then `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

  `git commit -m "feat(collector): read branch rules, workflow files, Scorecard analyses and custom properties"`

---

### Task 3: Model, policies, catalog override and the repository-controls evaluator

**Files:**

- Modify: `shared/model/enums.ts`:
  - `RepositoryCheckIdSchema` (the 6 ids, in spec order), `REPOSITORY_CHECK_IDS`;
  - `RepositoryCheckStateSchema`;
  - `BranchRuleTypeSchema` (the 25 types of spec §5.5);
  - `ScorecardCheckSchema` (the 20 names of §5.6);
  - capability `'repositoryRules'`;
  - reason codes `repository-check-failed`, `repository-check-unknown`, `repository-checks-passed` (in the governance group).
  - Do **not** bump the schema version yet.
- Modify: `shared/model/snapshot.ts`:
  - `RepositoryControlsHealthSchema` and `type RepositoryControlsHealth`, exactly as spec §5.8;
  - `CollectionErrorSchema.source` adds `'workflow-files'`, `'repository-rules'`, `'scorecard-analysis'`.
- Modify: `shared/model/policies.ts`: the `repositoryControls` block (spec §5.7) with `.prefault({})`, `maxWorkflowFiles: z.number().int().min(1).max(100).default(30)`, and `exemptActionOwners` with the owner regex.
- Modify: `shared/model/catalog.ts`: `notApplicableChecks: z.array(RepositoryCheckIdSchema).default([])` on `CoordinatorConfigSchema` and `ComponentConfigSchema`.
- Modify: `config/policies.yaml` (commented block, every check `info`), then run `npm run schema:generate`.
- Create: `collector/src/evaluators/repository-controls.ts`
- Test: `tests/unit/repository-controls.test.ts` (new), `tests/unit/config.test.ts`

**Interfaces (produces), in `repository-controls.ts`:**

```ts
export interface RepoControlsInput {
  repository: string;
  componentIds: string[];
  available: boolean; // repository metadata ok
  archived: boolean;
  notApplicable: RepositoryCheckId[]; // already intersected across targets (monorepo rule)
  workflows:
    | { state: 'none' } // .github/workflows 404
    | { state: 'not-authorised' | 'unknown' }
    | { state: 'read'; files: ParsedWorkflow[]; unreadable: number; capped: boolean };
  reusable: Map<string, TargetVersions>; // key `${owner}/${repo}`.toLowerCase()
  rules: ProviderResult<BranchRuleDTO[]>;
  protected: boolean | null;
  classic: ProviderResult<ClassicProtectionDTO | null> | null; // null = not read
  scorecardAnalysis: ProviderResult<CodeScanningAnalysisDTO | null>;
  scorecardAlerts: { ruleId: string | null }[] | null; // open, tool Scorecard; null = not readable
  publicDetails: boolean; // false → unpinnedRefs withheld
  repositoryUrlFor: (target: string) => string | null; // sanitised https://github.com/owner/repo
}
export function evaluateRepositoryChecks(
  input: RepoControlsInput,
  policies: Policies,
): RepositoryControlsHealth['repositories'][number];
export function evaluateRepositoryControls(
  repos: RepositoryControlsHealth['repositories'],
  policies: Policies,
  collectedAt: string,
): { health: RepositoryControlsHealth; reasons: Reason[] }; // reasons go to Governance
```

- Implement the rules of spec §5.4 literally, including D6. The ratio is `Math.round((passed / (passed + failed)) * 100)` or `null`.
- `reasons`:
  - for each check with `failed > 0` → `reason('repository-check-failed', level, { check, repositories, count })`. The level is the policy level, where `info` stays `info`.
  - for each enforced check with `unknown > 0` → `repository-check-unknown` at `unknownEnforcedCheck`;
  - `repository-checks-passed` (`info`) when `failed === 0 && unknown === 0 && passed > 0`.
- `policies.repositoryControls.enabled === false` → `{ enabled:false, repositories:[], all counts 0, ratio:null }` and no reasons.

- [ ] **Step 1: Write failing tests** (`tests/unit/repository-controls.test.ts`; factory `controlsInput(partial)` in the test file; D, A, B, C as in Task 1)
  - `actions-pinned`:
    - `3 pinned refs → pass`
    - `1 unpinned of 4 → fail even with 1 unreadable file`
    - `0 unpinned + 1 unreadable file → unknown`
    - `0 unpinned + 1 invalid ref → unknown`
    - `workflows none → not-applicable`
    - `only local refs → not-applicable`
    - `not-authorised listing → unknown`
    - `exemptActionOwners ['actions'] makes actions/checkout@v4 count as pinned → pass`
    - `capped → unknown when nothing unpinned`
  - `reusable-workflows-current`:
    - `ref A with tags → pass`
    - `v2.1.0 → fail`
    - `main → unknown`
    - `invisible target → unknown`
    - `no reusable refs → not-applicable`
  - Branch checks:
    - `rules [pull_request(2), required_status_checks, non_fast_forward, deletion], protected true → 4 × pass, requiredApprovals 2, source rulesets`
    - `rules [] + protected true + classic not read → branch-protected pass; the other three unknown (D6); source classic`
    - `rules [pull_request, required_status_checks] + protected true → force-push-blocked unknown`
    - `rules [] + protected false → 4 × fail; source none`
    - `rules 403 + protected false → 4 × unknown; branchRules.state not-authorised`
    - `rules 403 + protected true → branch-protected pass, others unknown`
    - `classic read {pullRequestReviews:true, statusChecks:false, forcePushBlocked:true} + rules [] + protected true → pull-request pass, status-checks fail, force-push pass; classicRead true; source classic`
  - Repository level:
    - `archived → 6 × not-applicable`
    - `unavailable → 6 × unknown`
    - `notApplicable ['status-checks-required'] → that check not-applicable`
  - Withholding:
    - `publicDetails false → unpinnedRefs [] and detailsWithheld true, counts unchanged`
    - `unpinnedRefs capped at 20, truncated = rest`
  - Scorecard:
    - `analysis @2026-01-13 + alerts [TokenPermissionsID, PinnedDependenciesID, FooID] → state available, openAlerts 3, failingChecks ['Token-Permissions','Pinned-Dependencies'], otherFailing 1`
    - `analysis ok(null) → not-used, openAlerts 0 when alerts readable`
    - `alerts null → openAlerts null`
  - `evaluateRepositoryControls`:
    - `defaults (all info): a failing check yields an info reason and governance status is unchanged` (feed the reasons into `evaluateGovernance` with a compliant repo → still `green`);
    - `actions-pinned red + one failing repo → reason level red`;
    - `branch-protected amber + unknownEnforcedCheck amber + one unknown repo → repository-check-unknown amber`;
    - `informative check with unknowns → no repository-check-unknown reason`;
    - `ratio: passed 5 failed 7 → 42; passed 0 failed 0 → null`;
    - `enabled false → empty health, no reasons`.
  - `config.test.ts`:
    - `policies default repositoryControls: all six checks info, maxWorkflowFiles 30, readClassicProtection false`
    - `rejects maxWorkflowFiles 0 and 101`
    - `rejects a check level "grey"`
    - `catalog accepts notApplicableChecks ['branch-protected'] on a component, rejects 'foo'`

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run tests/unit/repository-controls.test.ts tests/unit/config.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the schemas, the policies block and the evaluator. Extend `evaluateGovernance` with an optional 4th parameter `extraReasons: Reason[] = []`, appended **before** `statusFrom`. Run `npm run schema:generate`.

- [ ] **Step 4: Run the tests and checks**

  Same command, then `npm run typecheck && npm run validate:config`. Expected: PASS.

- [ ] **Step 5: Commit**

  `git commit -m "feat(model): repository checks evaluator, policies and catalog override"`

---

### Task 4: Wire collection, Governance, snapshot 1.5 and mock fixtures

**Files:**

- Modify: `shared/model/enums.ts`: `SNAPSHOT_SCHEMA_VERSION = '1.5'`, `SUPPORTED_… = ['1.5']`, comment `// 1.5: repository controls (repositoryControls, summary.repositoryControls, repositoryRules capability), discovery hints.`
- Modify: `shared/model/snapshot.ts`: `ProjectSnapshot.repositoryControls`, `ProjectSummary.repositoryControls: { passed, failed, unknown, notApplicable, ratio }`.
- Modify: `collector/src/collectors/collect.ts`:
  - `RepoData` gains `controls: { workflowDir, workflowFiles: Map<string, ProviderResult<FileDTO>>, rules, classic, scorecardAnalysis } | null` (null when disabled). The `head` result carries `protected`.
  - Fetch only when `policies.repositoryControls.enabled`. `collectRepository` therefore needs `policies` (pass it through `CollectContext` as `ctx.policies`).
  - Directory listing at `branch`. Take files with `type === 'file'` and `WORKFLOW_FILE`, sorted, first `maxWorkflowFiles`. Then `getFile(repo, '.github/workflows/' + name, branch)`.
  - Cache keys: `wfdir:${repo}:${branch}`, `wf:${repo}:${branch}:${name}`, `rules:${repo}:${branch}`, `classic:${repo}:${branch}`, `sca:${repo}`.
  - New `collectReusableTargets(ctx, targets: string[])`:
    - for the first 50 distinct `owner/repo` (sorted), call `getRepository` → `getLatestRelease` (fallback `getLatestTag` on not-found) and `listTags`, all through `call()` (so they are memoised and shared with monitored repositories);
    - returns `Map<string, TargetVersions>`; over the limit → `{visible:false}`.
    - It is called once per run from `run.ts` after all projects are collected, so `RawProjectData` gains nothing. Pass the map into `buildProjectSnapshot`.
- Modify: `collector/src/build-snapshot.ts`:
  - for each unique repository, parse its workflow files (`parseWorkflow`) and build `RepoControlsInput`:
    - `notApplicable` = intersection over every target on the repository;
    - `publicDetails` = the same rule as `isPublicDetail`;
    - `scorecardAlerts` = open code-scanning alerts with `toolName?.toLowerCase() === 'scorecard'`, or `null` when `codeScanning` failed;
  - record errors (`workflow-files` for a non-404 directory or file failure, `repository-rules`, `scorecard-analysis`; never for referenced repositories);
  - call the evaluator and pass its reasons into `evaluateGovernance(…, extraReasons)`;
  - set `repositoryControls`, and the summary in `toProjectSummary`.
- Modify: `collector/src/run.ts`:
  - capability `repositoryRules` from each repository's `controls.rules` (same `usable` / `denied` logic; `not-used` when disabled);
  - `contents` also gets the workflow directory results;
  - `codeScanning` also gets the Scorecard analysis results.
- Modify: `fixtures/github/*.json`, plus create `fixtures/github/example-shared__ci-templates.json`. **Exact values:**

  `example-shared__ci-templates.json`: `repository` (public, default branch `main`, topics `[]`), `latestRelease: {tagName:'v2.4.0', name:'v2.4.0', publishedAt:'@now-10d', prerelease:false, htmlUrl:'https://github.com/example-shared/ci-templates/releases/tag/v2.4.0'}`, `tags: [{name:'v2.4.0',sha:A},{name:'v2.3.0',sha:B},{name:'v2.1.0',sha:C}]`.

  | Repository                | `.github/workflows` dir → files and `uses` (D = pinned SHA)                                                                                                                                                                                         | `head.protected` | `branchRules`                                                               | Scorecard                                                                                                |
  | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
  | project-alpha-coordinator | `rel-release.yml`: job `build.uses: example-shared/ci-templates/.github/workflows/build.yml@A`; job `publish.steps: actions/checkout@D`                                                                                                             | true             | `pull_request(1)`, `required_status_checks`, `non_fast_forward`, `deletion` | —                                                                                                        |
  | project-alpha-backend     | `ci-main.yml`: `actions/checkout@D`, `actions/setup-java@D`, `actions/upload-artifact@D`                                                                                                                                                            | true             | same four                                                                   | `scorecardAnalysis: {createdAt:'@now-3d', toolName:'Scorecard'}`, no Scorecard alert                     |
  | project-alpha-frontend    | `ci-main.yml`: `actions/checkout@D`, `actions/setup-node@D`, `actions/upload-artifact@D`                                                                                                                                                            | true             | same four                                                                   | —                                                                                                        |
  | project-alpha-worker      | `ci-main.yml`: `actions/checkout@D`, `actions/setup-go@D`, `actions/upload-artifact@D`                                                                                                                                                              | true             | same four                                                                   | —                                                                                                        |
  | project-alpha-helm        | directory absent (no `directories['.github/workflows']` key → 404)                                                                                                                                                                                  | true             | same four                                                                   | —                                                                                                        |
  | project-beta-coordinator  | `release.yml`: job `build.uses: example-shared/ci-templates/.github/workflows/build.yml@v2.1.0`; job `tag.steps: actions/checkout@D`                                                                                                                | true             | `[]`                                                                        | —                                                                                                        |
  | project-beta-api          | `ci.yml`: `actions/checkout@v4`, `actions/setup-python@D`, `./.github/actions/lint`, `docker/build-push-action@v6`, `actions/upload-artifact@D`                                                                                                     | true             | `pull_request(1)`, `required_status_checks`                                 | `scorecardAnalysis: {createdAt:'@now-2d', toolName:'Scorecard'}`, plus 2 open code-scanning alerts below |
  | project-beta-web          | `ci.yml`: `actions/checkout@D`, `actions/setup-node@D`                                                                                                                                                                                              | false            | `[]`                                                                        | —                                                                                                        |
  | project-beta-helm         | directory absent                                                                                                                                                                                                                                    | false            | `{"$error":{"classification":"not-authorised","httpStatus":403}}`           | —                                                                                                        |
  | platform-mono             | `ci.yml`: `actions/checkout@D`, `pnpm/action-setup@v4`; `release.yml`: job `release.uses: example-shared/ci-templates/.github/workflows/release.yml@main`; `docs.yml`: job `docs.uses: example-private/templates/.github/workflows/docs.yml@v1.0.0` | true             | same four as Alpha                                                          | —                                                                                                        |
  - Workflow file contents are small valid YAML strings in `files['.github/workflows/<name>']`. The directory entries are `{name, type:'file'}`.
  - Give **one** step in `project-beta-api/ci.yml` the name `Build marker-step-7f3e` and the `run:` value `echo marker-run-7f3e`. Neither marker may reach the output.
  - Do **not** put a value from `tests/helpers/canaries.ts` in a fixture: canaries never go into fixtures that feed the published build. They stay in the unit tests of Task 1.
  - Beta-api Scorecard alerts, appended to `codeScanningAlerts`:
    - `{number: 901, state:'open', ruleId:'TokenPermissionsID', ruleSeverity:'error', securitySeverityLevel:'high', ruleDescription:'Token-Permissions', toolName:'Scorecard', createdAt:'@now-2d', updatedAt:'@now-2d', htmlUrl:'https://github.com/example-org/project-beta-api/security/code-scanning/901', dismissedReason:null}`;
    - the same shape for `902`, `PinnedDependenciesID`, `warning`, `medium`, `Pinned-Dependencies`.
  - `example-private/templates` has **no** fixture (→ not visible → `unknown`). The Gamma fixtures stay untouched (repositories unavailable).

- Then run `npm run fixtures:update` and `npm run validate:snapshots`.
- Test: `tests/integration/collector.test.ts` (schema literal "1.5", new cases), `tests/integration/site.test.ts` (version literal only), `tests/unit/evaluators.test.ts`.

- [ ] **Step 1: Write failing tests** (`collector.test.ts`, on the mock run with the golden clock)
  - `project-alpha repositoryControls: passed 25, failed 0, unknown 0, notApplicable 5, ratio 100`
  - `project-beta: passed 5, failed 7, unknown 8, notApplicable 4, ratio 42`
  - `platform: passed 4, failed 1, unknown 1, notApplicable 0, ratio 80; repositories.length 1; componentIds ['coordinator','web','api','worker']`
  - `project-gamma: passed 0, failed 0, unknown 12, ratio null`
  - Beta per repository (check states in spec order):
    - coordinator `['fail','fail','pass','unknown','unknown','unknown']`
    - api `['fail','not-applicable','pass','pass','unknown','pass']`
    - web `['pass','not-applicable','fail','fail','fail','fail']`
    - helm `['not-applicable','not-applicable','unknown','unknown','unknown','unknown']`
  - `beta-api actions: total 4, pinned 2, unpinned 2, unpinnedRefs targets ['actions/checkout','docker/build-push-action'] refs ['v4','v6']`
  - `beta coordinator reusableWorkflows[0]: target 'example-shared/ci-templates/.github/workflows/build.yml', ref 'v2.1.0', latest 'v2.4.0', status 'behind', url 'https://github.com/example-shared/ci-templates'`
  - `platform reusableWorkflows statuses: release.yml@main floating, docs.yml@v1.0.0 unknown (url null)`
  - `beta-api scorecard: available, openAlerts 2, failingChecks ['Token-Permissions','Pinned-Dependencies']`; `alpha-backend scorecard: available, openAlerts 0`; `beta-web: not-used`
  - `governance and overall status of every project equal the previous golden values` (platform green/amber, alpha green/amber, beta amber/red, gamma grey/grey; read the actual values from the pre-change `fixtures/snapshots/index.json` **before** regenerating, and hard-code them)
  - `index.run.capabilities.repositoryRules === 'partial'` (beta-helm 403)
  - `"marker-step-7f3e", "marker-run-7f3e" and "CC-1234" never appear in any output file`
  - `summary.repositoryControls equals snapshot counts for each project`
  - `no collection error is recorded for example-shared/ci-templates or example-private/templates`
  - `evaluators.test.ts`: `evaluateGovernance with an amber extra reason → amber`

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run tests/integration/collector.test.ts tests/unit/evaluators.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the wiring and the fixtures, then run `npm run schema:generate && npm run fixtures:update`.

- [ ] **Step 4: Run the full check**

  Run: `npm run lint && npm run typecheck && npm test && npm run validate:snapshots`. Expected: all PASS. Inspect `git diff fixtures/snapshots/index.json`: only `schemaVersion`, `repositoryControls`, `repositoryRules` and the two new beta-api high/medium counts may change.

- [ ] **Step 5: Commit**

  `git commit -m "feat(collector): repository controls in snapshots (schema 1.5)"`

---

### Task 5: Discovery hints from custom properties and topics

**Files:**

- Modify: `shared/model/catalog.ts`:
  - `DiscoveryConfigSchema.hints` (spec §5.9) with `.prefault({})`;
  - update the `topics` / `customProperties` doc comments (no longer "Reserved");
  - update the `CatalogSchema` default object with `hints`.
- Modify: `shared/model/snapshot.ts`: `DiscoveryProposalSchema.kind` adds `'grouped'`, plus `hintedProjectId` and `hints` (spec §5.8).
- Modify: `collector/src/discovery/discover.ts`.
- Modify: `config/catalog.yaml`: `topics: true`, `customProperties: true` and the `hints` block with the defaults and comments. Then run `npm run schema:generate`.
- Fixtures:
  - create `fixtures/github/example-org__tools-api.json` and `example-org__tools-cli.json`: public, default branch `main`, `head`, no workflows;
  - modify `example-org__docs-site.json`.
- Test: `tests/unit/discovery.test.ts`, `tests/unit/config.test.ts`

**Interfaces (produces), in `discover.ts`:**

```ts
export interface RepoHints {
  project: string | null;
  component: string | null;
  type: ComponentType | null;
  evidence: string[];
  hints: DiscoveryProposal['hints'];
}
export function readHints(
  repo: RepositoryDTO,
  properties: CustomPropertyDTO[] | null,
  cfg: DiscoveryConfig,
): RepoHints; // pure
```

- Precedence: property > topic. Several `projectTopicPrefix` topics → project `null` with the evidence `ambiguous project topics`.
- Invalid values are dropped with `ignored hint <key>`. Only the configured keys are ever read from `properties`.

**Fixture values:**

| Repository | Topics                                    | Custom properties                                                                     |
| ---------- | ----------------------------------------- | ------------------------------------------------------------------------------------- |
| tools-api  | `["demo","project-tools","type-service"]` | `[{name:"hub-component", value:"api"}]`                                               |
| tools-cli  | `["demo","project-tools"]`                | `[{name:"hub-component-type", value:"other"}, {name:"cost-center", value:"CC-1234"}]` |
| docs-site  | unchanged `["demo","docs"]`               | `[{name:"hub-project", value:"platform"}]`                                            |

- [ ] **Step 1: Write failing tests**
  - `readHints`:
    - `property hub-project=alpha beats topic project-beta → project 'alpha'`
    - `topic type-worker → type worker`
    - `type property 'banana' → type null, evidence contains 'ignored hint hub-component-type'`
    - `two project-* topics → project null, evidence 'ambiguous project topics'`
    - `array value ['a','b'] → ignored`
    - `customProperties false → properties not requested` (spy on the provider)
    - `unconfigured property cost-center never in hints or evidence`
  - Discovery on the mock owner:
    - `tools-api and tools-cli become one grouped proposal: project.id 'tools', coordinator.repository 'example-org/tools-api', components [{id:'tools-cli', type:'other', repository:'example-org/tools-cli', versionSource:'release'}]; no single proposal for either`
    - `docs-site proposal hintedProjectId 'platform' and hints [{source:'property', key:'hub-project', value:'platform'}]`
    - `JSON.stringify(result) does not contain 'CC-1234' nor 'cost-center'`
    - `properties 403 → errors[] has {target:'example-org/tools-cli', classification:'not-authorised'} and topic hints still apply` (override the fixture in-test with a temp fixtures dir)
    - `existing proposals (coordinators, monorepo) keep their kind and order: coordinator, monorepo, grouped, single` (the order map becomes `{coordinator:0, monorepo:1, grouped:2, single:3}`)
  - `config.test.ts`: `discovery hints defaults hub-project / hub-component / hub-component-type / project- / type-`; `rejects projectProperty 'Bad Key'`.

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run tests/unit/discovery.test.ts tests/unit/config.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the hint reading (one `getCustomPropertyValues` per scanned repository inside the existing limiter, only when `customProperties` is true), the grouping after the existing loop, and the type and id overrides. Then run `npm run schema:generate && npm run fixtures:update`.

- [ ] **Step 4: Run the tests and checks**

  Run: `npm run lint && npm run typecheck && npm test && npm run validate:snapshots`. Expected: PASS.

- [ ] **Step 5: Commit**

  `git commit -m "feat(discovery): project, component and type hints from custom properties and topics"`

---

### Task 6: Site: "Repository controls" section, Governance anchor, How to read, Data quality, catalog editor

**Files:**

- Modify: `src/i18n/en.ts`, `src/i18n/it.ts`. Main values:

  | Key                                          | EN                                                                                          | IT                                                                                                     |
  | -------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
  | `project.repoControls.title`                 | `Repository controls`                                                                       | `Controlli repository`                                                                                 |
  | `project.repoControls.summary`               | `{passed} of {applicable} checks pass · {unknown} not visible`                              | `{passed} di {applicable} controlli superati · {unknown} non visibili`                                 |
  | `project.repoControls.informative`           | `Informative`                                                                               | `Informativo`                                                                                          |
  | `project.repoControls.enforced`              | `Counts for Governance`                                                                     | `Conta per Governance`                                                                                 |
  | `project.repoControls.legend`                | `Informative checks never change the Governance status. Not visible does not mean failing.` | `I controlli informativi non cambiano mai lo stato di Governance. Non visibile non significa fallito.` |
  | `project.repoControls.withheld`              | `Details withheld for non-public repositories`                                              | `Dettagli nascosti per i repository non pubblici`                                                      |
  | `project.repoControls.off`                   | `Repository controls are turned off in the policies.`                                       | `I controlli repository sono spenti nelle policy.`                                                     |
  | `project.repoControls.scorecardBelow`        | `Checks below your Scorecard policy minimum`                                                | `Check sotto il minimo della tua policy Scorecard`                                                     |
  | `project.repoControls.standardWorkflowsLink` | `Standard workflows →`                                                                      | `Workflow standard →`                                                                                  |
  | `repoCheck.actions-pinned`                   | `Actions pinned to a commit SHA`                                                            | `Action pinnate a uno SHA di commit`                                                                   |
  | `repoCheck.reusable-workflows-current`       | `Reusable workflows up to date`                                                             | `Workflow riutilizzabili aggiornati`                                                                   |
  | `repoCheck.branch-protected`                 | `Default branch protected`                                                                  | `Branch di default protetto`                                                                           |
  | `repoCheck.pull-request-required`            | `Pull request required`                                                                     | `Pull request obbligatoria`                                                                            |
  | `repoCheck.force-push-blocked`               | `Force push blocked`                                                                        | `Force push bloccato`                                                                                  |
  | `repoCheck.status-checks-required`           | `Status checks required`                                                                    | `Status check obbligatori`                                                                             |
  | `repoCheckState.*`                           | `Pass` / `Fail` / `Not visible` / `Not applicable`                                          | `Superato` / `Fallito` / `Non visibile` / `Non applicabile`                                            |
  | `reusableStatus.*`                           | `Up to date` / `Behind` / `Untagged SHA` / `Floating (branch)` / `Not visible`              | `Aggiornato` / `Indietro` / `SHA senza tag` / `Flottante (branch)` / `Non visibile`                    |
  | `capability.repositoryRules`                 | `Repository rules`                                                                          | `Regole del repository`                                                                                |
  | `catalogEditor.proposalKind.grouped`         | `Grouped by hints`                                                                          | `Raggruppato dai suggerimenti`                                                                         |
  | `catalogEditor.hintedProject`                | `Suggested for project {id}`                                                                | `Suggerito per il progetto {id}`                                                                       |
  - Also: `reasons.repository-check-failed` ("{check} fails in {repositories}" / "{check} fallisce in {repositories}", with `{check}` rendered through `repoCheck.*`), `reasons.repository-check-unknown`, `reasons.repository-checks-passed`, the `errorSource` entries for the three new sources, `howToRead` entries (Governance text plus a new "Repository controls" block), and the rule-source labels (`rulesets` / `classic` / `both` / `none` / `unknown`).
  - Adapt to the v0.7.0 key layout if it differs.

- Create: `src/components/RepositoryControlsSection.astro`. It takes props `{ s: ProjectSnapshot; i18n }` and renders spec §5.11:
  - tiles, matrix and detail folds, and the legend;
  - it uses the existing `StatusIcon` / `ControlSymbol` / `UnknownValue` patterns and the Warm Graphite tokens from `DESIGN.md`;
  - every cell has a visually hidden state label;
  - the matrix is a real `<table>` with `<th scope="col">` and `<th scope="row">`.
- Modify: `src/pages/[...lang]/projects/[id].astro`:
  - insert `<RepositoryControlsSection>` after the `#coverage` fold and before `<QualitySection>`;
  - the `dims` entry for governance becomes `anchor: 'repository-controls'`.
- Modify:
  - `src/pages/[...lang]/how-to-read.astro`;
  - `src/pages/[...lang]/data-quality.astro`: the capability row, plus a list of repositories with `actions.state` in (`not-authorised`, `unknown`) or `branchRules.state !== 'available'`;
  - the catalog editor proposal rendering (`src/pages/[...lang]/catalog.astro` and/or `src/scripts/catalog-editor.ts`): the `grouped` kind and the `hintedProjectId` badge;
  - `src/components/DimensionBars.astro`: the Governance tooltip suffix "· checks {passed}/{applicable}", or its v0.7.0 equivalent.
- Test: `tests/integration/site.test.ts`, `tests/e2e/smoke.spec.ts`, `tests/unit/i18n.test.ts` (automatic parity).

- [ ] **Step 1: Write failing tests**
  - `site.test.ts`, built from `fixtures/snapshots`:
    - `project-beta page has #repository-controls with "5 of 12 checks pass · 8 not visible"`
    - `IT project-beta page has "5 di 12 controlli superati · 8 non visibili"`
    - `beta matrix has 4 rows and 6 column headers, each with "Informative"`
    - `every matrix cell has a visually hidden state label` (no cell whose text content is only a symbol)
    - `beta lists unpinned "actions/checkout" "v4" and reusable "v2.1.0" behind "v2.4.0"`
    - `governance dimension card links to #repository-controls`
    - `marker-step-7f3e, marker-run-7f3e and CC-1234 never appear in dist/`
    - `catalog page shows "Grouped by hints" and "Suggested for project platform"`
    - `data-quality lists project-beta-helm rules not authorised`
    - `how-to-read has a "Repository controls" entry (EN) and "Controlli repository" (IT)`
  - `smoke.spec.ts` (desktop and Pixel 7):
    - `project-beta: Governance card → #repository-controls opens and is visible`
    - `matrix is horizontally reachable without page overflow at 412 px` (no body horizontal scroll)

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run tests/integration/site.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the component, the pages and the strings. Then run the `impeccable` / `web-design-guidelines` review on the new section and fix any material findings.

- [ ] **Step 4: Run the full check**

  ```
  npm run lint && npm run typecheck && npm test
  sed 's/4321/4377/g' playwright.config.ts > playwright.tmp.config.ts
  npx playwright test -c playwright.tmp.config.ts
  rm -rf playwright.tmp.config.ts .e2e-dist
  ```

  Expected: all PASS. **Do not** run `npm run ci:build`.

- [ ] **Step 5: Commit**

  `git commit -m "feat(ui): repository controls section, governance anchor and discovery hints in the catalog editor"`

---

### Task 7: "What changed" and CSV integration (only if v0.7.0 is merged)

Skip this task when `shared/model/history.ts` does not exist on the rebased branch. Record the skip in the PR body.

**Files (names as introduced by v0.7.0; adapt):**

- Modify: `shared/model/history.ts`:
  - `SUPPORTED_HISTORY_SCHEMA_VERSIONS = ['1.0','1.1']`, written version `'1.1'`;
  - `HistoryProjectPointSchema.controls: { passed, failed, unknown }.optional()`;
  - `HistoryBaselineSchema.projects[].checks: z.array(z.string().max(320)).max(600).optional()`;
  - `ChangesFileSchema` project `checkChanges` (max 50, optional) and `totals.checkChanges` (optional; written always by 0.8.0).
- Modify: `collector/src/history/*` (point and baseline builders, the `changes.ts` diff), the "What changed" page, the CSV portfolio writer and the i18n strings ("Repository checks" / "Controlli repository").
- Modify: the history fixture used by `fixtures:update`, so the golden `changes.json` contains exactly one `checkChanges` entry: `project-beta`, `example-org/project-beta-web`, `branch-protected`, `pass → fail`. Set the baseline key `example-org/project-beta-web|branch-protected|pass`.
- Test: the v0.7.0 history and changes unit tests, `collector.test.ts`, `site.test.ts`.

- [ ] **Step 1: Write failing tests**
  - `a 1.0 history file is read (no controls) and checkChanges is [] with no error`
  - `pass→fail and fail→pass are listed; unknown→fail is not`
  - `baseline without checks → not compared`
  - `golden changes.json has totals.checkChanges 1 with the beta-web entry above`
  - `portfolio CSV header ends with controls_passed,controls_failed,controls_unknown and the beta row has 5,7,8`
  - `/changes/ shows "Repository checks" (EN) and "Controlli repository" (IT)`
- [ ] **Step 2:** Run `npx vitest run tests/unit tests/integration`. Expected: FAIL.
- [ ] **Step 3:** Implement, then `npm run fixtures:update`.
- [ ] **Step 4:** Run `npm run lint && npm run typecheck && npm test && npm run validate:snapshots`. Expected: PASS.
- [ ] **Step 5:** `git commit -m "feat(history): repository check changes in What changed and CSV"`

---

### Task 8: Docs, ADR 0007, changelog, design upkeep, PR

**Files (EN, and the IT mirror under `docs/it/`):**

- `docs/configuration.md`: `repositoryControls` policies (every key, defaults, opting in to enforcement), catalog `notApplicableChecks`, discovery `topics` / `customProperties` / `hints`, and a worked example.
- `docs/security.md`:
  - permission rows: rules and properties = **Metadata: read**; workflow files = **Contents: read**; Scorecard analyses = **Code scanning alerts: read**; optional classic protection = **Administration: read** (off by default);
  - the organisation property endpoint is not used (it needs Custom properties: read);
  - sources and the date 2026-10-21 (spec §9);
  - the observed meaning of `protected` from Task 2 (or "not verified against a live repository");
  - what is never published from workflow files and properties.
- `docs/architecture.md`: the data flow, and a trust-boundary row "workflow files are untrusted input (bounded, parsed in memory, never published)". Snapshot version `1.5`.
- `docs/operations.md`: opting in to enforcement step by step, granting Administration: read, and API budget notes.
- `README.md` / `README.it.md`:
  - Governance in the dimensions list mentions repository checks;
  - remove from the roadmap: custom properties and topics, repository scorecards, reusable workflow versions, actions pinned to SHA, branch protection / rulesets.
- `PRODUCT.md`, `DESIGN.md`: the Repository controls section pattern (matrix with symbols and text, the "Informative" tag).
- Create: `docs/architecture/adr/0007-repository-controls-informative-by-default.md` plus its IT copy.
  - Use 0007: 0006 belongs to v0.7.0. If `ls docs/architecture/adr` shows 0007 taken, take the next free number and say so in the PR.
  - Title: "Repository controls from workflow files and the rules API, informative by default".
- `CHANGELOG.md`, `## [Unreleased]`:
  - Added: six repository checks, OpenSSF Scorecard summary, discovery hints, `repositoryRules` capability.
  - Changed: snapshot 1.5 (with the upgrade note: an existing 1.4 `public/data` fails validation until it is re-collected), Governance card anchor.
- Design upkeep, outside the repo:
  - update the Warm Graphite DS README and the Claude Design canvas so they match the build;
  - re-read the remote files first;
  - never put artifact links in the repo.

- [ ] **Step 1: Write and update the docs.**
- [ ] **Step 2: Check them**

  Run: `npx prettier --check . && npm run validate:config && npm test`. Expected: PASS. EN/IT files link to each other.

- [ ] **Step 3: Commit**

  `git commit -m "docs: repository controls, discovery hints and ADR 0007"`

- [ ] **Step 4: Push and open the PR**

  Push the branch and open a PR with `GH_TOKEN=$(gh auth token --user massilp) gh pr create`. Title: `feat: repository controls, scorecard and discovery hints (schema 1.5)`. The body lists the builder's calls (spec §4), whether Task 7 ran, and the observed `protected` semantics. The owner merges.
