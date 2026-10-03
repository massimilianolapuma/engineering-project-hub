# ADR 0001: Static-first, GitHub-native architecture

- **Status:** Accepted
- **Date:** 2026-10-03
- **Italian version:** [docs/it/architecture/adr/0001-static-first-github-native.md](../../it/architecture/adr/0001-static-first-github-native.md)

## Context

We need a project-level view across many GitHub repositories. Constraints:

- no permanent infrastructure and no database;
- everything hosted and run on GitHub;
- no credentials in the browser;
- security data must be shown without leaking sensitive details.

## Decision

- A **TypeScript collector** runs in **GitHub Actions** on a schedule. It reads the GitHub
  REST API with read-only credentials and writes **sanitised JSON snapshots**.
- An **Astro static build** renders every page from those snapshots at build time. The
  build is published on **GitHub Pages**.
- The browser **never calls the GitHub API**. Client JavaScript is limited to filters,
  relative times and the theme toggle, and the CSP forbids inline and third-party scripts.
- Catalog and policies are **YAML in the repository**, validated with Zod. Discovery
  through topics or custom properties is reserved for later.
- Mock mode (synthetic fixtures) is the default, so the site works without credentials.

## Alternatives considered

- **SPA calling the GitHub API with a user token.** Rejected: tokens would live in the
  browser, every viewer would need permissions on every repository, and rate limits would
  apply per viewer.
- **Server or Backstage-like portal with a database.** Rejected for the MVP: it needs
  permanent infrastructure, authentication and operations. It could come later.
- **GitHub Projects or organisation dashboards.** Rejected: they cannot model a coordinator
  with submodules, version drift or coverage as separate dimensions.

## Consequences

- Positive: no runtime attack surface, cheap to run, auditable (snapshots are artifacts),
  and the data is identical for every viewer.
- Negative: data is only as fresh as the schedule (6 h by default), and there is no
  per-user authorisation inside the site. Visibility follows the Pages audience, which is
  mitigated by `publication.audience` and documented in [security.md](../../security.md).
- Mitigation for freshness: the stale indicators are computed in the browser.
