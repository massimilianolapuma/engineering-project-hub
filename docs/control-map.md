# Control map

> Italian version: [docs/it/control-map.md](it/control-map.md)

The control map (page `controls/`, since v0.16.0) shows, for each project, **25 technical checks**
that the hub can evidence from the data it already collects, on the 0–5 scale of a DevSecOps
assessment. Each check lists the DORA (Regulation (EU) 2022/2554 and RTS 2024/1774) and ISO/IEC
27001:2022 Annex A references it gives technical evidence for.

**This is not a compliance assessment.** The hub never states that a requirement is met: the
references say which requirements a check is _related_ to. Governance and organisational
requirements (policies, roles, contracts, registers, training, audits) are out of scope. Design:
[ADR 0014](architecture/adr/0014-control-map.md).

## Who sees it

The map is produced only when `publication.audience: restricted`, or with demo data
(`dataSource: mock`). On a public deployment with real data the collector writes no `controlMap`,
and the site has no page, no navigation entry, no CSV and no metrics for it. It can be switched
off with `policies.controlMap.enabled: false`.

## Levels

| Level | Name       | Meaning                                                         |
| ----- | ---------- | --------------------------------------------------------------- |
| 0     | Absent     | The control is not present                                      |
| 1     | Initial    | Ad hoc, no metric, reactive                                     |
| 2     | Repeatable | First pipelines or templates, manual controls, partial measures |
| 3     | Defined    | Standardised, partial coverage                                  |
| 4     | Managed    | Enforced and verifiable, measured continuously                  |
| 5     | Optimised  | Continuous, complete, self-service                              |

- **Not visible** (hatched): the source could not be read, or fewer than half of the
  repositories could. Never counted as 0 and never lowers the score. The cell says why.
- **Not applicable** (blank): nothing to check (no container images, no deploying workflow, no
  environment), or the catalog excludes the check with a reason (`controlMap.notApplicable`).
  A control the catalog marks `required: false` is **still counted**.
- "% of repositories" checks are computed over the repositories that could be read, shown as
  "k of n read".
- **Score** = average of the measured levels × 20 (0–100), with "measured N of M". Below half of
  the applicable checks measured, no score is shown.
- **Business-unit row** = median of its projects' levels for each check (rounded down); its
  score is the median of the project scores.

## Checks

Default ladders; each can be changed in `policies.yaml` (`controlMap.thresholds.<check>`: five
values for levels 1–5). "%" ladders: 1 > 0%, 2 ≥ 25%, 3 ≥ 50%, 4 ≥ the target, 5 = 100%.

| Check                    | Measured                                                                     | Default ladder                                                                                 | Source                                  | DORA (related)           | ISO 27001 Annex A |
| ------------------------ | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------ | ----------------- |
| `sbom-coverage`          | % repositories with an SBOM                                                  | %, 4 ≥ 85%                                                                                     | supply chain                            | art. 8; RTS art. 4–5, 16 | 5.9, 5.21         |
| `image-signature`        | % images (by digest) with a verified signature                               | %, 4 ≥ 85%                                                                                     | supply chain, Harbor                    | RTS art. 16              | 5.21, 8.24        |
| `build-provenance`       | % repositories whose release has provenance attestations                     | %, 4 ≥ 85%                                                                                     | attestations                            | RTS art. 16              | 5.21, 8.25        |
| `license-policy`         | packages with a flagged licence                                              | 5 = 0 with a policy, 3 = 0 without, 1 > 0                                                      | SBOM                                    | RTS art. 16              | 5.32              |
| `dependency-scanning`    | % repositories with Dependabot on                                            | %, 4 ≥ 90%                                                                                     | security controls                       | RTS art. 10              | 8.8               |
| `sast`                   | % repositories with code scanning recent                                     | %, 4 ≥ 90%                                                                                     | security controls                       | art. 25; RTS art. 10, 16 | 8.28, 8.29        |
| `container-scanning`     | % repositories with container scanning                                       | %, 4 ≥ 90%                                                                                     | security controls                       | art. 25; RTS art. 10     | 8.8               |
| `iac-scanning`           | % repositories with IaC scanning                                             | %, 4 ≥ 90%                                                                                     | security controls                       | RTS art. 10, 16          | 8.9               |
| `dast`                   | % repositories with DAST                                                     | %, 4 ≥ 70%                                                                                     | security controls                       | art. 25                  | 8.29              |
| `vulnerability-age`      | critical/high alerts past their remediation deadline                         | 5 = 0 and none due within 7 days, 4 = 0, 3 ≤ 2, 2 ≤ 5, 1 > 5                                   | remediation deadlines                   | RTS art. 10              | 8.8               |
| `security-mttr`          | median days to close critical/high alerts closed in the trend window         | 5 ≤ 1, 4 ≤ 7, 3 ≤ 30, 2 ≤ 90, 1 > 90 days                                                      | closed alerts (fixed / dismissed dates) | art. 10–11; RTS art. 10  | 8.8, 5.26         |
| `secret-scanning`        | % repositories with secret scanning                                          | %; 4–5 also need push protection on ≥ 90% (else capped at 3)                                   | security controls, push protection      | RTS art. 7, 11           | 5.17, 8.24        |
| `exposed-secrets`        | open secret scanning alerts                                                  | 5 = 0 and none in the trend window, 4 = 0, 1 > 0                                               | alerts                                  | RTS art. 7               | 5.17              |
| `workload-identity`      | % deploying workflows that use OIDC instead of long-lived cloud keys         | %, 4 ≥ 85%                                                                                     | workflow files already read             | RTS art. 7, 20–21        | 5.17, 8.5         |
| `branch-protection`      | % repositories with protected branch, pull requests required, force push off | %, 4 ≥ 90%                                                                                     | repository controls                     | RTS art. 17, 21          | 8.4, 8.32         |
| `required-checks`        | % repositories with required status checks                                   | %, 4 ≥ 85%                                                                                     | repository controls                     | RTS art. 17              | 8.29, 8.32        |
| `pipeline-integrity`     | % repositories with pinned actions and current reusable workflows            | %, 4 ≥ 85%                                                                                     | repository controls                     | RTS art. 16              | 5.21, 8.25        |
| `environment-separation` | environments declared and production protected                               | 1 one environment, 2 none in GitHub, 3 separate, 4 production protected, 5 also branch-limited | catalog, GitHub environments            | RTS art. 17              | 8.31              |
| `config-drift`           | % environments in sync with Git                                              | %, 4 ≥ 95%                                                                                     | Argo CD                                 | RTS art. 17              | 8.9               |
| `deploy-frequency`       | deploys per week (delivery environment, last 30 days)                        | 1 > 0, 2 ≥ 1 a month, 3 ≥ 1 a week, 4 ≥ 2 a week, 5 ≥ 1 a day                                  | deploy signal                           | RTS art. 17              | 8.32              |
| `lead-time`              | median hours from the change to its deploy                                   | 5 ≤ 1 h, 4 ≤ 24 h, 3 ≤ 7 days, 2 ≤ 30 days, 1 more                                             | deploy signal                           | RTS art. 17              | 8.32              |
| `change-failure-rate`    | % deployments that failed or were rolled back                                | 5 ≤ 5%, 4 ≤ 15%, 3 ≤ 30%, 2 ≤ 45%, 1 more                                                      | deploy signal                           | art. 11; RTS art. 17     | 8.32              |
| `time-to-restore`        | median hours from a failure to the next good deploy                          | 5 ≤ 1 h, 4 ≤ 8 h, 3 ≤ 24 h, 2 ≤ 7 days, 1 more                                                 | deploy signal                           | art. 11–12; RTS art. 26  | 5.30              |
| `test-coverage`          | line coverage                                                                | 1 > 0%, 2 ≥ 30%, 3 ≥ 60%, 4 ≥ 80%, 5 ≥ 90%                                                     | quality                                 | RTS art. 16              | 8.29              |
| `evidence-freshness`     | % evidence sources read and not stale                                        | 1 > 0%, 2 ≥ 50%, 3 ≥ 75%, 4 ≥ 90%, 5 = 100%                                                    | data freshness                          | art. 13                  | 5.36, cl. 9.1     |

**Workload identity.** A workflow _deploys_ when it uses a cloud login action (`azure/login`,
`aws-actions/configure-aws-credentials`, `google-github-actions/auth`) or a job `environment:`. It
uses **OIDC** when the workflow or each deploying job grants `id-token: write` and the login step
has none of the inputs `creds`, `credentials_json`, `aws-secret-access-key`, `client-secret`. Only
input **names** are read, never their values.

**Environment separation.** The GitHub environments of the coordinator repository. A catalog
environment maps to a GitHub environment by `githubEnvironment` (default: its `id`). Production is
the `delivery` environment (default: the last). Protected = required reviewers or a wait timer.

## Deploy signals (delivery checks)

Deploy frequency, lead time, change failure rate and time to restore use **one environment per
project**: the one with `delivery: true`, else the last. Each environment says how its deploys can
be observed with `deploySignal` (default `external`):

| `type`          | Deploys                                                                  | Failures                               | Lead time                                     |
| --------------- | ------------------------------------------------------------------------ | -------------------------------------- | --------------------------------------------- |
| `workflow`      | successful completed runs of a tracked workflow (last 20 runs read)      | failed runs                            | head commit → run end                         |
| `versions-file` | a commit that **raises** the semver at `key` in the file                 | a commit that **lowers** it (rollback) | tag `<tagPrefix><version>` commit → promotion |
| `argocd`        | Argo CD history entries                                                  | not visible                            | not visible                                   |
| `release`       | published releases of the coordinator                                    | not visible                            | not visible                                   |
| `external`      | none: the four checks are not visible ("deployed by external pipelines") |                                        |                                               |

Versions file: the newest 100 commits touching the path are read, then the file at each commit in
the 90-day window (at most 50). A commit that leaves the version unchanged (formatting, comments)
is ignored; a value that is not semver is skipped and noted in the cell. Rollbacks count as failed
changes and restore at the rollback.

```yaml
environments:
  - id: prod
    name: PROD
    githubEnvironment: production
    delivery: true
    deploySignal:
      type: versions-file
      repository: coordinator # or a component id
      path: environments/prod.yaml
      key: umbrella # dot path to the deployed version (semver)
      tagPrefix: v
controlMap:
  notApplicable:
    - { check: dast, reason: internal service without a web interface }
```

**How the delivery metrics are computed.** The definitions follow the "four keys" of DevOps
Research and Assessment (the research programme also called DORA, unrelated to the EU regulation):

- **Change failure rate** = deployments that failed in production / all deployments, over the trend
  window. A failed workflow run is a failed deployment. A rollback (a lower version in the versions
  file) is the remediation of the deploy it undoes: that deploy counts as failed, the rollback is
  not a deployment. Example: 0.5.0, rollback to 0.4.0, 0.5.1 = 2 deployments, 1 failed = 50%.
  Capped at 100% (a rollback of a deploy made before the window).
- **Time to restore** ("failed deployment recovery time"): from a failed run to the next
  successful deploy, or from the rolled-back deploy to its rollback; median, in hours.
- **Lead time for changes**: from the change (head commit, or the commit of the release tag) to
  its deploy; median, in hours.
- **Deploy frequency**: deploys per week over the frequency window.

The regulation itself defines none of these metrics; they are evidence for change management
(RTS 2024/1774 art. 17) and response and recovery (DORA art. 11). The delivery workflow's runs are read
over the whole window on every ref (a deploy on a tag push counts), up to 500 runs; Argo CD keeps a
limited history. When a list is cut, the cell notes that the frequency is a lower bound. Deploys
made inside a reusable workflow (`jobs.<id>.uses`) are not seen by the OIDC check.

Delivery metrics on DEV, on releases or on Argo CD history are **proxies**: the cell always names
the environment and the signal.

## Permissions

Every new reading is a GET. What each needs, as checked on GitHub's REST docs on 2026-11-04, and
what the hub shows when it is missing (never 0):

| Reading                        | Endpoint                                                                | Needs                                                                                                                                                   | Without it                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| GitHub environments            | `GET /repos/{o}/{r}/environments`                                       | read access to the repository ("Anyone with read access"); for a GitHub App, Actions: read (as recorded in [Security](security.md#authorisation-model)) | `environment-separation` not visible ("needs permission"), one `github-environments` collection error |
| Push protection status         | `security_and_analysis` in `GET /repos/{o}/{r}`                         | **admin** on the repository, or owner / security manager of the organisation (GitHub: "you must have admin permissions")                                | `secret-scanning` capped at level 3 with a note                                                       |
| Commits of the versions file   | `GET /repos/{o}/{r}/commits?path=`                                      | Contents: read (already granted)                                                                                                                        | delivery checks not visible                                                                           |
| File at a commit, commit dates | Contents API with `ref`, `GET /repos/{o}/{r}/commits/{ref}`             | Contents: read                                                                                                                                          | lead time not visible; file unreadable at a commit is noted                                           |
| Releases                       | `GET /repos/{o}/{r}/releases`                                           | Contents: read                                                                                                                                          | delivery checks not visible                                                                           |
| Delivery workflow runs         | `GET /repos/{o}/{r}/actions/workflows/{file}/runs?created=>=YYYY-MM-DD` | Actions: read (already granted)                                                                                                                         | delivery checks not visible                                                                           |

The read-only GitHub App of the [Security](security.md#authorisation-model) model **does not** see
push protection (it needs admin): `secret-scanning` stays at level 3 at most until an owner grants
it, which is a choice to make knowingly (admin is a write-level permission on settings). GitHub's
pages do not show the fine-grained permission box for these endpoints in their text version;
confirm the names on the App's permission page when you install it.

## Outputs

- Page `controls/` (EN, IT): heatmap by business unit, cell detail with value, threshold reached,
  repositories read, environment and signal, references and a link to the evidence on the project
  page; filters by business unit, area and `?team=`; legend; references table.
- Project page: a "Controls" block with the score and a link to its row.
- `exports/control-map.csv`: one row per project and check.
- Metrics: `hub_project_control_score`, `hub_project_control_measured`,
  `hub_project_control_applicable`, `hub_project_control_level{check}`; Grafana panel "Control map".
- Snapshot schema 1.9: `project.controlMap` and `summary.controlMap`.

## Sources

Article numbers and titles checked on 2026-11-04 against the Official Journal text as reproduced
verbatim by Springlex ([RTS 2024/1774](https://www.springlex.eu/en/packages/dora/rts-rmf-regulation/),
[Regulation 2022/2554](https://www.springlex.eu/en/packages/dora/dora-regulation/)); EUR-Lex did
not answer that day. Each reference is **related**: it names the requirement a check gives
technical evidence for, never a statement that it is met.

| Reference    | Title                                                                           | Used by                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| DORA art. 8  | Identification                                                                  | sbom-coverage                                                                                                           |
| DORA art. 10 | Detection                                                                       | security-mttr                                                                                                           |
| DORA art. 11 | Response and recovery                                                           | security-mttr, change-failure-rate, time-to-restore                                                                     |
| DORA art. 12 | Backup policies and procedures, restoration and recovery procedures and methods | time-to-restore                                                                                                         |
| DORA art. 13 | Learning and evolving                                                           | evidence-freshness                                                                                                      |
| DORA art. 25 | Testing of ICT tools and systems                                                | sast, container-scanning, dast                                                                                          |
| RTS art. 4   | ICT asset management policy                                                     | sbom-coverage                                                                                                           |
| RTS art. 5   | ICT asset management procedure                                                  | sbom-coverage                                                                                                           |
| RTS art. 7   | Cryptographic key management                                                    | secret-scanning, exposed-secrets, workload-identity                                                                     |
| RTS art. 10  | Vulnerability and patch management                                              | dependency-scanning, sast, container-scanning, iac-scanning, vulnerability-age, security-mttr                           |
| RTS art. 11  | Data and system security                                                        | secret-scanning                                                                                                         |
| RTS art. 16  | ICT systems acquisition, development, and maintenance                           | sbom-coverage, image-signature, build-provenance, license-policy, sast, iac-scanning, pipeline-integrity, test-coverage |
| RTS art. 17  | ICT change management                                                           | branch-protection, required-checks, environment-separation, config-drift, delivery checks                               |
| RTS art. 20  | Identity management                                                             | workload-identity                                                                                                       |
| RTS art. 21  | Access control                                                                  | workload-identity, branch-protection                                                                                    |
| RTS art. 26  | ICT response and recovery plans                                                 | time-to-restore                                                                                                         |

ISO/IEC 27001:2022 Annex A control numbers (5.9, 5.17, 5.21, 5.26, 5.30, 5.32, 5.36, 8.4, 8.5,
8.8, 8.9, 8.24, 8.25, 8.28, 8.29, 8.31, 8.32) and clause 9.1 follow the published Annex A control
list; the standard is not freely available, so they were not re-read online.

Delivery metric definitions: DevOps Research and Assessment, "four keys" (dora.dev).
