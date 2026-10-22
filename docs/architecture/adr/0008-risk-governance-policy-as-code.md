# ADR 0008: Risk governance as typed policy-as-code: exceptions in reviewed config, never GitHub dismissals, no OPA

- **Status:** Accepted
- **Date:** 2026-10-21
- **Italian version:** [docs/it/architecture/adr/0008-risk-governance-policy-as-code.md](../../it/architecture/adr/0008-risk-governance-policy-as-code.md)

## Context

The owner wants to accept known risks without hiding them, to see which alerts are late against a
remediation target, and to check a policy change before it reaches a collection. The hub is read-only
([ADR 0001](0001-static-first-github-native.md)), policies are typed YAML driven by Zod
([ADR 0004](0004-configuration-store-and-discovery.md)), and a project must not turn red overnight
because a new rule appeared ([ADR 0007](0007-repository-controls-informative-by-default.md)).

## Decision

1. **Exceptions live in reviewed config, never in GitHub dismissals.** `config/exceptions.yaml`
   (optional) holds owned, explained, time-boxed acceptances. The hub writes nothing to GitHub: the
   alert stays open there. An excepted finding keeps `status: open`; one helper, `countsAsOpen`, decides
   what is counted, so history never sees a fake "resolved" alert.
2. **A mandatory expiry.** `expires - created` is capped by `exceptions.maxDays` (180). An expired
   exception returns its findings to the counts and adds an amber Security reason by default.
3. **Narrow selectors.** `alert` for every source; `rule` (with an optional `tool`) for code
   scanning; `advisory` for Dependabot. Secret scanning accepts only `alert`.
4. **Unknown is not accepted.** An exception on a source that could not be read is `unverifiable`
   and accepts nothing. A stale exception (matching no open alert) is flagged.
5. **Remediation SLAs from the alert's creation time.** Days per class (critical 7, high 30, medium
   90, low 180, secret 7). An active exception pauses "overdue" but never resets the clock. An unknown
   age is never "within SLA".
6. **Never red by default.** Every overdue level defaults to `info`. The demo opts in for critical and
   high, and says so in a comment.
7. **Policy-as-code in TypeScript.** Zod is the validator, JSON Schema is generated from it and a test
   keeps them in sync. `npm run policy:check` validates, explains every decision with the policy key
   behind each reason, runs decision cases with the real engines, and can re-evaluate a snapshot
   read-only. A `policy-check` CI job runs it on every pull request.
8. **Withholding.** For non-public repositories under a public audience, the rule or advisory, tool,
   reason and ticket are published as `null`.
9. **Schema 1.6, history 1.2.** The snapshot gains exceptions, findings' `exception` and `sla`, and
   the risk summaries; history gains optional `risk` counts; `changes.json` gains `newlyOverdue` and
   `expiredExceptions` (additive, still `1.0`).

## Why not OPA / Rego

- **Weight.** OPA is a separate Go binary (tens of MB), or a WASM build plus a Rego compile step in
  CI. Both add a supply-chain surface and a toolchain to a project that has none today.
- **Two languages.** The health rules are already typed TypeScript driven by a Zod-validated YAML.
  Rego would duplicate them, or force a rewrite of every evaluator for no new capability.
- **What OPA would give** (schema validation, decision tests, explanations) is covered by Zod, the
  generated JSON Schema, the decision cases and the reason to policy-key explanations.
- **Revisit when** policies need arbitrary owner-written logic, for example conditions across
  dimensions per business unit. That would be a new ADR.

## Alternatives considered

- **Dismissing alerts on GitHub.** Rejected: it needs write permission, loses the owner, reason and
  expiry, and makes history see a "resolved" alert.
- **Exceptions without expiry.** Rejected: risk acceptances must be reviewed again.
- **SLA clock from the first time the hub saw the alert.** Rejected: wrong for older alerts and needs
  history that may not exist.
- **Enforced overdue by default.** Rejected: projects would change status on upgrade.

## Consequences

- Accepted findings are visible (listed apart, with owner, reason and expiry) but leave the counts and
  the status until the exception expires.
- A broad `rule` or `advisory` exception can accept future alerts: the horizon cap, the `matches`
  column and the optional `tool` limit that.
- The exceptions file says what a team accepts: real ones belong in a private configuration repository.
- The upgrade from snapshot 1.5 needs a new collection; history 1.0 and 1.1 are still read.
