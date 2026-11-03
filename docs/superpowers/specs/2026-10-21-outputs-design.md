# Outputs: Prometheus metrics, notifications, executive view — design

Italiano: [../../it/superpowers/specs/2026-10-21-outputs-design.md](../../it/superpowers/specs/2026-10-21-outputs-design.md)

Status: builder's design under the program spec, refreshed; **owner decisions taken 2026-11-03 (§10)** · Date: 2026-10-21, refreshed 2026-11-03 · Target release: **v0.14.0**

> **Update 2026-11-03: refreshed for v0.14.0 after v0.9.0–v0.13.0.** The roadmap moved on while this design waited: risk governance (v0.9.0, ADR 0008), the Primer restyle (v0.10.0, ADR 0009), team dashboards (v0.11.0, ADR 0010, snapshot 1.7), supply chain providers (v0.12.0, ADRs 0011–0012, snapshot 1.8) and status icons (v0.13.0) all shipped first. What changed here:
>
> - target **v0.14.0**, ADR **0013** (0011 and 0012 are taken), snapshot schema stays **1.8** (no bump unless the owner picks supply-chain notifications in §10, decision 2);
> - Warm Graphite → **Primer** (ADR 0009); status dots → **status icons** with the word;
> - the executive view is drawn in Claude Design (Primer) and **approved by the owner before any UI code** (it no longer "does not block");
> - the notifier's outward client is built on the **same audited HTTP core** as the external providers of ADR 0012 (host pinning, encoded templates, no redirects, capped reads, fixed errors), with a POST-only front end; it is still not importable from `collector/**`;
> - new content from the shipped data: supply-chain and risk-governance metrics, executive blocks and an expired-exceptions trigger (§5.3.2, §5.5.1, §5.6); provider states as metrics; teams (ADR 0010) handled as display data, never as access control;
> - every path, field name and golden number re-checked against `main` at v0.13.0 (`risk` is now always present with nullable counts; `sensitiveEnvValues` lives in `shared/security/patterns.ts`; the NAV order is in `src/lib/routes.ts`);
> - external facts in §1 and §9 were checked on 2026-10-21 and **not re-checked** on 2026-11-03: the plan re-checks them (notably the Azure DevOps global PAT end on 1 Dec 2026, now a month away);
> - a final section §10 lists the product decisions only the owner can take.

> **Release split (owner decisions 2026-11-03, §10).**
>
> - **v0.14.0 — read-only outputs:** Prometheus metrics (§5.3), Grafana dashboard (§5.4), executive view (§5.6) with `?team=` as a display filter (no team text printed, no team label in metrics), policies `outputs` block (`metrics`, `executive`), EN/IT docs. No ADR: nothing crosses a new trust boundary. The executive page is available in both audiences when `outputs.executive.enabled`.
> - **v0.15.0 — notifications (§5.5), Microsoft Teams only first:** D7, D8, D10, D11, D13 (the `shared/http/` move), D15 (`notifications.yaml`), D16 (ADR 0013), one digest per target for the whole portfolio, no supply-chain triggers. Jira and Azure DevOps (§5.5.4 renderers, D12) stay designed here and ship in a later release when needed. §5.5 stays the design of record for v0.15.0 and is re-checked before its plan.
> - Consequence: v0.14.0 has no schema bump (snapshot 1.8, history 1.2, `changes.json` 1.0 unchanged) and adds no secret.

Program spec: [2026-10-21-roadmap-program-design.md](2026-10-21-roadmap-program-design.md) (§2 constraints, §4 "v0.11.0 Outputs" — now v0.14.0 — and §5 anti-goals are binding). Every decision not fixed there is marked **(BC)** (builder's call).

Builds on what is on `main` at v0.13.0:

- v0.7.0 ([2026-10-21-history-trends-design.md](2026-10-21-history-trends-design.md)): `history.json`, `changes.json` (the notification source), `src/lib/trend.ts`, the CSV helpers, the `hub-history` artifact restore (`collector/src/history/select-artifact.ts`);
- v0.8.0 ([2026-10-21-repository-controls-design.md](2026-10-21-repository-controls-design.md)): snapshot 1.5, history 1.1, ADR 0007;
- v0.9.0 ([2026-10-21-risk-governance-design.md](2026-10-21-risk-governance-design.md)): snapshot 1.6, history 1.2, `ProjectSummary.risk`, `changes.projects[].newlyOverdue`, ADR 0008;
- v0.10.0 ([2026-11-02-primer-restyle-design.md](2026-11-02-primer-restyle-design.md)): Primer tokens and Octicons, ADR 0009;
- v0.11.0 ([2026-11-03-team-dashboards-design.md](2026-11-03-team-dashboards-design.md)): snapshot 1.7, `teams` (`org/slug`) on projects and index entries, the `?team=` Portfolio view, ADR 0010 (teams are not access control);
- v0.12.0 ([2026-10-21-supply-chain-providers-design.md](2026-10-21-supply-chain-providers-design.md)): snapshot 1.8, `ProjectSummary.supplyChain`, `run.providers`, the audited GET-only external HTTP client `collector/src/providers/external/http.ts`, ADRs 0011 and 0012;
- v0.13.0: status icons instead of status dots.

This release takes **ADR 0013**. It does **not** change the snapshot schema (stays 1.8), the history schema (stays 1.2) or `changes.json` (stays 1.0) (D1), unless the owner chooses supply-chain notifications (§10, decision 2), which needs `changes.json` 1.1.

## 1. Intent and why

Everything the hub knows lives in its own pages today. Three kinds of reader cannot use it there:

- **monitoring systems**, which want numbers they can scrape, graph and alert on (Prometheus, Grafana);
- **teams that work in a chat or a tracker**, who want to hear about a change when it happens, not when they remember to open the hub (Microsoft Teams, Jira, Azure DevOps);
- **executives**, who want one page they can read in a minute, print and forward, without repository names or links into systems they cannot open.

v0.14.0 adds these three outputs. They read only what the collector has already validated and published. The notifications are the **only outward writes** of the whole program, so they come last and are the most constrained part of this design.

Facts checked before deciding (2026-10-21, not re-checked on 2026-11-03; the plan re-checks them; sources in §9):

- **Microsoft Teams.** Office 365 connectors in Teams, the classic "Incoming Webhook" included, were retired: the final rollout ran 18–22 May 2026, after which connectors stop working. Microsoft's replacement is a **Workflows** (Power Automate) flow with the trigger "When a Teams webhook request is received". It accepts a POST whose body is a `message` with an `attachments` array of Adaptive Cards (`contentType: application/vnd.microsoft.card.adaptive`). The flow owner chooses who may call the trigger: "Anyone" (the URL with its signature is the credential, and no auth header may be sent) or tenant users (needs an OAuth token). Trigger URLs moved from `*.logic.azure.com` to `*.environment.api.powerplatform.com`; the old URLs stopped on 30 Nov 2025. Since 2 Jun 2026 the path may contain a scale-unit segment (`/direct/cu/20/workflows/…`). Messages are limited to about 28 KB. Teams renders Adaptive Cards up to version 1.5. Posting to private channels is not supported.
- **Jira Cloud.** `POST /rest/api/3/issue` creates an issue; `description` takes Atlassian Document Format (ADF). Response `201 { id, key, self }`; errors 400, 401, 403, 422. Classic OAuth scope `write:jira-work` (granular, beta: `write:issue:jira`, `write:comment:jira`, `write:comment.property:jira`, `write:attachment:jira`, `read:issue:jira`). Permissions: _Browse projects_ and _Create issues_ in the target project. Auth: HTTP Basic with the Atlassian account email and an API token. A token **with scopes** must be used through `https://api.atlassian.com/ex/jira/{cloudId}`; an unscoped token works against `https://<site>.atlassian.net`. Token lifetime 1–365 days.
- **Azure DevOps.** `POST https://dev.azure.com/{organization}/{project}/_apis/wit/workitems/${type}?api-version=7.1` with media type `application/json-patch+json`, a JSON Patch array (`op`, `path`, `value`), response `200` WorkItem. Scope `vso.work_write`. A PAT goes in an HTTP Basic header: Base64 of `:{PAT}` (empty user name). Microsoft recommends Microsoft Entra tokens over PATs; **global PATs stop working on 1 Dec 2026**, organisation-scoped PATs keep working.
- **Prometheus.** Text exposition format `text/plain; version=0.0.4`: lines end with `\n` including the last; one `# HELP` and one `# TYPE` per metric name, `TYPE` before the first sample; label values escape `\\`, `\"`, `\n`; sample timestamps are optional. **Prometheus 3 fails a scrape whose `Content-Type` is missing or unrecognised** unless the scrape config sets `fallback_scrape_protocol` (allowed: `PrometheusProto`, `OpenMetricsText0.0.1`, `OpenMetricsText1.0.0`, `PrometheusText0.0.4`, `PrometheusText1.0.0`). A scrape config can add request headers with `http_headers` (`values`, `secrets`, `files`).
- **node_exporter textfile collector.** `--collector.textfile.directory`; reads `*.prom`; atomic update by writing a temporary file and renaming it; "Timestamps are not supported".
- **Cloudflare Access service tokens.** A client sends `CF-Access-Client-Id` and `CF-Access-Client-Secret`; the Access policy action must be **Service Auth**.
- **actions/upload-artifact.** `overwrite: true` deletes an artifact of the same name in the run before uploading; without it, a second upload of the same name fails. `retention-days` 1–90.
- **In this codebase (checked on `main` at v0.13.0).** `publication.audience` is `public | restricted`. `public` withholds titles and rule ids of findings in non-public repositories; `restricted` means "the site is behind access control" and shows full detail. The collect job holds the only source credentials (ADR 0003): the GitHub App or token and, since v0.12.0, the optional `SONARQUBE_TOKEN`, `HARBOR_ROBOT_NAME`, `HARBOR_ROBOT_SECRET` and `ARGOCD_TOKEN`. `scripts/scan-output.ts` scans a fixed list of extensions (`TEXT_EXT`). The v0.7.0 restore script (`scripts/restore-history.ts`, `collector/src/history/select-artifact.ts`) selects the hub's own artifacts by name, branch, repository and trusted workflow path. `index.json` carries per project `teams` (`org/slug`, ADR 0010: display data, not access control), `supplyChain` (`repositories`, `sbomAvailable`, `unsignedImages`, `flagged`, each nullable), `risk` (`overdue`, `overdueCriticalHigh`, `accepted` nullable, `exceptionIssues`), `repositoryControls` and `openSecretAlerts`; `run.providers` holds the state of SonarQube, Harbor and Argo CD (enabled, state, item and error counts, never URLs). `changes.json` 1.0 carries per project `statusChanges`, `newFindings`, `newlyOverdue` and `expiredExceptions`, but no supply-chain change. Builds behind Cloudflare Access may show "signed in as" initials (`PUBLIC_IDENTITY_SOURCE`); nothing in the hub authorises per user.

## 2. Goals, non-goals, anti-goals

Goals

- A static Prometheus metrics file, published with the snapshots, that Prometheus can scrape from the static host or that node_exporter can serve; and a Grafana dashboard JSON that imports into any Grafana with a Prometheus data source.
- An opt-in notification job that posts a sanitised digest of significant changes (from `changes.json`) to Microsoft Teams, Jira and/or Azure DevOps. Dry-run by default, only on change, never twice for the same change set.
- One executive page (EN/IT): portfolio status counts, the trend, the top risks in plain words, remediation deadlines and exceptions when measured, a supply-chain line (SBOM coverage, unsigned images, flagged licenses) when measured; printable; no repository names or links into source systems.
- Docs for each output, including setup per target and every new secret.

Non-goals

- No Prometheus push (Pushgateway, remote write) and no `/metrics` server: the hub has no runtime.
- No Alertmanager rules shipped as code. The docs show two example alert expressions.
- No per-finding notification, no comment mode, no update or close of earlier issues/work items, no two-way sync.
- No Slack, e-mail or generic webhook target in this release.
- No Microsoft Entra / service principal authentication for Azure DevOps and no OAuth for Jira in this release (PAT and API token only; §8 risks).
- No Azure DevOps Server (on-premises) and no `*.visualstudio.com` URLs.
- No new snapshot field, no history change (unless §10 decision 2 adds supply-chain notifications).
- No per-user or per-team access control: a team view or a team-routed notification only filters what is shown or sent (ADR 0010).

Anti-goals (failure even if it "works")

- An unknown value exported as `0`, or a project with unknown counts shown as "0 alerts" on the executive page or in a notification.
- A notification sent from mock data, from a dry-run, without a compared basis, or twice for the same change set.
- A notification or the executive page containing a repository name, a component id, an alert id or title, an exception id, an image name or digest, a package or license name, a team reference (`org/slug`), a GitHub link, an error detail, a secret or a raw payload.
- A target credential visible to the collect, build or deploy job, printed in a log, or written to an artifact; or a source or provider credential (GitHub, SonarQube, Harbor, Argo CD) visible to the notify job.
- Any request to a host outside the target's allowlist, any request that is not the one documented POST, or any write to a monitored repository.
- A notification failure that blocks the site deployment.

## 3. Constraints (program spec §2, unchanged)

Read-only towards monitored repositories and sources; static-first; no commercial dependency; strict Zod allowlist on every published or sent field; sanitised text and links with a host allowlist; unknown ≠ zero; 403 ≠ no data; ambiguous 404 = unknown; EN + IT; mock data only in the public demo; Primer tokens and Octicons (ADR 0009), status always as icon + word (never by colour alone), WCAG 2.2 AA; UI designed in Claude Design and approved by the owner before UI code; never `npm run ci:build` / `collect:mock`; never port 4321 (e2e on 4377); podman only. No new runtime or dev dependency.

## 4. Decisions in short

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Why                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| D1  | No schema bump. The three outputs derive from `index.json`, `history.json` and `changes.json` (snapshot 1.8, history 1.2, changes 1.0) **(BC)**                                                                                                                                                                                                                                                                                                                                                                                  | Every value they need is already published and validated; a bump would force a re-collect for nothing                     |
| D2  | The collector writes `<out>/metrics/hub.prom` (served at `<base>/data/metrics/hub.prom`), text format 0.0.4, **gauges only, no sample timestamps, no repository or component label in any audience** **(BC)**                                                                                                                                                                                                                                                                                                                    | "Published with the snapshots" (program §4); textfile collector forbids timestamps; low cardinality and nothing to redact |
| D3  | Unknown is never 0: a numeric series is **omitted** when its value is unknown, and `hub_project_measure_known{project,measure}` says 0 or 1. Statuses are one-hot over `green\|amber\|red\|grey` (grey is a state, not a zero) **(BC)**                                                                                                                                                                                                                                                                                          | `absent()` alone is hard to alert on; an explicit 0/1 gauge is                                                            |
| D4  | Size cap `outputs.metrics.maxBytes` (default 4 MiB). Over the cap: drop the per-dimension family; still over: keep only portfolio-level families. `hub_metrics_truncated 1` either way, plus a collection report note **(BC)**                                                                                                                                                                                                                                                                                                   | Bounded file, deterministic degradation, never a failed collection                                                        |
| D5  | Two documented scrape paths: Prometheus scrapes the static host (with `fallback_scrape_protocol: PrometheusText0.0.4`, and on Cloudflare a `Content-Type` header plus an Access service token); or a cron job fetches the file into node_exporter's textfile directory **(BC)**                                                                                                                                                                                                                                                  | GitHub Pages cannot set `Content-Type` for `.prom`; Prometheus 3 rejects it without the fallback                          |
| D6  | Grafana dashboard `examples/grafana/engineering-project-hub.json`: data source chosen through a `datasource` template variable named `DS_PROMETHEUS`; panels use `${DS_PROMETHEUS}`; no hardcoded UID, no `__inputs` **(BC)**                                                                                                                                                                                                                                                                                                    | Works for both UI import and file provisioning (provisioning does not resolve `__inputs`)                                 |
| D7  | The notifier is a **separate program** (`notifier/`, `npm run notify`) run by a **separate job** in a separate reusable workflow `notify.yml`. Target secrets exist only in its "Notify" step. ESLint forbids `collector/**` and `src/**` from importing `notifier/**`, and `notifier/**` from importing `collector/**` **(BC, ADR 0013)**                                                                                                                                                                                       | Source credentials and target credentials never share a job or a code path                                                |
| D8  | Effective mode is **dry-run** unless all hold: `notifications.yaml` `mode: send`, repository variable `HUB_NOTIFICATIONS=send`, data source `github`, `changes.basis.state = compared`, `basis.synthetic = false`. Dry-run writes the exact payloads to files and uploads them as an artifact **(BC)**                                                                                                                                                                                                                           | Two independent opt-ins; mock or uncompared data can never reach a real channel                                           |
| D9  | The digest carries only project ids and names, statuses, scores, counts and links **to the hub itself**. Never repository names, component ids, alert ids or titles, GitHub links or error details, in any audience **(BC)**                                                                                                                                                                                                                                                                                                     | A chat channel or tracker is outside the hub's perimeter; the reader follows the link to the (protected) hub for detail   |
| D10 | Significance thresholds in config; defaults: overall worsened or became unknown, Security or Delivery worsened, ≥ 1 new critical alert, ≥ 1 newly overdue critical/high. Improvements are not a trigger **(BC)**                                                                                                                                                                                                                                                                                                                 | "Only on change" (program §4) means significant change, not every diff                                                    |
| D11 | De-dup key `changeSetKey` = first 16 hex of SHA-256 over `basis.previousCollectedAt` and the canonical list of significant items. A ledger artifact `hub-notify-ledger` (90 days) records `(target, key)` after each successful send. Ledger restore failure in send mode → nothing is sent **(BC)**                                                                                                                                                                                                                             | A re-run of the whole workflow recomputes the same diff with a new `generatedAt`; keying on content catches it            |
| D12 | Targets: **Teams** = Workflows webhook, Adaptive Card 1.5 in a `message` envelope; **Jira** = create one issue per change set (REST v3, ADF); **Azure DevOps** = create one work item per change set (7.1, JSON Patch). Comment mode is not offered **(BC)**                                                                                                                                                                                                                                                                     | One triageable item per change set, symmetric across trackers; thresholds keep the volume low                             |
| D13 | The outward client reuses the **audited HTTP core** of ADR 0012, moved from `collector/src/providers/external/http.ts` to `shared/http/` (host pinning, encoded path templates, `redirect: 'error'`, capped streamed read, fixed classified errors). Two front ends: `getJson` (collector, unchanged behaviour) and `postOnce` (notifier: POST only, `https:` only, per-target host allowlist, 20 s timeout, 64 KiB cap, response discarded except `id`/`key`, **no automatic retry**, never logs URL, headers or body) **(BC)** | One audited core instead of two; POST is not idempotent, so no retry                                                      |
| D14 | Executive page `executive/`: never repository names, component ids, alert titles or links into source systems, **in either audience**. Print CSS. Trend table from history. Top risks from fixed sentence templates. Overdue counts when `risk` is present, otherwise "not measured" **(BC)**                                                                                                                                                                                                                                    | Stricter than program §4 (see §5.1); one rule to test, whatever audience the owner picks                                  |
| D15 | Config: new `<configDir>/notifications.yaml` (never published; own Zod schema and JSON Schema); policies gain an optional `outputs` block (`metrics`, `executive`), policies `schemaVersion` stays `1.0` **(BC)**                                                                                                                                                                                                                                                                                                                | Target details are infrastructure; output toggles are policy                                                              |
| D16 | ADR 0013: "Outward notifications from a separate job, dry-run by default, digest without repository detail"                                                                                                                                                                                                                                                                                                                                                                                                                      | First write to an external system: a documented trust-boundary change                                                     |
| D17 | Supply chain, risk governance and providers become metrics and executive content from `index.json` only: per-project supply-chain counts, overdue/accepted/exception-issue counts, repository-controls ratio, one-hot provider states. Unknown stays unknown (series omitted, `measure_known` 0, "not measured" on the page) **(BC)**                                                                                                                                                                                            | The data is already published and validated; no schema bump                                                               |
| D18 | Teams (ADR 0010) are never a metric label, a digest field or an executive-page text by default: a team reference carries the GitHub organisation name. Per-team views or routing are owner decisions (§10, decisions 3 and 4) **(BC)**                                                                                                                                                                                                                                                                                           | Teams are display data, not access control; the org name may be internal                                                  |

## 5. Design

### 5.1 Audience and redaction (D9, D14)

Program §4 says: "no repository names when the publication audience is restricted". In this codebase `restricted` is the **full-detail** portal behind a login, and `public` is the world-readable one that already withholds private finding details but still publishes repository names (`security.md`).

The executive page and the notifications are the outputs most likely to **leave the perimeter**: printed to PDF, forwarded by e-mail, posted to a channel, copied into a ticket. So the builder applies the rule in its strictest form:

- **Executive page:** no repository names, component ids, alert ids or titles, and no links to GitHub or any other source system, in **either** audience. It links only to hub pages (screen only; print shows no URLs).
- **Notifications:** the same rule (D9). Links point only to `siteUrl` (the hub).
- **Metrics:** no repository or component label exists at all (D2). The `project` label is the catalog id, which every page already publishes.

Consequences: the rule of program §4 holds whatever the owner sets; tests check one invariant (no `github.com`, no `owner/repo` string of the catalog) instead of a matrix. The executive page states it in its lede: "Prepared for sharing: no repository names, alert titles or links to source systems."

Teams (ADR 0010) are not access control. A per-team executive page or a notification routed to one team's channel (if the owner chooses them, §10) only selects **which projects** are shown or sent; the content rule above is unchanged, and the team reference itself (`org/slug`) is never printed.

Project **names** stay: an executive needs to know which project. If project names are themselves confidential, the owner must not forward the page or enable notifications to a wider audience; the docs say so.

### 5.2 Policies `outputs` block (D15)

```yaml
outputs:
  metrics:
    enabled: true # false = no metrics/hub.prom
    maxBytes: 4194304 # 65 536–16 777 216; over the cap the file degrades (§5.3.4)
  executive:
    enabled: true # false = no executive page and no nav entry
    topRisks: 5 # 1–10 projects in "Top risks"
    trendDays: 7 # 1–90; the comparison column of the trend table
```

All keys optional; the defaults above apply when the block is omitted. `src/lib/policies.ts` exposes them to the site, like the other blocks.

### 5.3 Prometheus metrics (D2–D5)

#### 5.3.1 File and writer

- Pure renderer `renderMetrics(index: PortfolioIndex, policies: Policies): { text: string; series: number; truncated: 'none' | 'dimensions' | 'portfolio-only' }` in `collector/src/outputs/prometheus.ts`.
- `writeSnapshots` writes `metrics/hub.prom` after the snapshots, through the same `assertPublishable` gate. Disabled → no file.
- Written last and atomically (temp name + rename inside the output directory) so a reader never sees a half file.
- `scan-output.ts` adds `.prom` to `TEXT_EXT`.
- The collection report gets one line: `Metrics | written 182 series (11.4 KB)`, `written (truncated: dimensions)` or `off`.
- Encoding UTF-8, `\n` line ends, final newline, families in the fixed order of §5.3.2, series inside a family sorted by labels. Deterministic: the golden file is byte-stable.

#### 5.3.2 Metric families

All are `gauge`. Label values come from enums, the project id (catalog slug `^[a-z0-9][a-z0-9-]{0,62}$`) or the semver-checked collector version. They still go through the format's escaping (`\\`, `\"`, `\n`) as defence in depth.

| Metric                                  | Labels                                               | Value                                                                                                                                       | Unknown handling                   |
| --------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `hub_info`                              | `collector_version`, `data_source`, `schema_version` | 1                                                                                                                                           | n/a                                |
| `hub_collection_timestamp_seconds`      |                                                      | `index.generatedAt` as Unix seconds                                                                                                         | n/a                                |
| `hub_collection_duration_seconds`       |                                                      | `run.durationMs / 1000`                                                                                                                     | n/a                                |
| `hub_projects`                          |                                                      | number of projects                                                                                                                          | n/a                                |
| `hub_portfolio_projects`                | `status`                                             | projects per overall status (4 series, zeros allowed: a count is known)                                                                     | n/a                                |
| `hub_project_status`                    | `project`, `status`                                  | one-hot over green, amber, red, grey (4 series per project)                                                                                 | grey = 1                           |
| `hub_project_dimension_status`          | `project`, `dimension`, `status`                     | one-hot per dimension (6 × 4 per project)                                                                                                   | grey = 1                           |
| `hub_project_score`                     | `project`                                            | 0–100                                                                                                                                       | omitted when `score.value` is null |
| `hub_project_open_alerts`               | `project`, `severity`                                | open count, severities critical, high, medium, low                                                                                          | omitted when the count is null     |
| `hub_project_open_alerts_complete`      | `project`                                            | 1 when `countsComplete`, else 0                                                                                                             | n/a                                |
| `hub_project_overdue_alerts`            | `project`, `class`                                   | `risk.overdue` (`class="all"`) and `risk.overdueCriticalHigh` (`class="critical_high"`)                                                     | omitted when null                  |
| `hub_project_accepted_alerts`           | `project`                                            | `risk.accepted` (open alerts under a valid exception)                                                                                       | omitted when null                  |
| `hub_project_exception_issues`          | `project`                                            | `risk.exceptionIssues` (expired, stale, unverifiable or invalid exceptions)                                                                 | n/a                                |
| `hub_project_repository_controls_ratio` | `project`                                            | `repositoryControls.ratio / 100`                                                                                                            | omitted when null                  |
| `hub_project_supply_chain_repositories` | `project`                                            | `supplyChain.repositories`                                                                                                                  | omitted when null                  |
| `hub_project_sbom_available`            | `project`                                            | `supplyChain.sbomAvailable` (repositories with a readable SBOM)                                                                             | omitted when null                  |
| `hub_project_unsigned_images`           | `project`                                            | `supplyChain.unsignedImages` (distinct images, by digest)                                                                                   | omitted when null                  |
| `hub_project_flagged_licenses`          | `project`                                            | `supplyChain.flagged`                                                                                                                       | omitted when null                  |
| `hub_provider_enabled`                  | `provider`                                           | 1 when the provider is enabled in `providers.yaml` (`sonarqube`, `harbor`, `argocd`)                                                        | n/a                                |
| `hub_provider_state`                    | `provider`, `state`                                  | one-hot over the `ProviderState` enum (`run.providers`)                                                                                     | `unknown` = 1                      |
| `hub_project_controls_coverage_ratio`   | `project`                                            | `coverage.percentage / 100`                                                                                                                 | omitted when null                  |
| `hub_project_quality_coverage_ratio`    | `project`                                            | `quality.percentage / 100`                                                                                                                  | omitted when null                  |
| `hub_project_collection_errors`         | `project`                                            | `collectionErrorCount`                                                                                                                      | n/a                                |
| `hub_project_measure_known`             | `project`, `measure`                                 | 1 or 0 for `score`, `open_alerts`, `overdue_alerts`, `controls_coverage`, `quality_coverage`, `sbom`, `unsigned_images`, `flagged_licenses` | always present (that is its job)   |
| `hub_metrics_truncated`                 |                                                      | 0, or 1 when §5.3.4 applied                                                                                                                 | n/a                                |

- `open_alerts` is known when **all four** severity counts are non-null. A partly known set publishes the known severities and `measure_known` 0, and `open_alerts_complete` says whether counts are a lower bound.
- `dimension` values are the `DimensionSchema` values (`delivery`, `version`, `security`, `coverage`, `governance`, `quality`). The HELP text of `hub_project_dimension_status` says that `coverage` means **controls** coverage.
- Every family has a one-line English `# HELP` (metric metadata is not localised) and its `# TYPE gauge`.
- Cardinality per project: 4 + 24 + 1 + 4 + 1 + 2 + 1 + 1 + 1 + 1 + 1 + 4 + 1 + 8 = 54 series at most, plus at most 3 + 3 × (number of provider states) portfolio series. 500 projects ≈ 27 000 series ≈ 2.4 MB: the default `maxBytes` rises to 4 MiB (`outputs.metrics.maxBytes`, §5.2), so the truncation of §5.3.4 stays exceptional.
- No `team` label (D18). A per-team metric family is an owner decision (§10, decision 4).

Example (golden, abridged):

```text
# HELP hub_project_score Project score 0-100; series absent when the score could not be measured (see hub_project_measure_known).
# TYPE hub_project_score gauge
hub_project_score{project="project-alpha"} 78
hub_project_score{project="project-beta"} 40
# HELP hub_project_measure_known 1 when the measure was known in the last collection, 0 when it was not (never read a missing series as 0).
# TYPE hub_project_measure_known gauge
hub_project_measure_known{measure="score",project="project-gamma"} 0
```

#### 5.3.3 What the metrics never contain

Repository, component, environment, workflow, alert, exception, image, package, license, team or user labels; titles; URLs; error details; business unit (free text); provider base URLs. Anything not in the table above.

#### 5.3.4 Size cap

Render all families. If the byte length exceeds `maxBytes`, render again without `hub_project_dimension_status`. If it still exceeds, render only `hub_info`, `hub_collection_*`, `hub_projects`, `hub_portfolio_projects`, `hub_provider_*` and `hub_metrics_truncated`. Never fail the collection.

#### 5.3.5 How Prometheus reads it (docs, `examples/prometheus/`)

**A. Scrape the static host.** `examples/prometheus/scrape-static-host.yml`:

```yaml
scrape_configs:
  - job_name: engineering-project-hub
    scrape_interval: 15m # the file changes every 6 h; scraping more often adds nothing
    scheme: https
    metrics_path: /<base>/data/metrics/hub.prom
    fallback_scrape_protocol: PrometheusText0.0.4 # required on Prometheus 3 when the host sends no text/plain type
    static_configs:
      - targets: ['<owner>.github.io']
```

- GitHub Pages cannot set headers, so `fallback_scrape_protocol` is required.
- Cloudflare Pages: `public/_headers` gains a `/data/metrics/*` rule with `Content-Type: text/plain; version=0.0.4; charset=utf-8` (the existing `Cache-Control: no-store` for `/data/*` already applies).
- Cloudflare Access: create a **service token** and a separate Access application for the path `<host>/data/metrics/` whose policy action is **Service Auth** with that token, so the token opens only the metrics path. Prometheus sends it with:

  ```yaml
  http_headers:
    CF-Access-Client-Id:
      values: ['<client-id>.access']
    CF-Access-Client-Secret:
      files: ['/etc/prometheus/secrets/cf-access-client-secret']
  ```

  The builder verifies, on the docs at build time, that a path-scoped application takes precedence over the site-wide one, and records the result.

- Freshness: alert on `time() - hub_collection_timestamp_seconds > 8 * 3600` (two missed 6-hourly runs).

**B. node_exporter textfile collector.** `examples/prometheus/fetch-hub-metrics.sh` (POSIX sh, for cron or a systemd timer): `curl --fail --silent --show-error --max-time 30 [-H CF-Access-…]` into `hub.prom.$$` in the textfile directory, then `mv` to `hub.prom`. On failure it leaves the previous file and exits non-zero. The file has no timestamps, as the collector requires. node_exporter adds `node_textfile_mtime_seconds`, which shows when the file last changed; `hub_collection_timestamp_seconds` shows when the data was collected.

Example alerts in the docs (not shipped as rules):

- `max by (project) (hub_project_status{status="red"}) == 1` for 1 h;
- `hub_project_measure_known{measure="open_alerts"} == 0` for 12 h ("alerts not visible").

### 5.4 Grafana dashboard (D6)

`examples/grafana/engineering-project-hub.json`, schema of the current Grafana dashboard JSON model (`schemaVersion` set to what Grafana writes at build time; the builder records the Grafana version used to check it):

- Templating:
  - `DS_PROMETHEUS`: `type: datasource`, `query: prometheus`, label "Data source";
  - `project`: `type: query`, `datasource: { type: prometheus, uid: "${DS_PROMETHEUS}" }`, `query: label_values(hub_project_status, project)`, multi-select, include All.
- Panels (every `datasource` is `{ "type": "prometheus", "uid": "${DS_PROMETHEUS}" }`):
  1. Stat: projects per status — `hub_portfolio_projects` by `status`, value mappings with text, not colour alone.
  2. Time series: projects per status over time — `sum by (status) (hub_project_status{project=~"$project"})`.
  3. Time series: score — `hub_project_score{project=~"$project"}`, min 0, max 100, `spanNulls: false` (a missing score is a gap).
  4. Bar gauge: open critical and high — `hub_project_open_alerts{project=~"$project",severity=~"critical|high"}`.
  5. Table: not visible — `hub_project_measure_known{project=~"$project"} == 0`.
  6. Stat: overdue critical/high — `sum(hub_project_overdue_alerts{class="critical_high"})`, "No data" text "Not measured".
  7. Stat: data age — `time() - hub_collection_timestamp_seconds`, unit seconds, thresholds at 8 h.
  8. Bar gauge: unsigned images — `hub_project_unsigned_images{project=~"$project"}`, "No data" text "Not measured".
  9. Table: SBOM coverage — `hub_project_sbom_available / hub_project_supply_chain_repositories` per project.
  10. State timeline: provider states — `hub_provider_state == 1` by `provider`.
- Title "Engineering Project Hub", tags `engineering-hub`, `uid` `engineering-project-hub` (a dashboard UID, not a data source UID), `id: null`, no `version`.
- Import: Dashboards → New → Import → upload the file → choose the Prometheus data source in the `DS_PROMETHEUS` drop-down after import (or set its default in provisioning).

### 5.5 Notifications

#### 5.5.1 Config `<configDir>/notifications.yaml` (D15)

Strict Zod `NotificationsConfigSchema` in `shared/model/notifications.ts`, JSON Schema `config/schema/notifications.schema.json` (generated). Missing file → notifications "not configured": the notifier writes a one-line summary and exits 0. The file is never published (it is not copied to the output directory).

```yaml
schemaVersion: '1.0'
mode: dry-run # dry-run | send. send also needs the repository variable HUB_NOTIFICATIONS=send
locale: en # en | it: language of the digest
siteUrl: null # e.g. https://hub.example.com/ — the only link host in a digest; https, no query or fragment
trigger:
  overallWorsened: true # green→amber, green/amber→red
  becameUnknown: true # overall to grey from a measured status
  dimensionsWorsened: [security, delivery] # dimensions whose worsening is significant; [] = none
  newFindings: { severities: [critical], min: 1 } # severities: critical | high
  newlyOverdue: { severities: [critical, high], min: 1 } # v0.9.0 field; ignored when absent
  newErrors: { min: 0 } # 0 = new collection errors never trigger
  expiredExceptions: { min: 1 } # changes.projects[].expiredExceptions (v0.9.0); 0 = never
digest:
  maxProjects: 10 # 1–50; the rest is counted as "N more projects"
targets:
  teams:
    enabled: false
    allowedHostSuffixes: ['.environment.api.powerplatform.com'] # sovereign clouds add theirs
  jira:
    enabled: false
    baseUrl: https://example.atlassian.net # or https://api.atlassian.com/ex/jira/<cloudId> for a scoped token
    projectKey: OPS # ^[A-Z][A-Z0-9_]{1,9}$
    issueType: Task # issue type name, ≤ 60 chars
    labels: [engineering-hub] # ^[A-Za-z0-9_.-]{1,50}$, ≤ 5
  azureDevOps:
    enabled: false
    organization: example-org # ^[A-Za-z0-9][A-Za-z0-9-]{0,49}$
    project: Platform Ops # ≤ 64 chars, no control characters
    workItemType: Task # ≤ 60 chars, letters, digits, spaces
    areaPath: null # optional, ≤ 256 chars
    tags: [engineering-hub] # ^[A-Za-z0-9 _.-]{1,40}$, ≤ 5
```

- `jira.baseUrl` must be `https://<name>.atlassian.net` (no path) or `https://api.atlassian.com/ex/jira/<cloudId>` (UUID); anything else is a config error.
- The demo `config/notifications.yaml` ships with every target `enabled: false` and `mode: dry-run`.
- `validate:config` validates the file when present.
- Per-team routing (one channel or tracker project per team) is **not** in this schema: it is §10 decision 3. If the owner chooses it, `targets.*` gains an optional `routes: [{ teams: [org/slug, …], … }]` list, still with every credential in a secret.

#### 5.5.2 Secrets (only in the "Notify" step)

| Secret              | Target       | Content                                                                                                       | Least privilege                                                                                                                              |
| ------------------- | ------------ | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `TEAMS_WEBHOOK_URL` | Teams        | The Workflows trigger URL. Its `sig` parameter is the credential                                              | One flow per channel, created from "Send webhook alerts to a channel"; "Who can trigger": **Anyone** (the URL is the secret) or tenant users |
| `JIRA_EMAIL`        | Jira         | Atlassian account e-mail (treated as a secret: personal data)                                                 | A dedicated (service) account                                                                                                                |
| `JIRA_API_TOKEN`    | Jira         | API token, preferably **scoped** (`write:jira-work`, or the granular set in §1), expiry ≤ 365 days            | _Browse projects_ + _Create issues_ in `projectKey` only                                                                                     |
| `AZDO_PAT`          | Azure DevOps | **Organisation-scoped** PAT, scope **Work Items: Read & write** (`vso.work_write`), shortest practical expiry | Member of `project` only, with permission to create work items of `workItemType`                                                             |

- All four are added to `sensitiveEnvValues()` (`shared/security/patterns.ts`), so the publication gate, the notifier's own payload check and `scan-output` catch a leaked value.
- Stored as repository (or `notifications` environment) secrets; mapped **only** into the Notify step's `env`, never into `run:` text, never into the collect, build, attest or deploy jobs. Conversely, the notify job never receives the GitHub App key, `GH_READ_TOKEN` or the provider secrets.
- "Tenant users" Teams triggers need an OAuth token; the notifier does not support that in v0.14.0 (it sends no auth header to Teams). The docs say so and recommend "Anyone" with the URL kept as a secret.

#### 5.5.3 Significance and digest (D9, D10)

Pure `buildDigest(changes, index, config): Digest | null` in `notifier/src/digest.ts`:

- `null` when `changes.basis.state !== 'compared'`. The summary says why (`basis: none`, `restore-failed`, …).
- Per project, the **significant items**, in this order:
  - `overall`: `from → to` when worsened (`green < amber < red`) and `trigger.overallWorsened`, or when `to = grey` from a measured status and `trigger.becameUnknown`. From grey to anything is not a worsening;
  - `dimension:<d>`: same rule for each `d` in `trigger.dimensionsWorsened` (no "became unknown" for dimensions);
  - `newFindings:<sev>`: count of `newFindings` with that severity, when the sum over `trigger.newFindings.severities` ≥ `min`;
  - `newlyOverdue:<sev>`: same for `newlyOverdue` (field absent → none);
  - `newErrors`: count, when `newErrors.min > 0` and count ≥ min;
  - `expiredExceptions`: count of `expiredExceptions`, when `expiredExceptions.min > 0` and count ≥ min (field absent → none). The exception ids and repositories are never read.
- A project with no significant item is not in the digest. Improvements are never items.
- `Digest` (strict Zod, `notifier/src/model.ts`):

  ```ts
  {
    key: string,                    // /^[0-9a-f]{16}$/
    generatedAt: utcDate,           // changes.generatedAt
    previousCollectedAt: utcDate,
    locale: 'en' | 'it',
    siteUrl: httpsUrl | null,
    totals: { projects, overallWorsened, becameUnknown, newCritical, newHigh, newlyOverdue, newErrors, expiredExceptions }, // ints
    projects: Array<{               // max digest.maxProjects; worst current overall first, then id
      id: projectId,
      name: string ≤ 100,           // from index (catalog display name)
      overall: { from: HealthStatus | null, to: HealthStatus },
      score: { from: int | null, to: int | null },
      dimensions: Array<{ dimension: Dimension, from: HealthStatus, to: HealthStatus }>,
      newFindings: { critical: int, high: int },
      newlyOverdue: { critical: int, high: int },
      newErrors: int,
      expiredExceptions: int,
    }>,
    omittedProjects: int,
  }
  ```

- `key` (D11): SHA-256 (Node `crypto`) of the UTF-8 JSON of `{ previous: basis.previousCollectedAt, items: [[projectId, itemKind, detail], …] }` with items sorted, first 16 hex characters. `detail` is `from>to` for status items and the count for count items. `generatedAt` is **not** part of the key.
- Links: `{siteUrl}changes/` for `locale: en`, `{siteUrl}it/changes/` for `locale: it` (the site's locale prefix). No other URL is ever built.
- Nothing else from `changes.json` is read: alert ids, titles, repositories, URLs, error repositories and classifications, version strings never enter the digest.

#### 5.5.4 Renderers (pure, `notifier/src/render/*.ts`)

All visible strings come from the i18n catalogue (`notify.*` keys in `src/i18n/en.ts` and `it.ts`, parity-tested). Status words are always written ("Red (was Amber)"), never colour only. Text from config (project names) is escaped for the target format.

**Teams** (`teams.ts`): body

```json
{
  "type": "message",
  "attachments": [
    {
      "contentType": "application/vnd.microsoft.card.adaptive",
      "contentUrl": null,
      "content": {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "type": "AdaptiveCard",
        "version": "1.5",
        "body": [
          {
            "type": "TextBlock",
            "text": "Engineering hub: 2 projects need attention",
            "weight": "Bolder",
            "size": "Medium",
            "wrap": true
          },
          {
            "type": "TextBlock",
            "text": "Compared with the collection of 14 Jan 2026, 12:00 UTC",
            "isSubtle": true,
            "wrap": true
          },
          {
            "type": "Container",
            "items": [
              {
                "type": "TextBlock",
                "text": "Project Beta: Red (was Amber)",
                "weight": "Bolder",
                "wrap": true
              },
              {
                "type": "FactSet",
                "facts": [
                  {
                    "title": "Status changes",
                    "value": "Delivery Amber → Red · Security Amber → Red"
                  },
                  { "title": "New alerts", "value": "1 critical" },
                  { "title": "Score", "value": "58 → 40" }
                ]
              }
            ]
          }
        ],
        "actions": [
          {
            "type": "Action.OpenUrl",
            "title": "Open What changed",
            "url": "https://hub.example.com/changes/"
          }
        ]
      }
    }
  ]
}
```

- `actions` only when `siteUrl` is set. No `Action.Submit` (not supported by webhooks).
- Markdown characters in project names (`\ * _ [ ] ( ) # > ~ \``) are backslash-escaped; the builder checks the rendering in a real Teams channel during the manual check of Task 9 and records it.
- Body cap 24 576 bytes (below the ~28 KB message limit): projects are dropped from the end and counted in "N more projects" until it fits.

**Jira** (`jira.ts`): `POST {baseUrl}/rest/api/3/issue`, `Content-Type: application/json`, `Accept: application/json`:

```json
{
  "fields": {
    "project": { "key": "OPS" },
    "issuetype": { "name": "Task" },
    "summary": "Engineering hub: 2 projects need attention (14 Jan → 15 Jan 2026)",
    "labels": ["engineering-hub", "hub-cs-1a2b3c4d5e6f7a8b"],
    "description": {
      "type": "doc",
      "version": 1,
      "content": [
        {
          "type": "paragraph",
          "content": [
            { "type": "text", "text": "Compared with the collection of 14 Jan 2026, 12:00 UTC." }
          ]
        },
        {
          "type": "bulletList",
          "content": [
            {
              "type": "listItem",
              "content": [
                {
                  "type": "paragraph",
                  "content": [
                    {
                      "type": "text",
                      "text": "Project Beta: Red (was Amber). Delivery Amber → Red; Security Amber → Red. 1 new critical alert. Score 58 → 40."
                    }
                  ]
                }
              ]
            }
          ]
        },
        {
          "type": "paragraph",
          "content": [
            {
              "type": "text",
              "text": "Open What changed",
              "marks": [{ "type": "link", "attrs": { "href": "https://hub.example.com/changes/" } }]
            }
          ]
        },
        {
          "type": "paragraph",
          "content": [{ "type": "text", "text": "Change set 1a2b3c4d5e6f7a8b" }]
        }
      ]
    }
  }
}
```

- `summary` ≤ 255 characters. ADF text nodes carry plain text only (no markdown, so no escaping needed beyond JSON).
- The `hub-cs-<key>` label marks the issue for people searching it; the notifier never queries Jira (no read calls).
- Success = `201` with a body whose `key` matches `^[A-Z][A-Z0-9_]+-\d+$`; the key goes into the job summary (an issue key is not secret).

**Azure DevOps** (`azure-devops.ts`): `POST https://dev.azure.com/{organization}/{project}/_apis/wit/workitems/${type}?api-version=7.1`, `Content-Type: application/json-patch+json`; `organization`, `project` and `type` each `encodeURIComponent`-encoded, `$` literal before the type:

```json
[
  {
    "op": "add",
    "path": "/fields/System.Title",
    "value": "Engineering hub: 2 projects need attention (14 Jan → 15 Jan 2026)"
  },
  {
    "op": "add",
    "path": "/fields/System.Description",
    "value": "<p>Compared with …</p><ul><li>Project Beta: Red (was Amber). …</li></ul><p><a href=\"https://hub.example.com/changes/\">Open What changed</a></p><p>Change set 1a2b3c4d5e6f7a8b</p>"
  },
  {
    "op": "add",
    "path": "/fields/System.Tags",
    "value": "engineering-hub; hub-cs-1a2b3c4d5e6f7a8b"
  }
]
```

- `System.Description` is HTML: every text is HTML-escaped; only the fixed tags `p`, `ul`, `li`, `a href` are emitted, and `href` is only `siteUrl`-based.
- `/fields/System.AreaPath` is added when `areaPath` is set. `System.Title` ≤ 255 characters.
- Success = `200` with an integer `id`; the id goes into the job summary.

#### 5.5.5 Outward HTTP client (D13, `shared/http/` core + `notifier/src/http.ts`)

The ADR 0012 client (`collector/src/providers/external/http.ts`, `getJson`) already does what an outward client must: fixed path templates with every parameter encoded, host equal to the configured one, `redirect: 'error'`, a streamed read with a byte cap, fixed messages with a classification and never the URL, a header or the body. Its core (URL building and checks, the capped read from `collector/src/util/bounded-fetch.ts`, the error classification) moves to `shared/http/` with no behaviour change, proven by the existing external-client tests passing unchanged. The collector keeps `getJson` on top of it; the notifier adds `postOnce` on top of it. `notifier/**` imports `shared/http/**`, never `collector/**`.

`postOnce({ target, url, body, contentType, headers, allowed, timeoutSeconds = 20, fetch })`:

- Builds the URL from fixed templates (`URL` API), then checks: `protocol === 'https:'`, no username or password, host allowed for the target (Teams: ends with one of `allowedHostSuffixes`; Jira: equals the `baseUrl` host and the path starts with the `baseUrl` path; Azure DevOps: equals `dev.azure.com`). Failure → `{ outcome: 'refused', reason: 'host-not-allowed' }` without any request.
- `method: 'POST'` only (the type allows nothing else). `redirect: 'error'`, `AbortSignal.timeout`.
- Reads at most 64 KiB of the response, parses JSON only to extract `key` (Jira) or `id` (Azure DevOps), then drops it.
- Classification: 2xx expected → `sent`; 400 / 422 → `rejected`; 401 / 403 → `not-authorised`; 404 → `not-found`; 413 → `too-large`; 429 → `rate-limited`; other ≥ 400, network, timeout, redirect → `error`. Messages are fixed per class. URL, headers, request and response bodies are never logged or returned.
- **No retry.** A failed target is retried only by re-running the job; the ledger skips the targets already sent.
- `postOnce` is not exported to `collector/**` (ESLint boundary), and `getJson` is not exported to `notifier/**`: each program can only make its own kind of request.

#### 5.5.6 Mode, de-dup and the notifier run (D8, D11)

`npm run notify -- --snapshots <dir> --config <configDir> --out <dir> [--ledger <file>]`:

1. Load `notifications.yaml` (missing → "not configured", exit 0) and `index.json` + `changes.json` with the strict schemas (missing or invalid changes → "no change data", exit 0).
2. **Effective mode**: `send` only when config `mode: send`, env `HUB_NOTIFICATIONS=send`, env `DATA_SOURCE=github`, `index.run.dataSource = github`, `basis.state = compared` and `basis.synthetic = false`. Otherwise `dry-run`, and the summary names the first condition that failed (`mode-config`, `mode-variable`, `mock-data`, `not-compared`, `synthetic`).
3. `buildDigest`. `null` or no project → "no significant change", exit 0, nothing rendered.
4. Render the payload of **every** target in dry-run (enabled or not, so the owner can preview), of **enabled** targets in send mode.
5. Payload check: each serialised body goes through `findSecretPatterns` and `sensitiveEnvValues()`. A hit → that payload is not written and not sent; exit 1; the summary names the pattern, never the value.
6. Write `<out>/digest.json`, `<out>/teams.json`, `<out>/jira.json`, `<out>/azure-devops.json` (each `{ method, pathTemplate, body }`, no host for Teams, no credentials) and `<out>/summary.md`.
7. In send mode:
   - load the ledger (`--ledger`); `HUB_LEDGER_STATE=failed` → send nothing, exit 1 ("ledger unavailable: not sending to avoid duplicates");
   - for each enabled target in order Teams, Jira, Azure DevOps: if `(target, key)` is in the ledger → `skipped-duplicate`; if its secrets are missing → `not-configured` (exit 1 at the end); else `postOnce`. On `sent`, append `{ target, key, sentAt }` to the ledger;
   - write the ledger back (at most 200 entries, newest kept).
8. Write `summary.md` lines like `Teams | sent`, `Jira | sent OPS-42`, `Azure DevOps | skipped-duplicate`, `Mode | dry-run (mock-data)`, `Change set | 1a2b3c4d5e6f7a8b`, and append it to `$GITHUB_STEP_SUMMARY` when set. Exit 1 when any enabled target ended `refused`, `rejected`, `not-authorised`, `not-found`, `too-large`, `rate-limited`, `error` or `not-configured`.

Ledger file (`kind: 'hub-notify-ledger'`, `schemaVersion: '1.0'`, `entries: [{ target: 'teams'|'jira'|'azure-devops', key, sentAt }]`, strict, ≤ 200). It holds no URL, issue key or payload.

#### 5.5.7 Workflows (D7)

New reusable **`.github/workflows/notify.yml`** (`on: workflow_call`), job `notify`:

- inputs `artifact-name`, `data-source`, `mode` (the caller passes `vars.HUB_NOTIFICATIONS`); optional secrets `TEAMS_WEBHOOK_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `AZDO_PAT`;
- workflow-level `permissions: {}`; job `permissions: { contents: read, actions: read }` — `actions: read` only to list and download this repository's own `hub-notify-ledger` artifacts; `concurrency: { group: hub-notify, cancel-in-progress: false }`; `timeout-minutes: 10`;
- steps:
  1. checkout (`persist-credentials: false`), setup Node, `npm ci`;
  2. download the snapshots artifact into `.notify-in/` (same run);
  3. **Restore ledger** (only when `inputs.mode == 'send'`): env `GITHUB_TOKEN: ${{ github.token }}` only; `npm run --silent notify:restore-ledger -- --out .notify-ledger`; writes `state=restored|none|failed` to `$GITHUB_OUTPUT`; always exits 0;
  4. **Notify**: the **only** step with the four secrets in `env`, plus `HUB_NOTIFICATIONS`, `DATA_SOURCE`, `HUB_LEDGER_STATE` mapped from inputs and step outputs (never inlined in `run:`); runs `npm run notify -- --snapshots .notify-in --config config --out notify-out --ledger .notify-ledger/ledger.json`; writes `mode=send|dry-run` to `$GITHUB_OUTPUT`;
  5. `npm run scan:output -- notify-out` (`if: always()`);
  6. upload `notification-payloads` (`notify-out/`, retention 7 days, `if-no-files-found: ignore`);
  7. upload `hub-notify-ledger` (`.notify-ledger/ledger.json`, retention 90 days, `overwrite: true`) only when `steps.notify.outputs.mode == 'send'`.
- Ledger restore reuses the v0.7.0 selection rules (`candidateArtifacts`, `runIsTrusted`) generalised with an artifact `name` and an option to **include the current run** (a re-run attempt must see the ledger of the earlier attempt). Same caps: ≤ 5 MiB artifact, `readZipEntry(…, 'ledger.json', 1 MiB)`.

**`deploy-pages.yml`** gains:

```yaml
notify:
  name: Notify
  needs: [collect, deploy]
  if: ${{ vars.HUB_NOTIFICATIONS == 'dry-run' || vars.HUB_NOTIFICATIONS == 'send' }}
  permissions:
    contents: read
    actions: read
  uses: ./.github/workflows/notify.yml
  with:
    artifact-name: ${{ needs.collect.outputs.artifact-name }}
    data-source: ${{ needs.collect.outputs.data-source }}
    mode: ${{ vars.HUB_NOTIFICATIONS }}
  secrets:
    TEAMS_WEBHOOK_URL: ${{ secrets.TEAMS_WEBHOOK_URL }}
    JIRA_EMAIL: ${{ secrets.JIRA_EMAIL }}
    JIRA_API_TOKEN: ${{ secrets.JIRA_API_TOKEN }}
    AZDO_PAT: ${{ secrets.AZDO_PAT }}
```

- After `deploy`, so the "What changed" link in the digest points at the data it describes. Nothing depends on `notify`: a notification failure never blocks a deployment.
- The collect, build, attest and deploy jobs never receive the four secrets, and the notify job never receives the collect secrets (GitHub App, `GH_READ_TOKEN`, `SONARQUBE_TOKEN`, `HARBOR_ROBOT_*`, `ARGOCD_TOKEN`).
- **`rw-hub-cloudflare-deploy.yml`** (the protected, real-data path; jobs `verify`, `collect`, `build`, `deploy`) gains the same job after `deploy`, opt-in through a new input `notifications` (`''` default, `dry-run` or `send`) and the four optional secrets. It checks out the hub at the release tag verified by `verify` and the caller's config exactly as its `collect` job does. The example caller in `examples/protected-deploy/` shows the variable and the secrets commented out.
- `.gitignore`: `notify-out/`, `.notify-in/`, `.notify-ledger/`.

### 5.6 Executive view (D14)

Route `executive/` (`src/pages/[...lang]/executive.astro`, `PageKey 'executive'` in `src/lib/routes.ts`, with an entry in `NAV` after `changes` and an Octicon in `NAV_ICON`, e.g. `briefcase`). Nav label "Executive summary" / "Sintesi direzionale", placed after "What changed". Page title "Executive summary" / "Sintesi per la direzione". Hidden (no page, no nav entry) when `outputs.executive.enabled: false`.

Pure model `buildExecutiveView(index, history | null, changes | null, outputs, now)` in `src/lib/executive.ts`:

1. **Lede**: "Status of {n} projects at {date}." plus the redaction sentence of §5.1. A "Demo data" note when `run.dataSource = mock`; the existing stale banner when stale.
2. **Portfolio status**: four tiles in the order Red, Amber, Green, Not visible, each with the status icon, the word and the count. The counts sum to the number of projects.
3. **Trend** (from `history.json`): a table with rows Red, Amber, Green, Not visible, Projects and columns:
   - "Now ({date})": the latest entry;
   - "{trendDays} days ago ({date})": the newest entry whose `collectedAt ≤ now − trendDays`; none → cells "Not enough history";
   - "Start of history ({date})": the oldest entry.
   - A sentence under it, for example "Red projects: 0 → 2 since 8 Jan 2026." (`Projects` changes when projects were added later; the sentence never treats a missing project as green).
   - History missing or invalid → "No history yet." History off → "History is off."
4. **Top risks** (at most `topRisks`): projects with overall red, then grey, then amber; inside a group, more open critical first, then more open high, then lower score (null last), then id. Each item:
   - project name (link to its hub page on screen), status icon and word;
   - direction: "Worse since the last collection" when `changes` has an overall worsening for it, "Better since the last collection" when it improved, otherwise nothing;
   - up to three sentences from fixed templates, first matching kinds in this order:

     | Kind                   | Condition                                                      | EN template                                                                 |
     | ---------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------- |
     | `not-measurable`       | overall grey                                                   | "The status cannot be measured: no data source could be read."              |
     | `critical-open`        | `openCounts.critical > 0`                                      | "{n} critical security alert(s) open." (`≥ {n}` when counts are incomplete) |
     | `overdue`              | `risk.overdueCriticalHigh > 0`                                 | "{n} critical or high alert(s) past the remediation deadline."              |
     | `high-open`            | `openCounts.high > 0`                                          | "{n} high security alert(s) open."                                          |
     | `secrets`              | `openSecretAlerts > 0`                                         | "{n} exposed secret(s) reported."                                           |
     | `delivery-failing`     | delivery red                                                   | "Critical pipelines are failing."                                           |
     | `controls-missing`     | coverage red                                                   | "Required security controls are missing."                                   |
     | `versions-out-of-line` | version red                                                    | "Released versions are out of line."                                        |
     | `quality-low`          | quality red                                                    | "Test coverage is below the threshold."                                     |
     | `unsigned-images`      | `supplyChain.unsignedImages > 0`                               | "{n} container image(s) without a signature."                               |
     | `partly-visible`       | not grey and (`collectionErrorCount > 0` or `!countsComplete`) | "Part of the status cannot be seen: {n} data source(s) could not be read."  |

   - No repository, component, alert or link. Plural forms through the existing `{ one, other }` pattern.
   - No project in red, grey or amber → "No project needs attention."
5. **Remediation deadlines and exceptions** (v0.9.0): "Overdue alerts: {n}, of which critical or high: {m}, in {k} projects." and "Accepted under an exception: {a}; exceptions needing attention: {e}." Sums over projects where the value is known; "≥" when some are unknown; "Not measured (remediation deadlines are off or were not collected)." when every value is null.
6. **Supply chain** (v0.12.0): "SBOM on {s} of {r} repositories · {u} unsigned images · {f} flagged licenses", singular forms as on the Security page; each part "not measured" when every value is null, "≥" when some are unknown. No image, package or license name.
7. **Footer**: collection date, data source, link "How to read this page" (`how-to-read/#executive`).

Print (`@media print` in `src/styles/global.css`): hide header navigation, theme toggle, skip link and footer links; light tokens forced; black text on white; `@page { size: A4; margin: 15mm }`; tiles and risk items `break-inside: avoid`; links printed as plain text (no URL expansion); the trend table keeps its borders. No print button (no new script) **(BC)**.

Shared rules: Primer tokens (ADR 0009), status by Octicon + word + colour (the status icons of v0.13.0), tables with `<caption>` and `<th scope>`, WCAG 2.2 AA contrast (existing token contrast test).

**How to read** gains `#executive` "Executive summary" / "Sintesi direzionale": what each block means, the trend column rule, the risk ordering, that unknown counts are never 0, and the redaction rule.

**Data quality** gains one line in the run card: "Metrics for Prometheus: `data/metrics/hub.prom`" (link), or "off".

**Design-first** (standing owner rule): the executive page (screen light and dark, phone, and print) is drawn as artboards in the Claude Design canvas with the Primer Hub design system, and **the owner approves the mockups before any UI code is written**. After the build, the canvas and the design-system README are updated to match. No artifact link goes into the repository.

### 5.7 EN/IT strings (main ones; full list in the plan)

| Key                             | EN                                                                                  | IT                                                                                            |
| ------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `nav.executive`                 | Executive summary                                                                   | Sintesi direzionale                                                                           |
| `executive.title`               | Executive summary                                                                   | Sintesi per la direzione                                                                      |
| `executive.redaction`           | Prepared for sharing: no repository names, alert titles or links to source systems. | Pronta da condividere: nessun nome di repository, titolo di alert o link ai sistemi sorgente. |
| `executive.notVisible`          | Not visible                                                                         | Non visibile                                                                                  |
| `executive.trend.notEnough`     | Not enough history                                                                  | Storico insufficiente                                                                         |
| `executive.risks.none`          | No project needs attention.                                                         | Nessun progetto richiede attenzione.                                                          |
| `executive.overdue.notMeasured` | Not measured (remediation deadlines are off or were not collected).                 | Non misurato (le scadenze di rimedio sono disattivate o non sono state raccolte).             |
| `executive.supplyChain.title`   | Supply chain                                                                        | Catena di fornitura                                                                           |
| `executive.risk.unsignedImages` | {n} container image(s) without a signature.                                         | {n} immagine/i container senza firma.                                                         |
| `notify.title`                  | Engineering hub: {n} project(s) need attention                                      | Engineering hub: {n} progetto/i richiedono attenzione                                         |
| `notify.compared`               | Compared with the collection of {date}                                              | Confronto con la raccolta del {date}                                                          |
| `notify.statusWas`              | {to} (was {from})                                                                   | {to} (prima {from})                                                                           |
| `notify.openChanges`            | Open What changed                                                                   | Apri Cosa è cambiato                                                                          |
| `notify.more`                   | {n} more project(s)                                                                 | Altri {n} progetti                                                                            |

### 5.8 Mock data and goldens

No new fixture input: the outputs derive from the existing goldens (`GOLDEN_NOW = 2026-01-15T12:00:00.000Z`).

- `fixtures/snapshots/metrics/hub.prom` becomes a golden written by `npm run fixtures:update`. Expected values (re-read on `main` at v0.13.0; the builder re-reads the golden `index.json` at plan time and adapts the numbers, never the rules):
  - `hub_collection_timestamp_seconds 1768478400`;
  - `hub_portfolio_projects{status="red"} 2`, `amber 1`, `green 0`, `grey 1` (Beta and Platform red, Alpha amber, Gamma grey);
  - `hub_project_score{project="project-beta"} 40`; no `hub_project_score{project="project-gamma"}`; `hub_project_measure_known{measure="score",project="project-gamma"} 0`;
  - `hub_project_open_alerts{project="project-beta",severity="critical"} 1`; `hub_project_open_alerts_complete{project="project-beta"} 0`;
  - `hub_project_overdue_alerts{class="critical_high",project="platform"} 1`;
  - `hub_project_unsigned_images{project="project-beta"} 1`; `hub_project_flagged_licenses{project="platform"} 2`; no `hub_project_unsigned_images{project="project-gamma"}` (its CI summaries are unreadable, so the count is null);
  - one `hub_provider_state` series at 1 per provider (`sonarqube` partial, `harbor` available, `argocd` partial in the mock fixture);
  - no line contains `example-org/`.
- Golden digest from the golden `changes.json` with the default triggers: Beta (overall amber → red, Delivery and Security amber → red, 1 new critical) and Platform (overall and Security amber → red, 1 newly overdue high, 1 expired exception). Alpha's improvement is not an item. `totals = { projects: 2, overallWorsened: 2, becameUnknown: 0, newCritical: 1, newHigh: 0, newlyOverdue: 1, newErrors: 0, expiredExceptions: 1 }`. Effective mode `dry-run (mock-data)`.
- Executive golden: tiles Red 2, Amber 1, Green 0, Not visible 1; top risks in the order Beta, Platform, Gamma, Alpha.

## 6. Tests (summary; exact cases in the plan)

- **Unit, metrics:** format rules (HELP/TYPE once and before samples, final newline, escaping of `\`, `"`, newline), one-hot statuses, omitted unknown series and `measure_known` 0, partial counts, no repository label, determinism, the two truncation steps with a tiny `maxBytes`, a canary in a project name never reaches the file (rejected by the gate).
- **Unit, Grafana:** the JSON parses; every panel and target data source is `{ type: 'prometheus', uid: '${DS_PROMETHEUS}' }`; a `datasource` variable `DS_PROMETHEUS` exists; no other UID string; every `expr` uses only `hub_*` metrics that the renderer emits.
- **Unit, shared HTTP core:** the existing external-client tests pass unchanged after the move to `shared/http/`; `postOnce` refuses non-POST by type, non-https, userinfo, a host outside the target allowlist and an encoded `..` in a path parameter, all before any request.
- **Unit, supply-chain and risk metrics:** null counts omit their series and set `measure_known` 0; `hub_provider_state` is one-hot; no image, package, license, team or exception string reaches the file.
- **Unit, notifications:** config schema and defaults; significance rules (worsening, grey, improvements ignored, thresholds, absent `newlyOverdue`); key stability and sensitivity (same items → same key; different `previousCollectedAt` → different key; `generatedAt` ignored); digest has no repository or URL other than `siteUrl`; each renderer's exact shape, escaping, caps; mode resolution table; ledger skip and append; host allowlist refusals (http, other host, `@` userinfo, Teams `logic.azure.com`), `redirect: 'error'`, no retry, error classification, nothing logged (console spy) — all with an **injected `fetch`**, never a real endpoint.
- **Unit, workflows:** `notify.yml` and `deploy-pages.yml` parsed as YAML: secrets appear only in the Notify step env; `collect` never receives them; job permissions exactly `contents: read, actions: read`; `deploy` does not need `notify`.
- **Unit, executive:** counts, trend columns (with and without a `trendDays` point), risk ordering and sentences, "≥" for incomplete counts, overdue "not measured", the supply-chain line with null and singular counts, no team reference in the output.
- **Integration, collector:** golden `metrics/hub.prom`; `outputs.metrics.enabled: false` → no file; report line.
- **Integration, notifier:** on the golden snapshots, `npm run notify` writes the four payload files and `summary.md`, mode `dry-run (mock-data)`, no request (fetch spy), no `example-org/` in any payload.
- **Integration, site:** `/executive/` and `/it/executive/` render; no `github.com` and no catalog repository name in their HTML; print stylesheet present; How to read anchor; Data quality metrics link; `dist/data/metrics/hub.prom` exists.
- **e2e** (temp config, port 4377): nav to the executive page on desktop and Pixel 7; `page.emulateMedia({ media: 'print' })` hides the navigation.

## 7. Left to the builder

- Exact HELP wording, family order inside the fixed groups, Grafana panel layout.
- Executive page layout and tokens within `DESIGN.md`; the print stylesheet details.
- The exact escaping list for Teams markdown after checking the rendering.
- Whether the ledger restore lives in `scripts/restore-ledger.ts` or shares `scripts/restore-history.ts` with a flag (expected: a shared helper, two entry scripts).
- Wording polish of EN/IT strings, keeping the meaning of §5.7.

## 8. Risks

- **Workflows webhook is owned by a person.** The flow runs under its creator's account; if that account leaves, posting stops. The docs recommend a service account as the flow owner.
- **"Anyone" trigger.** Whoever has the URL can post to the channel. It is a secret like a password: rotate by deleting and re-creating the flow trigger.
- **Azure DevOps global PATs end on 1 Dec 2026** (checked 2026-10-21): the docs ask for an organisation-scoped PAT from the start; the plan re-checks the date.
- **PAT and API token are long-lived credentials.** Microsoft and Atlassian recommend Entra / OAuth. Expiry ≤ 90 days is advised; Entra workload identity for Azure DevOps is a next idea.
- **Lost notifications.** A failed send is not retried automatically (no duplicates by design); the next collection notifies only its own change set. The summary and the job status make the failure visible.
- **Path-scoped Access application.** The precedence of a path application over the site application must be checked on Cloudflare's docs at build time; until then the docs say "verify with `curl` that the service token opens only the metrics path".
- **Drift.** This refresh was checked against `main` at v0.13.0. Anything merged before the plan (file names, field names, the NAV order, golden numbers) is re-read at plan time: adapt to what is on `main`, keep the rules.
- **Moving the audited client.** Moving the ADR 0012 core to `shared/http/` touches security-sensitive code; the move is its own task, with the existing tests unchanged and green before any notifier code uses it.

## 9. Sources (checked 2026-10-21)

- Teams connectors retirement (final dates 18–22 May 2026; Workflows replacement): <https://devblogs.microsoft.com/microsoft365dev/retirement-of-office-365-connectors-within-microsoft-teams/>
- Create incoming webhooks with Workflows: <https://learn.microsoft.com/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook>
- Teams connector, "When a Teams webhook request is received" (body schema, Anyone vs tenant users, ~28 KB message limit, private channels): <https://learn.microsoft.com/connectors/teams/#microsoft-teams-webhook>
- Trigger URL move from `logic.azure.com` (30 Nov 2025) and scale-unit path (2 Jun 2026): <https://learn.microsoft.com/troubleshoot/power-platform/power-automate/flow-run-issues/triggers-troubleshoot>
- Power Automate domains (`*.api.powerplatform.com`): <https://learn.microsoft.com/power-automate/ip-address-configuration>
- Adaptive Card version per host (Teams 1.5): <https://learn.microsoft.com/adaptive-cards/resources/partners>; webhook actions supported: <https://learn.microsoft.com/microsoftteams/platform/webhooks-and-connectors/how-to/connectors-using>
- Jira REST v3 Create issue (OpenAPI `swagger-v3.v3.json`: `POST /rest/api/3/issue`, 201/400/401/403/422, scopes, permissions, ADF): <https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-post>
- Jira basic auth with API token: <https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/>
- Atlassian API tokens (scoped tokens via `api.atlassian.com/ex/jira/{cloudId}`, 1–365 days): <https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/>
- Azure DevOps Work Items – Create 7.1: <https://learn.microsoft.com/rest/api/azure/devops/wit/work-items/create?view=azure-devops-rest-7.1>
- Azure DevOps PAT (Basic `:{PAT}`, global PAT retirement 1 Dec 2026): <https://learn.microsoft.com/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate>
- Prometheus exposition formats: <https://prometheus.io/docs/instrumenting/exposition_formats/>
- Prometheus 3 migration (Content-Type strictness, `fallback_scrape_protocol`): <https://prometheus.io/docs/prometheus/latest/migration/>
- Prometheus scrape configuration (`fallback_scrape_protocol` values, `http_headers`): <https://prometheus.io/docs/prometheus/latest/configuration/configuration/>
- node_exporter textfile collector: <https://github.com/prometheus/node_exporter#textfile-collector>
- Cloudflare Access service tokens: <https://developers.cloudflare.com/cloudflare-one/identity/service-tokens/>
- Grafana import: <https://grafana.com/docs/grafana/latest/dashboards/build-dashboards/import-dashboards/>
- actions/upload-artifact (`overwrite`, retention 1–90): <https://github.com/actions/upload-artifact>

## 10. Owner decisions (2026-11-03)

The owner accepted every recommendation:

1. **Scope of v0.14.0: (b).** Metrics, Grafana and the executive view in v0.14.0 (no outward writes); notifications in v0.15.0 with their own review.
2. **Supply-chain notifications: (a) none.** Supply chain shows in metrics and on the executive page only; revisit after real data shows how noisy the counts are. `changes.json` stays 1.0.
3. **Per-team notification routing: (a).** One digest per target for the whole portfolio; per-team routes once teams are curated in the catalog.
4. **Per-team executive view: (b), page only.** The executive page honours `?team=` like the Portfolio (display filter, ADR 0010), never prints the team reference; no team label in metrics (D18 unchanged).
5. **Executive page audience: (a).** Available in both audiences when `outputs.executive.enabled`; the page is redacted in both (D14).
6. **Notification targets: (b) Microsoft Teams only first** (v0.15.0); Jira and Azure DevOps later.
