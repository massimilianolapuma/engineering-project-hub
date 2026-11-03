# Team dashboards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Projects carry their GitHub teams; the home page filters by several teams through a bookmarkable `?team=` link; discovery proposes teams from GitHub (Members: read) for the catalog editor.

**Architecture:**

- **Design first:** mockups of the changed screens in Claude Design (Primer design system), approved by the owner before any UI code (Task 0). Approved deviations go into "Mockup decisions" and win over the defaults below.
- **Model:** `teams: ["<org>/<slug>"]` on each project; a top-level `teams` block in `config/catalog.yaml` (discovery switch, naming rule, limit); a pure naming parser shared by the collector and the site.
- **Collector:** two new read-only provider calls (org teams, team repositories); a `discoverTeams` step after repository discovery produces a `teams` result in `catalog.json` and adds teams to new-project proposals. Snapshot and index entries carry `teams`.
- **Site:** client-side team filter over the pre-rendered list (as the existing filters), team Labels in rows and in the project header, a Teams field in the catalog editor.

**Tech Stack:** Astro 7, TypeScript 6, Zod, Octokit, Vitest, Playwright. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-03-team-dashboards-design.md` (IT mirror under `docs/it/`). Read it first. Section numbers (§) refer to the spec.

## Before you start

- Branch `feat/team-dashboards` from `main` (v0.10.0), already created with the spec commit.
- **Version numbers (spec §9):** check whether `feat/supply-chain-providers` has merged into `main`.
  - **Merged:** rebase first; this work takes snapshot schema `1.8`, ADR `0012` and release `v0.12.0`.
  - **Not merged:** take the next free values on `main` (`1.7`, ADR `0010`); whichever branch merges second renumbers.
  - Below, `<NEXT_SCHEMA>` and `<ADR>` stand for these values.
- Task 0 is a gate: Tasks 6 and 7 (UI) do not start until the owner approves the mockups. Tasks 1–5 do not touch the UI and may run before approval.

## Global Constraints

- **Read-only.** The only new GitHub permission is the organisation permission **Members: read** (spec §2). No member lists are read.
- **Kept fields:** team slug, team name, repository full names and the team's permission per repository. Descriptions, members and other settings never leave the provider (spec §5.3).
- **Secret teams:** `privacy: secret` is skipped before storage and only counted (spec §5.3).
- **Public audience:** `teams.discovery` is forced off when `publication.audience` is `public` (spec §5.3).
- **Proposals by access:** only write, maintain or admin access counts; read and triage do not (spec §5.3).
- **Static site:** CSP unchanged (`script-src 'self'`, `connect-src 'self'`). Values from the URL are set with `textContent`, never `innerHTML`.
- **Language:** every UI string EN + IT (`tests/unit/i18n.test.ts` parity); every doc EN + IT (plans excepted).
- **Synthetic data only:** `example-org`, made-up teams such as `pay-project-alpha-dev`, `platform`. No real company, team, line or project names anywhere.
- **Never run `npm run ci:build` or `npm run collect:mock`**: they overwrite `public/data`, the owner's real snapshot, which is git-ignored.
  - Goldens: `npm run fixtures:update` (writes `fixtures/snapshots`).
  - Manual build: `SNAPSHOT_DIR=fixtures/snapshots npx astro build --outDir "$(mktemp -d)"`.
- **Never use or kill port 4321.** For e2e: `sed 's/4321/4377/g' playwright.config.ts > playwright.tmp.config.ts && npx playwright test -c playwright.tmp.config.ts`, then delete `playwright.tmp.config.ts` and `.e2e-dist/`. Never commit them.
- **Containers:** Podman only.
- **Commits:**
  - Conventional Commits, made with `git -c user.name=massilp -c user.email=3519719+massilp@users.noreply.github.com commit`.
  - No attribution trailers.
  - Run `npx prettier --write` on touched files before each commit.
  - Do not push until Task 8; push to `origin` only, never `emu-archive`.
- **UI deviations:** after any UI change that diverges from the approved canvas, update the Claude Design canvas too. Claude Design links never go into the repo.

## Review Focus

1. **Hostile or odd `team` values in the link** (`?team=<img src=x>`, `?team=`, very long values). Expected: shown as a "not in the catalog" Label, rendered as text, no layout break, matches nothing. Pinned in Task 6.
2. **Repeated values** (`?team=a&team=a`, or case variants `?team=A`). Expected: slugs are lowercased and de-duplicated, one Label, counted once. Pinned in Task 5.
3. **Back/forward navigation** (home → project → back). Expected: the checked teams, the Labels and the URL agree. Pinned in Task 6.
4. **Team names the naming rule only half matches** (`pay-x` with no role, an unknown line, a role in the middle). Expected: treated as a cross team, never a crash or a wrong project. Pinned in Task 1.
5. **More teams than `maxTeams`, or a team whose repository list fails.** Expected: status `partial`, the proposals made so far are kept, `notFound` is not computed (it would be wrong), and the run does not fail. Pinned in Task 4.

## Mockup decisions

Empty until Task 0 Step 4. Later UI tasks read this section first; it wins over the defaults below.

---

### Task 0: Mockups in Claude Design (owner gate)

**Files:** none in the repo, except this plan's "Mockup decisions" section.

**Interfaces:**

- Produces: an approved canvas and the filled "Mockup decisions" section.

- [ ] **Step 1:** Open the existing hub canvas built on the Primer design system in Claude Design (see the owner's memory notes for the project). Read spec §5.4–§5.5 and `DESIGN.md`. Use `fixtures/snapshots` content plus the made-up teams of Task 1.
- [ ] **Step 2: Add the artboards listed in spec §9.**
  - The Portfolio filter row with the Team control closed, and open with teams grouped by line plus a "Cross teams" group.
  - The selected-team Labels, including one "not in the catalog" Label.
  - The results line with "· N projects without teams not shown".
  - Team Labels in project rows (at most 3, then "+N").
  - The Project header meta line with teams.
  - The catalog editor Teams field: current Labels, an add input and suggestions with evidence. Also its "off / not authorised" line.
  - Variants: light and dark, desktop and 390px (Portfolio).
- [ ] **Step 3: Owner review.** Share the canvas and iterate until the owner approves. Do not start Task 6 or Task 7 before approval.
- [ ] **Step 4:** Fill "Mockup decisions" with everything that overrides a default in Tasks 6–7: control type, Label tones, the group order, the position of the chips and the editor layout.

---

### Task 1: Model — `teams` on projects, `teams` settings, naming parser

**Files:**

- Create: `shared/model/teams.ts`
- Modify: `shared/model/catalog.ts` (`ProjectConfigSchema`, `CatalogSettingsSchema`, `CatalogSchema`), `shared/model/index.ts` (export), `collector/src/config/load.ts` (pass `settings.teams`)
- Modify: `config/projects/project-alpha.yaml`, `project-beta.yaml`, `platform.yaml` (made-up teams); `project-gamma.yaml` stays without teams. `config/catalog.yaml` gets a `teams` block with `discovery: true`; it is forced off by the public audience, which documents the setting.
- Regenerate: `config/schema/*.json` (`npm run schema:generate`)
- Test: `tests/unit/teams-model.test.ts`

**Interfaces:**

- Produces (all from `@model/index`):
  - `TEAM_REF: RegExp`, matching `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[a-z0-9][a-z0-9_-]{0,99}$`.
  - `teamSlug(ref: string): string`, the part after `/`.
  - `TeamNamingSchema`: `{ pattern: string; roles: string[]; lines: Record<string, string> }`.
  - `TeamsConfigSchema`: `{ discovery: boolean = false; naming?: TeamNaming; maxTeams: int 1..1000 = 300 }`, strict.
  - `type TeamNaming`, `type TeamsConfig`.
  - `parseTeamName(slug: string, naming: TeamNaming | undefined): { line: string; project: string; role: string; businessUnit: string } | null`.
  - `ProjectConfig.teams: string[]`, default `[]`, max 50.
  - `Catalog.teams: TeamsConfig`, default `{ discovery: false, maxTeams: 300 }`.

- [ ] **Step 1: Write the failing tests** in `tests/unit/teams-model.test.ts`:
  - `ProjectConfigSchema` accepts `teams: ['example-org/pay-project-alpha-dev']` and defaults to `[]`.
  - It rejects `'example-org/Pay'` (upper case), `'pay-team'` (no org) and a duplicate entry. The issue path is `['teams', 1]` and the message contains `duplicate team`.
  - `CatalogSchema` rejects `example-org/platform` in one project together with `other-org/platform` in another. The message contains `same team slug "platform" in example-org and other-org`.
  - `TeamNamingSchema` accepts `{line}-{project}-{role}` and `{role}-{line}-{project}`. It rejects `{line}-{project}` (missing placeholder), `{line}-{line}-{role}` (repeated) and `{line}_{project}_{role}` (wrong separator).
  - `parseTeamName('pay-project-alpha-dev', N)` returns `{ line: 'pay', project: 'project-alpha', role: 'dev', businessUnit: 'Payments' }`, with `N = { pattern: '{line}-{project}-{role}', roles: ['dev', 'ops'], lines: { pay: 'Payments' } }`.
  - `parseTeamName` returns `null` for `'platform'`, `'pay-dev'` (empty project), `'xyz-project-alpha-dev'` (unknown line), `'pay-project-alpha-qa'` (unknown role), and for any slug when `naming` is `undefined`.
  - `teamSlug('example-org/platform')` returns `'platform'`.
  - `CatalogSettingsSchema` accepts a `teams` block, and the loader carries it into `Catalog.teams`. Use `loadConfig` on a temp directory, as in `tests/unit/config.test.ts`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/teams-model.test.ts`. Expected: FAIL (missing exports).
- [ ] **Step 3: Implement** `shared/model/teams.ts`.
  - The pattern check splits on `-` and needs exactly the three placeholders once each.
  - The parser takes the line from the pattern position, matched against `lines` keys; the role from its position, matched against `roles`; the project is the remaining middle segments joined by `-`, and must not be empty.
  - With `{role}` or `{line}` in the middle position, match from both ends; the project is always what is left over.
- [ ] **Step 4: Extend `catalog.ts` and wire the loader.**
  - `ProjectConfigSchema`: `teams` plus a duplicate check in its existing `superRefine`.
  - `CatalogSchema`: `teams` plus a slug collision check in its `superRefine`.
  - `CatalogSettingsSchema`: optional `teams`.
  - `load.ts`: `teams: settings?.teams`.
- [ ] **Step 5: Add the made-up teams to the demo config:**
  - alpha: `example-org/pay-project-alpha-dev`, `example-org/platform`.
  - beta: `example-org/pay-project-beta-dev`.
  - platform: `example-org/platform`, `example-org/security`.
  - `config/catalog.yaml`: `teams: { discovery: true, naming: { pattern: '{line}-{project}-{role}', roles: [dev, ops], lines: { pay: Payments } }, maxTeams: 300 }`, with a comment that the public audience forces discovery off.
  - Run `npm run schema:generate`.
- [ ] **Step 6: Run** `npx vitest run tests/unit/teams-model.test.ts tests/unit/config.test.ts tests/unit/json-schema.test.ts && npm run validate:config`. Expected: PASS.
- [ ] **Step 7: Commit** `feat(model): teams on projects and catalog team settings`.

---

### Task 2: Snapshot — `teams` in project and index, `teams` result slot, CSV column

**Files:**

- Modify: `shared/model/enums.ts` (`SNAPSHOT_SCHEMA_VERSION = '<NEXT_SCHEMA>'`, `SUPPORTED_SNAPSHOT_SCHEMA_VERSIONS = ['<NEXT_SCHEMA>']`, plus a history comment line).
- Modify: `shared/model/snapshot.ts`:
  - `project.teams`.
  - `ProjectSummarySchema.teams`.
  - New `TeamsResultSchema`.
  - `CatalogSnapshotSchema.teams`.
- Modify: `collector/src/build-snapshot.ts` (copy `teams` into the project block and `toProjectSummary`), `collector/src/writers/write-snapshots.ts` (`buildCatalogSnapshot(..., teams: TeamsResult | null = null)`), `src/lib/exports.ts` (`teams` as the **last** portfolio column, values joined with `;`), `tests/helpers/factories.ts`.
- Regenerate: `fixtures/snapshots` (`npm run fixtures:update`), `config/schema/*.json`.
- Test: `tests/unit/csv.test.ts`, `tests/integration/collector.test.ts`, `tests/unit/teams-model.test.ts`.

**Interfaces:**

- Consumes: `ProjectConfig.teams` (Task 1).
- Produces:
  - `ProjectSnapshot.project.teams: string[]` and `ProjectSummary.teams: string[]` (refs `<org>/<slug>`, max 50, each max 141 chars).
  - `TeamsResult`, strict:

    ```ts
    {
      status: 'ok' | 'partial' | 'not-authorised';
      orgs: string[];
      teamsRead: number;
      secretSkipped: number;
      limitReached: boolean;
      suggestions: {
        projectId: string;
        team: string;
        reason: 'access' | 'name';
        writeRepositories: number;
        totalRepositories: number;
      }[];
      notFound: { projectId: string; team: string }[];
      errors: { target: string; classification: ErrorClassification }[];
    }
    ```

  - `CatalogSnapshot.teams: TeamsResult | null`.

- [ ] **Step 1: Write the failing tests:**
  - The `portfolioRows` header ends with `teams`, and alpha's cell is `example-org/pay-project-alpha-dev;example-org/platform`.
  - `TeamsResultSchema` rejects an unknown key, for example `description`.
  - The integration collector run puts alpha's teams into `projects/project-alpha.json` and `index.json`, and gamma gets `[]`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/csv.test.ts tests/integration/collector.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the schema changes, copying and writer parameter, plus the CSV column. Update the factories with `teams: []`.
- [ ] **Step 4: Regenerate** with `npm run schema:generate && npm run fixtures:update`. Check that the golden diff only adds `teams`, `"teams": null` and the version.
- [ ] **Step 5: Run** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(snapshot): teams in project snapshots and index (schema <NEXT_SCHEMA>)`.

---

### Task 3: Provider — org teams and team repositories

**Files:**

- Modify: `collector/src/providers/types.ts`, `collector/src/providers/github/github-provider.ts`, `collector/src/providers/mock/mock-provider.ts`
- Create: `fixtures/github/_orgs/example-org.teams.json` (synthetic)
- Test: `tests/unit/github-provider.test.ts`, `tests/unit/discovery.test.ts` (the MockProvider part)

**Interfaces:**

- Produces (in `types.ts`):

  ```ts
  export type TeamPermission = 'read' | 'triage' | 'write' | 'maintain' | 'admin';
  export interface TeamDTO { org: string; slug: string; name: string; privacy: 'closed' | 'secret' }
  export interface TeamRepositoryDTO { fullName: string; permission: TeamPermission | null }
  // SourceProvider:
  listOrgTeams(org: string, opts: { max: number }): Promise<ProviderResult<{ teams: TeamDTO[]; limitReached: boolean }>>;
  listTeamRepositories(org: string, teamSlug: string): Promise<ProviderResult<TeamRepositoryDTO[]>>;
  ```

- GitHub:
  - `GET /orgs/{org}/teams`, paginated with `per_page: 100`, stopping at `max`.
  - `GET /orgs/{org}/teams/{team_slug}/repos`, paginated.
  - Permission comes from `role_name` when present (`pull`→`read`, `push`→`write`), otherwise from the highest true key of `permissions`. With neither, it is `null`.
  - Both fields are in the `minimal-repository` response of this endpoint (`@octokit/openapi-types`, checked 2026-11-03), so the per-repository fallback endpoint in spec §5.3 is not built.
  - Ruling: a `null` permission never counts as write. The cost if wrong: a team with real write access is not suggested by access, though it may still be suggested by name.
  - 404 on the org listing gives `fail({ classification: 'not-found' })`: an account that is not an organisation.
- Mock fixture format: `[{ slug, name, privacy, description, repos: [{ fullName, permission }] }]`. `description` exists only to prove it is dropped.
  - Fixture teams:
    - `pay-project-alpha-dev`: write on 3 alpha repos.
    - `pay-project-alpha-ops`: maintain on helm only.
    - `platform`: admin on alpha coordinator and platform-mono.
    - `readers`: read on every repo.
    - `secret-audit`: secret.
    - `pay-project-beta-dev`: write on beta repos.
    - `pay-tools-dev`: write on tools-api, not in the catalog.
  - A missing org file gives `fail({ classification: 'not-found' })`.

- [ ] **Step 1: Write the failing tests.**
  - GitHub provider (stub `client.request`/`paginate` as the existing tests do):
    - `role_name: 'push'` maps to `write`.
    - `permissions: { admin: false, maintain: true, push: true, pull: true }` maps to `maintain`.
    - `description` and `members_url` are absent from the DTO.
    - Stops at `max` with `limitReached: true`.
    - 403 classifies as `not-authorised`.
  - Mock provider: lists the fixture teams with `privacy` kept, and drops `description`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/github-provider.test.ts tests/unit/discovery.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** both providers and add the fixture.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(collector): read organisation teams and team repositories`.

---

### Task 4: Team discovery — proposals, secret and public rules, `catalog.json`

**Files:**

- Create: `collector/src/discovery/teams.ts`
- Modify: `collector/src/run.ts` (call it after `discover`, and add `teams: TeamsResult | null` to `RunResult`), `collector/src/index.ts` and `scripts/update-golden-snapshots.ts` (pass `result.teams` to `buildCatalogSnapshot`)
- Test: `tests/unit/team-discovery.test.ts`

**Interfaces:**

- Consumes: `listOrgTeams`, `listTeamRepositories` (Task 3); `parseTeamName`, `teamSlug`, `Catalog.teams`, `projectTargets` (Task 1 / existing); `TeamsResult` (Task 2).
- Produces: `discoverTeams(ctx: CollectContext, catalog: Catalog, policies: Policies, discovery: DiscoveryResult | null): Promise<{ teams: TeamsResult | null; discovery: DiscoveryResult | null }>`.
  - It returns `teams: null` when `catalog.teams.discovery` is false or the audience is `public`.
  - The returned `discovery` is the input, with `project.teams` (and, for a by-name match, `businessUnit`) filled on new-project proposals.

Rules (spec §5.3):

- **Organisations read:** the distinct owners of every `projectTargets` repository, plus `discovery.owners` when `discovery.enabled`. Each is read once, under `ctx.limit`. A `not-found` org is skipped silently: it is a user account.
- **Status:**
  - `not-authorised` when every org listing failed with `not-authorised`.
  - `partial` when any org or team call failed, or the limit was reached.
  - `ok` otherwise.
- **Kept and dropped:** secret teams are counted in `secretSkipped` and dropped; their slugs are remembered in memory only, so `notFound` ignores them. Read and triage access are ignored.
- **Suggestions:**
  - `reason: 'access'` with write/total counts over the project's distinct repositories.
  - `reason: 'name'` when `parseTeamName(...).project` equals the project id and there is no access match.
  - Teams already in `project.teams` are never suggested.
  - Sort by project id, then team.
- **`notFound`:** project teams whose org was read in full but whose slug is not listed. It is empty when `limitReached` or when that org failed.
- **Bounds:** at most `maxTeams` teams in total across orgs.

- [ ] **Step 1: Write the failing tests** (MockProvider plus the fixture from Task 3, audience `restricted` unless stated):
  - `returns null when teams.discovery is false and when the audience is public`.
  - `suggests by access with write or higher only`:
    - alpha gets `pay-project-alpha-ops` (maintain on 1 of 5) but not `readers`.
    - `platform` is already present, so it is not suggested.
    - The evidence is `writeRepositories: 1, totalRepositories: 5`.
  - `suggests by name when the slug names the project`: a catalog project `tools` (repo `example-org/tools-cli`, with no team access to it) is suggested `pay-tools-dev` with `reason: 'name'`.
  - `skips secret teams and only counts them`:
    - `secretSkipped: 1`.
    - `JSON.stringify(result)` does not contain `secret-audit`.
    - A project listing `example-org/secret-audit` is not in `notFound`.
  - `never stores a team description`: the stringified result does not contain the fixture description text.
  - `flags project teams missing from GitHub`: a project with `example-org/gone-team` gets `notFound: [{ projectId, team: 'example-org/gone-team' }]`.
  - `works with discovery.enabled false`: the orgs come from catalog repositories.
  - `reports not-authorised without throwing`: stub the provider so `listOrgTeams` returns `not-authorised`. Expect `status: 'not-authorised'` and empty suggestions.
  - `partial on limit or team failure, no notFound`: with `maxTeams: 2`, expect `limitReached: true`, `status: 'partial'` and `notFound: []`. A stubbed `listTeamRepositories` failure for one team gives `status: 'partial'` with that team in `errors`.
  - `fills teams on new-project proposals`: a proposal whose id is `tools` gets `teams: ['example-org/pay-tools-dev']` and `businessUnit: 'Payments'`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/team-discovery.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `teams.ts`, then wire `run.ts`, `index.ts` and `update-golden-snapshots.ts`.
- [ ] **Step 4: Run** `npx vitest run tests/unit/team-discovery.test.ts tests/integration/collector.test.ts && npm run fixtures:update && git diff --stat fixtures/snapshots`. Expected: PASS. The goldens are unchanged, because the public audience gives `teams: null`.
- [ ] **Step 5: Commit** `feat(collector): propose GitHub teams for catalog projects`.

---

### Task 5: Filter core — `teamMatch`, results line, team grouping

**Files:**

- Modify: `src/lib/portfolio-filters-core.ts`
- Create: `src/lib/teams.ts`
- Modify: `src/i18n/en.ts`, `src/i18n/it.ts` (`portfolio.noTeamsHidden: { one, other }`)
- Test: `tests/unit/portfolio-filters.test.ts`, `tests/unit/teams-site.test.ts`

**Interfaces:**

- Consumes: `parseTeamName`, `teamSlug`, `TeamNaming` (Task 1).
- Produces:
  - `normalizeTeams(values: string[]): string[]`: trim, lowercase, drop empty values, de-duplicate, keep the first-seen order, and cap each value at 100 characters.
  - `teamMatch(selected: string[], projectTeamSlugs: string[]): boolean`: true when nothing is selected, or when the two lists intersect.
  - `resultsLine(template, shown, total, unknownHidden, unknownForms, noTeamsHidden = 0, noTeamsForms?: { one: string; other: string }): string`. It adds `· {plural}` for projects without teams after the unknown segment.
  - `groupTeams(refs: string[], naming: TeamNaming | undefined): { businessUnit: string | null; teams: { ref: string; slug: string }[] }[]`:
    - Named lines come first, sorted by business unit.
    - The cross teams (`businessUnit: null`) come last.
    - Teams are sorted by slug within each group.
    - Duplicate refs are dropped.

- [ ] **Step 1: Write the failing tests:**
  - `normalizeTeams([' A ', 'a', '', 'b'])` returns `['a', 'b']`.
  - `teamMatch([], [])` is `true`.
  - `teamMatch(['a'], [])` is `false`.
  - `teamMatch(['a', 'b'], ['b'])` is `true`.
  - `resultsLine(en.portfolio.results, 1, 4, 0, en.portfolio.unknownHidden, 2, en.portfolio.noTeamsHidden)` returns `'1 of 4 projects · 2 projects without teams not shown'`.
  - The IT singular is `'1 di 4 progetti · 1 progetto senza team non mostrato'`.
  - `groupTeams` puts the alpha and beta dev teams under `Payments`, and `platform` and `security` under `null` (last).
- [ ] **Step 2: Run** `npx vitest run tests/unit/portfolio-filters.test.ts tests/unit/teams-site.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the functions and add the strings: EN `{ one: '1 project without teams not shown', other: '{n} projects without teams not shown' }`, IT `{ one: '1 progetto senza team non mostrato', other: '{n} progetti senza team non mostrati' }`. Follow the existing `unknownHidden` placeholder convention.
- [ ] **Step 4: Run** the same tests plus `tests/unit/i18n.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(site): team filter core and grouping`.

---

### Task 6: Home and project page — team filter UI (after Task 0 approval)

**Files:**

- Modify: `src/pages/[...lang]/index.astro`:
  - The Team control in the filter row, after "Business unit".
  - Inside the phone "Filters" disclosure, as the other fields.
  - `data-teams` on each row (space-separated slugs).
  - Team Labels under the project name.
- Modify: `src/scripts/portfolio-filters.ts`:
  - Multi-value `team` read with `getAll` and written with `append`.
  - The chips.
  - The not-in-catalog chip from a `<template>`.
  - "Clear filters".
  - `noTeamsHidden` counting.
  - `pageshow` re-sync.
- Modify: `src/pages/[...lang]/projects/[id].astro`: teams in `.phead__meta`.
- Modify: `src/lib/data.ts` only if the home needs `loadCatalogSnapshot()` for `catalog.teams.naming`. Fall back to a flat list when `catalog.json` is missing.
- Modify: i18n EN + IT. Keys: `portfolio.filterTeam`, `portfolio.crossTeams`, `portfolio.teamNotInCatalog`, `portfolio.removeTeam` ("Remove team {name}" / "Rimuovi il team {name}"), `portfolio.moreTeams` ("+{n}"), `project.teams`.
- Test: `tests/e2e/smoke.spec.ts`

**Interfaces:**

- Consumes: `normalizeTeams`, `teamMatch`, `resultsLine`, `groupTeams` (Task 5); `ProjectSummary.teams` (Task 2).

Defaults, which "Mockup decisions" may override:

- **Team control:** a `<details>` disclosure styled as a Primer SelectPanel button. It holds one `<fieldset>` per group, with a `<legend>` naming the business unit or "Cross teams", and one checkbox per team (`name="team"`, `value=<slug>`).
- **Chips:** `button.Label` elements with an `x` Octicon and an `aria-label` from `removeTeam`.
- **Rendering:** the control is not rendered when no project has teams. Rows show at most 3 team Labels, then a `+N` Label.

- [ ] **Step 1: Write the failing e2e tests:**
  - `team filter: several teams in the link show the union`: `/?team=pay-project-alpha-dev&team=security` shows alpha and platform rows only, and the results line has `· 1 project without teams not shown`.
  - `team filter: unknown and hostile values render as text`: `/?team=%3Cimg%20src%3Dx%3E&team=nope` shows two "not in the catalog" chips whose text contains `<img src=x>`, no `img` element inside the chips, and 0 rows.
  - `team filter: chips, keyboard and clear`:
    - Open the control with the keyboard, check `platform` with Space, and expect the URL to contain `team=platform`.
    - Remove the chip with Enter: the URL loses it.
    - "Clear filters" removes every team.
  - `team filter: survives back navigation`: open `/?team=platform`, go to a project, press back, and expect the checkbox checked, the chip present and the URL unchanged.
  - `project page lists its teams`: the alpha header meta contains `pay-project-alpha-dev`.
  - Also in IT at `/it/?team=platform`.
  - The existing 390px no-scroll test covers `/?team=pay-project-alpha-dev&team=platform&team=security&team=nope`.
- [ ] **Step 2: Run** e2e on port 4377 (see Global Constraints). Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the markup, the script and the strings.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run lint`, then the full e2e on 4377. Expected: PASS. Then compare screenshots of the Portfolio and Project pages, light and dark, at 1280 and 390px, against the canvas.
- [ ] **Step 5: Commit** `feat(site): filter the portfolio by GitHub team`.

---

### Task 7: Catalog editor — Teams field and suggestions (after Task 0 approval)

**Files:**

- Modify: `src/lib/catalog-editor-core.ts`:
  - `DraftProject.teams: string[]`.
  - `projectToDraft` / `toProjectInput` / `emptyProject`.
  - `addTeam(project: DraftProject, ref: string): EditorIssue | null`.
  - `removeTeam(project: DraftProject, ref: string): void`.
  - `teamSuggestions(result: TeamsResult | null, projectId: string, project: DraftProject): TeamsResult['suggestions']`, which excludes refs already present.
- Modify: `src/scripts/catalog-editor.ts` (render the field, suggestions with evidence and Add, and the status line), `src/pages/[...lang]/catalog.astro` (pass `catalog.teams` in the JSON payload), i18n EN + IT (`catalog.field.teams`, `catalog.teams.add`, `catalog.teams.evidenceAccess` "write access to {n} of {total} repositories", `catalog.teams.evidenceName`, `catalog.teams.off`, `catalog.teams.notAuthorised`, `catalog.teams.partial`, `catalog.teams.notFound`).
- Test: `tests/unit/catalog-editor.test.ts`, `tests/e2e/catalog.spec.ts`

**Interfaces:**

- Consumes: `TEAM_REF` (Task 1), `TeamsResult` (Task 2).

- [ ] **Step 1: Write the failing tests:**
  - Unit:
    - `addTeam` rejects `'pay-team'` with an issue on path `['teams']`.
    - `addTeam` ignores a duplicate.
    - The `projectToYaml` output for a draft with teams contains a `teams:` list, and omits the key when the list is empty.
    - `teamSuggestions` drops refs already in the draft.
  - e2e:
    - On `/catalog/`, add `example-org/pay-project-gamma-dev` to gamma; the pending changes list gamma as modified, and the generated YAML contains the team.
    - With the golden `teams: null`, the Teams section shows the `off` line.
- [ ] **Step 2: Run** `npx vitest run tests/unit/catalog-editor.test.ts`, then the catalog e2e on 4377. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run lint`, then the catalog e2e. Expected: PASS.
- [ ] **Step 5: Commit** `feat(catalog): edit project teams and accept GitHub suggestions`.

---

### Task 8: Docs, ADR, final checks

**Files** (EN and IT for each):

- `docs/configuration.md`: the `teams` field, the `teams` block, the naming rule and the bookmark workflow.
- `docs/security.md`: Members: read with both endpoints in the permissions table, plus "the team filter is not access control".
- `docs/operations.md`: the `not-authorised` and `partial` team states.
- `README.md` / `README.it.md`: the "My projects" paragraph.
- `CHANGELOG.md`: `[Unreleased]`.
- Create: `docs/architecture/adr/<ADR>-per-team-views-without-access-control.md` and the IT mirror under `docs/it/architecture/adr/`, following the ADR 0009 format. The content comes from spec §5.6 and §8.

- [ ] **Step 1: Write the docs.**
- [ ] **Step 2: Run the full gate:**
  - `npm run lint && npm run typecheck && npm test && npm run format:check`.
  - The full e2e on 4377.
  - `OUT=$(mktemp -d) && SNAPSHOT_DIR=fixtures/snapshots npx astro build --outDir "$OUT" && npx tsx scripts/scan-output.ts "$OUT" fixtures/snapshots`.
  - Expected: all green.
- [ ] **Step 3: Commit** `docs: team dashboards (configuration, security, ADR <ADR>)`.
- [ ] **Step 4:** Final whole-branch review (per the execution skill), then ask the owner before any push or PR.
