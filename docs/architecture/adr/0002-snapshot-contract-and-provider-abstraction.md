# ADR 0002: Snapshot contract and provider abstraction

- **Status:** Accepted
- **Date:** 2026-10-03
- **Italian version:** [docs/it/architecture/adr/0002-snapshot-contract-and-provider-abstraction.md](../../it/architecture/adr/0002-snapshot-contract-and-provider-abstraction.md)

## Context

The site must not depend on GitHub API formats. More providers will follow (Harbor,
SonarQube, Trivy, ZAP, Argo CD, Azure DevOps…). Security data must be published from an
**allowlist**, not by filtering out what we know to be dangerous.

## Decision

- `shared/model/` defines the **only contract** between the collector and the site: Zod
  schemas and inferred types for the catalog, policies, external contracts (release
  manifest, security status file) and snapshots (`schemaVersion: "1.0"`).
- Every snapshot schema is **`.strict()`**. Unknown keys fail validation, which makes the
  schema the publication allowlist.
- Values are normalised (severity, status, category, control state), and the provider
  originals are kept (`originalSeverity`, `originalStatus`).
- **Unknown is modelled explicitly**: counts are `number | null`, controls have nine
  states, and errors are classified. Nothing defaults to 0.
- Providers implement `SourceProvider` and return `ProviderResult<T>`, which holds either
  data or a classified error and never throws. The MVP ships `GitHubProvider` and
  `MockProvider`. Non-GitHub security sources will implement `ControlProvider`. Until then
  their results come through the `.security/project-security-status.json` contract.
- Health is computed by pure evaluators from `policies.yaml`. Each status carries reason
  codes and parameters, which the site translates (EN/IT).
- The site re-validates snapshots at build time and rejects unsupported schema versions
  with a controlled error page.

## Consequences

- Positive: providers can be added without touching the site, golden snapshots make
  changes reviewable, and sanitisation is structural, not best-effort.
- Negative: adding a published field means a schema change, golden regeneration
  (`npm run fixtures:update`) and possibly a `schemaVersion` bump with site support.
- Versioning rule: additive, optional fields keep `1.x`. Removals or semantic changes need
  a new version listed in `SUPPORTED_SNAPSHOT_SCHEMA_VERSIONS`.
