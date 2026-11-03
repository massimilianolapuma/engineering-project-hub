# ADR 0010: Per-team views without per-person access control on static hosting

- **Status:** Accepted
- **Date:** 2026-11-03
- **Italian version:** [docs/it/architecture/adr/0010-per-team-views-without-access-control.md](../../it/architecture/adr/0010-per-team-views-without-access-control.md)

## Context

Leads asked for "their own dashboard": the projects they work on, without the rest of the
portfolio in the way. In GitHub, a lead belongs to several teams, typically one per project, named
`<line>-<project>-<role>`, plus a few cross teams that span many repositories.

The hub is a static site ([ADR 0001](0001-static-first-github-native.md)). For now the company
hosts it on GitHub Pages only. Private Pages control access to the **whole site**: whoever can open
it sees every page and every data file. Hiding a project from one person needs a component that
knows who the viewer is and serves data through an access check; static hosting has none.

## Decision

1. **A view, not access control.** Projects list their GitHub teams in the catalog
   (`teams: ["<org>/<team-slug>"]`). The Portfolio filters by team on the client, and the link keeps
   one `team` parameter per selected team, so a lead bookmarks their own view. Everyone who can open
   the site still sees every project; the docs say so where the feature is described.
2. **Teams come from GitHub, the catalog decides.** With the organisation permission **Members:
   read**, the collector reads the organisations' teams and the repositories each team can access,
   and only **proposes** teams in the catalog editor: by write access (write, maintain or admin) to
   the project's repositories, or by a name that follows the configured naming rule. Nothing changes
   the catalog without a pull request.
3. **Least data.** Only team slugs, repository counts and access levels are used. Team names,
   descriptions and members are never stored; secret teams are skipped and only counted. Team
   discovery is off when `publication.audience` is `public`.
4. **Slugs in links.** `?team=` carries the slug only, so the catalog rejects one slug in two
   organisations.

## Alternatives considered

- **Per-person access now** (a server component with "Sign in with GitHub"). Rejected for the MVP:
  the company allows only GitHub Pages today, and it changes the static-first architecture.
- **A `owners`/people field per project.** Rejected: teams already exist in GitHub, people change
  teams more often than projects change teams, and a list of people is personal data the hub does
  not need.
- **Reading team membership to show "my teams" automatically.** Rejected: it needs the viewer's
  identity (not available on static Pages) and member lists the hub must not publish.

## Consequences

- A lead's view is a bookmark; sharing the link shares the view, not access.
- A new GitHub permission (Members: read) is optional: without it the filter still works from the
  catalog, and discovery reports `not-authorised`.
- Snapshot schema `1.7` carries `teams`.

## Later: per-person access

Recorded so the MVP does not block it. A small server component in front of the static files (for
example Cloudflare Pages Functions, or whatever the company allows) with "Sign in with GitHub"
through the hub's GitHub App. With the user's token, GitHub returns the repositories that both the
App and that person can see; a person sees a project when it contains at least one of those
repositories, when one of their teams is in the project's `teams`, or when a manual access file
lists them. Cross-project pages are recomputed over the visible projects, and data files are
served only through the access check. The `teams` field built here is reused as is. That needs an
ADR amending ADR 0001; none of it is designed here.
