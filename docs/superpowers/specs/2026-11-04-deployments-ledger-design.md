# Deployments ledger: every environment in GitHub Deployments — design

Italiano: [../../it/superpowers/specs/2026-11-04-deployments-ledger-design.md](../../it/superpowers/specs/2026-11-04-deployments-ledger-design.md)

Status: draft for the owner's review (builder check done, owner answers folded in) · Date: 2026-11-04 · Target release: **v0.17.0**

## 1. Intent and why

Teams deploy DEV and lab environments with GitHub Actions, so GitHub already knows those deploys
(a job with `environment:` creates a GitHub deployment). The other environments (test, pre-production,
production) are often deployed by systems the hub cannot see: the repository is mirrored to the
customer's Azure DevOps (or Google Cloud, AWS) and its pipelines deploy from there, with approvals.
A typical flow, as the owner described it:

1. a promote pull request on GitHub updates the environment file with the version to install;
2. on merge, a GitHub workflow mirrors the repository to Azure DevOps (ADO);
3. the change starts an ADO pipeline; the owner approves it for the environment, and it deploys;
4. the result of the deploy stays in ADO only.

The control map (v0.16.0) therefore reads the delivery checks of those environments as "deployed by
external pipelines". The owner wants **all environments managed and visible**, not only in the hub:
every repository should show its full deploy history per environment in GitHub, whatever system
deployed it.

**Decision:** GitHub Deployments become the **single ledger** of deploys for every environment of
every repository. External systems write into it in one of three ways (push from the pipeline, a
pull bridge, a declared manual record); the hub reads only the ledger through one new deploy
signal.

## 2. Goals, non-goals, anti-goals

Goals:

- One place (GitHub Deployments of the repository) that lists every deploy of every environment,
  with result, time, commit, version and a link to the run that did it.
- Three ways to write it, chosen per project:
  1. **Push**: a documented step at the end of an external pipeline (ADO first, any CI that can run
     `curl`) reports the deploy and its result.
  2. **Pull bridge**: a scheduled GitHub workflow reads ADO environment deployment records
     (read-only) and transcribes them, without touching the external pipelines.
  3. **Declared**: a manual record (`workflow_dispatch` form) when no system is readable; always
     marked as declared.
- The hub reads the ledger with a new deploy signal `github-deployments`, so the four delivery
  checks of the control map become measurable for every environment, and `environment-separation`
  sees the environments GitHub now knows.
- The same building blocks work for every repository of an organisation, not only the projects in
  the hub catalog.

Non-goals (this release):

- Google Cloud Deploy, AWS CodePipeline or other bridges (the record format is ready for them).
- Import from Jira or other ticketing systems (the declared record covers the need for now).
- Starting, approving or cancelling anything in ADO or GitHub: the bridge only reads ADO.
- Replacing GitHub environment protection rules or ADO approvals.

Anti-goals (failure even if it works):

- A deploy shown as successful that did not happen, or a failure shown as success. Unknown stays
  unknown: a record whose result cannot be read is not written.
- A writer that can change code, workflows, settings or anything other than deployments.
- Credentials of one line or customer able to write deployments of another's repositories
  without it being visible and revocable.
- Customer, company or person names in this public repository (examples stay synthetic).

## 3. Constraints

- Public repository: neutral, synthetic examples only; EN + IT docs.
- Read-only towards the external systems; on GitHub, the writer touches deployments and their
  statuses only.
- Dry-run by default for every writer that can be scheduled (like the notifier, ADR 0013): it writes
  only with an explicit opt-in.
- No new runtime dependency; the bridge and the manual writer are TypeScript scripts in this
  repository run by reusable workflows (`rw-*`), like the collector.
- Podman only for anything containerised (nothing planned).

## 4. Decisions in short

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | GitHub Deployments are the ledger. Environment names on GitHub = the hub catalog's environment `githubEnvironment` (default its `id`): `dev`, `test`, `prod`…                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| D2  | One GitHub App per GitHub organisation for writing, suggested name `<org>-deployment-reporter`, permissions **Deployments: read and write** and Metadata: read only, webhook off, installed on selected repositories. One private key per line or external project, so each can be revoked alone; every token is narrowed to one repository at request time. **Owner decision (2026-11-04)**, accepting the known limit: any key of the App can mint a token for any repository the App is installed on, and GitHub does not record which key wrote; isolation between lines rests on key custody and revocation, and the only permission at stake is Deployments. |
| D3  | Record format (§5.1): deployment on the commit SHA with a JSON `payload` that names the source, the external run and the version; statuses `success` / `failure`; a `log_url` to the external run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| D4  | Idempotent writers: a deploy is identified by `(source, external record id, environment)`, where the record id includes the attempt (ADO environment deployment record id; push step: run id + job attempt). Writing it twice changes nothing; a retried stage is a new record, so a failure then a success reads as one failed deploy plus its restore. (Builder check, builder's call.)                                                                                                                                                                                                                                                                          |
| D5  | The pull bridge is a reusable workflow in this repository (`rw-deployments-bridge.yml`) run on a schedule by a central caller repository (for the owner: the private deploy repository) holding a map file. (Builder's call to confirm; it can be proposed upstream to a shared toolchain later.)                                                                                                                                                                                                                                                                                                                                                                  |
| D6  | ADO authentication for the bridge: Microsoft Entra service principal with workload identity federation from GitHub Actions (no stored secret); a PAT (Environment: read, Build: read) is accepted as a fallback.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D7  | Hub: new deploy signal `github-deployments` (§5.5); the hub App needs **Deployments: read**. Records marked declared count, and the cell says how many were declared.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| D8  | A commit that GitHub does not know (mirror out of sync) is never invented: the record is skipped and listed in the run summary.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D9  | Dry-run default for the bridge and the manual writer; writing needs the input `mode: write` and the repository variable `HUB_DEPLOYMENTS_BRIDGE=write`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D10 | The real deploy time travels in the payload (`startedAt`, `finishedAt`, ISO 8601 UTC): GitHub timestamps are the write time and cannot be backdated. The hub uses `finishedAt` for ledger records and the status time only for records without it (Actions jobs). (Builder check, builder's call.)                                                                                                                                                                                                                                                                                                                                                                 |
| D11 | The bridge reads with the hub's read-only App (Contents: read: commit check, `versionFrom`) and writes with the deployment App: the writer keys never read code. The push step needs no read: GitHub refuses a deployment on an unknown commit (422) and the step reports it. (Builder check, builder's call.)                                                                                                                                                                                                                                                                                                                                                     |
| D12 | One bridge job per (GitHub organisation, ADO tenant): the caller workflow repeats the reusable job with that pair's secrets; the map is split per job. (Builder check, builder's call.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D13 | The hub counts every deployment of the environment by default. The owner's mirror workflow is a plain git mirror and the promote workflow is believed not to use `environment:`, so neither creates deployments. An optional `sources` filter on the signal (e.g. `[azure-devops]`) excludes other creators if a job with `environment:` ever records a deploy that did not happen. (Owner answer; filter is the builder's safety call.)                                                                                                                                                                                                                           |

## 5. Design

### 5.1 Record format (the contract every writer follows)

A deploy of version `V` of commit `SHA` to environment `E`:

- `POST /repos/{owner}/{repo}/deployments` with `ref: SHA`, `environment: E`, `auto_merge: false`,
  `required_contexts: []`, `transient_environment: false`, `production_environment` true only for
  the catalog's delivery environment (or when the writer is told so), `description` ≤ 140
  characters, and:

```json
{
  "payload": {
    "ledger": 1,
    "source": "azure-devops",
    "runId": "12345",
    "runUrl": "https://dev.azure.com/example-org/example-project/_build/results?buildId=12345",
    "attempt": 1,
    "version": "0.5.2",
    "startedAt": "2026-11-04T09:12:00Z",
    "finishedAt": "2026-11-04T09:20:31Z",
    "declared": false,
    "kind": "deploy"
  }
}
```

`source` ∈ `azure-devops`, `manual`, `other` (later `google-cloud-deploy`, `aws-codepipeline`);
`kind` ∈ `deploy`, `rollback` (optional; the hub also infers a rollback from a lower semver);
`version` optional (the hub falls back to the commit); `attempt` default 1; `startedAt` /
`finishedAt` are the real times of the deploy (D10), `finishedAt` required for `success` /
`failure`.

- Then `POST /deployments/{id}/statuses` with `state` `success` or `failure` (`error` is read as
  failure), `log_url` = `runUrl`, `environment_url` optional, `auto_inactive` default.
- Deployments created by GitHub Actions jobs (`environment:`) need no payload: they are already in
  the ledger and the hub reads them the same way (`source` = `github-actions`).
- Idempotency (D4): before creating, the writer lists `GET /deployments?sha=SHA&environment=E` and
  skips if a deployment with the same `payload.source`, `payload.runId` and `payload.attempt`
  exists; a missing final status on an existing record is added.

### 5.2 Push recipe (external pipeline step)

Documented in `docs/deployments-ledger.md` (EN/IT), no code in external repositories:

- an ADO YAML snippet: `DownloadSecureFile@1` for the App key, a bash step that signs a JWT,
  exchanges it for an installation token narrowed to one repository and `deployments: write`, then
  writes the record of §5.1 with `condition: always()` and the job status mapped to the state;
- the same as a generic shell script (`scripts/report-deployment.sh`, copied by the user) for other
  CI systems;
- requirements: outbound HTTPS from the agent to `api.github.com` (Microsoft-hosted agents have it;
  self-hosted agents in a customer network need egress or a proxy); the mirror keeps commit SHAs.

### 5.3 Pull bridge (Azure DevOps)

- `rw-deployments-bridge.yml` (reusable) runs `npm run deployments:bridge` from a verified hub
  release, like `rw-hub-cloudflare-deploy.yml` runs the collector.
- Inputs: `map` (path in the caller repository, default `config/deployments-bridge.yaml`), `mode`
  (`dry-run` default, `write`), `since-days` (default 7; the first run may backfill up to 90).
- Map file (validated with Zod, JSON Schema generated like the other config files):

```yaml
schemaVersion: '1.0'
sources:
  - type: azure-devops
    organization: example-org # dev.azure.com/<organization>
    project: example-project
    environments:
      - ado: prod # ADO environment name
        repository: example-org/example-service # GitHub owner/repo
        github: prod # GitHub environment name
        production: true
        versionFrom: { file: environments/prod.yaml, key: umbrella } # optional
        commitFrom: self # optional: the pipeline repository resource alias holding the mirror
```

- `commitFrom` (default `self`): when the pipeline YAML lives in another ADO repository, the alias
  of the `resources.repositories` entry that is the mirror; its version is the commit. (Builder
  check, builder's call.)

- For each mapped ADO environment: read its deployment records since `since-days` (ADO REST:
  Environments → environment deployment records; the builder confirms the endpoint and
  `api-version` on the Microsoft docs and records them), keep completed records (succeeded →
  `success`, failed → `failure`, canceled/skipped → not written), take the run's source commit,
  check it exists on GitHub (D8), derive `version` if `versionFrom` is set (file at the commit, as
  the versions-file signal does), and write the record of §5.1 (D4).
- ADO auth (D6): the job requests a GitHub OIDC token, exchanges it with Entra for a token on the
  Azure DevOps resource (`499b84ac-1321-427f-aa17-267ca6975798`); the service principal is added to
  the ADO organisation with read access to the project and its environments. Fallback: PAT secret.
- GitHub auth: the deployment App of D2 (installation token per repository).
- Output: a job summary table (environment, records read, written, skipped and why), nothing
  logged that carries tokens; dry-run shows what would be written.
- Bounded: at most 100 records per environment and run, a timeout per call, no retry on POST.

### 5.4 Declared record (manual)

- `rw-deployments-declare.yml` (reusable, `workflow_dispatch` in the caller): inputs repository,
  environment, commit SHA or version, tag prefix (default `v`), result, date (default now), note.
  A version resolves to the commit of tag `<prefix><version>`; a missing tag refuses the record.
  Writes §5.1 with `source: manual`, `declared: true`, `runUrl` = the workflow run, `finishedAt` =
  the date. Same App, same dry-run rule.
- The declare job runs in a protected GitHub environment of the caller repository
  (`deployments-declare`, required reviewers), so a declared deploy needs a second person.
  (Builder check, builder's call.)

### 5.5 Hub: deploy signal `github-deployments`

- Catalog: `deploySignal: { type: github-deployments, repository: coordinator | <component id>, environment?: <GitHub environment name>, tagPrefix?: 'v', sources?: [<source>] }`
  (default environment: the catalog environment's `githubEnvironment ?? id`; `sources` absent =
  every deployment; `github-actions` names deployments without a ledger payload).
- Reading (GET only, hub App with **Deployments: read**): `GET /repos/{o}/{r}/deployments?environment=E&per_page=100`
  (first page, window = trend window), then the statuses of each deployment in the window.
  Bounded: 100 deployments per environment.
- Events: a deployment with a `success` status (even if later `inactive`) = deploy; `failure` /
  `error` = failure; no final status = ignored. Event time = `payload.finishedAt`, else the final
  status time (D10). Rollback = `payload.kind: rollback`, or a lower semver `payload.version` than
  the previous deploy. Lead time: when `payload.version` and the signal's `tagPrefix` (default `v`)
  name a tag, from that tag's commit date, as the `versions-file` signal does; otherwise from the
  deployed commit's date. Delivery metrics as in v0.16.0 (four keys). (Builder check, builder's
  call.)
- The cell names the signal ("GitHub deployments") and, when any record is declared, notes
  "includes N declared".
- Unknown is never 0: a 403 or unreadable list is not visible (`needs-permission` /
  `source-unreadable`) with a `deploy-signal` collection error; an environment with no deployment
  at all in the window is a measured frequency 0 only if the environment has at least one older
  deployment, else not visible ("no deployment recorded").
- `environment-separation` already reads GitHub environments: environments created by the ledger
  make it measurable.

### 5.6 Docs and decisions

- `docs/deployments-ledger.md` (EN/IT): why, the record format, the three writers, the App
  (name, permissions, one key per line), ADO identity setup, the map, dry-run and write.
- ADR 0015: GitHub Deployments as the ledger of every environment; writers outside the hub.
- `docs/control-map.md`: the new signal; `docs/security.md`: the deployment App and the bridge job
  permissions (`id-token: write` for OIDC, no other write).

## 6. Tests (summary)

Unit tests for the record format and idempotency (same run twice writes once), the ADO record
mapping (succeeded / failed / canceled, unknown commit skipped), the map schema, dry-run vs write
gating, the hub signal (success later inactive, failure, rollback by kind and by version, declared
count, 403); mock providers and fixtures for ADO and GitHub deployments; goldens with one demo
project on `github-deployments`; workflow lint (actionlint, zizmor) for the new reusable
workflows. End-to-end against a real ADO organisation is the last step, when one is available.

## 7. Left to the builder

The exact ADO endpoints and `api-version` (verified on the Microsoft docs), file and script names,
the summary layout, the declared form's field limits, and how the bridge reuses the HTTP core of
`shared/http/`.

## 8. Risks

- **Wrong mapping** writes deploys to the wrong repository or environment: the map is reviewed in
  pull requests, and dry-run shows every write before the first `write` run.
- **Mirror drift** (commit not on GitHub): skipped and reported, never invented.
- **Key spread**: one key per line, narrowed tokens, Deployments permission only.
- **Customer consent**: reading a customer's ADO needs their identity setup; the push recipe needs
  their pipeline change. Each project picks what its customer allows.

## 9. Sources

- GitHub REST: deployments and deployment statuses; environments (checked 2026-11-04).
- Microsoft Learn: Azure DevOps environments and deployment history; Microsoft Entra workload
  identity federation and service principals for Azure DevOps (checked 2026-11-04).
- DevOps Research and Assessment, "four keys" (delivery metric definitions, as in v0.16.0).
