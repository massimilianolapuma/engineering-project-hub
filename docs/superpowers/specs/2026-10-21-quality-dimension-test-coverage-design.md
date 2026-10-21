# Quality dimension: test coverage from CI — design

Italiano: [../../it/superpowers/specs/2026-10-21-quality-dimension-test-coverage-design.md](../../it/superpowers/specs/2026-10-21-quality-dimension-test-coverage-design.md)

Status: approved by the owner on 2026-10-21 · Date: 2026-10-21 · Target release: v0.6.0

## 1. Intent and why

The owner wants to see, per project, how much of the code is covered by tests, the way SonarQube shows it, next to delivery, versions and security.

Facts checked on 2026-10-21 before deciding (sources in the conversation, summarised here):

- SonarQube imports coverage from CI reports and treats it as a **quality** measure. It is a quality-gate condition next to the security rating, not part of it.
- GitHub Code Quality (GA 2026-07-20, paid per active committer) shows line coverage on pull requests from a Cobertura report and can block merges with a ruleset threshold. **No REST or GraphQL endpoint returns the coverage percentage.** The Code Quality REST API returns only findings (category `maintainability` / `reliability`) and setup.
- In the company, SonarQube is in use but its future is being decided, partly on what Code Quality offers. The hub must not depend on Sonar.
- The hub already has a dimension called `coverage`. It means **security-controls coverage** (share of required scanners enabled), not test coverage.

So test coverage becomes its own dimension, **Quality**, fed by a small summary file that CI publishes as a GitHub Actions artifact. The hub reads it with the permissions it already has.

## 2. Goals, non-goals, anti-goals

Goals

- A sixth dimension, `quality`, per project, with status, reasons and an aggregated line-coverage percentage.
- Per component: line coverage, the commit and age of the report, Code Quality findings counts.
- Blind spots stay explicit: a component without a readable report is "not visible", never 0%.
- The existing `coverage` dimension is relabelled **Controls coverage** / **Copertura controlli** in the UI and docs, so the two meanings no longer collide.
- Works with mock data and without credentials, like everything else.

Non-goals

- No SonarQube provider in this release. The summary contract leaves room for one later.
- No branch, condition, function or per-file coverage. No coverage trend or history.
- No coverage on pull requests: only the default branch.
- No write action on GitHub: no ruleset, no Code Quality setup change, no workflow trigger.
- Wiring the corporate CI is outside this repository. A separate prompt covers the corporate repositories (local only, never committed).

Anti-goals (failure even if it "works")

- A missing or unreadable report shown as 0%, or as healthy.
- A stale report presented as the current state.
- A project going grey overall, or losing its score, only because no report exists yet.
- Coverage counted inside the security rating.
- Publishing file paths, code, raw reports or raw API payloads.

## 3. Constraints (unchanged project rules)

Read-only, static-first, no runtime backend, no commercial dependency, no GitHub calls from the browser, strict Zod allowlist on every published field, sanitised text and links, EN + IT for docs and UI, unknown ≠ zero, 403 ≠ no data, ambiguous 404 = unknown.

## 4. What the owner decided

- **Direction A** from the canvas mockup "Coverage dei test · due proposte": a new Quality dimension with its own card, bar and section on the project page, and a sixth bar in the portfolio. Direction B (coverage as context on the Security page) was not chosen.
- The existing dimension is relabelled "Controls coverage".
- Code Quality findings appear in the Quality section.

## 5. Design

### 5.1 Data source: the quality summary contract

CI uploads an artifact named **`hub-quality-summary`** that contains one file, `quality-summary.json`, on every run on the default branch. Shape (strict, version `1.0`):

```json
{
  "schemaVersion": "1.0",
  "repository": "example-org/project-beta-api",
  "ref": "refs/heads/main",
  "commitSha": "9f8e7d6…40 hex",
  "generatedAt": "2026-01-14T10:00:00Z",
  "tool": "coverlet",
  "format": "cobertura",
  "lines": { "covered": 5998, "valid": 8400 }
}
```

- `tool` is a short identifier (scrubbed). `format` is an enum: `cobertura`, `lcov`, `opencover`, `jacoco`, `other`.
- `lines.valid` = 0 means "no testable code" and maps to not applicable, not 0%.
- The collector:
  - lists the repository's artifacts by name;
  - takes the newest non-expired one whose run's head branch is the default branch;
  - downloads the zip (size cap 64 KB), reads that single file, and Zod-parses it;
  - checks that `repository` matches.
- Classification follows the existing rules:
  - no artifact → `missing`;
  - expired → `missing` with reason `quality-report-expired`;
  - 403 → `not-authorised`;
  - invalid JSON or schema → `invalid` plus an `invalid-data` collection error;
  - `generatedAt` older than `freshness.qualityReportStaleDays` → `stale`.
- Required permission: **Actions: read**, already granted. No new secret.
- **One summary per repository** (builder's call). When several components share a repository (a monorepo, or a coordinator that is also a component repo):
  - every row of that repository shows the same report with the note "shared repository report";
  - aggregation counts each repository **once**, so lines are never double-counted.
  - A per-path breakdown is out of scope for contract 1.0.
- Code Quality findings follow the same rule: they are counted per repository and never split by path.

### 5.2 Code Quality findings

- Source: `GET /repos/{o}/{r}/code-quality/findings?state=open`, paginated. Only counts are kept: by `rule.category` (`reliability`, `maintainability`) and by `rule.severity`. Never paths, messages or rule text.
- `GET …/code-quality/setup` tells "not enabled" apart from "not visible".
- The fine-grained token and GitHub App permission name for these endpoints is **not documented**. The builder verifies it. If unreadable, the capability is `not-authorised` or `unknown` and the UI says so.
- Findings are **informative in this release**: they are shown but do not change the Quality status.

### 5.3 Applicability per component

- Coverage applies by default to component types `service`, `webapp`, `worker`, `library`. It does not apply to `deployment`, `infrastructure` and `other` (builder's call).
- The catalog can override this per component and for the coordinator: `testCoverage: required | not-applicable`.
- The coordinator is treated like a `service` unless overridden.

### 5.4 Evaluation (new policies block, all values configurable)

```yaml
quality:
  greenThresholdPercent: 80
  amberThresholdPercent: 60 # below = red
  missingReportIsAmber: true # some applicable components not visible → at most amber
freshness:
  qualityReportStaleDays: 14
```

- **Component states:**
  - **readable**: valid and fresh.
  - **stale**: valid, but older than the stale threshold.
  - **not visible**: one of `missing` (no artifact), `expired`, `invalid`, `not-authorised` (403), `unknown` (ambiguous 404 or network error).
  - **not applicable.**
- **Project coverage** = Σ covered / Σ valid over the applicable repositories whose report is **readable or stale**. It is weighted by lines.
  - A stale report still counts, but it is always shown with its age (⧖) and caps the status as below.
  - Not-visible components never count, and never count as 0.
- **Status:**

  | Condition                              | Status                                                     |
  | -------------------------------------- | ---------------------------------------------------------- |
  | No applicable component                | grey "not applicable" (like `no-critical-workflows` today) |
  | Every applicable component not visible | grey                                                       |
  | Otherwise, by threshold                | green ≥ 80, amber ≥ 60, red below 60                       |

  Two cases stop the threshold result from being green, so it is **at most amber** and a red stays red:
  - any stale report;
  - any not-visible applicable component, when `missingReportIsAmber` is true.

- **Reasons** (new codes, EN/IT strings), each listing the components:
  - `quality-below-threshold`
  - `quality-below-red-threshold`
  - `quality-report-missing`
  - `quality-report-expired`
  - `quality-report-invalid`
  - `quality-report-not-authorised`
  - `quality-report-unknown`
  - `quality-report-stale`
  - `quality-not-applicable`
  - `quality-all-above-threshold`

### 5.5 Overall status and score

- `quality` is **not critical**: a red Quality counts as amber in the overall status.
- It is an **optional dimension** (new `overall.optionalDimensions`, default `[quality]`):
  - when measured, it counts for the overall status and the score like a required non-critical dimension;
  - when grey, it is ignored. It does not turn the project grey and does not lower the measured ratio.
  - This keeps today's projects stable until CI publishes summaries.
- Score weight `quality: 10`. The other weights are unchanged, and the score is still a weighted mean of measured dimensions.

### 5.6 Snapshot model (schema 1.3 → 1.4)

- `Dimension` enum gains `quality`.
- `ProjectSnapshot.qualityHealth`:
  - `{ status, reasons, percentage|null, linesCovered, linesValid, measured, applicable, notVisible, stale, collectedAt }`;
  - `perComponent[{ componentId, state, percentage|null, linesCovered, linesValid, commitSha, generatedAt, tool, runUrl }]`;
  - `findings{ reliability, maintainability, bySeverity, state }`.
- `ProjectSummary.quality` = `{ status, percentage, measured, applicable }`.
- New capability `codeQuality`. New stale source `quality-report` and collection-error source `quality-summary` / `code-quality`.
- `runUrl` links to the GitHub Actions run (host allowlist unchanged).
- Snapshots stay regenerated each run. Older versions are not read, as today.

### 5.7 UI (as in canvas board "Proposta A")

- **Portfolio:**
  - sixth bar, with the order Delivery · Versions · Security · Controls · Governance · Quality;
  - the status filter includes Quality.
- **Project page:**
  - a sixth dimension card "Quality" showing "Tests: 67% of lines · threshold 80%";
  - a "Code quality" section with three tiles: aggregated coverage with a threshold meter, open findings, blind spots;
  - a per-component table: coverage with a meter and a threshold tick, the report source (format, commit, age), and the findings;
  - a legend sentence with the thresholds.
- **Shared rules:**
  - The meter always has the number next to it; colour is never the only carrier.
  - Unknown uses a dashed meter and the "?" symbol; not applicable uses "–".
- **How to read:** a Quality entry with the thresholds.
- **Data quality page:** lists missing, expired and invalid reports.
- **Security page:** unchanged apart from the "Controls coverage" label.
- **Design upkeep:** update the canvas and the Warm Graphite DS README after the code changes (standing rule).

### 5.8 Mock data (synthetic only)

| Project  | Coverage | Notes                                                                                                 |
| -------- | -------- | ----------------------------------------------------------------------------------------------------- |
| Alpha    | 84%      | all 4 components measured, findings 0 / 3                                                             |
| Beta     | 67%      | as in the mockup: coordinator 38%, api 71%, web report missing, helm not applicable                   |
| Platform | 58%      | one shared monorepo report, 20 days old: stale under the default 14 days, so it shows ⧖ and stays red |
| Gamma    | grey     | nothing readable                                                                                      |

There is also one fixture with an expired artifact and one with an invalid summary. A canary test puts a secret-looking string in `tool`.

### 5.9 Docs

EN + IT:

- `configuration.md`: the policies block, catalog `testCoverage`, the summary contract and its JSON Schema.
- `security.md`: new sources and permissions, what is never published.
- `architecture.md`: data flow.
- `operations.md`: how CI produces the artifact, with a minimal example step.
- README dimensions and roadmap ("SonarQube provider" stays roadmap).
- CHANGELOG.
- A new ADR: "Test coverage from a CI summary artifact, not from Sonar or GitHub UI".

## 6. Left to the builder

- Zip reading: a small maintained MIT library or a minimal reader for one entry. Keep the 64 KB cap.
- Exact artifact query: by name, then pick per default branch.
- Field names inside `qualityHealth` beyond those listed.
- Component order and the responsive layout of the table, following the existing Warm Graphite patterns.
- Fixture timestamps (relative `@now-…` tokens).
