# Deployments ledger (v0.17.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitHub Deployments become the ledger of every environment. A pull bridge (Azure DevOps), a declared-record workflow and a push recipe write it; the hub reads it through a new `github-deployments` deploy signal.

**Architecture:**

- **Shared contracts** in `shared/model/ledger.ts`: the ledger payload, the bridge map and the record key.
- **Writer program** `ledger/` (like `notifier/`, ESLint-isolated from the collector): GitHub write client, idempotent writer, Azure DevOps reader, bridge and declare entry points. Two reusable workflows run it from a verified hub release.
- **Hub side:** the collector gets read-only deployments calls and the new signal.

**Tech Stack:** TypeScript 6, Zod, Octokit (`@octokit/rest`, `@octokit/auth-app`, already dependencies), Node `fetch` + `shared/http`, Vitest, GitHub Actions. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-04-deployments-ledger-design.md` (IT mirror in `docs/it/`). Decisions are D1–D13; § numbers refer to the spec.

## Before you start

- Branch `docs/deployments-ledger-spec` (spec `f138a3a`) from `main` at v0.16.0 (`9ecdffa`), worktree `../ehub-wt-v0110`. Rename the branch to `feat/deployments-ledger` before the first code commit.
- Release values: **v0.17.0**, ADR **0015**. The snapshot schema stays **1.9**: no snapshot field changes; the cell already carries `signal` and `note`. `DeploySignalTypeSchema` gains a value, which is a schema change. Ruling to take in Task 1: bump to **1.10** if the snapshot validation rejects older readers, else keep 1.9 and ledger it.
- Real Azure DevOps end to end is **deferred** (owner, 2026-11-04). Everything is tested with mock ADO and mock GitHub.

## Global Constraints

- **Never a false deploy** (spec anti-goal 1):
  - a record whose result cannot be read is not written;
  - canceled or skipped ADO records are not written;
  - a commit unknown to GitHub is skipped and listed (D8), never invented.
- **Writer scope:** the writer program only calls these GitHub endpoints:
  - `GET/POST /repos/{o}/{r}/deployments`;
  - `GET/POST /repos/{o}/{r}/deployments/{id}/statuses`;
  - `GET /repos/{o}/{r}/commits/{ref}` and contents reads, **with the read client only** (D11).

  No other write. Tokens for writing are narrowed to one repository and `{ deployments: 'write' }`.

- **Dry-run by default (D9):** a POST happens only when the input `mode` is `write` AND `HUB_DEPLOYMENTS_BRIDGE=write`; otherwise the summary says which one failed.
- **Real times (D10):** `payload.finishedAt` is required for `success` / `failure`; the hub uses it as the event time.
- **Idempotency (D4):** key = `(payload.source, payload.runId, payload.attempt, environment)`.
- **Public repository:** synthetic examples only (`example-org`, `example-project`, `example-service`); EN + IT docs; no company, customer or person names.
- **Safety rules:**
  - never run `npm run ci:build` / `collect:mock`;
  - goldens via `npm run fixtures:update`;
  - e2e on port 4377 via a temp config, never 4321;
  - podman only.
- **Commits:** `git -c user.name=massilp -c user.email=3519719+massilp@users.noreply.github.com commit`, Conventional Commits, no attribution; `npx prettier --write` before each commit.

## Review Focus

1. **A 90-day backfill run.** Every record is written today, but the hub must place each deploy at its real `finishedAt`. Expected: deploy frequency and lead time are unchanged by when the bridge ran. Pinned in Task 2.
2. **The same ADO run read twice, and a retried stage.** Expected: the second read writes nothing; a retry (attempt 2) is a new record. A failure followed by a success reads as one failed deploy plus its restore. Pinned in Tasks 3 and 4.
3. **An ADO record whose commit is not on GitHub** (mirror behind). Expected: skipped and listed in the summary with the reason; no POST. Pinned in Task 4.
4. **`mode: write` without the repository variable, or the variable without the input.** Expected: dry-run, zero POSTs, and the summary names the missing opt-in. Pinned in Task 3.
5. **An in-progress deployment** (no final status), and a deployment later marked `inactive`. Expected: in-progress is ignored; inactive after success still counts as a deploy. Pinned in Task 2.

---

### Task 1: Contracts — ledger payload, bridge map, catalog signal

**Files:**

- Create: `shared/model/ledger.ts` (export from `shared/model/index.ts`)
- Modify:
  - `shared/model/control-map.ts`: `DeploySignalSchema` and `DeploySignalTypeSchema` gain `github-deployments`;
  - `shared/model/catalog.ts`: superRefine checks the signal's `repository`;
  - `src/lib/catalog-editor-core.ts`: keeps the new signal (the existing spread already does; add a test);
  - `scripts/generate-json-schema.ts`: target `deployments-bridge` produces `config/schema/deployments-bridge.schema.json`.
- Test: `tests/unit/ledger-model.test.ts`, `tests/unit/catalog-editor.test.ts`

**Interfaces:**

- Produces (from `@model/index`):
  - `LEDGER_SOURCES = ['azure-devops', 'manual', 'other'] as const`.
  - `LedgerPayloadSchema`: strict object with these fields:
    - `ledger: z.literal(1)`;
    - `source: z.enum(LEDGER_SOURCES)`;
    - `runId: string 1–100`;
    - `runUrl: httpsUrl`;
    - `attempt: int ≥ 1, default 1`;
    - `version: string ≤ 100 | undefined`;
    - `startedAt`, `finishedAt`: isoDate | undefined;
    - `declared: boolean, default false`;
    - `kind: 'deploy' | 'rollback', default 'deploy'`.
  - `type LedgerPayload`.
  - `LedgerRecord = { repository: string; environment: string; sha: string; production: boolean; state: 'success' | 'failure'; description: string ≤ 140; payload: LedgerPayload }`. The schema requires `payload.finishedAt` for every record (D10).
  - `ledgerKey(r: { environment: string; payload: Pick<LedgerPayload,'source'|'runId'|'attempt'> }): string`, returning `${source}:${runId}:${attempt}:${environment}`.
  - `DeploymentsBridgeMapSchema`: the YAML of spec §5.3:
    - `schemaVersion: '1.0'`;
    - `sources[]` with `type: 'azure-devops'`, `organization` (`^[A-Za-z0-9][A-Za-z0-9-]{0,49}$`), `project` (1–64), `environments[]`.
    - Each environment has: `ado` (1–64), `repository` (`owner/repo`), `github` (1–255), `production` (boolean, default false), `versionFrom?: { file: relativePath; key: dotPath }`, `commitFrom: string = 'self'`.
    - Limits: at most 50 sources, 50 environments each.
  - `DeploySignalSchema` variant `{ type: 'github-deployments'; repository: 'coordinator' | componentId; environment?: string ≤ 255; tagPrefix: string = 'v'; sources?: ('github-actions' | LedgerSource)[] }`.

- [ ] **Step 1: Write the failing tests**:
  - The payload example of spec §5.1 parses.
  - A `success` record without `finishedAt` is rejected.
  - `ledgerKey` of the example is `azure-devops:12345:1:prod`.
  - The spec §5.3 map parses with defaults `production: false`, `commitFrom: 'self'`.
  - The map rejects `repository: 'nope'` and an absolute `versionFrom.file`.
  - The catalog accepts `deploySignal: { type: github-deployments, repository: coordinator, sources: [azure-devops] }` and rejects an unknown component as `repository`.
  - The editor round-trips it unchanged.
- [ ] **Step 2: Run** `npx vitest run tests/unit/ledger-model.test.ts tests/unit/catalog-editor.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement**, then run `npm run schema:generate`.
- [ ] **Step 4: Run** the tests plus `tests/unit/json-schema.test.ts tests/unit/control-map-model.test.ts`. Expected: PASS. Rule on the schema version (see Before you start), and if bumped, regenerate goldens and fix the version literals.
- [ ] **Step 5: Commit** `feat(model): deployments ledger contracts and github-deployments signal`.

---

### Task 2: Hub — read the ledger (`github-deployments` signal)

**Files:**

- Modify:
  - `collector/src/providers/types.ts`: `DeploymentDTO`, `DeploymentStatusDTO`, optional `listDeployments?` and `listDeploymentStatuses?`;
  - `collector/src/providers/github/github-provider.ts`: implement them;
  - `collector/src/providers/mock/mock-provider.ts`: fixture keys `deployments: Record<environment, DeploymentDTO[]>` and `deploymentStatuses: Record<id, DeploymentStatusDTO[]>`;
  - `collector/src/collectors/deploy-signals.ts`: new case;
  - `collector/src/evaluators/control-map.ts`: note `includes N declared` (via `DeploySignalResult.notes`);
  - `src/i18n/en.ts`, `it.ts`: `controlMap.signals['github-deployments']` = "GitHub deployments" / "Deployment GitHub";
  - demo: `config/projects/project-beta.yaml` (prod → `github-deployments`), `config/projects/project-gamma.yaml` (dev keeps `external`, the external demo moves here);
  - `fixtures/github/example-org__project-beta-coordinator.json`: ledger deployments for `prod` — Actions-made, ADO-made, one declared, one failure then a success, one rollback, one in progress, one inactive after success.
- Regenerate: `npm run fixtures:update`.
- Test: `tests/unit/deploy-signals.test.ts`, `tests/unit/github-provider.test.ts`, `tests/integration/collector.test.ts`, `tests/integration/site.test.ts` (move the "external" expectations from Project Beta to Project Gamma)

**Interfaces:**

- Produces:
  - `DeploymentDTO = { id: number; sha: string; environment: string; createdAt: string; payload: unknown; creator: string | null }`.
  - `DeploymentStatusDTO = { state: string; createdAt: string }`.
  - `listDeployments(repo, environment): Promise<ProviderResult<DeploymentDTO[]>>` calls `GET /deployments?environment=&per_page=100`, first page only.
  - `listDeploymentStatuses(repo, id): Promise<ProviderResult<DeploymentStatusDTO[]>>` calls `per_page=100`.
- Rules (spec §5.5):
  - **Source of a deployment:** parsed payload `source` if it parses with `LedgerPayloadSchema`, else `github-actions`. The `sources` filter drops the rest.
  - **Event kind:** any `success` status gives a deploy; `failure` or `error` gives a failure; neither gives nothing.
  - **Time:** `payload.finishedAt` ?? the final status `createdAt`.
  - **Rollback:** `payload.kind === 'rollback'`, or a semver below the previous deploy's version.
  - **Lead time:** `getCommitDate(repo, tagPrefix+version)` when a version exists, else `getCommitDate(repo, sha)`.
  - **Window:** a deployment created before the trend window is read only to decide "has older deployments".
  - **No deployment in the window:** with older ones, frequency is a measured 0; without, reason `source-unreadable` with note `no deployment recorded`.

- [ ] **Step 1: Write the failing tests** (`deploy-signals.test.ts`, fake provider, `now` 2026-03-01):
  - **Backfill (Review Focus 1):** three ADO records all created `2026-02-28` with `finishedAt` on 02-01, 02-08, 02-15 give events at those dates, so frequency over 30 days = 3 deploys.
  - **Statuses (Review Focus 5):** in-progress only gives no event; `success` then `inactive` gives a deploy; `error` gives a failure.
  - **Declared:** a declared record gives the note `includes 1 declared`.
  - **Filter:** `sources: [azure-devops]` drops an Actions deployment.
  - **Permissions:** a 403 gives reason `needs-permission` and an error.
  - **Provider:** maps `payload` (object or JSON string), `creator.login`, statuses.
  - **Golden:** Project Beta's `change-failure-rate` and `time-to-restore` are measured, with signal `github-deployments`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement**, then run `npm run fixtures:update`.
- [ ] **Step 4: Run** `npx vitest run`. Expected: PASS (fix the moved Beta→Gamma expectations).
- [ ] **Step 5: Commit** `feat(collector): github-deployments deploy signal reads the ledger`.

---

### Task 3: Writer core — GitHub client, idempotent writer, mode

**Files:**

- Create:
  - `ledger/src/github.ts`: write client (App installation token narrowed per repository) and read client (hub App);
  - `ledger/src/writer.ts`;
  - `ledger/src/mode.ts`;
  - `ledger/src/summary.ts`.
- Modify: `eslint.config.*`: block `ledger/**` from importing `collector/**`, `notifier/**` and `src/**`, and block those from importing `ledger/**` (same pattern as the notifier, ADR 0013).
- Test: `tests/unit/ledger-writer.test.ts`

**Interfaces:**

- Produces:
  - `resolveLedgerMode({ input: string | undefined; variable: string | undefined }): { mode: 'write' } | { mode: 'dry-run'; reason: 'mode-input' | 'mode-variable' }`.
  - `interface LedgerGitHub`:
    - `listDeployments(repo, sha, environment): Promise<{ id: number; payload: unknown; statuses: string[] }[]>`;
    - `createDeployment(repo, req): Promise<number>`;
    - `createStatus(repo, id, state, logUrl): Promise<void>`.
  - `interface LedgerReader`:
    - `commitExists(repo, sha): Promise<boolean | 'unknown'>`;
    - `fileAt(repo, path, sha): Promise<string | null>`;
    - `tagCommit(repo, tag): Promise<string | null>`.
  - `writeRecord(gh: LedgerGitHub, r: LedgerRecord, mode): Promise<{ outcome: 'written' | 'exists' | 'status-added' | 'would-write'; id?: number }>`.
  - `createAppClients({ writeAppId, writeKey, readAppId?, readKey?, owner }): { writer(repo): LedgerGitHub; reader(repo): LedgerReader }`. Installation lookup per owner; the token request body is `{ repositories: [name], permissions: { deployments: 'write' } }` (writer) or `{ contents: 'read', metadata: 'read' }` (reader).
  - `renderSummary(rows: { environment; repository; read; written; skipped: { reason; count }[] }[]): string` (markdown table, no URLs with tokens).

- [ ] **Step 1: Write the failing tests** with an in-memory `LedgerGitHub`:
  - **Idempotent (Review Focus 2):** `writeRecord` twice gives `written`, then `exists`, with exactly one create call.
  - **Retry (Review Focus 2):** the same `runId` with `attempt: 2` is `written` again.
  - **Status repair:** an existing record without a final status gets `status-added`.
  - **Dry-run:** `would-write` and zero create calls.
  - **Mode (Review Focus 4):**
    - `resolveLedgerMode({ input: 'write', variable: undefined })` gives `{ dry-run, reason: 'mode-variable' }`;
    - `{ input: undefined, variable: 'write' }` gives `mode-input`;
    - both set gives `write`.
  - **Request body:** `required_contexts: []`, `auto_merge: false`, `transient_environment: false`, `production_environment` from the record, `payload` exactly the record payload.
  - **Token scope:** `createAppClients` sends the narrowed body (assert with a fake fetch).
- [ ] **Step 2: Run** `npx vitest run tests/unit/ledger-writer.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** (Octokit with `createAppAuth`, the same pattern as `collector/src/providers/github/github-provider.ts` `createGitHubClient`).
- [ ] **Step 4: Run** the test and `npx eslint ledger tests/unit/ledger-writer.test.ts`. Expected: PASS, no boundary violation.
- [ ] **Step 5: Commit** `feat(ledger): idempotent GitHub deployments writer with dry-run gating`.

---

### Task 4: Azure DevOps pull bridge

**Files:**

- Create:
  - `ledger/src/ado.ts`: ADO client;
  - `ledger/src/ado-auth.ts`: Entra federation and PAT;
  - `ledger/src/bridge.ts`;
  - `ledger/src/bridge-cli.ts` (`npm run deployments:bridge`);
  - `fixtures/ado/` (mock ADO responses).
- Test: `tests/unit/ledger-bridge.test.ts`, `tests/unit/ledger-ado.test.ts`

**Interfaces:**

- Consumes: Task 1 schemas and Task 3 writer, reader and mode.
- Produces:
  - `interface AdoClient`:
    - `environmentId(org, project, name): Promise<number | null>`;
    - `deploymentRecords(org, project, envId, sinceIso): Promise<AdoRecord[]>`;
    - `runCommit(org, project, pipelineId, runId, alias): Promise<string | null>`.
  - `AdoRecord = { id: number; result: string | null; startTime: string | null; finishTime: string | null; pipelineId: number; runId: number; attempt: number; runUrl: string }`.
  - `adoTokenFromFederation({ tenantId, clientId, idTokenUrl, idTokenRequestToken }): Promise<string>`:
    1. requests a GitHub OIDC token with audience `api://AzureADTokenExchange`;
    2. POSTs `https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token` with `grant_type=client_credentials`, `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer`, `client_assertion`, `client_id`, and `scope=499b84ac-1321-427f-aa17-267ca6975798/.default`.
  - `adoAuthHeader({ pat?: string; federation? }): Promise<string>`: `Basic` for a PAT, `Bearer` for federation.
  - `runBridge({ map, ado, writer, reader, mode, now, sinceDays }): Promise<{ summary: string; written: number; skipped: number }>`.
- Endpoints: the first sub-step of Step 3 confirms each one on Microsoft Learn and writes the confirmed path and `api-version` in a comment and in the docs. Expected:
  - `GET https://dev.azure.com/{org}/{project}/_apis/distributedtask/environments?name=`;
  - `GET …/_apis/distributedtask/environments/{id}/environmentdeploymentrecords`;
  - `GET …/_apis/pipelines/{pipelineId}/runs/{runId}` (`resources.repositories[alias].version`).

  Hosts are allow-listed (`dev.azure.com`, `login.microsoftonline.com`). Every call has a 20 s timeout and a capped body (`readBodyCapped`, 2 MB).

- Mapping: result `succeeded` → `success`; `failed` → `failure`; any other or null → skip (`not-completed`).
- Commit: the run commit via `commitFrom`. When `reader.commitExists` is false, skip with `commit-not-on-github`; when it is `'unknown'`, skip with `commit-unverified`.
- Version: `fileAt` + `valueAt` (reuse the logic of `collector/src/collectors/deploy-signals.ts` `valueAt` by moving it to `shared/yaml-value.ts`).
- Payload: `source: azure-devops`, `runId: String(runId)`, `attempt`, `runUrl`, `startedAt`, `finishedAt: finishTime`.
- Limits: at most 100 records per environment, sorted by `finishTime`, oldest first.

- [ ] **Step 1: Write the failing tests** with fake `AdoClient`, writer and reader:
  - **Mixed results:** 4 records (succeeded, failed, canceled, in progress) give 2 written and 2 skipped with `not-completed`.
  - **Mirror behind (Review Focus 3):** a commit unknown to GitHub is skipped with `commit-not-on-github` and makes zero create calls.
  - **Repeat run (Review Focus 2):** a second bridge run over the same records writes 0.
  - **Version:** `versionFrom` yields `version: '0.5.2'` from the file at the commit.
  - **commitFrom:** `commitFrom: 'mirror'` reads that alias.
  - **Federation:** `adoTokenFromFederation` posts the exact form fields (fake fetch) and never logs the assertion.
  - **Summary:** lists environment, read, written and skipped by reason.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement**:
  1. Verify the endpoints and record them.
  2. Write the code.
  3. Add `"deployments:bridge": "tsx ledger/src/bridge-cli.ts"`. The CLI options are `--map`, `--mode`, `--since-days` (1–90, default 7), with env `HUB_DEPLOYMENTS_BRIDGE`, `ADO_TENANT_ID`, `ADO_CLIENT_ID`, `ADO_PAT`, `LEDGER_APP_ID`, `LEDGER_APP_PRIVATE_KEY`, `GH_APP_ID`, `GH_APP_PRIVATE_KEY`. It prints the summary and writes it to `$GITHUB_STEP_SUMMARY` when set.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ledger): Azure DevOps pull bridge`.

---

### Task 5: Declared records, push recipe, reusable workflows

**Files:**

- Create:
  - `ledger/src/declare.ts` and `ledger/src/declare-cli.ts` (`npm run deployments:declare`);
  - `scripts/report-deployment.sh`;
  - `.github/workflows/rw-deployments-bridge.yml`;
  - `.github/workflows/rw-deployments-declare.yml`;
  - `examples/deployments/deployments-bridge.yaml` (synthetic map);
  - `examples/deployments/caller-bridge.yml` and `examples/deployments/caller-declare.yml`.
- Test: `tests/unit/ledger-declare.test.ts`, `tests/unit/report-deployment-script.test.ts`

**Interfaces:**

- Produces:
  - `buildDeclaredRecord({ repository, environment, sha?, version?, tagPrefix, state, finishedAt, note, runUrl }, reader): Promise<LedgerRecord | { refused: 'tag-missing' | 'no-ref' }>`. The record has `source: manual`, `declared: true`, and `runId` = the workflow run id.
  - **`rw-deployments-bridge.yml`** (`workflow_call`):
    - inputs: `hub-ref` (verified release commit, same `verify` job as `rw-hub-cloudflare-deploy.yml`), `map`, `mode` (default `dry-run`), `since-days`, `ado-tenant-id`, `ado-client-id`;
    - secrets: `LEDGER_APP_ID`, `LEDGER_APP_PRIVATE_KEY`, `GH_APP_ID`, `GH_APP_PRIVATE_KEY`, `ADO_PAT` (optional);
    - job permissions: `contents: read`, `id-token: write`;
    - `HUB_DEPLOYMENTS_BRIDGE: ${{ vars.HUB_DEPLOYMENTS_BRIDGE }}` mapped to env; inputs are never inlined in `run:`.
  - **`rw-deployments-declare.yml`** (`workflow_call`): same verify job, inputs of the declare form, job `environment: deployments-declare`, permissions `contents: read`.
  - **`scripts/report-deployment.sh`**:
    - env: `GH_API` (default `https://api.github.com`), `GH_APP_ID`, `GH_INSTALLATION_ID`, `GH_KEY_FILE`, `GH_OWNER`, `GH_REPO_NAME`, `SHA`, `ENV_NAME`, `STATE`, `RUN_ID`, `RUN_URL`, `ATTEMPT`, `STARTED_AT`, `FINISHED_AT`, `VERSION`, `PRODUCTION`;
    - mints the narrowed token, checks for an existing record (idempotent), then writes the §5.1 record;
    - exits 0 on 422 with the message `commit not on GitHub`;
    - never echoes the token.

- [ ] **Step 1: Write the failing tests**:
  - **Declare:** version `0.5.2` with tag `v0.5.2` present resolves to its commit; a missing tag refuses with `tag-missing`; the record is `declared: true`, `source: manual`.
  - **Script** (runs bash against a local `node:http` server with a generated RSA key, skipped when `openssl` is absent):
    - the server sees `POST /app/installations/{id}/access_tokens` with `repositories: [name]`, `permissions.deployments: 'write'`;
    - then `GET /deployments`, `POST /deployments` with the payload, and `POST /statuses`;
    - running it twice creates once;
    - a 422 exits 0 and prints `commit not on GitHub`;
    - the token never appears in stdout or stderr.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** the code, then add `"deployments:declare": "tsx ledger/src/declare-cli.ts"`.
- [ ] **Step 4: Run** the tests, `npx actionlint .github/workflows/rw-deployments-*.yml` and the repo's zizmor configuration on them. Expected: PASS, no findings.
- [ ] **Step 5: Commit** `feat(ledger): declared records, push recipe and reusable workflows`.

---

### Task 6: Docs, ADR 0015, CHANGELOG

**Files:**

- Create:
  - `docs/deployments-ledger.md` and `docs/it/deployments-ledger.md`. Content: why; record format; the three writers with the ADO snippet (`DownloadSecureFile@1` + `report-deployment.sh`); the App (D2 name, permissions, one key per line, the accepted limit); ADO identity setup (Entra app with a federated credential for the caller repo, added to the ADO org as Reader on the project and environments; the PAT fallback with Environment: read and Build: read); the map; dry-run then write; the declare environment with reviewers; confirmed endpoints.
  - `docs/architecture/adr/0015-deployments-ledger.md` and the IT version.
- Modify:
  - `docs/control-map.md` and IT: signal row and permissions row (hub App **Deployments: read**);
  - `docs/security.md` and IT: the writer App, the bridge job permissions, key custody;
  - `docs/configuration.md` and IT: the signal fields;
  - `docs/architecture.md` and IT: the ADR list;
  - README and README.it: one paragraph;
  - CHANGELOG: Unreleased.
- [ ] **Step 1: Write** the docs. Run prettier and `npx vitest run` (i18n parity, docs tests). Expected: PASS.
- [ ] **Step 2: Commit** `docs: deployments ledger and ADR 0015`.

---

### Task 7: Final review, PR, merge

- [ ] **Step 1:** Full verification: `npx vitest run`, lint, typecheck, prettier check, e2e on 4377. Expected: all green.
- [ ] **Step 2:** Fresh reviewer on the most capable model, with the spec, this plan's Review Focus and the ledger rulings. One fix pass for Critical and Important findings, each with a failing test first. Minors go to the ledger.
- [ ] **Step 3:** Push, open the PR, check failed checks and code scanning, merge when green (owner's standing instruction). The v0.17.0 release and the deploy repo pin wait for the owner's OK.

### Task 8 (deferred, owner's call): real Azure DevOps end to end

- [ ] Create the personal or company App, an ADO org with a dummy pipeline (`deployment` jobs on dev/test/prod, approval on prod), and the map in the deploy repo.
- [ ] Run the bridge in dry-run, then in write mode, and check that the hub reads it.
