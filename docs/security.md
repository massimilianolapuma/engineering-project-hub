# Security

> 🇮🇹 [Versione italiana](it/security.md) · Reporting a vulnerability: [SECURITY.md](../SECURITY.md)

## Threat model (summary)

| #   | Threat                                                                                | Mitigation                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | A credential (token, App private key) leaks into the static site                      | Secrets exist only in the `collect` job. The build and deploy jobs have none. The credential gate runs on snapshots, and `scan-output` scans `dist/` and `public/data/` for patterns and for the exact values of environment credentials. Octokit logging is disabled. |
| T2  | A secret scanning alert value or location is published                                | Alerts are requested with `hide_secret=true`. The DTO has no field for the value, location, file or commit. Only the secret _type_ name is kept.                                                                                                                       |
| T3  | A raw API payload, stack trace, header or env var is published                        | Allowlist: DTO projection, then strict Zod schemas that reject unknown keys. Error messages are classified and scrubbed (headers, stack frames, query strings, code removed).                                                                                          |
| T4  | Details of private repositories leak through a public Page                            | `publication.audience: public` (default) withholds titles and rule ids of findings in non-public repositories. Advice below on private Pages.                                                                                                                          |
| T5  | Malicious data in monitored repositories (crafted alert titles, tags, URLs, manifest) | Text is scrubbed and truncated. Links must be `https` on allow-listed hosts (`github.com`), with no credentials, query or fragment. Contract files are Zod-validated. Astro escapes HTML. CSP blocks inline and third-party scripts.                                   |
| T6  | "Zero alerts" read as "secure"                                                        | Coverage is a separate dimension. Unknown is never 0. 403 means Not authorised, and an ambiguous 404 means Unknown. Security is never green unless coverage is complete.                                                                                               |
| T7  | Over-privileged credentials                                                           | GitHub App with read-only permissions, installed only on the monitored repositories. No write scopes anywhere in the collector.                                                                                                                                        |
| T8  | Supply chain (actions, npm)                                                           | Actions are pinned to full SHAs. Dependabot covers npm and actions. zizmor and Trivy run when enabled. `npm ci` uses the lockfile. Fonts are self-hosted, with no CDN.                                                                                                 |
| T9  | The portal is used to change things                                                   | The collector only performs GET requests. It does not dismiss alerts, trigger workflows or write to repositories.                                                                                                                                                      |

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

\* Withheld for non-public repositories when `audience: public`.

## Data never published

Secret values or fragments, file paths and line numbers of secrets, file contents, code
snippets, commit contents, logs, HTTP headers, query strings, raw API payloads, stack
traces, environment variables, tokens, the App private key, workflow actors (not
collected), and anything outside the snapshot schemas.

## Authorisation model

- **Preferred: GitHub App**, installed only on the monitored repositories, with read-only
  repository permissions: **Metadata**, **Contents**, **Actions**, **Code scanning alerts**
  (`security_events`), **Dependabot alerts** (`vulnerability_alerts`) and **Secret
  scanning alerts** (`secret_scanning_alerts`). Deployments and Environments are not
  needed by the MVP (listing environments needs Actions: read). Permission names were
  checked against GitHub's
  [permissions-required-for-github-apps](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps)
  page on 2026-10-03.
- **Fallback (MVP only): a fine-grained PAT** in `GH_READ_TOKEN`. Limit it to the monitored
  repositories, give it the same read-only permissions, and use a short expiry. It is tied
  to a person, so prefer the App.
- **`GITHUB_TOKEN`**: last resort. It can only read the current repository.
- There is no silent fallback between modes. The mode used is recorded in every snapshot
  (`run.authenticationMode`) and shown on the Data quality page.

## Least privilege in workflows

- Every workflow has a top-level `permissions: contents: read`.
- `collect`: `contents: read`. Secrets are mapped only into the collector step's `env`.
- `build`: `contents: read`, `pages: read` (configure-pages). No secrets.
- `deploy`: `pages: write` and `id-token: write`, only in the reusable deploy job.
- CI: no secrets. PR title lint needs `pull-requests: write` and `statuses: write`. SARIF
  uploads (zizmor, Trivy) need `security-events: write` on those jobs only.
- `persist-credentials: false` is set on checkout everywhere.

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
   including forbidden file types (`.env`, `.pem`, `.key`, `.npmrc`).

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
- Results from external scanners are trusted as declared in
  `.security/project-security-status.json`. That file is not signed in the MVP (roadmap:
  attestations).
- Sanitisation is pattern-based on top of the allowlist. New credential formats may need
  new patterns.
