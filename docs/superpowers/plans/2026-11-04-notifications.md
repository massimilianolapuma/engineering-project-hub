# Notifications (v0.15.0, Microsoft Teams) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After each real collection, post one sanitised digest of the significant changes to a Microsoft Teams channel, from a separate job that holds only the Teams secret. It is dry-run by default, only fires on change, and never sends the same change set twice.

**Architecture:**

- **Prerequisite (Task 1):** the protected real-data path (`rw-hub-cloudflare-deploy.yml`) does not keep history today, so `changes.json` is never "compared" there. It gains the history restore and upload the GitHub Pages path already has.
- **Shared HTTP core (Task 2):** the audited client core of ADR 0012 moves to `shared/http/` with no behaviour change. The collector keeps `getJson`; the notifier gets a POST-only `postOnce`.
- **Notifier (Tasks 3–7):** a separate program, `notifier/` (`npm run notify`). It reads `index.json` and `changes.json`, builds a digest (pure), renders an Adaptive Card (pure), checks the payload for secrets, decides the mode, and in send mode posts once per change set, recorded in a ledger artifact.
- **Workflows (Tasks 8–9):** a reusable `notify.yml` job after `deploy`, with the Teams secret in its "Notify" step only. Opt-in through the repository variable `HUB_NOTIFICATIONS`.

**Tech Stack:** TypeScript 6, Zod, Node `crypto` and `fetch`, Vitest, `yaml`, GitHub Actions. No new dependency.

**Spec:** `docs/superpowers/specs/2026-10-21-outputs-design.md` §5.5, scoped by the owner decisions of 2026-11-03 (§10):

- **Microsoft Teams only.** Jira and Azure DevOps (§5.5.4 renderers, `JIRA_*`, `AZDO_PAT`) are not in this release.
- **One digest per target**, for the whole portfolio.
- **No supply-chain triggers.**

D7, D8, D10, D11, D13, D15 and D16 (ADR 0013) apply. Read §5.5.1–§5.5.7, then this plan.

## Before you start

- Branch `feat/notifications` from `main` at v0.14.1 (`e64cc37`). Start the session inside the worktree `../ehub-wt-v0110`; the `personal-github-guard` hook refuses commits otherwise.
- Release values: **v0.15.0**, **ADR 0013**. No snapshot, history or `changes.json` schema change.
- No UI: no mockup gate. The only user-facing strings are `notify.*` (EN + IT).

## Global Constraints

- **Separation (D7):**
  - the Teams secret `TEAMS_WEBHOOK_URL` exists only in the env of the "Notify" step;
  - the collect, build, attest and deploy jobs never get it, and the notify job never gets `GH_APP_*`, `GH_READ_TOKEN`, `SONARQUBE_TOKEN`, `HARBOR_ROBOT_*` or `ARGOCD_TOKEN`;
  - ESLint forbids `notifier/**` → `collector/**`, and `collector/**`, `src/**`, `shared/**` → `notifier/**`.
- **Dry-run by default (D8).** Send only when all hold:
  - config `mode: send`;
  - env `HUB_NOTIFICATIONS=send`;
  - env `DATA_SOURCE=github`;
  - `index.run.dataSource = github`;
  - `changes.basis.state = compared`;
  - `changes.basis.synthetic = false`.
- **Digest content (D9):** project ids and names, statuses, scores, counts, and links to `siteUrl` only. Never repository names, component ids, alert ids or titles, exception ids, team references, GitHub links, error details, secrets or raw payloads.
- **Outward requests (D13):**
  - POST only, `https:` only, no userinfo;
  - Teams host must end with an allowed suffix (default `environment.api.powerplatform.com`);
  - `redirect: 'error'`, 20 s timeout, response read capped at 64 KiB and then discarded;
  - **no automatic retry**;
  - never log a URL, a header or a body.
- **No duplicates (D11):**
  - the change-set key is the first 16 hex characters of the SHA-256 described in §5.5.3;
  - the ledger `hub-notify-ledger` is kept for 90 days, holds at most 200 entries, and records no URL or payload;
  - a failed ledger restore in send mode means nothing is sent.
- **Language:** `notify.*` strings in EN + IT, with i18n parity. Docs in EN + IT, the plan excepted.
- **Synthetic data only.** No real names. Never name the protected hosting domain.
- **Data safety:** never run `npm run ci:build` or `npm run collect:mock`. Goldens: `npm run fixtures:update`. Never use port 4321. Podman only.
- **Commits:**
  - Conventional Commits, made with `git -c user.name=massilp -c user.email=3519719+massilp@users.noreply.github.com commit`;
  - no attribution trailers;
  - run `npx prettier --write` before each commit;
  - push to `origin` only. Owner's standing instruction: open the PR and merge it when CI is green.

## Review Focus

1. **A re-run of the same workflow run after a successful send** (attempt 2 of the same run id). Expected: the ledger restore includes the current run's artifact, the Teams item is `skipped-duplicate`, and nothing is posted twice. Pinned in Tasks 6 and 7.
2. **A webhook URL with a host outside the allowlist, `http:`, or `user:pass@`.** Expected: `refused` with no request (fetch spy not called), exit 1, and the summary never shows the URL. Pinned in Task 5.
3. **A project name holding markdown or a link** (`[x](http://evil)`, `**`, `<b>`). Expected: escaped in the card, with no foreign link and the text shown literally. Pinned in Task 4.
4. **Ledger restore failed in send mode** (`HUB_LEDGER_STATE=failed`). Expected: nothing sent, exit 1, and the summary line "ledger unavailable: not sending to avoid duplicates". Pinned in Task 6.
5. **A digest over the 24 576-byte body cap** (50 projects with 100-character names). Expected: projects dropped from the end and counted in "N more projects"; the body fits; the job never fails for size. Pinned in Task 4.

---

### Task 1: History on the protected deploy path

**Files:**

- Modify:
  - `collector/src/history/select-artifact.ts`: `runIsTrusted(run, extraPaths?)`;
  - `scripts/restore-history.ts`: trust the calling workflow's path, taken from `GITHUB_WORKFLOW_REF`;
  - `.github/workflows/rw-hub-cloudflare-deploy.yml`: the collect job gains restore and upload, `actions: read`;
  - `examples/protected-deploy/.github/workflows/deploy-hub.yml`: permissions comment;
  - `docs/protected-hosting.md` and IT;
  - `docs/operations.md` and IT.
- Test: `tests/unit/restore-history.test.ts`, `tests/unit/hub-workflows.test.ts` (new; parses the workflow YAML with `yaml`)

**Interfaces:**

- Produces:
  - `runIsTrusted(run: RunLike, extraPaths: readonly string[] = []): boolean` accepts `ALLOWED_PATHS` plus `extraPaths`. Events stay `ALLOWED_EVENTS`.
  - `workflowPathFromRef(ref: string | undefined): string | null` in `select-artifact.ts`. For example, `example-org/hub-deploy/.github/workflows/deploy-hub.yml@refs/heads/main` → `.github/workflows/deploy-hub.yml`. Anything not matching `^[^/]+/[^/]+/(\.github/workflows/[\w.-]+\.ya?ml)@` → null.

- [ ] **Step 1: Write the failing tests.**
  - `runIsTrusted({ path: '.github/workflows/deploy-hub.yml', event: 'schedule' }, ['.github/workflows/deploy-hub.yml'])` is true.
  - The same call without `extraPaths` is false.
  - The `pull_request` event is false even with `extraPaths`.
  - `workflowPathFromRef` handles the example above, plus `undefined`, `'x'` and `'a/b/../../etc/passwd@x'` (null).
  - The restore CLI with `GITHUB_WORKFLOW_REF` set to a deploy-hub ref restores an artifact produced by that path (existing fake-client pattern in the test file).
  - `hub-workflows.test.ts`: in `rw-hub-cloudflare-deploy.yml`,
    - job `collect` has `permissions.actions: read`;
    - one step runs `history:restore` with `env.GITHUB_TOKEN` only;
    - the Collect step env has `HISTORY_FROM` and `HISTORY_RESTORE_STATE`;
    - an upload step names `hub-history` with `retention-days: 90`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/restore-history.test.ts tests/unit/hub-workflows.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Mirror the restore and upload steps of `collect-data.yml` in the protected collect job, keeping its secrets layout. `GITHUB_TOKEN` goes only to the restore step.
  - `main()` of `restore-history.ts` passes `[workflowPathFromRef(process.env.GITHUB_WORKFLOW_REF)].filter(Boolean)`.
  - Docs: the deploy repository now keeps `hub-history` (90 days), and "What changed" and trends work there.
- [ ] **Step 4: Run** the tests and `actionlint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ci): keep history on the protected deploy path`.

---

### Task 2: Shared HTTP core (no behaviour change)

**Files:**

- Create:
  - `shared/http/bounded-read.ts`: moved from `collector/src/util/bounded-fetch.ts` (`DownloadError`, `hostAllowed`, `downloadBounded`, `readBodyCapped`);
  - `shared/http/url.ts`;
  - `shared/http/classify.ts`.
- Modify:
  - `collector/src/util/bounded-fetch.ts` becomes `export * from '../../../shared/http/bounded-read'`;
  - `collector/src/providers/external/http.ts` uses `buildTemplateUrl` and `classifyStatus`.
- Test: the existing `tests/unit/bounded-fetch.test.ts`, `external-http.test.ts`, `sonarqube-provider.test.ts`, `harbor-provider.test.ts`, `argocd-provider.test.ts` and `tests/integration/supply-chain.test.ts` **unchanged**; new `tests/unit/shared-http.test.ts`.

**Interfaces:**

- Produces:
  - `buildTemplateUrl(base: URL, template: string, params: Record<string, string>, query?: Record<string, string>, doubleEncode?: readonly string[]): URL`: the body of today's `buildUrl`. It throws `external host mismatch` and `external path mismatch` as today.
  - `type HttpClass = 'not-authorised' | 'not-found' | 'rate-limited' | 'rejected' | 'too-large' | 'error'`.
  - `classifyStatus(status: number): HttpClass`:
    - 401/403 → `not-authorised`;
    - 404 → `not-found`;
    - 429 → `rate-limited`;
    - 400/422 → `rejected`;
    - 413 → `too-large`;
    - else `error`.
  - The collector maps `rejected` and `too-large` to its existing `error`, so its behaviour is unchanged.

- [ ] **Step 1: Write the failing tests** in `shared-http.test.ts`:
  - `classifyStatus` for 400, 401, 403, 404, 413, 422, 429 and 500;
  - `buildTemplateUrl` encodes `a/b` as `a%2Fb`;
  - it throws on `..`;
  - it throws when `base` is `http:`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/shared-http.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Move and extract.** Make no other edit to the collector code paths.
- [ ] **Step 4: Run** the full suite: `npx vitest run`. Expected: every existing test passes **unchanged** (`git diff --stat tests/` shows only the new file).
- [ ] **Step 5: Commit** `refactor(http): move the audited client core to shared/http`.

---

### Task 3: Notifications config (Teams only)

**Files:**

- Create:
  - `shared/model/notifications.ts` (exported from `shared/model/index.ts`);
  - `config/notifications.yaml` (demo: `mode: dry-run`, `targets.teams.enabled: false`);
  - `config/schema/notifications.schema.json` (`npm run schema:generate`; add the schema to `scripts/generate-json-schema.ts`).
- Modify:
  - `scripts/validate-config.ts`: validate the file when present;
  - `shared/security/patterns.ts`: `sensitiveEnvValues` gains `TEAMS_WEBHOOK_URL`.
- Test: `tests/unit/notifications-config.test.ts`, `tests/unit/patterns.test.ts`

**Interfaces:**

- Produces `NotificationsConfigSchema` (strict at every level) and `type NotificationsConfig`:
  - `schemaVersion: '1.0'`;
  - `mode: 'dry-run' | 'send'` (default `dry-run`);
  - `locale: 'en' | 'it'` (default `en`);
  - `siteUrl: string | null`: https only, no query or fragment, ends with `/`; default null.
  - `trigger`:
    - `overallWorsened: boolean = true`;
    - `becameUnknown: boolean = true`;
    - `dimensionsWorsened: Dimension[] = ['security', 'delivery']`;
    - `newFindings: { severities: ('critical'|'high')[] = ['critical'], min: int ≥ 1 = 1 }`;
    - `newlyOverdue: { severities = ['critical','high'], min = 1 }`;
    - `newErrors: { min: int ≥ 0 = 0 }`;
    - `expiredExceptions: { min: int ≥ 0 = 1 }`.
  - `digest: { maxProjects: int 1–50 = 10 }`.
  - `targets: { teams: { enabled: boolean = false; allowedHostSuffixes: string[] = ['environment.api.powerplatform.com'] } }`. A suffix matches `^[a-z0-9.-]+$` and has no leading dot (the `hostAllowed` convention); 1 to 5 entries.
  - `targets.jira` and `targets.azureDevOps` are **unknown keys** in this release (strict): they come in a later release.

- [ ] **Step 1: Write the failing tests:**
  - The parsed demo file equals the defaults above.
  - It rejects:
    - `siteUrl: 'http://x/'`;
    - `siteUrl: 'https://x/?a=1'`;
    - `digest.maxProjects: 51`;
    - `targets.jira: {}`;
    - a suffix `'.x.com'`;
    - `mode: 'loud'`.
  - `validate-config` accepts the config dir with and without `notifications.yaml`.
  - `sensitiveEnvValues({ TEAMS_WEBHOOK_URL: 'https://a.environment.api.powerplatform.com/x?sig=abcdefgh' })` contains that value.
- [ ] **Step 2: Run** the two test files. Expected: FAIL.
- [ ] **Step 3: Implement** the schema, the demo file, the JSON Schema, validation and the env name.
- [ ] **Step 4: Run** the tests plus `npx vitest run tests/unit/json-schema.test.ts tests/unit/config.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(notify): notifications config (Teams)`.

---

### Task 4: Digest, change-set key and the Teams card (pure)

**Files:**

- Create:
  - `notifier/src/model.ts`: `DigestSchema` (strict) and `type Digest`;
  - `notifier/src/digest.ts`;
  - `notifier/src/render/teams.ts`.
- Modify:
  - `src/i18n/en.ts` and `it.ts`: a `notify` block. Keys from spec §5.7 (`title`, `compared`, `statusWas`, `openChanges`, `more`) with `One` variants, plus `newCritical`, `newHigh`, `overdue`, `expiredExceptions`, `newErrors`, `becameUnknown`, `score`.
  - `tsconfig.json`: `include` gains `"notifier"`.
  - `vitest.config.ts`: coverage `include` gains `'notifier/**'`.
- Test: `tests/unit/notify-digest.test.ts`, `tests/unit/notify-teams.test.ts`

**Interfaces:**

- Consumes: `NotificationsConfig` (Task 3), `PortfolioIndex`, `ChangesFile` (`@model/index`).
- Produces:
  - `buildDigest(changes: ChangesFile, index: PortfolioIndex, config: NotificationsConfig): Digest | null`. The shape is spec §5.5.3; `totals` keeps all eight counters.
  - `changeSetKey(previousCollectedAt: string, items: [string, string, string][]): string`.
  - `renderTeams(digest: Digest, strings: Dict['notify'], maxBytes = 24_576): { body: unknown; bytes: number; omitted: number }`.
  - `escapeTeamsMarkdown(text: string): string`. It escapes `\ * _ [ ] ( ) # > ~` and the backtick, and turns `<` and `>` into `&lt;` and `&gt;`.

Rules beyond the spec text:

- **Status words** are the site's `status.*` words, as on the executive page ("Critical (was Attention)").
- **Order:** worst current overall first (red, grey, amber, green), then id.
- **Links:** `{siteUrl}changes/` (EN) or `{siteUrl}it/changes/` (IT), and only when `siteUrl` is set.
- **Card body:** a TextBlock title; a subtle "compared" line; one Container per project (name and status line, then one TextBlock per non-zero fact); a "N more projects" TextBlock; `actions: [Action.OpenUrl]` when `siteUrl` is set.
- **Size cap:** projects are dropped from the end until `Buffer.byteLength(JSON.stringify(body)) ≤ maxBytes`.

- [ ] **Step 1: Write the failing tests** on the goldens (`fixtures/snapshots/index.json` and `changes.json`), with the demo config and `mode` ignored. Re-read the golden `changes.json` first and adjust the counts, not the rules, if they moved since the spec.
  - **Projects:** `digest.projects.map(p => p.id)` is `['project-beta', 'platform']`.
  - **Totals:** `{ projects: 2, overallWorsened: 2, becameUnknown: 0, newCritical: 1, newHigh: 0, newlyOverdue: 1, newErrors: 0, expiredExceptions: 1 }`.
  - **Contents:**
    - Beta's `dimensions` lists `delivery` and `security` amber → red;
    - Platform's `newlyOverdue.high` is 1;
    - Alpha's improvement is not an item.
  - **Key:**
    - `digest.key` matches `/^[0-9a-f]{16}$/`;
    - it is the same for a copy of `changes` with another `generatedAt`;
    - it differs for another `basis.previousCollectedAt`.
  - **Not compared:** `basis.state: 'none'` gives `null`.
  - **Redaction:** `JSON.stringify(digest)` contains no `example-org`, `github.com`, `#code-scanning#` or `EXC-`.
  - **Card:**
    - `renderTeams(digest, en.notify).body` has `type: 'message'`, one attachment with `contentType: 'application/vnd.microsoft.card.adaptive'` and `content.version: '1.5'`;
    - the first TextBlock reads `Engineering hub: 2 projects need attention`;
    - a block reads `Project Beta: Critical (was Attention)`.
  - **Escaping:** a project named `[x](http://evil) **b** <i>` renders as `\[x\]\(http://evil\) \*\*b\*\* &lt;i&gt;`, and no `http://evil` survives unescaped as a link.
  - **Size cap:** a digest of 50 projects with 100-character names and `maxBytes: 4000` gives `bytes ≤ 4000`, `omitted > 0`, and a "more projects" block.
  - **Links:** without `siteUrl` there are no `actions` and no `http` anywhere in the body.
- [ ] **Step 2: Run** `npx vitest run tests/unit/notify-digest.test.ts tests/unit/notify-teams.test.ts tests/unit/i18n.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The key uses Node `crypto.createHash('sha256')` over `JSON.stringify({ previous, items: sortedItems })`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(notify): digest, change-set key and Teams card`.

---

### Task 5: `postOnce` and import boundaries

**Files:**

- Create: `notifier/src/http.ts`
- Modify: `eslint.config.js` (`no-restricted-imports` per Global Constraints)
- Test: `tests/unit/notify-http.test.ts`, `tests/unit/eslint-boundaries.test.ts` (runs ESLint's `Linter`/`ESLint` API on two fixture strings)

**Interfaces:**

- Consumes: `hostAllowed`, `readBodyCapped`, `classifyStatus` (Task 2).
- Produces:
  - `type PostOutcome = { outcome: 'sent' } | { outcome: 'refused'; reason: 'host-not-allowed' } | { outcome: HttpClass }`.
  - `postOnce(o: { url: string; body: string; allowedHostSuffixes: readonly string[]; timeoutSeconds?: number; fetch?: typeof fetch }): Promise<PostOutcome>`.
    - Content type is `application/json`.
    - Success is any 2xx.
    - Reads at most 64 KiB, then discards.
    - Any thrown or network error gives `{ outcome: 'error' }`.
    - The function's code contains no `console.*` call.

- [ ] **Step 1: Write the failing tests**, with an injected `fetch` spy:
  - **Refused without a request:** `http://a.environment.api.powerplatform.com/x`, `https://u:p@a.environment.api.powerplatform.com/x`, `https://evil.com/x` and `https://a.environment.api.powerplatform.com.evil.com/x` each give `refused` and the spy is never called.
  - **Statuses:** 202 gives `sent`, with exactly one call using `method: 'POST'` and `redirect: 'error'`; 400 gives `rejected`; 401 gives `not-authorised`; 413 gives `too-large`; 429 gives `rate-limited`; a thrown `TypeError` gives `error`.
  - **No retry:** a 500 is called exactly once.
  - **No logging:** a `console` spy records nothing.
  - **Boundaries:** ESLint reports `no-restricted-imports` for `import '../../collector/src/run'` in a file at `notifier/src/x.ts`, and for `import '../../notifier/src/http'` in `collector/src/x.ts`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** `postOnce` and the ESLint rules.
- [ ] **Step 4: Run** the tests and `npx eslint .`. Expected: PASS, lint clean.
- [ ] **Step 5: Commit** `feat(notify): POST-only outward client and import boundaries`.

---

### Task 6: The notifier run (`npm run notify`)

**Files:**

- Create:
  - `notifier/src/index.ts` (CLI);
  - `notifier/src/run.ts`;
  - `notifier/src/mode.ts`;
  - `notifier/src/ledger.ts`.
- Modify:
  - `package.json`: `"notify": "tsx notifier/src/index.ts"`;
  - `.gitignore`: `notify-out/`, `.notify-in/`, `.notify-ledger/`.
- Test: `tests/unit/notify-mode.test.ts`, `tests/unit/notify-ledger.test.ts`, `tests/integration/notifier.test.ts`

**Interfaces:**

- Consumes: Tasks 3–5.
- Produces:
  - `resolveMode(o: { configMode; variable: string | undefined; envSource: string | undefined; index: PortfolioIndex; changes: ChangesFile }): { mode: 'send' } | { mode: 'dry-run'; reason: 'mode-config' | 'mode-variable' | 'mock-data' | 'not-compared' | 'synthetic' }`. The first failing condition wins, in that order.
  - `LedgerSchema`: `{ kind: 'hub-notify-ledger'; schemaVersion: '1.0'; entries: { target: 'teams'; key; sentAt }[] }`, strict, max 200.
  - `loadLedger(path): Ledger` (missing file gives empty) and `appendLedger(l, entry): Ledger` (newest 200 kept).
  - `runNotifier(o: { snapshots: string; config: string; out: string; ledger?: string; env: NodeJS.ProcessEnv; fetch?: typeof fetch; now: () => Date }): Promise<{ exitCode: 0 | 1; summary: string }>`, following spec §5.5.6 steps 1–8 with Teams as the only target.
    - Writes `digest.json`, `teams.json` (`{ method: 'POST', body }`, never the URL) and `summary.md`.
    - Summary lines: `Mode | dry-run (mock-data)`, `Change set | <key>`, `Teams | sent | skipped-duplicate | not-configured | refused | <class> | dry-run`.

- [ ] **Step 1: Write the failing tests.**
  - **Mode:** the table of every condition. `configMode: 'send'`, variable `'send'`, `envSource: 'github'`, a github index and compared, non-synthetic changes give `send`. Each condition flipped alone gives its reason.
  - **Ledger:** append keeps the newest 200; a ledger with a URL-looking field fails the strict schema.
  - **Integration, golden snapshots, dry-run:**
    - writes the three files;
    - mode is `dry-run (mock-data)`;
    - the fetch spy is never called;
    - no file contains `example-org/` or `https://` other than `siteUrl`;
    - exit 0.
  - **Integration, send mode:** a temp copy of the goldens with `run.dataSource: 'github'`, `basis.synthetic: false`, env `HUB_NOTIFICATIONS=send`, `DATA_SOURCE=github`, `TEAMS_WEBHOOK_URL=https://a.environment.api.powerplatform.com/w?sig=s3cr3tvalue`, `teams.enabled: true`, and a fetch spy returning 202:
    - one POST;
    - the ledger has one entry;
    - a second run with the same ledger gives `skipped-duplicate` and no POST;
    - `summary.md` and the out files do not contain `s3cr3tvalue`.
  - **Ledger failed:** `HUB_LEDGER_STATE=failed` in send mode gives exit 1, no POST, and the summary contains `ledger unavailable`.
  - **Secret in a payload:** a project name containing the webhook URL value (temp index) means the payload is not written, there is no POST, exit 1, and the summary names the matching check (the name `findSecretPatterns` or the env check reports), never the value.
  - **Not configured:** a missing `notifications.yaml` gives exit 0 and the summary `not configured`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** Append `summary.md` to `$GITHUB_STEP_SUMMARY` when it is set.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(notify): notifier run with mode, payload check and ledger`.

---

### Task 7: Ledger restore

**Files:**

- Modify:
  - `collector/src/history/select-artifact.ts`: `candidateArtifacts(list, o & { name?: string; includeCurrentRun?: boolean })`, defaults `HISTORY_ARTIFACT` and `false`;
  - `scripts/restore-history.ts`: extract `restoreArtifactFile(client, o: RestoreOptions & { artifactName; fileName; maxBytes; includeCurrentRun })`; `restoreHistory` calls it with today's values.
- Create: `scripts/restore-ledger.ts` (artifact `hub-notify-ledger`, file `ledger.json`, 1 MiB, `includeCurrentRun: true`, writes `state=` to `$GITHUB_OUTPUT`, always exits 0)
- Modify: `package.json`: `"notify:restore-ledger": "tsx scripts/restore-ledger.ts"`
- Test: `tests/unit/restore-history.test.ts` (existing cases unchanged plus the new options), `tests/unit/restore-ledger.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - `candidateArtifacts` with `name: 'hub-notify-ledger', includeCurrentRun: true` keeps an artifact of the current run id. With the defaults it still drops it.
  - The ledger CLI with the fake client restores `ledger.json` and writes `state=restored`.
  - An oversized archive gives `state=failed`, and the exit code is 0.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full suite. Expected: PASS, every existing restore-history test unchanged.
- [ ] **Step 5: Commit** `feat(notify): restore the notification ledger`.

---

### Task 8: Workflows

**Files:**

- Create: `.github/workflows/notify.yml` (spec §5.5.7, Teams secret only)
- Modify:
  - `.github/workflows/deploy-pages.yml`: job `notify` after `[collect, deploy]`;
  - `.github/workflows/rw-hub-cloudflare-deploy.yml`: input `notifications` (`''`, `dry-run`, `send`), optional secret `TEAMS_WEBHOOK_URL`, and job `notify` after `deploy` that checks out the verified hub ref like `collect`;
  - `examples/protected-deploy/.github/workflows/deploy-hub.yml`: the input and the secret, commented out.
- Test: `tests/unit/hub-workflows.test.ts`

- [ ] **Step 1: Write the failing tests** (parse the YAML).
  - **`notify.yml`:**
    - workflow `permissions: {}`;
    - job permissions exactly `{ contents: read, actions: read }`;
    - `concurrency.group: hub-notify` with `cancel-in-progress: false`;
    - `TEAMS_WEBHOOK_URL` appears only in the env of the step named `Notify`, never in any `run:` text;
    - the restore step env has only `GITHUB_TOKEN`;
    - an upload step names `hub-notify-ledger` with `retention-days: 90` and `overwrite: true`, under an `if:` on the notify step's mode output.
  - **`deploy-pages.yml`:**
    - `jobs.notify.needs` is `[collect, deploy]`;
    - its `if` reads `vars.HUB_NOTIFICATIONS`;
    - no other job references `TEAMS_WEBHOOK_URL`;
    - `jobs.deploy` does not `needs: notify`;
    - `jobs.notify` passes no `GH_APP_*`, `GH_READ_TOKEN`, `SONARQUBE_TOKEN`, `HARBOR_*` or `ARGOCD_TOKEN`.
  - **`rw-hub-cloudflare-deploy.yml`:** the same separation checks, and the `notifications` input defaults to `''`.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Write** the workflows. Pin every action by SHA, as the existing workflows do.
- [ ] **Step 4: Run** the test, `actionlint`, and `zizmor` if installed (otherwise CI runs it). Expected: PASS.
- [ ] **Step 5: Commit** `feat(ci): notify job after deploy (opt-in, Teams secret isolated)`.

---

### Task 9: ADR 0013, docs and verification

**Files:**

- Create:
  - `docs/architecture/adr/0013-outward-notifications.md` and `docs/it/architecture/adr/0013-outward-notifications.md` (D16, title in spec §4);
  - `docs/notifications.md` and `docs/it/notifications.md`.
- Modify:
  - `docs/outputs.md` and IT: the notifications line points to the new doc;
  - `docs/security.md` and IT: new trust boundary, secret, ledger;
  - `docs/configuration.md` and IT: `notifications.yaml`;
  - `docs/architecture.md` and IT: the ADR list;
  - `README.md` and `README.it.md`: one line;
  - `CHANGELOG.md`: Unreleased.

`docs/notifications.md` covers:

- **Setup:** create the flow from "Send webhook alerts to a channel", choose "Anyone" and keep the URL secret, store it as `TEAMS_WEBHOOK_URL`, set `HUB_NOTIFICATIONS` to `dry-run` and then to `send`.
- **What a digest contains**, and what it never contains.
- **Modes and why a run stayed dry-run:** the reasons table.
- **De-duplication and re-runs.**
- **Risks:** the flow belongs to a person (use a service account and add a co-owner); the URL is a password (rotate it by recreating the trigger); throttling above 4 requests per second; the 28 KB limit.
- **Sources (checked 2026-11-04):** Microsoft Learn "Create incoming webhooks" (Workflows, Adaptive Card and MessageCard payloads, 28 KB, throttling, orphan flows); connector retirement in May 2026.

- [ ] **Step 1: Write** the docs and the ADR, EN + IT. Run `npx prettier --check` on them.
- [ ] **Step 2: Full verification:**
  - `npm run lint`, `npm run typecheck` and `npx vitest run`;
  - e2e on port 4377 with a temporary config (the site is unchanged; this is a regression run);
  - `actionlint`.

  Expected: all green.

- [ ] **Step 3: Manual check (owner, after merge):** with a real flow, a `workflow_dispatch` in `dry-run`, then in `send`. Record the card rendering and the escaping in `docs/notifications.md`.
- [ ] **Step 4: Commit** `docs: notifications (Teams) and ADR 0013`.

---

### Task 10: Final review and hand-off

- [ ] **Step 1:** A fresh reviewer on the most capable model reviews the whole branch, with this plan's Review Focus verbatim, the spec path and the ledger rulings. Run one fix pass for Critical and Important findings, each with a failing test first.
- [ ] **Step 2:** Push, open the PR, and merge it when CI is green (the owner's standing instruction). The v0.15.0 release (VERSION, package, SECURITY table, CHANGELOG, goldens, tag) waits for the owner's "release".
