# ADR 0007: Repository controls from workflow files and the rules API, informative by default

- **Status:** Accepted
- **Date:** 2026-10-21
- **Italian version:** [docs/it/architecture/adr/0007-repository-controls-informative-by-default.md](../../it/architecture/adr/0007-repository-controls-informative-by-default.md)

## Context

The owner wants to see whether each project's repositories follow basic supply-chain hygiene:
actions pinned to a commit SHA, reusable workflows up to date, a protected default branch, and an
OpenSSF Scorecard summary, plus discovery hints from custom properties and topics. The hub is
read-only and mostly uses permissions it already has ([ADR 0001](0001-static-first-github-native.md)),
and a project must not turn red overnight because a new check appeared.

## Decision

1. **Six named checks per repository, not a new dimension (D1, D2).** `actions-pinned`,
   `reusable-workflows-current`, `branch-protected`, `pull-request-required`,
   `force-push-blocked` and `status-checks-required` feed **Governance** through reasons. The
   portfolio gets no seventh bar.
2. **Informative by default.** Every check level is `info` in the policies: shown on the project
   page, never changing a status or the score. The owner opts in per check (`amber` or `red`);
   `unknownEnforcedCheck` defaults to `info`.
3. **Unknown is not fail.** A 403 is `not-authorised`, an ambiguous 404 is `unknown` (a 404 on the
   workflows directory means no workflows), and a rule absent from the rules API while the branch
   reports `protected: true` is `unknown` unless classic protection was read (D6).
4. **Data from existing permissions.** Branch rules and custom properties need Metadata: read,
   workflow files Contents: read, Scorecard analyses Code scanning alerts: read. Classic branch
   protection needs Administration: read, so it is off by default (`readClassicProtection`) and
   is never called while off. The organisation property endpoint (needs a new organisation
   permission) is not used.
5. **Workflow files are untrusted input.** Read through the Contents API, bounded, parsed in
   memory with an alias limit and reduced to validated `uses:` references in one module. Workflow
   text, step names, `run:`, `with:` and `env:` never leave it and are never published; published
   targets are rebuilt from validated parts and scrubbed.
6. **Private data stays private (D9).** With `publication.audience: public`, the unpinned
   references and the reusable-workflow targets of non-public repositories are withheld (counts
   stay), and a reusable-workflow repository that is not public is treated as not visible.
7. **Schema 1.5, history 1.1.** The snapshot gains `repositoryControls`; history gains optional
   counts and check states so "What changed" can list pass-to-fail moves. Older history is read.
8. **Discovery hints.** Only three configured property keys and two topic prefixes are read; every
   other property is dropped before storage. Hints can group repositories into a `grouped`
   proposal and suggest an existing project. Proposals stay proposals.

## Alternatives considered

- **A seventh dimension.** Rejected: more noise for a mostly informative signal.
- **Enforced by default.** Rejected: existing projects would change status on upgrade.
- **Reading classic protection by default.** Rejected: needs a new permission.
- **Storing workflow text and parsing it in the site.** Rejected: untrusted text would cross the
  trust boundary and be published.

## Consequences

- Positive:
  - supply-chain hygiene becomes visible without changing any status on upgrade;
  - no new default permission, secret or write call;
  - an enforced check is a one-line policy change.
- Negative:
  - more API calls per run (rules, workflow files, Scorecard, referenced repositories);
  - without Administration: read, classic-only protection stays "not visible";
  - an existing 1.4 `public/data` must be re-collected.
