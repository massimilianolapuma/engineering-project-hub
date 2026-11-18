# Component versions per environment from an umbrella Helm chart — design

Italiano: [../../it/superpowers/specs/2026-11-18-umbrella-chart-versions-design.md](../../it/superpowers/specs/2026-11-18-umbrella-chart-versions-design.md)

Status: draft for the owner's review · Date: 2026-11-18 · Target release: **v0.19.0** · Snapshot schema **1.11**

## 1. Intent and why

The owner wants the Versions page to answer, **per project**: _which component versions have been
released, and where have they got to?_ Today the hub shows one "current" version per component
(the submodule pin, else the release manifest) and one version per environment (since v0.18.0, from
deploy signals). It cannot say which version of each component runs in each environment.

Many projects deploy through an **umbrella Helm chart** in the coordinator: its `Chart.yaml`
`dependencies` list one sub-chart per component with an exact version, the chart `version` equals the
product release (`v0.11.8` → `version: 0.11.8`), and each environment runs one umbrella version. So the
umbrella chart **at the tag of an environment's version** says exactly which component versions that
environment runs. The real project that motivated this (19 repositories) has this shape:

- chart at `infrastructure/helm/<name>/Chart.yaml`, dependencies named after the component repositories
  (`<org>/<product>-billing-fe` → dependency `<product>-billing-fe`);
- environment versions declared by a promote workflow in `environments/<env>.yaml` (`versions-file`
  signal), e.g. TEST 0.11.8, PROD 0.11.3;
- one component listed twice under an `alias` (same chart, kept in lockstep);
- components outside the umbrella (databases deployed by a separate manual pipeline, shared libraries,
  infrastructure);
- a LAB environment that runs `main` with development image tags, not a release.

The owner chose to read the umbrella chart in the hub (approach A below): no change to the project's
own repositories or pipelines.

## 2. Goals, non-goals, anti-goals

Goals:

1. For a project whose coordinator declares an umbrella chart, show a **components × environments**
   matrix on the Versions page: latest release of each component, its version in the umbrella on the
   default branch, and its version in each environment.
2. Mark where a version is **stuck**: released but not yet in the umbrella; in an earlier environment
   but not yet in the next one.
3. Use the umbrella as the component's current version source (what the latest product release
   contains), so the existing "current vs latest release" drift check compares the right things.
4. Generic for any umbrella Helm chart; zero configuration for components whose dependency is named
   after their repository.

Non-goals (this iteration):

- Evaluating per-environment values (`condition: <dep>.enabled`): a component disabled in an environment
  still shows the chart's version there. Documented as a limit.
- Component versions in branch environments (LAB on `main` with development tags): the column shows
  `main @ <sha>`, not per-component versions.
- A portfolio-wide view across projects.
- New Version health rules or new ambers. The matrix is information; the only health effect is the one
  that follows from goal 3 (drift now compares the umbrella version with the latest release).
- Image verification (Harbor, Argo CD images): unchanged.

Anti-goals (a failure even if it works):

- Showing a **declared** environment version as if it were **deployed**: each environment column keeps
  its source label (versions file = declared, GitHub deployment / Argo CD = deployed).
- Inventing a version: an unreadable chart, a missing tag or an unmapped dependency is shown as unknown,
  never as "not deployed" and never guessed from another column.
- Noise for projects without an umbrella chart: nothing changes unless `umbrellaChart` is configured.

## 3. Constraints

- Read-only GETs, GitHub contents API only (`getFile(repo, path, ref)` already exists). The OCI chart
  repository (Harbor) is never contacted.
- Bounded cost: one read on the default branch plus one per **distinct** environment version, at most
  **10** tag reads per project (newest versions first; the rest unknown with a note).
- File size ≤ the existing 64 KiB YAML limit; parsed with the existing safe YAML settings.
- Public repository: fixtures synthetic (`example-org`), no real names in code, docs or goldens.
- EN + IT for every UI string and doc.

## 4. Approaches

| Approach                                     | What it is                                                                                                                                                                 | Trade-off                                                                                                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Hub reads the umbrella chart (chosen)** | The catalog says where the chart is; the collector reads `Chart.yaml` on the default branch and at the tag of each environment's version, maps dependencies to components. | No change to project repositories, generic for Helm umbrellas, reuses v0.18.0 environment versions. Helm-only: other packaging needs another adapter later. |
| B. Chart at the release tag as a manifest    | Use the chart's versions as the "declared" component versions (one column).                                                                                                | Cheap, but does not say **where** versions are, so it does not answer the owner's question.                                                                 |
| C. Coordinator publishes a summary           | A workflow writes a JSON of component versions per environment as a CI artifact.                                                                                           | Hub stays Helm-agnostic, but needs pipeline changes owned by the project team and waits for them.                                                           |

The owner picked A ("A va bene, poi vediamo"): B does not answer the question, C moves work onto the
team and adds a dependency.

## 5. Design

### 5.1 Catalog

Coordinator, optional:

```yaml
coordinator:
  repository: example-org/alpha-coordinator
  umbrellaChart:
    path: deploy/helm/alpha/Chart.yaml # relative path, required
    tagPrefix: v # optional, default "v": environment version 1.4.0 → tag v1.4.0
```

Component, optional: `chartDependency: <dependency name or alias>` to override the mapping.

Mapping of a component to a dependency, first match wins:

1. `chartDependency` (matches a dependency `alias`, else its `name`);
2. a dependency whose `name` equals the component repository name without the owner
   (`example-org/alpha-backend` → `alpha-backend`), entries **without** an alias first;
3. a dependency whose `name` equals the component id.

Several entries with the same name (aliases) and the same version count once; different versions →
the component's cell is a **conflict** (unknown version, note naming the aliases), never the version of
one entry picked over the other. When `chartDependency` names one alias, only that entry maps to the
component, and the other entries of the same chart are listed as aliases, not as unmapped.
_(Builder-check call.)_ Dependencies that
match no component are listed as **unmapped** (like unmapped submodules today). Components that match
no dependency are **outside the umbrella**.

`versionSource` gains `umbrella`. `auto` becomes: umbrella (only when `umbrellaChart` is configured and
the component is in it) → submodule pin → manifest. Projects without `umbrellaChart` keep today's order.
When the release-tag read fails or does not contain the component, `auto` falls through to the pin, then
the manifest (as `pick()` does today); `versionSource: umbrella` stays unknown. _(Builder-check call.)_

### 5.2 Collection

After environments are resolved (v0.18.0 `collectEnvironmentStates` + manifest/Argo CD):

1. Read the chart on the coordinator's default branch.
2. Read the chart at the coordinator's **latest release tag** (else its latest reachable tag), never at
   the manifest's declared version, which may not be tagged yet — the source of the umbrella
   `versionSource`. _(Builder-check call.)_
3. For each environment with a semver version (declared or deployed, as published on the environment),
   read the chart at `tagPrefix + version`. Distinct versions only, newest first, max 10.
4. Environments without a semver version (unknown, or a branch deployment like LAB) get no read.

Parsing: `version` (chart), `dependencies[].{name, alias?, version}`; non-semver dependency versions
(ranges like `~1.2`) are kept as text and not compared. A chart without `dependencies` is valid (empty).

Errors: a missing file or tag (404) → state `not-found`; YAML/shape errors → `invalid`; 403 →
`not-authorised`. Recorded once per repository and classification as a new collection-error source
`umbrella-chart`.

### 5.3 Snapshot 1.11

- `coordinator.umbrellaChart`: `null` when not configured, else
  `{ path, state: 'ok'|'not-found'|'invalid'|'not-authorised'|'unknown', chartVersion, unmapped: string[] }`
  for the **default branch** read.
- `component.umbrella`: `null` when not configured, else
  `{ inUmbrella: boolean, main: string|null, release: string|null, conflict: boolean }` — version on the
  default branch and at the latest release tag.
- `component.effectiveVersionSource` adds `umbrella`.
- `environment.componentVersions`: `null` when not configured or no read was made (no semver version),
  else `{ ref: 'v1.4.0', state: <as above> | 'skipped', versions: [{ componentId, version|null,
conflict: boolean }] }` (only components in the umbrella at that ref). `skipped` = beyond the 10-read
  bound. _(Builder-check call: the shape may carry what the UI needs to explain an unknown cell.)_

### 5.4 Versions page

In each project card, when `umbrellaChart` is configured, a table **Components by environment**
(EN) / **Componenti per ambiente** (IT). Where it goes (owner's decision):

- **Check** cards: the table is open and **replaces** the environment path (LAB → … → PROD); each
  environment header carries its version and status pill (Behind, Aligned, Not a release), so nothing
  from the path is lost. The "To check" list follows.
- **Aligned** and **unknown** (grey) cards: the one-line / dashed design stays; the table sits in a
  closed disclosure "Components by environment ▸".
- Projects without `umbrellaChart`: unchanged.

The table:

```
Component      Latest release  Umbrella (main)  LAB             DEV      TEST     PROD
                                                main @ 1a2b3c4  declared declared declared
frontend       v2.2.0 ▲        2.1.0            —               2.1.0    2.1.0    2.0.3 ▲
backend        v1.4.0          1.4.0            —               1.4.0    1.4.0    1.4.0
Outside the umbrella (2) ▸   database v0.9.0 · …
```

- Column header under each environment: its version source (declared / deployed) or `main @ sha`.
- ▲ marks "newer version waiting on the left": latest release above the umbrella on main; an environment
  below the previous environment. Text plus icon (never colour alone); a legend line explains it.
- Unknown cells use the existing dashed "unknown" label with the reason in the title (not found,
  conflict, too many versions).
- Unmapped dependencies listed under the table.
- Mobile: the table scrolls inside its own container; the page itself never scrolls horizontally.
- CSV export `versions.csv`: one row per component × environment with the version and the chart ref.

The project page is unchanged apart from a link to the Versions card.

### 5.5 Demo

Synthetic: Project Alpha's coordinator gets an umbrella chart (backend, frontend, worker), tags for its
environment versions, one component released but not yet in the umbrella, PROD one version behind, and
one unmapped dependency. Goldens regenerated.

## 6. Decided by the owner

- Approach A; per project, not portfolio-wide.
- The table appears on every umbrella project: open on check cards (replacing the environment path),
  closed in a disclosure on aligned and unknown cards.
- The umbrella is the component version that counts ("umbrella credo, in caso da verificare"): verified
  on the real chart on 2026-11-18 (dependency names = repository names, semver versions, chart version =
  product release).
- LAB shows `main @ sha`.

## 7. Left to the builder

- Exact file layout (a `collector/src/collectors/umbrella-chart.ts` reader and a normalizer are the
  expected shape), the parsing helper, the UI component split.
- Ordering and tie-breaks inside the 10-read bound.
- The precise wording of notes and legends (EN/IT) within the meaning above.
