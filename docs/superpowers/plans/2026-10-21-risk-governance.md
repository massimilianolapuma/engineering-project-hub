# Risk governance (v0.9.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three risk-governance capabilities:

- security exceptions with a mandatory expiry, from a reviewed config file;
- remediation SLAs per severity, with age, due date and overdue counts;
- policy-as-code: schema validation, an explaining `npm run policy:check` with decision cases and a read-only snapshot mode, and a CI job.

Nothing is written to GitHub, and nothing turns red by default.

**Architecture:**

- **Model:** `shared/model/exceptions.ts` holds the exceptions file contract and the policy case contract. Policies gain the `remediation` and `exceptions` blocks. Snapshot 1.5 → 1.6.
- **Pure engines:** `collector/src/policy/exceptions.ts` (validate, match, states, publication) and `collector/src/policy/sla.ts` (age, due, overdue, summary). `evaluateSecurity` gains the new reasons.
- **Collector:** `toFindings` returns unpublished match keys. `build-snapshot.ts` applies exceptions, then SLAs, then evaluates. `run.ts` adds run-level exception metadata and the report line.
- **CLI:** `scripts/policy-check.ts` wraps `collector/src/policy/check.ts`.
- **History:** v0.7.0 history 1.1 → 1.2 (optional `risk` counts). `changes.json` gains `newlyOverdue` and `expiredExceptions`. The CSV files gain columns at the end.
- **Site:** a risk panel and an exceptions table on the project page, a remediation queue on the Security page, a Data quality card and a How to read section.

**Tech Stack:** TypeScript 6, Zod 4, `yaml` 2.9, Astro 7, Vitest, Playwright. No new dependency.

**Spec:** `docs/superpowers/specs/2026-10-21-risk-governance-design.md` (IT mirror under `docs/it/`). Read it first. This plan does not repeat its rationale. Section numbers (§) and decision ids (D1–D15) refer to the spec.

## Before you start: v0.7.0 and v0.8.0 land first

This plan executes **after v0.7.0 (history, trends, "What changed", CSV) and v0.8.0 (repository controls) are merged into `main`**. Rebase first: `git fetch && git rebase origin/main` on branch `feat/risk-governance`.

Expect drift and **adapt to what is there**:

- `shared/model/primitives.ts` (v0.7.0): import `isoDate`, `httpsUrl`, `shortText`, `nullableCount` from there.
- Snapshot version: v0.8.0 sets `1.5`. This plan sets `1.6`. If `main` is already past 1.5, take the next version.
- History version: v0.8.0 sets `1.1`. This plan sets `1.2`, with the supported list extended. Same rule.
- ADR number: 0006 (v0.7.0) and 0007 (v0.8.0) are taken. Use **0008**, or the next free number (`ls docs/architecture/adr`).
- The v0.8.0 level enum (`info | amber | red`): reuse it if it is exported. Otherwise add `EnforcementLevelSchema` to `shared/model/enums.ts`.
- `src/i18n/en.ts` / `it.ts` (changes, trend and repository-controls keys), the nav, `collector/src/run.ts` and `writers/write-snapshots.ts` (history writing), `scripts/update-golden-snapshots.ts` (history fixture), the history modules under `collector/src/history/`, `src/lib/exports.ts`, and the golden files.

Keep the interfaces below. Never revert v0.7.0 or v0.8.0 code. If v0.7.0 is somehow **not** merged, skip Task 6 and record the skip in the PR body.

## Global Constraints

- Read-only. **No new API call.** Exceptions never dismiss, reopen or comment on GitHub.
- No new runtime or dev dependency. No OPA. YAML via the existing `yaml` package.
- Strict Zod schemas on every published field.
  - Exception `reason` goes through `scrubText`. `owner`, rule and tool go through `scrubIdentifier`. `ticket` goes through `link()` (sanitizeUrl + `publication.allowedLinkHosts`).
  - For a non-public repository with `publication.audience: public`, `selector.value` (rule or advisory), `selector.tool`, `reason` and `ticketUrl` are published as `null`.
- Match keys (`alert`, raw `ruleId`, `tool`, advisory ids) never leave `collector/src/normalizers/security-model.ts` → `collector/src/policy/exceptions.ts`. They are not in any published object.
- Unknown ≠ 0:
  - an unreadable source makes an exception `unverifiable` (a `not-configured` source reads as empty);
  - a null `detectedAt` gives SLA state `unknown`, never `within`;
  - SLAs off gives `null` overdue counts, never 0.
- Defaults, verbatim from spec §5.5:
  - `remediation.enabled: true`;
  - `remediation.days: { critical: 7, high: 30, medium: 90, low: 180, secret: 7 }`;
  - `remediation.overdue.*: info`;
  - `exceptions.maxDays: 180` (1–366), `exceptions.expiringSoonDays: 14` (0–90), `exceptions.expiredIsAmber: true`.
- The demo `config/policies.yaml` opts in with `remediation.overdue.critical: red` and `remediation.overdue.high: red` and a comment saying so (D9).
- Dates: exception `created` / `expires` are `YYYY-MM-DD` (UTC). An exception expires at `expires + 1 day, 00:00:00.000Z`. `dueAt = detectedAt + days × 86 400 000 ms`. `ageDays` and `overdueDays` use `Math.floor` over 86 400 000 ms.
- `@now±N(d|h|m)` date tokens are allowed **only** in `fixtures/exceptions/exceptions.yaml` (mock source), in policy case files, and with `policy:check --allow-date-tokens`. Never in a real config.
- Snapshot `SNAPSHOT_SCHEMA_VERSION = '1.6'`, `SUPPORTED_SNAPSHOT_SCHEMA_VERSIONS = ['1.6']`. The policies `schemaVersion` stays `'1.0'`. The exceptions file `schemaVersion` is `'1.0'`.
- Every UI string is EN + IT (parity: `tests/unit/i18n.test.ts`). Every new or changed doc has an EN and an IT version. The `policy:check` CLI output is English only, like the collector logs.
- **Never run `npm run ci:build` or `npm run collect:mock`**: they overwrite `public/data` (the owner's real snapshot, git-ignored).
  - Goldens: `npm run fixtures:update` (mock provider, `GOLDEN_NOW = 2026-01-15T12:00:00.000Z`, writes only `fixtures/snapshots`).
  - Site tests build from `fixtures/snapshots` (`tests/integration/site.test.ts` sets `SNAPSHOT_DIR`).
  - A manual site build: `SNAPSHOT_DIR=fixtures/snapshots npx astro build --outDir "$(mktemp -d)"`.
  - `policy:check --snapshot` is read-only. Never point any writing command at `public/data`.
- Never use or kill port 4321. For e2e:
  - run `sed 's/4321/4377/g' playwright.config.ts > playwright.tmp.config.ts` and `npx playwright test -c playwright.tmp.config.ts`;
  - delete `playwright.tmp.config.ts` (and `.e2e-dist/` if created) afterwards and never commit them.
- Containers: podman only (none are needed here).
- Commits: Conventional Commits, author `git -c user.name=massilp -c user.email=3519719+massilp@users.noreply.github.com commit`, branch `feat/risk-governance`. Run `npx prettier --write` on touched files before each commit. Do not push until Task 8.

## Review Focus

1. **No fake changes in "What changed".** An excepted finding keeps `status: 'open'`, so v0.7.0's baseline (`openCriticalHigh`, `status === 'open'`) still sees it. Adding or expiring an exception never produces `newFindings` or `resolvedFindings`. Pinned in Task 6.
2. **Unverifiable is not stale, and not active.** A 403 or a skipped repository → `unverifiable`, `matched: null`, and the finding (if any were known) is not accepted. A `not-configured` source → `stale`. Pinned in Task 2.
3. **Inclusive UTC expiry.** `expires: '2026-01-14'` is active at `2026-01-14T23:59:59.999Z` and expired at `2026-01-15T00:00:00.000Z`. Pinned in Task 2.
4. **Withholding.** The beta-api rule `py/flask-debug` and the EXC-BETA-001 reason marker `marker-reason-b7c1` never appear in `fixtures/snapshots/**` or in the built site. Pinned in Task 4 and Task 7.
5. **Never red by default.** With the schema defaults (`overdue.*: info`), every golden status equals the pre-change status, except where findings are accepted or returned by exceptions. Only the demo opt-in turns Platform red. Pinned in Task 3 and Task 4.
6. **`policy:check --snapshot` writes nothing.** No file is created or modified anywhere. Pinned in Task 5.
7. **Exceptions do not reset the SLA.** An accepted finding is `paused` with its original `dueAt`. When the exception expires it is `overdue` at once if late. Pinned in Task 3.

---

### Task 1: Contracts: exceptions file, policies blocks, risk schemas, reason codes, JSON Schema drift test

**Files:**

- Create: `shared/model/exceptions.ts`
- Modify: `shared/model/index.ts` (export it)
- Modify: `shared/model/enums.ts`
  - six reason codes, in a `// risk governance` group: `sla-overdue`, `sla-age-unknown`, `security-exception-active`, `security-exception-expired`, `security-exception-stale`, `security-exception-unverifiable`;
  - `EnforcementLevelSchema` only if v0.8.0 did not export an equivalent.
- Modify: `shared/model/policies.ts` (the `remediation` and `exceptions` blocks, each `.strict().prefault({})`)
- Modify: `shared/model/snapshot.ts`. Add the **standalone** exported schemas below. Do not attach them to `ProjectSnapshotSchema` yet (Task 4):
  - `FindingExceptionSchema`, `FindingSlaSchema`;
  - `SecurityExceptionSchema`;
  - `RemediationSummarySchema`, `ExceptionStatesSchema`;
  - `ProjectRiskSchema`, `RunExceptionsSchema`.
- Create: `shared/model/findings.ts` with `countsAsOpen`
- Modify: `scripts/generate-json-schema.ts`:
  - export `SCHEMA_TARGETS` and `renderSchema(schema): string` (the exact text written today, with a trailing newline);
  - add `['exceptions.schema.json', ExceptionsFileSchema]` and `['policy-case.schema.json', PolicyCaseSchema]`;
  - keep the CLI behaviour when run directly.
- Create: `config/exceptions.yaml`:
  - header `# yaml-language-server: $schema=./schema/exceptions.schema.json`;
  - comments pointing to `docs/configuration.md`;
  - `schemaVersion: '1.0'`, `exceptions: []`;
  - one fully commented example entry.
- Run `npm run schema:generate`. It updates `policies.schema.json` and adds the two new files.
- Test: `tests/unit/exceptions-model.test.ts` (new), `tests/unit/config.test.ts`, `tests/unit/json-schema.test.ts` (new)

**Interfaces:**

```ts
// shared/model/exceptions.ts
export const ExceptionSourceSchema = z.enum(['code-scanning', 'dependabot', 'secret-scanning']);
export const ExceptionDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isCalendarDate, 'must be a real date (YYYY-MM-DD)');
export const ExceptionMatchSchema = z.union([
  z.object({ alert: z.number().int().min(1) }).strict(),
  z.object({ rule: z.string().min(1).max(200), tool: z.string().min(1).max(50).optional() }).strict(),
  z.object({ advisory: z.string().regex(/^(GHSA(-[A-Za-z0-9]{4}){3}|CVE-\d{4}-\d{4,})$/i) }).strict(),
]);
export const ExceptionEntrySchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,39}$/),
    repository: z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/).max(200),
    source: ExceptionSourceSchema,
    match: ExceptionMatchSchema,
    owner: z.string().regex(/^@?[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/),
    reason: z.string().trim().min(10).max(300),
    created: ExceptionDateSchema,
    expires: ExceptionDateSchema,
    ticket: z.url({ protocol: /^https$/ }).max(500).optional(),
  })
  .strict()
  .refine((e) => !('rule' in e.match) || e.source === 'code-scanning', {
    message: 'rule selectors are only valid for code-scanning',
    path: ['match'],
  })
  .refine((e) => !('advisory' in e.match) || e.source === 'dependabot', {
    message: 'advisory selectors are only valid for dependabot',
    path: ['match'],
  })
  .refine((e) => e.expires >= e.created, {
    message: 'expires must not be before created',
    path: ['expires'],
  });
export const ExceptionsFileSchema = z
  .object({ schemaVersion: z.literal('1.0'), exceptions: z.array(ExceptionEntrySchema).max(500) })
  .strict()
  .superRefine(uniqueIdsAndSelectors); // messages: 'duplicate id "<id>"', 'duplicate selector …'
export type ExceptionEntry = z.infer<typeof ExceptionEntrySchema>;
export type ExceptionsFile = z.infer<typeof ExceptionsFileSchema>;
export const ExceptionStateSchema = z.enum(['active', 'expired', 'stale', 'unverifiable']);
export const PolicyCaseSchema = /* spec §5.7, strict; kind 'security' | 'overall'; detectedAt and dates accept ISO or @now tokens */;
export function selectorKey(e: ExceptionEntry): string; // "<repo lower>|<source>|alert:15" | "|rule:<id>|<tool lower or *>" | "|advisory:<id upper>"
```

```ts
// shared/model/findings.ts
export const countsAsOpen = (f: {
  status: string;
  exception?: { state: string } | null;
}): boolean => f.status === 'open' && f.exception?.state !== 'active';
```

The snapshot schemas follow spec §5.6 field by field. `RemediationSummarySchema` is the `remediation` object, `ExceptionStatesSchema` the `exceptionStates` object, `ProjectRiskSchema` the summary `risk` object and `RunExceptionsSchema` the run `exceptions` object.

- [ ] **Step 1: Write failing tests**
  - `exceptions-model.test.ts`. Base entry: `{ id: 'EXC-0001', repository: 'example-org/project-beta-api', source: 'code-scanning', match: { alert: 3 }, owner: 'team-beta', reason: 'Accepted for the demo only.', created: '2026-01-05', expires: '2026-02-04' }`.
    - `accepts the base entry, a rule+tool selector and an @org/team owner`
    - `accepts { advisory: "GHSA-demo-0004-mono" } and { advisory: "CVE-2025-12345" } for dependabot`
    - `rejects a rule selector for dependabot and an advisory selector for code-scanning`
    - `rejects any non-alert selector for secret-scanning` (rule → error on `match`)
    - `rejects owner "alice@example.com"`
    - `rejects reason "too short" (9 chars) and a 301-char reason`
    - `rejects created "2026-02-30" and expires before created`
    - `rejects an unknown key ("severity")`
    - `rejects a file with two "EXC-0001" ids with message 'duplicate id "EXC-0001"'`
    - `rejects two entries with the same repository (different case), source and alert number`
    - `rejects an http (non-https) ticket`
    - `countsAsOpen: open/null → true; open/active → false; open/expired → true; fixed/null → false`
  - `config.test.ts`:
    - `policies defaults: remediation days 7/30/90/180/7, overdue all info, enabled true; exceptions 180/14/true`
    - `remediation.days.high: null is accepted; 0 and 3651 are rejected`
    - `exceptions.maxDays 367 is rejected`
    - `config/policies.yaml sets overdue.critical and overdue.high to red, others info`
  - `json-schema.test.ts`:
    - `every committed config/schema/*.json equals renderSchema(target)` (loop over `SCHEMA_TARGETS`; message names the file and says "run npm run schema:generate")
    - `config/exceptions.yaml parses with ExceptionsFileSchema and has 0 exceptions`

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run tests/unit/exceptions-model.test.ts tests/unit/config.test.ts tests/unit/json-schema.test.ts`. Expected: FAIL (missing module and exports).

- [ ] **Step 3: Implement** the schemas and the helper. Update `config/policies.yaml` with both blocks, commented like the existing ones. The demo opt-in comment reads `# opt-in: the schema default is info (never red overnight)`. Then run `npm run schema:generate`.

- [ ] **Step 4: Run the tests and checks**

  Same command, then `npm run typecheck && npm run validate:config`. Expected: PASS.

- [ ] **Step 5: Commit**

  `git commit -m "feat(model): exceptions contract, remediation and exceptions policies, risk schemas"`

---

### Task 2: Exceptions engine (pure) and loading

**Files:**

- Create: `collector/src/policy/exceptions.ts`
- Modify: `collector/src/config/load.ts` (`loadExceptions`, `loadConfig` returns `exceptions`)
- Modify: `scripts/validate-config.ts` (prints the exceptions line and the warnings; exits 1 on errors)
- Test: `tests/unit/exceptions.test.ts` (new), `tests/unit/config.test.ts`

**Interfaces:**

```ts
// collector/src/policy/exceptions.ts
export interface FindingKeys {
  alert: number;
  ruleId: string | null;
  tool: string | null;
  advisoryIds: string[];
}
export interface MatchableFinding {
  finding: SecurityFinding;
  keys: FindingKeys;
}
export type SourceReadability = Map<string, 'readable' | 'unreadable'>; // key "owner/repo|code-scanning"
export interface ExceptionIssue {
  level: 'error' | 'warning';
  path: string;
  message: string;
}

export function validateExceptions(
  file: ExceptionsFile,
  policies: Policies,
  catalogRepositories: ReadonlySet<string>, // lowercased owner/name
  now: Date,
): ExceptionIssue[];

export function expiryInstant(expires: string): Date; // expires + 1 day, 00:00:00.000Z

export function applyExceptions(input: {
  findings: MatchableFinding[]; // one project, all repositories
  exceptions: ExceptionEntry[]; // already filtered to the project's repositories
  readability: SourceReadability;
  publicDetail: (repository: string) => boolean; // isPublicDetail of security-model.ts
  policies: Policies;
  now: Date;
}): { findings: SecurityFinding[]; records: SecurityException[] };

export function orphanedExceptionIds(
  exceptions: ExceptionEntry[],
  catalogRepositories: ReadonlySet<string>,
): string[];
```

```ts
// collector/src/config/load.ts
export interface LoadedExceptions {
  source: 'config' | 'fixture' | 'none';
  file: ExceptionsFile | null;
  warnings: ExceptionIssue[];
}
export async function loadExceptions(
  file: string,
  ctx: { policies: Policies; catalog: Catalog; now: Date; allowDateTokens: boolean },
): Promise<LoadedExceptions>; // errors → throw ConfigError(file, issues)
export interface LoadedConfig {
  catalog: Catalog;
  policies: Policies;
  exceptions: LoadedExceptions;
}
export async function loadConfig(
  configDir?: string,
  opts?: { exceptionsFile?: string; allowDateTokens?: boolean; now?: Date },
): Promise<LoadedConfig>;
```

Rules:

- `applyExceptions` implements spec §5.2:
  - match, state order and precedence;
  - `matched` counts (null when unverifiable) and `findingIds` (max 50, sorted);
  - `expiringSoon`;
  - `records` sorted by state (`expired`, `unverifiable`, `stale`, `active`), then by id;
  - findings get `exception: { id, state: 'active' | 'expired', expires } | null`;
  - findings that match nothing keep `exception: null`.
- Token resolution: `/^@now([+-]\d+[mhd])?$/` → `resolveRelativeTime(token, now).slice(0, 10)`. It runs only on `created` / `expires`, before parsing, when `allowDateTokens`.

- [ ] **Step 1: Write failing tests** (`exceptions.test.ts`, `NOW = 2026-01-15T12:00:00.000Z` from `tests/helpers/factories.ts`)
  - Validation:
    - `created 2026-01-01 → expires 2026-06-30 (180 d) has no issue; → 2026-07-01 (181 d) is an error "exceeds exceptions.maxDays (180)"`
    - `ticket https://jira.example.com/browse/SEC-1 is an error with allowedLinkHosts [github.com] and accepted with [github.com, jira.example.com]`
    - `repository example-org/legacy-tool not in the catalog → warning containing "orphaned"`
    - `expires 2026-01-14 → warning "expired"; expires 2026-01-28 → warning "expires in 13 days"; expires 2026-01-29 → no expiry warning`
    - `created 2026-01-16 → warning "created in the future"`
  - States:
    - `expiryInstant("2026-01-14") is 2026-01-15T00:00:00.000Z`
    - `active at 2026-01-14T23:59:59.999Z and expired at 2026-01-15T00:00:00.000Z`
    - `expired wins over unverifiable` (expired entry on an unreadable source → `expired`)
    - `dependabot unreadable (403) → unverifiable, matched null, the finding keeps exception null`
    - `secret-scanning not-configured → stale, matched 0`
    - `alert 5 when alert 5 is fixed → stale`
    - `rule js/path-injection matches code-scanning #5 (any tool); with tool "Semgrep" it does not match a CodeQL alert`
    - `advisory ghsa-demo-0004-mono (lower case) matches GHSA-demo-0004-mono`
  - Precedence and counts:
    - `alert exception and rule exception both active on #4 → finding.exception.id is the alert one; both matched 1`
    - `expired alert exception + active rule exception → finding carries the active rule one`
    - `two active rule exceptions with expires 2026-02-01 and 2026-03-01 → the 2026-03-01 one`
  - Flags and publication:
    - `expiringSoon: expires 2026-01-28 true, 2026-01-29 false (expiringSoonDays 14)`
    - `private repo + audience public → selector.value null, reason null; alert selector value "15" kept; audience restricted → both kept`
    - `reason containing a CANARIES value is scrubbed (record.reason does not contain it)`
    - `ticket on github.com → ticketUrl kept; owner "@example-org/team-beta" kept`
    - `orphanedExceptionIds returns ["EXC-LEGACY-001"] for a repository outside the catalog`
  - `config.test.ts`:
    - `loadExceptions: missing file → source none, file null`
    - `allowDateTokens: "@now+20d" → "2026-02-04", "@now-10d" → "2026-01-05"`
    - `without allowDateTokens "@now+20d" throws ConfigError mentioning created/expires`
    - `an error issue throws ConfigError listing "exceptions[0] (EXC-0001): …"`
    - `validate-config prints "✔ config/exceptions.yaml: 0 exception(s)"` (spawn `tsx scripts/validate-config.ts config`, assert stdout)

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run tests/unit/exceptions.test.ts tests/unit/config.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** `exceptions.ts` and the loader. `loadConfig` loads `<configDir>/exceptions.yaml` by default with `allowDateTokens: false`. `now` defaults to `new Date()`, used only for warnings.

- [ ] **Step 4: Run the tests and checks**

  Same command, then `npm run typecheck && npm run validate:config`. Expected: PASS.

- [ ] **Step 5: Commit**

  `git commit -m "feat(collector): security exceptions matching, states and loading"`

---

### Task 3: Remediation SLAs (pure) and Security reasons

**Files:**

- Create: `collector/src/policy/sla.ts`
- Modify: `collector/src/evaluators/health.ts` (`SecurityInputs`, `evaluateSecurity`)
- Test: `tests/unit/sla.test.ts` (new), `tests/unit/evaluators.test.ts`

**Interfaces:**

```ts
// collector/src/policy/sla.ts
export type SlaClass = 'critical' | 'high' | 'medium' | 'low' | 'secret';
export function slaClassOf(f: SecurityFinding): SlaClass | null;
export function applySla(
  findings: SecurityFinding[],
  policies: Policies,
  now: Date,
  anyAlertSourceReadable: boolean,
): { findings: SecurityFinding[]; remediation: RemediationSummary };
```

```ts
// collector/src/evaluators/health.ts
export interface SecurityInputs {
  /* existing fields */ remediation: RemediationSummary;
  exceptions: SecurityException[];
  acceptedCount: number; // findings with exception.state === 'active'
}
```

- `applySla` implements the spec §5.3 table for findings with `status === 'open'` from the three GitHub sources. Every other finding gets `sla: null`.
- `remediation.overdue` counts only `countsAsOpen` findings in state `overdue`. A class is `null` when SLAs are off or `!anyAlertSourceReadable`.
- `oldestOverdueSince` is the minimum `dueAt` among overdue findings.
- `evaluateSecurity` adds the reasons of spec §5.4, after the severity / secret / control reasons and before `coverage-incomplete`:
  - `ids` params are comma-joined, at most 10, then `+N`;
  - the grey early return is unchanged.

- [ ] **Step 1: Write failing tests** (`NOW = 2026-01-15T12:00:00.000Z`, default policies unless stated)
  - `sla.test.ts`:
    - `high detected 2025-12-15T18:00:00.000Z → overdue, days 30, dueAt 2026-01-14T18:00:00.000Z, ageDays 30, overdueDays 0`
    - `critical detected 2026-01-12T12:00:00.000Z → within, dueAt 2026-01-19T12:00:00.000Z, ageDays 3, overdueDays null`
    - `high detected 2025-12-01T12:00:00.000Z with exception active → paused, dueAt 2025-12-31T12:00:00.000Z, ageDays 45, overdueDays null` (the clock is not reset)
    - `same finding with exception expired → overdue, overdueDays 15`
    - `secret-scanning, severity unknown, detectedAt 2026-01-01T12:00:00.000Z → class secret, overdue (14 d > 7 d)`
    - `secret-scanning detectedAt null → unknown, remediation.slaUnknown 1`
    - `informational → none; ageDays still set`
    - `remediation.days.medium null → medium finding none`
    - `status fixed → sla null`
    - `remediation.enabled false → every sla null; overdue { critical: null, high: null, medium: null, low: null, secret: null }; slaUnknown 0`
    - `anyAlertSourceReadable false → overdue all null`
    - `remediation.overdue counts exclude paused findings; oldestOverdueSince is the earliest dueAt`
    - `slaDays echoes { critical: 7, high: 30, medium: 90, low: 180, secret: 7 }`
  - `evaluators.test.ts` (Security):
    - `one overdue high, defaults → amber; reasons include open-high-alerts (amber) and sla-overdue (info, severity high, count 1, days 30)`
    - `same with remediation.overdue.high red → red`
    - `overdue medium with overdue.medium amber stays amber and sla-overdue is amber`
    - `one accepted high only → green; reasons security-exception-active {count:1} and no-open-alerts; no open-high-alerts`
    - `expired exception record → security-exception-expired amber {count:1, ids:"EXC-PLAT-001"}; with expiredIsAmber false → info and status green when nothing else`
    - `stale and unverifiable records → info reasons with ids; status unchanged`
    - `12 expired records → ids param lists 10 ids then "+2"`
    - `anySourceReadable false → grey with only security-data-unavailable, even with expired records`
    - `sla-age-unknown {count:1} when slaUnknown 1`

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run tests/unit/sla.test.ts tests/unit/evaluators.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** `sla.ts` and the `evaluateSecurity` changes. Update existing `evaluateSecurity` call sites and test factories so they pass `remediation` (from a small factory `remediationSummary()` in `tests/helpers/factories.ts`), `exceptions: []` and `acceptedCount: 0`.

- [ ] **Step 4: Run the tests and checks**

  Same command, then `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

  `git commit -m "feat(collector): remediation SLAs and risk reasons in Security"`

---

### Task 4: Wire collection, snapshot 1.6, run metadata, CLI flag and mock fixtures

**Files:**

- Modify: `shared/model/enums.ts` (`SNAPSHOT_SCHEMA_VERSION = '1.6'`, `SUPPORTED = ['1.6']`, comment `1.6: security exceptions, remediation SLAs`)
- Modify: `shared/model/snapshot.ts`. Attach:
  - `SecurityFinding.exception` / `.sla`;
  - `SecuritySummary.acceptedCounts` / `.remediation` / `.exceptionStates`;
  - `ProjectSnapshot.securityExceptions`;
  - `ProjectSummary.risk`;
  - `RunMetadata.exceptions`.
- Modify: `collector/src/normalizers/security-model.ts`:
  - `toFindings` returns `{ findings: MatchableFinding[]; withheld }`, with keys from the DTO **before** withholding;
  - `countOpen` uses `countsAsOpen`;
  - add `countAccepted`.
- Modify: `collector/src/build-snapshot.ts`. `buildProjectSnapshot(raw, policies, now, exceptions: ExceptionEntry[] = [])`:
  - filter the exceptions to the project's repositories;
  - build `SourceReadability` from the `RepoData` results (`not-configured` = readable);
  - then `applyExceptions` → `applySla` → `evaluateSecurity`;
  - `openSecretAlerts`, `byCategory` and `bySource` use `countsAsOpen`;
  - fill `acceptedCounts`, `remediation`, `exceptionStates`, `securityExceptions` and `summary.risk`.
- Modify: `collector/src/run.ts`:
  - `RunOptions.exceptions?: LoadedExceptions` (default `{ source: 'none', file: null, warnings: [] }`);
  - pass the entries to every project;
  - `index.run.exceptions = { source, total, orphaned }`.
- Modify: `collector/src/writers/write-snapshots.ts`. `buildReport` / `reportMarkdown` add the line `Exceptions: {total} loaded ({source}) · {active} active · {expired} expired · {stale} stale · {unverifiable} unverifiable · {orphaned} orphaned`, with counts de-duplicated by exception id across projects. When `source` is `none`: `Exceptions: none`.
- Modify: `collector/src/index.ts`. Add `--exceptions <file>`:
  - default `fixtures/exceptions/exceptions.yaml` with `allowDateTokens: true` for mock;
  - default `<config>/exceptions.yaml` with `allowDateTokens: false` for github;
  - print loader warnings as `⚠ …` lines.
- Modify: `scripts/update-golden-snapshots.ts`: load `fixtures/exceptions/exceptions.yaml` with `allowDateTokens: true` and the golden clock, and pass it to `runCollection`.
- Create: `fixtures/exceptions/exceptions.yaml`, the seven entries of spec §5.12, exactly:

  | id               | repository                           | source          | match                                    | owner           | created     | expires    | ticket                                                            |
  | ---------------- | ------------------------------------ | --------------- | ---------------------------------------- | --------------- | ----------- | ---------- | ----------------------------------------------------------------- |
  | `EXC-ALPHA-001`  | `example-org/project-alpha-backend`  | code-scanning   | `{ alert: 15 }`                          | `team-alpha`    | `@now-10d`  | `@now+20d` | `https://github.com/example-org/project-alpha-backend/issues/101` |
  | `EXC-ALPHA-002`  | `example-org/project-alpha-frontend` | dependabot      | `{ alert: 5 }`                           | `team-alpha`    | `@now-50d`  | `@now+10d` | none                                                              |
  | `EXC-BETA-001`   | `example-org/project-beta-api`       | code-scanning   | `{ rule: py/flask-debug, tool: CodeQL }` | `team-beta`     | `@now-15d`  | `@now+60d` | `https://github.com/example-org/project-beta-api/issues/12`       |
  | `EXC-BETA-002`   | `example-org/project-beta-web`       | secret-scanning | `{ alert: 2 }`                           | `team-beta`     | `@now-5d`   | `@now+25d` | none                                                              |
  | `EXC-PLAT-001`   | `example-org/platform-mono`          | code-scanning   | `{ rule: js/path-injection }`            | `team-platform` | `@now-60d`  | `@now-1d`  | `https://github.com/example-org/platform-mono/issues/31`          |
  | `EXC-PLAT-002`   | `example-org/platform-mono`          | dependabot      | `{ advisory: GHSA-demo-0004-mono }`      | `team-platform` | `@now-170d` | `@now+7d`  | none                                                              |
  | `EXC-LEGACY-001` | `example-org/legacy-tool`            | dependabot      | `{ alert: 3 }`                           | `team-platform` | `@now-30d`  | `@now+30d` | none                                                              |
  - Reasons are synthetic sentences of 10–300 characters.
  - EXC-BETA-001's reason **must** contain the marker `marker-reason-b7c1`.

- Modify: `fixtures/github/example-org__project-alpha-backend.json`: code scanning #15, `java/xxe`, `ruleSeverity: error`, `securitySeverityLevel: high`, `ruleDescription: "Resolving XML external entity in user-controlled data"`, CodeQL, `createdAt` / `updatedAt` `@now-45d`, path `src/main/java/Xml.java`.
- Modify: `fixtures/github/example-org__project-beta-api.json`: code scanning #7, `py/flask-debug`, `ruleSeverity: warning`, `securitySeverityLevel: medium`, `ruleDescription: "Flask app is run in debug mode"`, CodeQL, `@now-20d`.
- Modify: `fixtures/github/example-org__platform-mono.json`: code scanning #2, `js/prototype-pollution-utility`, `ruleSeverity: warning`, `securitySeverityLevel: high`, `ruleDescription: "Prototype-polluting function"`, CodeQL, `createdAt` / `updatedAt` `@now-738h`, path `packages/utils/merge.ts`.
- Then run `npm run fixtures:update` and `npm run validate:snapshots`.
- Test: `tests/integration/collector.test.ts`, `tests/unit/normalizers.test.ts`, `tests/integration/site.test.ts` (version literal only)

- [ ] **Step 1: Write failing tests**
  - `normalizers.test.ts`:
    - `toFindings keeps keys.ruleId "py/flask-debug" while finding.ruleId is null for a private repo under public audience`
    - `countOpen ignores findings with exception.state active`
  - `collector.test.ts` (mock run at `GOLDEN_NOW`, fixture exceptions loaded as in `update-golden-snapshots.ts`):
    - `schemaVersion is "1.6" in index, projects and catalog`
    - `index.run.exceptions equals { source: "fixture", total: 7, orphaned: ["EXC-LEGACY-001"] }`
    - Alpha:
      - `securityHealth.status amber (unchanged)`;
      - `openCounts.high 1`;
      - `acceptedCounts.high 1`;
      - `remediation.overdue.high 0`;
      - `exceptionStates { active: 1, expired: 0, stale: 1, unverifiable: 0, expiringSoon: 0 }`;
      - `finding #15 sla.state "paused", sla.dueAt "2025-12-31T12:00:00.000Z"`.
    - Beta:
      - `securityHealth.status red (unchanged)`;
      - `acceptedCounts.medium 1`;
      - `EXC-BETA-001 selector { kind: "rule", value: null, tool: null }, reason null, ticketUrl null, state active, matched 1`;
      - `EXC-BETA-002 state unverifiable, matched null`;
      - `finding #3 sla { state: "within", days: 7, dueAt: "2026-01-19T12:00:00.000Z", ageDays: 3 }`.
    - Platform:
      - `securityHealth.status red`, `overallHealth.status red`, `score.value ≤ 49`;
      - `openCounts { critical: 0, high: 2, medium: 1, low: 0 }`;
      - `remediation.overdue.high 1`, `oldestOverdueSince "2026-01-14T18:00:00.000Z"`;
      - `finding #2 sla { state: "overdue", days: 30, dueAt: "2026-01-14T18:00:00.000Z", ageDays: 30, overdueDays: 0 }`;
      - `finding #5 exception { id: "EXC-PLAT-001", state: "expired", expires: "2026-01-14" }`;
      - `EXC-PLAT-002 state active, expiringSoon true, matched 1`;
      - `reasons contain sla-overdue (red), security-exception-expired (amber), security-exception-active (info)`.
    - Gamma:
      - `securityExceptions []`;
      - `summary.risk { overdue: null, overdueCriticalHigh: null, accepted: null, exceptionIssues: 0 }`;
      - `status grey (unchanged)`.
    - Summaries:
      - `alpha { overdue: 0, overdueCriticalHigh: 0, accepted: 1, exceptionIssues: 1 }`;
      - `beta { 0, 0, 1, 1 }`;
      - `platform { 1, 1, 1, 1 }`.
    - `collection-report.md contains "Exceptions: 7 loaded (fixture) · 3 active · 1 expired · 1 stale · 1 unverifiable · 1 orphaned"`
    - `"py/flask-debug" and "marker-reason-b7c1" appear nowhere in the serialised output`
    - `with the schema-default policies (overdue all info) Platform securityHealth.status is amber` (Review Focus 5)
    - `with no exceptions (source none) and default policies, every project's securityHealth.status equals the run with fixture exceptions except where accepted findings changed counts` (assert Alpha, Beta, Gamma equal; Platform amber in both)
    - `the github source never reads fixtures/exceptions` (index.ts default resolution unit: `resolveExceptionsPath({ source: "github", config: "cfg" })` → `cfg/exceptions.yaml`, `allowDateTokens: false`)

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run tests/unit/normalizers.test.ts tests/integration/collector.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the wiring, the fixtures and the flag. Regenerate the schemas (`npm run schema:generate`) and the goldens (`npm run fixtures:update`). **Do not** run `collect:mock`.

- [ ] **Step 4: Run the full check**

  Run: `npm run lint && npm run typecheck && npm test && npm run validate:snapshots`. Expected: all PASS.

- [ ] **Step 5: Commit**

  `git commit -m "feat(collector): exceptions and SLAs in snapshots (schema 1.6) with mock fixtures"`

---

### Task 5: `npm run policy:check`, decision cases, CI job

**Files:**

- Create: `collector/src/policy/explain.ts`. A map from every Security reason code to the policy key that sets its level. Examples:
  - `open-critical-alerts` → `security.redOnSeverities`;
  - `open-high-alerts` → `security.redOnSeverities / security.amberOnSeverities`;
  - `sla-overdue` → `remediation.overdue.<severity>`;
  - `security-exception-expired` → `exceptions.expiredIsAmber`;
  - informative reasons → `(informative)`.
- Create: `collector/src/policy/check.ts`, with `runPolicyCheck(opts: PolicyCheckOptions): Promise<{ exitCode: 0 | 1 | 2; lines: string[] }>`.
- Create: `scripts/policy-check.ts`. It parses flags with `node:util` `parseArgs` (spec §5.7, plus `--allow-date-tokens`), prints the lines and exits with the code. An unknown flag gives exit 2.
- Modify: `package.json`: `"policy:check": "tsx scripts/policy-check.ts"`.
- Create: `config/policy-cases/*.yaml`, eight cases matching the demo policies, all with `now: '2026-01-15T12:00:00Z'`:

  | File                                    | Input                                                                                                                  | Expect                                                                                         |
  | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
  | `critical-within-sla.yaml`              | critical `@now-3d`                                                                                                     | red; reasons `[open-critical-alerts]`; absent `[sla-overdue]`                                  |
  | `high-within-sla.yaml`                  | high `@now-29d`                                                                                                        | amber; `[open-high-alerts]`; absent `[sla-overdue]`                                            |
  | `high-overdue-escalates.yaml`           | high `@now-31d`                                                                                                        | red; `[open-high-alerts, sla-overdue]`                                                         |
  | `medium-overdue-informative.yaml`       | medium `@now-91d`                                                                                                      | amber; `[open-medium-low-alerts, sla-overdue]`                                                 |
  | `exception-accepts-overdue-high.yaml`   | high `@now-45d` (`…#code-scanning#15`) + active exception `{ alert: 15 }` `@now-10d` → `@now+20d`                      | green; `[security-exception-active, no-open-alerts]`; absent `[open-high-alerts, sla-overdue]` |
  | `expired-exception-returns.yaml`        | medium `@now-4d` with `ruleId: js/path-injection` + exception `{ rule: js/path-injection }` `@now-60d` → `@now-1d`     | amber; `[open-medium-low-alerts, security-exception-expired]`                                  |
  | `unverifiable-exception.yaml`           | no findings; secret-scanning exception `{ alert: 2 }`; `unreadable: ["example-org/project-beta-web\|secret-scanning"]` | amber; `[security-data-unavailable, security-exception-unverifiable]`                          |
  | `overall-security-red-is-critical.yaml` | `kind: overall`; delivery, version, coverage, governance green; security red; quality grey                             | red; score 49                                                                                  |

- Modify: `.github/workflows/ci.yml`: the `policy-check` job of spec §5.10, and the header comment line `policy-check    — npm run policy:check (policies, exceptions, decision cases)`.
- Modify: `.github/CODEOWNERS`: add `/config/exceptions.yaml @massilp` under the comment `# risk acceptances: owner review`.
- Test: `tests/unit/policy-check.test.ts` (new)

`PolicyCheckOptions`:

```ts
{
  configDir: string;
  exceptionsFile?: string;
  casesDir?: string;
  snapshotDir?: string;
  now: Date;
  failOnWarnings?: boolean;
  allowDateTokens?: boolean;
}
```

Output contract (tests assert these exact fragments):

- `✔ <dir>/policies.yaml: schema 1.0`
- `✔ <file>: N exception(s)`
- `⚠ <file>: exceptions[i] (<id>): <message>`
- `✖ <file>: exceptions[i] (<id>): <message>`
- `✔ <case name> — Security <status>` or `✔ <case name> — Overall <status>`
- `✖ <case name> — expected <s1>, got <s2>`
- one indented line per reason: `<level padded to 5> <code> <params> ← <policy key>`
- snapshot mode: `unchanged: <project>`, or `would change: <project> security <a> → <b>` / `overall <a> → <b>`, and `not evaluable from this snapshot (details withheld): <exception id>`
- the last line: `Summary: <p> passed, <f> failed, <w> warning(s)`

- [ ] **Step 1: Write failing tests** (`policy-check.test.ts`; work in `mkdtemp` copies of `config/` where a test changes files)
  - `the repository config at 2026-01-15T12:00:00Z → exitCode 0 and the last line "Summary: 8 passed, 0 failed, 0 warning(s)"`
  - `the high-overdue-escalates case prints "red   sla-overdue" with "← remediation.overdue.high"`
  - `a copy where high-within-sla expects green → exitCode 1 and a line "✖ … — expected green, got amber"`
  - `an exceptions file with a 181-day span → exitCode 1 and a line containing "exceeds exceptions.maxDays (180)"`
  - `an exceptions file with only an expiring-soon entry → exitCode 0; with failOnWarnings → 1`
  - `a config copy without policy-cases → a warning "no decision cases" and exitCode 0`
  - Snapshot mode:
    - `--snapshot fixtures/snapshots, --exceptions fixtures/exceptions/exceptions.yaml, --allow-date-tokens, now GOLDEN_NOW → "unchanged: platform", "unchanged: project-alpha", "unchanged: project-gamma", and "not evaluable from this snapshot (details withheld): EXC-BETA-001"`
    - `same with a policies copy where remediation.overdue.high is info → "would change: platform security red → amber" and "overall red → amber"`
    - `snapshot mode writes nothing`: copy `fixtures/snapshots` to a temp dir, record every path, size and mtime under the temp root, run, and assert they are identical and no file was added.
    - `a snapshot with schemaVersion "1.4" → exitCode 1 with "unsupported snapshot schemaVersion"`
  - `an unknown flag (spawned script) → exit 2`

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run tests/unit/policy-check.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the check, the script, the cases and the workflow change. Run `actionlint .github/workflows/ci.yml` if it is installed (CI runs it anyway).

- [ ] **Step 4: Run the checks**

  Run: `npm run policy:check && npm run lint && npm run typecheck && npm test`. Expected: all PASS, and `policy:check` prints `Summary: 8 passed, 0 failed, 0 warning(s)`.

- [ ] **Step 5: Commit**

  `git commit -m "feat(policy): policy:check with decision cases, snapshot what-if and CI job"`

---

### Task 6: History 1.2, "What changed" risk lists, CSV columns (v0.7.0 integration)

Skip only if `shared/model/history.ts` does not exist on the rebased branch, and record the skip in the PR body.

**Files (names as introduced by v0.7.0 / v0.8.0; adapt):**

- Modify: `shared/model/history.ts`:
  - `HISTORY_SCHEMA_VERSION = '1.2'`, `SUPPORTED_HISTORY_SCHEMA_VERSIONS = ['1.0','1.1','1.2']`;
  - `HistoryProjectPointSchema.risk: z.object({ overdue: nullableCount, accepted: nullableCount }).strict().optional()`;
  - `ChangesFileSchema` project fields `newlyOverdue` (max 50, optional) and `expiredExceptions` (max 50, optional), and `totals.newlyOverdue` / `totals.expiredExceptions` (optional). 0.9.0 always writes them.
- Modify: `collector/src/history/append.ts` (or the point builder): `risk` comes from `ProjectSummary.risk`.
- Modify: `collector/src/history/changes.ts`:
  - `newlyOverdue` and `expiredExceptions` per spec §5.8, only when `basis.state === 'compared'`;
  - sorted by `dueAt` (then id) and by expiry (then id).
- **Do not** change `collector/src/history/baseline.ts`: it must keep `status === 'open'` (Review Focus 1). Add a code comment there pointing to this rule.
- Modify: the "What changed" page (`src/pages/[...lang]/changes.astro`): two sub-lists per project, "Newly overdue" / "Scaduti da poco" and "Exceptions expired" / "Eccezioni scadute". Also update the project trend table ("Show history as a table"), which gains an "Overdue" column showing "not tracked" for entries without `risk`.
- Modify: `src/lib/exports.ts`. Columns are appended at the end:
  - `portfolio.csv`: `overdue`, `overdue_critical_high`, `accepted`, `exception_issues`;
  - `findings-summary.csv`: `overdue`, `accepted` per component (counts of that component's findings).
- Modify: the history fixture used by `fixtures:update` (`fixtures/history/history.json`):
  - its latest baseline adds `example-org/project-alpha-backend#code-scanning#15` (high, component `backend`) and `example-org/platform-mono#code-scanning#2` (high, component per the monorepo path mapping);
  - its latest Platform point has `open.high: 2`;
  - every entry keeps no `risk` (older collector), so the "not tracked" path is visible.
- Then run `npm run fixtures:update`.
- Test: the v0.7.0 history and changes unit tests (`tests/unit/history.test.ts`, `tests/unit/history-model.test.ts`), `tests/unit/csv.test.ts`, `tests/integration/collector.test.ts`, `tests/integration/site.test.ts`

- [ ] **Step 1: Write failing tests**
  - `history-model.test.ts`:
    - `a 1.0 file and a 1.1 file parse and their points have no risk`
    - `a 1.2 point with risk { overdue: 1, accepted: 1 } round-trips; risk { overdue: -1 } is rejected`
  - `history.test.ts`, with previous `collectedAt` 2026-01-14T12:00:00.000Z and now 2026-01-15T12:00:00.000Z:
    - `a counted high with dueAt 2026-01-14T18:00:00.000Z is listed in newlyOverdue`
    - `dueAt 2026-01-14T12:00:00.000Z (equal to previous) is not listed; dueAt 2026-01-15T12:00:00.000Z is listed`
    - `a paused (accepted) overdue-by-date finding is not listed; a medium is not listed`
    - `an exception with expires "2026-01-14" (instant 2026-01-15T00:00:00.000Z) is listed in expiredExceptions; "2026-01-13" is not`
    - `basis restore-failed → newlyOverdue [] and expiredExceptions [] for every project, totals 0`
    - `an alert open in the baseline that is now accepted is not in resolvedFindings` (Review Focus 1)
    - `an alert new on GitHub and immediately accepted by a rule exception is listed in newFindings` (it is new on GitHub)
  - `collector.test.ts` (golden run):
    - `changes.json totals.newlyOverdue 1 and totals.expiredExceptions 1`
    - `platform statusChanges include { dimension: "overall", from: "amber", to: "red" } and { dimension: "security", from: "amber", to: "red" }`
    - `platform newlyOverdue[0].id "example-org/platform-mono#code-scanning#2", dueAt "2026-01-14T18:00:00.000Z"; expiredExceptions [{ id: "EXC-PLAT-001", repository: "example-org/platform-mono", expires: "2026-01-14" }]`
    - `no project has newFindings for alpha-backend#15 or platform-mono#2`
    - `history.json schemaVersion "1.2", and the latest entry's platform point has risk { overdue: 1, accepted: 1 }`
  - `csv.test.ts` / `site.test.ts`:
    - `portfolio.csv header ends with "overdue,overdue_critical_high,accepted,exception_issues"`
    - `the platform row ends with "1,1,1,1"; the project-gamma row ends with "unknown,unknown,unknown,0"`
    - `findings-summary.csv header ends with "overdue,accepted"`
    - `/changes/ shows "Newly overdue" and "Exceptions expired" (EN) and "Scaduti da poco" and "Eccezioni scadute" (IT) in the Platform card`

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run tests/unit tests/integration`. Expected: FAIL.

- [ ] **Step 3: Implement**, then run `npm run fixtures:update`.

- [ ] **Step 4: Run the full check**

  Run: `npm run lint && npm run typecheck && npm test && npm run validate:snapshots`. Expected: PASS.

- [ ] **Step 5: Commit**

  `git commit -m "feat(history): risk counts, newly overdue and expired exceptions in What changed and CSV"`

---

### Task 7: Site: risk panel, exceptions table, remediation queue, Data quality, How to read

**Step 0 (design-first, standing owner rule):**

- Draw the project-page risk panel, the exceptions table, the remediation queue and the Data quality card as artboards in the Claude Design canvas with Warm Graphite tokens, before coding.
- Use `ui-ux-pro-max` and `color-expert` for legibility. The pills need text + icon, never colour alone.
- The owner reviews after delivery, so this does not block.
- No artifact link goes into the repository.

**Files:**

- Modify: `src/i18n/en.ts`, `src/i18n/it.ts`. Main values:

  | Key                                | EN                                                                                                                         | IT                                                                                                                           |
  | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
  | `risk.overduePill`                 | `Overdue`                                                                                                                  | `In ritardo`                                                                                                                 |
  | `risk.acceptedPill`                | `Accepted`                                                                                                                 | `Accettato`                                                                                                                  |
  | `risk.overdueSince`                | `Age {age} d · SLA {sla} d · overdue since {date}`                                                                         | `Età {age} g · SLA {sla} g · in ritardo dal {date}`                                                                          |
  | `risk.overdueLessThanDay`          | `overdue for less than a day`                                                                                              | `in ritardo da meno di un giorno`                                                                                            |
  | `risk.dueIn`                       | `due in {n} d`                                                                                                             | `scade tra {n} g`                                                                                                            |
  | `risk.acceptedUntil`               | `Accepted until {date} ({id})`                                                                                             | `Accettato fino al {date} ({id})`                                                                                            |
  | `risk.ageUnknown`                  | `age unknown`                                                                                                              | `età sconosciuta`                                                                                                            |
  | `risk.remediationLine`             | `Overdue: {list} · oldest since {date}`                                                                                    | `In ritardo: {list} · il più vecchio dal {date}`                                                                             |
  | `risk.nothingOverdue`              | `Nothing overdue`                                                                                                          | `Niente in ritardo`                                                                                                          |
  | `risk.slaOff`                      | `Remediation SLAs are off in the policies.`                                                                                | `Gli SLA di remediation sono spenti nelle policy.`                                                                           |
  | `risk.acceptedHeading`             | `Accepted by exception`                                                                                                    | `Accettati con eccezione`                                                                                                    |
  | `risk.exceptionsTitle`             | `Exceptions`                                                                                                               | `Eccezioni`                                                                                                                  |
  | `risk.exceptionsLegend`            | `Accepted findings do not count towards the status until the exception expires. The hub never dismisses alerts on GitHub.` | `I finding accettati non contano per lo stato finché l'eccezione non scade. L'hub non fa mai dismiss degli alert su GitHub.` |
  | `risk.state.active`                | `Active until {date}`                                                                                                      | `Attiva fino al {date}`                                                                                                      |
  | `risk.state.expiring`              | `Expiring {date}`                                                                                                          | `In scadenza il {date}`                                                                                                      |
  | `risk.state.expired`               | `Expired on {date}`                                                                                                        | `Scaduta il {date}`                                                                                                          |
  | `risk.state.stale`                 | `Stale: matches nothing`                                                                                                   | `Obsoleta: non corrisponde a nulla`                                                                                          |
  | `risk.state.unverifiable`          | `Not verifiable: source not readable`                                                                                      | `Non verificabile: fonte non leggibile`                                                                                      |
  | `risk.queueTitle`                  | `Remediation queue`                                                                                                        | `Coda di remediation`                                                                                                        |
  | `risk.queueMore`                   | `and {n} more on the project pages`                                                                                        | `e altri {n} nelle pagine dei progetti`                                                                                      |
  | `risk.cardLine`                    | `{overdue} overdue · {accepted} accepted`                                                                                  | `{overdue} in ritardo · {accepted} accettati`                                                                                |
  | `dataQualityPage.exceptions`       | `Security exceptions`                                                                                                      | `Eccezioni di sicurezza`                                                                                                     |
  | `dataQualityPage.exceptionsOrphan` | `Repository not in the catalog`                                                                                            | `Repository non nel catalogo`                                                                                                |
  | `howToRead.riskTitle`              | `Exceptions and remediation SLAs`                                                                                          | `Eccezioni e SLA di remediation`                                                                                             |
  - Also: `reasons.*` (singular and plural maps) for the six new codes, for example `sla-overdue` "{count} {severity} alert(s) past the {days}-day SLA" / "{count} alert {severity} oltre lo SLA di {days} giorni"; the Data quality list labels (expired / stale / unverifiable / orphaned / expiring soon); the queue column headers; the How to read body; and the Security-bar tooltip suffix.

- Create: `src/components/RiskPanel.astro`, with props `{ s: ProjectSnapshot; i18n }`. It holds the remediation line, the accepted sub-list and the `#exceptions` table (spec §5.11). The table is a real `<table>` with `<th scope="col">`.
- Create: `src/components/SlaMeta.astro`, with props `{ finding: SecurityFinding; i18n }`. It renders the meta line, the pill and `data-sla-state` (used by the project page and the queue).
- Modify: `src/pages/[...lang]/projects/[id].astro`:
  - the `listed` filter uses `countsAsOpen`, and accepted critical/high go to the RiskPanel sub-list;
  - each alert row gets `<SlaMeta>` and `data-finding-id`;
  - `<RiskPanel>` goes inside the `#security` fold;
  - the Security dimension card shows `risk.cardLine` when non-zero.
- Modify: `src/pages/[...lang]/security.astro`:
  - totals gain `data-total="overdue"` and `data-total="accepted"`, each with `data-value`;
  - each card gets the risk line;
  - criticalFindings use `countsAsOpen`;
  - the new `<details class="sec-queue disclosure" open>` with the queue (order and cap per spec §5.11).
- Modify: `src/pages/[...lang]/data-quality.astro`: the `h-exceptions` card.
- Modify: `src/pages/[...lang]/how-to-read.astro`: the `#risk` section, with the SLA table from `loadSitePolicies()`.
- Modify: `src/components/DimensionBars.astro`: the Security tooltip suffix.
- Test: `tests/integration/site.test.ts`, `tests/e2e/smoke.spec.ts`, `tests/unit/i18n.test.ts` (automatic parity)

- [ ] **Step 1: Write failing tests**
  - `site.test.ts` (built from `fixtures/snapshots`):
    - `platform page: [data-finding-id="example-org/platform-mono#code-scanning#2"] has data-sla-state="overdue" and contains "Overdue" and "overdue for less than a day"`
    - `beta page: [data-finding-id="example-org/project-beta-api#code-scanning#3"] has data-sla-state="within" and "due in 4 d"`
    - `alpha page: #exceptions has 2 body rows; EXC-ALPHA-001 row contains "Active until"; EXC-ALPHA-002 row contains "Stale: matches nothing"`
    - `alpha page lists #15 under "Accepted by exception" with "Accepted until"`
    - `beta page: EXC-BETA-001 row shows the withheld text; "py/flask-debug" and "marker-reason-b7c1" appear in no file under dist/`
    - `security page: the .sec-queue rows' data-finding-id in order are platform-mono#code-scanning#2, project-beta-api#code-scanning#3, platform-mono#code-scanning#4, project-alpha-frontend#dependabot#7, project-beta-web#dependabot#11, project-alpha-backend#code-scanning#15 (6 rows)`
    - `security page: [data-total="overdue"] data-value "1"; [data-total="accepted"] data-value "3"`
    - `data-quality: #h-exceptions card lists EXC-PLAT-001 (expired), EXC-ALPHA-002 (stale), EXC-BETA-002 (unverifiable), EXC-LEGACY-001 (orphaned), EXC-PLAT-002 (expiring soon)`
    - `how-to-read: #risk with "Exceptions and remediation SLAs" (EN) / "Eccezioni e SLA di remediation" (IT); the SLA table shows 30 for high`
    - `IT platform page contains "In ritardo"; IT alpha page contains "Accettato fino al"`
    - `every Overdue / Accepted pill has visible text` (no pill whose text content is empty)
  - `smoke.spec.ts` (desktop and Pixel 7):
    - `platform project page: open #security, the overdue row is visible`
    - `security page at 412 px: the remediation queue causes no body horizontal scroll`

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run tests/integration/site.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the components, the pages and the strings, following `DESIGN.md` (Warm Graphite). Then run the `impeccable` / `web-design-guidelines` review on the new sections and fix any material findings.

- [ ] **Step 4: Run the full check**

  ```
  npm run lint && npm run typecheck && npm test
  sed 's/4321/4377/g' playwright.config.ts > playwright.tmp.config.ts
  npx playwright test -c playwright.tmp.config.ts
  rm -rf playwright.tmp.config.ts .e2e-dist
  ```

  Expected: all PASS. **Do not** run `npm run ci:build`.

- [ ] **Step 5: Commit**

  `git commit -m "feat(ui): risk panel, exceptions table, remediation queue and data-quality exceptions"`

---

### Task 8: Docs, ADR 0008, changelog, design upkeep, PR

**Files (EN, and the IT mirror under `docs/it/`):**

- `docs/configuration.md`:
  - the `remediation` and `exceptions` policies (every key, defaults, opting in to escalation);
  - the `exceptions.yaml` contract, with one example per selector and the field rules;
  - the policy cases format;
  - `--exceptions` and the mock fixture rule (D13);
  - the JSON Schemas `exceptions.schema.json` / `policy-case.schema.json`.
- `docs/security.md`:
  - no new permission and no write: "the hub never dismisses alerts";
  - what is published about an exception, and what is withheld for non-public repositories under a public audience;
  - the `created_at` facts with the sources and the date 2026-10-21 (spec §9);
  - the recommendation to keep real exceptions in a private config repository.
- `docs/operations.md`:
  - add / renew / remove an exception by pull request (CODEOWNERS review);
  - run `npm run policy:check` locally, and `npm run policy:check -- --snapshot public/data` as a read-only what-if;
  - the CI job;
  - opting in to SLA escalation;
  - what to do with stale and unverifiable exceptions.
- `docs/architecture.md`:
  - the data flow (keys → match → SLA → evaluate → publish);
  - the trust boundary: exceptions are reviewed config, text scrubbed;
  - snapshot version `1.6`.
- `README.md` / `README.it.md`:
  - the Security dimension mentions accepted and overdue;
  - `npm run policy:check` in the commands;
  - remove from the roadmap "security exceptions with expiry", "policy-as-code" and "remediation SLAs".
- `PRODUCT.md`, `DESIGN.md`: the risk panel, the remediation queue, the Accepted / Overdue pills.
- Create: `docs/architecture/adr/0008-risk-governance-policy-as-code.md` plus its IT copy.
  - Title (spec D15): "Risk governance as typed policy-as-code: exceptions in reviewed config, never GitHub dismissals, no OPA".
  - Context, decision, the OPA rationale (spec §5.9) and consequences.
  - Use the next free number if 0008 is taken, and say so in the PR.
- `CHANGELOG.md`, `## [Unreleased]`:
  - Added: security exceptions, remediation SLAs, `policy:check` with decision cases and snapshot what-if, the CI job, the risk UI, `newlyOverdue` / `expiredExceptions` in changes, CSV columns.
  - Changed: snapshot 1.6 (upgrade note: an existing 1.5 `public/data` fails validation until it is re-collected), history 1.2 (reads 1.0 and 1.1), the demo policies opt in to SLA escalation (Platform is red in the demo).
- Design upkeep, outside the repo:
  - update the Warm Graphite DS README and the Claude Design canvas to match the build;
  - re-read the remote files first;
  - never put artifact links in the repo.

- [ ] **Step 1: Write and update the docs.**

- [ ] **Step 2: Check them**

  Run: `npx prettier --check . && npm run validate:config && npm run policy:check && npm test`. Expected: PASS. EN and IT files link to each other.

- [ ] **Step 3: Commit**

  `git commit -m "docs: risk governance, policy-as-code and ADR 0008"`

- [ ] **Step 4: Push and open the PR** (when the orchestrator says so)

  Push the branch and open a PR with `GH_TOKEN=$(gh auth token --user massilp) gh pr create`. Title: `feat: risk governance — security exceptions, remediation SLAs, policy-as-code (schema 1.6)`. The body lists the Review Focus items and any drift adaptations (version numbers, ADR number, skipped Task 6). The owner merges.
