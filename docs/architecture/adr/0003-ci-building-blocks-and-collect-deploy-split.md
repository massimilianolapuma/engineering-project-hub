# ADR 0003: Reusable CI building blocks and a collect/build/deploy split

- **Status:** Accepted
- **Date:** 2026-10-03
- **Italian version:** [docs/it/architecture/adr/0003-ci-building-blocks-and-collect-deploy-split.md](../../it/architecture/adr/0003-ci-building-blocks-and-collect-deploy-split.md)

## Context

Engineering Project Hub is a static, GitHub-native portal. A Node.js collector reads data
from several repositories through the GitHub API, writes sanitized JSON snapshots, and an
Astro build publishes them on GitHub Pages. The CI/CD has to:

- run a complete set of quality gates: PR title lint, lint, typecheck and format check,
  unit and integration tests with coverage, end-to-end tests, workflow lint, workflow
  security audit, and a filesystem vulnerability scan;
- refresh data on a schedule and deploy to GitHub Pages;
- handle GitHub credentials safely. The collector needs a GitHub App or a read-only token.
  The build and deploy steps don't need either.

The repository is public and runs on GitHub-hosted runners (Free plan).

## Decision

1. **Reusable building blocks.** Each gate is a small reusable workflow
   (`.github/workflows/rw-*.yml`) or composite action (`.github/actions/*`) with documented
   inputs, called by three project workflows (`ci.yml`, `collect-data.yml`,
   `deploy-pages.yml`). The blocks follow the conventions of an internal CI toolchain the
   author maintains, so they stay generic and can be reused by other repositories. The
   inventory is in [docs/ci/workflows.md](../../ci/workflows.md).
2. **Collect, build and deploy are separate jobs, chained through a reusable workflow.**
   - `collect-data.yml` (`workflow_call`, `workflow_dispatch`, `repository_dispatch`) is the
     **only** job that receives secrets (`GH_APP_ID`, `GH_APP_PRIVATE_KEY`,
     `GH_APP_INSTALLATION_ID`, `GH_READ_TOKEN`, all optional). They are passed via `env:` to
     the single `Collect` step. The job's `GITHUB_TOKEN` has `contents: read` only. The job
     validates the snapshots and uploads them as the `snapshots` artifact.
   - `deploy-pages.yml` calls `collect-data.yml` with explicit secrets. Its `build` job gets
     **no secrets**: it downloads `snapshots`, builds the site with `SITE_URL`/`BASE_PATH`
     from `actions/configure-pages`, runs `scan:output`, and uploads `site`. The `deploy` job
     calls `rw-pages-deploy-host.yml` with `artifact-name: site`. Only that job holds
     `pages: write` and `id-token: write`, and it authenticates through OIDC, not a secret.
   - As a result, a compromised build dependency never sees credentials, and the job that
     sees credentials can't publish.
3. **Least privilege everywhere.** Workflow-level permissions are `contents: read`. Write
   scopes are granted per job with a justification comment. Every third-party action is
   pinned to a full commit SHA, and `actions/checkout` never persists credentials. Every
   input, output or event field that reaches `run:` goes through `env:`. Every job has a
   timeout, and CI and deploy runs use `concurrency` groups.
4. **Code scanning always on.** Code Scanning is free for public repositories, so `zizmor`
   and `trivy-fs` always upload SARIF. They are the only jobs with `security-events: write`.
5. **Mock data by default.** CI never uses secrets and builds from mock data. The deploy
   uses `vars.DATA_SOURCE`, which defaults to `mock`.

## Consequences

**Positive**

- Each gate can be run, reviewed and changed on its own, and reused by other repositories.
- Secrets are confined to one step of one job. Build and deploy can't leak them.
- Pages deploys never cancel each other (`concurrency: pages` and `pages-<repo>`,
  `cancel-in-progress: false`).
- Dependabot keeps the pinned SHAs current through weekly grouped PRs.

**Negative / risks**

- More files than a single monolithic workflow. Mitigation: header comments in every file
  and the inventory in `docs/ci/workflows.md`.
- `rw-zizmor.yml` expects `.github/zizmor.yml` to exist.
- The deploy needs one-off repository settings: Pages source set to "GitHub Actions", and a
  deployment branch rule on the `github-pages` environment.
