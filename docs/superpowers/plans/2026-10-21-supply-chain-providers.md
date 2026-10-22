# Supply chain providers (v0.10.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the five non-native security controls (`containerScanning`, `iacScanning`, `dast`, `sbom`, `artifactSignature`) real sources and add three optional, read-only external providers:

- **GitHub-native (on by default, informative):** SBOM summary from the `hub-supply-chain-summary` CI artifact, and from the asynchronous dependency-graph export only when the owner opts in (**off by default**, controller ruling); attestations of release-asset digests; a `hub-supply-chain-summary` CI artifact (image digests, cosign / gh attestation results, CycloneDX or SPDX counts); Trivy / Checkov / ZAP recognised by code-scanning tool name.
- **External (off by default):** SonarQube as a second Quality source, Harbor for image scans and signatures, Argo CD for deployed versions per environment.

Nothing turns red by default, and with external providers off no status changes.

**Architecture:**

- **Model:** a `supplyChain` section per project; `ControlStatus` gains `source` and `evidence`; environments gain `declaredVersion` and `deployment`; Quality rows gain `source`, `qualityGate`, `newCoverage`; run metadata gains `providers`. Snapshot 1.6 → 1.7. New optional `config/providers.yaml`, catalog mappings, policies blocks, the `SupplyChainSummarySchema` contract.
- **Providers:** `GitHubProvider` gains the SBOM export, attestations, analyses by tool, alert category and the supply-chain summary. A new `collector/src/providers/external/` folder holds one audited HTTP client, credential resolution and the SonarQube, Harbor and Argo CD providers, each with a mock twin reading `fixtures/providers/*.json`.
- **Pure engines:** `summariseSpdx` (SBOM counts), `resolveControl` (source precedence), `buildSupplyChain` (section), quality source selection, deployed environment versions.
- **Collector:** `collect.ts` fetches the new data; `build-snapshot.ts` resolves controls before evaluating Security and Controls coverage; `run.ts` adds the providers block and the report line.
- **Site:** Supply chain fold on the project page, Supply chain fold and CSV on the Security page, source column and gate pill in Quality, Argo CD badges on Versions, Providers card on Data quality, How to read section.

**Tech Stack:** TypeScript 6, Zod 4, @octokit/rest 22, Node `fetch` / `zlib`, `yaml` 2.9, Astro 7, Vitest, Playwright. **No new dependency.**

**Spec:** `docs/superpowers/specs/2026-10-21-supply-chain-providers-design.md` (IT mirror under `docs/it/`). Read it first. This plan does not repeat its rationale. Section numbers (§) and decision ids (D1–D14) refer to the spec.

## Before you start: v0.7.0, v0.8.0 and v0.9.0 land first

This plan executes **after v0.7.0 (history, CSV), v0.8.0 (repository controls) and v0.9.0 (risk governance) are merged into `main`**. Rebase first: `git fetch && git rebase origin/main` on branch `feat/supply-chain-providers`.

Expect drift and **adapt to what is there**:

- `shared/model/primitives.ts` (v0.7.0): import `isoDate`, `httpsUrl`, `shortText`, `nullableCount`, `sha` from there.
- Snapshot version: v0.9.0 sets `1.6`. This plan sets `1.7`. If `main` is already past 1.6, take the next version. History stays at whatever v0.9.0 set (`1.2`): this release does not change it.
- ADR numbers: 0006–0008 are taken. Use **0009** and **0010**, or the next two free numbers (`ls docs/architecture/adr`).
- The level enum (`info | amber | red`, v0.8.0 / v0.9.0 `EnforcementLevelSchema`): reuse it.
- v0.8.0's code-scanning analyses call filtered by `tool_name` (Scorecard): **generalise** it into `listCodeScanningAnalyses(repo, tool, ref)` (Task 3) and keep the Scorecard caller working. If v0.8.0 named the error source `scorecard-analysis`, keep it for Scorecard and add `code-scanning-analyses` for the new callers.
- v0.9.0's `countsAsOpen`, exceptions and SLA code: mapped-tool findings keep going through them unchanged (only `category` changes).
- v0.9.0's config-file pattern (`loadExceptions`, `--exceptions`, `fixtures/exceptions/`): mirror it for `providers.yaml` (`--providers`, `fixtures/providers/`).
- v0.7.0's CSV helpers (`src/lib/csv.ts`, `src/pages/exports/*.csv.ts`, `exportHref`) and the v0.9.0 columns appended to them.
- `src/i18n/en.ts` / `it.ts`, the project page folds order, `collector/src/run.ts` (report lines), `scripts/update-golden-snapshots.ts`, `scripts/generate-json-schema.ts` (`SCHEMA_TARGETS`, drift test), the golden files.

Keep the interfaces below. Never revert v0.7.0–v0.9.0 code.

**Controller ruling (overrides the spec where they differ):** the dependency-graph SBOM export is **off by default** (opt-in switch, the single exception recorded in ADR 0009), because `generate-report` asks GitHub to run a job. The spec (EN + IT, D3, §5.2, §5.13, §7) is updated accordingly.

**Drift actually found (v0.7.0–v0.9.0 merged):** snapshot is `1.6` on `main`, so this release sets `1.7`; history stays `1.2`; `shared/model/primitives.ts` had no `sha` (added there, `snapshot.ts` imports it); ADR 0009 and 0010 are free.

## Global Constraints

- Read-only. GitHub: GET only. External providers: GET only, to the configured host only. The single GitHub call that asks GitHub to compute something is `GET …/dependency-graph/sbom/generate-report` (D3, ADR 0009). It is **opt-in, off by default** (`supplyChain.sbom.dependencyGraph: false`); with it off, nothing is requested, the SBOM control's default source is the `hub-supply-chain-summary` CI artifact (CycloneDX counts) and otherwise its counts are unknown (`null`), never healthy and never 0. Only the demo `config/policies.yaml` sets it to `true`, because the mock source reads fixtures only.
- **Never send `refresh` to Argo CD.** Never call Harbor scan, Sonar write or any `POST`/`PUT`/`DELETE`.
- No new runtime or dev dependency. HTTP with Node `fetch`, zip with the existing `collector/src/util/zip.ts`.
- Strict Zod on every published field. Never publish: package names, versions or purls; license texts or `LicenseRef-` names (folded into `LicenseRef-*`); SBOM documents; attestation bundles; ZAP request/response data; Sonar issues; Harbor vulnerability lists or scanner names; Argo CD `repoURL`, destination, resources or unmatched images; base URLs of external providers; credentials.
- External HTTP client (D8): `https:` only; the request host must equal the configured `baseUrl` host; path templates fixed in code with `encodeURIComponent` on every parameter (Harbor `repository_name` encoded twice); `redirect: 'error'`; timeout `timeoutSeconds` (default 20); 1 MiB response cap (1 048 576 bytes); concurrency 2 per provider; at most `maxItems` items per run (default 200). Errors carry only `{ classification, httpStatus, message }` with a fixed message per class.
- Credentials only from env: `SONARQUBE_TOKEN`, `HARBOR_ROBOT_NAME` + `HARBOR_ROBOT_SECRET`, `ARGOCD_TOKEN`. Never logged, never in errors, added to `sensitiveEnvValues()`. Harbor name without secret (or the reverse) is a structural config error (exit 1). Enabled provider without credential → items `not-authorised`, provider state `not-authorised`, one warning line, exit 0 (D9).
- Unknown ≠ 0: pending / too-large / invalid SBOM → counts `null`; not-configured provider → `off`, never "0 vulnerabilities" or "unsigned"; presence is `present`, never `verified`.
- Defaults, verbatim from the spec:
  - `supplyChain.enabled: true`, `supplyChain.sbom.dependencyGraph: false` (controller ruling: opt-in), `sbom.maxBytes: 16777216`, `sbom.pollAttempts: 3`, `sbom.pollIntervalSeconds: 5`, `sbom.flaggedLicenses: []`;
  - `supplyChain.attestations.releaseAssets: true`, `attestations.maxAssets: 5`;
  - `supplyChain.toolControls: { containerScanning: [{tool: Trivy}], iacScanning: [{tool: Checkov}], dast: [{tool: ZAP}] }`;
  - `supplyChain.precedence` as in spec §5.1;
  - `supplyChain.levels: { unsignedArtifact: info, flaggedLicense: info }`;
  - `freshness.supplyChainSummaryStaleDays: 14`;
  - `quality.sources: [ci-summary, sonarqube]`, `quality.qualityGateFailed: info`;
  - `version.environmentOutOfSync: info`, `version.environmentDegraded: info`.
- The demo `config/policies.yaml` sets `supplyChain.sbom.flaggedLicenses: [GPL-3.0-only, AGPL-3.0-only]` with the comment "demo: informative", and `supplyChain.sbom.dependencyGraph: true` explicitly (the mock reads fixtures only; the comment says a real deployment keeps it `false` unless it accepts the ADR 0009 exception). `config/providers.yaml` ships with all three providers `enabled: false`.
- Artifact `hub-supply-chain-summary`, file `supply-chain-summary.json`, zip cap 65 536 bytes, contract `schemaVersion: '1.0'`.
- Snapshot `SNAPSHOT_SCHEMA_VERSION = '1.7'`, `SUPPORTED_SNAPSHOT_SCHEMA_VERSIONS = ['1.7']`. Policies `schemaVersion` stays `'1.0'`. `providers.yaml` `schemaVersion: '1.0'`.
- Every UI string is EN + IT (parity: `tests/unit/i18n.test.ts`). Every new or changed doc has an EN and an IT version.
- **Never run `npm run ci:build` or `npm run collect:mock`**: they overwrite `public/data` (the owner's real snapshot, git-ignored).
  - Goldens: `npm run fixtures:update` (mock provider, `GOLDEN_NOW = 2026-01-15T12:00:00.000Z`, writes only `fixtures/snapshots`).
  - Site tests build from `fixtures/snapshots` (`tests/integration/site.test.ts` sets `SNAPSHOT_DIR`).
  - A manual collection: `npx tsx collector/src/index.ts --source mock --out "$(mktemp -d)" --now 2026-01-15T12:00:00Z`.
  - A manual site build: `SNAPSHOT_DIR=fixtures/snapshots npx astro build --outDir "$(mktemp -d)"`.
- Never use or kill port 4321. For e2e: `sed 's/4321/4377/g' playwright.config.ts > playwright.tmp.config.ts`, `npx playwright test -c playwright.tmp.config.ts`; delete `playwright.tmp.config.ts` (and `.e2e-dist/` if created) afterwards; never commit them.
- Tests never touch the network: GitHub through the existing fetch-injection helper, external providers through the injected `fetch` of `createExternalClient`, mocks through `fixtures/`.
- Containers: podman only (none are needed here).
- Commits: Conventional Commits, `git -c user.name=massilp -c user.email=3519719+massilp@users.noreply.github.com commit`, branch `feat/supply-chain-providers`. Run `npx prettier --write` on touched files before each commit. Do not push until Task 10, and only when the orchestrator says so.

## Review Focus

1. **No double counting.** A control won by `code-scanning` adds nothing to `externalCounts`; a losing source never adds. Alpha-backend `containerScanning` won by Harbor: open medium/low come from Harbor (2 / 6), not from Harbor **and** the status file. Pinned in Task 6 and Task 8.
2. **No status change by default.** With `config/providers.yaml` (all off) and schema-default policies, every project's statuses and scores equal the pre-change ones. With the mock providers fixture, every **overall** status and **score** still equals the v0.9.0 goldens. Pinned in Task 8.
3. **Host pinning and secrets.** No external request leaves the configured host (path parameters with `../`, `@`, `//`, `%2F` cannot change it), redirects are refused, credentials never appear in errors, logs or output. The SBOM download is sent **without** the Authorization header and only to an allowed host. Pinned in Task 2 and Task 4.
4. **Unknown is not unsigned / not zero.** Pending SBOM → `null` counts; Harbor tag 404 → signature `unknown`; attestations 403 → `not-authorised`; provider enabled without credential → `not-authorised`. Pinned in Tasks 2, 3, 5, 6.
5. **Nothing internal leaks.** The five canaries of spec §5.13 never appear in `fixtures/snapshots/**` or in the built site. Pinned in Task 8 and Task 9.
6. **Argo CD `refresh` is never sent; Sonar `project_status` is never called.** Pinned in Task 4 and Task 5.

---

### Task 1: Contracts, config files, policies, catalog mappings, enums, standalone schemas

**Files:**

- Modify: `shared/model/enums.ts`
  - `ControlSourceSchema = z.enum(['github','code-scanning','dependency-graph','attestations','supply-chain-summary','harbor','status-file'])`;
  - `ControlEvidenceSchema = z.enum(['verified','present','reported'])`;
  - `ProviderIdSchema = z.enum(['sonarqube','harbor','argocd'])`, `ProviderStateSchema = z.enum(['off','available','partial','not-authorised','unknown'])`;
  - `EcosystemSchema = z.enum(['npm','maven','pypi','nuget','golang','cargo','gem','composer','githubactions','docker','pub','swift','hex','other','unknown'])`;
  - `CapabilitySchema` adds `'dependencyGraph'`, `'attestations'`;
  - reason codes in a `// supply chain` group: `supply-chain-unsigned-artifact`, `supply-chain-flagged-license`; in the quality group: `quality-gate-failed`; in the version group: `environment-out-of-sync`, `environment-degraded`, `environment-deployment-unknown`.
- Modify: `shared/model/contracts.ts`: `SupplyChainSummarySchema` (spec §5.4) and `type SupplyChainSummary`; export the helpers `spdxLicenseExpression(raw): string | null` (returns the folded expression or `null` when not publishable) and `OCI_REPOSITORY_RE`.
- Create: `shared/model/providers.ts`: `ProvidersFileSchema` (spec §5.6), `type ProvidersFile`, `PROVIDERS_OFF` (all disabled).
- Modify: `shared/model/index.ts` (export it).
- Modify: `shared/model/catalog.ts`:
  - coordinator and component: `sonarProjectKey?`, `sonarBranch?`, `containerImages?` (max 5, `{ project, repository, tagTemplate default '{version}' }`);
  - environment: `argocdApplication?: { name, namespace?, project? }`;
  - superRefine: no duplicate `project/repository` image across the project's targets; `tagTemplate` must contain `{version}` once.
- Modify: `shared/model/policies.ts`:
  - `supplyChain` block (`.strict().prefault({})`) with the defaults of the Global Constraints;
  - refine: each `precedence.<control>` is a non-empty, duplicate-free subset of the ids allowed for that control (container: code-scanning, harbor, status-file; iac and dast: code-scanning, status-file; sbom: supply-chain-summary, dependency-graph, status-file; artifactSignature: supply-chain-summary, attestations, harbor, status-file);
  - refine: two `toolControls` rules with the same tool (case-insensitive) under different controls must both set different `category` prefixes;
  - `quality.sources` (non-empty, unique, `z.enum(['ci-summary','sonarqube'])`) and `quality.qualityGateFailed: z.enum(['info','amber'])`;
  - `version.environmentOutOfSync` and `version.environmentDegraded`: the level enum, default `info`;
  - `freshness.supplyChainSummaryStaleDays` default 14.
- Modify: `shared/model/snapshot.ts`: add the **standalone** exported schemas (spec §5.10). Do not attach them yet (Task 8):
  - `SupplyChainSchema`, `SupplyChainSummaryStateSchema`;
  - `EnvironmentDeploymentSchema`;
  - `RunProvidersSchema = z.record(ProviderIdSchema, { enabled, state, items, errors })` (strict, all three keys required).
- Modify: `collector/src/config/load.ts`: `loadProviders(file)` → `{ source: 'config' | 'fixture' | 'none', file: ProvidersFile }` (missing file → `none` + `PROVIDERS_OFF`); `loadConfig` returns `providers`.
- Modify: `collector/src/index.ts`: flag `--providers <file>`; default `<config>/providers.yaml` for `github`, `fixtures/providers/providers.yaml` for `mock`.
- Create: `config/providers.yaml` (header `# yaml-language-server: $schema=./schema/providers.schema.json`, comments pointing to `docs/configuration.md`, three blocks `enabled: false` with example `baseUrl` commented out).
- Modify: `config/policies.yaml` (commented `supplyChain` block with the demo `flaggedLicenses`, `quality.sources`, version levels).
- Modify: `scripts/generate-json-schema.ts` (`providers.schema.json`, `supply-chain-summary.schema.json`), `scripts/validate-config.ts` (validate `<dir>/providers.yaml` when present: `✔ <dir>/providers.yaml: sonarqube off · harbor off · argocd off`).
- Modify: `shared/security/patterns.ts`: `sensitiveEnvValues` names add `SONARQUBE_TOKEN`, `HARBOR_ROBOT_NAME`, `HARBOR_ROBOT_SECRET`, `ARGOCD_TOKEN`.
- Test: `tests/unit/config.test.ts`, `tests/unit/normalizers.test.ts` (contract), `tests/unit/providers-config.test.ts` (new), `tests/unit/patterns.test.ts` (or wherever `sensitiveEnvValues` is tested).

- [ ] **Step 1: Write failing tests**
  - `providers-config.test.ts`:
    - `missing file → source none, all disabled`;
    - `enabled without baseUrl is rejected`;
    - `http://… rejected; https://user:pw@host rejected; https://h/?q rejected; https://h/sonar accepted; https://h/a/../b rejected`;
    - `timeoutSeconds 0 and 61 rejected; maxItems 1001 rejected`.
  - `config.test.ts`:
    - `policies defaults: supplyChain.enabled true, sbom.dependencyGraph false, sbom.maxBytes 16777216, pollAttempts 3, attestations.maxAssets 5, levels info, quality.sources [ci-summary, sonarqube], version.environmentOutOfSync info, freshness.supplyChainSummaryStaleDays 14`;
    - `precedence.iacScanning [harbor] rejected; precedence.sbom [] rejected; precedence.sbom duplicate rejected`;
    - `toolControls Trivy under container and iac without categories rejected; with trivy-image / trivy-config accepted`;
    - `catalog: sonarProjectKey "a b" rejected; containerImages repository "Alpha/Backend" rejected; tagTemplate "v{version}" accepted, "latest" rejected; argocdApplication name "Beta_Prod" rejected; duplicate image across targets rejected`.
  - `normalizers.test.ts` (contract):
    - `SupplyChainSummarySchema accepts the spec example`;
    - `rejects extra key in images[0]`;
    - `rejects digest "sha256:abc"`;
    - `rejects withoutLicense > packages`;
    - `rejects image names with a registry host: "ghcr.io/x/y", "localhost/x", "registry:5000/x"` (first-segment refine, spec §5.4); `accepts "example-org/project-alpha-frontend"`;
    - `spdxLicenseExpression("MIT OR Apache-2.0") === "MIT OR Apache-2.0"`, `("LicenseRef-acme-1 AND MIT") === "LicenseRef-*"`, `("NOASSERTION") === null`, `("MIT; rm -rf") === null`.
  - patterns test: `SONARQUBE_TOKEN value of 12 chars is returned by sensitiveEnvValues`.

- [ ] **Step 2: Run and see them fail**

  `npx vitest run tests/unit/providers-config.test.ts tests/unit/config.test.ts tests/unit/normalizers.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**, then `npm run schema:generate`.

- [ ] **Step 4: Run the tests and checks**

  Same command, then `npm run typecheck && npm run validate:config` and the JSON Schema drift test (v0.9.0). Expected: PASS.

- [ ] **Step 5: Commit** `feat(model): supply chain contracts, providers config and catalog mappings`

---

### Task 2: SBOM from the dependency graph (async export) and `summariseSpdx`

**Files:**

- Create: `collector/src/normalizers/sbom.ts`
- Modify: `collector/src/providers/types.ts`, `collector/src/providers/github/github-provider.ts`, `collector/src/providers/mock/mock-provider.ts`
- Create: `collector/src/util/bounded-fetch.ts`
- Test: `tests/unit/sbom.test.ts` (new), `tests/unit/github-provider.test.ts`, `tests/unit/bounded-fetch.test.ts` (new)

**Interfaces:**

```ts
// types.ts
export interface SbomRequestDTO { uuid: string }
export type SbomFetchDTO = { state: 'pending' } | { state: 'ready'; text: string };
// SourceProvider gains
requestDependencySbom(repo: string): Promise<ProviderResult<SbomRequestDTO>>;
fetchDependencySbom(repo: string, uuid: string): Promise<ProviderResult<SbomFetchDTO>>;

// util/bounded-fetch.ts
export class DownloadError extends Error { constructor(readonly kind: 'host' | 'too-large' | 'http' | 'network') }
export async function downloadBounded(url: string, opts: {
  allowedHostSuffixes: readonly string[]; maxBytes: number; timeoutMs: number; fetch?: typeof fetch;
}): Promise<string>;   // https only, redirect 'error', NO Authorization header, streaming byte cap

// normalizers/sbom.ts
export interface SbomSummary {
  format: 'spdx' | 'cyclonedx'; specVersion: string | null; generatedAt: string | null;
  packages: number | null; withoutLicense: number | null; flagged: number | null;
  licenses: { id: string; count: number }[]; otherLicenses: number;
  ecosystems: { id: Ecosystem; count: number }[];
  partial: boolean;
}
export function summariseSpdx(doc: unknown, flaggedLicenses: readonly string[]): SbomSummary | null; // null = invalid
```

- GitHub provider:
  - `requestDependencySbom`: `client.request('GET /repos/{owner}/{repo}/dependency-graph/sbom/generate-report', { headers: { 'X-GitHub-Api-Version': '2026-03-10' } })`; extract the UUID from `sbom_url` with `/\/dependency-graph\/sbom\/fetch-report\/([0-9a-fA-F-]{36})$/`; no match → `invalid-data`.
  - `fetchDependencySbom`: `client.request('GET …/fetch-report/{sbom_uuid}', { request: { redirect: 'manual' } })`. `202` → `{ state: 'pending' }`. `302` → `downloadBounded(location, { allowedHostSuffixes: SBOM_DOWNLOAD_HOST_SUFFIXES, maxBytes: policies.supplyChain.sbom.maxBytes, timeoutMs: 20_000 })` → `{ state: 'ready', text }`. `DownloadError('host')` → `fail({ classification: 'invalid-data', message: 'SBOM download host not allowed' })`; `'too-large'` → `fail({ classification: 'invalid-data', message: 'SBOM too large', incomplete: true })`.
  - `SBOM_DOWNLOAD_HOST_SUFFIXES = ['githubusercontent.com', 'github.com']` (exact host or `.`-suffix match). Pass the `maxBytes` through the provider constructor options.
  - Errors through `classifyGitHubError` (a 403/404 whose message says the dependency graph is not enabled must classify `not-configured`; extend the `NOT_CONFIGURED` regex with `dependency graph`).
- Mock fixture key on `RepoFixture`: `dependencySbom?: { pending: true } | { document: unknown } | { expand: SbomExpand } | ErrorFixture`, where `SbomExpand = { name: string; spdxVersion?: string; created: string; packages: { count: number; license: string | null; purl: string | null }[]; extra?: { name: string; license: string | null; purl: string | null }[] }`. The mock builds a valid SPDX 2.3 document: a root package `com.github.<repo>` with a `DESCRIBES` relationship, then `count` packages named `synthetic-<purl>-<i>` (`purl` `pkg:<type>/synthetic-<i>@1.0.0`, `licenseConcluded` = `license` or `NOASSERTION`), then `extra`. `pending` makes every fetch return `{ state: 'pending' }`.
- `summariseSpdx` rules: spec §5.2 step 3. Root package = target of `relationships[].relationshipType === 'DESCRIBES'` from `SPDXRef-DOCUMENT`; if absent, no package is excluded.

- [ ] **Step 1: Write failing tests**
  - `sbom.test.ts` (documents built in-test):
    - `excludes the DESCRIBES root package` (root + 3 packages → packages 3);
    - `licenseConcluded NOASSERTION falls back to licenseDeclared MIT`;
    - `both NOASSERTION → withoutLicense`;
    - `top 10 + otherLicenses` (12 distinct ids with counts 12…1 → `licenses.length` 10, `otherLicenses` 3);
    - `LicenseRef-acme folds into LicenseRef-*`;
    - `"MIT AND (Apache-2.0 OR BSD-3-Clause)" kept verbatim`;
    - `"<script>" license counts in otherLicenses`;
    - `ecosystems from purl: pkg:npm → npm, pkg:bitbucket → other, no purl → unknown`;
    - `flagged counts GPL-3.0-only case-insensitively inside an expression`;
    - `spdxVersion "SPDX-3.0" or missing packages → null (invalid)`;
    - `100001 packages → packages null, partial true`;
    - `result JSON never contains a package name` (`JSON.stringify(result)` has no `synthetic-`).
  - `bounded-fetch.test.ts` (injected fetch):
    - `rejects http:`;
    - `rejects host evil.com and githubusercontent.com.evil.com`;
    - `accepts objects.githubusercontent.com`;
    - `never sends an Authorization header` (spy on the request headers);
    - `passes redirect: 'error'`;
    - `throws too-large after maxBytes + 1 streamed bytes without reading the rest`.
  - `github-provider.test.ts`:
    - `requestDependencySbom extracts the uuid from sbom_url`;
    - `requestDependencySbom with a foreign sbom_url path → invalid-data`;
    - `fetchDependencySbom 202 → pending`;
    - `fetchDependencySbom 302 to an allowed host → ready text`;
    - `fetchDependencySbom 302 to https://evil.example → invalid-data, no download request made`;
    - `403 "Dependency graph is disabled for this repository" → not-configured; plain 403 → not-authorised`;
    - `both calls send X-GitHub-Api-Version 2026-03-10`.

- [ ] **Step 2: Run and see them fail**

  `npx vitest run tests/unit/sbom.test.ts tests/unit/bounded-fetch.test.ts tests/unit/github-provider.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run again** (same command) and `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(collector): SBOM summary from the asynchronous dependency-graph export`

---

### Task 3: Release-asset attestations, analyses by tool, alert category, supply-chain summary artifact

**Files:**

- Modify: `collector/src/providers/types.ts`, `collector/src/providers/github/github-provider.ts`, `collector/src/providers/mock/mock-provider.ts`
- Test: `tests/unit/github-provider.test.ts`

**Interfaces:**

```ts
// ReleaseDTO gains
assets: { name: string; digest: string | null }[];   // digest kept only if /^sha256:[0-9a-f]{64}$/
// CodeScanningAlertDTO gains
category: string | null;                            // most_recent_instance.category
// CodeScanningAnalysisDTO gains
category: string | null;
export interface AttestationPresenceDTO { provenance: boolean; sbom: boolean }
export interface SupplyChainSummaryArtifactDTO { summaryText: string | null; createdAt: string | null; runUrl: string | null }
// SourceProvider gains
getAttestationPresence(repo: string, digest: string): Promise<ProviderResult<AttestationPresenceDTO>>;
listCodeScanningAnalyses(repo: string, tool: string, ref: string): Promise<ProviderResult<CodeScanningAnalysisDTO[]>>;
getSupplyChainSummary(repo: string, branch: string): Promise<ProviderResult<SupplyChainSummaryArtifactDTO>>;
```

- `getAttestationPresence`: two calls `client.request('GET /repos/{owner}/{repo}/attestations/{subject_digest}', { subject_digest, predicate_type: 'provenance' | 'sbom', per_page: 1, headers: { 'X-GitHub-Api-Version': '2026-03-10' } })`. `attestations.length > 0` → true; 404 → false; 403 on either → `not-authorised`. The response body beyond `attestations.length` is never read into the DTO.
- `listCodeScanningAnalyses`: `rest.codeScanning.listRecentAnalyses({ owner, repo, tool_name: tool, ref, per_page: 10 })`, mapped to `{ createdAt, toolName, category }`. Replace v0.8.0's Scorecard-specific method with a call to this one.
- `getSupplyChainSummary`: refactor the quality artifact reader into `private getSummaryArtifact(repo, branch, { artifact, file, maxBytes })` and use it for both `hub-quality-summary` and `hub-supply-chain-summary` (`supply-chain-summary.json`, 65 536 bytes). Behaviour identical to the quality reader (newest non-expired default-branch artifact, size check before download, `readZipEntry`).
- Release assets come from the existing latest-release response (`assets[].name`, `assets[].digest`); no new call.
- Mock fixture keys: `latestRelease.assets?`, `attestations?: Record<digest, AttestationPresenceDTO | ErrorFixture> | ErrorFixture`, `codeScanningAnalyses?: Record<toolName, CodeScanningAnalysisDTO[] | ErrorFixture>`, `supplyChainSummary?` (same shape as `qualitySummary`), alert fixtures may carry `category`.

- [ ] **Step 1: Write failing tests** (`github-provider.test.ts`)
  - `latest release maps assets with digest; a "sha1:…" digest becomes null`;
  - `getAttestationPresence sends predicate_type provenance then sbom with per_page 1`;
  - `getAttestationPresence 404 → { provenance: false, sbom: false }`;
  - `getAttestationPresence 403 → not-authorised`;
  - `the DTO has exactly the keys provenance and sbom` (no `bundle`);
  - `listCodeScanningAnalyses passes tool_name, ref refs/heads/main, per_page 10 and maps category`;
  - `alerts map most_recent_instance.category`;
  - `getSupplyChainSummary picks the newest default-branch artifact named hub-supply-chain-summary and reads supply-chain-summary.json`;
  - `getSupplyChainSummary rejects size_in_bytes 65537 as invalid-data without downloading`;
  - `getQualitySummary behaviour unchanged` (existing tests stay green).

- [ ] **Step 2: Run and see them fail**: `npx vitest run tests/unit/github-provider.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run again**, plus `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(collector): release attestations, analyses by tool and supply-chain summary artifact`

---

### Task 4: External HTTP client, provider credentials, SonarQube provider and mocks

**Files:**

- Create: `collector/src/providers/external/http.ts`
- Create: `collector/src/providers/external/auth.ts`
- Create: `collector/src/providers/external/types.ts`
- Create: `collector/src/providers/external/sonarqube.ts`
- Create: `collector/src/providers/external/mock.ts` (mock SonarQube / Harbor / Argo CD reading `fixtures/providers/<id>.json`)
- Test: `tests/unit/external-http.test.ts` (new), `tests/unit/external-auth.test.ts` (new), `tests/unit/sonarqube-provider.test.ts` (new)

**Interfaces:**

```ts
// http.ts
export interface ExternalClientOptions {
  id: ProviderId;
  baseUrl: string;
  timeoutSeconds: number;
  authHeader: string | null; // null → every call fails not-authorised without a request
  fetch?: typeof globalThis.fetch;
}
export interface ExternalClient {
  getJson(
    template: string,
    params: Record<string, string>,
    query?: Record<string, string>,
    opts?: { headers?: Record<string, string>; doubleEncode?: string[] },
  ): Promise<ProviderResult<unknown>>;
}
export function createExternalClient(o: ExternalClientOptions): ExternalClient;
export const MAX_EXTERNAL_BYTES = 1_048_576;

// auth.ts
export type ProviderAuth = Record<ProviderId, { enabled: boolean; authHeader: string | null }>;
export function resolveProviderAuth(
  providers: ProvidersFile,
  env?: NodeJS.ProcessEnv,
): ProviderAuth; // throws ProviderAuthError on half Harbor creds

// types.ts
export interface SonarProjectDTO {
  linesToCover: number | null;
  uncoveredLines: number | null;
  newCoverage: number | null;
  qualityGate: 'OK' | 'ERROR' | null;
  analysedAt: string | null;
  revision: string | null;
}
export interface QualityProvider {
  readonly id: 'sonarqube';
  getProject(key: string, branch?: string): Promise<ProviderResult<SonarProjectDTO>>;
}
export interface RegistryProvider {
  readonly id: 'harbor';
  getArtifact(
    project: string,
    repository: string,
    reference: string,
  ): Promise<ProviderResult<HarborArtifactDTO>>;
}
export interface DeploymentProvider {
  readonly id: 'argocd';
  getApplication(app: {
    name: string;
    namespace?: string;
    project?: string;
  }): Promise<ProviderResult<ArgoApplicationDTO>>;
}
export interface ExternalProviders {
  sonarqube: QualityProvider | null;
  harbor: RegistryProvider | null;
  argocd: DeploymentProvider | null;
} // null = off
```

- `getJson`:
  - Template placeholders `{name}` are replaced by `encodeURIComponent(params.name)`, twice for names in `doubleEncode`. Query values are encoded with `URLSearchParams`.
  - `new URL(path, baseUrl)`; throw `Error('external host mismatch')` **before** fetching if `url.host !== new URL(baseUrl).host` or `url.protocol !== 'https:'`.
  - `fetch(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(...), headers: { Accept: 'application/json', 'User-Agent': 'engineering-project-hub-collector', ...(authHeader ? { Authorization: authHeader } : {}), ...opts.headers } })`.
  - Read the body through a reader with the 1 MiB cap; over → `invalid-data` ("response too large").
  - Classification table of spec §5.6; messages fixed: `"not authorised"`, `"not found"`, `"rate limited"`, `"request failed"`, `"invalid response"`. Never include the body, the URL or headers.
  - `authHeader: null` → `fail({ classification: 'not-authorised', message: 'credential not set' })` without calling fetch.
- `resolveProviderAuth`: `SONARQUBE_TOKEN` → `Bearer`; `HARBOR_ROBOT_NAME` + `HARBOR_ROBOT_SECRET` → `Basic base64(name:secret)`; `ARGOCD_TOKEN` → `Bearer`. Disabled providers → `{ enabled: false, authHeader: null }`. Mock source → `authHeader: 'mock'` for enabled providers (never used by the mock).
- SonarQube provider: spec §5.6 calls 1 and 2 (`/api/measures/component`, `/api/project_analyses/search`). Zod-project the responses (strict on the fields read, passthrough ignored), parse numbers from strings, normalise `+0100` offsets to `+01:00` before `z.iso.datetime({ offset: true })`. `project_status` is never called.
- Mock external providers: `fixtures/providers/sonarqube.json` = `{ "<key>": SonarProjectDTO | ErrorFixture }` (with `@now` tokens), same pattern for Harbor (`"<project>/<repository>:<reference>"`) and Argo CD (`"<namespace|->/<name>"`). Missing key → `not-found`.

- [ ] **Step 1: Write failing tests**
  - `external-http.test.ts` (injected fetch spy):
    - `builds https://sonar.example.com/sonar/api/measures/component?component=a%3Ab from baseUrl with context root`;
    - `param "../../admin" stays encoded and host unchanged`;
    - `param "@evil.com" and "//evil.com" cannot change the host`;
    - `doubleEncode: "team/api" → "team%252Fapi"`;
    - `passes redirect 'error' and a timeout signal`;
    - `401 and 403 → not-authorised; 404 → not-found; 429 → rate-limited; 500 → error; fetch rejection (timeout) → error; invalid JSON → invalid-data`;
    - `error message never contains the URL, the token or the body` (body `{"message":"ghp_<36 chars>"}`);
    - `1 MiB + 1 byte → invalid-data`;
    - `authHeader null → not-authorised and fetch not called`.
  - `external-auth.test.ts`:
    - `sonarqube enabled + SONARQUBE_TOKEN → "Bearer <t>"`;
    - `harbor name without secret throws ProviderAuthError`;
    - `harbor both → "Basic " + base64("robot$hub+reader:s3cret")`;
    - `enabled without token → authHeader null`;
    - `disabled provider ignores its variables`.
  - `sonarqube-provider.test.ts`:
    - `maps lines_to_cover 8000, uncovered_lines 1100, alert_status OK, new_coverage period value 88.5`;
    - `reads new_coverage from periods[0].value on older servers`;
    - `normalises "2026-01-14T10:00:00+0100" to "2026-01-14T10:00:00+01:00"`;
    - `sends branch when sonarBranch is set`;
    - `never requests /api/qualitygates/project_status` (spy on all URLs);
    - `missing metric → null, not 0`.

- [ ] **Step 2: Run and see them fail**: `npx vitest run tests/unit/external-http.test.ts tests/unit/external-auth.test.ts tests/unit/sonarqube-provider.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run again**, plus `npm run typecheck && npm run lint`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(collector): audited external HTTP client and SonarQube provider`

---

### Task 5: Harbor and Argo CD providers

**Files:**

- Create: `collector/src/providers/external/harbor.ts`, `collector/src/providers/external/argocd.ts`
- Modify: `collector/src/providers/external/types.ts`, `collector/src/providers/external/mock.ts`
- Test: `tests/unit/harbor-provider.test.ts` (new), `tests/unit/argocd-provider.test.ts` (new)

**Interfaces:**

```ts
export interface HarborArtifactDTO {
  digest: string | null; // sha256 regex or null
  scan: {
    status: 'success' | 'error' | 'running' | 'pending' | 'not-scanned';
    endTime: string | null;
    critical: number | null;
    high: number | null;
    medium: number | null;
    low: number | null;
    unknown: number | null;
    fixable: number | null;
    total: number | null;
  } | null;
  signatures: { cosign: boolean; notation: boolean };
}
export interface ArgoApplicationDTO {
  sync: 'synced' | 'out-of-sync' | 'unknown' | null;
  health: 'healthy' | 'progressing' | 'degraded' | 'suspended' | 'missing' | 'unknown' | null;
  revision: string | null;
  targetRevision: string | null;
  images: string[];
  deployedAt: string | null;
}
```

- Harbor: `getJson('/api/v2.0/projects/{project}/repositories/{repository}/artifacts/{reference}', …, { with_scan_overview: 'true', with_accessory: 'true', with_tag: 'false' }, { doubleEncode: ['repository'], headers: { 'X-Accept-Vulnerabilities': 'application/vnd.security.vulnerability.report; version=1.1, application/vnd.scanner.adapter.vuln.report.harbor+json; version=1.0' } })`.
  - Scan: first value of `scan_overview`; `scan_status` `Success` → success, `Error` → error, `Running` → running, `Pending`/`Scheduled` → pending; no overview → `not-scanned`. Severity keys `Critical`, `High`, `Medium`, `Low` → the hub fields; `Negligible`, `Unknown`, `None` summed into `unknown`. A missing key in `summary.summary` with a successful scan → 0 (Harbor omits zero severities **(BC; verify on a real instance and record in `security.md`)**).
  - Signatures from `accessories[].type`: `signature.cosign`, `signature.notation`.
  - The scanner name, vulnerability list, labels and tags are never projected.
- Argo CD: `getJson('/api/v1/applications/{name}', { name }, { appNamespace?, project? })`. Map `Synced`/`OutOfSync`/`Unknown` and `Healthy`/`Progressing`/`Degraded`/`Suspended`/`Missing`/`Unknown` (case-sensitive per API; anything else → `unknown`). `targetRevision` from `spec.source.targetRevision`, else `spec.sources[0].targetRevision`, scrubbed with `scrubIdentifier(…, 100)`. `images` from `status.summary.images` (≤ 50 strings ≤ 300 chars). `deployedAt` = `status.operationState.finishedAt`, else the last `status.history[].deployedAt`. Nothing else is read.
- Mock: Harbor and Argo CD fixtures keyed as in Task 4.

- [ ] **Step 1: Write failing tests**
  - `harbor-provider.test.ts`:
    - `requests /api/v2.0/projects/alpha/repositories/team%252Fbackend/artifacts/1.4.0 with the three query flags and the X-Accept-Vulnerabilities header`;
    - `maps Success with {Critical:0, High:0, Medium:2, Low:6}, fixable 3, total 8`;
    - `Negligible 4 + Unknown 1 → unknown 5`;
    - `Running → running, counts null`;
    - `accessories signature.cosign → cosign true, notation false`;
    - `404 → not-found; 401 → not-authorised`;
    - `the DTO never contains the scanner name` (fixture scanner name `ghp_` + 36 chars).
  - `argocd-provider.test.ts`:
    - `GET /api/v1/applications/alpha-dev?appNamespace=argocd&project=alpha`;
    - `never sends a refresh query parameter` (assert on the URL);
    - `maps OutOfSync/Progressing`;
    - `targetRevision from spec.sources[0] when spec.source is absent`;
    - `deployedAt falls back to the last history entry`;
    - `repoURL "https://git.internal.example/canary-6c1d.git" is not in the DTO`;
    - `403 → not-authorised`.

- [ ] **Step 2: Run and see them fail**: `npx vitest run tests/unit/harbor-provider.test.ts tests/unit/argocd-provider.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run again**, plus `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(collector): Harbor and Argo CD read-only providers`

---

### Task 6: Control resolution, supply-chain section, Security reasons, mapped-tool findings

**Files:**

- Create: `collector/src/normalizers/control-sources.ts`
- Create: `collector/src/normalizers/supply-chain.ts`
- Modify: `collector/src/normalizers/security-model.ts` (`toRepositoryControls` uses the resolver; `toFindings` sets `category` for mapped tools)
- Modify: `collector/src/evaluators/health.ts` (`evaluateSecurity` reasons)
- Test: `tests/unit/control-sources.test.ts` (new), `tests/unit/supply-chain.test.ts` (new), `tests/unit/evaluators.test.ts`, `tests/unit/security-model.test.ts` (or the existing normaliser test file)

**Interfaces:**

```ts
// control-sources.ts
export interface ControlCandidate {
  source: ControlSource;
  state: ControlState | 'off';
  evidence: ControlEvidence | null;
  tool: string | null; lastScanAt: string | null; counts: SeverityCounts | null; reportUrl: string | null;
}
export function resolveControl(control: ControlId, required: boolean,
  candidates: Partial<Record<ControlSource, ControlCandidate>>, order: readonly ControlSource[]): ControlStatus;
export function matchToolRule(rules: ToolRule[], toolName: string | null, category: string | null): boolean;
export function toolCandidate(ctx, control, rules, analyses: Map<string, ProviderResult<CodeScanningAnalysisDTO[]>>, alerts: CodeScanningAlertDTO[]): ControlCandidate;
export function harborContainerCandidate(images: HarborImageResult[]): ControlCandidate;
export function sbomCandidates(summary: ParsedSupplyChainSummary, dg: SbomResult): { 'supply-chain-summary': ControlCandidate; 'dependency-graph': ControlCandidate };
export function signatureCandidates(summary, attestations: AttestationResult, harbor: HarborImageResult[]): {...};

// supply-chain.ts
export function buildSupplyChain(input: SupplyChainInput, ctx: BuildContext): SupplyChain;
export function externalCountsFrom(controls: RepositoryControls[]): SeverityCounts; // only winning harbor / status-file
```

- `resolveControl` implements spec §5.1 steps 1–5 exactly. `off` candidates are skipped. With no candidate at all → `not-configured`, `source: null`.
- Native controls keep their code path and get `source: 'github'`, `evidence: 'reported'`.
- `build-snapshot.ts`' external count sum (today: every non-native control with counts) is replaced by `externalCountsFrom`, which ignores controls whose `source` is `code-scanning`, `dependency-graph`, `attestations` or `supply-chain-summary`.
- `toFindings`: a code-scanning alert matching a `toolControls` rule gets `category` `container` / `iac` / `dast`.
- `buildSupplyChain`: spec §5.10 shape, one entry per unique repository (component ids aggregated, monorepo once). Totals:
  - `repositories` = entries; `sbomAvailable` = entries with SBOM `available` or `partial`, `null` when every entry is `unknown` / `not-authorised` / `pending`;
  - `signedImages` = image rows with signature `verified` or `present`; `unsignedImages` = rows with `missing`, `not-verified` or `failed`;
  - `attestedAssets` = Σ `withProvenance` of `available` entries; `null` when none is `available` and some is `not-authorised` / `unknown`; else 0;
  - `flagged` = Σ `flagged`, `null` when no SBOM is available.
  - Image `name` withheld (`null`) when `publication.audience: 'public'` and the repository is not public.
- `evaluateSecurity`: `supply-chain-unsigned-artifact` (`params { count: unsignedImages + assets checked without provenance, repositories }`) and `supply-chain-flagged-license` (`params { count: flagged, repositories }`), levels from `policies.supplyChain.levels`, placed after severity reasons and before `coverage-incomplete`.

- [ ] **Step 1: Write failing tests**
  - `control-sources.test.ts`:
    - `first definitive wins: [code-scanning: not-configured, harbor: enabled, status-file: enabled] → harbor`;
    - `definitive later beats non-definitive earlier: [code-scanning: not-authorised, harbor: off, status-file: enabled] → status-file`;
    - `no definitive: [code-scanning: not-authorised, status-file: not-configured] → not-authorised (source code-scanning)`;
    - `all off → not-configured, source null`;
    - `notApplicableControls wins over every source`;
    - `stale counts as definitive; failed counts as definitive`;
    - `code-scanning Trivy analysis @now-2d → enabled, @now-9d → stale (securityScanStaleDays 7), none → not-configured, 403 → not-authorised`;
    - `matchToolRule: { tool: 'trivy', category: 'trivy-config' } matches Trivy/trivy-config-k8s, not Trivy/trivy-image`;
    - `harbor: all scanned → enabled; one Error → failed; Running → configured-not-run; scannedAt older than securityScanStaleDays → stale`;
    - `signature: summary all verified → enabled/verified; one not-verified → failed; attestations 1 of 2 with provenance → failed; 2 of 2 → enabled/present; assets without digest → unknown; harbor cosign on all → enabled/present`.
  - `supply-chain.test.ts`:
    - `externalCountsFrom ignores a containerScanning control won by code-scanning` (counts 0/1/0/0 on that control → sum 0);
    - `externalCountsFrom adds only the winning harbor counts (0/0/2/6), never the status-file counts (0/0/1/3) of the same control`;
    - `monorepo: three components on one repository → one entry with componentIds [coordinator, web, api]`;
    - `totals for an alpha-like input: repositories 5, sbomAvailable 3, signedImages 3, unsignedImages 0, attestedAssets 1, flagged 0`;
    - `all unknown → sbomAvailable null, flagged null`;
    - `public audience + private repo → image name null, digest kept`.
  - `evaluators.test.ts`:
    - `defaults: unsigned artifacts add supply-chain-unsigned-artifact at info and the status is unchanged`;
    - `levels.unsignedArtifact amber turns a green Security amber`;
    - `flagged 2 → supply-chain-flagged-license info with count 2`.
  - normaliser test: `a Checkov alert gets category iac; a CodeQL alert keeps code`.

- [ ] **Step 2: Run and see them fail**: `npx vitest run tests/unit/control-sources.test.ts tests/unit/supply-chain.test.ts tests/unit/evaluators.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run again**, plus `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(collector): control source precedence and supply chain section`

---

### Task 7: Quality with SonarQube, Versions with Argo CD

**Files:**

- Modify: `collector/src/normalizers/quality.ts` (`normaliseSonarProject`), `collector/src/evaluators/quality.ts` (report keys, selection, rows)
- Modify: `collector/src/normalizers/versions.ts` (`toEnvironments`)
- Modify: `collector/src/evaluators/health.ts` (`evaluateVersion` reasons)
- Test: `tests/unit/quality.test.ts`, `tests/unit/versions.test.ts` (or the existing versions test file), `tests/unit/evaluators.test.ts`

**Interfaces:**

```ts
// quality.ts (normaliser)
export function normaliseSonarProject(key: string, result: ProviderResult<SonarProjectDTO>, policies: Policies, now: Date):
  { quality: RepoQuality & { qualityGate: 'passed' | 'failed' | null; newCoverage: number | null; source: 'sonarqube' }; error: CollectionError | null };

// evaluators/quality.ts
export interface QualityInput {
  components: { componentId: string; repository: string; applicable: boolean; sonarKey: string | null }[];
  ciReports: Map<string, RepoQuality>;            // key = repository.toLowerCase()
  sonarReports: Map<string, SonarQuality>;        // key = sonar project key
  sources: readonly ('ci-summary' | 'sonarqube')[];
  findings: Map<string, ProviderResult<CodeQualityFindingDTO[]>>;
  collectedAt: string;
}
export function selectReport(candidates: { key: string; source: 'ci-summary' | 'sonarqube'; report: RepoQuality }[],
  sources: readonly string[]): { key: string; source: ...; report: RepoQuality } | null;

// versions.ts
export function toEnvironments(config: ProjectConfig, manifest: ReleaseManifest | null, coordinator: string | null,
  deployments: Map<string, ProviderResult<ArgoApplicationDTO> | 'off'>, coordinatorTags: TagDTO[],
  images: { componentId: string; path: string }[]): EnvironmentSnapshot[];
```

- `selectReport`: spec §5.7 (readable by precedence → stale by precedence → `not-authorised`, `invalid`, `expired`, `unknown` → `missing`).
- Aggregation: Σ over unique `key` of the selected reports (`repo:<repository lowercase>` or `sonar:<key>`). `sharedRepository` = more than one applicable component selected the same key.
- `qualityGate` and `newCoverage` on a row come from the component's Sonar report when it is `readable` or `stale`, whatever source supplied the coverage.
- `quality-gate-failed`: level `policies.quality.qualityGateFailed`, `params.components`.
- Sonar mapping: `linesValid = linesToCover`, `linesCovered = linesToCover − uncoveredLines`; either null → `unknown`; `uncovered > linesToCover` or negative → `invalid` + `invalid-data` error (source `sonarqube`); `tool = 'sonarqube'`, `commitSha = revision`, `generatedAt = analysedAt`, `runUrl = null`.
- `toEnvironments`: spec §5.9. Deployed version: `normaliseVersion(targetRevision)` if it parses; else `revision` (40 hex) → coordinator tag name with that SHA → `normaliseVersion`; else `null`. `version = deployed ?? declared`; `source = deployed ? 'argocd' : declared ? 'manifest' : 'unknown'`; `revision` published as the first 7 hex characters (or the version-like `targetRevision`). `images`: for each `status.summary.images` entry, strip the host (first segment containing `.` or `:` or equal to `localhost`) and the tag; keep it only when the path equals a component's `<project>/<repository>`; at most 20.
- `evaluateVersion` adds `environment-out-of-sync` (`params.environments`), `environment-degraded`, `environment-deployment-unknown` (Argo CD mapped, state not `available`), with the policy levels; `environment-behind` / `environment-mismatch` keep using `status`.

- [ ] **Step 1: Write failing tests**
  - `quality.test.ts`:
    - `beta-like with Sonar web 1950/3000: percentage 66.7, measured 3, no quality-report-missing, quality-gate-failed(components "web") at info, status amber`;
    - `alpha-backend: CI 6800/8000 readable and Sonar 6900/8000 readable → CI wins (sources default), row source ci-summary, qualityGate passed`;
    - `sources [sonarqube, ci-summary] → Sonar wins for alpha-backend`;
    - `readable Sonar beats stale CI summary even when ci-summary is first`;
    - `nothing readable: CI unknown (skipped) + Sonar not-authorised → row not-authorised, reason quality-report-not-authorised`;
    - `two components in one repository with different Sonar keys count separately (linesValid 3000 + 2000)`;
    - `monorepo without Sonar keys still counts the CI summary once`;
    - `normaliseSonarProject: uncovered 9000 > lines 8000 → invalid + invalid-data error source sonarqube`;
    - `qualityGateFailed amber caps a green project at amber`.
  - versions test:
    - `targetRevision v1.4.0 → version 1.4.0, source argocd, status aligned vs coordinator 1.4.0`;
    - `targetRevision HEAD + unknown revision → version = declared 1.4.0, source manifest, deployment.version null`;
    - `revision equal to the v3.1.0 tag SHA resolves to 3.1.0`;
    - `403 → deployment.state not-authorised, version from the manifest`;
    - `argocd off → deployment null, behaviour identical to v0.9.0`;
    - `images: harbor.example.invalid/alpha/backend:1.4.0 → backend 1.4.0; registry.internal.example/canary-img-4d2e:1.0 dropped`;
    - `revision published as 7 characters`.
  - `evaluators.test.ts`:
    - `OutOfSync → environment-out-of-sync info, status unchanged`;
    - `environmentDegraded amber → Versions amber`;
    - `deployment not-authorised → environment-deployment-unknown info`.

- [ ] **Step 2: Run and see them fail**: `npx vitest run tests/unit/quality.test.ts tests/unit/versions.test.ts tests/unit/evaluators.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run again**, plus `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(collector): SonarQube as a Quality source and Argo CD deployed environments`

---

### Task 8: Wire collection, snapshot 1.7, run providers, fixtures and goldens, collect workflow, CSV

**Files:**

- Modify: `shared/model/enums.ts` (`SNAPSHOT_SCHEMA_VERSION = '1.7'`, `SUPPORTED = ['1.7']`, history comment `1.7: supply chain evidence, external providers, deployed environments`)
- Modify: `shared/model/snapshot.ts`:
  - `ControlStatusSchema` gains `source`, `evidence`;
  - `ProjectSnapshot.supplyChain`; `ProjectSummary.supplyChain: { repositories, sbomAvailable, unsignedImages, flagged }`;
  - `QualityHealth.perComponent[]` gains `source`, `qualityGate`, `newCoverage`;
  - `EnvironmentSnapshotSchema` (spec §5.9); `RunMetadata.providers`;
  - `CollectionErrorSchema.source` and `staleSources[].source` additions (spec §5.10).
- Modify: `collector/src/collectors/collect.ts`:
  - `RepoData` gains `sbomRequest`, `sbomFetch`, `attestations: Map<digest, ProviderResult<AttestationPresenceDTO>> | 'skipped'`, `analyses: Map<tool, ProviderResult<CodeScanningAnalysisDTO[]>>`, `supplyChainSummary`;
  - `collectRepository` issues `requestDependencySbom` first (only when `supplyChain.enabled` **and** `sbom.dependencyGraph` are true; with the default `false` no request is made and `capabilities.dependencyGraph` stays `not-used`), runs the other calls, then polls `fetchDependencySbom` (≤ `pollAttempts` waits of `pollIntervalSeconds`; inject the sleep through `CollectContext.sleep` so tests use 0);
  - `RawProjectData` gains `sonar: Map<key, ProviderResult<SonarProjectDTO>>`, `harbor: Map<ref, ProviderResult<HarborArtifactDTO>>`, `argocd: Map<envId, ProviderResult<ArgoApplicationDTO> | 'off'>`, collected through `ExternalProviders` with a per-provider limiter of 2 and the `maxItems` cap (beyond → `fail({ classification: 'error', message: 'cap reached' })`).
- Modify: `collector/src/build-snapshot.ts`: build candidates → `toRepositoryControls` with `resolveControl` → `externalCountsFrom` → `evaluateSecurity` / coverage; `buildSupplyChain`; quality with `QualityInput` v2; `toEnvironments` with deployments; summary fields; errors (`dependency-sbom`, `attestations`, `supply-chain-summary`, `code-scanning-analyses`, `sonarqube`, `harbor`, `argocd`; `not-configured` dependency graph is not an error; SBOM `pending` is not an error).
- Modify: `collector/src/run.ts`: capabilities `dependencyGraph` (from `sbomRequest`) and `attestations`; `run.providers` (`off` when disabled; otherwise `available` / `partial` / `not-authorised` / `unknown` with the existing usable/denied rules, `items` = calls made, `errors` = failed items); the report line (spec §5.10); a warning line per enabled provider without credential.
- Modify: `collector/src/index.ts`: build `ExternalProviders` (`createExternalClient` + providers for `github`, mock providers for `mock`) from `loadProviders` + `resolveProviderAuth`; catch `ProviderAuthError` like `AuthConfigError`.
- Modify: `scripts/update-golden-snapshots.ts` (mock providers fixture), `scripts/validate-snapshots.ts` (1.7).
- Modify: `.github/workflows/collect-data.yml`: `workflow_call` secrets `SONARQUBE_TOKEN`, `HARBOR_ROBOT_NAME`, `HARBOR_ROBOT_SECRET`, `ARGOCD_TOKEN` (all `required: false`), mapped only into the `Collect` step `env`; header comment lists them under "Credentials" with "optional external providers (config/providers.yaml), never printed". Mirror the secrets pass-through in `deploy-pages.yml` / `rw-hub-cloudflare-deploy.yml` where `collect-data.yml` is called with explicit secrets.
- Modify: `src/pages/exports/versions.csv.ts` (columns appended), create `src/pages/exports/supply-chain.csv.ts` (spec §5.11), `src/lib/routes.ts` if `exportHref` needs the new name.
- Modify: `config/projects/project-alpha.yaml`, `project-beta.yaml`, `project-gamma.yaml` (mappings below), `fixtures/github/*.json`, create `fixtures/providers/providers.yaml`, `fixtures/providers/sonarqube.json`, `fixtures/providers/harbor.json`, `fixtures/providers/argocd.json`.
- Then `npm run fixtures:update` and `npm run validate:snapshots`.
- Test: `tests/integration/collector.test.ts`, `tests/integration/site.test.ts` (version literal and CSV), `tests/unit/csv-exports.test.ts` (or the v0.7.0 CSV test file).

**Fixture values (exact):**

Catalog mappings:

| Project file  | Target       | Mapping                                                                                                                                      |
| ------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| project-alpha | backend      | `sonarProjectKey: example-org_project-alpha-backend`, `containerImages: [{ project: alpha, repository: backend }]`                           |
| project-alpha | frontend     | `containerImages: [{ project: alpha, repository: frontend }]`                                                                                |
| project-alpha | environments | dev `{ name: alpha-dev, namespace: argocd, project: alpha }`, uat `alpha-uat`, prod `alpha-prod` (same namespace and project); test unmapped |
| project-beta  | api          | `containerImages: [{ project: beta, repository: api }]`                                                                                      |
| project-beta  | web          | `sonarProjectKey: example-org_project-beta-web`                                                                                              |
| project-beta  | environments | dev `beta-dev`, prod `beta-prod` (`namespace: argocd`, `project: beta`); uat unmapped                                                        |
| project-gamma | service      | `sonarProjectKey: example-org_project-gamma-service`                                                                                         |

`fixtures/providers/providers.yaml`: the three providers `enabled: true`, `baseUrl` `https://sonarqube.example.invalid`, `https://harbor.example.invalid`, `https://argocd.example.invalid`, defaults otherwise.

GitHub fixtures (`dependencySbom` uses the `expand` form; `created: "@now-1h"`):

| Repository fixture        | `dependencySbom`                                                                                                                                                                   | Release assets / `attestations`                                                                      | `supplyChainSummary` (`createdAt @now-1d`, `generatedAt @now-1d`)                                                                                                                                                                                                                                   | Analyses / alerts                                                                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| project-alpha-coordinator | 12 × `MIT` / `githubactions`                                                                                                                                                       | none                                                                                                 | none                                                                                                                                                                                                                                                                                                | —                                                                                                                                                             |
| project-alpha-backend     | 119 × `Apache-2.0`/`maven`, 70 × `MIT`/`maven`, 12 × `BSD-3-Clause`/`maven`, 6 × `EPL-2.0`/`maven`, 6 × `null`/`maven`; `extra`: `canary-internal-pkg-7f3a` `Apache-2.0` `maven`   | v1.4.0 asset `backend-1.4.0.jar` digest `sha256:` + `a1`×32 → `{ provenance: true, sbom: true }`     | images: `example-org/project-alpha-backend` tag `1.4.0` digest `sha256:`+`b2`×32, signature verified cosign, provenance verified gh-attestation, sbomAttestation verified; no `sbom` block                                                                                                          | —                                                                                                                                                             |
| project-alpha-frontend    | `$error` not-configured 403 "Dependency graph is not enabled for this repository"                                                                                                  | none                                                                                                 | `sbom`: cyclonedx 1.6 syft, packages 812, withoutLicense 9, licenses MIT 640, ISC 90, Apache-2.0 50, BSD-2-Clause 20, `LicenseRef-canary-acme-9b2e` 3, ecosystems npm 812; image `example-org/project-alpha-frontend` tag `2.1.0` digest `sha256:`+`c3`×32, signature verified, provenance verified | `ZAP`: one analysis `@now-10d`, category `zap-baseline`, no alerts                                                                                            |
| project-alpha-worker      | `{ "pending": true }`                                                                                                                                                              | v1.2.0 asset `worker-1.2.0.tar.gz` digest `null`                                                     | none                                                                                                                                                                                                                                                                                                | —                                                                                                                                                             |
| project-alpha-helm        | `$error` not-configured 403 (same message)                                                                                                                                         | none                                                                                                 | none                                                                                                                                                                                                                                                                                                | —                                                                                                                                                             |
| project-beta-coordinator  | `$error` not-configured 403                                                                                                                                                        | none                                                                                                 | none                                                                                                                                                                                                                                                                                                | —                                                                                                                                                             |
| project-beta-api          | `$error` not-authorised 403                                                                                                                                                        | v3.2.0 asset `api-3.2.0.tar.gz` digest `sha256:`+`d4`×32; `attestations` `$error` not-authorised 403 | image `example-org/project-beta-api` tag `3.1.0` digest `sha256:`+`e5`×32, signature `missing`, provenance `missing`                                                                                                                                                                                | `Checkov`: analysis `@now-3d`, category `checkov-iac`; alert #21 `CKV_K8S_8`, `securitySeverityLevel: low`, open, category `checkov-iac`, `createdAt @now-3d` |
| project-beta-web          | `$error` not-configured 403                                                                                                                                                        | none                                                                                                 | none                                                                                                                                                                                                                                                                                                | —                                                                                                                                                             |
| project-beta-helm         | `$error` not-configured 403                                                                                                                                                        | none                                                                                                 | none                                                                                                                                                                                                                                                                                                | —                                                                                                                                                             |
| platform-mono             | npm: 1 060 × `MIT`, 200 × `ISC`, 150 × `Apache-2.0`, 40 × `BSD-2-Clause`, 25 × `BSD-3-Clause`, 2 × `GPL-3.0-only`, 3 × `null`; githubactions: 40 × `MIT`, 10 × `MIT OR Apache-2.0` | release `web-v2.0.1` with no assets                                                                  | none                                                                                                                                                                                                                                                                                                | `Trivy`: analysis `@now-1d`, category `trivy-image`, no alerts                                                                                                |
| gamma repos               | untouched (repository unavailable → skipped)                                                                                                                                       | —                                                                                                    | —                                                                                                                                                                                                                                                                                                   | —                                                                                                                                                             |

Platform totals to assert: packages 1 530, withoutLicense 3, npm 1 480, githubactions 50, flagged 2, licenses top: MIT 1 100, ISC 200, Apache-2.0 150, BSD-2-Clause 40, BSD-3-Clause 25, MIT OR Apache-2.0 10, GPL-3.0-only 2.

Provider fixtures:

- `sonarqube.json`:
  - `example-org_project-alpha-backend`: linesToCover 8000, uncoveredLines 1100, newCoverage 88.5, qualityGate OK, analysedAt `@now-1d`, revision `95c7fbdc2c7d81daf6bf050dab7bdd4c1e160a82`;
  - `example-org_project-beta-web`: 3000, 1050, 41.2, ERROR, `@now-2d`, revision `null`;
  - `example-org_project-gamma-service`: `$error` not-authorised 403.
- `harbor.json`:
  - `alpha/backend:1.4.0`: digest `sha256:`+`b2`×32, scan success, endTime `@now-1d`, 0/0/2/6, unknown 0, fixable 3, total 8, cosign true, notation false; raw scanner name in the fixture `ghp_` + 36 alphanumerics (must be dropped by the projection);
  - `alpha/frontend:2.1.0`: `$error` not-found 404;
  - `beta/api:3.1.0`: digest `sha256:`+`e5`×32, scan running, counts null, cosign false, notation false.
- `argocd.json` (key `argocd/<name>`):
  - `alpha-dev`: synced, healthy, targetRevision `v1.4.0`, revision 40 hex `f`×40, images `harbor.example.invalid/alpha/backend:1.4.0`, `harbor.example.invalid/alpha/frontend:2.1.0`, `registry.internal.example/canary-img-4d2e:1.0`, deployedAt `@now-2d`, raw `repoURL` `https://git.internal.example/canary-6c1d.git`;
  - `alpha-uat`: out-of-sync, progressing, targetRevision `HEAD`, revision `0`×40, images `[]`, deployedAt `@now-5h`;
  - `alpha-prod`: synced, healthy, targetRevision `v1.3.0`, deployedAt `@now-9d`;
  - `beta-prod`: synced, degraded, targetRevision `v3.1.0`, deployedAt `@now-4d`;
  - `beta-dev`: `$error` not-authorised 403.

The mock providers store raw API-shaped JSON for Harbor and Argo CD (so the projection is exercised), and DTO-shaped JSON for SonarQube measures/analyses responses: the builder may choose either per provider, as long as the canaries sit in the raw part that the projection must drop.

- [ ] **Step 1: Write failing tests** (`collector.test.ts`, mock run with `fixtures/providers/providers.yaml`)
  - `schemaVersion "1.7"` (update the literal at the existing assertion lines in `collector.test.ts` and `site.test.ts`);
  - `every project's overall status and score equal the pre-change golden values` (read them from `git show HEAD:fixtures/snapshots/index.json` into a test fixture constant before regenerating: Alpha, Beta, Platform, Gamma);
  - `with config/providers.yaml (all off) no external fetch is made` (fetch spy injected into `createExternalClient` factory) `and Security / coverage / quality / version statuses equal the pre-change goldens`;
  - `alpha-backend containerScanning: source harbor, evidence reported, counts medium 2 low 6; alpha openCounts.medium and .low reflect Harbor, not the status file`;
  - `alpha-frontend containerScanning: source status-file (Harbor not found is non-definitive)`;
  - `platform containerScanning: source code-scanning, state enabled, contributes nothing to externalCounts`;
  - `beta Quality 66.7 amber, row web source sonarqube qualityGate failed, reason quality-gate-failed level info, no quality-report-missing`;
  - `alpha Quality 84.7, row backend source ci-summary qualityGate passed`;
  - `gamma Quality grey, row service state not-authorised`;
  - `beta-api finding #21 category iac`;
  - `supplyChain totals: Alpha { repositories 5, sbomAvailable 3, signedImages 3, unsignedImages 0, attestedAssets 1, flagged 0 }; Beta { 4, 0, 0, 2, null, null }; Platform { 1, 1, 0, 0, 0, 2 }; Gamma { 2, null, 0, 0, null, null }`;
  - `alpha-backend SBOM: packages 214, withoutLicense 6, licenses Apache-2.0 120 / MIT 70 / BSD-3-Clause 12 / EPL-2.0 6, ecosystems maven 214`;
  - `alpha-frontend SBOM source supply-chain-summary, licenses contain LicenseRef-* 3`;
  - `alpha-worker SBOM state pending, packages null`;
  - `environments: alpha dev 1.4.0 argocd aligned; alpha uat source manifest, sync out-of-sync, reason environment-out-of-sync info; alpha prod 1.3.0 argocd behind; beta prod health degraded; beta dev deployment not-authorised version 3.2.0 manifest`;
  - `alpha dev deployment.images = [backend 1.4.0, frontend 2.1.0]`;
  - `run.providers: sonarqube { enabled true, state partial, items 3, errors 1 }, harbor { true, available, 3, 1 }, argocd { true, partial, 5, 1 }`;
  - `capabilities.dependencyGraph partial, capabilities.attestations partial`;
  - `collection-report.md contains "Providers: sonarqube partial (3 items, 1 error) · harbor available (3, 1 error) · argocd partial (5, 1 error)"`;
  - `canaries absent from every output file`: `canary-internal-pkg-7f3a`, `LicenseRef-canary-acme-9b2e`, `git.internal.example`, `canary-img-4d2e`, the Harbor `ghp_` value;
  - `SONARQUBE_TOKEN=sonar-canary-0123456789 set in env and enabled → value absent from output and from stdout` (spawned collector or `runCollection` + writer with captured console).
  - CSV test: `versions.csv header ends with environment_source,declared_version,sync_status,health_status`; `supply-chain.csv has one row per project × repository (12 rows) and platform flagged 2`.

- [ ] **Step 2: Run and see them fail**

  `npx vitest run tests/integration/collector.test.ts tests/unit/csv-exports.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the wiring, the fixtures, the workflow change. Then `npm run schema:generate`, `npm run fixtures:update`, `npm run validate:snapshots`.

  Expected golden `changes.json` differences: new collection errors for Alpha (1: harbor not-found), Beta (3: dependency-sbom, attestations, argocd) and Gamma (1: sonarqube). They are real "new errors" against the v0.7.0–v0.9.0 history fixture; leave the history fixture as is and assert these counts.

- [ ] **Step 4: Run the full check**

  `npm run lint && npm run typecheck && npm test && npm run validate:snapshots && npx actionlint .github/workflows/collect-data.yml` (actionlint via podman if not installed: `podman run --rm -v "$PWD":/repo -w /repo docker.io/rhysd/actionlint:latest .github/workflows/collect-data.yml`). Expected: all PASS.

- [ ] **Step 5: Commit** `feat(collector): supply chain providers in snapshots (schema 1.7)`

---

### Task 9: Site: Supply chain folds, Quality source, Versions badges, Data quality Providers, How to read

**Files:**

- Modify: `src/i18n/en.ts`, `src/i18n/it.ts`. Main EN / IT values:

  | Key                                   | EN                                                                                                                                                                                                 | IT                                                                                                                                                                                                                  |
  | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `supplyChain.title`                   | Supply chain                                                                                                                                                                                       | Catena di fornitura                                                                                                                                                                                                 |
  | `supplyChain.summary`                 | SBOM on {n} of {m} repositories · {k} unsigned images · {f} flagged licenses                                                                                                                       | SBOM su {n} di {m} repository · {k} immagini non firmate · {f} licenze segnalate                                                                                                                                    |
  | `supplyChain.evidence.verified`       | Verified                                                                                                                                                                                           | Verificata                                                                                                                                                                                                          |
  | `supplyChain.evidence.present`        | Present                                                                                                                                                                                            | Presente                                                                                                                                                                                                            |
  | `supplyChain.legend`                  | Present: the signature or attestation exists in GitHub or the registry. Verified: CI verified it with cosign or gh attestation. The hub never verifies signatures itself. Unknown is not unsigned. | Presente: la firma o l'attestazione esiste in GitHub o nel registry. Verificata: la CI l'ha verificata con cosign o gh attestation. L'hub non verifica mai le firme da solo. Sconosciuto non vuol dire non firmato. |
  | `supplyChain.source.dependencyGraph`  | Dependency graph                                                                                                                                                                                   | Grafo delle dipendenze                                                                                                                                                                                              |
  | `supplyChain.source.summary`          | CI summary                                                                                                                                                                                         | Riepilogo CI                                                                                                                                                                                                        |
  | `supplyChain.sbom.pending`            | Still being generated by GitHub                                                                                                                                                                    | GitHub lo sta ancora generando                                                                                                                                                                                      |
  | `supplyChain.licenseRef`              | Custom licenses (LicenseRef) are grouped: their names are not published.                                                                                                                           | Le licenze personalizzate (LicenseRef) sono raggruppate: i loro nomi non vengono pubblicati.                                                                                                                        |
  | `controls.via`                        | via {source}                                                                                                                                                                                       | da {source}                                                                                                                                                                                                         |
  | `quality.source`                      | Source                                                                                                                                                                                             | Fonte                                                                                                                                                                                                               |
  | `quality.gate.passed` / `failed`      | Gate passed / Gate failed                                                                                                                                                                          | Gate superato / Gate non superato                                                                                                                                                                                   |
  | `versions.source.argocd` / `manifest` | Argo CD / Manifest                                                                                                                                                                                 | Argo CD / Manifest                                                                                                                                                                                                  |
  | `versions.declared`                   | declared {v}                                                                                                                                                                                       | dichiarata {v}                                                                                                                                                                                                      |
  | `versions.sync.*`                     | Synced · Out of sync · Unknown                                                                                                                                                                     | Sincronizzata · Non sincronizzata · Sconosciuto                                                                                                                                                                     |
  | `versions.health.*`                   | Healthy · Progressing · Degraded · Suspended · Missing · Unknown                                                                                                                                   | Integra · In corso · Degradata · Sospesa · Mancante · Sconosciuto                                                                                                                                                   |
  | `dataQuality.providers.title`         | Providers                                                                                                                                                                                          | Provider                                                                                                                                                                                                            |
  | `dataQuality.providers.state.*`       | Off · Available · Partial · Not authorised · Unknown                                                                                                                                               | Spento · Disponibile · Parziale · Non autorizzato · Sconosciuto                                                                                                                                                     |
  | `exports.supplyChain`                 | Supply chain (CSV)                                                                                                                                                                                 | Catena di fornitura (CSV)                                                                                                                                                                                           |

  Plus `reasons.*` for the six new codes, `howToRead.supplyChain.*`, the Quality and Versions How-to-read additions, and table headers.

- Create: `src/components/SupplyChainSection.astro` (project fold), `src/components/EvidenceSymbol.astro` (◆ verified, ◇ present, ✕ missing/failed/not-verified, dashed "?" unknown, "–" not applicable; always with visually hidden text).
- Modify: `src/pages/[...lang]/projects/[id].astro` (fold `id="supply-chain"` after Controls coverage / Repository controls and before Quality; Controls coverage cells show `controls.via`), `src/components/QualitySection.astro` (Source column, gate pill, new-code text), `src/pages/[...lang]/security.astro` (card line, fold `id="supply-chain"`, CSV link), `src/pages/[...lang]/versions.astro` (badges, pills, declared, images disclosure), `src/pages/[...lang]/data-quality.astro` (Providers card `id="h-providers"`, capabilities, SBOM lists), `src/pages/[...lang]/how-to-read.astro` (`#supply-chain`).
- Test: `tests/integration/site.test.ts`, `tests/e2e/smoke.spec.ts`, `tests/unit/i18n.test.ts` (parity is automatic).

- [ ] **Step 0: Design-first.** Draw the Supply chain fold, the Versions environment cell and the Providers card as Warm Graphite artboards in the Claude Design canvas (does not block; the owner reviews after delivery). No artifact link in the repository.

- [ ] **Step 1: Write failing tests**
  - `site.test.ts`:
    - `project-alpha page has #supply-chain with "214" packages for project-alpha-backend and the legend text`;
    - `project-beta Controls coverage shows "via" labels; alpha-backend containerScanning says via Harbor`;
    - `evidence symbols always have visually hidden text` (no `.evidence` without `.sr-only` child);
    - `security page has #supply-chain, the CSV link exports/supply-chain.csv and the beta line "unsigned 2"`;
    - `quality section on project-beta shows "SonarQube" and "Gate failed"`;
    - `versions page: alpha dev cell has "Argo CD" and "Synced"; alpha uat has "Out of sync"; beta prod "Degraded"; beta dev "Manifest"`;
    - `data-quality has #h-providers with SonarQube Partial, Harbor Available, Argo CD Partial`;
    - `IT pages: "Catena di fornitura", "Verificata", "Non sincronizzata"`;
    - `built site contains none of the five canaries`;
    - `no "0" rendered for alpha-worker SBOM packages (pending)`.
  - `smoke.spec.ts` (desktop and Pixel 7): `Supply chain fold opens by keyboard`, `security page Supply chain table has no horizontal page overflow at 412 px`.

- [ ] **Step 2: Run and see them fail**: `npx vitest run tests/integration/site.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** with the Warm Graphite tokens (`DESIGN.md`). Run the `ui-ux-pro-max` and `web-design-guidelines` passes on the new folds.

- [ ] **Step 4: Run the full check**

  `npm run lint && npm run typecheck && npm test`, then e2e: `sed 's/4321/4377/g' playwright.config.ts > playwright.tmp.config.ts && npx playwright test -c playwright.tmp.config.ts; rm -f playwright.tmp.config.ts`. Expected: all PASS.

- [ ] **Step 5: Commit** `feat(ui): supply chain folds, Quality sources, Argo CD environments and Providers card`

---

### Task 10: Docs, ADRs 0009 and 0010, changelog, README, design upkeep, PR

**Files** (EN, and the IT mirror under `docs/it/`):

- `docs/configuration.md`: `providers.yaml` (every key, defaults, the `--providers` flag, the mock fixture rule); catalog `sonarProjectKey`, `sonarBranch`, `containerImages`, `argocdApplication`; policies `supplyChain` (each key and default, precedence table, tool rules with categories), `quality.sources`, `quality.qualityGateFailed`, `version.environmentOutOfSync`, `version.environmentDegraded`, `freshness.supplyChainSummaryStaleDays`; the `hub-supply-chain-summary` contract and `config/schema/supply-chain-summary.schema.json`.
- `docs/security.md`:
  - Authorisation model: add **Attestations: read** (new, GitHub App and fine-grained token); Contents: read now also covers the SBOM export; Code scanning alerts: read covers analyses by tool; Actions: read covers the supply-chain summary. Sources and the check date 2026-10-21.
  - A new "External providers" subsection, one row per credential: `SONARQUBE_TOKEN` (user token of a dedicated SonarQube user with **Browse** on the mapped projects only; no Execute Analysis, no Administer), `HARBOR_ROBOT_NAME` / `HARBOR_ROBOT_SECRET` (project robot account with **Read Artifact**, **Read Scan**, **List Accessory** only; set an expiry), `ARGOCD_TOKEN` (local account with only `apiKey`, RBAC `p, role:hub-reader, applications, get, <project>/*, allow`, token with an expiry via `argocd account generate-token --account hub-reader --expires-in 2160h` **(verify the flag on the installed Argo CD version)**). Each: where it is stored (repository or environment secret), that it is mapped only into the Collect step, rotation.
  - Threat model rows: T11 (a provider pointed at another host / SSRF through mapped names → host pinning, encoding, redirect refusal), T12 (secrets or internal data from external APIs → projections, scrubbing, canaries, publication gate with the new env names), T13 (presence mistaken for verification → evidence levels).
  - "Data never published": package names, license texts, `LicenseRef` names, bundles, ZAP request/response data, Sonar issues, Harbor vulnerability lists and scanner names, Argo CD `repoURL` / destination / resources, base URLs.
  - The observed SBOM download host (from a real run; if not yet observed, say "not yet observed; the allowlist fails closed").
  - The SBOM export request as the single compute call (ADR 0009): off by default, the opt-in switch, and the CI-summary fallback.
- `docs/operations.md`: enabling each provider step by step (config entry, mapping, secret, first run, reading the Providers card); a CI example job for `hub-supply-chain-summary`:

  ```yaml
  supply-chain-summary:
    if: github.ref == format('refs/heads/{0}', github.event.repository.default_branch)
    runs-on: ubuntu-24.04
    permissions:
      contents: read
      packages: read
      attestations: read
    steps:
      - uses: actions/checkout@<sha> # pinned
        with: { persist-credentials: false }
      - name: SBOM (CycloneDX)
        run: syft dir:. -o cyclonedx-json=sbom.cdx.json
      - name: Verify image signature and provenance
        id: verify
        env:
          IMAGE: ghcr.io/${{ github.repository }}@${{ needs.build.outputs.digest }}
        run: |
          sig=verified; cosign verify "$IMAGE" --certificate-identity-regexp "^https://github.com/${GITHUB_REPOSITORY}/" --certificate-oidc-issuer https://token.actions.githubusercontent.com >/dev/null 2>&1 || sig=not-verified
          prov=verified; gh attestation verify "oci://$IMAGE" -R "$GITHUB_REPOSITORY" >/dev/null 2>&1 || prov=not-verified
          echo "sig=$sig" >> "$GITHUB_OUTPUT"; echo "prov=$prov" >> "$GITHUB_OUTPUT"
      - name: Write supply-chain-summary.json
        run: node scripts/write-supply-chain-summary.mjs # jq/node: counts only, see configuration.md
      - uses: actions/upload-artifact@<sha> # pinned
        with:
          { name: hub-supply-chain-summary, path: supply-chain-summary.json, retention-days: 30 }
  ```

  (Document the summary-writing step as an inline `jq` program in the docs, not as a script shipped by the hub.) Also SARIF upload examples for Trivy (`format: sarif`), Checkov (`-o sarif`, keep the default tool name or add a `toolControls` rule) and ZAP (`sarif-json` report), with `github/codeql-action/upload-sarif` and the expected tool names.

- `docs/architecture.md`: data flow (sources → candidates → resolution → evaluation), the external client box and trust boundary rows, snapshot 1.7.
- `README.md` / `README.it.md`: the dimensions text (sources), Views (Supply chain fold, Providers card), roadmap: remove "Harbor, SonarQube, Trivy, Checkov, ZAP, SBOM (CycloneDX/SPDX), Cosign and Argo CD providers".
- `PRODUCT.md`, `DESIGN.md`: the Supply chain fold, evidence symbols, the environment cell.
- Create: `docs/architecture/adr/0009-supply-chain-evidence-github-native-and-ci-summaries.md` and `docs/architecture/adr/0010-optional-external-read-only-providers.md`, plus IT copies under `docs/it/architecture/adr/`. Titles from spec D14. Check the next free numbers with `ls docs/architecture/adr`.
- `CHANGELOG.md`, `## [Unreleased]`: Added (supply chain section and sources, SBOM summary, attestations, supply-chain summary contract, Trivy/Checkov/ZAP mapping, SonarQube, Harbor, Argo CD, providers card, supply-chain.csv), Changed (snapshot 1.7, controls carry source and evidence, environments carry declared and deployed versions, versions.csv columns), Security (new permission Attestations: read, new optional secrets).
- Design upkeep outside the repo: update the Claude Design canvas and the Warm Graphite DS README to match the build. Re-read the artifact files first; never put artifact links in the repo.

- [ ] **Step 1: Write and update the docs.**

- [ ] **Step 2: Check them**: `npx prettier --check . && npm run validate:config && npm test`. Expected: PASS. EN/IT files link to each other.

- [ ] **Step 3: Commit** `docs: supply chain providers, ADR 0009 and 0010`

- [ ] **Step 4: Push and open the PR** — only when the orchestrator asks. `GH_TOKEN=$(gh auth token --user massilp) gh pr create`, title `feat: supply chain providers — SBOM, attestations, Trivy/Checkov/ZAP, SonarQube, Harbor, Argo CD (schema 1.7)`. The PR body lists the new permission (Attestations: read), the four optional secrets, the SBOM export request (ADR 0009) and the golden differences (Task 8). The owner merges.
