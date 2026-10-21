# Configuration

> 🇮🇹 [Versione italiana](it/configuration.md)

Everything is configuration as code, versioned in `config/`, and validated with Zod by
`npm run validate:config`, which also runs in CI and before every collection. Editors with
the YAML language server get completion from the generated JSON Schemas in `config/schema/`
(`npm run schema:generate`). Unknown keys are **rejected**, so a typo cannot be silently
ignored.

## Catalog: `config/catalog.yaml` + `config/projects/<id>.yaml`

The catalog is stored **one file per project**, so the catalog editor can propose a
change as a single-file pull request and Git keeps the history (see
[ADR 0004](architecture/adr/0004-configuration-store-and-discovery.md)):

```text
config/
  catalog.yaml            # optional: discovery settings
  projects/
    project-alpha.yaml    # one ProjectConfig; the file name must equal its id
    platform.yaml
  policies.yaml
  projects.yaml           # legacy single-file catalog: still read and merged
```

Every collector run loads this configuration, so a restart always starts from the last
saved state. The catalog may be empty when discovery is enabled (bootstrap).

### `config/catalog.yaml`: discovery

```yaml
discovery:
  enabled: true
  owners: [example-org] # organisations or users to scan
  includePrivate: false # forced to false while publication.audience is "public"
  includeForks: false
  includeArchived: false
  maxRepositories: 200 # API budget per run
  topics: true # read repository topics as hints
  customProperties: true # one extra call per scanned repository (Metadata: read)
  hints: # all optional; these are the defaults
    projectProperty: hub-project # custom property → project id
    componentProperty: hub-component # custom property → component id
    typeProperty: hub-component-type # custom property → component type
    projectTopicPrefix: project- # topic "project-tools" → project "tools"
    typeTopicPrefix: type- # topic "type-worker" → type worker
```

Discovery is **read-only and proposal-only**. The results are published in `catalog.json`
and shown in the catalog editor (`/catalog/`):

| Proposal      | Detected when                                                                                                                            | Components                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `coordinator` | the repository has a `.gitmodules` whose submodules point to scanned repositories                                                        | one per submodule (`submodulePath`)                              |
| `monorepo`    | a workspace manifest: npm/yarn `workspaces`, `pnpm-workspace.yaml`, `lerna.json`, `go.work`, Cargo `[workspace]`, `turbo.json`/`nx.json` | one per workspace directory (`path`, `releaseTagPrefix: <id>-v`) |
| `grouped`     | two or more single repositories that share the same hinted project (see below)                                                           | one per extra repository (`versionSource: release`)              |
| `single`      | anything else                                                                                                                            | none (the repository is the project)                             |

- Repositories that are submodules of a discovered coordinator are not proposed on their
  own.
- Proposals whose repository is already the coordinator of a catalog project are marked
  as such, so they can be compared and merged.
- Workflows found in each repository are proposed as tracked workflows. Files starting
  with `ci`, `build`, `test`, `release`, `rel-`, `cd` or `deploy` are marked critical.
- **Hints** (`topics`, `customProperties`, `hints`). Per scanned repository the collector reads its topics (already part of the repository list) and, when `customProperties` is on, its custom property values (`GET /repos/{owner}/{repo}/properties/values`, **Metadata: read**). Only the three configured property keys are kept: every other property is dropped before anything is stored, so it never reaches `catalog.json`.
  - A property beats a topic. Project and component values must be slugs, and the type must be a component type; anything else is ignored and the proposal's evidence says so. Several `project-*` topics are ambiguous and ignored.
  - Structure detection (coordinator, monorepo, single) is unchanged. A hinted type replaces the guessed one, and a hinted component id replaces the slug.
  - Single repositories that share a hinted project and are not claimed by a coordinator become one `grouped` proposal (the coordinator is the repository hinted `coordinator`, else the first alphabetically). When the hinted project already exists in the catalog and the repository is not part of it, the editor shows "Suggested for project X". Nothing is merged automatically.
  - A 403 on the properties call is recorded as a discovery error and topic hints still apply.
- Calls used: list the owner's repositories, `.gitmodules`, the root and workspace
  directory listings, the workspace manifests and the workflows list. No new GitHub App
  permission is needed (Metadata, Contents, Actions).

### `config/projects/<id>.yaml`: one project

```yaml
id: project-alpha # lowercase slug, unique; must equal the file name
name: Project Alpha
description: Free text (≤ 500 chars)
businessUnit: Payments
lifecycle: production # experimental | development | production | maintenance | deprecated

coordinator:
  repository: example-org/project-alpha-coordinator # owner/name
  defaultBranch: main # optional: otherwise the repository default; mismatch = governance amber
  manifestPath: release-manifest.yaml # optional (default shown)
  notApplicableControls: [containerScanning] # optional

components: # optional: empty for single-repository projects
  - id: backend # slug, unique, "coordinator" is reserved
    name: Backend API
    repository: example-org/project-alpha-backend
    type: service # service | webapp | worker | deployment | infrastructure | library | other
    defaultBranch: main # optional
    submodulePath: services/backend # optional: path of the submodule in the coordinator
    # path: services/backend          # monorepo: directory inside the repository (see below)
    versionSource: auto # optional: auto | submodule | manifest | release (see below)
    releaseTagPrefix: backend- # optional: tags of this component ("backend-1.2.0")
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

### Monorepo and single-repository projects

- **Monorepo**: every component uses the coordinator's `repository` plus a `path`. The
  `path` is required in that case, and it excludes `submodulePath`.
  - Versions: with `releaseTagPrefix` (e.g. `api-v`), the latest version is the highest
    semver tag with that prefix, not the repository-wide release. Use
    `versionSource: release`, or `manifest` with a release manifest.
  - Alerts, controls, governance and errors are evaluated **once per repository**. Code
    scanning and Dependabot alerts go to the component whose `path` contains the alert's
    file or manifest; everything else goes to the coordinator.
  - Workflows are repository-wide: track them with `appliesTo: [coordinator]`.
- **Single repository**: `components: []`, workflows with `appliesTo: [coordinator]`.

The validation rules are:

- `owner/name` format
- unique project (across files), component, environment and workflow ids
- unique `submodulePath` and unique component location (`repository` + `path`)
- `path` required for components in the coordinator repository, never together with
  `submodulePath`
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

### Test coverage applicability (`testCoverage`)

Test coverage (the Quality dimension) applies by default to the component types
`service`, `webapp`, `worker` and `library`, and to the coordinator (treated like a
`service`). It does not apply to `deployment`, `infrastructure` and `other`. Override it
per component, or on the `coordinator` block, in `config/projects/<id>.yaml`:

```yaml
coordinator:
  repository: example-org/project-beta
  testCoverage: not-applicable # required | not-applicable
components:
  - id: api
    repository: example-org/project-beta-api
    type: service
    testCoverage: required
```

The override always wins over the type default. Not applicable components are shown with
"–" and never count as 0%.

### Quality is optional by default

`overall.optionalDimensions` defaults to `[quality]`: a measured Quality counts for the
overall status and the score, a grey Quality is ignored, so projects stay stable until CI
publishes summaries. Quality is not critical: a red Quality counts as amber overall. To
make Quality required (a grey Quality is then treated like any other grey required dimension), set
`optionalDimensions: []` and add `quality` to `requiredDimensions`. A dimension listed in
both lists is rejected at validation.

### Adding a project (no code change)

Preferred: open `/catalog/`, add a discovered proposal (or create a project), then
**Propose on GitHub**. By hand:

1. Create `config/projects/<id>.yaml`.
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
`versionSource`. A component is either a submodule of the coordinator (_Submodule path_) or
a directory of the coordinator repository (_Path_, monorepo; required when the component's
repository is the coordinator's). A project may have no components at all (single
repository). The form shows the **project type** derived from the components:
_Multi-repository_, _Monorepo_ or _Single repository_.

Two panels start from the last collector run:

- **Discovered repositories** lists the discovery proposals (`discovery` in `catalog.json`)
  grouped by kind (_Coordinator_, _Monorepo_, _Grouped by hints_, _Single repository_) with the repository link,
  the evidence and the number of components (a proposal whose repository hints at an existing project, without being part of it, carries a _Suggested for project X_ badge), plus the scanned count and the repositories
  that could not be scanned (classification only). A proposal not in the catalog has
  _Add as project_: it imports the proposed configuration into the editor (the id gets a
  `-2`, `-3`… suffix if taken) and selects it. A proposal already in the catalog (same
  coordinator repository) has _Compare / merge_: it opens that project and lists the
  components and tracked workflows of the proposal that the project lacks, each with an
  _Add_ button. Proposals are only proposals: nothing is saved automatically. When
  discovery is off, the panel explains how to enable it in `config/catalog.yaml`
  (`discovery.enabled`, `owners`).
- **Suggestions** lists the coordinator submodules that no component links to; _Add as
  component_ creates a component linked by its configured `submodulePath`, with the
  repository prefilled when known.

The page stays static and read-only: it is built from `public/data/catalog.json` (written
by the collector, it never reads `config/` directly) and validates live in the browser with
the same Zod schema as `npm run validate:config`. It generates **one file per project**,
`config/projects/<id>.yaml` (a single project document, empty and default values omitted),
and lists the **Pending changes** against the published catalog. Each change is proposed
through the GitHub web editor, so it becomes a pull request; the editor never calls the
GitHub API and holds no token, and your own GitHub permissions apply:

| Change   | Action                       | What happens                                                                                                                                                                |
| -------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New      | Propose on GitHub (new file) | Opens `github.com/<owner>/<repo>/new/main?filename=config/projects/<id>.yaml&value=…` prefilled. Over ~7000 characters the YAML is copied instead and the page opens empty. |
| Modified | Edit on GitHub               | Copies the YAML to the clipboard and opens `…/edit/main/config/projects/<id>.yaml`: replace the content and paste.                                                          |
| Removed  | Delete on GitHub             | Opens `…/delete/main/config/projects/<id>.yaml`.                                                                                                                            |

Then choose _Create a new branch and start a pull request_; CI validates the file and the
next collector run after the merge uses it. A renamed project is a new file plus a removed
one. Each pending change can also be copied or downloaded as `<id>.yaml`. The repository
comes from `package.json` `repository.url`; without it the GitHub actions are hidden. As a
fallback, _Download all (legacy projects.yaml)_ downloads every project in one legacy
`config/projects.yaml`, still accepted by the loader: use it **instead of** the files in
`config/projects/`, never together with them (the same id twice is an error).

The portal is read-only: changes are proposed as pull requests and applied by CI after
merge, and the saved configuration is always restored on the next run. Comments in the
hand-written files are not preserved, so review the diff before committing.

## `config/policies.yaml`: health policies

These are MVP policies, not universal risk ratings. Changing them needs no code or
frontend change.

| Key                                     | Default                                                                      | Meaning                                                                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `freshness.snapshotStaleHours`          | 24                                                                           | The site flags the snapshot as stale (computed in the browser).                                                        |
| `freshness.workflowRunStaleDays`        | 14                                                                           | Last completed run older than this is stale.                                                                           |
| `freshness.securityScanStaleDays`       | 7                                                                            | Last code scanning analysis older than this is stale.                                                                  |
| `freshness.securityStatusFileStaleDays` | 7                                                                            | Pipeline status results older than this are stale.                                                                     |
| `freshness.qualityReportStaleDays`      | 14                                                                           | A test coverage report (`generatedAt`) older than this is stale: still counted, but capped at amber.                   |
| `delivery.queuedThresholdMinutes`       | 60                                                                           | Queued or running longer than this means Attention.                                                                    |
| `delivery.missingCriticalWorkflow`      | amber                                                                        | Status for a critical workflow that is missing or has never run.                                                       |
| `delivery.failedCriticalWorkflow`       | red                                                                          | Status for a failed or cancelled critical workflow.                                                                    |
| `security.redOnSeverities`              | [critical]                                                                   | Open findings at these severities make Security risk red.                                                              |
| `security.amberOnSeverities`            | [high, medium, low]                                                          | Open findings at these severities make Security risk amber.                                                            |
| `security.openSecretAlertIsRed`         | true                                                                         | An open secret scanning alert is red.                                                                                  |
| `security.requiredControlFailedIsRed`   | true                                                                         | A failed required control is red.                                                                                      |
| `security.staleScanIsAmber`             | true                                                                         | A stale required scan is amber.                                                                                        |
| `security.incompleteCoverageIsAmber`    | true                                                                         | Coverage that is not green makes Security risk amber.                                                                  |
| `coverage.greenThresholdPercent`        | 100                                                                          | Coverage is green at or above this percentage.                                                                         |
| `quality.greenThresholdPercent`         | 80                                                                           | Line coverage is green at or above this percentage.                                                                    |
| `quality.amberThresholdPercent`         | 60                                                                           | Amber at or above this percentage, red below.                                                                          |
| `quality.missingReportIsAmber`          | true                                                                         | An applicable component without a visible report caps Quality at amber (a red stays red).                              |
| `version.componentDrift`                | amber                                                                        | Declared version differs from the latest release.                                                                      |
| `version.environmentBehind`             | amber                                                                        | Environment behind, or mismatched with, the coordinator version.                                                       |
| `version.unresolvableSubmodule`         | red                                                                          | A configured submodule cannot be resolved.                                                                             |
| `version.unknownManifestComponent`      | red                                                                          | The manifest references an unknown component.                                                                          |
| `version.unmappedSubmodule`             | amber                                                                        | A submodule not mapped to any component.                                                                               |
| `version.untaggedSubmodule`             | amber                                                                        | The coordinator pins a SHA that is not a release tag of the component.                                                 |
| `version.manifestSubmoduleMismatch`     | amber                                                                        | The manifest declares a version different from the one pinned by the submodule.                                        |
| `governance.*`                          | amber                                                                        | Missing standard workflow, archived repository, missing or invalid status file, default branch mismatch.               |
| `overall.criticalDimensions`            | [delivery, version, security]                                                | A red here makes the project red. A red elsewhere counts as amber.                                                     |
| `overall.requiredDimensions`            | [delivery, version, security, coverage, governance]                          | All must be green for Overall to be green.                                                                             |
| `overall.optionalDimensions`            | [quality]                                                                    | Counted like a required non-critical dimension when measured, ignored when grey. A dimension cannot be in both lists.  |
| `overall.greyRequiredDimension`         | grey                                                                         | Effect of an Unknown required dimension (grey or amber).                                                               |
| `score.weights`                         | delivery 25, version 15, security 30, coverage 15, governance 15, quality 10 | Weight of each dimension in the project score. See [Project score](#project-score).                                    |
| `score.points`                          | green 100, amber 60, red 20                                                  | Points of a measured dimension by status. Grey is not measured, never 0.                                               |
| `score.caps`                            | red 49, amber 89, grey 89                                                    | Highest score allowed for each overall status.                                                                         |
| `score.minMeasuredRatio`                | 0.5                                                                          | Below this share of measured required dimensions the score is "insufficient data".                                     |
| `history.enabled`                       | true                                                                         | `false` writes no `history.json` and no `changes.json`; the pages say history is off.                                  |
| `history.maxEntries`                    | 120                                                                          | Collections kept (integer 2 to 1000). 120 is about 30 days at the 6-hour schedule.                                     |
| `history.maxAgeDays`                    | 90                                                                           | Older collections are dropped (integer 1 to 400).                                                                      |
| `publication.audience`                  | public                                                                       | `public` withholds finding titles and rule ids of non-public repositories. `restricted` needs access-controlled Pages. |
| `publication.allowedLinkHosts`          | [github.com]                                                                 | Only links to these hosts are published.                                                                               |

### Repository controls (`repositoryControls`)

Six read-only checks per repository, from its workflow files and its branch rules, feed
**Governance** through reasons. The block is optional and **every check is `info` by default**:
it is shown on the project page ("Repository controls") but never changes a status until you
enforce it ([ADR 0007](architecture/adr/0007-repository-controls-informative-by-default.md)).

```yaml
repositoryControls:
  enabled: true # false: none of the calls is made, the section says "off"
  checks: # info | amber | red
    actions-pinned: info # every `uses:` is a full commit SHA
    reusable-workflows-current: info # reusable workflows are at the latest release or tag
    branch-protected: info # at least one active rule on the default branch
    pull-request-required: info
    force-push-blocked: info
    status-checks-required: info
  unknownEnforcedCheck: info # info | amber: an enforced check that cannot be determined
  exemptActionOwners: [] # e.g. [actions, github]: their unpinned actions count as pinned
  maxWorkflowFiles: 30 # 1 to 100 workflow files read per repository
  readClassicProtection: false # true needs Administration: read on the credentials
```

| Key                                        | Default | Meaning                                                                                                                     |
| ------------------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------- |
| `repositoryControls.enabled`               | true    | Turns the whole feature off (no calls, no section content).                                                                 |
| `repositoryControls.checks.<id>`           | info    | `info` is shown only; `amber` or `red` makes a failing repository move Governance to that status.                           |
| `repositoryControls.unknownEnforcedCheck`  | info    | Level of an **enforced** check that is unknown on some repository. Informative checks never produce an unknown reason.      |
| `repositoryControls.exemptActionOwners`    | []      | Owners whose actions are not required to be pinned (for example first-party `actions`).                                     |
| `repositoryControls.maxWorkflowFiles`      | 30      | Workflow files read per repository (1 to 100). Files beyond it make the counts unknown and the check unknown, never a pass. |
| `repositoryControls.readClassicProtection` | false   | Also reads classic branch protection. Needs **Administration: read**; the call is never made while this is `false`.         |

How the checks read the data:

- **Not visible is not failing.** A 403 is "not authorised", an ambiguous 404 is "unknown", and
  a missing `.github/workflows` directory means "no workflows" (not applicable). Unknown is
  never a fail and never a pass.
- **Branch rules** come from `GET /repos/{owner}/{repo}/rules/branches/{branch}` (active
  repository and organisation rulesets). A rule that the rules API does not report while the
  branch says `protected: true` is `unknown`, not a fail, because classic protection is invisible
  without Administration: read.
- **Private repositories**: with `publication.audience: public` the unpinned references and the
  reusable workflow targets of non-public repositories are withheld (the counts stay), and a
  reusable workflow in a non-public repository is shown as not visible.
- Catalog: `notApplicableChecks: [pull-request-required]` on a coordinator or a component marks
  a check as not applicable for that repository (neither counted nor listed as unknown).

**Opting in to enforcement.** Start from the defaults, read the section on a few projects, then
raise one check at a time. Example, after reviewing the current results: enforce pinned actions
and branch protection as attention (amber):

```yaml
repositoryControls:
  checks:
    actions-pinned: amber
    branch-protected: amber
  exemptActionOwners: [actions]
  unknownEnforcedCheck: info
```

With this block a repository that fails `actions-pinned` or `branch-protected` makes Governance
amber (reason `repository-check-failed`, naming the check and the repositories); unknown results
stay informative; and the score only moves when a Governance status moves. Step by step
instructions are in [Operations](operations.md#enforcing-repository-controls).

### Project score

The collector computes a score from 0 to 100 for each project, to rank and compare
projects in today's snapshot. The site only shows it; it never replaces the
dimensions. The optional `score` block in `config/policies.yaml` changes the formula
(policies `schemaVersion` stays `1.0`).

- **Points** per measured dimension: green 100, amber 60, red 20. Grey (not measured) is
  left out, never counted as 0.
- **Weighted mean** over the measured required dimensions (`overall.requiredDimensions`)
  and the measured optional ones (`overall.optionalDimensions`). Default weights: delivery
  25, version 15, security 30, coverage 15, governance 15, quality 10.
- **Caps** keep the number consistent with the status: overall red → at most 49; overall
  amber → at most 89; overall grey (some required dimension unknown, none red or amber) →
  at most 89, so a partly unreadable project never ranks with healthy ones. A red project
  is therefore always below any amber or grey one.
- **Green is 100**: green needs every required dimension green, so healthy projects tie at
  the top.
- **Not applicable is not unknown**: a dimension that is grey only because there is
  nothing to measure (delivery reason `no-critical-workflows`) leaves both `measured` and
  `required`. Grey for any other reason (not authorised, unknown, collection failed)
  counts as not measured.
- **Optional dimensions** (`quality` by default) count when measured. When grey they are
  left out of both `measured` and `required`, so a project without a coverage report does
  not lose points and does not turn grey.
- **Confidence** is `measured / required` ("measured 4 of 5"; "measured 6 of 6" when
  Quality is measured).
- **Insufficient data**: when fewer than `minMeasuredRatio` (default half) of the required
  dimensions are measured, `value` is `null` and the site shows "insufficient data".
- The result is rounded to an integer.

Snapshot schema 1.4 publishes it as `score: { value, measured, required }` on each
project snapshot and on each project of `index.json`. With the mock data: Platform 82,
Project Alpha 78, Project Beta 40, Project Gamma insufficient data.

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

### `hub-quality-summary` artifact (each repository, optional)

CI uploads a GitHub Actions artifact named **`hub-quality-summary`** that contains one file,
**`quality-summary.json`**, on every run on the default branch. The collector reads it with
the same credentials as the rest (**Actions: read**); no new secret is needed. See
[Operations](operations.md#publishing-the-quality-summary-from-ci) for an example step.

```json
{
  "schemaVersion": "1.0",
  "repository": "example-org/project-beta-api",
  "ref": "refs/heads/main",
  "commitSha": "<40-hex sha>",
  "generatedAt": "2026-01-14T10:00:00Z",
  "tool": "coverlet",
  "format": "cobertura",
  "lines": { "covered": 5998, "valid": 8400 }
}
```

- The schema is strict (unknown keys are rejected). `format` is one of `cobertura`,
  `lcov`, `opencover`, `jacoco`, `other`. `tool` is a short identifier (at most 40
  characters) and is scrubbed. `lines.covered` must not exceed `lines.valid`.
- `repository` must match the repository being read (case-insensitive), otherwise the
  report is `invalid`.
- `lines.valid: 0` means "no testable code": the component is not applicable, never 0%.
- JSON Schema: [`config/schema/quality-summary.schema.json`](../config/schema/quality-summary.schema.json)
  (generated by `npm run schema:generate`).

How the collector reads it:

- It lists the repository's artifacts by name (up to 3 pages of 30) and takes the newest
  non-expired artifact whose run is on the default branch **and** comes from the same
  repository (a fork pull request run is never trusted).
- The zip is capped at 64 KB (65 536 bytes). Only the file `quality-summary.json` is read.
- One summary per repository. When several components share a repository (a monorepo, or a
  coordinator that is also a component repository), each row shows the same report
  ("shared repository report") and the project coverage counts that repository once.

| Outcome                                                                 | State                                              |
| ----------------------------------------------------------------------- | -------------------------------------------------- |
| No artifact (404)                                                       | `missing`                                          |
| Only expired artifacts                                                  | `expired` (reason `quality-report-expired`)        |
| 403 on the artifact list                                                | `not-authorised`, never `missing`                  |
| Invalid JSON or schema, other repository, zip too large or without file | `invalid`, plus an `invalid-data` collection error |
| Network error or other failure                                          | `unknown`                                          |
| Valid, `generatedAt` older than `freshness.qualityReportStaleDays`      | `stale` (still counted, always shown with its age) |
| Valid and fresh                                                         | `readable`                                         |

Project coverage is the sum of `covered` over the sum of `valid` across the applicable
repositories whose report is readable or stale (weighted by lines). Components without a
visible report never count, and never count as 0%. Status: grey when nothing applies or
nothing is visible; otherwise green at or above `quality.greenThresholdPercent`, amber at or
above `quality.amberThresholdPercent`, red below. Any stale report, or any applicable
component without a visible report when `quality.missingReportIsAmber` is true, caps a green
at amber (a red stays red). When Quality is grey, its not-visible reasons are informative, so
they add no row to the project's "why" box.

**GitHub Code Quality findings** are informative: open findings are counted per repository
(by category `reliability` / `maintainability` and by severity `error` / `warning` / `note` /
`none`) from `GET /repos/{owner}/{repo}/code-quality/findings?state=open`. They never change
the Quality status. Counts are published only when every repository was readable or answered
that Code Quality is not enabled; otherwise the state is `not-authorised` or `unknown`, and
never 0. The collector reads at most 3 pages of 100 findings (300) per repository. When more
pages remain, that repository's findings are unknown (a collection error), never a partial
count. GitHub exposes no endpoint for the coverage percentage, which is why coverage comes
from the CI summary.

## History and CSV export

From v0.7.0 the collector keeps a compact history of every collection and publishes two
more files next to the snapshot, plus three CSV files. The snapshot schema is unchanged
(1.4), so no re-collect is needed after upgrading: history starts with the first v0.7.0
collection. How it persists in Actions is described in
[Operations](operations.md#history-between-runs).

From v0.8.0 the history schema is `1.1`: each point also carries the repository check counts
(`controls`), and the baseline the pass/fail state of each check, so "What changed" can list
checks that moved between pass and fail (and the portfolio CSV gains `controls_passed`,
`controls_failed` and `controls_unknown`). A `1.0` history is still read; it simply has nothing
to compare for the checks.

| File                           | Content                                                                                                                                                   |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `history.json`                 | `kind: hub-history`, schema `1.1` (`1.0` is still read): one compact point per project and collection, plus the baseline needed to compute the next diff. |
| `changes.json`                 | `kind: hub-changes`, schema `1.0`: what moved since the previous collection, or why that cannot be said.                                                  |
| `exports/portfolio.csv`        | One row per project, with the previous collection's status and score.                                                                                     |
| `exports/findings-summary.csv` | One row per project and repository: open alerts by severity, no titles.                                                                                   |
| `exports/versions.csv`         | One row per coordinator, component and environment.                                                                                                       |

Both JSON files are versioned separately from the snapshot, so history survives a snapshot
schema bump. A missing or invalid file never fails the site build: the pages say why.
`npm run validate:snapshots` does fail on an invalid one.

### Collector flags

| Flag                       | Meaning                                                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `--history-from <dir>`     | Directory with the previous `history.json`. Default: `$HISTORY_FROM`, then the `--out` directory (an empty value counts as unset). |
| `--history-fixture <file>` | Mock source only: the synthetic history to start from (default `fixtures/history/history.json`).                                   |
| `--fresh-history`          | Ignore any previous history and start again from this collection (state `none`).                                                   |

A mock run never restores real history: it always starts from the synthetic fixture, so
mock and real history never meet. A previous history written by the other data source is
set aside (`source-changed`).

### CSV files

Format: RFC 4180, comma separator, CRLF after every row, UTF-8 with a BOM (so Excel reads
accents), English snake_case headers, booleans `true` / `false`, ISO dates. `unknown` means
the value could not be read and is never 0; `n/a` means the column does not apply to the
row. A text cell that starts with `=`, `+`, `-`, `@`, TAB or CR gets a leading `'`, so a
spreadsheet never runs it as a formula. Numbers are never prefixed. Excel with a `;` list
separator: use Data, From Text/CSV.

- `portfolio.csv`: `project_id, project_name, business_unit, lifecycle, overall, score, score_measured, score_required, delivery, version, security, controls_coverage, controls_coverage_percent, governance, quality, quality_percent, open_critical, open_high, open_medium, open_low, counts_complete, open_secret_alerts, failed_critical_workflows, collection_errors, collected_at, previous_overall, previous_score, previous_collected_at`. The `previous_*` columns are `n/a` when there is no previous collection.
- `findings-summary.csv`: `project_id, component_id, repository, open_critical, open_high, open_medium, open_low, open_informational, open_unknown, sources_complete`. All counts are `unknown` when no alert source was readable; when only some were, the counts are a lower bound and `sources_complete` is `false`.
- `versions.csv`: `row_type (coordinator|component|environment), project_id, item_id, item_name, repository, version, version_source, declared_version, latest_release, drift, manifest_consistency, pin_status, environment_status`.

If the snapshot data is missing or invalid, each CSV has its header and one row that starts with `data unavailable` and has `unknown` elsewhere. It is never a header-only file, which would read as "no projects".

## Environment variables

| Variable                                                    | Where                     | Purpose                                                                                                                                                                           |
| ----------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATA_SOURCE`                                               | repository variable / env | `mock` (default) or `github`                                                                                                                                                      |
| `GH_APP_ID`, `GH_APP_PRIVATE_KEY`, `GH_APP_INSTALLATION_ID` | Actions secrets           | GitHub App authentication (preferred)                                                                                                                                             |
| `GH_READ_TOKEN`                                             | Actions secret            | Fallback fine-grained PAT                                                                                                                                                         |
| `GITHUB_TOKEN`                                              | automatic                 | Last fallback (current repository only)                                                                                                                                           |
| `GITHUB_API_URL`                                            | automatic / env           | API base URL (GitHub Enterprise Server)                                                                                                                                           |
| `SITE_URL`, `BASE_PATH`                                     | set by deploy workflow    | Astro `site` and `base` (from configure-pages)                                                                                                                                    |
| `SNAPSHOT_DIR`                                              | local / tests             | Alternative snapshot directory for the site build                                                                                                                                 |
| `POLICIES_FILE`                                             | site build                | Policies explained on the "How to read" page (default `config/policies.yaml`; schema defaults only if the default file is missing; an unreadable or invalid file fails the build) |
| `HISTORY_FROM`                                              | collect job / local       | Directory holding the previous `history.json` (set by the workflow to `.history-restore`)                                                                                         |
| `HISTORY_RESTORE_STATE`                                     | collect job               | `none` or `failed`, from the restore step; anything else reads the file                                                                                                           |
