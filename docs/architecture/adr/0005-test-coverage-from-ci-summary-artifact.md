# ADR 0005: Test coverage from a CI summary artifact, not from Sonar or GitHub UI

- **Status:** Accepted
- **Date:** 2026-10-21
- **Italian version:** [docs/it/architecture/adr/0005-test-coverage-from-ci-summary-artifact.md](../../it/architecture/adr/0005-test-coverage-from-ci-summary-artifact.md)

## Context

The owner wants to see, per project, how much of the code is covered by tests, next to
delivery, versions and security. Facts checked on 2026-10-21:

- SonarQube imports coverage from CI reports and treats it as a quality measure, next to
  the security rating but not part of it. Its future in some organisations is undecided, so
  the hub must not depend on it.
- GitHub Code Quality shows line coverage on pull requests from a Cobertura report, but no
  REST or GraphQL endpoint returns the coverage percentage. Its REST API returns only
  findings (counts by category and severity).
- The hub already has a dimension called `coverage`. It means the share of required security
  controls that are enabled, not test coverage.

The portal is read-only, static and has no backend ([ADR 0001](0001-static-first-github-native.md));
every published field goes through a strict allowlist ([ADR 0002](0002-snapshot-contract-and-provider-abstraction.md)).

## Decision

1. **A sixth dimension, Quality.** Test coverage is its own dimension, not part of security
   risk. The existing `coverage` dimension keeps its id and is relabelled "Controls coverage"
   / "Copertura controlli" in the UI and docs.
2. **CI publishes a small summary as an artifact.** Each repository uploads a GitHub Actions
   artifact named `hub-quality-summary` with one file, `quality-summary.json` (strict schema,
   version `1.0`: repository, ref, commit SHA, date, tool, format and `lines.covered` /
   `lines.valid`), on every default-branch run. The collector reads it with the permission it
   already has (Actions: read). No new secret, no commercial dependency.
3. **Trust and size limits.** The collector takes the newest non-expired artifact whose run is
   on the default branch and comes from the same repository (never a fork pull request run),
   reads the zip only up to 64 KB and a single file, validates it, and checks that
   `repository` matches. Anything else is `invalid` and nothing of it is published.
4. **Unknown is not zero.** A repository with no readable report is "not visible" (missing,
   expired, invalid, not authorised, unknown), never 0%. `lines.valid: 0` is not applicable.
   A 403 is `not-authorised`, never "missing". Project coverage is the line-weighted sum over
   readable or stale reports, each repository counted once. A stale report still counts but
   caps the status at amber.
5. **Quality is optional by default.** A new `overall.optionalDimensions` (default
   `[quality]`) lets a measured Quality count for the overall status and the score while a
   grey one is ignored, so existing projects stay stable until CI publishes summaries. Quality
   is not critical: a red counts as amber overall. Score weight 10.
6. **Code Quality findings are informative.** Open findings are counted per repository
   (category and severity) and shown in the Quality section. They never change the status.
   The permission name for these endpoints is only partly documented, so a failure is shown as
   not authorised or unknown, never hidden.
7. **Snapshot schema 1.4** adds `qualityHealth`, the `quality` dimension, the `codeQuality`
   capability and the `quality-report` stale source. Older snapshots are not read.

## Alternatives considered

- **Depend on SonarQube.** Rejected: its future is undecided and it adds a commercial
  dependency. A SonarQube provider stays on the roadmap and the contract leaves room for it.
- **Read coverage from GitHub Code Quality.** Not possible: no endpoint returns the
  percentage.
- **Parse raw coverage reports in the collector.** Rejected: reports are large, tool-specific
  and carry file paths. The summary keeps the allowlist trivially safe: counts only.
- **Fold coverage into the existing dimension or into security.** Rejected: the two
  meanings would collide, and test coverage must never lower or hide security risk.
- **A separate page for coverage on the Security page.** Not chosen by the owner: Quality has
  its own card, bar and section instead.

## Consequences

- Positive:
  - works with the current permissions, mock data and no credentials;
  - a missing or unreadable report is always explicit, never 0% and never healthy;
  - the contract is tool-neutral (`cobertura`, `lcov`, `opencover`, `jacoco`, `other`).
- Negative:
  - every monitored repository needs a CI step to produce the summary (an example is in
    [Operations](../../operations.md#publishing-the-quality-summary-from-ci));
  - one summary per repository: no per-path breakdown for a monorepo, and findings are not
    split by component;
  - artifacts expire (30 days recommended), so a repository that stops running CI on the
    default branch turns from stale to expired.
