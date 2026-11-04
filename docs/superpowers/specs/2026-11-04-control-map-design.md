# Control map: DORA and ISO 27001 technical controls, score and heatmap — design

Italiano: [../../it/superpowers/specs/2026-11-04-control-map-design.md](../../it/superpowers/specs/2026-11-04-control-map-design.md)

Status: draft for the owner's review (builder check done, owner answers folded in) · Date: 2026-11-04 · Target release: **v0.16.0**

## 1. Intent and why

The owner runs DevSecOps assessments for business units whose clients are regulated by **DORA**
(Regulation (EU) 2022/2554, digital operational resilience) and audited against **ISO/IEC
27001:2022**. The last assessment (a slide deck, kept outside the repository) scored 14 KPIs per
business unit on a 0–5 maturity scale and showed them as a heatmap. Today that picture is built by
hand, once, from interviews.

The hub already collects most of the evidence those KPIs need (SBOM, signatures, scans, branch
rules, remediation deadlines, coverage, Argo CD state). This release turns it into a **continuous,
evidence-based control map**: every technical check the hub can verify, per project, scored on the
same 0–5 scale, shown as a heatmap with the related DORA articles and ISO 27001 Annex A controls.

**What success looks like:** the owner can open one page and see, per project and per business
unit, which technical controls are evidenced, how mature they are, what is missing, and which
regulatory requirements each control relates to — without collecting anything by hand.

## 2. Goals, non-goals, anti-goals

Goals

- A catalog of **technical checks** (§5.2) computed from data the hub reads, each with a 0–5 level,
  a measured value, its source, its freshness, and its DORA / ISO 27001 references.
- A per-project **control score** (0–100) and per-business-unit aggregates.
- A new page **"Control map"** ("Mappa dei controlli") with the heatmap: projects (grouped by
  business unit) × checks (grouped by area), plus a detail view per cell.
- **Delivery metrics** (deployment frequency, lead time, change failure rate, time to restore)
  computed from a deploy signal declared per environment in the catalog, honest about environments
  the hub cannot see.
- A CSV export of the heatmap (evidence for audits) and Prometheus metrics for the score.
- EN + IT, like every page.

Non-goals

- **Governance and organisational requirements** (policies, roles, ICT third-party contracts,
  business continuity plans, incident reporting to authorities, training). The hub does not see
  them and does not ask for them.
- FinOps (tagged cost, idle spend), logging and runtime monitoring, the content of secret vaults:
  no source today.
- Per-client or external audiences: for now the page is internal, with full detail, for everyone
  who can open the hub (owner decision).
- Trends of the control map over time (history) in this release.

Anti-goals (failure even if it "works")

- **Any claim of compliance.** The app never says "DORA compliant", "ISO 27001 compliant" or a
  percentage of "DORA adherence". It says which technical controls are evidenced and lists the
  related articles and Annex A controls **as references**.
- An unknown value shown as level 0 or as a pass: unknown is "not visible", never 0 (the hub's
  constant rule).
- A delivery metric computed from a different environment without saying so (e.g. DEV deploys shown
  as production frequency).
- A check that cannot be explained: every level must show its measured value, the threshold that
  produced it and the source.

## 3. Constraints

As every release (program spec §2): read-only towards monitored repositories and sources; static
site; strict Zod allowlist; unknown ≠ zero; 403 ≠ no data; EN + IT; Primer tokens and Octicons,
status by icon + word, WCAG 2.2 AA; UI drawn in Claude Design and **approved by the owner before UI
code**; synthetic data only in the repository (no real company, business unit, team or project
names); never `npm run ci:build` / `collect:mock`; podman only.

## 4. Decisions in short

| #   | Decision                                                                                                                                                                                                                                                                                                                           | Why                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| C1  | Levels 0–5 with the assessment legend (Absent, Initial, Repeatable, Defined, Managed, Optimised). Each check maps its measured value to a level through thresholds in `policies.yaml` (`controlMap.thresholds`), defaults from the deck targets **(BC)**                                                                           | Same language as the assessment; thresholds are policy, not code                        |
| C2  | A check is **not visible** (null level) when its source could not be read, and **not applicable** by the rules of §5.4; neither counts in the score. A security control the catalog marks `required: false` is **still counted** (owner decision 2026-11-04): a gap is a gap for DORA and ISO even if nobody asked for the control | Unknown ≠ zero; the map shows real maturity, not the project's own ambition             |
| C3  | Project control score = mean of the known applicable levels × 20 (0–100), shown with "measured N of M"; below half measured → "insufficient data", no number **(BC)**                                                                                                                                                              | Same confidence rule as the project score                                               |
| C4  | Business-unit row = median of its projects' levels per check (not visible if every project is) **(BC)**                                                                                                                                                                                                                            | Median resists one outlier project                                                      |
| C5  | References are data: each check lists DORA articles (Regulation and RTS 2024/1774) and ISO 27001:2022 Annex A controls; the page title, copy and exports never say "compliant" **(BC, owner decision)**                                                                                                                            | Anti-goal 1                                                                             |
| C6  | Delivery metrics come from one **deploy signal per environment** in the catalog (§5.3); default `external` = not visible. The metrics use the environment marked `delivery: true` (default: the last environment), and the cell names it **(BC)**                                                                                  | Production is often deployed by the client's pipelines the hub cannot see (owner input) |
| C7  | New snapshot schema **1.9**: `controlMap` per project summary and per project snapshot; history unchanged **(BC)**                                                                                                                                                                                                                 | One validated place for levels, values and sources                                      |
| C8  | ADR **0014**: "Control map: evidence-based technical controls with regulatory references, never a compliance claim"                                                                                                                                                                                                                | New public meaning of scores; boundary of what the hub asserts                          |
| C9  | Published only when `publication.audience` is `restricted` or the data source is `mock` (demo); on a public site with real data the page, CSV and metrics are not produced **(BC)**                                                                                                                                                | Levels and values describe each project's weaknesses                                    |

## 5. Design

### 5.1 Levels

| Level | Name (EN / IT)          | Meaning (from the assessment legend)                                 |
| ----- | ----------------------- | -------------------------------------------------------------------- |
| 0     | Absent / Assente        | The control is not present                                           |
| 1     | Initial / Iniziale      | Ad-hoc, no metric, reactive                                          |
| 2     | Repeatable / Ripetibile | First pipelines/templates, manual controls, partial KPIs             |
| 3     | Defined / Definito      | Standardised, partial coverage                                       |
| 4     | Managed / Gestito       | Enforced (policy as code, gates), verifiable, continuous measurement |
| 5     | Optimised / Ottimizzato | Continuous, complete, self-service                                   |

Each check below defines how its measured value maps to these levels; the builder writes the exact
default thresholds into `policies.yaml` from the targets listed, and the owner can change them.

### 5.2 Checks

Areas and checks. "Source" is what the hub already reads unless marked **new**. References are
DORA Regulation 2022/2554 (art.) and RTS 2024/1774 (RTS art.), and ISO/IEC 27001:2022 Annex A.

**A. Supply chain**

| Check                 | Measured value                                        | Level ladder (default)                                                   | Source                  | DORA                     | ISO 27001  |
| --------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------- | ------------------------ | ---------- |
| `sbom-coverage`       | % repositories with a readable SBOM                   | 0 → 0%, 1 > 0%, 2 ≥ 25%, 3 ≥ 50%, 4 ≥ 85%, 5 = 100%                      | supply chain (ADR 0011) | art. 8; RTS art. 4–5, 16 | 5.9, 5.21  |
| `image-signature`     | % distinct images with a verified signature           | same ladder, 4 ≥ 85%                                                     | supply chain, Harbor    | RTS art. 16              | 5.21, 8.24 |
| `build-provenance`    | % latest releases with a build provenance attestation | same ladder, 4 ≥ 85%                                                     | release attestations    | RTS art. 16              | 5.21, 8.25 |
| `license-policy`      | flagged licenses                                      | 5 = 0 with a policy set, 3 = 0 without policy, 1 > 0, unknown if no SBOM | supply chain            | RTS art. 16              | 5.32       |
| `dependency-scanning` | % repositories with dependency alerts enabled         | same ladder, 4 ≥ 90%                                                     | controls (Dependabot)   | RTS art. 10              | 8.8        |

**B. Vulnerabilities and security testing**

| Check                | Measured value                                                       | Level ladder (default)                                                                              | Source                                         | DORA                     | ISO 27001  |
| -------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------ | ---------- |
| `sast`               | % repositories with code scanning, analysis within the stale window  | same ladder, 4 ≥ 90%                                                                                | controls (code scanning)                       | art. 25; RTS art. 10, 16 | 8.28, 8.29 |
| `container-scanning` | % repositories with images that have a scan                          | same ladder, 4 ≥ 90%                                                                                | controls, Harbor                               | art. 25; RTS art. 10     | 8.8        |
| `iac-scanning`       | % repositories with IaC that have a scan                             | same ladder, 4 ≥ 90%                                                                                | controls                                       | RTS art. 10, 16          | 8.9        |
| `dast`               | % applicable components with a DAST result                           | same ladder, 4 ≥ 70%                                                                                | controls                                       | art. 25                  | 8.29       |
| `vulnerability-age`  | open critical/high past their remediation deadline                   | 5 = 0 and none within 7 days of the deadline, 4 = 0, 3 ≤ 2, 2 ≤ 5, 1 > 5                            | remediation SLAs (v0.9.0)                      | RTS art. 10              | 8.8        |
| `security-mttr`      | median days to close critical/high alerts closed in the last 90 days | 5 ≤ 1d, 4 ≤ 7d (deck target ≤ 8h is for incidents: kept for 5 when ≤ 8h), 3 ≤ 30d, 2 ≤ 90d, 1 > 90d | **new**: closed alerts (fixed/dismissed dates) | art. 10–11; RTS art. 10  | 8.8, 5.26  |

**C. Secrets**

| Check               | Measured value                                                                                         | Level ladder (default)                                      | Source                                   | DORA              | ISO 27001  |
| ------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | ---------------------------------------- | ----------------- | ---------- |
| `secret-scanning`   | % repositories with secret scanning and push protection                                                | 4 ≥ 90% with push protection, 3 ≥ 90% scanning only, ladder | controls + **new**: push protection flag | RTS art. 7, 11    | 5.17, 8.24 |
| `exposed-secrets`   | open secret scanning alerts                                                                            | 5 = 0 for 90 days, 4 = 0, 1 > 0                             | alerts                                   | RTS art. 7        | 5.17       |
| `workload-identity` | % deploying workflows that authenticate with OIDC (`id-token: write`) instead of long-lived cloud keys | same ladder, 4 ≥ 85%                                        | **new**: workflow files already fetched  | RTS art. 7, 20–21 | 5.17, 8.5  |

**D. Change and access**

| Check                    | Measured value                                                                    | Level ladder (default)                                          | Source                                                 | DORA            | ISO 27001  |
| ------------------------ | --------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------ | --------------- | ---------- |
| `branch-protection`      | % repositories with a protected default branch, PR required, force push blocked   | same ladder, 4 ≥ 90%                                            | repository controls (v0.8.0)                           | RTS art. 17, 21 | 8.4, 8.32  |
| `required-checks`        | % repositories requiring status checks before merge                               | same ladder, 4 ≥ 85%                                            | repository controls                                    | RTS art. 17     | 8.29, 8.32 |
| `pipeline-integrity`     | % repositories with pinned actions and current reusable workflows                 | same ladder, 4 ≥ 85%                                            | repository controls                                    | RTS art. 16     | 5.21, 8.25 |
| `environment-separation` | environments declared and production protected (required reviewers or wait timer) | 4 = separated and protected, 3 = separated, 1 = one environment | catalog + **new**: GitHub environment protection rules | RTS art. 17     | 8.31       |
| `config-drift`           | % environments in sync with Git (Argo CD)                                         | same ladder, 4 ≥ 95%; not visible without Argo CD               | Argo CD                                                | RTS art. 17     | 8.9        |

**E. Delivery and recovery** (on the `delivery` environment, §5.3)

| Check                 | Measured value                                        | Level ladder (default, deck targets)                  | Source                 | DORA                    | ISO 27001 |
| --------------------- | ----------------------------------------------------- | ----------------------------------------------------- | ---------------------- | ----------------------- | --------- |
| `deploy-frequency`    | deploys per week (last 30 days)                       | 5 ≥ 1/day, 4 ≥ 2/week, 3 ≥ 1/week, 2 ≥ 1/month, 1 > 0 | **new**: deploy signal | RTS art. 17             | 8.32      |
| `lead-time`           | median hours from merge to deploy                     | 5 ≤ 1h, 4 ≤ 24h, 3 ≤ 7d, 2 ≤ 30d, 1 > 30d             | **new**                | RTS art. 17             | 8.32      |
| `change-failure-rate` | % deploys that failed or were rolled back             | 5 ≤ 5%, 4 ≤ 15%, 3 ≤ 30%, 2 ≤ 45%, 1 > 45%            | **new**                | art. 11; RTS art. 17    | 8.32      |
| `time-to-restore`     | median hours from a failed deploy to the next success | 5 ≤ 1h, 4 ≤ 8h, 3 ≤ 24h, 2 ≤ 7d, 1 > 7d               | **new**                | art. 11–12; RTS art. 26 | 5.30      |
| `test-coverage`       | line coverage (Quality, v0.6.0)                       | 5 ≥ 90%, 4 ≥ 80%, 3 ≥ 60%, 2 ≥ 30%, 1 > 0%            | quality                | RTS art. 16             | 8.29      |

**F. Evidence**

| Check                | Measured value                                                     | Level ladder (default)                      | Source          | DORA    | ISO 27001     |
| -------------------- | ------------------------------------------------------------------ | ------------------------------------------- | --------------- | ------- | ------------- |
| `evidence-freshness` | % of the project's evidence sources read within their stale window | 5 = 100%, 4 ≥ 90%, 3 ≥ 75%, 2 ≥ 50%, 1 > 0% | freshness (all) | art. 13 | 5.36, cl. 9.1 |

**Definitions for the new sources**

- `workload-identity`: the workflow files the repository-controls reader already fetches. A workflow
  is _deploying_ when it uses a cloud login action (`azure/login`, `aws-actions/configure-aws-credentials`,
  `google-github-actions/auth`) or a job `environment:`. It uses **OIDC** when the job or workflow
  grants `id-token: write` and the login takes no secret credential input (`creds`,
  `credentials_json`, `aws-secret-access-key`, `client-secret`); otherwise it uses long-lived keys.
- `environment-separation`: the GitHub environments of the coordinator repository (and of the
  repository of a `workflow` deploy signal). A catalog environment maps to a GitHub environment by
  the new optional `githubEnvironment` (default: its `id`). "Production" is the `delivery`
  environment. Ladder: 0 = no environment declared, 1 = one environment, 2 = several declared but
  none in GitHub, 3 = separate GitHub environments, 4 = production protected (required reviewers or a
  wait timer), 5 = 4 and production limited to protected branches or tags.

The builder confirms each new source on the API docs (permissions, fields) and records it; a check
whose source needs a permission the deployment lacks is **not visible**, with the reason, never 0.

### 5.3 Deploy signal per environment (catalog)

`environments[]` gains an optional `deploySignal` and an optional `delivery: true`:

```yaml
environments:
  - id: dev
    name: DEV
    deploySignal: { type: workflow, workflow: deploy-dev } # a trackedWorkflows id
  - id: prod
    name: PROD
    delivery: true
    deploySignal:
      type: versions-file
      repository: coordinator # or a component id
      path: environments/prod.yaml
      key: umbrella # dot path to the deployed version (semver)
      tagPrefix: v # the release tag of that version, for lead time
```

**Versions file format** (owner's real case, made generic): one YAML (or JSON) file per environment,
updated only by promotion pull requests, holding the deployed version at `key` (e.g. a top-level
`umbrella: 0.5.2`). The hub lists the commits that touched the file (newest 100 in the window) and
reads the value at each commit. A higher version than the previous commit is a **promotion**
(deploy event); a lower one is a **rollback**; the same version (formatting changes) is ignored. A
value that is not semver makes that commit unreadable (skipped, counted in the cell's notes).

| `type`          | Deploy event                                                  | Failure                                         | Restore                                         |
| --------------- | ------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------- |
| `workflow`      | a completed run of the tracked workflow on the default branch | conclusion `failure`                            | next `success` after a failure                  |
| `versions-file` | a commit that raises the version (promotion)                  | a promotion later rolled back (a lower version) | time from that promotion to the rollback commit |
| `argocd`        | a new sync of the application (history)                       | sync or health failed                           | next healthy sync                               |
| `release`       | a published release (as "delivered to the client")            | not measurable (CFR/TTR not visible)            | not visible                                     |
| `external`      | not visible (client pipelines)                                | not visible                                     | not visible                                     |

- Default `external`: the four delivery cells read "not visible — deployed by external pipelines".
- Lead time: workflow → from the merge of the head SHA to the run's end; versions file → from the
  creation of the release tag `<tagPrefix><version>` (in the signal's repository) to the promotion
  commit; release → not measured. Unresolvable → that deploy has no lead time. The versions-file
  timestamps are promotion times (merge of the promotion PR), a proxy for the deploy itself: the page
  says so.
- The cell names the environment ("PROD", or "DEV" when the owner marks DEV as `delivery`).
- Window: last 30 days for frequency, last 90 days for CFR, TTR and lead time (configurable).

### 5.4 Applicability, partial reads and score

**Not applicable** when there is nothing to check, never because a control is optional:

- the check's object does not exist: no container images → `container-scanning`, `image-signature`
  n/a; no IaC files detected → `iac-scanning` n/a; no deploying workflow → `workload-identity` n/a;
  no environments → the delivery checks, `environment-separation` and `config-drift` n/a;
- every repository of the project lists the control in `notApplicableControls` (or the repository
  check in `notApplicableChecks`);
- the project lists the check in a new optional `controlMap.notApplicable: [{ check, reason }]`
  (catalog, per project; reason required, shown in the cell).

**Partial reads.** For "% of repositories" checks the value is computed over the repositories that
could be read; the cell says "k of n readable". When fewer than half could be read the check is not
visible. An unreadable repository never counts as missing.

**Score**

- Check level per project from its measured value (C1), or null / not applicable (C2).
- Control score = round(mean(known applicable levels) × 20); "measured N of M"; below 50% → none.
- Area score = same over the area's checks.
- Business unit: median per check (C4) and median control score.
- Nothing changes the existing project **health** or **score**: the control map is a separate lens.

### 5.5 Page "Control map" (design-first)

- New route `controls/` (nav after Security; Octicon to choose at mockup, e.g. `checklist`), label
  "Control map" / "Mappa dei controlli". Off with `policies.controlMap.enabled: false`.
- **Lede:** "Technical controls evidenced from the collected data, with the related DORA and ISO
  27001 references. This is not a compliance assessment: governance and organisational requirements
  are out of scope."
- **Heatmap:** rows = business units (aggregate) with their projects nested; columns = checks
  grouped by area; cell = level number + colour (sequential scale, validated for colour vision and
  contrast; "not visible" hatched, "n/a" blank); the number is always printed (never colour alone).
  Sticky header and first column; horizontal scroll inside the table on small screens.
- **Score column:** control score with "measured N of M".
- **Cell detail** (click or keyboard): check name, level and its meaning, measured value, threshold
  that set the level, source and age, the environment (delivery checks), DORA and ISO references,
  and links to the project page sections that hold the evidence.
- **Legend** with the six levels, not visible and n/a; a "References" section listing every check
  with its DORA articles and ISO controls (one table).
- Filters: business unit, area, `?team=` (as on the Portfolio).
- CSV export `exports/control-map.csv` (project, business unit, check, level, value, source,
  collected at).
- The project page gains a "Controls" summary block linking to its heatmap row.
- The catalog editor **keeps** `deploySignal`, `delivery`, `githubEnvironment` and
  `controlMap.notApplicable` when it saves (today it would drop unknown environment fields); editing
  them in the editor UI is a later release.
- **Mockups first:** heatmap light/dark, 390px, cell detail, references section — approved in
  Claude Design before any UI code.

### 5.6 Metrics

`hub_project_control_score{project}` (omitted when insufficient), `hub_project_control_level{project,check}`
(omitted when not visible), `hub_project_control_measured{project}`; added to the Grafana dashboard
as one panel.

## 6. Tests (summary)

Unit tests per check (value → level at each threshold edge; null source → not visible; n/a; partial
reads); deploy signal parsers on fixtures for each type (incl. a versions file with a promotion, a
rollback and a non-semver value; failed then successful runs); score and BU median; i18n parity;
site integration (page, nav, CSV, audience gating); a test that no **visible** EN/IT text of the page,
CSV headers or metric HELP says "compliant", "compliance with", "conforme" or "conformità" as a claim
(the existing reason code `governance-compliant` is an internal key and stays); e2e (heatmap keyboard detail, filters); goldens
with mock data for every signal type and at least one external environment.

## 7. Left to the builder

Exact copy within the anti-goals; the Octicon; colour scale (validated); window sizes within the
limits above; the API fields for the **new** sources, verified on the docs; mock fixtures.

## 8. Risks

- **Reference accuracy.** Article and control numbers are taken from the RTS 2024/1774 article list
  and ISO 27001:2022 Annex A; the plan re-checks each against the official texts before release.
- **Proxy metrics.** Delivery metrics on DEV or on releases are proxies; the page always names the
  environment and the signal type.
- **New permissions.** Push protection status and environment protection rules may need permissions
  the GitHub App lacks; those checks then read "not visible" with the reason.
- **Over-reading the score.** Mitigated by the lede, the references framing and ADR 0014.

## 9. Sources

- Regulation (EU) 2022/2554 (DORA), Chapter II and art. 24–25.
- Commission Delegated Regulation (EU) 2024/1774 (RTS on the ICT risk management framework),
  Title II art. 2–27.
- ISO/IEC 27001:2022 Annex A.
- The owner's DevSecOps assessment (KPIs, 0–5 legend, targets), not in the repository.
