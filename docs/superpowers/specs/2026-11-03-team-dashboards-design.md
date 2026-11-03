# Team dashboards — "my projects" through GitHub teams

Italiano: [../../it/superpowers/specs/2026-11-03-team-dashboards-design.md](../../it/superpowers/specs/2026-11-03-team-dashboards-design.md)

Status: draft for the owner's review (builder check done) · Date: 2026-11-03 · Target release: after v0.10.0 (order with the supply chain work decided in the plan, see §9)

## 1. Intent and why

The catalog now records every project. The owner's next question: how does each person get _their own_ dashboard?

The picture the owner gave: a project lead with several projects and many repositories opens the hub and sees **their** projects, then drills into one project and its repositories. Ownership should come from GitHub (teams and permissions), with a manual fallback in the catalog when GitHub cannot tell.

The company will host the hub on **GitHub Pages with private visibility** only, for now. Private Pages gate the whole site on read access to the hub's repository, and the page cannot know who is looking. Real per-person hiding therefore needs a server component, which the owner postpones until the project proves interesting. For the MVP the owner accepts that **everyone who can open the hub sees every project** (2026-11-03).

So the MVP is a _view_, not a security boundary: projects carry their GitHub teams, and the home page filters by team through a bookmarkable link. A lead selects their teams once, bookmarks the link and opens it every morning.

How the company names teams (owner, 2026-11-03):

- **Cross teams** work on repositories of many projects (for example a platform or security team).
- **Project teams** follow `<line>-<project>-<role>`: business line, project, role (for example `dev`). A lead is typically a member of several teams, one per project.

## 2. Goals, non-goals, anti-goals

Goals

- Each project in the catalog can carry a list of GitHub teams.
- The home page has a **Team** filter that takes several teams at once. The selection lives in the link (`/?team=a&team=b`), and a project is shown when it has at least one selected team.
- Discovery reads teams from GitHub and **proposes** them for each project in the catalog editor, using team → repository access and the naming rule. Nothing enters the catalog without the editor's pull request.
- The catalog editor edits the team list.
- The same `teams` field is the input of a later per-person access check (§8), so nothing is redone.

Non-goals (MVP)

- No login change and no per-person access control: everyone who opens the hub sees every project.
- No server component, no user data stored anywhere.
- No team filter on Security, Versions, Changes, Workflows or Data quality. Only the home page filters by team.
- No reading of team **members** (who is in a team): only teams and their repositories.
- No "remember my teams" in browser storage: the link is the memory.

Anti-goals (failure even if it "works")

- Presenting the team filter as access control, in the UI or the docs. It is a view.
- A real company team name, business line or project name in the public repository (docs, fixtures, tests, examples).
- Discovery writing to the catalog, or proposing teams from data it was not allowed to read.
- A team filter that silently drops projects: unknown teams in the link and projects without teams are always accounted for in the results line.
- Any write permission, or a GitHub permission broader than **Members: read** (organisation) for this feature.

## 3. Constraints (from the project rules)

- Static Astro site, strict CSP (`script-src 'self'`, `connect-src 'self'`), no GitHub calls from the browser. Filtering is client-side over the pre-rendered list, like the existing filters in `src/scripts/portfolio-filters.ts`; without JavaScript the full list shows.
- Read-only GitHub App collector; every new permission is read-only and documented in `docs/security.md` (EN + IT).
- Bilingual EN (`/`) and IT (`/it/`): every string in `src/i18n/en.ts` and `it.ts`, every doc in EN and IT.
- Mock data only in the public repo (`example-org`); fixtures use made-up teams such as `pay-project-alpha-dev` and `platform`.
- UI in Primer (ADR 0009). **Design-first:** mockups of the changed screens in Claude Design (Primer design system), approved by the owner before any UI code. Claude Design links are never committed.
- Never run `npm run ci:build` or `npm run collect:mock` locally (they overwrite the real snapshot in `public/data`). Containers via Podman only.

## 4. Decisions taken with the owner

1. **Company hosting is GitHub Pages only** for now; a server component comes later, if the project grows (owner, 2026-11-03).
2. **MVP without access filtering:** everyone with access to the hub sees every project (owner, 2026-11-03).
3. **"My projects" = a `teams` field in the catalog plus a `?team=` link** (owner, 2026-11-03).
4. **Teams are GitHub teams.** Cross teams span many projects; project teams follow `<line>-<project>-<role>`; a lead is in several teams, one per project (owner, 2026-11-03). Hence the filter takes several teams.

## 5. Design

### 5.1 Catalog: `teams` on each project

`config/projects/<id>.yaml` gets an optional field:

```yaml
teams:
  - example-org/pay-project-alpha-dev
  - example-org/platform
```

- Each entry is `<org>/<team-slug>`, the form GitHub's API uses. Slug pattern: lowercase letters, digits, `-` and `_`, 1–100 characters; org pattern as for `discovery.owners`.
- Default `[]`. Duplicates are a validation error.
- The link uses the **slug only** (`?team=pay-project-alpha-dev`), so bookmarks stay readable. _My call:_ the build fails with a clear message when two catalog teams share a slug across different orgs (rare; costs one renamed reference if it ever happens).
- `ProjectConfigSchema` in `shared/model/catalog.ts` gains `teams`; the JSON schema is regenerated (`npm run schema:generate`).

### 5.2 Snapshot and index

- `project.teams` is copied into the project snapshot and into the portfolio index entry (`toProjectSummary` in `collector/src/build-snapshot.ts`).
- This is a snapshot schema minor bump (next free version after the supply chain work: 1.7 or 1.8, see §9), with fixtures and golden snapshots updated.
- _My call:_ the portfolio CSV export (`src/lib/exports.ts`) gets a `teams` column, values joined with `;`.

### 5.3 Discovery: proposing teams

New settings in `config/catalog.yaml`, in a **top-level `teams` block**, independent of repository discovery. _My call:_ team suggestions must work with `discovery.enabled: false`, which is the owner's current setting, without turning on full repository scanning.

```yaml
teams:
  discovery: true # read teams and their repositories (organisation Members: read)
  naming: # optional: how project teams are named
    pattern: '{line}-{project}-{role}'
    roles: [dev, ops, qa]
    lines: # line prefix → business unit
      pay: Payments
      fin: Finance
  maxTeams: 300
```

`CatalogSettingsSchema` / `CatalogSchema` gain an optional `teams` block. `discovery` is unchanged.

Reading:

- **Organisations read:**
  - The owners of the repositories already in the catalog (coordinators and components), plus `discovery.owners` when repository discovery is on.
  - Only those that are organisations (user accounts have no teams), each read once.
- **Endpoints:** `GET /orgs/{org}/teams` (paginated), then `GET /orgs/{org}/teams/{team_slug}/repos` for each team.
  - Both need the organisation permission **Members: read** (verified in GitHub's permission tables, 2026-11-03).
  - The repository entries carry the team's permission on each repository (`permissions` / `role_name`). The plan verifies this against the live API; if it is missing, it falls back to `GET /orgs/{org}/teams/{team_slug}/repos/{owner}/{repo}`, but only for repositories in the catalog.
- **Limits:** `maxTeams` (default 300, max 1000) and the existing concurrency limiter.
- **What is kept:** only team slug, team name, repository full names and the team's permission level on each.
  - Descriptions, members and the other team settings are dropped before anything is stored.
- **Secret teams:** _My call:_ teams with `privacy: secret` are skipped before anything is stored. Private Pages can admit outside collaborators who are not org members, and secret team names are meant for members only.
  - The run reports how many were skipped (a count, never names).
  - A secret team can still be written into a project file by hand.
- **Public audience:** _My call:_ with `publication.audience: public`, `teams.discovery` is forced off, like `includePrivate`. Team names describe the organisation and stay out of a public build.
  - Teams written by hand in project files are published as written, and the docs say so.
- **Missing permission:** if the App lacks Members: read (a 403), the team result records `not-authorised`, the catalog editor explains how to grant it, and the run does not fail.
  - _My call:_ this state lives only in the team result of `catalog.json`. The run capabilities in `index.json` and the Data quality page do not change.
  - Team input by hand keeps working.

Results go into `catalog.json` as a separate `teams` result next to `discovery`: suggestions per project, plus the skipped and not-authorised notes. It is `null` when `teams.discovery` is off.

Proposals:

- **By access:** for each catalog project, a team is proposed when it is not already in `teams` and has at least **write** access (write, maintain or admin) to at least one of the project's repositories (coordinator or components).
  - Each proposal carries its evidence, for example "write access to 3 of 5 repositories".
  - _My call:_ read-only and triage access are ignored, so a broad read-only team is not proposed for every project.
- **By name:** a team whose slug matches `teams.naming` is parsed into line, project and role.
  - The parse is unambiguous: the line must be a key of `lines`, the role must be in `roles`, and the project is whatever lies between.
  - The project part is used as a hint, like the existing `hintedProjectId`: if it equals a catalog project id, the team is proposed for that project even without repository access.
  - The line suggests the business unit for new-project proposals.
  - The pattern accepts exactly the placeholders `{line}`, `{project}` and `{role}`, each once, joined by `-`. Any other pattern is a configuration error.
- Proposals for **new** projects (existing discovery proposals) also carry their teams.
- Nothing is added to a project file until the owner saves it through the catalog editor (pull request).

### 5.4 Catalog editor (`/catalog/`)

- A **Teams** field on each project: the current teams as removable Labels, an input to add `<org>/<slug>` (validated as in §5.1), and the discovery suggestions with their evidence and an "Add" button.
- Saving works as today: one pull request on the project file.
- When team discovery is off or not authorised, the suggestions area says why in one line.

### 5.5 Home page: the team filter

- A **Team** control in the filter row, next to "Business unit". It is a dropdown with checkboxes in Primer's SelectPanel style, and it lets you select several teams. It lists only teams present in the catalog.
  - _My call:_ teams are grouped by business line when `teams.naming` parses them; the others sit under "Cross teams".
- The selected teams appear as removable Labels next to the control.
- The link keeps one `team` parameter per selected team (`/?team=a&team=b`). The filter applies on load, and the link can be bookmarked and shared, like the existing `q`, `health`, `bu`, `sort`, `lifecycle` and `severity` filters.
- Matching:
  - A project shows when its `teams` contains at least one selected slug (OR).
  - The team filter combines with the other filters by AND, as they do today.
  - Projects without teams never match a team filter.
- **Nothing dropped silently:**
  - A `team` value in the link that no catalog project uses still shows as a Label marked "not in the catalog" and matches nothing.
  - The results line keeps its "{shown} of {total} projects" form. While a team filter is active, it adds "· N projects without teams not shown" when other filters would have shown them, like the existing segment for unknown alert counts (`resultsLine` in `src/lib/portfolio-filters-core.ts`). New plural strings go in EN and IT.
  - "Clear filters" removes the teams too.
- Each project row shows its teams as small Labels, at most 3, then "+N".
- The project page (`/projects/<id>/`) lists the project's teams in its header meta line. This is where the lead "drills into the project and its repositories". The repository list itself is unchanged.
- When no project in the catalog has teams, the Team control is not rendered.
- Phones: the control sits inside the existing "Filters" disclosure, with no horizontal scroll at 390px.
- Accessibility:
  - The dropdown is a disclosure with a labelled group of checkboxes, so it is keyboard and screen-reader operable.
  - Each removable Label is a button whose accessible name is "Remove team {name}".
  - Values from the link are inserted as text, never as HTML.

### 5.6 Documentation

EN + IT for all of these:

- **`docs/configuration.md`:** the `teams` field, the `teams` block in `config/catalog.yaml` (`discovery`, `naming`, `maxTeams`), and the bookmark workflow for leads.
- **`docs/security.md`:**
  - The new organisation permission **Members: read**, with its endpoints.
  - The note that the team filter is not access control.
- **`docs/operations.md`:** the `not-authorised` case for teams.
- **README:** a short "My projects" paragraph.
- **CHANGELOG:** an entry under `[Unreleased]`.
- **A new ADR** (next free number, see §9): "Per-team views without per-person access control on static hosting". It records:
  - Private Pages are all-or-nothing.
  - The MVP is a view.
  - The future direction in §8, and why it reuses `teams`.

## 6. Error handling and edge cases

- An invalid team in a project file fails validation with the file and the entry in the message, as for other catalog errors.
- A team that is renamed or deleted in GitHub is still listed in the catalog. Discovery flags it as "not found in GitHub" in the editor, and the hub does not change the catalog.
- More teams than `maxTeams`: discovery stops at the limit and says so in the team result shown in the catalog editor. Proposals are then partial, never wrong.
- A slug collision across orgs causes a build error (§5.1).

## 7. Testing

- **Model:** `teams` schema, slug and org patterns, duplicates, cross-org slug collision.
- **Naming parser:** valid patterns, wrong placeholders, line and role lookup, projects with hyphens in their name, and names that don't match.
- **Discovery** (mocked GitHub responses, synthetic `example-org`):
  - Proposals by access (write or higher only; read-only teams not proposed) and by name.
  - Works with `discovery.enabled: false`, reading the organisations of catalog repositories.
  - Secret teams are skipped and only counted.
  - Audience public forces the feature off.
  - A 403 leads to `not-authorised` without failing the run.
  - The `maxTeams` limit.
  - Only the kept fields survive (a test that a team description never reaches the output).
- **Filter core:** a pure `teamMatch(selected, projectTeams)` and the results line with teams that aren't in the catalog and with projects without teams. Unit-tested, like `severityMatch`.
- **e2e:**
  - `/?team=a&team=b` shows the union.
  - A team not in the catalog shows its Label.
  - "Clear filters" also clears the teams.
  - The project page lists its teams.
  - Keyboard operation of the dropdown.
  - No horizontal scroll at 390px.
  - Each check in both EN and IT.
- **Catalog editor:** add and remove a team, accept a suggestion, and the pull request content.
- **Exports:** the `teams` column.
- **Contracts:** the i18n key parity test and the output secret scan stay green.

## 8. Later: per-person access (not in the MVP)

Recorded so the MVP does not block it. A small server component in front of the static site (for example Cloudflare Pages Functions, or whatever the company allows) with "Sign in with GitHub" through the hub's GitHub App.

- With the user's token, GitHub returns the repositories that both the App and that person can see. A person sees a project when it contains at least one of those repositories, or when one of their teams is in the project's `teams`, or when a manual access file lists them.
- Cross-project pages are recomputed over the visible projects.
- Data files are served only through the access check.
- That requires an ADR amending ADR 0001 (static first). None of it is designed here.

## 9. Left to the builder and the plan

- **Order with the supply chain work** (`feat/supply-chain-providers`, planned as v0.11.0 with ADRs 0010–0011 and snapshot schema 1.7):
  - Whichever branch merges second takes the next ADR number and snapshot schema minor, and rebases.
  - The plan states the assumed order; _my call_ is that the supply chain merges first, so this would be ADR 0012, schema 1.8 and v0.12.0.
- Mockups in Claude Design before UI code:
  - The home filter row with the Team control open and closed.
  - Selected-team Labels.
  - Team Labels in rows.
  - The project header meta.
  - The catalog editor Teams field.
  - Light and dark themes, desktop and 390px.
- Exact copy for the new strings (EN + IT), within the existing tone.
- The exact shape of the `teams` result in `catalog.json`, as long as the editor shows evidence for each suggestion.
