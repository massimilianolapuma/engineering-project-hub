# Repository controls: pinned actions, reusable workflows, branch rules, scorecard, discovery hints — design

Italiano: [../../it/superpowers/specs/2026-10-21-repository-controls-design.md](../../it/superpowers/specs/2026-10-21-repository-controls-design.md)

Status: builder's design under the roadmap program (owner reviews after delivery) · Date: 2026-10-21 · Target release: v0.8.0

Parent spec: [2026-10-21-roadmap-program-design.md](2026-10-21-roadmap-program-design.md) (§2 constraints, §4 "v0.8.0 Repository controls", §5 anti-goals). It is binding. Every decision in this document not fixed there is the **builder's call** and is marked **(BC)**.

Depends on v0.7.0 ([2026-10-21-history-trends-design.md](2026-10-21-history-trends-design.md)), which merges first. v0.8.0 works without it, but §5.10 uses its `history.json` / `changes.json` when present.

## 1. Intent and why

The README roadmap lists five GitHub-native items:

- actions pinned to a commit SHA;
- reusable workflow versions;
- branch protection and rulesets;
- repository scorecards;
- discovery through custom properties and topics.

They share one permissions model (read-only GitHub, mostly permissions the hub already has) and one destination: the **Governance** dimension. The owner wants to see, per project, whether its repositories follow basic supply-chain hygiene, without a project turning red overnight because a new check appeared.

Facts checked on 2026-10-21 (sources in §9):

- `GET /repos/{owner}/{repo}/rules/branches/{branch}` returns **all active rules** that apply to a branch, from repository **and** organisation rulesets. Rules in rulesets set to `evaluate` or `disabled` are **not** returned. The branch does not need to exist, and the name cannot contain wildcards. Fine-grained permission: **Metadata: read**.
- Classic branch protection (`GET /repos/{o}/{r}/branches/{branch}/protection`) needs **Administration: read**, a permission the hub does not have today.
- `GET /repos/{o}/{r}/branches/{branch}` (already called for the branch head) returns a `protected` boolean. Its docs do not define it. The "List branches" docs say `protected=true` means "protected by branch protections or rulesets".
- `GET /repos/{o}/{r}/properties/values` returns `[{ property_name, value }]`. `value` is a string, an array or null. It needs **Metadata: read**. The organisation-wide `GET /orgs/{org}/properties/values` needs the organisation permission **Custom properties: read**, a new permission, so it is not used.
- Topics come with the repository object the hub already reads (`topics`). No extra call.
- Workflow files are read through the Contents API (**Contents: read**, already granted). The REST workflow list (`listRepoWorkflows`, Actions: read) gives file names but not contents.
- OpenSSF Scorecard uploads SARIF with tool driver name **`Scorecard`** (title-cased from `scorecard`). Rule ids are the check name without hyphens plus `ID` (`Pinned-Dependencies` → `PinnedDependenciesID`). A result (and so a code-scanning alert) is emitted **only for checks below the policy's minimum score**. The score is only inside the message text (`"score is N: …"`), which the hub does not collect.
- `GET /repos/{o}/{r}/code-scanning/analyses` (Code scanning alerts: read, already granted) accepts `tool_name`.
- GitHub's guidance: pinning an action to a full-length commit SHA is the only way to use it as an immutable release. `uses:` forms are:
  - steps: `{owner}/{repo}@{ref}`, `{owner}/{repo}/{path}@{ref}`, `./path`, `docker://{image}:{tag}`;
  - jobs (reusable workflows): `{owner}/{repo}/.github/workflows/{file}@{ref}` and `./.github/workflows/{file}`.

## 2. Goals, non-goals, anti-goals

Goals

- Per repository, six named **repository checks**, each `pass`, `fail`, `unknown` or `not-applicable`, with a ratio "passed / (passed + failed)" and the unknowns shown next to it.
- Per repository, the details behind the checks:
  - action references and whether each is pinned;
  - reusable workflow references with their version against the latest release or tag of the referenced repository;
  - the active branch rules on the default branch;
  - an OpenSSF Scorecard summary when Scorecard results reach code scanning.
- New checks feed Governance through policies. Every check is **informative by default**, and the owner opts in per check to `amber` or `red`.
- Discovery uses configurable custom properties and topics to propose project grouping, component ids and types, still as proposals only.
- With the mock source and without credentials, everything works like the rest of the hub.

Non-goals

- No write: no ruleset creation, no SHA-pinning pull request, no Scorecard run.
- No OpenSSF public API (`api.securityscorecards.dev`). It is an external host, and calling it would leak private repository names. Only data already in code scanning is used.
- No numeric Scorecard score. It lives only in alert message text, which is never collected.
- No composite actions (`.github/actions/*/action.yml`), no Dependabot config checks, no CODEOWNERS check in this release **(BC)**.
- No tag rulesets and no push rulesets: only rules on the default branch.
- No organisation-level custom property listing (it needs a new permission).

Anti-goals (program §5, specialised)

- A repository whose workflows or rules cannot be read shown as `pass`, or as `fail`. It is `unknown`.
- A project that turns red or amber after the upgrade only because these checks exist. Defaults are `info`.
- Publishing workflow contents: step names, `run:` scripts, `with:` inputs, `env`, expressions. Only `owner/repo[/path]` action identifiers, refs and workflow file names are kept, and only after strict validation.
- Publishing custom property values other than the configured keys.
- A not-visible referenced repository reported as "behind".

## 3. Constraints (program §2, unchanged)

The project rules hold unchanged:

- read-only, GET only, static-first, no browser calls;
- optional, works without credentials, unknown ≠ zero, 403 ≠ no data, ambiguous 404 = unknown;
- strict Zod allowlist, sanitised text and links, host allowlist;
- EN + IT, Warm Graphite, status never by colour alone, WCAG 2.2 AA;
- one snapshot bump per release;
- never `npm run ci:build` / `collect:mock` (they overwrite `public/data`);
- e2e on port 4377, podman only.

## 4. Decisions in short

| #   | Decision                                                                                                                                                                                         | Why                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| D1  | No new dimension. The checks feed **Governance** through reasons. The portfolio gets no new bar **(BC)**                                                                                         | Program §4 says "feeds Governance". A seventh bar would add noise for a mostly informative signal         |
| D2  | Six checks, fixed ids (§5.4) **(BC)**                                                                                                                                                            | Small, explainable and GitHub-native. Each maps to one data source                                        |
| D3  | Every check defaults to `info`. `policies.repositoryControls.checks.<id>: info \| amber \| red`                                                                                                  | Program §4/§5: never red overnight. The owner opts in                                                     |
| D4  | Workflow files are read from `.github/workflows/` on the default branch via Contents. At most 30 files per repository, each ≤ 256 KiB **(BC)**                                                   | Contents: read is already granted. The bounds protect the API budget from untrusted repositories          |
| D5  | Branch checks use the rules API (Metadata: read). Classic protection is read only when `readClassicProtection: true` (needs Administration: read, off by default) **(BC)**                       | No new permission by default. An honest `unknown` when classic protection may hide the answer             |
| D6  | A rule type absent from the rules API while the branch reports `protected: true` is `unknown`, not `fail`, unless classic protection was read **(BC)**                                           | It may be set by classic protection, which is invisible without Administration: read                      |
| D7  | Reusable workflow currency is compared with the referenced repository's latest release, falling back to its latest tag. A ref equal to a tag's SHA resolves to that tag. Not visible → `unknown` | Same version sources the hub already uses for components                                                  |
| D8  | OpenSSF Scorecard is a **summary**, not a seventh check **(BC)**                                                                                                                                 | Its alerts are already Security findings. Counting them again in Governance would double-count            |
| D9  | Action details (identifier, ref) and reusable-workflow targets are withheld for non-public repositories when `publication.audience: public`. Counts stay **(BC)**                                | Same rule as finding titles today                                                                         |
| D10 | Discovery hints: custom property wins over topic. Only configured keys are read and kept. A new proposal kind `grouped` **(BC)**                                                                 | Properties are admin-managed and topics are free-form. Unconfigured properties may be sensitive           |
| D11 | Snapshot schema **1.4 → 1.5** (v0.7.0 keeps 1.4). `history.json` / `changes.json` are unaffected, apart from the optional extension in §5.10                                                     | One bump per release. History survives snapshot bumps by design (v0.7.0 D1)                               |
| D12 | ADR 0007: "Repository controls from workflow files and the rules API, informative by default"                                                                                                    | First time the collector reads files outside a fixed allow-list. That changes a documented trust boundary |

## 5. Design

### 5.1 Data collected per unique repository

Data is collected only when `policies.repositoryControls.enabled` (default `true`). When it is off, none of these calls is made and the section says "off".

| Data                     | Call                                                                                                       | Permission (fine-grained / App)             | Bound                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------- |
| Workflow file list       | `GET /repos/{o}/{r}/contents/.github/workflows?ref={branch}`                                               | Contents: read                              | names matching `^[A-Za-z0-9._-]+\.ya?ml$`, first 30 sorted |
| Workflow file text       | `GET /repos/{o}/{r}/contents/.github/workflows/{file}?ref={branch}`                                        | Contents: read                              | ≤ 256 KiB (existing `MAX_FILE_BYTES`)                      |
| Branch rules             | `GET /repos/{o}/{r}/rules/branches/{branch}` (`per_page=100`, 1 page)                                      | Metadata: read                              | 100 rules                                                  |
| Branch `protected` flag  | existing `GET /repos/{o}/{r}/branches/{branch}` (head), new field mapped                                   | Contents or Metadata: read (already called) | none                                                       |
| Classic protection (opt) | `GET /repos/{o}/{r}/branches/{branch}/protection`, only if `readClassicProtection: true`                   | **Administration: read** (opt-in)           | none                                                       |
| Scorecard analysis       | `GET /repos/{o}/{r}/code-scanning/analyses?tool_name=Scorecard&per_page=1`                                 | Code scanning alerts: read                  | 1 item                                                     |
| Scorecard alerts         | existing code-scanning alert list, filtered on `toolName` = `Scorecard` (case-insensitive)                 | already collected                           | existing 300-alert cap                                     |
| Referenced repositories  | existing `getLatestRelease` → `getLatestTag`, plus `listTags` when a ref is a SHA. Memoised across the run | Contents / Metadata: read                   | at most 50 distinct referenced repos per run **(BC)**      |

The collector parses workflow text in memory and discards it. The text never leaves the provider and normaliser layer, just like `.gitmodules` today.

**`getFile` allow-list.** It is extended by one pattern: `.github/workflows/<name>` where `<name>` matches the regex above. `..`, slashes in the name and any other path are rejected before the call.

A workflow file name longer than 100 characters (the published bound) is never read: it counts as unreadable, so the pinning check is `unknown`.

### 5.2 Workflow reference parsing (`collector/src/normalizers/workflow-refs.ts`)

- The file is parsed with the existing `yaml` dependency. `maxAliasCount: 100`, `uniqueKeys` is not enforced, and `logLevel: 'error'` keeps YAML warnings (which quote the source) out of the collector log. A file that fails to parse makes the repository's action data `partial` (`unparsable` +1). A legitimate file that reuses an anchor more than about 100 times (for example 120 jobs with `steps: *steps`) is therefore `unparsable`, and pinning is `unknown` for its repository.
- The parser looks only at `jobs.<id>.uses` (reusable workflow) and `jobs.<id>.steps[*].uses` (action). Everything else is ignored and never stored.
- At most 200 references per file and 1 000 per repository. Beyond that, the reference count is `null` and the pinning check is `unknown` **(BC)**.
- Each `uses` string is classified:

  | Form                                                       | `kind`              | Counted for pinning? | Pinned when               |
  | ---------------------------------------------------------- | ------------------- | -------------------- | ------------------------- |
  | `./…`                                                      | `local`             | no                   | —                         |
  | `docker://image@sha256:<64 hex>`                           | `docker`            | yes                  | always (digest)           |
  | `docker://image[:tag]`                                     | `docker`            | yes                  | never                     |
  | `{owner}/{repo}/.github/workflows/{file}@{ref}`            | `reusable-workflow` | yes                  | `ref` is 40 lowercase hex |
  | `{owner}/{repo}[/{path}]@{ref}`                            | `action`            | yes                  | `ref` is 40 lowercase hex |
  | anything else (no `@`, contains `${{`, invalid characters) | `invalid`           | yes, as **unknown**  | —                         |

- Validation regexes:
  - owner: `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$`;
  - repo: `^[A-Za-z0-9._-]{1,100}$`;
  - path segments: `^[A-Za-z0-9._-]{1,100}$`, at most 5 segments;
  - ref: `^[A-Za-z0-9._/-]{1,100}$`.
- Length bounds: a rebuilt `target` longer than 200 characters, a `ref` or docker tag longer than 100, or any part that `scrubIdentifier` would alter makes the reference `invalid` (counted as unknown). An identifier is never truncated, so a published one is never a garbled prefix and never fails the snapshot schema.
- `exemptActionOwners` (policies, default `[]`) lists owners whose unpinned actions count as pinned. A typical value is `["actions", "github"]`, but the default stays strict **(BC)**.

### 5.3 Reusable workflow currency

For each distinct `(owner/repo, ref)` among the `reusable-workflow` references:

| Situation                                                                                           | `status`                                     |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Referenced repository not visible (403 / 404 / error), or over the 50-repo bound                    | `unknown`                                    |
| Neither a release nor a tag readable                                                                | `unknown`                                    |
| `ref` is a 40-hex SHA equal to the commit of a tag in `listTags`                                    | resolved to that tag, then compared          |
| `ref` is a 40-hex SHA with no matching tag                                                          | `untagged`                                   |
| `ref` parses as semver (after `normaliseVersion`) and equals latest                                 | `current`                                    |
| `ref` parses as semver and is lower than latest                                                     | `behind`                                     |
| `ref` is a stable version (or major alias) lower than a latest that is a pre-release (tag fallback) | `unknown` (a newer stable version may exist) |
| `ref` parses as semver and is higher than latest (pre-release)                                      | `current`                                    |
| `ref` is a major alias `v2` whose major equals the latest's major                                   | `current` (floating major; pinning flags it) |
| `ref` is a major alias whose major is lower                                                         | `behind`                                     |
| Anything else (a branch such as `main`)                                                             | `floating`                                   |

A referenced repository that is **not public** is treated as not visible (`unknown`, no `latest`, no URL, no tags) unless `publication.audience: restricted`, so a private shared repository never leaks its name state or versions to a public site. `latest` and tag names are kept only when they are at most 100 characters and unchanged by `scrubIdentifier`; otherwise they are dropped (`latest: null`, status `unknown`), never truncated.

`latest` is `normaliseVersion(release.tagName)` or `normaliseVersion(tag.name)`. Comparison uses `compareVersions` from `collector/src/util/semver.ts`.

### 5.4 The six checks (D2)

Check ids (`RepositoryCheckIdSchema`), in display order:

1. **`actions-pinned`**: every counted reference (§5.2) is pinned or exempt.
   - `not-applicable`: the workflows directory is absent (404) or there is no counted reference.
   - `fail`: at least one readable reference is unpinned (a fail wins over unreadable files).
   - `unknown`: the listing returned 403 or an error; or some file is unreadable or unparsable, or an `invalid` reference exists, or the cap was hit, and nothing is unpinned.
   - `pass`: otherwise.
2. **`reusable-workflows-current`**:
   - `not-applicable`: no remote reusable workflow reference.
   - `fail`: any reference is `behind`.
   - `unknown`: none behind, and any is `unknown`, `untagged` or `floating`; or workflow data is `unknown`.
   - `pass`: all are `current`.
3. **`branch-protected`**:
   - `pass`: the rules call returned at least one rule; or classic protection was read and exists; or the rules call failed or returned none while `protected === true`.
   - `fail`: the rules call succeeded with no rule, and `protected === false`, and (when it was read) classic protection is absent.
   - `unknown`: otherwise.
4. **`pull-request-required`**: rule type `pull_request` (or classic `required_pull_request_reviews`).
5. **`force-push-blocked`**: rule type `non_fast_forward` (or classic `allow_force_pushes.enabled === false`).
6. **`status-checks-required`**: rule type `required_status_checks` (or classic `required_status_checks` present).

Checks 4–6 share one rule:

- `pass` when present.
- When absent:
  - `fail` if the rules call succeeded and either `protected === false` or classic protection was read and lacks it;
  - `unknown` if `protected === true` or `null` and classic protection was not read (D6).
  - `unknown` if classic protection was read but answered 404 while `protected === true` and the rules call returned no rule: the two sources contradict each other, which points to a permission ambiguity (ambiguous 404 = unknown, never fail).
- `unknown` when the rules call failed and classic protection was not read.

Repository-level overrides:

- **Archived repository:** every check is `not-applicable` (an archived repository is read-only).
- **Unavailable repository** (metadata failed): every check is `unknown`, never not applicable.
- **Catalog override:** `notApplicableChecks: RepositoryCheckId[]` on the coordinator and on components (mirrors `notApplicableControls`). For monorepos, a check is not applicable for the repository only when **every** target on it lists it **(BC)**.

Ratio, per repository and per project:

- `passed / (passed + failed)`, as an integer percentage rounded half up, or `null` when the denominator is 0;
- `unknown` and `notApplicable` are shown next to it and never enter the denominator.
- Project counts sum over **unique repositories** (a monorepo counts once), like Quality.

### 5.5 Branch rule summary

Branch rules are summarised; raw rule `parameters` are never published, except `required_approving_review_count` (an int 0–10).

- `ruleTypes` is the de-duplicated list of active rule types, filtered through an allow-list enum `BranchRuleTypeSchema`. Its values are the types documented on 2026-10-21:
  - `creation`, `update`, `deletion`, `required_linear_history`, `merge_queue`, `required_deployments`, `required_signatures`;
  - `pull_request`, `required_status_checks`, `non_fast_forward`;
  - `commit_message_pattern`, `commit_author_email_pattern`, `committer_email_pattern`, `branch_name_pattern`, `tag_name_pattern`;
  - `workflows`, `code_scanning`, `code_quality`, `code_coverage`, `copilot_code_review`, `license_compliance_scanning`;
  - `file_path_restriction`, `max_file_path_length`, `file_extension_restriction`, `max_file_size`.
- Unknown future types are counted in `otherRules` and never published by name.
- `source`:
  - `rulesets` when the rules API returned rules;
  - `classic` when only classic protection applies: read, or inferred from `protected === true` when the rules call succeeded with no rule (a failed rules call gives `unknown`, since rulesets may be the cause);
  - `both`, `none` or `unknown` otherwise.

### 5.6 OpenSSF Scorecard summary (D8)

Per repository:

- `state`:
  - `available` when a Scorecard analysis exists;
  - `not-used` when the analyses call returned an empty list or 404 (not a failure, informative);
  - `not-authorised` on 403;
  - `unknown` otherwise.
- `lastAnalysisAt`: from the analysis.
- `openAlerts`: the count of open code-scanning alerts with tool `Scorecard`, or `null` when alerts were not readable.
- `failingChecks`: Scorecard check names mapped from rule ids through an allow-list. Rule ids not in the list are counted in `otherFailing`. The allow-list:
  - `Binary-Artifacts`, `Branch-Protection`, `CI-Tests`, `CII-Best-Practices`, `Code-Review`, `Contributors`, `Dangerous-Workflow`;
  - `Dependency-Update-Tool`, `Fuzzing`, `License`, `Maintained`, `Packaging`, `Pinned-Dependencies`, `SAST`;
  - `SBOM`, `Security-Policy`, `Signed-Releases`, `Token-Permissions`, `Vulnerabilities`, `Webhooks`.
- The UI says "Checks below your Scorecard policy minimum", not "failed". Scorecard emits a result only below the minimum score.
- These alerts stay in the Security findings as today. No change to Security.

### 5.7 Policies (`config/policies.yaml`, policies `schemaVersion` stays `1.0`)

```yaml
repositoryControls:
  enabled: true
  checks: # info = shown, never changes Governance (default for every check)
    actions-pinned: info
    reusable-workflows-current: info
    branch-protected: info
    pull-request-required: info
    force-push-blocked: info
    status-checks-required: info
  unknownEnforcedCheck: info # info | amber: an enforced check that is unknown
  exemptActionOwners: []
  maxWorkflowFiles: 30 # 1–100
  readClassicProtection: false # true needs Administration: read
```

- The block is optional (`.prefault({})`). Check levels are `z.enum(['info','amber','red'])`.
- **Governance reasons** (new codes, EN/IT):
  - `repository-check-failed`: one per check with at least one failing repository. Level = the check's policy level. `params`: `{ check, repositories (comma-joined, max 10 then "+N"), count }`.
  - `repository-check-unknown`: one per **enforced** check (level ≠ `info`) with unknown repositories. Level = `unknownEnforcedCheck`. Informative checks get no unknown reason; the section shows them.
  - `repository-checks-passed`: `info`, added when every applicable check passes on every readable repository.
- `info` reasons never change the status (existing `statusFrom`). `governance-compliant` is still added when the status is green.
- The score is unchanged: Governance keeps weight 15 and moves only when an enforced check changes its status.

### 5.8 Snapshot model (schema 1.4 → 1.5)

`shared/model/enums.ts`:

- `SNAPSHOT_SCHEMA_VERSION = '1.5'` and `SUPPORTED = ['1.5']`, with the history comment `1.5: repository controls, discovery hints`.
- New: `RepositoryCheckIdSchema`, `RepositoryCheckStateSchema = z.enum(['pass','fail','unknown','not-applicable'])`, `BranchRuleTypeSchema`, `ScorecardCheckSchema`.
- New capability `repositoryRules`. It reflects the rules API only (Metadata: read). The opt-in classic protection call needs Administration: read, so its failures are recorded as `repository-rules` errors but never change this capability. Rules and classic protection share the `repository-rules` source: at most one error per unique repository.
- Reason codes: `repository-check-failed`, `repository-check-unknown`, `repository-checks-passed`.

`shared/model/snapshot.ts`:

```ts
RepositoryControlsHealthSchema = z.object({
  enabled: z.boolean(),
  collectedAt: isoDate,
  passed, failed, unknown, notApplicable: int ≥ 0,         // over unique repositories × checks
  ratio: z.number().int().min(0).max(100).nullable(),
  perCheck: z.array({ id: RepositoryCheckId, level: z.enum(['info','amber','red']),
                      passed, failed, unknown, notApplicable }),          // 6 items, display order
  repositories: z.array({
    componentIds: z.array(z.string().max(64)).min(1),      // monorepo: every target on the repo
    repository: z.string().max(200),
    checks: z.array({ id: RepositoryCheckId, state: RepositoryCheckState }).length(6),
    passed, failed, unknown, notApplicable: int,
    ratio: int 0–100 nullable,
    actions: {
      state: z.enum(['available','partial','none','not-authorised','unknown']),
      workflowFiles: nullableCount,
      total, pinned, unpinned, unknown: nullableCount,
      detailsWithheld: z.boolean(),
      unpinnedRefs: z.array({ workflow: fileName, kind: z.enum(['action','reusable-workflow','docker']),
                              target: z.string().max(200), ref: z.string().max(100) }).max(20),
      truncated: z.number().int().min(0),
    },
    reusableWorkflows: z.array({ workflow: fileName, target: z.string().max(250),
                                 ref: z.string().max(100), latest: z.string().max(100).nullable(),
                                 status: z.enum(['current','behind','untagged','floating','unknown']),
                                 url: httpsUrl.nullable() }).max(20),     // url = referenced repo
    branchRules: {
      state: z.enum(['available','not-authorised','unknown']),
      branch: z.string().max(255).nullable(),
      protected: z.boolean().nullable(),
      source: z.enum(['rulesets','classic','both','none','unknown']),
      ruleTypes: z.array(BranchRuleTypeSchema).max(30),
      otherRules: z.number().int().min(0),
      requiredApprovals: z.number().int().min(0).max(10).nullable(),
      classicRead: z.boolean(),
    },
    scorecard: {
      state: z.enum(['available','not-used','not-authorised','unknown']),
      lastAnalysisAt: isoDate.nullable(),
      openAlerts: nullableCount,
      failingChecks: z.array(ScorecardCheckSchema).max(20),
      otherFailing: z.number().int().min(0),
    },
  }),
}).strict();
```

Other changes:

- `ProjectSnapshot.repositoryControls: RepositoryControlsHealthSchema`.
- `ProjectSummary.repositoryControls: { passed, failed, unknown, notApplicable, ratio }`.
- `CollectionErrorSchema.source` adds `workflow-files`, `repository-rules`, `scorecard-analysis`.
  - Errors are recorded once per unique repository.
  - A 404 on the workflows directory is expected (not an error). A 404 on rules is `unknown` and is recorded.
  - Referenced repositories never produce collection errors (they are not monitored).
- `DiscoveryProposalSchema`:
  - `kind` adds `'grouped'`;
  - new `hintedProjectId: slug | null`;
  - new `hints: { source: z.enum(['property','topic']), key: z.string().max(50), value: z.string().max(100) }[] (max 10)` with the configured keys only.
- `fileName` = `^[A-Za-z0-9._-]+\.ya?ml$` (max 100). `target` is rebuilt from the validated parts, never copied from the raw string.

### 5.9 Discovery hints (`catalog.yaml`)

```yaml
discovery:
  topics: true # existing reserved flag, now active
  customProperties: true # existing reserved flag, now active (1 call per scanned repo)
  hints:
    projectProperty: hub-project
    componentProperty: hub-component
    typeProperty: hub-component-type
    projectTopicPrefix: project- # topic "project-tools" → project "tools"
    typeTopicPrefix: type- # topic "type-worker" → type worker
```

- `hints` is optional with these defaults. Keys match `^[a-z0-9][a-z0-9_-]{0,49}$`. Prefixes match `^[a-z0-9-]{1,30}$`.
- Per scanned repository:
  - read topics (already present);
  - when `customProperties` is on, call `getCustomPropertyValues`;
  - keep **only** the three configured keys. String values only (array or null are ignored with evidence "ignored hint").
- Values: project and component values must be slugs, and the type must be a `ComponentType`. Otherwise they are ignored with evidence.
  - Property beats topic.
  - Several `project-*` topics → ambiguous → ignored with evidence.
- Effects:
  1. Structural detection (coordinator / monorepo / single) is unchanged and wins for structure.
  2. A hinted **type** replaces `guessType` for that repository's component.
  3. A hinted **component** id replaces the slug (still made unique).
  4. Repositories that are `single` proposals sharing the same hinted project and not claimed by a coordinator are merged into one **`grouped`** proposal:
     - project id = the hint;
     - coordinator = the repository whose component hint is `coordinator`, else the first alphabetically;
     - the others become components with `versionSource: release`;
     - their `single` proposals are dropped.
  5. When the hinted project id is an existing catalog project and the repository is not part of it, `hintedProjectId` is set. The catalog editor shows "Suggested for project X". It does not auto-merge.
- 403 on properties → `errors[]` entry `not-authorised`, and hints come from topics only. 404 → no properties.
- Proposals stay proposals. Nothing enters the catalog until a project file is saved (unchanged).

### 5.10 History and "What changed" (v0.7.0 dependency, optional)

With no change at all, Governance status moves already appear on the "What changed" page as dimension status changes. That happens only when the owner enforces a check.

When v0.7.0 is merged (**(BC)**, Task 7 of the plan):

- History `schemaVersion` `1.1`, with `SUPPORTED_HISTORY_SCHEMA_VERSIONS = ['1.0','1.1']`. A 1.0 file is read and simply lacks the new fields.
- `HistoryProjectPoint` gains optional `controls: { passed, failed, unknown }`. `HistoryBaseline.projects[]` gains optional `checks: string[]`: `"owner/repo|check|pass"` or `"owner/repo|check|fail"` keys, at most 600.
- `changes.json` (`schemaVersion` stays `1.0`, additive optional field) gains per project `checkChanges: [{ repository, check, from: 'pass'|'fail', to: 'pass'|'fail' }]` (max 50), plus `totals.checkChanges`.
  - Only pass ↔ fail moves count, and only when both runs know the state (like version moves). A previous baseline without `checks` → not compared.
- The "What changed" page lists them under "Repository checks" / "Controlli repository".
- The portfolio CSV gains `controls_passed`, `controls_failed`, `controls_unknown`.

If v0.7.0 has not merged when this release is implemented, Task 7 is skipped and recorded as a follow-up.

### 5.11 UI (Warm Graphite)

**Project page:** a new `<details id="repository-controls" class="fold disclosure">` after Controls coverage and before Quality.

- Title: "Repository controls" / "Controlli repository".
- Summary line: "{passed} of {applicable} checks pass · {unknown} not visible", with the ratio.
- **Tiles:** checks passed (ratio), not visible (unknown count, dashed outline), OpenSSF Scorecard (`available` repositories, failing check count).
- **Checks matrix:**
  - rows = unique repositories (component ids listed), columns = the six checks;
  - cells use the existing status symbols: pass ✓, fail ✕, unknown "?" in a dashed outline, not applicable "–", each with visually hidden text;
  - column headers carry a small "Informative" / "Informativo" tag when the level is `info`, and "Counts for Governance" / "Conta per Governance" otherwise.
- **Detail lists** (each one collapsible):
  - unpinned references (workflow · target · ref), or "Details withheld for non-public repositories";
  - reusable workflows (target · ref · latest · status);
  - branch rules (source, rule types as small code tokens, approvals);
  - Scorecard (last analysis, checks below minimum).
- A legend sentence: "Informative checks never change the Governance status. Not visible does not mean failing."
- The Governance dimension card anchor changes from `#workflows` to `#repository-controls` **(BC)**. The section ends with a link "Standard workflows →" to `#workflows`, for the existing governance reasons.

**Portfolio:** no new bar or column (D1). The Governance bar's existing tooltip text gains "· checks {passed}/{applicable}" **(BC)**.

**How to read:**

- the Governance entry mentions the repository checks;
- a new "Repository controls" entry explains the six checks, informative vs enforced, and why unknown ≠ fail.

**Data quality:**

- the `repositoryRules` capability is listed;
- a list of repositories whose workflows or rules were not readable.

**Catalog editor:**

- proposal kind `grouped` ("Grouped by hints" / "Raggruppato dai suggerimenti");
- a "Suggested for project {id}" badge;
- hint evidence lines.

All strings are EN + IT, and the parity test is automatic. The `ui-ux-pro-max` and `web-design-guidelines` passes run on the new section before merge. Design upkeep: update the Warm Graphite DS README and canvas after the code (standing rule).

### 5.12 Mock data (synthetic; exact values in the plan, Task 4)

Shared SHAs:

- `D = 0123456789abcdef0123456789abcdef01234567` (pinned actions);
- ci-templates tags: `v2.4.0 = a1b2c3d4e5f60718293a4b5c6d7e8f9012345678`, `v2.3.0 = b2c3…`, `v2.1.0 = c3d4…`.

A new fixture `example-shared__ci-templates.json` (a different owner, so discovery does not list it) has release `v2.4.0`.

| Project  | Passed | Failed | Unknown | N/A | Ratio | Story                                                                                                                                    |
| -------- | ------ | ------ | ------- | --- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Alpha    | 25     | 0      | 0       | 5   | 100   | Everything pinned. The coordinator calls the reusable workflow at the v2.4.0 SHA (current). Four rules everywhere. Helm has no workflows |
| Beta     | 5      | 7      | 8       | 4   | 42    | `@v4` / `@v6` in api, reusable `@v2.1.0` behind, web unprotected, coordinator classic-only (unknown details), helm rules 403             |
| Platform | 4      | 1      | 1       | 0   | 80    | `pnpm/action-setup@v4`, reusable `@main` (floating) and a not-visible `example-private/templates` (unknown); org ruleset                 |
| Gamma    | 0      | 0      | 12      | 0   | null  | Repositories unavailable → all unknown                                                                                                   |

- Scorecard:
  - beta-api has an analysis `@now-2d` with open alerts `TokenPermissionsID` (high) and `PinnedDependenciesID` (medium);
  - alpha-backend has an analysis `@now-3d` and no alert;
  - the others are not used.
- Discovery:
  - new fixtures `example-org__tools-api.json` and `example-org__tools-cli.json` (topic `project-tools`) → one `grouped` proposal "tools";
  - `docs-site` gets property `hub-project: platform` → `hintedProjectId: "platform"`;
  - `tools-cli` also carries an unconfigured property `cost-center: CC-1234`, which must never appear in output.
- Governance status of every mock project is **unchanged** against the v0.7.0 goldens (all checks `info`).

### 5.13 Docs (EN + IT)

- `configuration.md`: the `repositoryControls` policies, catalog `notApplicableChecks`, discovery `hints`.
- `security.md`: the permissions table rows (Metadata for rules and properties, Contents for workflows, optional Administration: read), what is never published from workflow files and properties, and the verification date and sources.
- `architecture.md`: data flow, and the trust boundary for workflow files as untrusted input.
- `operations.md`: how to opt in to enforcement, and how to grant Administration: read for classic protection.
- README / README.it: dimensions (Governance text), roadmap (remove the five items).
- CHANGELOG.
- ADR 0007 (EN + IT).

## 6. Tests (summary; exact cases in the plan)

- **Unit, parser:** every `uses` form in §5.2, the caps, a YAML anchor bomb, a `uses` containing `${{` treated as `invalid`, and a step name with a secret canary never present in the output.
- **Unit, currency:** each row of §5.3.
- **Unit, checks:** each check's pass / fail / unknown / not-applicable path. D6 (absent rule + `protected: true` → unknown). Archived → all N/A. Unavailable → all unknown. Monorepo override needs every target.
- **Unit, governance:** defaults leave the status unchanged. `actions-pinned: red` turns a failing project red. `unknownEnforcedCheck: amber` on an unknown enforced check makes it amber. No unknown reason for informative checks.
- **Unit, discovery:** property beats topic, invalid values ignored, `grouped` proposal, `hintedProjectId`, unconfigured property never kept.
- **Provider:** request shapes (`ref`, `tool_name=Scorecard`, `per_page`), 403 / 404 classification, and that the classic protection call is never made when the flag is off.
- **Integration:** golden numbers in §5.12, Governance unchanged, canaries blocked, schema 1.5.
- **Site / e2e:** section present, matrix with text alternatives, Governance card links to `#repository-controls`, IT strings, the "Informative" tag.

## 7. Risks

- **`protected` semantics of the single-branch endpoint are undocumented.** D6 makes them only able to turn a would-be `fail` into `unknown` or a pass for `branch-protected`, never to hide a real absence. The implementer records the observed behaviour in `security.md`.
- **Many `unknown` cells for repositories with rulesets plus `protected: true`.** This is honest by design. The owner can enable `readClassicProtection` with Administration: read.
- **API budget:** up to 33 extra calls per repository (1 listing + 30 files + rules + analyses), plus at most 150 for referenced repositories. On a 50-repository portfolio this stays well within 5 000 requests per hour. `maxWorkflowFiles` bounds it.
- **Branch names with `/`** must be URL-encoded in the rules path. Octokit's `{branch}` expansion encodes it, and a test pins this.
- **v0.7.0 file drift** (i18n keys, nav, `primitives.ts`, history types): the plan says to adapt.

## 8. Left to the builder (implementer)

- Exact Astro markup and responsive layout of the matrix (horizontal scroll with a sticky first column, or stacked cards on narrow screens), following the Warm Graphite patterns.
- Internal helper names beyond the interfaces in the plan.
- Whether to parse YAML once per file in the provider or the normaliser (it must stay out of the published model).

## 9. Sources (checked 2026-10-21)

- Rules for a branch, rulesets: <https://docs.github.com/en/rest/repos/rules>
- Fine-grained token permissions per endpoint (rules, rulesets, properties/values, topics, tags: Metadata read; branch protection: Administration read; contents, releases: Contents read; code-scanning analyses: Code scanning alerts read; org properties: Custom properties read): <https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens>
- Branches (`protected` field, List branches `protected` parameter): <https://docs.github.com/en/rest/branches/branches>
- Custom property values for a repository: <https://docs.github.com/en/rest/repos/custom-properties>
- Workflow syntax (`steps[*].uses` forms, "commit SHA … safest for stability and security"): <https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax>
- OpenSSF Scorecard SARIF output (driver name, rule ids, results only below the minimum score, "score is N" message): <https://github.com/ossf/scorecard/blob/main/pkg/scorecard/sarif.go>
