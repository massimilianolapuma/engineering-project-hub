# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Protected hosting: reusable `rw-hub-cloudflare-deploy.yml` (collect → build → Cloudflare Pages deploy, same trust boundaries as `deploy-pages.yml`) to run the hub from a private deploy repository with the real catalog, behind Cloudflare Access; caller template in `examples/protected-deploy/`; guide in `docs/protected-hosting.md` (EN/IT).
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

[Unreleased]: https://github.com/massimilianolapuma/engineering-project-hub/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/massimilianolapuma/engineering-project-hub/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/massimilianolapuma/engineering-project-hub/releases/tag/v0.1.0
