# ADR 0004: Configuration store, discovery and the path to a backend

- **Status:** Accepted
- **Date:** 2026-10-03
- **Italian version:** [docs/it/architecture/adr/0004-configuration-store-and-discovery.md](../../it/architecture/adr/0004-configuration-store-and-discovery.md)

## Context

Writing the catalog by hand does not scale. Users want to:

- discover repositories automatically, and see coordinators, monorepos and single
  repositories as candidate projects;
- configure projects from the UI instead of editing YAML;
- have the saved configuration restored on every run;
- handle monorepos (components are directories of one repository) as well as multi-repo
  projects.

The portal is a static site on GitHub Pages with no backend, no database and no credentials
in the browser ([ADR 0001](0001-static-first-github-native.md)). A real application with a
database and a backend may come later, if this approach proves useful.

## Decision

1. **Git is the configuration database.** The catalog is versioned in the repository:
   - `config/catalog.yaml` holds the discovery settings;
   - `config/projects/<id>.yaml` holds one `ProjectConfig` per project;
   - the legacy `config/projects.yaml` is still read.

   Every run restores the configuration from these files. History, review, rollback and
   audit come from Git.

2. **Discovery is proposal-only and read-only.** The collector scans the configured owners
   (public repositories only while the site is public) and classifies each repository:
   - **coordinator**: it has a `.gitmodules` whose submodules point to scanned repositories;
   - **monorepo**: it has a workspace manifest (npm/yarn/pnpm workspaces, lerna, `go.work`,
     Cargo, turbo/nx), and its components are directories;
   - **single**: everything else; repositories claimed as submodules are not proposed on
     their own.

   Proposals are published in `catalog.json` and shown in the catalog editor. Nothing enters
   the portal until a project file is saved.

3. **Saving is a pull request created by the user on GitHub.** The editor generates the
   project file and opens GitHub. For a new project it opens the _new file_ page
   pre-filled; for an existing one it copies the YAML and opens the _edit_ page; for a
   removal it opens the _delete_ page. The user's own GitHub permissions apply. CI and the
   branch ruleset validate the change, and the next run uses it.

   No bot and no token in the browser. This also avoids PRs created with `GITHUB_TOKEN`,
   which do not trigger CI.

4. **Monorepo model.** A component is a repository plus an optional `path`.
   - Versions come from prefixed tags (`api-v1.2.0`) through `releaseTagPrefix`.
   - Repository-level data (alerts, controls, governance, errors) is evaluated **once per
     repository**.
   - Alerts are attributed to components by file path: the code scanning location, or the
     Dependabot manifest.
   - Single-repository projects have no components.

## Seams for a future backend

The decision is built so that moving to an application with a database is a replacement,
not a rewrite:

| Concern          | Today (GitHub-native)                                | Tomorrow (backend + DB)                                  |
| ---------------- | ---------------------------------------------------- | -------------------------------------------------------- |
| Config document  | `ProjectConfig` (Zod) in `config/projects/<id>.yaml` | Same schema stored as a row/document                     |
| Load at run time | `loadCatalog(configDir)`                             | `loadCatalog()` backed by the DB (same return type)      |
| Save from the UI | "propose change" = GitHub new/edit/delete page → PR  | "propose change" = `PUT /api/projects/:id` (with review) |
| Discovery        | `discover(ctx, catalog, policies)` in the collector  | Same module, run on a schedule or on demand              |
| Auth             | GitHub permissions on the repository                 | GitHub OAuth / SSO, per-project authorisation            |

**Triggers to switch.** Move to the backend when one of these becomes a requirement:

- per-user or per-project authorisation;
- including private repositories in an access-controlled view;
- instant saves without a pull request;
- several organisations with different audiences;
- history and trends beyond what snapshots provide.

## Consequences

- Positive:
  - no infrastructure, secrets or bots;
  - every change is reviewed, validated by CI and versioned;
  - the configuration survives restarts by construction;
  - monorepos and multi-repo projects share one model.
- Negative:
  - saving takes a pull request round-trip (about a minute);
  - editing an existing project still needs a paste in the GitHub editor, because GitHub
    can pre-fill only new files;
  - discovery on a public site cannot see private repositories.
