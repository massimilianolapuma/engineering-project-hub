# ADR 0012: Optional read-only external providers behind one audited HTTP client

- **Status:** Accepted
- **Date:** 2026-11-03
- **Italian version:** [docs/it/architecture/adr/0012-optional-external-read-only-providers.md](../../it/architecture/adr/0012-optional-external-read-only-providers.md)

## Context

Until now the collector talked to one host: the GitHub API. Teams also run SonarQube (quality
gates and coverage), Harbor (images, scans and signatures) and Argo CD (what is actually deployed
in each environment). Those answers fill real gaps: a repository without a coverage artifact, an
image scanned in the registry, an environment that is out of sync with Git. They also bring the
first non-GitHub hosts, three new credentials and data shaped by systems the hub does not control.

## Decision

1. **Off unless configured.** Providers live in an optional `<configDir>/providers.yaml`, never
   published. A missing file, or `enabled: false`, means the hub contacts no provider host. The
   mock source reads `fixtures/providers/providers.yaml` instead, which enables the three providers
   against synthetic fixtures.
2. **Credentials from the environment only.** `SONARQUBE_TOKEN`, `HARBOR_ROBOT_NAME` +
   `HARBOR_ROBOT_SECRET`, `ARGOCD_TOKEN`. They are mapped only into the Collect step and added to
   the output scanner's list of values that must never appear in the output. An enabled provider
   without its credential marks its items `not-authorised` and the run goes on; half a Harbor
   credential is a configuration error.
3. **One shared client.** Every provider goes through `collector/src/providers/external/http.ts`:
   `https` only, the exact host of the configured `baseUrl` (checked before each request), fixed
   path templates with every parameter encoded, redirects refused, a timeout, a 1 MiB streamed
   response cap, no logging and errors with a fixed message per class (never the body or the URL).
   Each provider has a concurrency of 2 and a per-run item cap (`maxItems`).
4. **Read-only projections.** SonarQube: measures and the last analysis of mapped project keys.
   Harbor: one artifact per mapped image reference, with scan overview and accessories. Argo CD: one
   application per mapped environment. Each response is reduced to a strict projection; nothing
   else is kept. The hub never starts a scan, a sync or an analysis.
5. **Mappings in the catalog.** `sonarProjectKey`, `sonarBranch`, `containerImages` and
   `argocdApplication` sit next to the components and environments they describe. They are names,
   never hosts or credentials, and are published with the catalog.
6. **Each provider feeds an existing view.** SonarQube is a Quality source
   (`policies.quality.sources`), Harbor a source of container scanning and artifact signature
   (ADR 0011), Argo CD the deployed version of an environment (declared version kept beside it).
   Out-of-sync, degraded and failed-gate reasons are informative by default.

## Alternatives considered

- **Each provider with its own HTTP code.** Rejected: three places to audit for host pinning,
  redirects and logging.
- **Base URLs in the catalog.** Rejected: hosts are infrastructure details that must not be
  published; the catalog is.
- **Argo CD and Harbor through their CLIs.** Rejected: extra binaries in the collect job and
  output that is harder to bound.

## Consequences

- New optional secrets in `collect-data.yml`; the docs give the minimum permissions for each.
- Data quality shows a Providers card (state and counts per provider) so a misconfigured provider
  is visible, never silent.
- Snapshot schema `1.8` publishes the provider states, Quality sources and gates, and environments
  with declared and deployed versions, sync and health.
- Adding another provider means a projection and a path template, not a new network path.
