# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: engineering leads and CTO-office staff who review a portfolio of multi-repository projects on a recurring (weekly) basis. Their job: find which project is at risk, understand why, and see what is not known about it.

Secondary: DevSecOps engineers (security findings, scanner coverage, CI health) and project managers (versions and environments).

## Product Purpose

A project-level view of multi-repository software delivery. A project is one logical unit (a coordinator repository with submodules, a monorepo, or a single repository); the portal shows its health across delivery, version, security risk, security controls coverage, governance and quality (test coverage, six dimensions in all), plus an overall status composed from those dimensions. Governance also shows repository controls (actions pinned to a SHA, reusable workflows up to date, a protected default branch, an OpenSSF Scorecard summary): informative by default, and never read as failing when they are not visible. Success: a lead can answer "which project needs attention and why" without opening GitHub repository by repository.

## Positioning

Every dimension is shown separately with its reasons, and what is not known is always declared: not authorised, not configured, unknown and collection failed are distinct states and are never shown as zero or as healthy. A zero only appears when it was actually measured.

## Operating Context

- Data is collected by a TypeScript collector in GitHub Actions with read-only credentials (GitHub App preferred), sanitised, and published as static JSON snapshots; the site is built from those snapshots.
- Public demo on GitHub Pages uses synthetic mock data only. Real data is published behind a login (Cloudflare Pages + Access) from a private deploy repository.
- The catalog (projects, components, coordinators, workflows, controls) is edited from the UI and proposed as pull requests on GitHub; repository discovery only proposes, never applies.

## Capabilities and Constraints

- Read-only by design: no writes to repositories, alerts or workflows; no remediation, no dismissals, no workflow triggers.
- Static site, no runtime backend, no database, no GitHub API calls and no tokens in the browser.
- Health states: green (Healthy), amber (Attention), red (Critical), grey (Unknown). Overall never hides the dimensions that compose it. Test coverage is its own Quality dimension, optional until CI publishes reports: a missing or unreadable report is "not visible", never 0% and never healthy; the older Coverage dimension is called "Controls coverage".
- Project score (0–100) for ranking and comparing projects, computed by the collector from the measured dimensions and capped by the overall status (a critical project always ranks below an attention one); it shows its confidence ("measured n of m"), excludes unreadable dimensions instead of counting them as zero, and is replaced by "insufficient data" when fewer than half are measured. It sits next to the status and never replaces the dimensions.
- History (v0.7.0): each collection is kept as a compact point (retention in `policies.yaml`), shown as a score trend and a "What changed since last collection" page, and exported as three CSV files. A gap is never 0, a fresh history is never "no changes", and alerts are compared only where the source was readable in both collections.
- Risk governance (v0.9.0): security exceptions (an owned, explained, time-boxed acceptance kept in reviewed config, never a dismissal on GitHub), remediation SLAs per severity (age and due date from the alert's creation time) and `npm run policy:check` with decision cases. Accepted findings are listed apart and leave the counts until the exception expires; an overdue alert is informative unless the owner opts in to escalation. An unknown age is never "within SLA" and an unreadable source never confirms an exception.
- 403 is not "no alerts"; 404 is not "scanner disabled" without context; zero findings is not "scanner unavailable"; an old scan is not current state.
- Secret scanning values are never published, only the secret type.
- Bilingual UI and docs: English (default, `/`) and Italian (`/it/`).
- Per-user or per-project authorisation needs a backend (ADR 0004); undecided for now.

## Evidence on Hand

- Synthetic demo data: `fixtures/` and golden snapshots (Project Alpha, Beta, Gamma, Platform monorepo). No real customer or company data may be used in fixtures or the public site.
- No testimonials, customers or usage metrics exist; do not fabricate them.

## Product Principles

1. Unknown is a first-class state, never a zero.
2. Show the reason next to every status; overall is always explained by its dimensions.
3. Read-only and least privilege: the portal observes, it never acts on repositories.
4. Static-first and GitHub-native: no backend until the product proves it needs one.
5. The real risk must be the most visible thing on the screen.

## Accessibility & Inclusion

WCAG 2.2 AA: text contrast at least 4.5:1, complete keyboard and screen-reader use, status never conveyed by colour alone. Bilingual EN/IT.
