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
| T13 | A provider is pointed at another host (SSRF through mapped names or response data)            | One shared client for SonarQube, Harbor and Argo CD: `https` only, the URL is built from a fixed path template with every parameter encoded, and its host must equal the configured `baseUrl` host before any request. Redirects are refused, responses are capped at 1 MiB and read as a stream, requests time out. The SBOM download follows GitHub's redirect only to an `https` host in a code allowlist, without the Authorization header.                                                                              |
| T14 | Secrets or internal data leak from external APIs into the site                                | Each response is reduced to a strict projection (only the fields the hub needs) and the rest is dropped in memory. Text is scrubbed, base URLs are never published, errors carry a fixed message per class (never the body or the URL) and the client never logs. `SONARQUBE_TOKEN`, `HARBOR_ROBOT_NAME`, `HARBOR_ROBOT_SECRET` and `ARGOCD_TOKEN` are in the list of values `scan:output` and the publication gate search for.                                                                                              |
| T15 | Presence of a signature or attestation mistaken for verification                              | Evidence has three levels: `present` (it exists in GitHub or the registry), `verified` (CI verified it and reported it in `hub-supply-chain-summary`) and `reported` (scan results). The hub never verifies signatures itself and never upgrades `present` to `verified`. Unknown is never shown as unsigned. See [ADR 0011](architecture/adr/0011-supply-chain-evidence-github-native-and-ci-summaries.md).                                                                                                                 |

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
- Repository controls: per repository, the state of six checks (pass, fail, unknown, not applicable), the counts of workflow references (total, pinned, unpinned, unknown), the unpinned references (workflow file name, a `target` rebuilt from validated parts, and the `ref`, at most 20)\*, the reusable workflows with their referenced ref, the latest tag and a status (at most 20)\*, a summary of the branch rules (source, rule type names, required approvals) and an OpenSSF Scorecard summary (last analysis date, open alert count, names of the checks below the policy minimum)\*. Nothing else.
- Discovery hints: only the three configured custom property keys and the matching topics, as short slug values, in the proposals of `catalog.json`.
- Teams: the `org/slug` teams listed in the catalog (project snapshots, index, CSV). With team discovery (restricted audience only), `catalog.json` adds suggested team slugs with repository counts, the organisations read, the number of teams read and of secret teams skipped, and listed teams GitHub did not return.
- Supply chain: per repository, SBOM state, source, format and version, package count, packages without license, flagged count, the top license expressions with counts (custom licenses grouped as `LicenseRef-*`) and ecosystems with counts; for the latest release, the number of assets checked and how many have provenance or SBOM attestations; per image, the repository path without registry host, tag, digest, signature and provenance evidence and Harbor scan counts by severity; the CI summary state, date, commit SHA and run link; mapped code-scanning tool names and the names of other tools seen (at most 10).
- Providers: per provider, whether it is enabled and its run-level state; per Quality component, the source (`ci-summary` or `sonarqube`), quality gate and new-code coverage; per environment, the declared and deployed versions, Argo CD sync and health, a short revision and the deployed image versions per component. The provider mappings (`sonarProjectKey`, `containerImages`, `argocdApplication`) are part of the published catalog.
- CSV exports (`exports/*.csv`): statuses, counts, versions and ids built from the same validated data. No titles, rule ids, paths or links.

\* Withheld for non-public repositories when `audience: public` (for the Scorecard summary only the check names; their count stays).

## Data never published

Secret values or fragments, file paths and line numbers of secrets, file contents, code
snippets, commit contents, logs, HTTP headers, query strings, raw API payloads, stack
traces, environment variables, tokens, the App private key, workflow actors (not
collected), and anything outside the snapshot schemas.

For repository controls: workflow text, step names, `run:`, `with:` and `env:` values, expressions, raw rules payloads and every custom property other than the three configured keys (for example a property such as `cost-center` never reaches the output). Workflow files are untrusted input: they are read in memory, bounded (262 144 bytes per file, 200 references per file, 1 000 per repository, 30 files by default), parsed with an alias limit (a file that reuses an anchor more than about 100 times is unparsable, so its repository's pinning is unknown) and without printing YAML warnings, which would quote the source in the log, and reduced to validated references before anything else happens. An identifier longer than its published bound (a `target` over 200 characters; a `ref`, tag or workflow file name over 100) is dropped as unknown and never truncated, so a single hostile workflow file or tag cannot stop a publication.

For teams: team names, descriptions, members, member counts, parent teams, and anything about a secret team except that it was counted.

For the supply chain and the external providers: package names, license texts, `LicenseRef` names, attestation bundles and certificates, SBOM documents, ZAP request and response data, SonarQube issues, Harbor vulnerability lists and scanner names, Argo CD `repoURL`, destination and resources, the providers' base URLs and their credentials.

For history and exports: no titles of resolved alerts, no raw payloads, no secret values and
no project that is no longer in the catalog (entries are pruned to the current catalog).

For the Quality dimension specifically: file paths and source code from coverage reports,
raw reports, the raw `quality-summary.json`, Code Quality finding messages, rule text and
file locations, and raw API payloads. Only counts, percentages, SHAs, ISO dates and
allow-listed `https://github.com/...` links are published.

## Security exceptions

Exceptions (see [Configuration](configuration.md#security-exceptions-configexceptionsyaml)) add
**no permission and no write**: they are a layer in the hub's own reviewed config. **The hub never
dismisses, reopens or comments on an alert on GitHub.** The alert stays open there and the hub
only chooses what to count.

- **What is published** about an exception: its id, repository, source, selector (alert number,
  rule id or advisory id and optional tool), owner, reason, `created`, `expires`, ticket link, state,
  how many alerts it matches and their ids. Reason text is scrubbed and bounded; owner, rule and tool go
  through the identifier scrubber; the ticket link goes through the host allowlist
  (`publication.allowedLinkHosts`). The raw match keys (alert numbers beyond the ids, raw rule ids
  of withheld findings) never leave the collector.
- **What is withheld:** for a repository that is not public, with `publication.audience: public`,
  the selector rule or advisory, the tool, the reason and the ticket link are published as `null`
  (the UI says "Withheld"). The id, owner, dates, state and counts remain. An alert-number selector
  is only a number and stays.
- **Why this matters:** an exceptions file says what a team knowingly accepts. In a public
  repository keep only synthetic examples and put real exceptions in a **private configuration
  repository** (the deploy pattern in [ADR 0004](architecture/adr/0004-configuration-store-and-discovery.md)),
  reviewed by the owner (`/config/exceptions.yaml` has an explicit CODEOWNERS entry).
- **Remediation SLAs** use the alert's own creation time. Facts checked on 2026-10-21: the Octokit
  OpenAPI types mark `created_at` as required on code scanning and Dependabot alerts and as
  optional on secret scanning alerts ("the time that the alert was created, ISO 8601"). A missing
  value gives an unknown age, never "within SLA".
- Unreadable sources are never read as accepted: an exception on a source that could not be read
  is `unverifiable`.

## Authorisation model

- **Preferred: GitHub App**, installed only on the monitored repositories, with read-only
  repository permissions: **Metadata**, **Contents**, **Actions**, **Code scanning alerts**
  (`security_events`), **Dependabot alerts** (`vulnerability_alerts`) and **Secret
  scanning alerts** (`secret_scanning_alerts`). Add **Deployments: read** to read the
  [deployments ledger](deployments-ledger.md) (`github-deployments` signal); listing environments
  needs Actions: read. Permission names were
  checked against GitHub's
  [permissions-required-for-github-apps](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps)
  page on 2026-10-03.
- **Deployments ledger** ([ADR 0015](architecture/adr/0015-deployments-ledger.md),
  [docs](deployments-ledger.md)). The hub App needs **Deployments: read** to read the ledger. The
  writers use a separate GitHub App with only **Deployments: read and write** (one private key per
  line or external project; tokens narrowed to one repository and `deployments: write`; any key
  can address every repository the App is installed on, accepted by the owner). The bridge job has
  `contents: read` and `id-token: write` (Microsoft Entra federation to read Azure DevOps, no stored
  secret) and reads GitHub with the hub's read App. The declare job runs in the protected
  environment `deployments-declare` whose environment secrets hold the keys, and only for targets
  in a reviewed allowlist. Both write only with `mode: write` and `HUB_DEPLOYMENTS_BRIDGE=write`.
- **Control map sources** (only when the [control map](control-map.md) is published). All GET:
  GitHub environments of the coordinator (`GET /repos/{owner}/{repo}/environments`), commits of a
  versions-file path, the file at a commit, commit dates and releases (**Contents: read**), and the
  push protection status from the repository metadata (`security_and_analysis`, returned only to
  repository admins and organisation owners or security managers: the read-only App does not see it,
  so `secret-scanning` stays at level 3 at most). Details per reading:
  [Control map, Permissions](control-map.md#permissions). Without access a check reads **not visible** with the
  reason (`github-environments` collection error on a 403), never 0. Confirm the environments
  permission on GitHub's permissions page for your App before relying on it.
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

- **Team discovery** (optional, `teams.discovery`; off for `audience: public`). Checked on
  2026-11-03 on GitHub's
  [permissions-required-for-github-apps](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps)
  page:

  | Data                           | Endpoint                                  | Permission                     |
  | ------------------------------ | ----------------------------------------- | ------------------------------ |
  | Teams of an organisation       | `GET /orgs/{org}/teams`                   | organisation **Members: read** |
  | Repositories a team can access | `GET /orgs/{org}/teams/{team_slug}/repos` | organisation **Members: read** |
  - Members: read also allows listing team members; the hub never calls those endpoints. The team's access level comes from `role_name`, else from the `permissions` object of the repository list; without either it is unknown and never counts as write.
  - Without the permission, team discovery reports `not-authorised` and the run goes on.
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
- **Supply chain sources.** Checked on 2026-10-21 on GitHub's
  [permissions-required-for-github-apps](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps)
  page:

  | Data                                   | Endpoint                                                                                               | Permission                               |
  | -------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
  | SBOM export (opt-in)                   | `GET /repos/{owner}/{repo}/dependency-graph/sbom/generate-report`, then `.../sbom/fetch-report/{uuid}` | **Contents: read**                       |
  | Attestations of release-asset digests  | `GET /repos/{owner}/{repo}/attestations/{subject_digest}`                                              | **Attestations: read** (new)             |
  | Trivy, Checkov, ZAP and other analyses | `GET /repos/{owner}/{repo}/code-scanning/analyses?tool_name=…`                                         | **Code scanning alerts: read** (granted) |
  | `hub-supply-chain-summary` artifact    | artifacts list and download                                                                            | **Actions: read** (granted)              |
  - **Attestations: read** is new for the GitHub App and the fine-grained token. Without it,
    attestations are `not-authorised` and the run goes on.
  - **The SBOM export is the single "compute" call** ([ADR 0011](architecture/adr/0011-supply-chain-evidence-github-native-and-ci-summaries.md)):
    `generate-report` asks GitHub to build the report. It changes nothing in the repository, but
    it is not a plain read, so it is **off by default** and only sent when
    `supplyChain.sbom.dependencyGraph: true`. Without it the SBOM comes from the CI summary (or
    the status file), otherwise it is unknown.
  - **SBOM download host.** `fetch-report` answers with a redirect. The collector follows it only
    to an `https` host that is `githubusercontent.com`, `github.com` or one of their subdomains
    (`SBOM_DOWNLOAD_HOST_SUFFIXES`), without the Authorization header. Observed host: not yet
    observed; the allowlist fails closed.

- **Fallback (MVP only): a fine-grained PAT** in `GH_READ_TOKEN`. Limit it to the monitored
  repositories, give it the same read-only permissions, and use a short expiry. It is tied
  to a person, so prefer the App.
- **`GITHUB_TOKEN`**: last resort. It can only read the current repository.
- There is no silent fallback between modes. The mode used is recorded in every snapshot
  (`run.authenticationMode`) and shown on the Data quality page.

### External providers

Optional ([ADR 0012](architecture/adr/0012-optional-external-read-only-providers.md)); each is
off until enabled in `config/providers.yaml`. Use a credential that can only read, for this hub
only:

| Variable                                   | Credential                                                                                                                                                                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SONARQUBE_TOKEN`                          | User token of a dedicated SonarQube user with **Browse** on the mapped projects only. No Execute Analysis, no Administer.                                                                                                                                     |
| `HARBOR_ROBOT_NAME`, `HARBOR_ROBOT_SECRET` | A project robot account with **Read Artifact**, **Read Scan** and **List Accessory** only. Set an expiry.                                                                                                                                                     |
| `ARGOCD_TOKEN`                             | A local account with only `apiKey`, RBAC `p, role:hub-reader, applications, get, <project>/*, allow`, and a token with an expiry: `argocd account generate-token --account hub-reader --expires-in 2160h` (verify the flag on the installed Argo CD version). |

- Store them as repository or environment secrets. `collect-data.yml` maps them only into the
  Collect step's `env`, like the GitHub credentials; the build and deploy jobs never see them.
- Rotate them like the GitHub credentials (see [Credential rotation](#credential-rotation)): create
  the new one, update the secret, run the collection, revoke the old one.
- Calls are GETs only: SonarQube `/api/measures/component` and `/api/project_analyses/search`,
  Harbor `/api/v2.0/projects/{project}/repositories/{repository}/artifacts/{reference}`, Argo CD
  `/api/v1/applications/{name}`. The hub never starts a scan, an analysis or a sync.

## Least privilege in workflows

- Every workflow has a top-level `permissions: contents: read`.
- `collect`: `contents: read` and `actions: read`. `actions: read` is only used to list and download this repository's own `hub-history` artifacts with `GITHUB_TOKEN`; the collector credentials are not given to the restore step. The caller job in `deploy-pages.yml` has the same permission because a called workflow cannot exceed its caller. Secrets are mapped only into the collector step's `env`.
- `build`: `contents: read`, `pages: read` (configure-pages). No secrets.
- `notify` (opt-in, after `deploy`): `contents: read` and `actions: read` (its own `hub-notify-ledger` artifact). `TEAMS_WEBHOOK_URL` is mapped only into the "Notify" step; this job never receives the collector's credentials, and no other job receives the Teams URL ([ADR 0013](architecture/adr/0013-outward-notifications.md)). Every payload is checked for credential patterns and for the values of credentials in the environment before it is written or sent.
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

**Teams are not access control.** The Portfolio team filter (`?team=`) and the teams on a
project only change what a person looks at. Anyone who can open the site sees every project,
whatever team they belong to. Hiding projects per person would need a server component that
knows who the viewer is (see ADR 0010).

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
4. **Teams webhook** (`TEAMS_WEBHOOK_URL`): the URL is the credential. Delete and recreate the
   flow's trigger in Teams Workflows, update the secret, and check the next `notify` summary.

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
