# ADR 0006: History persisted through the hub's own Actions artifacts

- **Status:** Accepted
- **Date:** 2026-10-21
- **Italian version:** [docs/it/architecture/adr/0006-history-persisted-through-own-actions-artifacts.md](../../it/architecture/adr/0006-history-persisted-through-own-actions-artifacts.md)

## Context

The owner wants to see whether each project is improving: a score trend, a status strip per
project, a "What changed since last collection" page and CSV exports. That needs the
previous collections, but the portal is static and has no backend
([ADR 0001](0001-static-first-github-native.md)), and the Actions runner starts empty on
every run. The snapshot is replaced at every collection and its schema is bumped from time
to time ([ADR 0002](0002-snapshot-contract-and-provider-abstraction.md)), so history cannot
live inside it.

## Decision

1. **Two new published files, versioned on their own (D1).** `history.json`
   (`kind: hub-history`, schema `1.0`) and `changes.json` (`kind: hub-changes`, `1.0`) sit
   next to the snapshot, which stays `1.4`. History survives snapshot bumps and an existing
   `public/data` stays readable.
2. **A dedicated `hub-history` artifact (D2).** Only `history.json`, 90 days retention,
   uploaded only for `data-source: github` (longer than the 14-day `snapshots` retention). A
   manual mock run can never break the real chain.
3. **Restore with a small Node script (D3).** `npm run history:restore` lists the hub's
   **own** `hub-history` artifacts with `GITHUB_TOKEN` and `actions: read` on the `collect`
   job (never the collector credentials), accepts only the default branch, this repository
   (not a fork), another run, at most 5 MiB and a run of the deploy or collect workflow on
   an allowed event, and reads the zip through the existing capped reader. The collector
   then treats the file as untrusted input: strict parse (8 MiB cap), links re-checked
   against the current allowlist, text re-scrubbed, output gated.
4. **Mock never restores (D4).** A mock run always starts from the synthetic
   `fixtures/history/history.json`; a history written by the other data source is set aside
   (`source-changed`). Mock and real history never meet, and the golden files stay
   deterministic.
5. **Bounded and diffed in the collector (D5, D6, D7, D12).** Retention is a policy
   (`history.maxEntries` 120, `history.maxAgeDays` 90). The collector computes
   `changes.json`, comparing alerts per (repository, source) pair only when the pair was
   readable in both collections, so an unreadable source never shows as resolved. Entries
   keep only projects in the current catalog.
6. **A fresh history is never "no changes".** Every state other than a real comparison
   (`none`, `restore-failed`, `unreadable`, `incompatible`, `source-changed`) is written to
   the files and explained on the page. A missing or invalid history never fails the site
   build (D11).
7. **Serialised collections.** The `collect` job runs under the concurrency group
   `hub-collect` without cancelling, so two runs never restore the same base.

## Alternatives considered

- **A git branch or commit in the repository.** Rejected: needs `contents: write`, which
  breaks the read-only, least-privilege model, and pollutes the repository history.
- **The GitHub Actions cache.** Rejected: evictable after 7 days unused, scoped to a branch
  and not meant to hold state.
- **An external store (bucket, database).** Rejected: new infrastructure or a commercial
  dependency for a static, GitHub-native portal.
- **History inside the snapshot.** Rejected: lost at every snapshot schema bump, and the
  snapshot is replaced at each run.

## Consequences

- Positive:
  - no new secret, service or write permission; the only new call is a `GET` on the hub's
    own repository;
  - history survives snapshot schema bumps and works with mock data and no credentials;
  - a planted artifact cannot reach the site: provenance, size, schema and sanitisation
    checks, and any failure just starts fresh.
- Negative:
  - up to 90 days without a run loses the chain, and history starts again;
  - deleting or expiring the artifact resets history (this is also the documented reset);
  - `collect` needs `actions: read` (own repository only), and collections are serialised;
  - the first collection after upgrading has nothing to compare with.
