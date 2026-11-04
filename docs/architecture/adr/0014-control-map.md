# ADR 0014: Control map of technical checks with related DORA and ISO 27001 references, never a compliance claim

- **Status:** Accepted
- **Date:** 2026-11-04
- **Italian version:** [docs/it/architecture/adr/0014-control-map.md](../../it/architecture/adr/0014-control-map.md)

## Context

Teams that deliver to regulated customers are asked to show which technical controls are in place
for DORA (Regulation (EU) 2022/2554 and RTS 2024/1774) and ISO/IEC 27001:2022. The hub already
collects most of the evidence (SBOMs, signatures, scanning, branch rules, alerts, versions) but
shows it page by page. A DevSecOps assessment rated the same practices on a 0–5 scale with
targets. The risk: a single score next to the names of two regulations reads as "compliant", and
the hub cannot see governance, contracts or organisational measures at all.

## Decision

1. **Technical checks only, references as data.** 25 checks (spec 2026-11-04 §5.2), each with
   the DORA articles and ISO Annex A controls it gives technical evidence for. No visible text,
   CSV header or metric help says "compliant" or equivalent; a test enforces it. Governance is out
   of scope.
2. **Levels 0–5 from policy thresholds.** Each check maps its measured value to the assessment
   scale with default ladders in code, overridable in `policies.yaml` (`controlMap.thresholds`).
3. **Unknown is not 0.** An unreadable source is "not visible" with a reason; "% of repositories"
   checks use only the readable repositories and refuse when fewer than half were read. Not
   applicable only when there is nothing to check, or the catalog says so with a reason. Controls
   marked `required: false` still count.
4. **Score = mean of measured levels × 20**, shown with "measured N of M", absent below half
   measured. Business-unit rows are medians.
5. **Deploy signal per environment.** Delivery metrics use one environment per project and a
   declared signal: workflow runs, a versions file changed by promotion pull requests, Argo CD
   history, releases, or `external` (not visible). Customer environments reached through mirrors
   and other CI systems are therefore stated, not guessed.
6. **Audience-gated.** The map (snapshot block, page, CSV, metrics) is produced only for
   `publication.audience: restricted` or demo data.
7. **Read-only, bounded.** New GETs only: environments, commits of one path, a file at a commit,
   commit dates, releases; push protection from repository metadata; OIDC from workflow files
   already read (input names only). Snapshot schema 1.9.

## Consequences

- Owners get one page that names gaps per project and business unit, with the requirement each
  gap relates to, and a CSV for their own reporting.
- The score can still be over-read; the lede, the references framing and this ADR mitigate it.
- Reference numbers must be kept current with the texts; they live in one model constant.
- Missing GitHub App permissions (environments, security settings) make checks not visible rather
  than failing them.
- Delivery metrics on DEV or on releases are proxies; the cell names the environment and signal.
