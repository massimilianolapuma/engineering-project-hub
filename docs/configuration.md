# Configuration

> 🇮🇹 [Versione italiana](it/configuration.md)

Everything is configuration as code, versioned in `config/`, and validated with Zod by
`npm run validate:config`, which also runs in CI and before every collection. Editors with
the YAML language server get completion from the generated JSON Schemas in `config/schema/`
(`npm run schema:generate`). Unknown keys are **rejected**, so a typo cannot be silently
ignored.

## `config/projects.yaml`: catalog

```yaml
discovery:
  topics: false # reserved (roadmap): repository topics discovery
  customProperties: false # reserved (roadmap): GitHub custom properties

projects:
  - id: project-alpha # lowercase slug, unique
    name: Project Alpha
    description: Free text (≤ 500 chars)
    businessUnit: Payments
    lifecycle: production # experimental | development | production | maintenance | deprecated

    coordinator:
      repository: example-org/project-alpha-coordinator # owner/name
      defaultBranch: main # optional: otherwise the repository default; mismatch = governance amber
      manifestPath: release-manifest.yaml # optional (default shown)
      notApplicableControls: [containerScanning] # optional

    components: # at least one
      - id: backend # slug, unique, "coordinator" is reserved
        name: Backend API
        repository: example-org/project-alpha-backend
        type: service # service | webapp | worker | deployment | infrastructure | library | other
        defaultBranch: main # optional
        submodulePath: services/backend # optional: path of the submodule in the coordinator
        versionSource: auto # optional: auto | submodule | manifest | release (see below)
        releaseTagPrefix: backend- # optional: stripped before version comparison
        notApplicableControls: [] # optional: controls that do not apply (e.g. containerScanning on Helm)

    environments: # optional, display order
      - { id: dev, name: DEV }
      - { id: prod, name: PROD }

    trackedWorkflows: # optional
      - id: ci # slug, unique
        name: Continuous Integration
        file: ci-main.yml # workflow file name in .github/workflows
        critical: true # critical workflows drive Delivery health
        appliesTo: [backend, frontend] # optional: component ids or "coordinator"; default = all components

    securityControls: # all eight are mandatory
      codeScanning: { required: true }
      secretScanning: { required: true }
      dependabot: { required: true }
      containerScanning: { required: false }
      iacScanning: { required: false }
      dast: { required: false }
      sbom: { required: false }
      artifactSignature: { required: false }

    securityStatusPath: .security/project-security-status.json # optional (default shown)
```

The validation rules are:

- `owner/name` format
- unique project, component, environment and workflow ids
- unique `submodulePath`
- `appliesTo` may only reference known components
- relative paths without `..`
- valid workflow file names

### Component mapping

Associations are **explicit**. Nothing is inferred from repository names.

1. Each component declares its `repository`.
2. Submodules found in the coordinator's `.gitmodules` are associated:
   - by **configured path** (`submodulePath`), or else
   - by **remote URL**, when it resolves to the component's `owner/name` (https, ssh and
     relative `../name.git` are supported), or else
   - they stay **unmapped**. This is shown on the Versions and Data quality views, and is
     amber by default.
3. A component with `submodulePath` that is not in `.gitmodules` is **unresolvable**,
   which is red by default.

### Submodule SHA resolution and `versionSource`

For every component linked to a submodule, the collector reads the **SHA the coordinator
pins** (Contents API) and resolves it in the component repository:

| Pin status | Meaning                                                                                |
| ---------- | -------------------------------------------------------------------------------------- |
| `tagged`   | The SHA is exactly a tag (the highest semver wins if several): a **verified** version. |
| `ahead`    | Not tagged; N commits after the latest release (unreleased code is pinned).            |
| `behind`   | Not tagged; older than the latest release.                                             |
| `diverged` | Not tagged; not on the latest release's history.                                       |
| `unknown`  | SHA, tags or comparison not readable.                                                  |

Up to 300 most recent tags are scanned (`GET /tags`); when no tag matches, one
`GET /compare/{latestRelease}...{sha}` gives the distance (only status and counters are kept).

`versionSource` (per component, default `auto`) chooses the **current version**:

| Value       | Current version                                                           |
| ----------- | ------------------------------------------------------------------------- |
| `auto`      | Verified pin (tag on the submodule SHA) → manifest declaration → unknown. |
| `submodule` | Only the verified pin.                                                    |
| `manifest`  | Only the release manifest declaration.                                    |
| `release`   | The component's latest release (component deployed on its own cadence).   |

Version checks (levels in `policies.yaml` → `version`):

- **drift**: current version ≠ latest release (`componentDrift`);
- **untagged pin**: the coordinator pins a SHA that is not a release tag (`untaggedSubmodule`);
- **manifest vs submodule**: the manifest declares a version different from the pinned tag
  (`manifestSubmoduleMismatch`).

### Workflow tracking

For each tracked workflow and each target (`appliesTo`, by default every component), the
collector reads the last 20 runs of `file` on the default branch. The cell state is
derived from the **last completed run**:

| Last completed run                           | State                                           |
| -------------------------------------------- | ----------------------------------------------- |
| success, neutral or skipped                  | Success                                         |
| failure, timed_out or startup_failure        | Failed (with the failed job/step name)          |
| cancelled                                    | Cancelled                                       |
| no run yet, but one is queued or in progress | Queued / In progress                            |
| no run at all                                | Never run                                       |
| workflow file not found (404)                | Missing (governance: standard workflow missing) |
| 403                                          | Not authorised                                  |

A run is **stale** when its last completed run is older than
`freshness.workflowRunStaleDays`.

### Required and optional controls

- **Required** controls count towards coverage, and their failure or staleness affects
  Security risk.
- **Optional** controls are shown but never lower coverage.
- `notApplicableControls` removes a control for one repository: it is neither counted nor
  required.
- **Native GitHub controls**: code scanning (with the latest analysis date, used for
  staleness), secret scanning and Dependabot.
- **Pipeline controls**: container and IaC scanning, DAST, SBOM and artifact signature.
  These are read from the security status file.

### Adding a project (no code change)

1. Add an entry under `projects:` in `config/projects.yaml`.
2. `npm run validate:config`
3. `npm run collect:github` (or wait for the schedule). Make sure the GitHub App is
   installed on the new repositories, or that the PAT covers them.
4. Optional: add `release-manifest.yaml` to the coordinator and
   `.security/project-security-status.json` to the components.
5. Open a PR. CI validates the configuration.

### Catalog editor

The portal's **Catalog** page (`/catalog/`, `/it/catalog/`) edits the catalog without
touching YAML by hand: pick a project (or create one), link its coordinator, components,
environments, tracked workflows and required controls, and choose each component's
`versionSource`. A **Suggestions** panel lists the coordinator submodules that no component
links to (from the last collector run); _Add as component_ creates a component linked by
its configured `submodulePath`, with the repository prefilled when known.

The page stays static and read-only: it is built from `public/data/catalog.json` (written
by the collector, it never reads `config/` directly), validates live in the browser with
the same Zod schema as `npm run validate:config`, and generates the **whole**
`config/projects.yaml` (empty and default values omitted). It never calls the GitHub API
and holds no token: copy or download the YAML, open `config/projects.yaml` in the GitHub
editor (link derived from `package.json` `repository.url`), commit to a new branch and open
a PR. Your own GitHub permissions apply and CI validates the result. Comments in the
hand-written file are not preserved, so review the diff before committing.

## `config/policies.yaml`: health policies

These are MVP policies, not universal risk ratings. Changing them needs no code or
frontend change.

| Key                                     | Default                       | Meaning                                                                                                                |
| --------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `freshness.snapshotStaleHours`          | 24                            | The site flags the snapshot as stale (computed in the browser).                                                        |
| `freshness.workflowRunStaleDays`        | 14                            | Last completed run older than this is stale.                                                                           |
| `freshness.securityScanStaleDays`       | 7                             | Last code scanning analysis older than this is stale.                                                                  |
| `freshness.securityStatusFileStaleDays` | 7                             | Pipeline status results older than this are stale.                                                                     |
| `delivery.queuedThresholdMinutes`       | 60                            | Queued or running longer than this means Attention.                                                                    |
| `delivery.missingCriticalWorkflow`      | amber                         | Status for a critical workflow that is missing or has never run.                                                       |
| `delivery.failedCriticalWorkflow`       | red                           | Status for a failed or cancelled critical workflow.                                                                    |
| `security.redOnSeverities`              | [critical]                    | Open findings at these severities make Security risk red.                                                              |
| `security.amberOnSeverities`            | [high, medium, low]           | Open findings at these severities make Security risk amber.                                                            |
| `security.openSecretAlertIsRed`         | true                          | An open secret scanning alert is red.                                                                                  |
| `security.requiredControlFailedIsRed`   | true                          | A failed required control is red.                                                                                      |
| `security.staleScanIsAmber`             | true                          | A stale required scan is amber.                                                                                        |
| `security.incompleteCoverageIsAmber`    | true                          | Coverage that is not green makes Security risk amber.                                                                  |
| `coverage.greenThresholdPercent`        | 100                           | Coverage is green at or above this percentage.                                                                         |
| `version.componentDrift`                | amber                         | Declared version differs from the latest release.                                                                      |
| `version.environmentBehind`             | amber                         | Environment behind, or mismatched with, the coordinator version.                                                       |
| `version.unresolvableSubmodule`         | red                           | A configured submodule cannot be resolved.                                                                             |
| `version.unknownManifestComponent`      | red                           | The manifest references an unknown component.                                                                          |
| `version.unmappedSubmodule`             | amber                         | A submodule not mapped to any component.                                                                               |
| `version.untaggedSubmodule`             | amber                         | The coordinator pins a SHA that is not a release tag of the component.                                                 |
| `version.manifestSubmoduleMismatch`     | amber                         | The manifest declares a version different from the one pinned by the submodule.                                        |
| `governance.*`                          | amber                         | Missing standard workflow, archived repository, missing or invalid status file, default branch mismatch.               |
| `overall.criticalDimensions`            | [delivery, version, security] | A red here makes the project red. A red elsewhere counts as amber.                                                     |
| `overall.requiredDimensions`            | all five                      | All must be green for Overall to be green.                                                                             |
| `overall.greyRequiredDimension`         | grey                          | Effect of an Unknown required dimension (grey or amber).                                                               |
| `publication.audience`                  | public                        | `public` withholds finding titles and rule ids of non-public repositories. `restricted` needs access-controlled Pages. |
| `publication.allowedLinkHosts`          | [github.com]                  | Only links to these hosts are published.                                                                               |

## Contracts read from monitored repositories

### `release-manifest.yaml` (coordinator, optional)

```yaml
schemaVersion: '1.0'
version: 1.4.0 # coordinator version
components: # expected versions, keyed by component id
  backend: { version: 1.4.0 }
  frontend: { version: 2.1.0 }
environments: # what each environment is declared to run
  dev: { version: 1.4.0 }
  prod: { version: 1.3.0 }
```

If there is no manifest, the coordinator version falls back to its latest release, then its
latest tag, and Version health is amber ("versions only partially known"). An unknown
component id in the manifest is red.

### `.security/project-security-status.json` (each repository, optional)

```json
{
  "schemaVersion": "1.0",
  "generatedAt": "2026-10-03T08:00:00Z",
  "repository": "example-org/example-repo",
  "version": "1.2.3",
  "commitSha": "<40-hex sha>",
  "controls": {
    "containerScanning": {
      "status": "completed",
      "tool": "trivy",
      "critical": 0,
      "high": 2,
      "medium": 4,
      "low": 1,
      "reportUrl": "https://github.com/..."
    },
    "iacScanning": {
      "status": "completed",
      "tool": "checkov",
      "critical": 0,
      "high": 0,
      "medium": 3,
      "low": 2
    },
    "dast": { "status": "not-configured" },
    "sbom": { "status": "available", "format": "cyclonedx" },
    "artifactSignature": { "status": "verified" }
  }
}
```

Statuses map onto control states as follows:

| Status file value                          | Control state                                   |
| ------------------------------------------ | ----------------------------------------------- |
| `completed`, `available`, `verified`       | Enabled, or Stale when older than the threshold |
| `failed`, `not-verified`                   | Scan failed                                     |
| `not-configured`, or the control is absent | Not configured                                  |
| `not-run`, `running`                       | Configured, not run                             |

The following count as Unknown and add an `invalid-data` collection error: a missing file
(when pipeline controls are required, this also shows as governance amber), an invalid
file, or a file whose `repository` does not match.
`reportUrl` is published only for allow-listed hosts.

## Environment variables

| Variable                                                    | Where                     | Purpose                                           |
| ----------------------------------------------------------- | ------------------------- | ------------------------------------------------- |
| `DATA_SOURCE`                                               | repository variable / env | `mock` (default) or `github`                      |
| `GH_APP_ID`, `GH_APP_PRIVATE_KEY`, `GH_APP_INSTALLATION_ID` | Actions secrets           | GitHub App authentication (preferred)             |
| `GH_READ_TOKEN`                                             | Actions secret            | Fallback fine-grained PAT                         |
| `GITHUB_TOKEN`                                              | automatic                 | Last fallback (current repository only)           |
| `GITHUB_API_URL`                                            | automatic / env           | API base URL (GitHub Enterprise Server)           |
| `SITE_URL`, `BASE_PATH`                                     | set by deploy workflow    | Astro `site` and `base` (from configure-pages)    |
| `SNAPSHOT_DIR`                                              | local / tests             | Alternative snapshot directory for the site build |
