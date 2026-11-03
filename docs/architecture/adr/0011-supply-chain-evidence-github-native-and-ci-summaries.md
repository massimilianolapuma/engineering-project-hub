# ADR 0011: Supply-chain evidence from GitHub-native sources and CI summaries

- **Status:** Accepted
- **Date:** 2026-11-03
- **Italian version:** [docs/it/architecture/adr/0011-supply-chain-evidence-github-native-and-ci-summaries.md](../../it/architecture/adr/0011-supply-chain-evidence-github-native-and-ci-summaries.md)

## Context

Five of the eight controls in every project (container scanning, IaC scanning, DAST, SBOM and
artifact signature) could only be answered by the `.security/project-security-status.json` file
that each repository writes by hand. Most repositories never wrote it, so those controls showed as
"not configured" or unknown even when the evidence existed: an SBOM in GitHub's dependency graph,
attestations on release assets, Trivy, Checkov or ZAP results uploaded to code scanning, image
signatures verified in CI.

Two traps come with that evidence. "Signed" can mean that a signature **exists** or that someone
**verified** it against an identity, and only CI can do the second (it has the image digest, the
signing identity and the tools). And the dependency-graph SBOM is produced by an export that asks
GitHub to **run a job**, the first request in the hub that is not a plain read.

## Decision

1. **No new dimension.** The evidence feeds the existing controls (Security and Controls
   coverage). A `supplyChain` section on each project explains it: SBOM counts, license counts,
   release attestations, image signatures and provenance, CI summary state.
2. **Sources in order.** Each of the five controls is resolved from an ordered list of sources
   (`policies.supplyChain.precedence`): code scanning, the dependency-graph SBOM, attestations of
   the latest release's assets, the CI summary, Harbor (ADR 0012) and the status file. The first
   source with a definitive answer wins; the control records its `source` and `evidence`.
3. **Presence or CI verification, never the hub's own.** `present` means the signature or
   attestation exists in GitHub or the registry; `verified` means CI verified it with cosign or
   `gh attestation verify` and reported the result in the **`hub-supply-chain-summary`** artifact
   (`supply-chain-summary.json`, contract 1.0); `reported` means scan results reported by a tool.
   The hub never downloads bundles, never checks signatures and never trusts a "verified" it did
   not get from CI.
4. **The SBOM export is opt-in.** `supplyChain.sbom.dependencyGraph` defaults to `false`. With it
   on, the collector calls `generate-report` once per repository and run, then fetches the report
   it points to; this is the single exception to "GET only, triggers nothing". The download host
   is pinned to a code allowlist, the size is capped and only counts are kept. With it off, the
   SBOM comes from the CI summary, else the status file, else it is unknown.
5. **Counts only.** Package names, license texts, `LicenseRef` names, attestation bundles and
   certificates are never published. Custom licenses are grouped as `LicenseRef-*`.
6. **Trivy, Checkov and ZAP** are recognised by code-scanning tool name (and optional category
   prefix) and mapped to container scanning, IaC scanning and DAST. Their alerts stay ordinary
   findings with the `container`, `iac` or `dast` category, never counted twice.
7. **Informative by default.** Unsigned artifacts and flagged licenses add reasons at `info`
   unless the owner raises `supplyChain.levels`.

## Alternatives considered

- **Verify signatures in the hub** (cosign in the collector). Rejected: the collector would need
  registry credentials, the signing identities and network access to transparency logs, and a
  failed verification in the hub is indistinguishable from a broken setup.
- **The synchronous SBOM endpoint.** Rejected: GitHub is retiring it (13 Nov 2026) in favour of
  the asynchronous export.
- **SBOM export on by default.** Rejected: it is the only request that makes GitHub do work, so
  the owner opts in explicitly.
- **A seventh "Supply chain" dimension.** Rejected: it would show the same controls twice and
  move every score.

## Consequences

- The GitHub App gains **Attestations: read**. Contents, Actions and Code scanning alerts (already
  granted) cover the SBOM export, the CI summary and analyses by tool.
- Repositories can raise a control from "not configured" to `verified` by adding one CI job that
  writes the summary, with no hub change.
- Snapshot schema `1.8` carries `source` and `evidence` on controls and the `supplyChain` section;
  `supply-chain.csv` is a new export.
- "Unknown" stays different from "unsigned": a source that cannot be read never counts as missing.
