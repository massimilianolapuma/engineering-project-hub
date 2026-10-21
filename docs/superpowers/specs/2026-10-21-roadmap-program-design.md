# Roadmap program: from "prepared for" to shipped — design

Italiano: [../../it/superpowers/specs/2026-10-21-roadmap-program-design.md](../../it/superpowers/specs/2026-10-21-roadmap-program-design.md)

Status: owner asked to implement the whole README roadmap without further questions (2026-10-21); they review after delivery · Date: 2026-10-21

## 1. Intent

The README lists a roadmap of items the code is "prepared for but not implemented". The owner wants all of them shipped, then will use the hub and give feedback. Every scope and design decision below is the builder's call, recorded so the owner can check it.

## 2. Program-wide constraints (unchanged project rules)

- Read-only towards monitored repositories and every external system that is a **source**: GET only, no write, no dismiss, no trigger.
- Static-first: no runtime backend, no GitHub calls from the browser; everything is computed by the collector and published as sanitised JSON.
- No commercial dependency. Every new provider is **optional, off by default**, works with mock fixtures and without credentials, and fails to `unknown` / `not-authorised`, never to "healthy" or 0.
- Strict Zod allowlist on every published field; sanitised text and links; host allowlist for links.
- Unknown ≠ zero; 403 ≠ no data; ambiguous 404 = unknown.
- EN + IT for all docs and UI strings (i18n parity test).
- Mock data only in the public demo; synthetic names (Alpha, Beta, Gamma, Platform).
- Warm Graphite design tokens; status never by colour alone; WCAG 2.2 AA.
- Snapshot schema bumps once per release that changes it; older snapshots are not read.
- `npm run ci:build` / `collect:mock` overwrite `public/data` (the owner's real snapshot): never run them; use `npm run fixtures:update` and a temp output directory instead.
- Never use or kill port 4321; e2e on a temporary config with port 4377.
- Containers via podman only.

## 3. Decomposition and order (builder's call)

The roadmap is several independent projects. They ship one after another, each with its own spec, plan, branch, PR and minor release, because they share the snapshot schema and the i18n catalogue.

| Release | Theme                  | Roadmap items                                                                                                                                          | Why this order                                                                                         |
| ------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| v0.7.0  | History and change     | History and trends; "What changed since last collection"; CSV export                                                                                   | Highest value for a decision tool; every later dimension gains a trend for free                        |
| v0.8.0  | Repository controls    | Actions pinned to SHA; reusable workflow versions; branch protection / rulesets; repository scorecards; discovery through custom properties and topics | All GitHub-native, same permissions model; feeds Governance                                            |
| v0.9.0  | Risk governance        | Security exceptions with expiry; remediation SLAs; policy-as-code                                                                                      | Builds on findings already collected; needs history (v0.7.0) for "overdue since"                       |
| v0.10.0 | Supply chain providers | SBOM (CycloneDX / SPDX); Cosign signatures and attestations; Trivy, Checkov, ZAP; SonarQube; Harbor; Argo CD                                           | New optional providers behind `SourceProvider` / `ControlProvider`; largest surface, so after the core |
| v0.11.0 | Outputs                | Prometheus / Grafana; Azure DevOps, Jira and Microsoft Teams notifications; sanitised executive view                                                   | Consumes everything above; notifications are the only outward writes, so they come last                |

## 4. Direction per release (each gets its own detailed spec)

### v0.7.0 History and change

- The collector keeps a compact, bounded history (per project: overall status, score, per-dimension status, open finding counts; per run: timestamp and run metadata). No raw payloads.
- History persists between runs without new infrastructure: the collect workflow restores the previous `history` from the last successful run's snapshots artifact of the hub's own repository (Actions: read on itself) and the collector appends to it; locally it reads the existing output directory. A missing or unreadable history starts fresh and says so; it never invents past points.
- UI: a small trend (sparkline of score, status strip) per project and on the portfolio; a "What changed since last collection" page listing status changes, new and resolved critical/high findings, version moves, new collection errors.
- CSV export: static CSV files generated at build time (portfolio, findings summary, versions), linked from the pages. No client-side data fetching beyond what exists.

### v0.8.0 Repository controls

- From GitHub (read-only): workflow files already read → actions pinned to a full SHA or not; reusable workflow references and their versions vs the latest tag of the referenced repository; branch protection and rulesets on the default branch (`GET` rules for a branch).
- A "repository scorecard": per repository, a small set of named checks with pass / fail / unknown and a ratio; also reads OpenSSF Scorecard results when they reach code scanning (tool name).
- Discovery: propose catalog entries from repository custom properties and topics (configurable keys), still as proposals only.
- New checks feed the Governance dimension through policies, configurable and defaulting to informative where they would otherwise turn projects red overnight.

### v0.9.0 Risk governance

- Security exceptions: a reviewed config file listing accepted findings (repository, tool, rule or alert number), owner, reason and mandatory expiry. Active exceptions remove the finding from the status but stay visible; expired ones return and are flagged.
- Remediation SLAs: days per severity in policies; findings past their SLA are "overdue", shown with age; an overdue critical/high raises the status.
- Policy-as-code: policies and exceptions validated by JSON Schema, a `policy:check` command that evaluates the policies against fixtures and explains each decision, and a CI job that runs it on every change to `config/`.

### v0.10.0 Supply chain providers

- GitHub-native first: SBOM from the dependency graph SBOM export (`GET …/dependency-graph/sbom`, SPDX), summarised to counts; artifact attestations and signatures from the attestations API or a CI summary; Trivy / Checkov / ZAP as code-scanning tools (by tool name) and as required controls.
- Optional external providers, off by default, each with its own read-only credentials and mock fixtures: SonarQube (quality gate, coverage as a second Quality source), Harbor (image vulnerabilities and signatures), Argo CD (application sync / health and the deployed version per environment).

### v0.11.0 Outputs

- Prometheus: a static metrics file in text exposition format published with the snapshots; a Grafana dashboard JSON in `examples/`.
- Notifications: a separate opt-in workflow step that posts a sanitised digest of changes (from v0.7.0) to Microsoft Teams, Jira or Azure DevOps. Dry-run by default (writes the payload files), only on change, never includes secrets or raw payloads. It writes to the notification target only, never to monitored repositories.
- Executive view: one sanitised page (portfolio status, trend, top risks in plain words), no repository names when the publication audience is restricted.

## 5. Anti-goals for the whole program

- A provider that is not configured shown as healthy or as zero.
- Any write to a monitored repository or to a source system.
- A project turning red overnight only because a new check appeared (new checks start informative unless the owner opts in).
- History points that were never collected.
- Secrets, tokens, raw API payloads, file contents or personal data in snapshots, CSV, metrics or notifications.

## 6. Left to the builder

Everything not fixed above, in each release's own spec.
