# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- Repository hardening: secret scanning with push protection, CodeQL default setup (`javascript-typescript`, `actions`, extended queries), read-only default `GITHUB_TOKEN` without PR approval, mandatory SHA-pinned actions, `release-tags` ruleset protecting `v*` tags (documented in `docs/security.md`).
- `scan-output`: no check-then-read race (one file handle) and files too large to scan are reported instead of silently skipped (CodeQL `js/file-system-race`).
- Deploy: CycloneDX SBOM published at `/sbom.cdx.json`; build provenance and SBOM attestations for the exact deployed bundle (`gh attestation verify site.tar -R <owner>/<repo>`).
- Trivy: license findings no longer uploaded to Code Scanning (not vulnerabilities, ~40 noise alerts); scanners now `vuln,misconfig,secret` (configurable).
- Astro 7.3.6, typescript-eslint 8.71.1.

### Added

- Repository discovery (`config/catalog.yaml`): the collector scans the configured owners (public repositories only while the site is public) and proposes coordinators (`.gitmodules`), monorepos (npm/yarn/pnpm workspaces, lerna, `go.work`, Cargo, turbo/nx) and single repositories, with their workflows. Proposals are published in `catalog.json` and never applied automatically.
- Catalog stored one file per project (`config/projects/<id>.yaml`); the legacy `config/projects.yaml` is still read. The catalog editor proposes changes as pull requests on GitHub (new / edit / delete file pages), so the saved configuration is restored on every run (ADR 0004).
- Monorepo support: components with a `path` inside the coordinator repository, versions from prefixed tags (`releaseTagPrefix`), alerts attributed to components by file path, repository-level data evaluated once per repository. Single-repository projects (no components).
- Demo: `platform` monorepo project and `docs-site` discovery proposal (synthetic).

### Changed

- Snapshot `schemaVersion` 1.2 (component `path`, discovery in `catalog.json`).

### Fixed

- Repositories that cannot be read (e.g. 404 from a wrong catalog) no longer turn their skipped calls into "workflow missing" or "status file missing": workflows, controls and the manifest are Unknown, so Delivery, Coverage and Overall are grey instead of amber. Skipped calls are not reported as extra errors and do not affect capability availability.

### Added

- Local, git-ignored catalog (`config.local/`) documented for collecting real repositories without committing their names to this public repository.

### Added

- Submodule SHA resolution: the SHA pinned by the coordinator is resolved to a component tag (verified version) or, when untagged, compared with the latest release (ahead / behind / diverged).
- Per-component `versionSource` (`auto` | `submodule` | `manifest` | `release`) selecting the current version; drift now compares that version with the latest release.
- Version checks for untagged pins (`version.untaggedSubmodule`) and manifest vs submodule mismatches (`version.manifestSubmoduleMismatch`).
- Catalog editor page (`/catalog/`, `/it/catalog/`): select projects, coordinator, components, submodule links (suggested from unmapped submodules), workflows and controls; validates in the browser and generates `config/projects.yaml` to apply through a GitHub pull request.
- Collector publishes `catalog.json` (validated catalog + link suggestions).

### Changed

- Snapshot `schemaVersion` 1.1 (new component fields).

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

[Unreleased]: https://github.com/massimilianolapuma/engineering-project-hub/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/massimilianolapuma/engineering-project-hub/releases/tag/v0.1.0
