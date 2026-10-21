# History and change (trends, "What changed", CSV export) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep a compact, bounded history of every collection between runs, show a score trend and status strip per project and on the portfolio, add a "What changed since last collection" page, and publish three static CSV exports. No snapshot schema change.

**Architecture:**

- **Model:** two new strict, independently versioned files: `history.json` (`kind: hub-history`, `1.0`) and `changes.json` (`kind: hub-changes`, `1.0`). The snapshot stays `1.4`. A new optional `history` policies block.
- **Collector:** a `collector/src/history/` module:
  - loads the previous history (CI restore dir, local output dir, or the mock fixture);
  - appends the current run with retention;
  - computes the diff.

  The writer validates and publishes both files.

- **CI:** a restore script reads the hub's **own** newest `hub-history` artifact with `GITHUB_TOKEN` and `actions: read`; the collect job uploads a new `hub-history` artifact (90 days).
- **Site:** build-time loaders, an SVG sparkline and status strip, a portfolio Trend column, a project Trend block, a `changes/` page, Data quality and How-to-read entries, and static CSV endpoints under `exports/`.

**Tech Stack:** TypeScript 6, Zod 4 (`z.partialRecord`), @octokit/rest 22, Node `fs`/`zlib` (existing `readZipEntry`), Astro 7 static endpoints, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-21-history-trends-design.md` (IT mirror under `docs/it/`). Read it first. This plan does not repeat its rationale. Program constraints: `docs/superpowers/specs/2026-10-21-roadmap-program-design.md` §2.

## Global Constraints

- Read-only towards monitored repositories and sources. The only new API calls are `GET` on the hub's own repository (repo, artifacts list, run, artifact download) with the workflow `GITHUB_TOKEN`. Never write, dismiss or trigger anything.
- **Never run `npm run ci:build`, `npm run collect:mock` or `npm run build`.** They overwrite `public/data` (the owner's real, gitignored snapshot). Never write to `public/data` in a test.
  - Golden files: `npm run fixtures:update` (writes only `fixtures/snapshots`).
  - Site builds: `npx vitest run tests/integration/site.test.ts` (builds from `fixtures/snapshots` into a temp dir).
  - Ad-hoc collector runs: `npx tsx collector/src/index.ts --source mock --out "$(mktemp -d)" --now 2026-01-15T12:00:00Z`.
- **Never use or kill port 4321.** For e2e:
  ```bash
  sed s/4321/4377/g playwright.config.ts > playwright.tmp.config.ts
  npx playwright test -c playwright.tmp.config.ts
  rm playwright.tmp.config.ts
  ```
- Snapshot schema unchanged: `SNAPSHOT_SCHEMA_VERSION = '1.4'`. New constants:
  - `HISTORY_SCHEMA_VERSION = '1.0'` and `SUPPORTED_HISTORY_SCHEMA_VERSIONS = ['1.0']`;
  - `CHANGES_SCHEMA_VERSION = '1.0'`.
- Defaults copied verbatim from the spec:
  - `history.enabled: true`, `history.maxEntries: 120` (int 2–1000), `history.maxAgeDays: 90` (int 1–400);
  - history file read cap 8 388 608 bytes (8 MiB); artifact zip cap 5 242 880 bytes (5 MiB);
  - artifact name exactly `hub-history`, entry exactly `history.json`, retention 90 days;
  - finding lists in `changes.json` capped at 50; baseline lists capped at 500;
  - portfolio sparkline window 30 points; project page up to 120 points.
- Strict Zod schemas (`.strict()`) on every published field. Text through `scrubIdentifier` / `scrubText`, links through `sanitizeUrl` (`collector/src/sanitizers/sanitize.ts`), every serialised file through `assertPublishable`.
- Unknown ≠ 0: a null score is a gap, never 0; a null CSV value is `unknown`; a fresh history is never "no changes".
- CSV: UTF-8 BOM, comma, CRLF, RFC 4180 quoting. A **string** cell starting with `=` `+` `-` `@` TAB or CR gets a leading `'`. Numbers are never prefixed.
- Every UI string EN + IT; key parity is tested by `tests/unit/i18n.test.ts`. Every new doc has an EN and an IT version that link to each other.
- Status never by colour alone (shape or height plus text); WCAG 2.2 AA; Warm Graphite tokens (`DESIGN.md`).
- Commits use Conventional Commits, author `massilp <3519719+massilp@users.noreply.github.com>`, branch `feat/history-trends`. Run `npx prettier --write` on touched files before each commit.

## Review Focus

1. **Fake "resolved" or "new" alerts.** A source that became unreadable must not resolve its alerts, and a source that became readable must not make all its alerts new. This is the (repository, source) pair rule. Pinned in Task 2.
2. **Fresh history shown as "no changes".** Every fresh state (`none`, `restore-failed`, `unreadable`, `incompatible`, `source-changed`) yields `basis.state ≠ compared`, and the page shows the basis message, never "No changes". Pinned in Task 2 and Task 7.
3. **Planted history.** The restore script must reject:
   - artifacts from forks (`head_repository_id ≠ repository_id`);
   - artifacts from non-default branches, from the current run, or oversized;
   - runs whose workflow path or event is not allowed.

   Pinned in Task 4.

4. **Mock/real mixing.** A mock run never restores. A history whose last entry has another `dataSource` starts fresh with `source-changed`. Pinned in Task 2 and Task 3.
5. **Idempotent goldens.** `npm run fixtures:update` run twice gives no diff. It reads `fixtures/history/history.json`, never `fixtures/snapshots/history.json`. Pinned in Task 3.
6. **CSV formula injection.** Pinned in Task 5.

---

### Task 1: History and changes model, history policies

**Files:**

- Create: `shared/model/history.ts`
- Modify: `shared/model/index.ts` (re-export)
- Modify: `shared/model/policies.ts` (the `history` block)
- Modify: `config/policies.yaml` (commented block), then `npm run schema:generate` (regenerates `config/schema/policies.schema.json`)
- Test: `tests/unit/history-model.test.ts` (new), `tests/unit/config.test.ts`

**Interfaces:**

- Produces, in `shared/model/history.ts`, exactly as spec §5.2 and §5.3:
  - constants: `HISTORY_SCHEMA_VERSION`, `SUPPORTED_HISTORY_SCHEMA_VERSIONS`, `CHANGES_SCHEMA_VERSION`;
  - `HistoryRestoreStateSchema` and `ChangesBasisStateSchema`;
  - `HistoryProjectPointSchema`, `HistoryEntrySchema`, `HistoryBaselineSchema`, `HistoryFileSchema`, `ChangesFileSchema`, with inferred types;
  - `HistoryProbeSchema = z.object({ kind: z.string(), schemaVersion: z.string() })` (loose, for the version check before a full parse).
- Reuse the local helpers already in `snapshot.ts` (`isoDate`, `httpsUrl`, `shortText`, `nullableCount`): export them from `snapshot.ts` or move them to a small `shared/model/primitives.ts`. Do not duplicate regexes.
- `HistoryFileSchema` refines:
  - `baseline.collectedAt === entries.at(-1).collectedAt`, message `baseline must describe the latest entry`;
  - entries strictly increasing by `collectedAt`, message `entries must be strictly increasing by collectedAt`.
- Policies:

  ```ts
  history: z.object({
    enabled: z.boolean().default(true),
    maxEntries: z.number().int().min(2).max(1000).default(120),
    maxAgeDays: z.number().int().min(1).max(400).default(90),
  }).strict().prefault({}),
  ```

- [ ] **Step 1: Write failing tests**
  - `history-model.test.ts`. Build a minimal valid file in a `validHistory()` helper inside the test: 1 entry, 1 project, matching baseline.
    - `accepts a minimal valid history file`
    - `rejects an extra key on an entry` (add `raw: {}`)
    - `rejects kind "hub-changes" in HistoryFileSchema`
    - `rejects schemaVersion "1.1"`
    - `rejects a baseline whose collectedAt differs from the last entry`
    - `rejects two entries with the same collectedAt`
    - `accepts a point without the quality dimension` (`dimensions` has 5 keys)
    - `rejects score 101 and score -1; accepts score null`
    - `rejects a project id with uppercase letters` (`Project-Alpha`)
    - `rejects a baseline htmlUrl with http://`
    - `ChangesFileSchema accepts basis.state "restore-failed" with previousCollectedAt null`
    - `ChangesFileSchema rejects 51 newFindings for one project`
  - `config.test.ts`:
    - `history defaults: enabled true, maxEntries 120, maxAgeDays 90`
    - `history.maxEntries 1 is rejected; 1001 is rejected`
    - `history.maxAgeDays 0 is rejected`
    - `config/policies.yaml declares the history block` (parse the file and expect `history.maxEntries === 120`)

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run tests/unit/history-model.test.ts tests/unit/config.test.ts`. Expected: FAIL (module missing, no `history` key).

- [ ] **Step 3: Implement** the schemas and the policies block. Add the commented YAML block from spec §5.5 to `config/policies.yaml` after `quality:`. Run `npm run schema:generate`.

- [ ] **Step 4: Run the tests and checks**

  Run: `npx vitest run tests/unit/history-model.test.ts tests/unit/config.test.ts && npm run typecheck && npm run validate:config`. Expected: PASS.

- [ ] **Step 5: Commit**
      `git commit -m "feat(model): history and changes schemas, history policies"`

---

### Task 2: Collector history engine (load, append, changes)

**Files:**

- Create: `collector/src/history/load.ts`
- Create: `collector/src/history/append.ts`
- Create: `collector/src/history/changes.ts`
- Create: `collector/src/history/baseline.ts` (baseline from snapshots; shared by append and changes)
- Test: `tests/unit/history.test.ts` (new), `tests/helpers/factories.ts` (add `historyEntry()`, `historyFile()`, `projectSummary()` builders)

**Interfaces:**

- `load.ts`:

  ```ts
  /** A parsed, cleaned history; baseline is null when the last entry was dropped by cleaning. */
  export type CleanHistory = Omit<HistoryFile, 'baseline'> & { baseline: HistoryBaseline | null };
  export type PreviousHistory =
    | { state: 'restored' | 'fixture'; file: CleanHistory }
    | {
        state: 'none' | 'restore-failed' | 'unreadable' | 'incompatible' | 'source-changed';
        file: null;
      };
  export const HISTORY_MAX_BYTES = 8_388_608;
  export interface LoadHistoryOptions {
    dataSource: DataSource;
    historyFrom: string; // directory containing history.json
    fixturePath: string; // used only when dataSource === 'mock'
    restoreState?: string; // $HISTORY_RESTORE_STATE: 'restored' | 'none' | 'failed' | undefined
    fresh?: boolean; // --fresh-history
    catalog: Catalog;
    policies: Policies;
    now: Date;
  }
  export async function loadPreviousHistory(o: LoadHistoryOptions): Promise<PreviousHistory>;
  ```

  - Order of the checks:
    1. `mock`: read the fixture, replace every `@now…` token with `resolveRelativeTime` (same regex as `mock-provider.ts` `TOKEN_IN_TEXT`), then parse. State `fixture`.
    2. `fresh` → `none`.
    3. `restoreState === 'failed'` → `restore-failed`.
    4. `restoreState === 'none'` → `none`.
    5. No file → `none`.
    6. Larger than `HISTORY_MAX_BYTES`, bad JSON, or `kind !== 'hub-history'` → `unreadable`.
    7. `schemaVersion` not supported → `incompatible`.
    8. Full schema failure → `unreadable`.
    9. Last entry `dataSource` differs → `source-changed`.
    10. Otherwise `restored`.
  - Read with one `open()` handle: `stat` the size, then read from the same handle.
  - The fixture path never applies to `github`. `historyFrom` never applies to `mock`.
  - Cleaning (`cleanHistory(file, catalog, policies, now)`, exported):
    - drop entries with `collectedAt >= now`;
    - sort and de-duplicate by `collectedAt`;
    - remove projects not in `catalog.projects`;
    - drop empty entries;
    - re-sanitise baseline `htmlUrl` with `sanitizeUrl(url, policies.publication.allowedLinkHosts)` (null when rejected), and `version` / finding `id` with `scrubIdentifier`;
    - remove baseline projects not in the catalog.

    If the last entry was dropped, the baseline no longer matches. Keep the entries, but set `baseline` to `null` (`CleanHistory`): changes then compare statuses from the last kept entry and skip findings, versions and errors (lists empty, `findingsPartial: true`).

- `baseline.ts`:
  ```ts
  export function buildBaseline(
    index: PortfolioIndex,
    projects: ProjectSnapshot[],
  ): HistoryBaseline;
  export const pairKey: (repository: string, source: CollectionError['source']) => string; // `${repo}|${source}`
  export const errorKey: (e: CollectionError) => string; // `${repo}|${source}|${classification}`
  ```
  - Finding source → pair source: `github-code-scanning→code-scanning`, `github-dependabot→dependabot`, `github-secret-scanning→secret-scanning`, `security-status-file→security-status-file`.
  - A `repository` collection error marks all four pairs of that repository unreadable.
- `append.ts`:

  ```ts
  export function entryFromRun(index: PortfolioIndex): HistoryEntry;
  export function appendHistory(
    previous: PreviousHistory,
    index: PortfolioIndex,
    projects: ProjectSnapshot[],
    catalog: Catalog,
    policies: Policies,
    now: Date,
  ): HistoryFile;
  ```

  - Retention: keep entries with `collectedAt >= now - maxAgeDays·DAY_MS`, then `slice(-maxEntries)`.
  - `restore.previousEntries` = the number of previous entries kept after retention.
  - `generatedAt = index.generatedAt`.
  - Validate the result with `HistoryFileSchema.parse` (throws `SnapshotValidationError` in the writer).

- `changes.ts`:

  ```ts
  export function computeChanges(
    previous: PreviousHistory,
    index: PortfolioIndex,
    projects: ProjectSnapshot[],
  ): ChangesFile;
  ```

  Rules exactly as spec §5.3.
  - Status order: `overall`, then `DimensionSchema.options`.
  - Findings sorted critical first, then by id; truncation at 50 per list.
  - `basis.synthetic = previous.state === 'fixture'`.
  - The project order in `projects[]` follows `index.projects`. The page decides its own display order.

- [ ] **Step 1: Write failing tests** (`tests/unit/history.test.ts`; `NOW = 2026-01-15T12:00:00.000Z` from factories; a temp dir per test with `mkdtemp`)
  - **load:**
    - `mock source reads the fixture and resolves @now-12d to 2026-01-03T12:00:00.000Z` (use `fixtures/history/history.json` once Task 3 adds it; until then a temp fixture with one `@now-1d` entry → `2026-01-14T12:00:00.000Z`)
    - `mock source ignores historyFrom even when it holds a valid github history`
    - `github: restoreState "failed" → restore-failed, even when a valid file exists`
    - `github: restoreState "none" → none`
    - `github: no file → none`
    - `github: file of 8_388_609 bytes → unreadable`
    - `github: "not json" → unreadable`
    - `github: kind hub-changes → unreadable`
    - `github: schemaVersion "9.9" → incompatible`
    - `github: last entry dataSource mock → source-changed`
    - `github: valid file → restored with its entries`
    - `fresh true → none`
  - **clean:**
    - `drops an entry dated at or after now`
    - `de-duplicates two entries with the same collectedAt`
    - `removes project "retired" not in the catalog and drops an entry left empty`
    - `baseline htmlUrl on host evil.example becomes null`
    - `a canary in a restored baseline version is scrubbed` (iterate `CANARIES` from `tests/helpers/canaries.ts`; expect `JSON.stringify(result)` to contain none of them)
  - **append:**
    - `maxAgeDays 90: entries at now-100d, now-80d, now-1d + current → 3 entries (now-80d, now-1d, now)`
    - `maxEntries 3: 5 previous + current → the last 3, current last`
    - `fresh state → 1 entry, restore.previousEntries 0`
    - `entryFromRun maps summary fields`: for a summary with `score {value: 40, measured: 6, required: 6}`, `openCounts.critical 1`, `collectionErrorCount 3` → point `{ score: 40, scoreMeasured: 6, scoreRequired: 6, open: { critical: 1, … }, collectionErrors: 3 }`
    - `buildBaseline: beta-like snapshot has unreadable ["example-org/project-beta-api|secret-scanning", …] and errors keys "repo|secret-scanning|not-authorised"`
    - `buildBaseline: a repository error marks code-scanning, dependabot, secret-scanning and security-status-file unreadable for that repo`
  - **changes:**
    - `status: amber → red overall and delivery, in order overall, delivery`
    - `grey → green counts as a change`
    - `a dimension missing in the previous point is not compared`
    - `new critical when the pair was readable before`
    - `not new when its pair was unreadable in the previous run; findingsPartial true`
    - `resolved when absent now and its pair readable now`
    - `not resolved when its pair is unreadable now; findingsPartial true`
    - `61 new findings → 50 listed, findingsTruncated 11, totals.newFindings 61`
    - `version 3.0.2 → 3.1.0 is a move; null → 3.1.0 and 3.1.0 → null are not`
    - `new error key listed; previous-only key counted in resolvedErrors`
    - `project absent in the previous entry → added true, nothing compared`
    - `each fresh state → basis.state equals it ("none" for none), previousCollectedAt null, totals all 0`
    - `fixture state → basis.state compared, synthetic true`

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run tests/unit/history.test.ts`. Expected: FAIL (modules missing).

- [ ] **Step 3: Implement** the four modules per the Interfaces. No I/O except in `load.ts`.

- [ ] **Step 4: Run the tests and checks**

  Run: `npx vitest run tests/unit/history.test.ts && npm run typecheck && npm run lint`. Expected: PASS.

- [ ] **Step 5: Commit**
      `git commit -m "feat(collector): history load, append with retention, and change diff"`

---

### Task 3: Wire history into the CLI, writer, report, goldens

**Files:**

- Modify: `collector/src/index.ts`:
  - new `parseArgs` options `history-from` (string), `history-fixture` (string, default `fixtures/history/history.json`), `fresh-history` (boolean);
  - call `loadPreviousHistory` **before** `writeSnapshots`;
  - skip all history work when `policies.history.enabled` is false.
- Modify: `collector/src/writers/write-snapshots.ts`:
  - `serialise(..., extras?: { history: HistoryFile | null; changes: ChangesFile | null })` validates both with their schemas and adds `history.json` (compact `JSON.stringify(data)` + `\n`) and `changes.json` (2-space indent + `\n`);
  - `writeSnapshots(outDir, index, projects, catalog, discovery, extras)` passes them through;
  - `CollectionReport` gains `history: { state, entries } | null`;
  - `reportMarkdown` adds one line under the table, for example `| History | restored · 13 entries |` or `| History | started fresh (restore-failed) · 1 entry |` (or `| History | disabled |`).
- Modify: `scripts/update-golden-snapshots.ts`: load the previous history through the mock path (`loadPreviousHistory` with `dataSource: 'mock'`, `fixturePath: 'fixtures/history/history.json'`), then `appendHistory` and `computeChanges`, then pass the extras.
- Modify: `scripts/validate-snapshots.ts`: when `history.json` or `changes.json` exists, validate it with its schema and `assertPublishable`. A missing file is not a problem.
- Modify: `src/lib/validate.ts`: add `validateHistory(text)` and `validateChanges(text)` (same `Loaded<T>` shape) for the script and the site.
- Create: `fixtures/history/history.json`: the 12 entries and the baseline from spec §5.10, with `@now-Nd` tokens.
  - Platform's first entry is `@now-9d`.
  - Alpha `@now-6d` has `score: null, scoreMeasured: 2, scoreRequired: 6`.
  - Baseline:
    - alpha findings: `…frontend#dependabot#7` and `…backend#code-scanning#9` (high, component `backend`, `htmlUrl https://github.com/example-org/project-alpha-backend/security/code-scanning/9`); versions coordinator `1.4.0`, backend `1.4.0`, frontend `2.0.3`, worker `1.2.0`, helm `0.9.0`;
    - beta findings: `…web#dependabot#11`; unreadable: coordinator and api secret-scanning; errors: the two matching keys; versions api `3.1.0`, web `3.1.0`, helm `1.0.0`, coordinator `3.2.0`;
    - platform findings `…platform-mono#code-scanning#4`; versions web `2.0.1`, api `1.8.0`, worker `0.4.0`, coordinator `2026.10.1`;
    - gamma: no findings, unreadable = the four pairs of both repos, errors `example-org/project-gamma-coordinator|repository|not-found` and `example-org/project-gamma-service|repository|not-authorised`, versions all null.
- Regenerate: `npm run fixtures:update` → new `fixtures/snapshots/history.json` and `fixtures/snapshots/changes.json`. `collection-report.*` changes by one line. Every other golden is unchanged.
- Modify: `.gitignore` (add `.history-restore/`).
- Test: `tests/integration/collector.test.ts`

**Interfaces:**

- Consumes: everything from Task 2.
- History path resolution in `index.ts`: `values['history-from'] ?? process.env.HISTORY_FROM ?? values.out`. `restoreState = process.env.HISTORY_RESTORE_STATE || undefined`.

- [ ] **Step 1: Write failing tests** (`collector.test.ts`)
  - Extend `reproduces the golden snapshots exactly`: `mockRun()` also runs the history pipeline as the golden script does; the file list adds `history.json` and `changes.json`.
  - `golden changes totals are {statusChanges:4,newFindings:1,resolvedFindings:1,versionMoves:1,newErrors:1}`.
  - `golden changes: beta statusChanges [overall amber→red, delivery amber→red, security amber→red], newFindings[0].id "example-org/project-beta-api#code-scanning#3" with title null, findingsPartial true`.
  - `golden changes: alpha versionMoves [{kind:"component", componentId:"frontend", from:"2.0.3", to:"2.1.0"}] and resolvedFindings[0].id "example-org/project-alpha-backend#code-scanning#9"`.
  - `golden changes: platform and gamma have empty lists; basis {state:"compared", previousCollectedAt:"2026-01-14T12:00:00.000Z", synthetic:true}`.
  - `golden history: 13 entries, first 2026-01-03T12:00:00.000Z, last 2026-01-15T12:00:00.000Z, restore {state:"fixture", previousEntries:12}`.
  - `golden history: platform appears in 10 entries, alpha has score null on 2026-01-09T12:00:00.000Z`.
  - `fixtures:update is idempotent`: run the golden pipeline into two temp dirs (the second with the first's output as `historyFrom`, with mock) and compare. Byte-identical because mock never restores.
  - `github-mode restore appends`: write the golden `history.json` with every `dataSource` replaced by `github` into a temp dir. Run `runCollection` with a fake provider whose `dataSource` is `github`, clock `2026-01-15T18:00:00.000Z`, then the history pipeline with `historyFrom` that dir → 14 entries, `restore.state "restored"`.
  - `history.enabled false → no history.json or changes.json written and report says disabled`.
  - `canary in the history fixture is blocked`: copy `fixtures/history/history.json` to a temp path with a CANARY inside a baseline version, run → the canary is absent from the output, or `SanitizationError` is thrown. Either is acceptable; assert never present.
  - `validate-snapshots accepts the golden dir and rejects a history.json with an extra key` (call `validateHistory` directly).

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run tests/integration/collector.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the wiring and write the fixture. Then run `npm run fixtures:update` **twice** and check that `git status --porcelain fixtures/snapshots` shows no change after the second run. Then run `npm run validate:snapshots -- fixtures/snapshots`.

- [ ] **Step 4: Run the full check**

  Run: `npm run lint && npm run typecheck && npm test`. Expected: all PASS. The site test still passes: the site does not read the new files yet.

- [ ] **Step 5: Commit**
      `git commit -m "feat(collector): publish history.json and changes.json with mock history fixture"`

---

### Task 4: Persist history in GitHub Actions (restore script, workflows)

**Files:**

- Create: `collector/src/history/select-artifact.ts` (pure)
- Create: `scripts/restore-history.ts`
- Modify: `package.json` (script `"history:restore": "tsx scripts/restore-history.ts"`)
- Modify: `.github/workflows/collect-data.yml`:
  - header comment (purpose, permissions);
  - job `permissions: actions: read`;
  - job `concurrency: { group: hub-collect, cancel-in-progress: false }`;
  - step `Restore previous history` (id `history`);
  - Collect env `HISTORY_FROM`, `HISTORY_RESTORE_STATE`;
  - step `Upload history artifact`.
- Modify: `.github/workflows/deploy-pages.yml`: job `collect` `permissions` adds `actions: read # collect-data restores this repository's own hub-history artifact`; header comment.
- Test: `tests/unit/restore-history.test.ts` (new)

**Interfaces:**

- `select-artifact.ts`:

  ```ts
  export interface ArtifactLike {
    id: number;
    name: string;
    expired: boolean;
    size_in_bytes: number;
    created_at: string | null;
    workflow_run?: {
      id?: number;
      repository_id?: number;
      head_repository_id?: number;
      head_branch?: string | null;
    } | null;
  }
  export interface RunLike {
    id: number;
    path: string;
    event: string;
  }
  export const HISTORY_ARTIFACT = 'hub-history';
  export const MAX_ARTIFACT_BYTES = 5_242_880;
  export const ALLOWED_PATHS = [
    '.github/workflows/deploy-pages.yml',
    '.github/workflows/collect-data.yml',
  ];
  export const ALLOWED_EVENTS = ['schedule', 'push', 'workflow_dispatch', 'repository_dispatch'];
  export function candidateArtifacts(
    list: ArtifactLike[],
    o: { repositoryId: number; defaultBranch: string; currentRunId: number },
  ): ArtifactLike[]; // filtered, newest first, at most 5
  export function runIsTrusted(run: RunLike): boolean; // strips an "@ref" suffix from path
  export type RestoreOutcome =
    | { state: 'restored' }
    | { state: 'none'; reason: 'no-artifact' }
    | { state: 'failed'; reason: 'not-authorised' | 'bad-archive' | 'api-error' };
  ```

- `scripts/restore-history.ts`:
  - args `--out <dir>`; env `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `GITHUB_RUN_ID`, optional `GITHUB_API_URL`;
  - Octokit with `@octokit/plugin-retry` only;
  - exports `restoreHistory(octokit, opts): Promise<RestoreOutcome>` for tests;
  - the CLI wrapper writes `state=` and `reason=` lines to `$GITHUB_OUTPUT` when set, and prints `History restore: <state> (<reason>)`;
  - it always exits 0;
  - it never prints error objects, only `classifyGitHubError` classifications (reuse from the GitHub provider).
- Workflow steps (exact):

  ```yaml
  # Restores the previous history from this repository's own newest "hub-history"
  # artifact (default branch, same repository, deploy/collect workflow only).
  # Uses only the workflow GITHUB_TOKEN (actions: read); collector secrets are not passed.
  - name: Restore previous history
    id: history
    if: ${{ steps.source.outputs.data-source == 'github' }}
    env:
      GITHUB_TOKEN: ${{ github.token }}
    run: npm run --silent history:restore -- --out .history-restore
  ```

  Collect step env additions:

  ```yaml
  HISTORY_FROM: .history-restore
  HISTORY_RESTORE_STATE: ${{ steps.history.outputs.state }}
  ```

  After "Upload snapshots artifact":

  ```yaml
  - name: Upload history artifact
    if: ${{ steps.source.outputs.data-source == 'github' }}
    uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7
    with:
      name: hub-history
      path: public/data/history.json
      retention-days: 90
      if-no-files-found: warn
  ```

- [ ] **Step 1: Write failing tests** (`restore-history.test.ts`; mock Octokit as `tests/unit/github-provider.test.ts` does; build zips with `makeZip` from `tests/helpers/factories.ts`)
  - **candidateArtifacts** (repositoryId 100, defaultBranch `main`, currentRunId 999):
    - `keeps a main, same-repo, non-expired artifact`
    - `drops expired`
    - `drops head_branch "feature/x"`
    - `drops head_repository_id 200 (fork)`
    - `drops workflow_run.id 999 (current run)`
    - `drops size_in_bytes 5_242_881`
    - `sorts newest first and returns at most 5 of 7`
    - `drops an artifact without workflow_run`
  - **runIsTrusted:**
    - `accepts .github/workflows/deploy-pages.yml with event schedule`
    - `accepts collect-data.yml@refs/heads/main with event workflow_dispatch`
    - `rejects .github/workflows/ci.yml`
    - `rejects event pull_request`
    - `rejects event pull_request_target`
  - **restoreHistory:**
    - `restored: newest trusted candidate downloaded, history.json written to out` (assert file content equals the zipped text)
    - `skips an untrusted newest run and uses the next trusted one`
    - `none/no-artifact when the list is empty`
    - `none/no-artifact when no candidate run is trusted`
    - `failed/not-authorised on 403 from the artifacts list`
    - `failed/bad-archive when the zip lacks history.json`
    - `failed/bad-archive when the entry is larger than 8_388_608 bytes`
    - `failed/api-error on a 500`
    - `never writes outside --out` (out dir contains only `history.json`)
    - `CLI prints no token`: set `GITHUB_TOKEN=ghp_exampleSecretValue123456789012345678`, capture stdout and the `GITHUB_OUTPUT` file, assert the token is absent.

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run tests/unit/restore-history.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the module, the script and the workflow edits.

- [ ] **Step 4: Run the tests and checks**

  Run:

  ```bash
  npx vitest run tests/unit/restore-history.test.ts
  npm run typecheck && npm run lint
  actionlint .github/workflows/collect-data.yml .github/workflows/deploy-pages.yml
  zizmor .github/workflows/collect-data.yml .github/workflows/deploy-pages.yml
  ```

  Expected: PASS, with no new zizmor finding at medium or above. If zizmor flags `actions: read` as excessive, keep it and add an inline `# zizmor: ignore[...]` comment with the reason only if the finding is a false positive.

- [ ] **Step 5: Commit**
      `git commit -m "ci(collect): restore and upload hub-history artifact with actions: read on itself"`

---

### Task 5: CSV exports

**Files:**

- Create: `src/lib/csv.ts` (pure encoding)
- Create: `src/lib/exports.ts` (pure builders from `SiteData` + optional history)
- Create: `src/pages/exports/portfolio.csv.ts`, `src/pages/exports/findings-summary.csv.ts`, `src/pages/exports/versions.csv.ts` (Astro static endpoints, `export const GET: APIRoute`, `Content-Type: text/csv; charset=utf-8`)
- Modify: `src/lib/routes.ts`: `export function exportHref(name: 'portfolio.csv' | 'findings-summary.csv' | 'versions.csv'): string` → `${base()}exports/${name}`
- Modify: `src/lib/data.ts`: `loadHistory()` and `loadChanges()` (cached per dir like `loadSiteData`; missing → `{ok:false, error:{kind:'missing'}}`; invalid → `{ok:false, error:{kind:'invalid'}}` plus one `console.warn`)
- Modify: `scripts/scan-output.ts`: add `'.csv'` to `TEXT_EXT`
- Test: `tests/unit/csv.test.ts` (new), `tests/unit/scan-output.test.ts`, `tests/integration/site.test.ts`

**Interfaces:**

- `csv.ts`:
  ```ts
  export type CsvValue = string | number | boolean | null | { na: true };
  export const NA: CsvValue = { na: true };
  export function csvCell(v: CsvValue): string;
  export function toCsv(headers: readonly string[], rows: readonly CsvValue[][]): string; // BOM + CRLF rows, trailing CRLF
  ```
- `exports.ts`:
  - `PORTFOLIO_HEADERS`, `FINDINGS_HEADERS`, `VERSIONS_HEADERS` as `readonly string[]`, exactly as spec §5.9;
  - `portfolioRows(data, history|null)`, `findingsRows(data)`, `versionsRows(data)`;
  - `previous_*` come from `history.entries.at(-2)` for that project (`NA` when absent).

- [ ] **Step 1: Write failing tests**
  - `csv.test.ts`, as a table:

    | Input                      | Output                        |
    | -------------------------- | ----------------------------- |
    | `'=1+1'`                   | `'=1+1`                       |
    | `'+cmd'`                   | `'+cmd`                       |
    | `'-rc.1'`                  | `'-rc.1`                      |
    | `'@SUM(A1)'`               | `'@SUM(A1)`                   |
    | `'\tx'`                    | `'\tx`                        |
    | `'\rx'`                    | `"'\rx"`                      |
    | `'=HYPERLINK("http://x")'` | `"'=HYPERLINK(""http://x"")"` |
    | `'a,b'`                    | `"a,b"`                       |
    | `'say "hi"'`               | `"say ""hi"""`                |
    | `'line\nbreak'`            | `"line\nbreak"`               |
    | `'Qualità'`                | `Qualità`                     |
    | `null`                     | `unknown`                     |
    | `NA`                       | `n/a`                         |
    | `42`                       | `42`                          |
    | `0`                        | `0`                           |
    | `true`                     | `true`                        |

    Also:
    - `toCsv starts with ﻿, uses \r\n between rows and ends with \r\n`;
    - `toCsv(['a'], [])` → `'﻿a\r\n'`;
    - `portfolioRows on the golden data: project-gamma score "unknown", previous_score "unknown"` (gamma's previous score is null); `project-beta previous_score 58, previous_overall "amber", previous_collected_at "2026-01-14T12:00:00.000Z"`;
    - `portfolioRows without history: previous_* are "n/a"`;
    - `findingsRows: gamma repositories have all counts "unknown"; beta-api open_critical 1 and sources_complete false`;
    - `versionsRows: has row_type coordinator, component and environment rows; alpha frontend version "2.1.0" drift "drift"`;
    - `headers match the spec lists exactly` (snapshot the arrays inline).

  - `scan-output.test.ts`: `a .csv file with a ghp_ token is reported`.
  - `site.test.ts`:
    - `dist/exports/portfolio.csv exists, starts with the BOM and the header "project_id,project_name,"`;
    - `findings-summary.csv and versions.csv exist with their headers`;
    - `no CSV cell begins with = + - @ unless prefixed by '` (split rows, naive split is fine for the golden data, which has no quoted commas);
    - `scan() over dist reports no findings` (existing test, now covering .csv).

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run tests/unit/csv.test.ts tests/unit/scan-output.test.ts tests/integration/site.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** Check whether the Astro build writes `dist/exports/portfolio.csv` as a file with `trailingSlash: 'always'` and `format: 'directory'`. Endpoints with an extension in the file name are emitted as files. If not, set `export const prerender = true` and fix the route naming. Write down the finding in the commit body.

- [ ] **Step 4: Run the tests and checks**

  Same command, then `npm run typecheck && npm run lint`. Expected: PASS.

- [ ] **Step 5: Commit**
      `git commit -m "feat(site): static CSV exports for portfolio, alert summary and versions"`

---

### Task 6: Site: trend on the portfolio and the project page

**Files:**

- Create: `src/lib/trend.ts` (pure)
- Create: `src/components/Sparkline.astro`, `src/components/StatusStrip.astro`, `src/components/TrendSection.astro`
- Modify: `src/pages/[...lang]/index.astro`:
  - a Trend column after the score (`<th role="columnheader" scope="col">{d.trend.col}</th>`);
  - the CSV link near the list tools (`exportHref('portfolio.csv')`, `download`).
- Modify: `src/pages/[...lang]/projects/[id].astro`: `<TrendSection>` right after `<section class="dimcards">`, `id="trend"`.
- Modify: `src/i18n/en.ts`, `src/i18n/it.ts` (block `trend`, `exports.portfolio`, `exports.hint`)
- Test: `tests/unit/trend.test.ts` (new), `tests/integration/site.test.ts`, `tests/e2e/smoke.spec.ts`

**Interfaces:**

- `trend.ts`:

  ```ts
  export interface TrendPoint {
    at: string;
    score: number | null;
    overall: HealthStatus;
    dimensions: Partial<Record<Dimension, HealthStatus>>;
  }
  export function seriesFor(history: HistoryFile, projectId: string, max: number): TrendPoint[];
  export function sparklineSegments(scores: (number | null)[], w: number, h: number): string[];
  export interface TrendSummary {
    first: number;
    last: number;
    delta: number;
    days: number;
    count: number;
  }
  export function summarise(points: TrendPoint[]): TrendSummary | null; // null when < 2 measured points
  export const STRIP_HEIGHT: Record<HealthStatus, number>; // { red: 1, amber: 0.667, green: 0.333, grey: 1 }
  ```

  - `sparklineSegments` uses a fixed 0–100 scale: `x = i · w/(n−1)` (or `w/2` when `n = 1`) and `y = h − score/100·h`, rounded to 1 decimal. It splits at null. A single-point segment is `M{x} {y}h0`; other segments are `M… L… L…`.
  - `days` = whole days between the first and the last measured point (`Math.round(Δms / DAY_MS)`).
  - `count` = all points in the window, null ones included.

- `Sparkline.astro` props `{ scores: (number|null)[]; width: number; height: number; label: string }`:
  - `<svg aria-hidden="true">` with `stroke-linecap="round"` (so `h0` shows a dot);
  - followed by `<span class="visually-hidden">{label}</span>`.
- `StatusStrip.astro` props `{ points: TrendPoint[]; label: string }`:
  - `<svg aria-hidden="true">`, one `<rect>` per point, height `STRIP_HEIGHT[status]·H`, the status tone class from `src/lib/tones.ts`, grey = `fill: none; stroke-dasharray: 2 2`;
  - followed by a text summary "Healthy 5 · Attention 6 · Critical 1 · Unknown 1" (existing status labels).
- `TrendSection.astro` props `{ projectId, history: Loaded<HistoryFile>, locale }`:
  - renders `trend.none` when the history is missing, and `trend.invalid` when it is invalid;
  - otherwise the 320×56 sparkline with the 0/100 guides, the strip, the summary sentence, `trend.gapNote`, and `<details>` with the table (date via the existing `format.ts` date helper, overall badge, score or `UnknownValue`, the six dimensions as badges or `trend.notTracked`, open critical/high or `—`);
  - a link to `changes/#p-<id>`.
- New i18n keys (EN | IT):

  | Key                 | EN                                                                                     | IT                                                                                              |
  | ------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
  | `trend.title`       | Trend                                                                                  | Andamento                                                                                       |
  | `trend.col`         | Trend                                                                                  | Andamento                                                                                       |
  | `trend.up`          | Score up {n} points over {days} days ({count} collections)                             | Punteggio in aumento di {n} punti in {days} giorni ({count} raccolte)                           |
  | `trend.down`        | Score down {n} points over {days} days ({count} collections)                           | Punteggio in calo di {n} punti in {days} giorni ({count} raccolte)                              |
  | `trend.flat`        | Score unchanged over {days} days ({count} collections)                                 | Punteggio invariato in {days} giorni ({count} raccolte)                                         |
  | `trend.short`       | {sign}{n} · {days} d                                                                   | {sign}{n} · {days} g                                                                            |
  | `trend.none`        | No history yet                                                                         | Ancora nessuno storico                                                                          |
  | `trend.invalid`     | History could not be read                                                              | Lo storico non è leggibile                                                                      |
  | `trend.notEnough`   | Not enough measured points                                                             | Punti misurati insufficienti                                                                    |
  | `trend.gapNote`     | Gaps are collections where the score could not be measured; they are never drawn as 0. | I vuoti sono raccolte in cui il punteggio non era misurabile; non vengono mai disegnati come 0. |
  | `trend.strip`       | Overall status per collection                                                          | Stato complessivo per raccolta                                                                  |
  | `trend.summary`     | From {first} on {firstDate} to {last} on {lastDate}, {count} collections.              | Da {first} il {firstDate} a {last} il {lastDate}, {count} raccolte.                             |
  | `trend.table`       | Show history as a table                                                                | Mostra lo storico come tabella                                                                  |
  | `trend.date`        | Collected                                                                              | Raccolto                                                                                        |
  | `trend.notTracked`  | not tracked                                                                            | non rilevato                                                                                    |
  | `trend.changesLink` | What changed for this project                                                          | Cosa è cambiato per questo progetto                                                             |
  | `exports.portfolio` | Download CSV                                                                           | Scarica CSV                                                                                     |
  | `exports.hint`      | UTF-8 CSV with BOM, comma-separated. "unknown" means not readable, never 0.            | CSV UTF-8 con BOM, separato da virgole. "unknown" significa non leggibile, mai 0.               |

- [ ] **Step 0: Design-first.**
  - Add the artboards "Trend cell", "Project trend" and "What changed" to the Claude Design canvas with Warm Graphite. Re-read the canvas files first: they change remotely.
  - The owner reviews after delivery (program spec §1), so do not wait.
  - Never put artifact links in the repository.

- [ ] **Step 1: Write failing tests**
  - `trend.test.ts`:
    - `sparklineSegments([10, null, 30, 20], 90, 20)` → `['M0 18h0', 'M60 14L90 16']`
    - `sparklineSegments([null, null], 90, 20)` → `[]`
    - `sparklineSegments([50], 96, 20)` → `['M48 10h0']`
    - `sparklineSegments([0, 100], 10, 10)` → `['M0 10L10 0']`
    - `summarise on golden alpha → {first:64,last:78,delta:14,days:12,count:13}`
    - `summarise on golden beta → {first:62,last:40,delta:-22,days:12,count:13}`
    - `summarise on golden platform → {first:84,last:82,delta:-2,days:9,count:10}`
    - `summarise on golden gamma → null`
    - `seriesFor(history, "project-alpha", 30)` has 13 points, the 7th with `score null`
    - `seriesFor` with max 5 returns the last 5
    - `STRIP_HEIGHT.red > amber > green, grey 1`
  - `site.test.ts`:
    - `portfolio has a Trend column header (EN "Trend", IT "Andamento")`
    - `portfolio alpha row has an svg sparkline and the label "Score up 14 points over 12 days (13 collections)"`
    - `portfolio gamma row says "Not enough measured points" and draws no path`
    - `portfolio links to exports/portfolio.csv with a download attribute`
    - `project-alpha has #trend with a <details> table of 13 rows and one score cell "—"/unknown for 2026-01-09`
    - `project-platform trend table has 10 rows` (no invented points)
    - `IT project page shows "I vuoti sono raccolte…"`
    - `a site built from fixtures/snapshots without history.json and changes.json renders portfolio and project pages with "No history yet"`: copy the goldens to a temp dir minus the two files, build with `buildSite`. Reuse the pattern at `site.test.ts` ~941.
  - `smoke.spec.ts`:
    - `project trend table opens with the keyboard` (desktop and mobile): focus the `#trend summary`, press Enter, expect the table visible.

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run tests/unit/trend.test.ts tests/integration/site.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the lib, the components, the page changes and the strings, following the Warm Graphite tokens (`DESIGN.md`) and the existing responsive table pattern of the portfolio.

- [ ] **Step 4: Run the full check**

  Run:

  ```bash
  npm run lint && npm run typecheck && npm test
  sed s/4321/4377/g playwright.config.ts > playwright.tmp.config.ts
  npx playwright test -c playwright.tmp.config.ts
  rm playwright.tmp.config.ts
  ```

  Expected: all PASS.

- [ ] **Step 5: Commit**
      `git commit -m "feat(ui): score sparkline and status strip on portfolio and project pages"`

---

### Task 7: Site: "What changed" page, nav, Data quality, How to read, CSV links

**Files:**

- Create: `src/pages/[...lang]/changes.astro`
- Modify: `src/lib/routes.ts`: `PageKey` adds `'changes'`, `PATHS.changes = 'changes/'`, `NAV = ['portfolio', 'changes', 'security', 'versions', 'workflows', 'dataQuality', 'catalog']`
- Modify: `src/pages/[...lang]/data-quality.astro` (a "History" card, `aria-labelledby="h-history"`)
- Modify: `src/pages/[...lang]/how-to-read.astro` (section `id="trends"`)
- Modify: `src/lib/policies.ts` (expose `history` retention for How to read)
- Modify: `src/pages/[...lang]/security.astro` and `versions.astro` (CSV links)
- Modify: `src/i18n/en.ts`, `src/i18n/it.ts` (`nav.changes`, `changes.*`, `dataQuality.history.*`, `howToRead.trends*`, `exports.findings`, `exports.versions`)
- Test: `tests/integration/site.test.ts`, `tests/e2e/smoke.spec.ts`, `tests/unit/site-policies.test.ts`

**Interfaces:**

- `changes.astro` reads `loadSiteData()` and `loadChanges()`:
  - `loadChanges` missing → `changes.missing`; invalid → `changes.invalid`;
  - `basis.state !== 'compared'` → `changes.basis.<state>` only, with no per-project cards;
  - otherwise:
    - the lede `changes.compared` (and `changes.synthetic` when true);
    - a summary line with links to `#first-<kind>`;
    - cards ordered: projects with any change first, then by `HEALTH_RANK` of the current status descending, then by name;
    - each card `id="p-<id>"`, with the lists from spec §5.7.
  - Badges reuse `StatusBadge.astro`; links reuse `ExtLink.astro`; a null title uses the existing "title withheld" string.
- New i18n keys (EN | IT), in addition to spec §5.8:

  | Key                             | EN                                                                                                                                                                         | IT                                                                                                                                                                             |
  | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | `changes.lede`                  | What moved between the last two collections, worst first.                                                                                                                  | Cosa si è mosso tra le ultime due raccolte, dal più grave.                                                                                                                     |
  | `changes.compared`              | Compared with the collection of {date} ({relative}).                                                                                                                       | Confronto con la raccolta del {date} ({relative}).                                                                                                                             |
  | `changes.synthetic`             | Demo data: earlier collections are synthetic.                                                                                                                              | Dati demo: le raccolte precedenti sono sintetiche.                                                                                                                             |
  | `changes.summary`               | {statusChanges} status changes · {newFindings} new and {resolvedFindings} resolved critical/high alerts · {versionMoves} version moves · {newErrors} new collection errors | {statusChanges} cambi di stato · {newFindings} alert critici/alti nuovi e {resolvedFindings} risolti · {versionMoves} versioni cambiate · {newErrors} nuovi errori di raccolta |
  | `changes.statusChanges`         | Status changes                                                                                                                                                             | Cambi di stato                                                                                                                                                                 |
  | `changes.score`                 | Score                                                                                                                                                                      | Punteggio                                                                                                                                                                      |
  | `changes.newFindings`           | New critical/high alerts                                                                                                                                                   | Nuovi alert critici/alti                                                                                                                                                       |
  | `changes.resolvedFindings`      | Resolved critical/high alerts                                                                                                                                              | Alert critici/alti risolti                                                                                                                                                     |
  | `changes.truncated`             | and {n} more                                                                                                                                                               | e altri {n}                                                                                                                                                                    |
  | `changes.versionMoves`          | Version moves                                                                                                                                                              | Versioni cambiate                                                                                                                                                              |
  | `changes.coordinator`           | Coordinator                                                                                                                                                                | Coordinatore                                                                                                                                                                   |
  | `changes.newErrors`             | New collection errors                                                                                                                                                      | Nuovi errori di raccolta                                                                                                                                                       |
  | `changes.resolvedErrors`        | {n} errors no longer occur                                                                                                                                                 | {n} errori non si verificano più                                                                                                                                               |
  | `changes.projectNone`           | No changes.                                                                                                                                                                | Nessun cambiamento.                                                                                                                                                            |
  | `changes.added`                 | New in this collection: nothing to compare.                                                                                                                                | Nuovo in questa raccolta: nulla da confrontare.                                                                                                                                |
  | `changes.missing`               | No change data in this snapshot (collected before v0.7.0 or with history turned off).                                                                                      | Nessun dato sui cambiamenti in questo snapshot (raccolto prima della v0.7.0 o con lo storico disattivato).                                                                     |
  | `changes.invalid`               | The change data could not be read.                                                                                                                                         | I dati sui cambiamenti non sono leggibili.                                                                                                                                     |
  | `dataQuality.history.title`     | History                                                                                                                                                                    | Storico                                                                                                                                                                        |
  | `dataQuality.history.restored`  | Restored {count} previous collections (oldest {date}).                                                                                                                     | Ripristinate {count} raccolte precedenti (la più vecchia del {date}).                                                                                                          |
  | `dataQuality.history.fixture`   | Demo history: {count} synthetic previous collections.                                                                                                                      | Storico demo: {count} raccolte precedenti sintetiche.                                                                                                                          |
  | `dataQuality.history.fresh`     | Started fresh: {reason}                                                                                                                                                    | Ripartito da zero: {reason}                                                                                                                                                    |
  | `dataQuality.history.retention` | Kept: up to {maxEntries} collections, at most {maxAgeDays} days. Now {entries}.                                                                                            | Conservate: fino a {maxEntries} raccolte, al massimo {maxAgeDays} giorni. Ora {entries}.                                                                                       |
  | `howToRead.trendsTitle`         | Trends, changes and CSV                                                                                                                                                    | Andamento, cambiamenti e CSV                                                                                                                                                   |
  | `howToRead.trendsBody`          | (4 bullets from spec §5.7 "How to read")                                                                                                                                   | (4 punti dalla spec §5.7 "Come leggere")                                                                                                                                       |
  | `exports.findings`              | Alert summary (CSV)                                                                                                                                                        | Riepilogo alert (CSV)                                                                                                                                                          |
  | `exports.versions`              | Versions (CSV)                                                                                                                                                             | Versioni (CSV)                                                                                                                                                                 |

  `dataQuality.history.fresh` reuses the `changes.basis.<state>` sentence as `{reason}`.

- [ ] **Step 1: Write failing tests**
  - `site.test.ts`:
    - add `'changes'` to `VIEWS` (so `/changes/` and `/it/changes/` get the generic render checks);
    - `nav lists "What changed" right after Portfolio; IT "Cosa è cambiato"`;
    - `changes page: summary "4 status changes · 1 new and 1 resolved critical/high alerts · 1 version moves · 1 new collection errors"` (or the equivalent text after pluralisation, if the builder adds plural forms; assert the numbers 4, 1, 1, 1, 1 with their labels);
    - `changes page: project-beta card first, with "amber → red" for Overall, Delivery and Security, a link to …/project-beta-api/security/code-scanning/3, and the findingsPartial note`;
    - `changes page: project-alpha card lists "frontend: 2.0.3 → 2.1.0" and resolved …backend#code-scanning#9`;
    - `changes page: project-platform and project-gamma cards say "No changes."`;
    - `changes page: the synthetic note is shown`;
    - `changes built with basis.state "restore-failed" shows the restore-failed sentence and never "No changes"`: patch a temp copy of `changes.json` and build;
    - `changes built without changes.json shows the missing sentence`;
    - `data-quality has the History card with "Demo history: 12 synthetic previous collections" and "up to 120 collections, at most 90 days"`;
    - `how-to-read has #trends mentioning "never 0" and "UTF-8"`;
    - `security links exports/findings-summary.csv; versions links exports/versions.csv`.
  - `site-policies.test.ts`: `history retention defaults are exposed (120, 90) when the file omits the block`.
  - `smoke.spec.ts`:
    - `nav reaches What changed` (desktop and Pixel 7; on mobile the nav scrolls sideways, use `getByRole('link', { name: 'What changed' })`);
    - `CSV link responds 200 and starts with the BOM` (`page.request.get('/exports/portfolio.csv')`, check `(await res.body())[0..2]` is `EF BB BF`).

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run tests/integration/site.test.ts tests/unit/site-policies.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the page, nav, cards, links and strings.

- [ ] **Step 4: Run the full check**

  Run:

  ```bash
  npm run lint && npm run typecheck && npm test
  sed s/4321/4377/g playwright.config.ts > playwright.tmp.config.ts
  npx playwright test -c playwright.tmp.config.ts
  rm playwright.tmp.config.ts
  ```

  Expected: all PASS. The existing nav-scroll e2e test (smoke.spec.ts ~228) must still pass with one more item.

- [ ] **Step 5: Commit**
      `git commit -m "feat(ui): what changed since last collection page, history card and CSV links"`

---

### Task 8: Docs, ADR 0006, changelog, README, design upkeep

**Files:**

- Modify (EN, and the IT mirror under `docs/it/`):
  - `docs/configuration.md`:
    - the `history` policies block in the `config/policies.yaml` section;
    - a new section "History and CSV export" with the collector flags `--history-from`, `--history-fixture`, `--fresh-history`;
    - in the Environment variables table: `HISTORY_FROM`, `HISTORY_RESTORE_STATE`;
    - the CSV files and their columns (spec §5.9).
  - `docs/operations.md`:
    - a new section "History between runs": the `hub-history` artifact, the restore states table (spec §5.4 and §5.6) with what to do, resetting history, concurrency `hub-collect`;
    - the `hub-history` row (90 days) in the Artifact retention table;
    - in "Local data and `ci:build`", a note that a local `collect:github` appends to `public/data/history.json`.
  - `docs/security.md`:
    - in "Least privilege in workflows": `collect` adds `actions: read` (own repository only);
    - in "Data published": `history.json`, `changes.json`, `exports/*.csv`;
    - in "Data never published": no titles of resolved alerts, no raw payloads in history;
    - in "Sanitisation": the restored history as untrusted input (provenance checks, 5 MiB / 8 MiB caps, strict parse, re-sanitised links against the current host allowlist), and CSV injection protection;
    - the threat model row "planted history artifact".
  - `docs/architecture.md`:
    - Data flow: restore → collect → append → diff → publish;
    - the trust boundary row for the restore step;
    - in "Snapshot model": a note that the history and changes files are versioned separately (`1.0`) and why.
  - `README.md` / `README.it.md`:
    - Views table: a new "What changed" row (`/changes/`); the Portfolio row mentions the Trend column and "Download CSV"; the Project detail row mentions the Trend block; Security and Versions mention their CSV;
    - "What it answers": add "what changed since the last collection, and whether each project is improving";
    - Roadmap: remove "history and trends, including a "What changed since last collection" view" and "CSV export".
  - `PRODUCT.md`, `DESIGN.md`: the sparkline and status strip pattern (height encodes status, dashed grey, fixed 0–100 scale), and the changes page.
- Create: `docs/architecture/adr/0006-history-persisted-through-own-actions-artifacts.md` and `docs/it/architecture/adr/0006-history-persisted-through-own-actions-artifacts.md`.
  - Check the next free number with `ls docs/architecture/adr`.
  - Follow the structure of ADR 0005: Context, Decision, Alternatives considered, Consequences. The content comes from spec §5.11.
- Modify: `docs/architecture.md` "Architectural decisions" list (and the IT one): add ADR 0006.
- Modify: `CHANGELOG.md` `## [Unreleased]`:
  - **Added:** history (`history.json`, retention policies, `hub-history` artifact with Actions: read on the hub's own repository); the Trend column and block; the "What changed" page (`changes.json`); CSV exports; the Data quality History card; the How to read section.
  - **Changed:** the `collect` job permissions (`actions: read`) and concurrency; `scan:output` now scans `.csv`.
  - **Note:** snapshot schema unchanged (1.4), so no re-collect is needed; history starts with the first v0.7.0 collection.
- Design upkeep, outside the repo:
  - Update the Claude Design canvas artboards from Task 6 Step 0 and the Warm Graphite DS README so they match the build.
  - Re-read the artifact files first; they change remotely.
  - Never put artifact links in the repository.

- [ ] **Step 1: Write and update the docs.** Each EN file links to its IT twin and back.

- [ ] **Step 2: Check them**

  Run: `npx prettier --check . && npm run validate:config && npm test`. Expected: PASS. Run `grep -rn "history and trends\|CSV export" README.md README.it.md` and expect no roadmap hit.

- [ ] **Step 3: Commit**
      `git commit -m "docs: history, what changed, CSV export and ADR 0006"`

- [ ] **Step 4: Push and open the PR**

  Push the branch and open the PR with `GH_TOKEN=$(gh auth token --user massilp) gh pr create`. Title: `feat: history, trends, what changed and CSV export (v0.7.0)`. The body lists the review focus items above and states that the snapshot schema stays at 1.4. The owner merges.
