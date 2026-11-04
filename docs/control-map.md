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
| `change-failure-rate`    | % changes that failed or were rolled back                                    | 5 ≤ 5%, 4 ≤ 15%, 3 ≤ 30%, 2 ≤ 45%, 1 more                                                      | deploy signal                           | art. 11; RTS art. 17     | 8.32              |
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

Delivery metrics on DEV, on releases or on Argo CD history are **proxies**: the cell always names
the environment and the signal.

## Permissions

The new readings are GET only: GitHub environments (`GET /repos/{o}/{r}/environments`), the
commits of a path, a file at a commit, commit dates, releases (Contents: read), and the push
protection status in the repository metadata (`security_and_analysis`, returned only to callers
allowed to see it). Without a permission the check reads **not visible** with the reason, never 0.
See [Security](security.md#authorisation-model).

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

Checked 2026-11-04 against the published texts; the EUR-Lex pages could not be fetched that day,
so confirm the article numbers on EUR-Lex before relying on them externally.

- Regulation (EU) 2022/2554 (DORA), Chapter II (art. 5–16) and art. 24–25.
- Commission Delegated Regulation (EU) 2024/1774 (RTS on the ICT risk management framework).
- ISO/IEC 27001:2022, Annex A.
