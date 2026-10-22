# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Security exceptions with a mandatory expiry: an optional, reviewed `config/exceptions.yaml` (owner, reason, `created`, `expires`, optional ticket; selectors `alert`, `rule` with an optional `tool`, `advisory`; secret scanning accepts only `alert`). The hub never dismisses alerts on GitHub: an accepted finding keeps `status: open`, is listed apart ("Accepted by exception") and leaves the counts and the Security status until the exception expires. Four states (active, expired, stale, not verifiable); an unreadable source never reads as accepted. For non-public repositories under a public audience the rule or advisory, tool, reason and ticket are withheld. JSON Schemas `exceptions.schema.json` and `policy-case.schema.json`, kept in sync with Zod by a test.
- Remediation SLAs per severity (`remediation`: critical 7, high 30, medium 90, low 180, secret 7 days), computed from the alert's creation time; an active exception pauses overdue without resetting the clock; an unknown age is never "within SLA". Informative by default (`remediation.overdue.<class>: info`), with opt-in escalation to amber or red.
- `npm run policy:check`: validates policies and exceptions, explains every decision with the policy key behind each reason, runs decision cases (`config/policy-cases/*.yaml`, eight shipped) with the real engines, and with `--snapshot <dir>` re-evaluates a snapshot read-only (never writes). A `policy-check` CI job runs it on every pull request; `/config/exceptions.yaml` has an explicit CODEOWNERS entry.
- Risk UI: a remediation line, SLA meta line and Overdue / Accepted pills on project alerts, an Exceptions table, a Remediation queue and overdue / accepted totals on the Security page, a Security exceptions card on Data quality, an "Exceptions and remediation SLAs" section in How to read. EN and IT.
- "What changed" lists newly overdue alerts and expired exceptions (`newlyOverdue`, `expiredExceptions` in `changes.json`), the trend table gains an Overdue column, and the CSV files gain `overdue`, `overdue_critical_high`, `accepted`, `exception_issues` (portfolio) and `overdue`, `accepted` (findings summary).
- ADR 0008 (EN and IT), and EN/IT documentation for exceptions, SLAs and `policy:check`.

### Fixed

- Unmeasured overdue counts are shown as "not measured" (never "0 overdue") on project cards and the portfolio tooltip, and incomplete counts read as lower bounds ("≥ n"), including "Nothing overdue in the sources that could be read".
- Italian SLA classes and accepted findings agree in number ("1 alto", "2 problemi accettati").
- An exception with `created` in the future is an error in the loader and in `policy:check`; a collection that still meets one never applies it and reports it as `invalid` in Data quality.
- `policy:check` runs the collector's loader on the exceptions file and the loader checks on decision-case exceptions; a mistyped `--exceptions` path or an unreadable `--snapshot` directory exits 2.
- The exceptions engine reads a missing readability entry as unreadable (unverifiable). The advisory pattern in the JSON Schema accepts lower case like the validator, and selectors, date tokens and the exceptions file size are bounded.

### Changed

- Snapshot `schemaVersion` 1.6 (exceptions, per-finding `exception` and `sla`, risk summaries, run metadata). Upgrade note: an existing 1.5 `public/data` fails validation until it is re-collected; `npm run ci:build` overwrites `public/data` with mock data.
- History schema 1.2 (optional `risk` counts per point; 1.0 and 1.1 are still read).
- The demo `config/policies.yaml` opts in to SLA escalation (`remediation.overdue.critical: red` and `high: red`), so Platform is red in the demo.

## [0.8.0] - 2026-10-21

### Added

- Repository controls: six read-only checks per repository (actions pinned to a commit SHA, reusable workflows up to date, default branch protected, pull request required, force push blocked, status checks required), from workflow files (Contents: read, parsed in memory, never published) and the branch rules API (Metadata: read). They are **informative by default** and feed Governance only when you set a level in the new optional `repositoryControls` policies (`enabled`, `checks`, `unknownEnforcedCheck`, `exemptActionOwners`, `maxWorkflowFiles`, `readClassicProtection`). Unknown is never a fail. A "Repository controls" section on the project page (matrix with symbols and text, detail lists), a How to read entry, Data quality rows and a `repositoryRules` capability. EN/IT docs and ADR 0007.
- OpenSSF Scorecard summary per repository, from the existing code scanning analyses and alerts.
- Discovery hints: custom properties (one call per scanned repository) and topics suggest project, component and type, group repositories into a `grouped` proposal and suggest an existing project in the catalog editor. Only the three configured property keys are kept.
- "What changed" lists repository checks that moved between pass and fail, and the portfolio CSV gains `controls_passed`, `controls_failed` and `controls_unknown`. History schema 1.1 (1.0 is still read).

### Changed

- Snapshot `schemaVersion` 1.5 (`repositoryControls` on projects and summaries, `grouped` discovery proposals with hints, the `repositoryRules` capability and three new collection error sources). Older snapshots are not read.
- Upgrade note (snapshot 1.5): an existing 1.4 `public/data` fails validation until it is re-collected; `npm run ci:build` overwrites `public/data` with mock data.
- The Governance dimension card now links to the Repository controls section (the standard workflows link moved to the end of that section).
- With `publication.audience: public`, unpinned references and reusable workflow targets of non-public repositories are withheld, and a non-public reusable-workflow repository is shown as not visible.
- Workflow files and tags are untrusted input: an identifier longer than its published bound (a target over 200 characters; a ref, tag or workflow file name over 100) is unknown and never truncated, so it can never stop a publication. YAML warnings are not printed (they would quote the source).
- Upgrade note (first v0.8.0 collection): "What changed" may list `workflow-files` and `repository-rules` collection errors as new errors, because these sources did not exist in the previous collection.

## [0.7.0] - 2026-10-21

### Added

- History: each collection is kept as a compact point in `history.json` (`kind: hub-history`, schema `1.0`, with the baseline needed for the next diff), bounded by the new optional `history` policies (`enabled`, `maxEntries` 120, `maxAgeDays` 90). The `hub-history` artifact (90 days) is restored at the start of the `collect` job from the hub's own repository with `GITHUB_TOKEN` and `actions: read` (default branch, not a fork, not the current run, at most 5 MiB), treated as untrusted input and rewritten by the collector. A failed restore never overwrites the chain (nothing is uploaded), and the `fresh-history` dispatch input resets it on purpose. A mock run never restores and starts from a synthetic fixture. New collector flags `--history-from`, `--history-fixture`, `--fresh-history` and env `HISTORY_FROM`, `HISTORY_RESTORE_STATE`.
- "What changed" page (`/changes/`, `changes.json`, `kind: hub-changes`, schema `1.0`): status changes, score, new and resolved critical/high alerts (compared only where the source was readable and monitored in both collections), version moves and collection errors per project, with plurals and spans in hours that read correctly. A fresh or unrestorable history says so and never reads as "no changes".
- Trend column on the Portfolio and Trend block on the project page: score sparkline on a fixed 0 to 100 scale (gaps are never drawn as 0), overall status strip and the history as a table.
- CSV exports under `exports/` (`portfolio.csv`, `findings-summary.csv`, `versions.csv`): UTF-8 with BOM, RFC 4180, `unknown` for unreadable values, protection against CSV injection.
- Data quality "History" card, How to read "Trends, changes and CSV" section, EN/IT docs and ADR 0006.

### Changed

- The `collect` job has `actions: read` (own repository only) and runs under the concurrency group `hub-collect` without cancelling; the caller job in `deploy-pages.yml` gets the same permission.
- `scan:output` now scans `.csv` files.

### Note

- Snapshot schema unchanged (1.4): no re-collect is needed. History starts with the first v0.7.0 collection, so "What changed" appears from the second one.

### Fixed

- The `codeQuality` capability no longer drops to "partial" when a repository has more than 300 open findings: the call answered, so the permission works (the count stays "unknown").
- Release v0.4.0 is now tagged on its release commit, so the 0.4.0 and 0.5.0 changelog links are compares like the others.
- Docs: the "not enabled" skip also applies to a 403, the `unknown` capability case is documented, the Italian ADR 0003 status is translated, and the confidence examples match the UI and the sixth dimension (EN/IT).

## [0.6.0] - 2026-10-21

### Added

- Quality dimension (test coverage): each repository's CI publishes a `hub-quality-summary` artifact (`quality-summary.json`, strict contract `1.0`, zip ≤ 64 KB, JSON Schema in `config/schema/quality-summary.schema.json`); the collector reads the newest default-branch, same-repository run with the existing Actions: read permission. Project coverage is line-weighted over readable or stale reports, each repository counted once; a component without a readable report is "not visible", never 0%, and `lines.valid: 0` is not applicable. New `quality` policies (green 80, amber 60, `missingReportIsAmber`), `freshness.qualityReportStaleDays` (14), catalog `testCoverage: required | not-applicable`, score weight 10, and `overall.optionalDimensions` (default `[quality]`: ignored when grey, so projects stay stable until CI publishes reports). Quality card, "Code quality" section and sixth portfolio bar with a threshold meter (EN/IT).
- GitHub Code Quality open-findings counts by category and severity (informative, never change the Quality status), with the `codeQuality` capability; a 403 is "not authorised", an ambiguous 404 is "unknown", and more than 300 findings in a repository is "unknown" rather than an under-count. The Code Quality setup endpoint is not called (it needs Administration: write).
- Data quality lists missing, expired, invalid, not authorised and unknown coverage reports; EN/IT docs for the contract, permissions and a CI example step; ADR 0005.

### Changed

- Snapshot `schemaVersion` 1.4: `qualityHealth`, the `quality` dimension on project snapshots and portfolio summaries, the `codeQuality` capability and the `quality-report` stale source. Older snapshots are not read.
- Upgrade note (snapshot 1.4): an existing 1.3 `public/data` fails validation until it is re-collected; `npm run ci:build` overwrites `public/data` with mock data.
- The existing Coverage dimension is labelled "Controls coverage" / "Copertura controlli" (share of required security controls enabled) so it no longer collides with test coverage; its id and policies are unchanged.

## [0.5.0] - 2026-10-20

### Added

- Project score (0–100) computed by the collector to rank and compare projects: weighted mean of the measured dimensions (green 100, amber 60, red 20), capped by the overall status (red ≤ 49, amber and grey ≤ 89), with confidence "measured n of m"; unreadable dimensions are excluded, never counted as zero, and below half measured the site shows "insufficient data". Weights, points, caps and the minimum measured ratio are configurable in an optional `score` block of `config/policies.yaml` (EN/IT docs).
- "How to read" page (EN/IT): state meanings, the six control symbols, unknown vs not authorised vs not configured vs not applicable, the score formula and caps, thresholds from `policies.yaml`; the status lists (Portfolio, Security, Versions, Workflows, project pages) end with a one-line legend that links to it.

### Changed

- Visual system "Warm Graphite" on every page: warm neutral greys, one teal accent for links, focus and the primary action, vermilion / ochre / emerald status fills with fixed pill tints, Unknown as a dashed outline (a hollow ring for the 10px status dot, which read as a spinner when dashed); light and dark palettes checked for WCAG AA by a unit test. Each page opens with one sentence, then the list worst first, detail on demand.
- Portfolio as a compact list: status dot, score with confidence, five dimension bars and the main reason; projects with insufficient data sort right after the critical ones. The bars encode the state by height as well as colour (critical full, attention two thirds, healthy one third, unknown a full-height dashed outline). The open-alerts filter says how many projects it hid because their counts are unknown. On phones the filters fold into one "Filters" disclosure and the main nav is a single row that scrolls inside itself.
- Project page: why-box with reasons as sentences (the rest behind "Show N more"; an unreadable project leads with the cause and one "All 5 dimensions unknown" line), five dimension cards, environments as a DEV → UAT → PROD path, collapsible detail sections. Security grouped per project with blind spots, the shared health badge and severity pills, and totals marked "≥" when counts are incomplete; Versions, Workflows and Data quality list only what needs attention; Catalog editor restyled.
- Navigation order: Portfolio, Security, Versions, Workflows, Data quality, Catalog; "How to read" as a header utility link.
- Snapshot `schemaVersion` 1.3: `score` on project snapshots and portfolio summaries. Older snapshots are not read: they are regenerated on every run.
- Fonts: IBM Plex Sans and IBM Plex Mono (self-hosted via `@fontsource`) replace Public Sans and Geist Mono.
- `DESIGN.md`, `.impeccable/design.json` and the Portfolio surface brief describe Warm Graphite.

### Fixed

- Portfolio filters: the search field and the selects share one 40px box with their labels on one line (WebKit ignored `min-height` on native popups); the results count sits on the controls' line; project names no longer wrap on desktop.
- The `<meta>` Content-Security-Policy no longer lists `frame-ancestors`, which browsers ignore there and report as a console error; clickjacking protection stays in the HTTP headers of `public/_headers`.

### Removed

- The "Survey Sheet" visual world: hatching, grid references, sheet frame, margin notes and the per-page legend block.
- Unused v0.4.0 components (`HealthTile`, `SeverityKpis`, `Count`, `PinCell`, `EffectiveVersion`, `ReasonList`), styles, token aliases and UI strings.

## [0.4.0] - 2026-10-18

Tagged after the fact (2026-10-21) and not deployed on its own: its changes ship with 0.5.0.

### Added

- `PRODUCT.md`: product context (users, purpose, positioning, constraints, principles, WCAG 2.2 AA); `DESIGN.md` and `.impeccable/design.json`: the "Survey Sheet" design system derived from the built UI.
- Portfolio as a survey sheet: projects × dimensions (A–F, now including Governance) with a reason per cell, the Overall column leading, a hatched "Not surveyed" band that names the cause for projects with no measured dimension, margin legend and sheet notes keyed by grid reference; status counts act as filters (EN/IT).

### Changed

- Visual world "Survey Sheet": Public Sans (self-hosted, replaces Geist Sans) with tabular figures, sheet-white ground, square corners, contour-brown sheet frame, status shown as tinted ground instead of coloured edges; a 45° hatch marks Unknown and blind spots. Light and dark palettes checked for WCAG AA by a unit test.
- Severity has its own scale and glyph (rising bars): Medium and Low findings no longer render as Healthy.
- Security controls are toned by requiredness: an optional control that is not configured is muted, a required control the collector cannot see (not authorised / unknown) is a highlighted blind spot.
- CI and deploy workflows (including `rw-hub-cloudflare-deploy.yml`) run on `ubuntu-24.04` instead of `ubuntu-latest`, which moves to Ubuntu 26.04 on 19 October 2026.
- Dependencies: Astro 7.3.8, Playwright 1.64.0, Prettier 3.9.10, prettier-plugin-astro 1.1.1, @types/node 24.19.2.

### Fixed

- Contrast below AA on the active navigation item, red badges, muted rows and input placeholders.

## [0.3.0] - 2026-10-15

### Added

- Protected hosting: reusable `rw-hub-cloudflare-deploy.yml` (collect → build → Cloudflare Pages deploy, same trust boundaries as `deploy-pages.yml`) to run the hub from a private deploy repository with the real catalog, behind Cloudflare Access; only the commit of a protected `v*` release tag is accepted as `hub-ref` (CodeQL `actions/untrusted-checkout`); caller template in `examples/protected-deploy/`; guide in `docs/protected-hosting.md` (EN/IT).
- `public/_headers`: HTTP security headers (CSP with `frame-ancestors 'none'`, `X-Frame-Options`, HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP) and `no-store` for `/data/*` on hosts that honour it (ignored by GitHub Pages).
- `CATALOG_REPOSITORY` build variable: the catalog editor targets the repository that holds the configuration.

### Changed

- CSP `<meta>`: `object-src 'none'`.

## [0.2.0] - 2026-10-14

### Added

- Submodule SHA resolution: the SHA pinned by the coordinator is resolved to a component tag (verified version) or, when untagged, compared with the latest release (ahead / behind / diverged).
- Per-component `versionSource` (`auto` | `submodule` | `manifest` | `release`) selecting the current version; drift compares that version with the latest release. Version checks for untagged pins (`version.untaggedSubmodule`) and manifest vs submodule mismatches (`version.manifestSubmoduleMismatch`).
- Catalog editor (`/catalog/`, `/it/catalog/`): edit projects, coordinator, components, submodule and monorepo links, workflows and controls; live validation in the browser; changes proposed as pull requests on GitHub (new / edit / delete file pages), no tokens in the browser.
- Repository discovery (`config/catalog.yaml`): proposes coordinators (`.gitmodules`), monorepos (npm/yarn/pnpm workspaces, lerna, `go.work`, Cargo, turbo/nx) and single repositories with their workflows; public repositories only while the site is public; proposal-only, published in `catalog.json`.
- Catalog stored one file per project (`config/projects/<id>.yaml`); the legacy `config/projects.yaml` is still read; every run restores the saved configuration (ADR 0004).
- Monorepo support: components with a `path`, versions from prefixed tags (`releaseTagPrefix`), alerts attributed to components by file path, repository-level data evaluated once per repository; single-repository projects.
- Local, git-ignored catalog (`config.local/`) for collecting real repositories without committing their names.
- Demo: `platform` monorepo project and `docs-site` discovery proposal (synthetic).

### Changed

- Snapshot `schemaVersion` 1.2 (component pin, `versionSource`, effective version and `path`; discovery in `catalog.json`). Older snapshots are not read: they are regenerated on every run.
- E2E tests build an isolated site from the golden snapshots and stop the preview server reliably.
- Deploy: SBOM attestation uses `actions/attest` (`actions/attest-sbom` is deprecated).

### Fixed

- Repositories that cannot be read (e.g. 404 from a wrong catalog) no longer turn skipped calls into "workflow missing" or "status file missing": they are Unknown (or Not authorised), so health is grey instead of amber.
- Pull-request runs from forks and `action_required` conclusions no longer affect the default-branch workflow state.

### Security

- Repository hardening: secret scanning with push protection, CodeQL default setup (`javascript-typescript`, `actions`, extended queries), read-only default `GITHUB_TOKEN` without PR approval, mandatory SHA-pinned actions, `release-tags` ruleset protecting `v*` tags, organisation 2FA (documented in `docs/security.md`).
- `scan-output`: no check-then-read race, and files too large to scan are reported instead of silently skipped (CodeQL `js/file-system-race`).
- Discovery: workspace pattern expansion from untrusted manifests is bounded (resource exhaustion).
- Deploy: CycloneDX SBOM published at `/sbom.cdx.json`; build provenance and SBOM attestations for the exact deployed bundle, signed in an isolated job that never runs npm (`gh attestation verify site.tar -R <owner>/<repo>`).
- Trivy: license findings no longer uploaded to Code Scanning; scanners `vuln,misconfig,secret`.
- Astro 7.3.6, typescript-eslint 8.71.1.

## [0.1.0] - 2026-10-03

### Added

- Engineering Project Hub MVP: a static, GitHub-native portal with a project-level view of multi-repository software delivery.
- TypeScript collector with GitHub (Octokit, GitHub App / fine-grained token / `GITHUB_TOKEN`) and mock providers, classified error handling (403/404/rate limit) and partial-data tolerance.
- Normalised snapshot model (Zod, strict allowlist schemas, `schemaVersion` 1.0) and generated JSON Schemas in `config/schema/`.
- Health evaluators for delivery, version, security risk, coverage, governance and overall, driven by `config/policies.yaml`.
- Sanitisation pipeline (projection, scrubbing, URL allowlist, publication gate) and an output secret scan.
- Astro static site in English and Italian: Portfolio, Project detail, Workflows, Versions, Security and Data quality views; light/dark themes; accessible status badges.
- Synthetic fixtures for three demo projects, golden snapshots, unit, integration and Playwright e2e tests.
- GitHub Actions: `ci.yml`, `collect-data.yml` and `deploy-pages.yml` built on reusable `rw-*` building blocks; GitHub Pages deployment via OIDC.
- Bilingual documentation (EN/IT): README, architecture, security, configuration, operations, CI and ADRs 0001–0003.

### Security

- Read-only by design: no write calls, alert dismissals or workflow triggers. Secret scanning alerts are fetched with `hide_secret=true` and only the secret type is kept.
- The public demo publishes synthetic mock data only.

[Unreleased]: https://github.com/massimilianolapuma/engineering-project-hub/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/massimilianolapuma/engineering-project-hub/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/massimilianolapuma/engineering-project-hub/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/massimilianolapuma/engineering-project-hub/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/massimilianolapuma/engineering-project-hub/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/massimilianolapuma/engineering-project-hub/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/massimilianolapuma/engineering-project-hub/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/massimilianolapuma/engineering-project-hub/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/massimilianolapuma/engineering-project-hub/releases/tag/v0.1.0
