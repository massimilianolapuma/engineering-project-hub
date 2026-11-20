# Component versions per environment from each component's own deployments — design

Italiano: [../../it/superpowers/specs/2026-11-20-component-deployments-design.md](../../it/superpowers/specs/2026-11-20-component-deployments-design.md)

Status: draft for the owner's review · Date: 2026-11-20 · Target release: **v0.20.0** · Snapshot schema **1.12**

## 1. Intent and why

Since v0.19.0 the Versions page shows, for each component of the umbrella chart, the version each
environment runs. Components deployed **on their own** (a database published by its own pipeline, a
service with its own deploy) are only listed as "Outside the umbrella" with their latest release: the
hub cannot say which version of them runs where.

The owner wants those components tracked per environment too. The deployments ledger (v0.17.0, GitHub
Deployments written by the external pipeline) is the source. Two things are missing:

1. The push script only accepts a commit SHA. A pipeline that deploys **a released version chosen by
   hand** (parameter `version: 0.9.0`, no checkout) does not have the SHA of that release: the commit
   of the run is the head of the default branch, the wrong one.
2. The hub reads GitHub Deployments only for the environments of a project, from one repository. It
   never reads the deployments of a component's repository.

## 2. Goals, non-goals, anti-goals

Goals:

1. `scripts/report-deployment.sh` records a deploy **by tag** (`REF=v0.9.0`) as well as by SHA.
2. A component marked `deployments: true` in the catalog gets a row in the components × environments
   table, with the version its own repository's GitHub Deployments say each environment runs.
3. Works with or without an umbrella chart.

Non-goals (this iteration):

- Changes to any real pipeline, the writer App, or the customer's network. Those are done later, in
  the project's own repositories.
- Reading the own deployments of a component that **is** in the umbrella chart: the chart stays its
  source.
- A different environment name per component.
- New Version health rules: the table is information only.
- The Azure DevOps pull bridge: unchanged.

Anti-goals (a failure even if it works):

- Showing "not deployed" when the hub could not read. Unreadable is **unknown**.
- Mixing up declared and deployed: a cell read from deployments is always marked as deployed, even
  under a column whose header says "declared".
- Any change for a project that does not set `deployments: true`.

## 3. Constraints

- Read-only GETs, existing provider calls only (`listDeployments`, `listDeploymentStatuses`). The hub
  App already has Deployments: read.
- Bounded cost: at most **20** components with `deployments: true` per project (validation error
  above that). Per component and environment: one list call and at most 10 status reads, as today.
- The writer App keeps its only permission, Deployments: read and write.
- Public repository: synthetic fixtures (`example-org`), no real names.
- EN + IT for every UI string and doc.

## 4. Approaches

| Approach                                       | How                                                                                          | Verdict                                                                                                                      |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **A. Tag in the push script + component flag** | The pipeline reports `REF=v<version>`; GitHub resolves the tag. The hub reads per component. | **Chosen** (owner, 2026-11-20). Smallest change, no new permission.                                                          |
| B. Pull bridge                                 | The scheduled bridge reads Azure DevOps and writes the deployments.                          | Dropped: the bridge reads environment records, which do not carry a version typed as a run parameter (not verified further). |
| C. Resolve the tag on the agent                | The pipeline checks out the mirror and finds the tag's SHA itself.                           | Dropped: needs a checkout and tags in the mirror, in every pipeline.                                                         |

## 5. Design

### 5.1 Push script: `REF`

`scripts/report-deployment.sh` takes **exactly one** of:

- `SHA` — a full commit SHA (today's behaviour, unchanged);
- `REF` — a tag or branch name that exists on GitHub, for example `v0.9.0`.

Both set, or neither: the script stops with an error before any call.
`REF` must match `^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$` and must not contain `..`.

With `REF`:

- the deployment is created with `ref: <REF>`; GitHub resolves it to a commit;
- the "already recorded?" lookup filters by `ref=<REF>` instead of `sha=<SHA>` (same environment,
  source, run id and attempt as today);
- a name GitHub does not know returns HTTP 422: the script prints GitHub's message and exits 0, as
  it does today for an unknown commit.

Example, last step of a deploy-by-version job:

```yaml
env:
  REF: v$(deployedVersion) # instead of SHA
  VERSION: $(deployedVersion)
  ENV_NAME: test
  # GH_APP_ID, GH_INSTALLATION_ID, GH_KEY_FILE, GH_OWNER, GH_REPO_NAME, STATE, RUN_ID, RUN_URL,
  # ATTEMPT, FINISHED_AT: as today
```

The hub side needs nothing new to read such a record: it already takes the version from the payload,
else from a version-like tag.

### 5.2 Catalog: `deployments: true` on a component

```yaml
components:
  - id: database
    name: Database
    repository: example-org/alpha-database
    type: other
    deployments: true # new, optional, default false
```

Meaning: "this component is deployed on its own; read its repository's GitHub Deployments".

- For each environment of the project, the hub reads the deployments of the **component's**
  repository whose environment name is the environment's `githubEnvironment`, else its `id`. The
  `environment` and `sources` options of the project's own `deploySignal` are **not** used: they
  belong to the repository that signal reads. _(Builder-check call.)_
- The version of a deployment: the ledger payload `version`, else the tag it was made from
  (`releaseTagPrefix` of the component, default `v`). A deployment from a branch has no version.
- What counts as current: the newest deployment with a `success` status, by real deploy time (same
  function as the project environments today).
- The flag is ignored (nothing is read) only when the umbrella chart on the default branch was read
  and contains the component. When that chart cannot be read, the component is read and shown in the
  "Deployed on their own" group only, never in both groups. _(Builder-check call.)_
- Validation errors: more than 20 flagged components in one project; a flagged component that shares
  its repository with another component or with the coordinator (GitHub Deployments belong to a
  repository, so the hub could not tell whose deploy it is). _(Builder-check call.)_

### 5.3 Snapshot 1.12

Each component gains `environmentVersions`: `null` when the flag is off or ignored; otherwise one
entry per project environment, in order, with:

| Field           | Meaning                                                                                                                                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `environmentId` | the project environment                                                                                                                                                                                                       |
| `state`         | `ok` (a successful deployment found); `none` (the environment has no deployment at all); `no-success` (deployments exist, none of the 10 newest succeeded); or why the read failed (`not-found`, `not-authorised`, `unknown`) |
| `version`       | semver, or null                                                                                                                                                                                                               |
| `ref`, `sha`    | branch or tag and commit of that deployment, or null                                                                                                                                                                          |
| `deployedAt`    | real deploy time, or null                                                                                                                                                                                                     |
| `declared`      | true when the record was declared by hand (ledger payload `declared: true`)                                                                                                                                                   |

A failed read is also recorded as a `deploy-signal` collection error, as today. `no-success` is not
`none`: the hub does not claim "nothing recorded" when it only looked at the newest 10.
_(Builder-check call.)_

### 5.4 Versions page

Flagged components become rows of the existing table, in a second group under the umbrella rows:

```
Component      Latest release  Umbrella (main)  LAB             DEV         TEST        PROD
                                                main @ 1a2b3c4  declared    declared    declared
frontend       v2.2.0 ▲        2.1.0            —               2.1.0       2.1.0       2.0.3 ▲
backend        v1.4.0          1.4.0            —               1.4.0       1.4.0       1.4.0
Deployed on their own
database       v0.9.0          —                main @ 9f8e7d6  0.9.0 ●     0.9.0 ●     0.8.0 ● ▲
Outside the umbrella (1) ▸   shared-lib v3.1.0
```

- `●` = "deployed": read from GitHub Deployments. Icon plus text (title and legend line), never colour
  alone. The date of the deploy is in the cell's title.
- A record declared by hand gets a different mark and the text "declared by hand", never `●`.
  _(Builder-check call.)_
- Cell states: a version (`0.9.0 ●`); a branch deployment (`main @ 9f8e7d6`); **no deployment
  recorded** (`—`; the title names the environment that was read, for example "no deployment
  recorded for environment test"); **unknown** (the existing dashed label with the reason: the read
  failed, or no successful deployment among the newest 10).
- `▲` on a cell: lower than the nearest version on its left. The first comparison is with the latest
  release (so `v0.9.0` released and `0.8.0` in the first environment shows ▲ there).
- "Umbrella (main)" is `—` for these rows.
- Components without the flag stay in the collapsed "Outside the umbrella" list, as today.
- **Project without an umbrella chart** and at least one flagged component: the same table, without
  the "Umbrella (main)" column and without the group heading. It appears exactly where the umbrella
  table appears today (collapsed on aligned and unknown cards, open on cards to check, in place of
  the environment path). One rule on the page: "umbrella chart, or at least one flagged component".
  _(Builder-check call.)_
- CSV export: one `component-environment` row per flagged component and environment whose state is
  `ok`, with `version_source` = `deployment` (`declared` for a record declared by hand). No new
  column. _(Builder-check call.)_

### 5.5 Documentation and demo

- `docs/deployments-ledger.md` and `docs/configuration.md` (EN + IT): `REF`, the example above, the
  `deployments` flag.
- The public demo data gets one flagged component with a few deployments, so the page shows the new
  rows.
- CHANGELOG, JSON Schemas, catalog editor (keeps the flag when it saves).

## 6. Decided by the owner

- Scope now: the hub side only, built on mock data; real pipelines after the writer App exists and the
  customer allows the agents to reach `api.github.com` (2026-11-20).
- Approach A (2026-11-20).
- Earlier decisions that still hold: GitHub Deployments are the ledger of every environment; the hub
  verifies versions and never chooses them; a declared version is never shown as deployed.

## 7. Left to the builder

- Exact field names and Zod shapes of `environmentVersions`; reuse of `readEnvironmentState`.
- Label wording ("Deployed on their own", "no deployment recorded") in EN and IT, and the icon.
- How many collection errors a component with several unreadable environments produces (one per read
  or one per component).
- Tests: script (`REF`, both, neither, bad name, 422, idempotent second run), collector, table logic,
  CSV, one e2e on the Versions page; goldens with `npm run fixtures:update` only (never `ci:build` or
  `collect:mock` on the owner's machine without asking).
