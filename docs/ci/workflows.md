# CI building blocks

> Italian version: [docs/it/ci/workflows.md](../it/ci/workflows.md)
> Decision record: [ADR 0003](../architecture/adr/0003-ci-building-blocks-and-collect-deploy-split.md)

CI/CD is built from small **reusable workflows** (`.github/workflows/rw-*.yml`) and
**composite actions** (`.github/actions/*`), called by three project workflows: `ci.yml`,
`collect-data.yml` and `deploy-pages.yml`. All jobs run on GitHub-hosted runners
(`ubuntu-latest`). Workflows suffixed `-host` install their tools directly on the runner
(tool cache) instead of using a job container.

Conventions shared by every file:

- every third-party action is pinned to a full commit SHA, with the version in a comment;
- workflow-level permissions are `contents: read`, and any extra scope is granted per job
  with a comment that justifies it;
- inputs, outputs and event data reach `run:` only through `env:`, never as `${{ }}`
  inside the script;
- `actions/checkout` always uses `persist-credentials: false`;
- every job has a `timeout-minutes`.

## Reusable workflows

| Workflow                     | Purpose                                                                                                                    | Inputs (default)                                                                                                                                                                                          | Job permissions                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `rw-pr-title-lint.yml`       | PR title follows Conventional Commits (`amannn/action-semantic-pull-request`), with a job summary                          | `types` (feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert), `require-scope` (`false`), `header-pattern`, `subject-pattern`, `exempt-branch-prefixes` (`release-please--branches--`) | `contents: read`, `pull-requests: write`, `statuses: write`                       |
| `rw-node-quality-host.yml`   | `npm ci`, then lint, typecheck and format-check commands (an empty command skips its step)                                 | `node-version` (`24`), `working-directory` (`.`), `lint-command`, `typecheck-command`, `format-check-command` (`npm run <script> --if-present`)                                                           | `contents: read`                                                                  |
| `rw-npm-build-test-host.yml` | `npm ci`, build command, `npm run ci:test` (Vitest + coverage), coverage artifact `coverage-<run_id>`                      | `node-version` (`24`), `working-directory` (`.`), `build-command` (`npm run build --if-present`), `coverage-report-dir` (`coverage`)                                                                      | `contents: read`                                                                  |
| `rw-playwright-e2e-host.yml` | `npm ci`, `npx playwright install --with-deps <browsers>`, build, Playwright tests with `CI=1`; traces uploaded on failure | `node-version` (`24`), `working-directory` (`.`), `browsers` (`chromium`), `build-command` (`npm run build`), `test-command` (`npx playwright test`)                                                      | `contents: read`                                                                  |
| `rw-actionlint.yml`          | actionlint from the release tarball, verified against a SHA-256 pinned in the file (v1.7.12); shellcheck when available    | `actionlint-version`, `actionlint-sha256`, `config-file`, `shellcheck` (`true`), `fail-on-error` (`true`)                                                                                                 | `contents: read`                                                                  |
| `rw-zizmor.yml`              | zizmor security audit of `.github/` (offline audits), SARIF to Code Scanning + job artifact                                | none (config: `.github/zizmor.yml`)                                                                                                                                                                       | `contents: read`, `security-events: write`                                        |
| `rw-trivy-fs.yml`            | Trivy filesystem scan (vuln, misconfig, license), SARIF to Code Scanning (category `trivy-fs`)                             | `scan-path` (`.`), `severity` (`CRITICAL,HIGH`), `exit-code` (`1`)                                                                                                                                        | `contents: read`, `security-events: write`                                        |
| `rw-pages-deploy-host.yml`   | GitHub Pages: `build` job (internal build or prebuilt `artifact-name`), then `deploy` job via OIDC                         | `artifact-name`, `node-version` (`24`), `working-directory` (`.`), `build-command` (`npm run build`), `output-dir` (`dist`), `environment-name` (`github-pages`)                                          | build: `contents: read`, `pages: read`; deploy: `pages: write`, `id-token: write` |

Each file starts with a header comment that describes its purpose, a caller example and
how to test it locally.

## Composite actions

| Action           | Purpose                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| `setup-node-env` | `actions/setup-node` with the npm cache keyed on `<working-directory>/package-lock.json`              |
| `test-vitest`    | runs `npm run ci:test`; the project's Vitest config decides the coverage directory (`coverage/` here) |
| `scan-trivy`     | `aquasecurity/trivy-action` (table log + SARIF) and `github/codeql-action/upload-sarif`               |

## Project workflows

| Workflow           | Triggers                                                                     | Jobs                                                                                                                                                                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`           | `pull_request` to `main` (including title edits), `push` to `main`           | `pr-title-lint` (PR only), `node-quality`, `build-test` (`npm run ci:build`, coverage in `coverage/`), `e2e` (`npm run ci:build` + `npm run test:e2e`, Chromium), `actionlint`, `zizmor`, `trivy-fs` (advisory, `exit-code: "0"`). No secrets, mock data only |
| `collect-data.yml` | `workflow_call`, `workflow_dispatch`, `repository_dispatch` (`collect-data`) | `collect`: the only job that receives credentials. Resolves the data source (`input` → `vars.DATA_SOURCE` → `mock`), runs the collector, validates the snapshots and uploads the `snapshots` artifact                                                         |
| `deploy-pages.yml` | `schedule` (`17 */6 * * *`), `push` to `main`, `workflow_dispatch`           | `collect` (calls `collect-data.yml`), `build` (no secrets: downloads `snapshots`, `npm run build:site`, `scan:output`, uploads `site`), `deploy` (calls `rw-pages-deploy-host.yml` with `artifact-name: site`)                                                |

The repository is public, so GitHub Code Scanning is available at no cost and `zizmor` and
`trivy-fs` always upload SARIF. They are the only jobs with `security-events: write`.

## Running the checks locally

```bash
# Workflow lint (same version as CI: 1.7.12)
actionlint .github/workflows/*.yml

# Workflow security audit, offline, with the repository config
zizmor --offline .github/

# Run CI jobs with nektos/act, using podman as the container engine
podman machine start                       # macOS: start the podman VM once
export DOCKER_HOST="unix://$(podman machine inspect --format '{{.ConnectionInfo.PodmanSocket.Path}}')"
ACT_OPTS=(--container-daemon-socket - -P ubuntu-latest=catthehacker/ubuntu:act-latest)
act pull_request --workflows .github/workflows/ci.yml -j node-quality "${ACT_OPTS[@]}"
act pull_request --workflows .github/workflows/ci.yml -j build-test "${ACT_OPTS[@]}" \
  --env TMPDIR="$PWD/.astro"
act pull_request --workflows .github/workflows/ci.yml -j e2e "${ACT_OPTS[@]}"
act workflow_dispatch --workflows .github/workflows/collect-data.yml "${ACT_OPTS[@]}" \
  --input data-source=mock
```

`--container-daemon-socket -` stops act from mounting the container engine socket into the
job container, which is not needed here and does not work with the podman machine socket.

Notes for act:

- Steps guarded by `!env.ACT` are skipped: the Code Scanning upload and the diagnostic
  artifact uploads (coverage, zizmor SARIF, Playwright traces). The act artifact server
  does not support `actions/upload-artifact` v7, so the `snapshots` upload at the end of
  `collect-data.yml` also fails locally; the earlier steps are still checked.
- On Apple silicon add `--container-architecture linux/arm64` (or `linux/amd64`).
- With podman, `build-test` needs `--env TMPDIR="$PWD/.astro"` (a workspace directory
  created by the build step): the integration test builds the site into a temp directory,
  and in the act container `/tmp` is on a different filesystem from the workspace, which
  breaks Astro's file renames (`EXDEV`). GitHub-hosted runners are not affected.
- The `deploy` job cannot run locally because it needs real OIDC and the Pages API.

## Repository settings

These are one-off settings and cannot be applied from the workflows:

- **Pages**: Settings → Pages → Source: "GitHub Actions". Until then
  `actions/configure-pages` fails, because `GET /repos/{owner}/{repo}/pages` returns 404.
- **Environment `github-pages`**: created by GitHub when Pages is enabled. Add a deployment
  branch rule that allows `main` only.
- **Variable `DATA_SOURCE`**: `mock` or `github`. When it is unset, the deploy uses `mock`.
- **Secrets** (optional, needed only when `DATA_SOURCE=github`): `GH_APP_ID`,
  `GH_APP_PRIVATE_KEY` and `GH_APP_INSTALLATION_ID` (preferred), or `GH_READ_TOKEN`
  (fine-grained PAT, read-only). Without them the collector falls back to the workflow
  `GITHUB_TOKEN`, which can read this repository only.
- **Pull requests** (recommended): allow squash merging only, with the PR title as the
  default commit message, and require the CI checks on `main` through a ruleset.
- **`.github/zizmor.yml`** must exist: `rw-zizmor.yml` passes it as `config`.

### GitHub App permissions for the collector (read-only)

The table maps each REST endpoint to the permission it needs. Source:
[Permissions required for GitHub Apps](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps).
API key names come from
[Create an installation access token](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app).

| Endpoint                                                         | Permission (UI name)             | API key                  | Access |
| ---------------------------------------------------------------- | -------------------------------- | ------------------------ | ------ |
| `GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs` | Actions                          | `actions`                | read   |
| `GET /repos/{owner}/{repo}/releases/latest`                      | Contents                         | `contents`               | read   |
| `GET /repos/{owner}/{repo}/tags`                                 | Metadata                         | `metadata`               | read   |
| `GET /repos/{owner}/{repo}/contents/{path}`                      | Contents                         | `contents`               | read   |
| `GET /repos/{owner}/{repo}/code-scanning/alerts`                 | Code scanning alerts             | `security_events`        | read   |
| `GET /repos/{owner}/{repo}/dependabot/alerts`                    | Dependabot alerts                | `vulnerability_alerts`   | read   |
| `GET /repos/{owner}/{repo}/secret-scanning/alerts`               | Secret scanning alerts           | `secret_scanning_alerts` | read   |
| `GET /repos/{owner}/{repo}/deployments`                          | Deployments                      | `deployments`            | read   |
| `GET /repos/{owner}/{repo}/environments`                         | **Actions** (not "Environments") | `actions`                | read   |

The "Environments" permission (`environments`) only covers environment **secrets and
variables**, such as `GET …/environments/{environment_name}/secrets` and `…/variables`.
Listing environments needs **Actions: read**, so the App does not need "Environments"
unless it reads environment variables. "Metadata: read" is always granted implicitly.

## Updating pinned versions

Dependabot (`.github/dependabot.yml`) opens one grouped PR per week for GitHub Actions
(`chore(ci)`) and for npm (`chore(deps)`; majors in a separate group). It updates the SHAs
in workflows and composite actions. actionlint is not an action: to bump it, change
`ACTIONLINT_DEFAULT_VERSION` and both `ACTIONLINT_SHA256_*` values in `rw-actionlint.yml`
together, using the release's `checksums.txt`. After any change, run `actionlint` and
`zizmor --offline .github/` with zero findings.
