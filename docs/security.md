# Security

> 🇮🇹 [Versione italiana](it/security.md) · Reporting a vulnerability: [SECURITY.md](../SECURITY.md)

## Threat model (summary)

| #   | Threat                                                                                        | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | A credential (token, App private key) leaks into the static site                              | Secrets exist only in the `collect` job. The build and deploy jobs have none. The credential gate runs on snapshots, and `scan-output` scans `dist/` and `public/data/` for patterns and for the exact values of environment credentials. Octokit logging is disabled.                                                                                                                                                                                                                                                       |
| T2  | A secret scanning alert value or location is published                                        | Alerts are requested with `hide_secret=true`. The DTO has no field for the value, location, file or commit. Only the secret _type_ name is kept.                                                                                                                                                                                                                                                                                                                                                                             |
| T3  | A raw API payload, stack trace, header or env var is published                                | Allowlist: DTO projection, then strict Zod schemas that reject unknown keys. Error messages are classified and scrubbed (headers, stack frames, query strings, code removed).                                                                                                                                                                                                                                                                                                                                                |
| T4  | Details of private repositories leak through a public Page                                    | `publication.audience: public` (default) withholds titles and rule ids of findings in non-public repositories. Advice below on private Pages.                                                                                                                                                                                                                                                                                                                                                                                |
| T5  | Malicious data in monitored repositories (crafted alert titles, tags, URLs, manifest)         | Text is scrubbed and truncated. Links must be `https` on allow-listed hosts (`github.com`), with no credentials, query or fragment. Contract files are Zod-validated. Astro escapes HTML. CSP blocks inline and third-party scripts.                                                                                                                                                                                                                                                                                         |
| T6  | "Zero alerts" read as "secure"                                                                | Coverage is a separate dimension. Unknown is never 0. 403 means Not authorised, and an ambiguous 404 means Unknown. Security is never green unless coverage is complete.                                                                                                                                                                                                                                                                                                                                                     |
| T7  | Over-privileged credentials                                                                   | GitHub App with read-only permissions, installed only on the monitored repositories. No write scopes anywhere in the collector.                                                                                                                                                                                                                                                                                                                                                                                              |
| T8  | Supply chain (actions, npm)                                                                   | Actions are pinned to full SHAs. Dependabot covers npm and actions. zizmor and Trivy run when enabled. `npm ci` uses the lockfile. Fonts are self-hosted, with no CDN. Each deploy publishes a CycloneDX SBOM (`/sbom.cdx.json`) and signed provenance + SBOM attestations of the exact bundle (`gh attestation verify site.tar -R <owner>/<repo>`, bundle in the `site-attested` artifact).                                                                                                                                 |
| T9  | The portal is used to change things                                                           | The collector only performs GET requests. It does not dismiss alerts, trigger workflows or write to repositories.                                                                                                                                                                                                                                                                                                                                                                                                            |
| T10 | A forged, oversized or misleading quality summary                                             | Only artifacts of runs on the default branch that come from the same repository are read (a fork pull request run is ignored). The zip is capped at 64 KB and only `quality-summary.json` is read. The summary is validated by a strict schema and must name the repository being read, otherwise it is `invalid` and nothing of it is published. Counts and percentages are recomputed from `lines` only.                                                                                                                   |
| T11 | A planted or tampered history artifact (a pull request or a fork writes a fake `hub-history`) | The restore step reads only the hub's own artifacts of the default branch from a different run, never a fork (`head_repository_id` must equal the repository id), at most 5 MiB, and only from a run of the deploy or collect workflow on an allowed event. The file is then parsed with a strict schema (8 MiB cap), every link is re-checked against the current host allowlist, text is re-scrubbed and the output passes the credential gate. Any failure starts history fresh and never fails or blocks the collection. |
| T12 | A formula injected through exported text (CSV injection)                                      | A text cell that starts with `=`, `+`, `-`, `@`, TAB or CR gets a leading `'`. The exports carry only statuses, counts, versions and ids, no titles. `scan:output` scans `.csv` files.                                                                                                                                                                                                                                                                                                                                       |

## Data published

- Repository names, visibility, default branch, archived flag, topics, latest commit SHA
  and link.
- Release and tag names, dates and links. Versions declared in the release manifest.
- Tracked workflow runs: id, number, attempt, status, conclusion, branch, event, SHA,
  timestamps, link, and the failed **job/step names** (never logs).
- Findings: identifier, category, normalised and original severity and status, rule or
  advisory id\*, sanitised title\*, repository, component, dates, fix available, GitHub
  link, tool, data classification.
- Control states per repository, counts reported by external scanners and their report
  links (allow-listed hosts only).
- Classified collection errors (repository, source, class, HTTP status, short scrubbed
  detail).
- Quality: per repository, the line counts (`covered`, `valid`) and the derived percentage,
  the commit SHA, the report date (ISO), the scrubbed tool identifier (at most 40
  characters), and a link to the GitHub Actions run (allow-listed host only). GitHub Code
  Quality: counts of open findings by category and by severity. Nothing else.
- History and changes: `history.json` keeps, per project and collection, the statuses, score, open counts and error counts, plus the open critical/high alerts of the latest run (id, severity, component, repository, link), the monitored repositories and the versions. `changes.json` lists new alerts (with the same title the snapshot publishes), resolved alerts (id and link only), status changes, version moves and error keys. Both are strict, sanitised and gated like the snapshot.
- Repository controls: per repository, the state of six checks (pass, fail, unknown, not applicable), the counts of workflow references (total, pinned, unpinned, unknown), the unpinned references (workflow file name, a `target` rebuilt from validated parts, and the `ref`, at most 20)\*, the reusable workflows with their referenced ref, the latest tag and a status (at most 20)\*, a summary of the branch rules (source, rule type names, required approvals) and an OpenSSF Scorecard summary (last analysis date, open alert count, failing check names). Nothing else.
- Discovery hints: only the three configured custom property keys and the matching topics, as short slug values, in the proposals of `catalog.json`.
- CSV exports (`exports/*.csv`): statuses, counts, versions and ids built from the same validated data. No titles, rule ids, paths or links.

\* Withheld for non-public repositories when `audience: public`.

## Data never published

Secret values or fragments, file paths and line numbers of secrets, file contents, code
snippets, commit contents, logs, HTTP headers, query strings, raw API payloads, stack
traces, environment variables, tokens, the App private key, workflow actors (not
collected), and anything outside the snapshot schemas.

For repository controls: workflow text, step names, `run:`, `with:` and `env:` values, expressions, raw rules payloads and every custom property other than the three configured keys (for example a property such as `cost-center` never reaches the output). Workflow files are untrusted input: they are read in memory, bounded (262 144 bytes per file, 200 references per file, 1 000 per repository, 30 files by default), parsed with an alias limit, and reduced to validated references before anything else happens.

For history and exports: no titles of resolved alerts, no raw payloads, no secret values and
no project that is no longer in the catalog (entries are pruned to the current catalog).

For the Quality dimension specifically: file paths and source code from coverage reports,
raw reports, the raw `quality-summary.json`, Code Quality finding messages, rule text and
file locations, and raw API payloads. Only counts, percentages, SHAs, ISO dates and
allow-listed `https://github.com/...` links are published.

## Authorisation model

- **Preferred: GitHub App**, installed only on the monitored repositories, with read-only
  repository permissions: **Metadata**, **Contents**, **Actions**, **Code scanning alerts**
  (`security_events`), **Dependabot alerts** (`vulnerability_alerts`) and **Secret
  scanning alerts** (`secret_scanning_alerts`). Deployments and Environments are not
  needed by the MVP (listing environments needs Actions: read). Permission names were
  checked against GitHub's
  [permissions-required-for-github-apps](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps)
  page on 2026-10-03.
- **Repository controls sources.** Checked on 2026-10-21 on GitHub's
  [permissions-required-for-fine-grained-personal-access-tokens](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens)
  page:

  | Data                                                      | Endpoint                                                 | Permission                                                         |
  | --------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------ |
  | Branch rules (rulesets)                                   | `GET /repos/{owner}/{repo}/rules/branches/{branch}`      | **Metadata: read**                                                 |
  | Custom property values of a repository                    | `GET /repos/{owner}/{repo}/properties/values`            | **Metadata: read**                                                 |
  | Workflow files                                            | Contents API (`.github/workflows`)                       | **Contents: read**                                                 |
  | Latest release and tags of a reusable workflow repository | releases and tags                                        | **Contents: read** / Metadata: read                                |
  | OpenSSF Scorecard analyses                                | code scanning analyses (tool `Scorecard`)                | **Code scanning alerts: read**                                     |
  | Classic branch protection (optional)                      | `GET /repos/{owner}/{repo}/branches/{branch}/protection` | **Administration: read**, off by default (`readClassicProtection`) |
  - The organisation-wide property endpoint (`GET /orgs/{org}/properties/values`) needs the organisation permission **Custom properties: read**, so it is **not used**.
  - The hub never calls a write endpoint, and never calls the classic protection endpoint unless `readClassicProtection: true`.
  - Observed meaning of `protected` on the branch call: GitHub documents it as "protected by branch protections or rulesets" for List branches; it was not verified against a live repository. A rule that the rules API does not report while `protected` is `true` is therefore `unknown`, never a fail and never a pass.
  - A 403 is `not-authorised`; an ambiguous 404 is `unknown`; a 404 on `.github/workflows` means no workflows. Referenced repositories that are not public are treated as not visible (and never published) unless `publication.audience: restricted`.

- **Quality sources** (test coverage summary and Code Quality). Checked on 2026-10-21 on
  GitHub's
  [permissions-required-for-github-apps](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps)
  page:
  - Listing and downloading artifacts (`GET /repos/{owner}/{repo}/actions/artifacts` and
    `.../{artifact_id}/{archive_format}`) need **Actions: read**, already granted. No new
    secret.
  - Listing Code Quality findings (`GET /repos/{owner}/{repo}/code-quality/findings`) needs
    the repository permission **Code quality: read**. The API key name is not documented
    on that page.
  - The setup endpoint (`GET /repos/{owner}/{repo}/code-quality/setup`) needs
    **Administration: write**, so the hub does not call it; a findings 404 is shown as
    unknown.
  - The REST reference pages of these endpoints state only classic-token scopes, not
    fine-grained permissions. The names above come from the GitHub App permissions page;
    re-check them on your own plan before you grant access.
  - Observed behaviour: a findings 403 is `not-authorised`, never "missing". A findings 404
    is ambiguous (Code Quality not enabled, or not visible), so the project's findings are
    `unknown`, never 0. A 403 or 404 whose message says Code Quality is not enabled skips
    that repository. More than 300 open findings (three pages) also make the count
    `unknown`, never an under-count. Like the other security endpoints, a 404, a "not
    enabled" answer or a page-cap hit still proves the permission works: the
    `codeQuality` capability is `available` when every findings call is usable,
    `partial` when only some are, `not-authorised` when none is and at least one answers
    403, and `unknown` when none is and none answers 403 (for example network errors
    only). Code Quality findings are informative: they never change the Quality status.
- **Fallback (MVP only): a fine-grained PAT** in `GH_READ_TOKEN`. Limit it to the monitored
  repositories, give it the same read-only permissions, and use a short expiry. It is tied
  to a person, so prefer the App.
- **`GITHUB_TOKEN`**: last resort. It can only read the current repository.
- There is no silent fallback between modes. The mode used is recorded in every snapshot
  (`run.authenticationMode`) and shown on the Data quality page.

## Least privilege in workflows

- Every workflow has a top-level `permissions: contents: read`.
- `collect`: `contents: read` and `actions: read`. `actions: read` is only used to list and download this repository's own `hub-history` artifacts with `GITHUB_TOKEN`; the collector credentials are not given to the restore step. The caller job in `deploy-pages.yml` has the same permission because a called workflow cannot exceed its caller. Secrets are mapped only into the collector step's `env`.
- `build`: `contents: read`, `pages: read` (configure-pages). No secrets.
- `deploy`: `pages: write` and `id-token: write`, only in the reusable deploy job.
- CI: no secrets. PR title lint needs `pull-requests: write` and `statuses: write`. SARIF
  uploads (zizmor, Trivy) need `security-events: write` on those jobs only.
- `persist-credentials: false` is set on checkout everywhere.

## Repository hardening (GitHub settings)

Applied on `massimilianolapuma/engineering-project-hub` (public repository). Re-check them
after any transfer or fork:

| Setting                                 | Value                                                                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Secret scanning + push protection       | Enabled: a committed credential is blocked at push time and alerted.                                                  |
| CodeQL (default setup)                  | `javascript-typescript` and `actions`, query suite `extended`.                                                        |
| Dependabot alerts + security updates    | Enabled.                                                                                                              |
| Private vulnerability reporting         | Enabled (see [SECURITY.md](../SECURITY.md)).                                                                          |
| Default `GITHUB_TOKEN` permissions      | Read-only; Actions cannot approve pull requests. Every workflow declares its own permissions.                         |
| Actions policy                          | Every action must be pinned to a full commit SHA (`sha_pinning_required`).                                            |
| Ruleset `main`                          | Pull request required, 7 required status checks, no deletion or force push; admin bypass only through a pull request. |
| Ruleset `release-tags` (`refs/tags/v*`) | No creation, update, deletion or force push except by organisation admins (releases).                                 |
| Merge strategy                          | Squash only; head branches deleted after merge.                                                                       |
| `github-pages` environment              | Deployments only from `main`.                                                                                         |
| Organisation                            | Two-factor authentication required for members (set in the organisation settings UI).                                 |

## Sanitisation

There is one central module, `collector/src/sanitizers/sanitize.ts`, with the shared
pattern list in `shared/security/patterns.ts`:

1. **Projection**: providers map responses onto minimal DTOs (allowlist). Unknown fields
   are dropped.
2. **Scrubbing** (`scrubText`) removes PEM blocks, code fences and inline code, stack
   frames, `Authorization`, `Cookie` and other header values, GitHub tokens (`gh*_`,
   `github_pat_`), `Bearer …`, `key=value` credentials, AWS and Slack keys, URL-embedded
   credentials, query strings and fragments, control characters and the exact values of
   environment credentials. It then truncates the result.
3. **Links** (`sanitizeUrl`) must be `https` on `publication.allowedLinkHosts`. Credentials,
   query and fragment are removed.
4. **Strict schemas**: the snapshot schemas are `.strict()`, so unknown keys fail the run.
5. **Gate** (`assertPublishable`): any pattern hit in a serialised file stops the run
   before writing. Only pattern names are reported, never values.
6. **Output scan** (`npm run scan:output`) re-checks the final `dist/` and `public/data/`,
   including `.csv` files and forbidden file types (`.env`, `.pem`, `.key`, `.npmrc`).
7. **Restored history** is untrusted input: provenance checks (own repository, default
   branch, not a fork, not the current run, allowed workflow and event), a 5 MiB artifact
   cap and an 8 MiB file cap, a strict parse, links re-sanitised against the current
   allowlist and text re-scrubbed. The collector version and the component and repository
   of each baseline alert must match strict patterns. A restored history that still fails
   the schema or the publication gate is set aside (state `unreadable`), so a planted file
   never blocks the snapshots. See [Operations](operations.md#history-between-runs).
8. **CSV injection**: a text cell that starts with `=`, `+`, `-`, `@`, TAB or CR gets a
   leading `'`. Numbers are never prefixed.

Tests use canary values (`ghp_exampleSecretValue`, `github_pat_exampleSecretValue`,
`Bearer example-token`, `PRIVATE KEY`, `password=example`). These live only in
`tests/helpers/canaries.ts` and never in fixtures that feed the published build.

## GitHub Pages risk and private repositories

GitHub Pages is static hosting. On most plans a Pages site is **public**, even when the
repository is private. Private (access-controlled) Pages need GitHub Enterprise Cloud.
**Check your actual plan.**

| Situation                                            | Recommendation                                                                                                                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Monitored repositories are public                    | `audience: public` is fine.                                                                                                                                                          |
| Some monitored repositories are private, Page public | Keep `audience: public` (details withheld). Remember that repository names, counts, states and versions are still published. If even that is confidential, do not use a public Page. |
| Real data behind a login (recommended)               | Cloudflare Pages + Access with a private deploy repository: [protected-hosting.md](protected-hosting.md). `audience: restricted`; HTTP security headers from `public/_headers`.      |
| Page access-controlled (private Pages)               | `audience: restricted` is acceptable. Everyone who can open the site sees every project's details, so the portal applies **no per-project or per-alert authorisation**.              |

**Restricted portal and sanitised view.** A restricted portal shows full sanitised detail
to an audience that is entitled to all monitored projects. A sanitised public or executive
view shows only aggregate states and counts. The MVP implements both through
`publication.audience`. Per-user authorisation is out of scope, because the links to GitHub
are where GitHub enforces each user's real permissions.

Never weaken sanitisation to "see more". Follow the GitHub link instead.

## Credential rotation

1. **GitHub App**: generate a new private key in the App settings, update the
   `GH_APP_PRIVATE_KEY` secret, run `deploy-pages.yml` manually to verify, then delete the
   old key.
2. **PAT** (`GH_READ_TOKEN`): create a new fine-grained token with the same scope, update
   the secret, verify, then revoke the old token. Rotate before it expires (90 days or
   less is recommended).
3. Check the Data quality page after rotation: the authentication mode is as expected and
   there are no new Not authorised entries.

## Response to accidental exposure

1. **Contain**: disable the Pages deployment (Settings → Pages) or deploy a known-good
   build. Cancel any running `deploy-pages` workflow.
2. **Revoke**: rotate the affected credential at once (see above). For a leaked secret
   found in a monitored repository, follow that repository's own incident process.
3. **Purge**: delete the workflow artifacts that hold the exposure (Actions → run →
   artifacts), and re-run the deploy so Pages serves clean content. CDN caches can take a
   few minutes to expire.
4. **Fix**: add the leaked pattern to `shared/security/patterns.ts` and a canary test.
   Find the field that bypassed the allowlist.
5. **Report**: follow [SECURITY.md](../SECURITY.md) and record a post-incident note.

## Known dependency advisory

`npm audit` reports a high advisory for `http-cache-semantics` (GHSA-ch52-4w7c-c8xp), used
by Astro's image cache. It affects shared HTTP caches in servers. The portal is a static
build with no runtime server and no remote images, so it is not exploitable here. Track the
upstream fix through Dependabot.

## Limitations

- No authorisation per alert or project inside the site. The site's audience is the Pages
  audience.
- No alerts does not mean no vulnerabilities. Coverage depends on the controls that are
  configured and on what the APIs return (up to 300 alerts per source and repository).
  Code Quality findings use the same 300 cap, but past it the repository's findings are
  unknown rather than under-counted.
- Results from external scanners are trusted as declared in
  `.security/project-security-status.json`. That file is not signed in the MVP (roadmap:
  attestations).
- Sanitisation is pattern-based on top of the allowlist. New credential formats may need
  new patterns.
