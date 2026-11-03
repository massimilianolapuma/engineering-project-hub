# Supply chain providers: SBOM, signatures and attestations, Trivy / Checkov / ZAP, SonarQube, Harbor, Argo CD — design

> **Update 2026-11-03 (rebased on `main` after v0.10.0 and team dashboards):** this release now takes snapshot schema **1.8**, ADRs **0011** and **0012**, and ships as **v0.12.0** (team dashboards shipped alone as v0.11.0). Read 1.7 / ADR 0009 / ADR 0010 / v0.10.0 below accordingly. The site design system is now GitHub Primer (ADR 0009), not Warm Graphite.

Italiano: [../../it/superpowers/specs/2026-10-21-supply-chain-providers-design.md](../../it/superpowers/specs/2026-10-21-supply-chain-providers-design.md)

Status: builder's design under the roadmap program (owner reviews after delivery) · Date: 2026-10-21 · Target release: v0.10.0

Parent spec: [2026-10-21-roadmap-program-design.md](2026-10-21-roadmap-program-design.md) (§2 constraints, §4 "v0.10.0 Supply chain providers", §5 anti-goals). It is binding. Every decision in this document not fixed there is the **builder's call** and is marked **(BC)**.

Depends on, all merged before this release:

- v0.7.0 ([2026-10-21-history-trends-design.md](2026-10-21-history-trends-design.md)): `shared/model/primitives.ts`, CSV exports (`src/lib/csv.ts`, `src/pages/exports/*.csv.ts`), history 1.0.
- v0.8.0 ([2026-10-21-repository-controls-design.md](2026-10-21-repository-controls-design.md)): snapshot 1.5, ADR 0007, the code-scanning analyses call filtered by `tool_name` (Scorecard), the `info | amber | red` level enum.
- v0.9.0 ([2026-10-21-risk-governance-design.md](2026-10-21-risk-governance-design.md)): snapshot 1.6, history 1.2, ADR 0008, `countsAsOpen`, the optional `<configDir>/<file>.yaml` + mock fixture pattern (D13 there).

This release takes snapshot schema **1.7**, **ADR 0009** and **ADR 0010**. History stays **1.2** (§5.11).

## 1. Intent and why

The README roadmap lists six supply-chain items: SBOM (CycloneDX / SPDX), Cosign signatures and attestations, Trivy / Checkov / ZAP, SonarQube, Harbor and Argo CD. The controls `containerScanning`, `iacScanning`, `dast`, `sbom` and `artifactSignature` already exist in the model, but today their only source is the self-reported `.security/project-security-status.json`. The owner wants the hub to read the same evidence where it actually lives: in GitHub first, and optionally in the company's SonarQube, Harbor and Argo CD.

Facts checked on 2026-10-21 (sources in §9):

- **Dependency graph SBOM export.** `GET /repos/{o}/{r}/dependency-graph/sbom` returns SPDX JSON (`sbom.spdxVersion`, `sbom.creationInfo.created`, `sbom.packages[]` with `name`, `versionInfo`, `licenseConcluded`, `licenseDeclared`, `externalRefs[]` with `referenceType` / `referenceLocator`, and `relationships[]`). **It carries a closing-down notice: "will not be accessible after November 13, 2026"**, three weeks from today. The replacement is asynchronous:
  - `GET …/dependency-graph/sbom/generate-report` "triggers a job to generate" an SPDX SBOM and returns `201 { sbom_url }`;
  - `GET …/dependency-graph/sbom/fetch-report/{sbom_uuid}` returns `202` while processing and `302` to a temporary download URL when ready. The report is kept up to one week.
  - All three need fine-grained / GitHub App **Contents: read**, already granted.
- **Artifact attestations.** `GET /repos/{o}/{r}/attestations/{subject_digest}` (digest `sha256:<hex>`) lists attestations with `bundle`, `bundle_url`, `repository_id`, `initiator`; optional `predicate_type` (`provenance`, `sbom`, `release` or custom), `per_page` ≤ 100. It needs the new permission **Attestations: read**. GitHub says the signatures and timestamps should be cryptographically verified (for example with `gh attestation verify`). A digest is required: there is no "list by repository".
- **Release assets carry a digest.** The release asset object has a required, nullable `digest` field. The hub already reads the latest release of each component.
- **Code-scanning tool names.** Trivy writes SARIF driver name **`Trivy`** (`pkg/report/sarif.go`). Checkov writes **`Checkov`** by default (it can be changed with `--custom-tool-name`). ZAP's `sarif-json` report writes **`ZAP`**. Code scanning stores the driver name as the alert's and analysis' tool name; the analyses list accepts `tool_name` (v0.8.0). ZAP's SARIF also embeds `webRequest` / `webResponse` (cookies, bodies), which the hub never reads: only alert counts by tool reach it.
- **SonarQube.** The Web API recommends `Authorization: Bearer <token>` with a **user token**. `GET /api/measures/component?component=<key>&metricKeys=…` requires **Browse** on the project. Metric keys: `alert_status` (quality gate, `OK` or `ERROR`), `lines_to_cover`, `uncovered_lines` (so line coverage = (lines_to_cover − uncovered_lines) / lines_to_cover, the same quantity as the hub's CI summary), `new_coverage` (blended line and condition coverage on new code; returned under `period` / `periods`). `GET /api/project_analyses/search?project=<key>&ps=1` (Browse) returns the last analysis `date` and `revision`. Dates look like `2017-03-01T11:39:03+0100` (no colon in the offset). `GET /api/qualitygates/project_status` is **deprecated on SonarQube Cloud since 16 September 2025**, so the hub reads the gate from `alert_status` instead.
- **Harbor v2.0 API.** `GET /api/v2.0/projects/{project_name}/repositories/{repository_name}/artifacts/{reference}` (reference = tag or digest) with `with_scan_overview=true` and `with_accessory=true`. `repository_name` containing `/` must be URL-encoded twice (`a/b` → `a%252Fb`). Auth is HTTP Basic (swagger `securityDefinitions: basic`); a project robot account authenticates with its name and secret. The scan overview is keyed by report MIME type and carries `scan_status`, `end_time`, `summary.total`, `summary.fixable`, `summary.summary{Critical,High,…}`. Accessory `type` values include `signature.cosign`, `signature.notation`, `sbom.harbor`. Robot project permissions needed: **Read Artifact**, **Read Scan**, **List Accessory** (all read).
- **Argo CD API.** `GET /api/v1/applications/{name}` with optional `appNamespace` and `project` (with `project`, a missing app is 404 and an app outside the project is 403). `status.sync.status`, `status.sync.revision`, `status.health.status`, `status.summary.images[]`, `status.operationState.finishedAt`, `status.history[]`, `status.reconciledAt`. The **`refresh` query parameter triggers a refresh and must never be sent.** Auth: `Authorization: Bearer <token>`. A local account with only the `apiKey` capability (`accounts.<name>: apiKey` in `argocd-cm`) gets a token from `argocd account generate-token --account <name>`. RBAC: `p, role:<r>, applications, get, <project>/*, allow` (pod logs are a separate `logs` resource and are not needed).

## 2. Goals, non-goals, anti-goals

Goals

- The five non-native security controls get real sources, each with an explicit **source** and **evidence** level, and a documented precedence when several sources answer.
- A **Supply chain** section per project: SBOM summary (package and license counts, never package names), signatures and attestations of released artifacts and images, image vulnerability summaries, and the state of Trivy / Checkov / ZAP.
- **SonarQube** as a second Quality source with explicit precedence against the CI summary, plus the quality gate as an informative signal.
- **Argo CD** as an observed source for environments in the Versions dimension: sync, health and the deployed version, next to the version the manifest declares.
- Every external provider is optional, **off by default**, with its own read-only credential, host allowlist, timeouts and caps, and mock fixtures. Not configured is never healthy and never zero.
- EN + IT UI and docs, Warm Graphite.

Non-goals

- **No cryptographic verification inside the hub.** The hub reports what GitHub, Harbor or CI says (presence or CI-verified). It ships no Sigstore / Cosign library **(BC, ADR 0009)**.
- No package names, versions, purls or license texts published. Counts and SPDX identifiers only.
- No SonarQube issues, hotspots or rules. No Harbor vulnerability lists (only counts). No Argo CD resources tree, manifests, events or logs.
- No write, sync, refresh, scan or SBOM generation in Harbor, SonarQube or Argo CD. The only GitHub call that asks GitHub to compute something is the SBOM export request (§5.2, D3), and it is opt-in and off by default.
- No links to SonarQube, Harbor or Argo CD UIs in this release **(BC)**: Sonar URLs need a query string, which `sanitizeUrl` strips, and the other hosts are internal. Follow-up.
- No new dimension, no new portfolio bar **(BC, D1)**.
- No CycloneDX parsing in the collector: teams that produce CycloneDX publish counts in the CI summary (§5.4).
- No GHCR or other OCI registry API: only Harbor, and image digests reported by CI.

Anti-goals (program §5, specialised)

- A provider that is not configured, or whose credential is missing, shown as healthy, as "0 vulnerabilities" or as "unsigned".
- An attestation shown as "verified" when only its presence is known.
- A project turning red or amber after the upgrade because new sources exist: every new reason defaults to `info`, and with the default config (external providers off) every Security, Controls coverage, Quality and Versions status is unchanged.
- The same vulnerabilities counted twice (Trivy alerts in code scanning **and** a Harbor or status-file count for the same control).
- A credential, an internal base URL, a package name, a raw SBOM, a raw API payload, a cookie from a ZAP report or an Argo CD `repoURL` in any published file.

## 3. Constraints (program §2, unchanged)

Read-only, GET only; static-first; strict Zod allowlist; sanitised text and links with the host allowlist; unknown ≠ zero; 403 ≠ no data; ambiguous 404 = unknown; EN + IT; mock data only in the public demo; Warm Graphite, status never by colour alone, WCAG 2.2 AA; one snapshot bump (1.6 → 1.7); never `npm run ci:build` / `collect:mock`; never port 4321 (e2e on 4377); podman only.

## 4. Decisions in short

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Why                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | No new dimension. Supply-chain evidence feeds the existing controls (Security and Controls coverage), Sonar feeds Quality, Argo CD feeds Versions. A new `supplyChain` section explains the evidence **(BC)**                                                                                                                                                                                                                                                              | The controls already exist; a seventh bar would show the same thing twice                                                            |
| D2  | Each non-native control is resolved from an ordered list of **sources** (`policies.supplyChain.precedence.<control>`). The first source with a definitive answer wins; the control records `source` and `evidence` **(BC)**                                                                                                                                                                                                                                                | Several tools can answer the same question. One winner per control avoids double counting and makes the answer explainable           |
| D3  | SBOM from the **asynchronous** dependency-graph export (generate-report → fetch-report), not the synchronous endpoint named in the program spec. **Off by default**, opt-in with `supplyChain.sbom.dependencyGraph: true`: the export request asks GitHub to run a job, so it is the single exception to the GET-only, no-trigger rule. With it off, the SBOM control comes from the CI summary and otherwise its counts are unknown **(BC, controller ruling, ADR 0009)** | The synchronous endpoint closes on 13 Nov 2026. The export request reads with Contents: read and changes nothing in the repository   |
| D4  | Attestations: one call per digest of the **latest release's assets** (max 5 assets), filtered by `predicate_type` `provenance` and `sbom`. Presence only (`evidence: present`) **(BC)**                                                                                                                                                                                                                                                                                    | The API needs a digest, and release assets are the only digests GitHub gives the hub without CI help                                 |
| D5  | A CI summary artifact **`hub-supply-chain-summary`** (`supply-chain-summary.json`, contract 1.0) carries image digests, Cosign / `gh attestation` verification results and CycloneDX or SPDX counts. CI-verified results have `evidence: verified` **(BC)**                                                                                                                                                                                                                | Same trust model and reader as `hub-quality-summary` (v0.6.0). Image digests and real verification only exist in CI                  |
| D6  | Trivy / Checkov / ZAP are recognised by **code-scanning tool name** (configurable, optional analysis `category` prefix) and mapped to `containerScanning` / `iacScanning` / `dast`. Their alerts change category (`container`, `iac`, `dast`) but stay ordinary findings **(BC)**                                                                                                                                                                                          | They already reach the hub through code scanning; only the mapping was missing                                                       |
| D7  | External providers are configured in a new optional `<configDir>/providers.yaml` (never published). Credentials only from env: `SONARQUBE_TOKEN`, `HARBOR_ROBOT_NAME` + `HARBOR_ROBOT_SECRET`, `ARGOCD_TOKEN` **(BC, ADR 0010)**                                                                                                                                                                                                                                           | Base URLs are infrastructure details; mappings stay in the project files next to the components they describe                        |
| D8  | One shared external HTTP client: https only, exact host of the configured `baseUrl`, `redirect: 'error'`, 20 s timeout, 1 MiB response cap, fixed path templates, no logging, a per-provider concurrency of 2 and a per-run item cap **(BC)**                                                                                                                                                                                                                              | One place to audit; no provider can be pointed at another host by data it reads                                                      |
| D9  | Enabled provider without credential → every item `not-authorised`, run-level provider state `not-authorised`, a warning in the log; the collection does not fail **(BC)**                                                                                                                                                                                                                                                                                                  | Unknown ≠ zero; the rest of the hub stays useful                                                                                     |
| D10 | Quality sources per component: `policies.quality.sources` default `['ci-summary', 'sonarqube']`. A `readable` report beats a `stale` one across sources, then precedence order; with nothing readable the most informative failure is shown **(BC)**                                                                                                                                                                                                                       | The CI summary is tied to the default-branch commit of the repository; Sonar fills the gaps (e.g. a repository without the artifact) |
| D11 | Argo CD: an environment's effective version is the **deployed** version when Argo CD reports one, else the manifest's **declared** version. Both are published. Out-of-sync and degraded add reasons at `info` by default **(BC)**                                                                                                                                                                                                                                         | Observed beats declared; never red overnight                                                                                         |
| D12 | Mock source: `fixtures/providers/providers.yaml` enables the three providers against `fixtures/providers/*.json`; `config/providers.yaml` ships with all three `enabled: false` **(BC)**                                                                                                                                                                                                                                                                                   | The demo shows every feature; a real run never contacts a provider unless the owner opts in (v0.9.0 D13 pattern)                     |
| D13 | Snapshot schema **1.6 → 1.7**. History stays 1.2, `changes.json` unchanged. CSV: `versions.csv` gains columns at the end, new `supply-chain.csv` **(BC)**                                                                                                                                                                                                                                                                                                                  | One bump per release; supply-chain evidence is not a dimension, so it does not enter the trend                                       |
| D14 | ADR 0009: "Supply-chain evidence from GitHub-native sources and CI summaries; the hub reports presence or CI verification, never verifies itself". ADR 0010: "Optional read-only external providers behind one audited HTTP client"                                                                                                                                                                                                                                        | Two documented trust-boundary changes: new GitHub data (and the export request), and the first non-GitHub hosts                      |

## 5. Design

### 5.1 Sources per control (D2)

Source ids (`ControlSourceSchema`):

| Id                     | Data                                                                    | Gives counts?                                |
| ---------------------- | ----------------------------------------------------------------------- | -------------------------------------------- |
| `github`               | native controls (code scanning, Dependabot, secret scanning), unchanged | yes (findings)                               |
| `code-scanning`        | analyses and alerts of a mapped tool (D6)                               | yes, **already findings**: never re-added    |
| `dependency-graph`     | SBOM export (§5.2)                                                      | no                                           |
| `attestations`         | GitHub attestations of release-asset digests (§5.3)                     | no                                           |
| `supply-chain-summary` | `hub-supply-chain-summary` artifact (§5.4)                              | no                                           |
| `harbor`               | Harbor scan overview and accessories (§5.6)                             | yes (image vulnerabilities, external counts) |
| `status-file`          | `.security/project-security-status.json`, unchanged                     | yes (external counts, as today)              |

Default precedence (`policies.supplyChain.precedence`, each list a non-empty subset of the ids allowed for that control, no duplicates):

```yaml
precedence:
  containerScanning: [code-scanning, harbor, status-file]
  iacScanning: [code-scanning, status-file]
  dast: [code-scanning, status-file]
  sbom: [supply-chain-summary, dependency-graph, status-file]
  artifactSignature: [supply-chain-summary, attestations, harbor, status-file]
```

Resolution per (repository, control), pure function `resolveControl(candidates, order)`:

1. Walk the list. The first candidate whose state is `enabled` or `failed` wins; otherwise the first `stale` one (a stale answer never beats a fresher one from a later source). These three states are the **definitive** ones.
2. Otherwise the first candidate whose state is `not-authorised`, `collection-failed`, `unknown` or `configured-not-run` wins (the most informative non-answer).
3. Otherwise `not-configured` (every source said "not set up" or was off).
4. A source that is off (provider disabled, feature switched off) is skipped, never `not-configured` evidence.
5. `notApplicableControls` still wins over everything (unchanged).

`ControlStatus` gains `source: ControlSource | null` and `evidence: 'verified' | 'present' | 'reported' | null`:

- `verified`: CI ran a verification and reported success (`supply-chain-summary`).
- `present`: the evidence exists in GitHub or Harbor, but nobody verified it in this run (`attestations`, `harbor` signatures, `dependency-graph`).
- `reported`: scan results reported by a tool (`code-scanning`, `harbor` scans, `status-file`).

**Counts and double counting.** `externalCounts` (Security) sums the counts of controls whose winning source is `harbor` or `status-file`. A control won by `code-scanning` contributes nothing there, because its alerts are already findings. A losing source never contributes.

Per-source state for each control:

| Control            | Source                 | State                                                                                                                                                                                                                                                                                                          |
| ------------------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| container/iac/dast | `code-scanning`        | newest matching analysis ≤ `securityScanStaleDays` → `enabled`; older → `stale`; no matching analysis → `not-configured`; 403 → `not-authorised`; other errors → `unknown`                                                                                                                                     |
| containerScanning  | `harbor`               | every mapped image scanned (`scan_status` Success) → `enabled` (stale by `end_time`); any `Error` → `failed`; `Running`/`Pending`/none → `configured-not-run`; 401/403 → `not-authorised`; tag 404 → `unknown`                                                                                                 |
| sbom               | `supply-chain-summary` | summary readable with an `sbom` block → `enabled`; summary readable without it → `not-configured`; summary states as in v0.6.0 (missing → `not-configured`, others → `unknown` / `not-authorised`)                                                                                                             |
| sbom               | `dependency-graph`     | export readable → `enabled`; "dependency graph not enabled" (403/404 with that message) → `not-configured`; 403 → `not-authorised`; pending, too large, invalid, other → `unknown`                                                                                                                             |
| artifactSignature  | `supply-chain-summary` | every listed image `signature.status: verified` → `enabled`; any `failed` / `not-verified` → `failed`; any `missing` → `not-configured`; no images → `not-configured`                                                                                                                                          |
| artifactSignature  | `attestations`         | every checked asset has ≥ 1 `provenance` attestation → `enabled`; none has → `not-configured`; some → `configured-not-run` (presence only, never a definitive failure; amended by the final review) **(BC)**; assets without any digest → `unknown`; no release or no assets → skipped; 403 → `not-authorised` |
| artifactSignature  | `harbor`               | every mapped image has a `signature.cosign` or `signature.notation` accessory → `enabled`; none → `not-configured`; some → `failed`                                                                                                                                                                            |

### 5.2 SBOM from the dependency graph (D3)

Collected only when `supplyChain.enabled` (default `true`) **and** `supplyChain.sbom.dependencyGraph` (default **`false`**: opt-in, the one place where the hub asks GitHub to run a job; ADR 0009), once per unique repository.

**Export off (the default).** Nothing is requested (the switch gates only the real GitHub provider; the mock provider serves fixtures whatever it says). The `dependency-graph` source is off and skipped (§5.1 rule 4). The SBOM control is resolved from `supply-chain-summary` (the CI artifact, CycloneDX or SPDX counts) and then `status-file`. With neither, the SBOM counts are unknown (`null`): never healthy and never 0.

1. **Request:** `GET /repos/{o}/{r}/dependency-graph/sbom/generate-report` (header `X-GitHub-Api-Version: 2026-03-10`). `201 { sbom_url }`. The collector extracts the UUID with `^…/dependency-graph/sbom/fetch-report/([0-9a-fA-F-]{36})$` from `sbom_url` and never calls `sbom_url` itself.
   - The request is issued **early** for every repository, before the other calls of that repository, so GitHub works while the hub collects the rest.
2. **Fetch:** after the repository's other calls, `GET …/sbom/fetch-report/{uuid}` with `redirect: 'manual'`.
   - `202` → wait `pollIntervalSeconds` (default 5) and retry, at most `pollAttempts` (default 3) times; still `202` → state `pending` (unknown, never 0).
   - `302` → read `Location`. It must be `https` and its host must end in `githubusercontent.com` or equal `github.com` (code constant `SBOM_DOWNLOAD_HOST_SUFFIXES`; **the implementer records the observed host in `security.md`**). Download it with plain `fetch` **without** the Authorization header, `redirect: 'error'`, a 20 s timeout and a streaming byte cap of `supplyChain.sbom.maxBytes` (default 16 MiB). Over the cap → `too-large`.
3. **Parse and summarise** (pure `summariseSpdx(json, policies)`, `collector/src/normalizers/sbom.ts`), then drop the document:
   - The document must have `spdxVersion` matching `^SPDX-2\.\d$` and a `packages` array; otherwise `invalid` plus an `invalid-data` error with source `dependency-sbom`.
   - The root package (the one the document `DESCRIBES`, i.e. the repository itself) is excluded from the count.
   - `packages` = remaining packages, capped at 100 000 (beyond → `null`, state `partial`).
   - License per package: `licenseConcluded`, else `licenseDeclared`. `NOASSERTION`, `NONE`, empty or missing → **without license**.
   - License expression publication: split on `AND`, `OR`, `WITH`, parentheses. Every token must match `^[A-Za-z0-9.+-]{1,64}$` and the whole ≤ 100 chars, otherwise the package counts in `otherLicenses`. Any `LicenseRef-…` token makes the expression count under the single bucket `LicenseRef-*` (custom names can be internal) **(BC)**.
   - `licenses`: top 10 expressions by count (ties by id), the rest summed into `otherLicenses`.
   - `ecosystems`: from the first `externalRefs` entry with `referenceType: purl`, type `pkg:<type>/…`, mapped through an allow-list (`npm`, `maven`, `pypi`, `nuget`, `golang`, `cargo`, `gem`, `composer`, `githubactions`, `docker`, `pub`, `swift`, `hex`); anything else → `other`; no purl → `unknown`.
   - `flagged`: packages whose expression contains an SPDX id in `supplyChain.sbom.flaggedLicenses` (default `[]`, case-insensitive). Informative only (§5.8).
   - `generatedAt`: `creationInfo.created` when it is a valid ISO date, else `null`.
4. Errors: 403 with "dependency graph … not enabled" text → `not-configured`; other 403 → `not-authorised`; 404 → `unknown` (ambiguous); 5xx / network → `unknown` plus a collection error. All recorded with source `dependency-sbom`.

API budget: 1 request + ≤ 4 fetches + 1 download per repository and run. With 50 repositories every 6 hours this is well inside the rate limits. It only happens when the owner opts in.

### 5.3 Attestations of release assets (D4)

Collected when `supplyChain.attestations.releaseAssets` (default `true`) and the component has a latest **release** (not a tag fallback).

- `ReleaseDTO` gains `assets: { name, digest }[]` (from the latest-release call the hub already makes; no new call). `digest` must match `^sha256:[0-9a-f]{64}$`, otherwise it is ignored.
- At most `supplyChain.attestations.maxAssets` (default 5) assets with a digest, sorted by name.
- Per asset: `GET /repos/{o}/{r}/attestations/{digest}?predicate_type=provenance&per_page=1` and the same with `predicate_type=sbom`. Only `attestations.length > 0` is kept. The `bundle` is never read or kept.
- 404 → none for that asset (the endpoint answers 404 when nothing matches; an unknown repository is already caught by metadata). 403 → `not-authorised` for the repository (stop calling). Other → `unknown`.
- Repository summary: `release` (tag), `checked` (assets with a digest), `withProvenance`, `withSbom`, `withoutDigest` (assets skipped because GitHub gave no digest).

### 5.4 CI summary artifact `hub-supply-chain-summary` (D5)

Same reader and rules as `hub-quality-summary`: newest non-expired artifact whose run's `head_branch` is the default branch, zip ≤ 64 KB, single entry `supply-chain-summary.json`, strict Zod, `repository` must match (case-insensitive), `generatedAt` older than `freshness.supplyChainSummaryStaleDays` (default 14) → `stale`. Required permission: **Actions: read** (already granted).

Contract 1.0 (`SupplyChainSummarySchema`, `shared/model/contracts.ts`):

```json
{
  "schemaVersion": "1.0",
  "repository": "example-org/project-alpha-frontend",
  "ref": "refs/heads/main",
  "commitSha": "ae4b58f791cf66bf510c92ca102cc34470fbdf7d",
  "generatedAt": "2026-01-14T10:00:00Z",
  "sbom": {
    "format": "cyclonedx",
    "specVersion": "1.6",
    "tool": "syft",
    "packages": 812,
    "withoutLicense": 9,
    "licenses": [{ "id": "MIT", "count": 640 }],
    "ecosystems": [{ "id": "npm", "count": 812 }]
  },
  "images": [
    {
      "name": "example-org/project-alpha-frontend",
      "tag": "2.2.0",
      "digest": "sha256:<64 hex>",
      "signature": { "status": "verified", "tool": "cosign" },
      "provenance": { "status": "verified", "tool": "gh-attestation" },
      "sbomAttestation": { "status": "missing" }
    }
  ]
}
```

- `sbom` optional. `format: cyclonedx | spdx`, `specVersion` `^\d+\.\d+(\.\d+)?$`, `tool` ≤ 40 chars, counts ints ≥ 0 with `withoutLicense ≤ packages`, `licenses` ≤ 20 entries (`id` validated like §5.2 expressions, `LicenseRef-…` folded into `LicenseRef-*`), `ecosystems` ≤ 20 (allow-list of §5.2).
- `images` optional, ≤ 10. `name`: OCI repository path **without registry host** (`^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$`, ≤ 200, and a refine: when there are several segments, the first must not contain `.` or `:` and must not be `localhost`, the rule Docker uses to recognise a registry host); `tag` `^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$` optional; `digest` `^sha256:[0-9a-f]{64}$`.
- Verification statuses: `verified | not-verified | failed | missing`. `tool`: `cosign | notation | gh-attestation | other`.
- Extra keys anywhere → `invalid`. Counts and verification results only: no keys, no certificates, no identities, no Rekor entries.
- One summary per repository, shared by every component on it (like Quality).
- The docs give a minimal CI example (§5.12): syft → CycloneDX → `jq` counts; `cosign verify` and `gh attestation verify oci://…` with `continue-on-error` mapped to statuses; upload with `actions/upload-artifact`, `retention-days: 30`, default branch only.

### 5.5 Trivy, Checkov and ZAP as code-scanning tools (D6)

```yaml
supplyChain:
  toolControls:
    containerScanning: [{ tool: Trivy }]
    iacScanning: [{ tool: Checkov }]
    dast: [{ tool: ZAP }]
```

- Each rule is `{ tool: string ≤ 50, category?: string ≤ 100 }`. `tool` matches the code-scanning tool name case-insensitively; `category`, when given, must be a prefix of the analysis / alert category (for example `{ tool: Trivy, category: trivy-config }` under `iacScanning`). A tool may appear under several controls only with different categories; a refine rejects ambiguous rules.
- Calls: for each distinct tool in the rules, `GET /repos/{o}/{r}/code-scanning/analyses?tool_name=<tool>&per_page=10&ref=refs/heads/<default branch>` (Code scanning alerts: read, already granted), memoised per repository. This generalises v0.8.0's Scorecard call (`listCodeScanningAnalyses(repo, tool, ref)`).
- Alerts are not fetched again: `CodeScanningAlertDTO` gains `category` (from `most_recent_instance.category`) and the existing list is filtered by tool and category.
- Findings of a mapped tool get `category` `container`, `iac` or `dast` instead of `code`. Nothing else changes for them (severity, SLA, exceptions, "What changed").
- The section also lists every tool seen in the repository's alerts that is not mapped and not CodeQL / Scorecard, as "other tools" (names only, scrubbed, max 10) so the owner can add a rule.

### 5.6 External providers (D7, D8, D9)

`<configDir>/providers.yaml` (optional; absent = all off; JSON Schema `config/schema/providers.schema.json`):

```yaml
# yaml-language-server: $schema=./schema/providers.schema.json
schemaVersion: '1.0'
sonarqube:
  enabled: false
  baseUrl: https://sonarqube.example.com # https, no path beyond an optional context root, no credentials
  timeoutSeconds: 20 # 1–60
  maxItems: 200 # project keys per run (1–1000)
harbor:
  enabled: false
  baseUrl: https://harbor.example.com
  timeoutSeconds: 20
  maxItems: 200 # image references per run
argocd:
  enabled: false
  baseUrl: https://argocd.example.com
  timeoutSeconds: 20
  maxItems: 200 # applications per run
```

- `baseUrl` refine: `https:` only, no username/password, no query or fragment, path `^(/[A-Za-z0-9._-]+)*/?$`. `enabled: true` requires `baseUrl`.
- The file is loaded by `loadConfig` and never published. Only `enabled` and the resulting provider state reach `index.run.providers`.
- Mock source: `fixtures/providers/providers.yaml` (D12).

**Catalog mappings** (project files; all optional):

| Where                  | Field                                                                          | Used by   |
| ---------------------- | ------------------------------------------------------------------------------ | --------- |
| coordinator, component | `sonarProjectKey: string` (`^[A-Za-z0-9_.:-]{1,400}$`), `sonarBranch?: branch` | SonarQube |
| coordinator, component | `containerImages: [{ project, repository, tagTemplate? }]` (max 5)             | Harbor    |
| environment            | `argocdApplication: { name, namespace?, project? }`                            | Argo CD   |

- Harbor `project` `^[a-z0-9]+(?:[._-][a-z0-9]+)*$`; `repository` OCI path (§5.4 regex). `tagTemplate` default `{version}`, must contain `{version}`, other characters `[A-Za-z0-9._-]`. The reference is the component's `effectiveVersion` (coordinator: its version) rendered with the template; unknown version → image state `unknown` without a call.
- Argo CD `name` and `namespace` `^[a-z0-9]([-a-z0-9]*[a-z0-9])?$` (≤ 253), `project` same.
- `catalog.json` publishes the catalog as today, so these mappings are public in the public demo (synthetic). The docs say so: they contain names, never hosts or credentials.

**Shared client** (`collector/src/providers/external/http.ts`):

- `createExternalClient({ id, baseUrl, timeoutSeconds, authHeader, fetch? })` returns `getJson(pathTemplate, params, query)`.
  - The URL is `baseUrl` + a path built from a fixed template with every parameter `encodeURIComponent`-encoded (Harbor repository names encoded twice). The resulting host must equal the `baseUrl` host, otherwise it throws before any request.
  - `redirect: 'error'`, `AbortSignal.timeout(timeoutSeconds × 1000)`, `Accept: application/json`, `User-Agent: engineering-project-hub-collector`.
  - The body is read as a stream with a 1 MiB cap → over the cap `invalid-data`.
  - Classification: 401 / 403 → `not-authorised`; 404 → `not-found`; 429 → `rate-limited`; other ≥ 400, network, timeout → `error`; JSON parse failure or Zod failure of the projection → `invalid-data`.
  - It never logs, and its errors carry only `{ classification, httpStatus, message }` with a fixed message per class (never the response body, never the URL).
- Concurrency: one limiter of 2 per provider; at most `maxItems` items per run (excess items → `unknown` with detail "cap reached").
- Credentials (`resolveProviderAuth(providers, env)`, `collector/src/providers/external/auth.ts`):
  - SonarQube: `SONARQUBE_TOKEN` → `Authorization: Bearer …`.
  - Harbor: `HARBOR_ROBOT_NAME` and `HARBOR_ROBOT_SECRET` → `Authorization: Basic base64(name:secret)`. One without the other is a configuration error (exit 1), like a partial GitHub App.
  - Argo CD: `ARGOCD_TOKEN` → `Authorization: Bearer …`.
  - Enabled with no credential → D9. Disabled → the variables are ignored.
  - `sensitiveEnvValues()` (`shared/security/patterns.ts`) adds the four names, so the publication gate and `scan-output` catch a leaked value.
- `collect-data.yml`: four new optional `workflow_call` secrets and repository secrets mapped into the `Collect` step's `env` only, with the same "never printed" comment. `vars.PROVIDERS_CONFIG` is not added: `providers.yaml` lives in the config directory (the private deploy repository for real data).

**SonarQube provider** (`collector/src/providers/external/sonarqube.ts`), per mapped key:

1. `GET /api/measures/component?component=<key>&metricKeys=alert_status,lines_to_cover,uncovered_lines,new_coverage[&branch=<sonarBranch>]`.
2. `GET /api/project_analyses/search?project=<key>&ps=1[&branch=…]` → `analyses[0].date` (normalised `+0100` → `+01:00`) and `revision` (40 hex or null).

- DTO `SonarProjectDTO { linesToCover: number|null, uncoveredLines: number|null, newCoverage: number|null, qualityGate: 'OK'|'ERROR'|null, analysedAt: string|null, revision: string|null }`. `new_coverage` is read from `value`, then `period.value`, then `periods[0].value`.
- Mapping to a quality report: `linesValid = lines_to_cover`, `linesCovered = lines_to_cover − uncovered_lines` (both required, `0 ≤ uncovered ≤ lines_to_cover`, else `invalid`); `generatedAt = analysedAt`; `commitSha = revision`; `tool = 'sonarqube'`; staleness by `qualityReportStaleDays`. 404 → `missing`; 401 / 403 → `not-authorised`.

**Harbor provider** (`collector/src/providers/external/harbor.ts`), per mapped image reference:

- `GET /api/v2.0/projects/{project}/repositories/{repository}/artifacts/{reference}?with_scan_overview=true&with_accessory=true&with_tag=false` with header `X-Accept-Vulnerabilities: application/vnd.security.vulnerability.report; version=1.1, application/vnd.scanner.adapter.vuln.report.harbor+json; version=1.0`.
- DTO `HarborArtifactDTO { digest, scan: { status, endTime, critical, high, medium, low, unknown, fixable, total } | null, signatures: { cosign: boolean, notation: boolean } }`. The first scan-overview entry is used; severities map `Critical/High/Medium/Low` to the hub scale and `Negligible/Unknown/None` to `unknown`.
- Image state: `scanned`, `scan-failed`, `scan-pending`, `not-scanned`, `not-found` (404), `not-authorised`, `unknown`.

**Argo CD provider** (`collector/src/providers/external/argocd.ts`), per mapped environment:

- `GET /api/v1/applications/{name}[?appNamespace=…][&project=…]`. **Never** `refresh`.
- DTO `ArgoApplicationDTO { sync: string|null, health: string|null, revision: string|null, targetRevision: string|null, images: string[], deployedAt: string|null }`, projected from `status.sync.status`, `status.health.status`, `status.sync.revision`, `spec.source.targetRevision` (or `spec.sources[0]`), `status.summary.images` (≤ 50), and `status.operationState.finishedAt` falling back to the last `status.history[].deployedAt`. Nothing else (`repoURL`, destination, resources, conditions) is projected.

### 5.7 Quality with SonarQube (D10)

`policies.quality` gains:

```yaml
quality:
  sources: [ci-summary, sonarqube] # order = precedence; one or both
  qualityGateFailed: info # info | amber: a failed Sonar quality gate
```

- Report key: a component with `sonarProjectKey` (and Sonar enabled) has two candidate reports: the repository's CI summary (key `repo:<repository>`) and its Sonar project (key `sonar:<key>`). Without a key it has only the CI summary.
- Selection per component: the first `readable` candidate in `sources` order; else the first `stale`; else the first candidate in this order of states: `not-authorised`, `invalid`, `expired`, `unknown`; else `missing`.
- Aggregation is over **unique report keys** of the selected reports (v0.6.0 summed unique repositories). A monorepo with one CI summary still counts once; two components with different Sonar keys in the same repository count separately.
- `perComponent` rows gain `source: 'ci-summary' | 'sonarqube' | null` and `qualityGate: 'passed' | 'failed' | null` (from Sonar whenever a key is mapped and readable, even if the CI summary supplied the coverage), and `newCoverage: percentage | null`. `sharedRepository` now means "shared report".
- New reason `quality-gate-failed` (level `quality.qualityGateFailed`, default `info`, `params.components`).
- Sonar `not-authorised` / `unknown` errors are collection errors with source `sonarqube`.

### 5.8 Security and Controls coverage reasons

New Security reasons (after the existing severity reasons, before `coverage-incomplete`):

| Code                             | Level (policy, default `info`)        | When                                                                                       |
| -------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------ |
| `supply-chain-unsigned-artifact` | `supplyChain.levels.unsignedArtifact` | any image or release asset with signature/provenance `missing`, `not-verified` or `failed` |
| `supply-chain-flagged-license`   | `supplyChain.levels.flaggedLicense`   | any repository with `flagged > 0`                                                          |

- `params`: `{ count, repositories }` (comma-joined, max 10 then "+N").
- Controls coverage reasons are unchanged in code: the controls simply carry better states. A required control resolved to `unknown` / `not-authorised` is already reported there (`required-control-unknown`, `required-control-not-authorised`), so Security adds no reason for it.
- With default policies every new level is `info`, so no status changes. The demo `config/policies.yaml` sets `flaggedLicenses: [GPL-3.0-only, AGPL-3.0-only]` (informative) and leaves the levels at `info`.

### 5.9 Versions with Argo CD (D11)

`EnvironmentSnapshotSchema` becomes:

```ts
{
  id, name,
  version: string | null,              // effective: deployed if known, else declared
  declaredVersion: string | null,      // manifest
  source: 'argocd' | 'manifest' | 'unknown',
  status: 'aligned' | 'behind' | 'mismatch' | 'unknown',   // effective version vs coordinator
  deployment: null | {                 // null when no argocdApplication is mapped or Argo CD is off
    state: 'available' | 'not-authorised' | 'not-found' | 'unknown',
    sync: 'synced' | 'out-of-sync' | 'unknown' | null,
    health: 'healthy' | 'progressing' | 'degraded' | 'suspended' | 'missing' | 'unknown' | null,
    revision: string | null,           // 7-char short SHA, or a version-like ref
    version: string | null,
    deployedAt: isoDate | null,
    images: { componentId: string, version: string | null }[],   // max 20
  },
}
```

- Deployed version: `normaliseVersion(targetRevision)` when it parses as a version; else `revision` (40 hex) resolved to a coordinator tag through the existing `listTags` data; else `null` **(BC)**.
- `images`: each `status.summary.images` entry `host/path:tag` whose path (host removed) equals a component's mapped `<project>/<repository>`; tag → `normaliseVersion`. Unmatched images are dropped (never published).
- New Versions reasons: `environment-out-of-sync` (level `version.environmentOutOfSync`, default `info`), `environment-degraded` (`version.environmentDegraded`, default `info`), `environment-deployment-unknown` (`info`, Argo CD mapped but not readable). The existing `environment-behind` / `environment-mismatch` use the effective version.
- Argo CD 403 / 404 / errors are collection errors with source `argocd` and the `environment` id in `detail`.

### 5.10 Snapshot model (schema 1.6 → 1.7)

`shared/model/enums.ts`:

- `SNAPSHOT_SCHEMA_VERSION = '1.7'`, `SUPPORTED = ['1.7']`, history comment `1.7: supply chain evidence, external providers, deployed environments`.
- `ControlSourceSchema`, `ControlEvidenceSchema`, `ProviderIdSchema = z.enum(['sonarqube','harbor','argocd'])`, `ProviderStateSchema = z.enum(['off','available','partial','not-authorised','unknown'])`.
- `CapabilitySchema` adds `dependencyGraph`, `attestations` (GitHub) — external providers are in `run.providers`, not in capabilities.
- Reason codes: the two of §5.8, `quality-gate-failed`, the three of §5.9.

`shared/model/snapshot.ts`:

```ts
ControlStatusSchema gains: source: ControlSourceSchema.nullable(), evidence: ControlEvidenceSchema.nullable()

SupplyChainSchema = z.object({
  enabled: z.boolean(),
  collectedAt: isoDate,
  totals: z.object({
    repositories, sbomAvailable, signedImages, unsignedImages, attestedAssets, flagged: nullableCount,
  }).strict(),
  repositories: z.array(z.object({
    componentIds: z.array(z.string().max(64)).min(1),
    repository: z.string().max(200),
    sbom: z.object({
      state: z.enum(['available','partial','not-configured','not-authorised','pending','too-large','invalid','unknown','off']),
      source: z.enum(['supply-chain-summary','dependency-graph']).nullable(),
      format: z.enum(['spdx','cyclonedx']).nullable(),
      specVersion: z.string().max(20).nullable(),
      generatedAt: isoDate.nullable(),
      packages: nullableCount, withoutLicense: nullableCount, flagged: nullableCount,
      licenses: z.array(z.object({ id: z.string().max(100), count: int ≥ 0 }).strict()).max(10),
      otherLicenses: int ≥ 0,
      ecosystems: z.array(z.object({ id: EcosystemSchema, count: int ≥ 0 }).strict()).max(16),
    }).strict(),
    attestations: z.object({
      state: z.enum(['available','none','not-authorised','unknown','not-applicable','off']),
      release: z.string().max(100).nullable(),
      checked: int ≥ 0, withProvenance: nullableCount, withSbom: nullableCount, withoutDigest: int ≥ 0,
    }).strict(),
    images: z.array(z.object({
      componentId: z.string().max(64),
      source: z.enum(['supply-chain-summary','harbor']),
      name: z.string().max(200).nullable(),          // null = withheld (public audience, non-public repo)
      tag: z.string().max(128).nullable(),
      digest: z.string().regex(/^sha256:[0-9a-f]{64}$/).nullable(),
      signature: z.enum(['verified','present','missing','not-verified','failed','unknown']),
      provenance: z.enum(['verified','present','missing','not-verified','failed','unknown']),
      scan: z.object({
        state: z.enum(['scanned','scan-failed','scan-pending','not-scanned','not-found','not-authorised','unknown']),
        scannedAt: isoDate.nullable(),
        counts: SeverityCountsSchema.nullable(),
        fixable: nullableCount,
      }).strict().nullable(),                         // null for CI-summary images
    }).strict()).max(20),
    tools: z.array(z.object({
      control: z.enum(['containerScanning','iacScanning','dast']),
      tool: z.string().max(50),
      state: ControlStateSchema,
      lastAnalysisAt: isoDate.nullable(),
      open: SeverityCountsSchema.nullable(),
    }).strict()).max(10),
    otherTools: z.array(z.string().max(50)).max(10),
    summary: z.object({                               // hub-supply-chain-summary
      state: z.enum(['readable','stale','missing','expired','invalid','not-authorised','unknown','off']),
      generatedAt: isoDate.nullable(), commitSha: sha.nullable(), runUrl: httpsUrl.nullable(),
    }).strict(),
  }).strict()).max(200),
}).strict();
```

Other changes:

- `ProjectSnapshot.supplyChain: SupplyChainSchema`.
- `ProjectSummary.supplyChain: { sbomAvailable, repositories, unsignedImages, flagged }` (counts, `nullableCount` where unknown).
- `QualityHealth.perComponent[]` gains `source`, `qualityGate`, `newCoverage` (§5.7).
- `EnvironmentSnapshotSchema` as in §5.9.
- `RunMetadataSchema` gains `providers: Record<ProviderId, { enabled: boolean, state: ProviderState, items: int ≥ 0, errors: int ≥ 0 }>`.
- `CollectionErrorSchema.source` adds `dependency-sbom`, `attestations`, `supply-chain-summary`, `code-scanning-analyses` (unless v0.8.0's `scorecard-analysis` is generalised to it), `sonarqube`, `harbor`, `argocd`.
- `dataFreshness.staleSources[].source` adds `supply-chain-summary` and `sonarqube`.
- Image `name` is withheld (null) under `publication.audience: public` for non-public repositories (v0.8.0 D9 rule). Digests, tags, states and counts stay.
- `collection-report.md` gains one line: `Providers: sonarqube available (6 items) · harbor available (4) · argocd partial (5, 1 error)` or `Providers: all off`.

### 5.11 History, "What changed" and CSV (D13)

- History stays **1.2**. The new evidence is not a dimension; dimension status moves already appear on the "What changed" page.
- `versions.csv`: columns appended at the end: `environment_source`, `environment_declared_version`, `sync_status`, `health_status` (the file already has a component `declared_version` column: a second one with the same name would make the header ambiguous). `n/a` for non-environment rows and for environments Argo CD does not manage; `unknown` for null.
- New `exports/supply-chain.csv`, linked from the Security page: one row per project × repository: `project_id, repository, component_ids, sbom_state, sbom_source, packages, without_license, flagged, attestation_state, assets_checked, assets_with_provenance, images, images_signed, images_unsigned, container_scanning_source, iac_scanning_source, dast_source, summary_state`. Same encoding rules as v0.7.0 (BOM, CRLF, `unknown`, formula guard). `component_ids` joined with `;`.

### 5.12 UI (Warm Graphite, EN + IT)

Shared rules: every state has text and a symbol; "present" and "verified" are distinct words and symbols (◇ present, ◆ verified, ✕ missing/failed, ? unknown with dashed outline, – not applicable); counts are never shown without their state; unknown counts are "?" never "0".

**Project page:** a new `<details id="supply-chain" class="fold disclosure">` after Controls coverage (and v0.8.0's Repository controls), before Quality.

- Summary line: "SBOM on {n} of {m} repositories · {k} unsigned images · {f} flagged licenses".
- Tiles: SBOM (packages, without license), Signatures (verified / present / missing), Image vulnerabilities (Harbor counts, or "not configured"), Scanners (Trivy · Checkov · ZAP states).
- Per-repository table: SBOM (source badge "Dependency graph" / "CI summary", packages, without license), Attestations ("2 of 3 assets with provenance"), Images (name or withheld · tag · signature · provenance · scan), Tools.
- License list: top licenses as small code tokens with counts; `LicenseRef-*` explained in a tooltip.
- Legend: "Present: the signature or attestation exists in GitHub or the registry. Verified: CI verified it with cosign or gh attestation. The hub never verifies signatures itself. Unknown is not unsigned."
- The Controls coverage table shows a small source label under each non-native control state ("via Trivy", "via Harbor", "via CI summary", "status file").

**Security page:**

- Each project card gains a line "Supply chain: SBOM {n}/{m} · unsigned {k}".
- New fold "Supply chain" / "Catena di fornitura" (`id="supply-chain"`): one row per repository across projects with the same columns as the project table, condensed, and a CSV link (`exports/supply-chain.csv`). On phones, the existing `data-label` pattern.

**Quality section:** a "Source" column ("CI summary" / "SonarQube"), a quality-gate pill ("Gate passed" / "Gate failed"), new-code coverage as secondary text.

**Versions page:** each environment cell shows the effective version, a source badge ("Argo CD" / "Manifest"), and when Argo CD is mapped: sync and health pills ("Synced" / "Out of sync"; "Healthy" / "Progressing" / "Degraded" / …), "declared {v}" when it differs, and the deployed component images in a disclosure.

**Data quality page:** a "Providers" card: SonarQube / Harbor / Argo CD with Off / Available / Partial / Not authorised / Unknown and item and error counts; the `dependencyGraph` and `attestations` capabilities; lists of repositories with SBOM pending / too large / invalid and invalid supply-chain summaries.

**How to read:** a new section `#supply-chain` "Supply chain evidence" / "Evidenze di catena di fornitura": sources and precedence, present vs verified, why unknown is not unsigned, SBOM counts and `LicenseRef-*`; the Quality entry mentions SonarQube and precedence; the Versions entry explains declared vs deployed.

**Design-first (standing owner rule):** the Supply chain fold, the Versions environment cell and the Data quality Providers card are drawn as Warm Graphite artboards in the Claude Design canvas before coding. The owner reviews after delivery, so this does not block. After the build, the canvas and the DS README are updated. No artifact link goes into the repository.

### 5.13 Mock data (synthetic; exact values in the plan, Task 8)

`GOLDEN_NOW = 2026-01-15T12:00:00.000Z`. External providers are enabled only by `fixtures/providers/providers.yaml`. The `dependencyGraph` switch gates only the **real GitHub provider's** `generate-report` call. The mock provider returns the fixture SBOM data whatever the switch says (nothing is ever requested from GitHub), so the dependency-graph rows below need no opt-in. The demo `config/policies.yaml` keeps `supplyChain.sbom.dependencyGraph: false`: a real collection run with `config/` never triggers the export.

| Repository / item | SBOM                                                                                                                                                                               | Attestations / images                                                         | Tools / providers                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| alpha-backend     | dependency graph: 214 packages, 6 without license, maven                                                                                                                           | release v1.4.0 asset with digest: provenance ✓ sbom ✓; summary image signed ◆ | Harbor `alpha/backend:1.4.0` scanned 0/0/2/6, cosign present; Sonar 6900/8000 gate OK (CI summary wins) |
| alpha-frontend    | CI summary CycloneDX: 812 packages, 9 without license, 3 `LicenseRef-*`, npm                                                                                                       | summary image signature ◆, provenance ◆                                       | ZAP analysis `@now-10d` → dast stale; Harbor tag not found                                              |
| alpha-worker      | dependency graph pending (three 202) → unknown                                                                                                                                     | release asset without digest → unknown                                        | —                                                                                                       |
| beta-api          | dependency graph 403 → not authorised                                                                                                                                              | attestations 403; summary image signature `missing`                           | Checkov analysis `@now-3d` with 1 low alert (iac); Harbor scan running, no signature                    |
| beta-web          | not enabled → not configured                                                                                                                                                       | —                                                                             | Sonar 1950/3000 = 65 %, gate ERROR, new code 41.2 %                                                     |
| platform-mono     | dependency graph: 1 530 packages (npm 1 480, githubactions 50), 2 GPL-3.0-only (flagged)                                                                                           | no release assets                                                             | Trivy analysis `@now-1d`, category `trivy-image`, 0 alerts                                              |
| gamma-service     | repository unavailable → unknown                                                                                                                                                   | —                                                                             | Sonar 403 → not authorised                                                                              |
| Argo CD           | alpha dev `v1.4.0` Synced/Healthy; alpha uat `HEAD`, unknown revision, OutOfSync/Progressing; alpha prod `v1.3.0` Synced/Healthy; beta prod `v3.1.0` Synced/Degraded; beta dev 403 |                                                                               |                                                                                                         |

Resulting golden story:

- **Every project's overall status and score are unchanged** against the v0.9.0 goldens (all new levels `info`).
- Alpha: containerScanning on alpha-backend is now won by Harbor (medium 2, low 6 instead of the status file's 1 / 3); Security stays amber. uat shows `environment-out-of-sync`.
- Beta: Quality 8404 / 12600 = **66.7 %**, amber (was 67.2 % with web missing); `quality-report-missing` disappears, `quality-gate-failed` (web) appears at `info`. One more low finding (Checkov, category `iac`). `supply-chain-unsigned-artifact` at `info`. prod `environment-degraded`; dev deployment `not-authorised`, version from the manifest.
- Platform: containerScanning `enabled` via code scanning (Trivy, not required); `supply-chain-flagged-license` at `info`.
- Gamma: Quality stays grey; its component row says `not-authorised` (Sonar) instead of `unknown`.
- Canaries: an SPDX package name `canary-internal-pkg-7f3a`, a `LicenseRef-canary-acme-9b2e` license, an Argo CD `repoURL` `https://git.internal.example/canary-6c1d.git`, an unmatched Argo CD image `registry.internal.example/canary-img-4d2e:1.0`, and a Harbor scanner name containing `ghp_` + 36 characters never appear in output.

### 5.14 Docs (EN + IT)

- `configuration.md`: `providers.yaml`; catalog `sonarProjectKey`, `sonarBranch`, `containerImages`, `argocdApplication`; policies `supplyChain`, `quality.sources`, `quality.qualityGateFailed`, `version.environmentOutOfSync`, `version.environmentDegraded`, `freshness.supplyChainSummaryStaleDays`; the supply-chain summary contract and its JSON Schema.
- `security.md`: the permissions table rows (Contents: read for the SBOM export, **Attestations: read** new, Actions: read for the summary, Code scanning alerts: read for analyses), every external credential (`SONARQUBE_TOKEN`: user token of a dedicated user with Browse only; `HARBOR_ROBOT_NAME` / `HARBOR_ROBOT_SECRET`: project robot with Read Artifact, Read Scan, List Accessory; `ARGOCD_TOKEN`: `apiKey`-only local account with `applications, get`), what is never published, the observed SBOM download host, the trust boundary, rotation, and the verification date and sources.
- `operations.md`: enabling each provider; GitHub secrets; CI examples for `hub-supply-chain-summary` (syft, cosign, gh attestation) and for SARIF upload of Trivy / Checkov / ZAP with the expected tool names; reading the Providers card.
- `architecture.md`: data flow, source precedence, the external client and trust boundary rows; snapshot 1.7.
- README / README.it: dimensions text (sources), Views, roadmap: remove the six supply-chain items.
- `PRODUCT.md`, `DESIGN.md`: the Supply chain fold, present vs verified symbols, the environment cell.
- `CHANGELOG.md`; ADR 0009 and ADR 0010 (EN + IT).

## 6. Tests (summary; exact cases in the plan)

- **Unit, model:** providers file (https only, host, enabled needs baseUrl), catalog mappings (regexes, `tagTemplate`), policies defaults and precedence refine, summary contract (extra keys, digest regex, `LicenseRef` folding), JSON Schema drift test (v0.9.0) covers the new schemas.
- **Unit, SBOM:** root package excluded, license fallback and `NOASSERTION`, expression tokenisation, `LicenseRef-*`, top 10 + other, ecosystems from purl, flagged, invalid document, 100 000 cap, package names never in the result.
- **Unit, resolution:** each row of the §5.1 tables; precedence order; off sources skipped; `code-scanning` never adds external counts.
- **Unit, quality:** selection rules, unique report keys, monorepo, Sonar mapping (`uncovered > lines_to_cover` → invalid), gate reason level.
- **Unit, versions:** deployed vs declared, tag resolution of a SHA, unmatched images dropped, reason levels.
- **Provider, GitHub:** generate → fetch 202 ×3 → pending; 302 to a disallowed host → unknown without download; download without Authorization header; byte cap; attestations calls with `predicate_type`; analyses with `tool_name` and `ref`.
- **Provider, external client:** host pinning (a `{param}` containing `../` or `@evil` cannot change the host), `redirect: 'error'`, timeout, 1 MiB cap, classification table, no body or URL in errors, Harbor double encoding, Argo CD never sends `refresh`.
- **Integration:** golden story of §5.13, overall and score unchanged, run providers block, canaries blocked, schema 1.7, report line, providers disabled → no external fetch at all (fetch spy).
- **Site / e2e:** Supply chain fold, legend, Security fold and CSV, Versions badges and pills, Data quality Providers card, How to read section, IT strings, no horizontal overflow at 412 px.

## 7. Risks

- **The SBOM export request is a "compute" call.** It changes nothing in the repository, but it does ask GitHub to run a job. ADR 0009 records it as the single exception. It is therefore **off by default**: the owner opts in with `supplyChain.sbom.dependencyGraph: true`.
- **Undocumented download host.** The 302 target host is not documented. The suffix allowlist fails closed (`unknown`), and the implementer records the observed host.
- **Async latency.** A slow export stays `pending` (unknown) for that run. Polling is bounded (≤ 3 × 5 s per repository, overlapped with other calls).
- **Presence is not verification.** An attestation present in GitHub could in theory belong to a different workflow; the UI says "present", only CI results say "verified".
- **Internal names in `catalog.json`.** Harbor projects, Sonar keys and Argo CD app names are published with the catalog. For real data use the private deploy setup (`audience: restricted`), as the docs already advise.
- **SonarQube Cloud API v2 migration.** `project_status` is deprecated on Cloud; the hub uses measures and analyses, which are not. The docs note that Server and Cloud may move to Web API v2.
- **Drift with v0.7.0–v0.9.0.** File layout (`primitives.ts`, analyses method, level enum, `countsAsOpen`, CSV helpers) and version numbers (snapshot 1.7, ADR 0009–0010) may move. The plan says: take the next free number and adapt.

## 8. Left to the builder (implementer)

- Exact Astro markup of the Supply chain fold and the environment cell, following the Warm Graphite patterns.
- Internal helper names beyond the interfaces in the plan.
- Whether the SBOM byte-capped download uses `Response.body` reader or `node:stream`.
- Whether Harbor and Argo CD share one module or two.

## 9. Sources (checked 2026-10-21)

- SBOM REST (export, closing-down notice 13 Nov 2026, generate-report 201 `sbom_url`, fetch-report 202 / 302, one-week retention): <https://docs.github.com/en/rest/dependency-graph/sboms>
- Fine-grained permissions (SBOM endpoints: Contents read; repository attestations: Attestations read; release assets: Contents read; code-scanning alerts: Code scanning alerts read): <https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens>; GitHub App permissions (same names): <https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps>
- Repository attestations (`GET /repos/{o}/{r}/attestations/{subject_digest}`, `predicate_type`, response fields, "should be cryptographically verified"): <https://docs.github.com/en/rest/repos/attestations>; user attestations: <https://docs.github.com/en/rest/users/attestations>
- Release assets (`digest` field): <https://docs.github.com/en/rest/releases/assets>
- Trivy SARIF driver name `Trivy`: <https://github.com/aquasecurity/trivy/blob/main/pkg/report/sarif.go>
- Checkov SARIF driver name `Checkov`, `--custom-tool-name`: <https://www.checkov.io/8.Outputs/SARIF.html>
- ZAP SARIF report (driver `ZAP`, `webRequest` / `webResponse` content): <https://www.zaproxy.org/docs/desktop/addons/report-generation/report-sarif-json/>
- SonarQube Web API (Bearer user token, Browse for measures): <https://docs.sonarsource.com/sonarqube-server/extension-guide/web-api>; metric definitions (`alert_status`, `lines_to_cover`, `uncovered_lines`, `line_coverage`, `new_coverage`): <https://docs.sonarsource.com/sonarqube-server/user-guide/code-metrics/metrics-definition>; web services list and response examples (`measures/component`, `project_analyses/search`, `qualitygates/project_status` deprecated since 16 Sep 2025 on Cloud): <https://sonarcloud.io/api/webservices/list>
- Harbor v2.0 swagger (get artifact parameters, double-encoded `repository_name`, `X-Accept-Vulnerabilities`, `NativeReportSummary`, `VulnerabilitySummary`, `Accessory`, basic auth): <https://github.com/goharbor/harbor/blob/main/api/v2.0/swagger.yaml>; accessory types: <https://github.com/goharbor/harbor/blob/main/src/pkg/accessory/model/accessory.go>; robot permissions (Read Artifact, Read Scan, List Accessory): <https://goharbor.io/docs/main/administration/robot-accounts/>
- Argo CD API (Bearer, `project` parameter semantics): <https://argo-cd.readthedocs.io/en/stable/developer-guide/api-docs/>; swagger (`GET /api/v1/applications/{name}` parameters incl. `refresh`, `appNamespace`; `ApplicationStatus` fields): <https://github.com/argoproj/argo-cd/blob/stable/assets/swagger.json>; local accounts (`apiKey`, `generate-token`): <https://argo-cd.readthedocs.io/en/stable/operator-manual/user-management/>; RBAC (`applications, get`, `logs` separate): <https://argo-cd.readthedocs.io/en/stable/operator-manual/rbac/>
- Codebase: `collector/src/providers/types.ts` (`SourceProvider`, `ControlProvider`), `collector/src/normalizers/security-model.ts` (`externalControl`, `toRepositoryControls`), `collector/src/build-snapshot.ts` (external counts), `collector/src/normalizers/quality.ts`, `collector/src/evaluators/quality.ts`, `collector/src/normalizers/versions.ts` (`toEnvironments`), `shared/model/contracts.ts`, `shared/security/patterns.ts` (`sensitiveEnvValues`), `.github/workflows/collect-data.yml`.
