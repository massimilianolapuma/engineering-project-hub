# Outputs: metrics, Grafana, executive summary

> 🇮🇹 [Versione italiana](it/outputs.md)

From v0.14.0 the hub turns the data it already publishes into three read-only outputs:

- a **Prometheus metrics file**, `data/metrics/hub.prom`, written by the collector next to the
  snapshot;
- a **Grafana dashboard** that reads those metrics;
- an **Executive summary** page, redacted so it can be printed or forwarded.

None of them writes anywhere: no push to Prometheus, no message to a chat or tracker.
Notifications (Microsoft Teams first) come in v0.15.0. Every output is on by default and can be
turned off in `config/policies.yaml` (`outputs`, see
[Configuration](configuration.md#outputs-outputs)).

## Metrics for Prometheus

### The file

The collector writes `metrics/hub.prom` in the
[Prometheus text format 0.0.4](https://prometheus.io/docs/instrumenting/exposition_formats/),
after the snapshots, through the same publication gate (a file that matches a credential pattern
is never written). The site serves it at `<base>/data/metrics/hub.prom`. The collection report
says how many series it holds: `| Metrics | written 228 series (19.9 KB) |`, or `off`.

Rules:

- **Gauges only, no timestamps.** The file changes once per collection (every 6 hours by
  default). `hub_collection_timestamp_seconds` says when the data was collected.
- **Unknown is never 0.** When a value could not be measured, its series is left out and
  `hub_project_measure_known{project,measure}` is 0. Never read a missing series as 0.
- **No repository, component, team, URL or error detail** in any label. The only per-project
  label is the catalog id (`project="project-alpha"`), which every page already shows.
- **Size cap** (`outputs.metrics.maxBytes`, default 4 MiB). Over it, the file drops the
  per-dimension statuses first, then keeps only the portfolio-level metrics, and sets
  `hub_metrics_truncated 1`. The collection never fails because of size.

### Metric families

| Metric                                  | Labels                                               | Value                                                                                   |
| --------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `hub_info`                              | `collector_version`, `data_source`, `schema_version` | 1                                                                                       |
| `hub_collection_timestamp_seconds`      |                                                      | when the data was collected (Unix seconds)                                              |
| `hub_collection_duration_seconds`       |                                                      | duration of the collection                                                              |
| `hub_projects`                          |                                                      | number of projects                                                                      |
| `hub_portfolio_projects`                | `status`                                             | projects per overall status (`green`, `amber`, `red`, `grey`)                           |
| `hub_project_status`                    | `project`, `status`                                  | 1 for the project's overall status, 0 for the other three                               |
| `hub_project_dimension_status`          | `project`, `dimension`, `status`                     | the same per dimension (`coverage` = security controls coverage)                        |
| `hub_project_score`                     | `project`                                            | score 0–100                                                                             |
| `hub_project_open_alerts`               | `project`, `severity`                                | open alerts per severity (`critical`, `high`, `medium`, `low`)                          |
| `hub_project_open_alerts_complete`      | `project`                                            | 1 when the counts are complete, 0 when they are a lower bound                           |
| `hub_project_overdue_alerts`            | `project`, `class`                                   | alerts past the remediation deadline (`all`, `critical_high`)                           |
| `hub_project_accepted_alerts`           | `project`                                            | open alerts under a valid exception                                                     |
| `hub_project_exception_issues`          | `project`                                            | exceptions that are expired, stale, unverifiable or invalid                             |
| `hub_project_repository_controls_ratio` | `project`                                            | share of repository checks passed (0–1)                                                 |
| `hub_project_supply_chain_repositories` | `project`                                            | repositories considered for supply-chain evidence                                       |
| `hub_project_sbom_available`            | `project`                                            | repositories with a readable SBOM                                                       |
| `hub_project_unsigned_images`           | `project`                                            | distinct images (by digest) without a verified signature                                |
| `hub_project_flagged_licenses`          | `project`                                            | packages with a flagged license                                                         |
| `hub_provider_enabled`                  | `provider`                                           | 1 when SonarQube, Harbor or Argo CD is enabled                                          |
| `hub_provider_state`                    | `provider`, `state`                                  | 1 for the provider's state (`off`, `available`, `partial`, `not-authorised`, `unknown`) |
| `hub_project_controls_coverage_ratio`   | `project`                                            | required security controls available (0–1)                                              |
| `hub_project_quality_coverage_ratio`    | `project`                                            | test line coverage (0–1)                                                                |
| `hub_project_collection_errors`         | `project`                                            | data sources that could not be read                                                     |
| `hub_project_measure_known`             | `project`, `measure`                                 | 1 when the measure was known, 0 when not                                                |
| `hub_metrics_truncated`                 |                                                      | 1 when the size cap applied                                                             |

### Reading it with Prometheus

Pick one of the two paths. Examples are in [`examples/prometheus/`](../examples/prometheus/).

**A. Prometheus scrapes the static host.** Use
[`scrape-static-host.yml`](../examples/prometheus/scrape-static-host.yml). Keep
`fallback_scrape_protocol: PrometheusText0.0.4`: Prometheus 3 refuses a response without a
`text/plain` content type, and GitHub Pages cannot set one for `.prom` files. Scraping every
15 minutes is plenty.

**B. node_exporter textfile collector.** Run
[`fetch-hub-metrics.sh`](../examples/prometheus/fetch-hub-metrics.sh) from cron or a systemd
timer. It downloads the file into the textfile directory and replaces the previous one only when
the download succeeds. node_exporter's own `node_textfile_mtime_seconds` says when the file last
changed.

### Metrics behind Cloudflare Access

On the protected hosting ([Protected hosting](protected-hosting.md)) the site is behind
Cloudflare Access. Give Prometheus its own credential that opens only the metrics:

1. In Zero Trust, create a **service token**.
2. Create a separate Access application for the path `<your-hub-host>/data/metrics/` with one
   policy whose action is **Service Auth** and whose rule is that service token. A rule on a more
   specific path overrides the site-wide application and inherits nothing from it.
3. Store the secret in a file Prometheus can read and use
   [`scrape-cloudflare-access.yml`](../examples/prometheus/scrape-cloudflare-access.yml) (headers
   `CF-Access-Client-Id` and `CF-Access-Client-Secret`).
4. Check that the token opens only the metrics:

   ```bash
   H1="CF-Access-Client-Id: <client-id>.access"
   H2="CF-Access-Client-Secret: $(cat /etc/prometheus/secrets/cf-access-client-secret)"
   curl -s -o /dev/null -w '%{http_code}\n' -H "$H1" -H "$H2" https://<your-hub-host>/data/metrics/hub.prom  # 200
   curl -s -o /dev/null -w '%{http_code}\n' -H "$H1" -H "$H2" https://<your-hub-host>/data/index.json        # 302 or 403
   ```

On Cloudflare Pages, `public/_headers` already serves `/data/metrics/*` as
`text/plain; version=0.0.4; charset=utf-8`.

### Example alerts

The hub ships no alert rules. Three expressions to start from:

- data too old (two missed collections): `time() - hub_collection_timestamp_seconds > 8 * 3600`;
- a project turned critical: `max by (project) (hub_project_status{status="red"}) == 1` for 1 h;
- alerts not visible for half a day: `hub_project_measure_known{measure="open_alerts"} == 0` for
  12 h.

## Grafana dashboard

[`examples/grafana/engineering-project-hub.json`](../examples/grafana/engineering-project-hub.json)
has ten panels: projects per status, data age, overdue critical or high alerts, projects per
status over time, score, open critical and high alerts, measures not visible, unsigned images,
SBOM coverage and provider states. A missing value shows "Not measured", never 0.

Import: **Dashboards → New → Import**, upload the file, then choose your Prometheus data source
in the **Data source** drop-down at the top of the dashboard. The file contains no data source
UID, so it also works with file provisioning (set the variable's default there). It uses the
classic dashboard JSON model (`schemaVersion` 41, Grafana 12); newer Grafana versions migrate it
on import.

## Executive summary

The page `executive/` ("Executive summary" in the navigation, after "What changed") is one page
to share with management:

- **Portfolio status:** projects that are Critical, need Attention, are Healthy or are Not visible.
- **Trend:** the same counts now, `trendDays` days ago (default 7) and at the start of the kept
  history, plus one sentence ("Critical projects: 0 → 2 since 3 Jan 2026.").
- **Top risks:** up to `topRisks` projects (default 5), critical first, each with up to three
  fixed sentences ("≥ 1 critical security alert open.") and whether it got worse or better since
  the last collection.
- **Remediation deadlines and exceptions** and **Supply chain:** portfolio totals.

What it never shows, in either audience: repository names, component ids, alert titles, image,
package or license names, team names and links to GitHub or any other source system. Links point
only to the hub's own pages. **Project names stay**: if they are confidential, do not forward the
page outside the people who can open the hub.

An unknown count is never 0: the page says "not measured", or "≥ n" when only some projects could
be read.

**Per team.** Add `?team=` to the address, as on the Portfolio
(`executive/?team=pay-project-alpha-dev&team=platform`). The page recomputes the counts, the
trend and the risks for those teams' projects and says "Filtered by team: 2 of 4 projects", without
printing the teams. It only filters what is shown; it does not restrict who can see the page
([ADR 0010](architecture/adr/0010-per-team-views-without-access-control.md)).

**Print or PDF.** Use the browser's print command: the navigation, the run bar and the links are
hidden, the page is printed light on A4.

Turn the page off with `outputs.executive.enabled: false`: no page and no navigation entry.

## Sources (checked 2026-11-04)

- Prometheus 3 strict content type and `fallback_scrape_protocol`:
  [Prometheus configuration](https://prometheus.io/docs/prometheus/latest/configuration/configuration/),
  [Prometheus 3 migration notes as summarised by New Relic](https://docs.newrelic.com/docs/infrastructure/prometheus-integrations/migrations/v2-upgrade/).
- node_exporter textfile collector:
  [node_exporter README](https://github.com/prometheus/node_exporter#textfile-collector).
- Cloudflare Access: more specific paths override, nothing inherited:
  [Application paths](https://developers.cloudflare.com/cloudflare-one/policies/access/app-paths/);
  [Service tokens](https://developers.cloudflare.com/cloudflare-one/identity/service-tokens/).
- Grafana import and the dashboard JSON model:
  [Import dashboards](https://grafana.com/docs/grafana/latest/dashboards/build-dashboards/import-dashboards/).
