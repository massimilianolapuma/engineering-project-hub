# Risk governance: security exceptions, remediation SLAs, policy-as-code — design

Italiano: [../../it/superpowers/specs/2026-10-21-risk-governance-design.md](../../it/superpowers/specs/2026-10-21-risk-governance-design.md)

Status: builder's design under the roadmap program (owner reviews after delivery) · Date: 2026-10-21 · Target release: v0.9.0

Parent spec: [2026-10-21-roadmap-program-design.md](2026-10-21-roadmap-program-design.md) (§2 constraints, §4 "v0.9.0 Risk governance", §5 anti-goals). It is binding. Every decision in this document not fixed there is the **builder's call** and is marked **(BC)**.

Depends on:

- v0.7.0 ([2026-10-21-history-trends-design.md](2026-10-21-history-trends-design.md)): `history.json`, `changes.json`, the "What changed" page and the CSV exports;
- v0.8.0 ([2026-10-21-repository-controls-design.md](2026-10-21-repository-controls-design.md)): snapshot schema 1.5, history schema 1.1, ADR 0007, the `info | amber | red` level pattern.

Both merge before this release. This release takes snapshot schema **1.6**, history schema **1.2** and **ADR 0008**.

## 1. Intent and why

The hub shows open security alerts and turns them into a Security status. Two questions are missing for a team that has to decide what to fix first:

- **"We know about this one and accept it until a date. Stop counting it, but do not forget it."** Today the only way is to dismiss the alert on GitHub. The hub must never write to a monitored repository, and a dismissal leaves no expiry and no review trail in the hub.
- **"How long has this been open, and is it late?"** Today an alert is open or not. Its age and a remediation deadline are not shown.

A third need follows: the rules that turn findings into colours are YAML. When someone changes them, nobody sees the effect until the next collection. The owner wants policy-as-code: the rules validated by schema, with a command that shows each decision and runs in CI.

Facts checked on 2026-10-21 before deciding:

- **Findings are already per alert, with their creation time.** `SecurityFinding` (`shared/model/snapshot.ts`) has `id` (`<owner>/<repo>#<source>#<number>`), `source`, `severity`, `status`, `ruleId`, `detectedAt` and `updatedAt`. `detectedAt` comes from the alert's `created_at`. The DTOs in `collector/src/providers/types.ts` carry `createdAt`, mapped in `collector/src/providers/github/github-provider.ts` from `a.created_at` for code scanning, Dependabot and secret scanning. **No new API call and no new permission is needed.**
- In the GitHub OpenAPI types shipped with Octokit (`@octokit/openapi-types`), `created_at` is **required** on code scanning alerts and on Dependabot alerts, and **optional** on secret scanning alerts. Its description: "The time that the alert was created in ISO 8601 format". So the age of a secret scanning alert can be unknown.
- The list calls pass no `state` filter, so open, fixed and dismissed alerts all reach the collector. Only `status === 'open'` is counted (`countOpen` in `collector/src/normalizers/security-model.ts`).
- Raw keys needed for matching are only in the DTOs. `ruleId` and the Dependabot advisory id are set to `null` in the published finding when details are withheld (public audience, non-public repository). Matching must therefore happen **before** withholding.
- External scanners from `.security/project-security-status.json` report **counts only**, with no per-finding record and no date. They cannot be excepted and have no age.
- Config is loaded by `collector/src/config/load.ts` from a directory (`--config`, default `config`). `config.local/` is git-ignored and used as a whole replacement directory. The reusable deploy workflow passes a private repository's config directory. JSON Schemas in `config/schema/` are **generated from Zod** by `npm run schema:generate`. There is no test that they are up to date.
- The golden snapshots use the mock source, `config/` and `GOLDEN_NOW = 2026-01-15T12:00:00.000Z`. Fixture timestamps use `@now-Nd` / `@now-Nh` tokens (`collector/src/util/clock.ts`).
- v0.7.0 builds the change baseline from findings with `status === 'open'` (`collector/src/history/baseline.ts`, branch `feat/history-trends`). If excepted findings stopped being `open`, adding an exception would show the alert as "resolved" in "What changed".

## 2. Goals, non-goals, anti-goals

Goals

- **Security exceptions** in a reviewed file: an accepted finding leaves the counts and the status while its exception is active, and stays visible as "accepted until <date>". An expired exception puts the finding back and is flagged. An exception that matches nothing is flagged as stale.
- **Remediation SLAs:** days per severity in policies. Each open finding shows its age, its SLA and its due date. Overdue findings are counted, and an overdue critical or high can raise the status when the owner opts in.
- **Policy-as-code:** policies and exceptions validated by schema. `npm run policy:check` validates them, runs decision cases and explains each decision, and can re-evaluate an existing snapshot directory without writing anything. A CI job runs it on every pull request.
- UI in EN and IT, Warm Graphite: project page, Security page, Data quality, How to read.
- Works with mock data and without credentials, like everything else.

Non-goals

- No write to GitHub: no dismiss, no reopen, no comment on an alert, no issue creation.
- No exceptions for external scanner counts (status file): they have no per-finding identity.
- No exception approval workflow inside the hub. Review is the pull request on the config repository.
- No SLA business calendar (weekends, holidays). Days are calendar days in UTC.
- No OPA / Rego (§5.9).
- No per-finding history. History keeps counts only, as in v0.7.0.

Anti-goals (program §5, specialised)

- A finding that disappears without a trace because it is excepted. Accepted findings are always counted and listed separately.
- An exception without an owner, a reason or an expiry, or with an expiry beyond the policy horizon.
- An exception that stays "active" when the alert source cannot be read: it is **unverifiable**, never "fine".
- An unknown alert age shown as "within SLA". It is "age unknown".
- A project that turns red after the upgrade only because SLAs exist. Overdue findings are **informative by default**.
- Publishing the reason or the rule of an exception for a non-public repository when `publication.audience` is `public`.
- Exceptions or overdue findings creating fake "new" or "resolved" alerts in "What changed".

## 3. Constraints (program §2, unchanged)

- Read-only towards monitored repositories and every source. No new API call is needed.
- Static-first, no backend, no GitHub calls from the browser.
- Strict Zod allowlist on every published field. Sanitised text and links. Host allowlist for links.
- Unknown ≠ zero; 403 ≠ no data; ambiguous 404 = unknown.
- EN + IT for all docs and UI strings (i18n parity test).
- Mock data only in the public demo, with synthetic names.
- Warm Graphite tokens; status never by colour alone; WCAG 2.2 AA.
- One snapshot schema bump per release (1.5 → 1.6). Older snapshots are not read.
- Never run `npm run ci:build` or `collect:mock`. Never use or kill port 4321 (e2e on 4377). Podman only.

## 4. Decisions in short

| #   | Decision                                                                                                                                                                                                                                                                         | Why                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| D1  | Exceptions live in `<configDir>/exceptions.yaml`, optional. No file = no exceptions. JSON Schema `config/schema/exceptions.schema.json`, generated from Zod **(BC)**                                                                                                             | Same place, review path and override pattern (`config.local/`, private deploy config) as policies and catalog             |
| D2  | An excepted finding keeps `status: 'open'` (the GitHub truth) and gains `exception: { id, state, expires }`. Counting uses one shared helper, `countsAsOpen(f)` **(BC)**                                                                                                         | The hub never pretends GitHub changed. v0.7.0's baseline keeps seeing the alert as open, so no fake "resolved"            |
| D3  | Selectors: `alert` (number) for every source; `rule` (+ optional `tool`) for code scanning; `advisory` (GHSA or CVE) for Dependabot. Secret scanning accepts **only** `alert` **(BC)**                                                                                           | Rules and advisories cover recurring findings. Accepting a whole secret type would hide future leaked secrets             |
| D4  | Mandatory `owner`, `reason` (10–300 chars), `created`, `expires` (dates). `expires − created ≤ exceptions.maxDays` (default **180**). Optional `ticket` URL whose host must be in `publication.allowedLinkHosts` **(BC)**                                                        | A time-boxed, owned, explained acceptance. One host allowlist for every published link                                    |
| D5  | Exception states per run: `active`, `expired`, `stale` (matches no open finding), `unverifiable` (the source was not readable), `invalid` (`created` is in the future, so it is never applied). Orphaned exceptions (repository in no project) are counted at run level **(BC)** | Unknown ≠ zero: an unreadable source can neither confirm nor deny a match                                                 |
| D6  | An expired exception's findings count again, and the project gets a Security reason `security-exception-expired` at level amber (`exceptions.expiredIsAmber: true`) **(BC)**                                                                                                     | "Expired ones return and are flagged" (program §4). Only owners who created exceptions are affected                       |
| D7  | SLA days per class: critical 7, high 30, medium 90, low 180, secret 7 (secret scanning, whatever its severity). Informational and unknown severities have no SLA **(BC)**                                                                                                        | Common vulnerability-management defaults. Secret scanning severity is always `unknown`, so it needs its own class         |
| D8  | Age = now − alert `created_at`. Due = `created_at` + SLA days. An active exception pauses "overdue" but never resets the clock **(BC)**                                                                                                                                          | Deterministic from collected data, with no history needed. An exception must not become a way to restart the SLA          |
| D9  | Overdue escalation per class: `remediation.overdue.<class>: info \| amber \| red`, **default `info` for every class**. The demo `config/policies.yaml` opts in with `critical: red, high: red` **(BC)**                                                                          | Program §5: never red overnight. The demo shows the effect, and the comment says it is an opt-in                          |
| D10 | `npm run policy:check`: validation + decision cases in `<configDir>/policy-cases/*.yaml` + optional `--snapshot <dir>` re-evaluation. It never writes **(BC)**                                                                                                                   | Shows the effect of a policy change in the pull request, before the next collection                                       |
| D11 | No OPA / Rego. Zod is the validator, JSON Schema is generated from it, and a test keeps the two in sync **(BC)**                                                                                                                                                                 | No new runtime, no second policy language for a small, typed rule set (§5.9, ADR 0008)                                    |
| D12 | CI: a `policy-check` job in `ci.yml` on every pull request, through the existing `rw-node-quality-host.yml` **(BC)**                                                                                                                                                             | Covers every change to `config/` without a path filter (a skipped required check stays pending). No new reusable workflow |
| D13 | The mock source reads `fixtures/exceptions/exceptions.yaml`, where `created` / `expires` may use `@now±Nd` tokens. Real runs read `<configDir>/exceptions.yaml`, absolute dates only **(BC)**                                                                                    | Deterministic goldens and a live demo that never "expires", like v0.7.0's history fixture (D4 there)                      |
| D14 | Snapshot schema **1.5 → 1.6**. History **1.1 → 1.2** (optional `risk` counts). `changes.json` stays `1.0` with additive optional fields **(BC)**                                                                                                                                 | One bump per release. History follows v0.8.0's additive pattern                                                           |
| D15 | ADR 0008: "Risk governance as typed policy-as-code: exceptions in reviewed config, never GitHub dismissals, no OPA"                                                                                                                                                              | Records why the hub keeps its own acceptance layer next to GitHub's dismissals                                            |

## 5. Design

### 5.1 Exceptions file (`exceptions.yaml`, contract 1.0)

```yaml
# yaml-language-server: $schema=./schema/exceptions.schema.json
schemaVersion: '1.0'
exceptions:
  - id: EXC-0001 # unique, ^[A-Za-z0-9][A-Za-z0-9._-]{2,39}$
    repository: example-org/project-beta-api # owner/name, case-insensitive
    source: code-scanning # code-scanning | dependabot | secret-scanning
    match: { rule: py/flask-debug, tool: CodeQL } # or { alert: 42 } or { advisory: GHSA-xxxx-xxxx-xxxx }
    owner: team-beta # a team or role, never an e-mail address
    reason: Debug mode is only reachable in the local profile; removal planned with the settings refactor.
    created: '2026-01-05' # review date, YYYY-MM-DD (UTC)
    expires: '2026-03-31' # last day the exception applies (inclusive, UTC)
    ticket: https://github.com/example-org/project-beta-api/issues/12 # optional
```

Schema rules (Zod, `shared/model/exceptions.ts`, strict objects):

- `match` is exactly one of these:
  - `{ alert: int ≥ 1 }`;
  - `{ rule: string ≤ 200, tool?: string ≤ 50 }`, only with `code-scanning`;
  - `{ advisory: /^(GHSA(-[A-Za-z0-9]{4}){3}|CVE-\d{4}-\d{4,})$/i }`, only with `dependabot`.
- `secret-scanning` accepts only `alert` (D3).
- `owner`: `^@?[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$`. A GitHub team (`@example-org/team-beta`) or a role name. The regex rejects e-mail addresses (no `@` after the first character).
- `reason`: trimmed, 10 to 300 characters.
- `created` and `expires`: `YYYY-MM-DD` strings that are real calendar dates, with `expires ≥ created`. Quoting is recommended. The `yaml` package (YAML 1.2 core schema) already keeps unquoted dates as strings.
- `ticket`: `https` URL, ≤ 500 characters.
- File level:
  - `exceptions` has at most 500 entries;
  - ids are unique;
  - no two entries share `(repository lowercased, source, selector)`.

Cross-checks that need the policies or the catalog (`validateExceptions`, `collector/src/policy/exceptions.ts`):

| Check                                                | Result                                        |
| ---------------------------------------------------- | --------------------------------------------- |
| `expires − created` > `exceptions.maxDays` (in days) | error                                         |
| `ticket` host not in `publication.allowedLinkHosts`  | error (exact host match, as in `sanitizeUrl`) |
| `repository` in no catalog project                   | warning ("orphaned")                          |
| expired at validation time                           | warning ("remove or renew")                   |
| expiring within `exceptions.expiringSoonDays`        | warning                                       |
| `created` after today (UTC)                          | error ("created in the future")               |

- Errors fail `validate:config`, the collector (exit 1, structural, like any config error) and `policy:check`.
- Warnings are printed, and never fail the collector.
- The horizon check compares two static dates, never "now". So a file that is valid today stays valid tomorrow, and a collection can never break because time passed.

Loading (D13, `collector/src/config/load.ts`):

- `loadExceptions(file, { allowDateTokens, now })` returns `{ source: 'config' | 'fixture' | 'none', file: ExceptionsFile | null, warnings }`.
  - A missing file returns `none`.
  - With `allowDateTokens` (mock only), `created` / `expires` values like `@now-10d` are resolved with `resolveRelativeTime` to the UTC date of the resulting instant before parsing.
  - Real runs reject tokens through the date regex.
- `loadConfig(configDir, opts)` also returns `exceptions`.
- `collector/src/index.ts` gains `--exceptions <file>`:
  - default for `--source github`: `<config>/exceptions.yaml`;
  - default for mock: `fixtures/exceptions/exceptions.yaml` (tokens allowed).
- `scripts/validate-config.ts` validates `<dir>/exceptions.yaml` when present and prints `✔ <dir>/exceptions.yaml: N exception(s)`.
- `config/exceptions.yaml` ships with `exceptions: []` and a commented example **(BC)**. The repository's config stays valid, and the real format is documented next to the policies.

### 5.2 Matching and exception states (`collector/src/policy/exceptions.ts`, pure)

Inputs: per repository, the findings plus their **unpublished match keys**, the readability of each alert source, the exceptions and `now`.

- `toFindings` returns, next to each `SecurityFinding`, `keys: { alert: number, ruleId: string | null, tool: string | null, advisoryIds: string[] }` taken from the DTO before withholding. Keys stay inside the collector.
- A finding is a match candidate only when its GitHub `status === 'open'`.
- Matching:
  - `alert`: same repository (case-insensitive), same source, same number;
  - `rule`: code-scanning finding with `ruleId === rule` (and `tool === match.tool` when given, case-insensitive);
  - `advisory`: Dependabot finding whose GHSA or CVE equals it (case-insensitive).
- Expiry: an exception expires at `expires + 1 day, 00:00:00Z` (inclusive last day, UTC).
- State of each exception at `now`, first match wins:
  1. `invalid`: `created` is after today (UTC). The entry is never applied, matches nothing (`matched: null`) and its findings keep counting. The loader and `policy:check` reject such a file as an error, so this state is a defence in depth for a collection that gets one anyway, and it is listed in Data quality. It cannot also be expired, because `expires ≥ created`;
  2. `expired`: `now ≥ expiry`;
  3. `unverifiable`: the source of `(repository, source)` was not readable in this run (any failed result except `not-configured`, including a skipped repository or a page cap). A `not-configured` source has no alerts by definition, so it reads as empty, the same rule `countsComplete` uses;
  4. `stale`: no open finding matches;
  5. `active`.
- `expiringSoon`: `active` and `expiry − now ≤ exceptions.expiringSoonDays` days.
- Which exception a finding carries, when several match:
  - an active one beats an expired one;
  - then `alert` beats `rule` / `advisory`;
  - then the latest `expires`;
  - then the smallest `id`.
- Every match is counted in each matching exception's `matched`, so a rule exception overshadowed by an alert exception is not stale.
- An orphaned exception (repository in no catalog project) gets no per-project record. Only its id is listed in `index.run.exceptions.orphaned`.
- Monorepos: matching is per repository, so every project and component that owns the finding sees the same exception.

Effect on counting (D2):

- `countsAsOpen(f) = f.status === 'open' && f.exception?.state !== 'active'`, exported from `shared/model`.
- It replaces `status === 'open'` in:
  - `countOpen`, `openSecretAlerts`, `byCategory`, `bySource`;
  - the site's "listed critical/high", the Security page's "critical findings";
  - the v0.7.0 CSV findings summary.
- The v0.7.0 **baseline stays on `status === 'open'`** on purpose (§5.8).
- `securityHealth.acceptedCounts` counts `status === 'open' && exception.state === 'active'` by severity.

Publication (D4, same rule as finding titles):

- When `publication.audience === 'public'` and the repository is not public, `selector.value` (rule or advisory), `selector.tool`, `reason` and `ticketUrl` are published as `null`.
- `alert` numbers, `owner`, the dates, the state and the counts are always published. Alert numbers are already in the published links.
- `reason` goes through `scrubText` (≤ 200 characters after scrubbing). `owner`, rule and tool go through `scrubIdentifier`. `ticket` goes through `link()` (sanitizeUrl + host allowlist).

### 5.3 Remediation SLAs (`collector/src/policy/sla.ts`, pure)

For each finding with `status === 'open'` from the three GitHub sources, with `remediation.enabled`:

- Class: `secret` for secret scanning; otherwise the severity when it is critical, high, medium or low; otherwise no class.
- `days = remediation.days[class]`. A `null` value means no SLA.
- The `sla` object (on every open finding, `null` otherwise):

  | Situation                | `state`   | `days` | `dueAt`               | `ageDays`                | `overdueDays`                    |
  | ------------------------ | --------- | ------ | --------------------- | ------------------------ | -------------------------------- |
  | no class, or `days` null | `none`    | null   | null                  | floor age, or null       | null                             |
  | `detectedAt` null        | `unknown` | days   | null                  | null                     | null                             |
  | active exception         | `paused`  | days   | created + days        | floor((now − created)/d) | null                             |
  | `now > dueAt`            | `overdue` | days   | created + days × 24 h | floor                    | floor((now − dueAt)/d), may be 0 |
  | otherwise                | `within`  | days   | created + days × 24 h | floor                    | null                             |

- `remediation.enabled: false` → every `sla` is `null`, every overdue count is `null` ("not measured"), and no SLA reason is added.
- `overdueDays` may be 0 (overdue for less than a day). The UI then says "overdue for less than a day", never "0 days" **(BC)**.
- The UI shows "overdue since <dueAt>". That date comes from the alert's creation time, **not** from history, so it is right even for an alert older than the hub's history (D8).

Project summary `securityHealth.remediation`:

- `enabled`;
- `slaDays: { critical, high, medium, low, secret }`, an echo of the policy so the site never reads policies to label a row;
- `overdue: { critical, high, medium, low, secret }` counts of `countsAsOpen` findings in state `overdue`. Each is `null` when SLAs are off or when no GitHub alert source was readable, like `openCounts`. They are a lower bound when `countsComplete` is false;
- `oldestOverdueSince`: the smallest `dueAt` among overdue findings, or `null`;
- `slaUnknown`: open findings with a class but `detectedAt` null.

### 5.4 Security evaluation (`evaluateSecurity`, extended)

`SecurityInputs` gains `remediation` (above) and `exceptions` (the project's records). New reasons, added to the existing ones:

| Code                              | Level                                               | Params                                                | When                                 |
| --------------------------------- | --------------------------------------------------- | ----------------------------------------------------- | ------------------------------------ |
| `sla-overdue`                     | `remediation.overdue[class]` (default `info`)       | `{ severity: class, count, days }`                    | one per class with overdue > 0       |
| `sla-age-unknown`                 | `info`                                              | `{ count }`                                           | `slaUnknown > 0`                     |
| `security-exception-active`       | `info`                                              | `{ count }` (accepted findings)                       | any accepted finding                 |
| `security-exception-expired`      | `amber` if `exceptions.expiredIsAmber`, else `info` | `{ count, ids }` (ids comma-joined, max 10 then "+N") | any expired exception of the project |
| `security-exception-stale`        | `info`                                              | `{ count, ids }`                                      | any stale exception                  |
| `security-exception-unverifiable` | `info`                                              | `{ count, ids }`                                      | any unverifiable exception           |

- Order: after the severity reasons, before `coverage-incomplete`.
- The grey early return ("no source readable") is unchanged. Exceptions and SLAs never turn an unknown into green.
- Accepted findings do not count towards `open-*` reasons, because those reasons use the counts.
- `no-open-alerts` still means no counted open alert. It may sit next to `security-exception-active`.
- Overall status and score are unchanged in mechanism. They only see the Security status.

### 5.5 Policies (`config/policies.yaml`, policies `schemaVersion` stays `1.0`)

```yaml
remediation:
  enabled: true # false = no SLA computed or shown ("not measured")
  days: # calendar days from the alert's creation; null = no SLA for that class
    critical: 7
    high: 30
    medium: 90
    low: 180
    secret: 7 # secret scanning alerts, whatever their severity
  overdue: # what an overdue finding does to Security: info (default) | amber | red
    critical: info
    high: info
    medium: info
    low: info
    secret: info

exceptions:
  maxDays: 180 # longest allowed created → expires span (1–366)
  expiringSoonDays: 14 # active exceptions expiring within this many days are flagged (0–90)
  expiredIsAmber: true # an expired exception adds an amber Security reason
```

- Both blocks are optional (`.prefault({})`). `days.*`: int 1–3650 or null. Levels: reuse the v0.8.0 level enum when it is exported, otherwise add `EnforcementLevelSchema = z.enum(['info','amber','red'])` to `enums.ts`.
- The demo `config/policies.yaml` sets `overdue.critical: red` and `overdue.high: red`, with the comment "opt-in: the schema default is info" (D9).
- `src/lib/policies.ts` (`DEFAULTS_INPUT`) needs no change because the blocks prefault.

### 5.6 Snapshot model (schema 1.5 → 1.6)

`shared/model/enums.ts`:

- `SNAPSHOT_SCHEMA_VERSION = '1.6'`, `SUPPORTED = ['1.6']`, with the history comment `1.6: security exceptions, remediation SLAs`;
- the six reason codes of §5.4.

`shared/model/exceptions.ts` (new):

- `ExceptionSourceSchema`, `ExceptionMatchSchema`, `ExceptionEntrySchema`, `ExceptionsFileSchema` (§5.1);
- `ExceptionStateSchema = z.enum(['active','expired','stale','unverifiable','invalid'])`;
- `PolicyCaseSchema` (§5.7).

`shared/model/snapshot.ts`:

```ts
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

SecurityFindingSchema gains:
  exception: z.object({ id: z.string().max(40), state: z.enum(['active','expired']), expires: day })
              .strict().nullable(),
  sla: z.object({
    state: z.enum(['within','overdue','paused','none','unknown']),
    days: z.number().int().min(1).nullable(),
    dueAt: isoDate.nullable(),
    ageDays: z.number().int().min(0).nullable(),
    overdueDays: z.number().int().min(0).nullable(),
  }).strict().nullable(),

SecurityExceptionSchema = z.object({
  id: z.string().max(40),
  repository: z.string().max(200),
  source: ExceptionSourceSchema,
  selector: z.object({
    kind: z.enum(['alert','rule','advisory']),
    value: z.string().max(200).nullable(),   // null = withheld (§5.2)
    tool: z.string().max(50).nullable(),
  }).strict(),
  owner: z.string().max(65),
  reason: shortText.nullable(),              // null = withheld
  created: day, expires: day,
  ticketUrl: httpsUrl.nullable(),
  state: ExceptionStateSchema,
  expiringSoon: z.boolean(),
  matched: nullableCount,                    // null when unverifiable
  findingIds: z.array(z.string().max(200)).max(50),
}).strict();

SecuritySummarySchema gains:
  acceptedCounts: SeverityCountsSchema,
  remediation: z.object({
    enabled: z.boolean(),
    slaDays: z.object({ critical, high, medium, low, secret: int ≥ 1 nullable }).strict(),
    overdue: z.object({ critical, high, medium, low, secret: nullableCount }).strict(),
    oldestOverdueSince: isoDate.nullable(),
    slaUnknown: z.number().int().min(0),
  }).strict(),
  exceptionStates: z.object({ active, expired, stale, unverifiable, invalid, expiringSoon: int ≥ 0 }).strict(),

ProjectSnapshotSchema gains:
  securityExceptions: z.array(SecurityExceptionSchema).max(500),   // sorted by state, then id

ProjectSummarySchema gains:
  risk: z.object({
    overdue: nullableCount,              // sum of the five overdue classes
    overdueCriticalHigh: nullableCount,
    accepted: nullableCount,             // sum of acceptedCounts
    exceptionIssues: z.number().int().min(0),   // expired + stale + unverifiable + invalid
  }).strict(),

RunMetadataSchema gains:
  exceptions: z.object({
    source: z.enum(['config','fixture','none']),
    total: z.number().int().min(0),
    orphaned: z.array(z.string().max(40)).max(100),   // ids only, never the repository
  }).strict(),
```

- Primitives (`isoDate`, `httpsUrl`, `shortText`, `nullableCount`) are imported from wherever v0.7.0 put them (`shared/model/primitives.ts`).
- `collection-report.md` gains one line: `Exceptions: 7 loaded (fixture) · 3 active · 1 expired · 1 stale · 1 unverifiable · 1 orphaned`.

### 5.7 `npm run policy:check` (D10)

`package.json`: `"policy:check": "tsx scripts/policy-check.ts"`. The core is `collector/src/policy/check.ts`, `runPolicyCheck(opts): Promise<{ exitCode: 0 | 1 | 2; lines: string[] }>`, so it is unit-testable. The script prints the lines and exits.

Flags:

| Flag                  | Default                    | Meaning                                                                 |
| --------------------- | -------------------------- | ----------------------------------------------------------------------- |
| `--config <dir>`      | `config`                   | policies, catalog and exceptions to check                               |
| `--exceptions <file>` | `<config>/exceptions.yaml` | another exceptions file (an explicit path that does not exist = exit 2) |
| `--cases <dir>`       | `<config>/policy-cases`    | decision cases; missing directory = warning "no decision cases"         |
| `--snapshot <dir>`    | none                       | re-evaluate an existing snapshot directory, read-only                   |
| `--now <iso>`         | system clock               | the time for exception states and the snapshot re-evaluation            |
| `--fail-on-warnings`  | off                        | warnings make the exit code 1                                           |

Steps:

1. **Validate:** load the catalog, the policies and the exceptions with the same functions as the collector. Print one line per error and warning, with the file and the path (`exceptions[2] (EXC-PLAT-002): expires in 7 days (2026-01-22)`).
2. **Explain the policies:** a short table of how the Security inputs map to levels, from the effective policies: which severities are red or amber, the SLA days and the overdue level per class, the exception horizon, and whether an expired exception is amber.
3. **Decision cases:** each `*.yaml` in the cases directory is parsed with `PolicyCaseSchema` and evaluated with the **real** functions (`applyExceptions`, `applySla`, `evaluateSecurity`, or `evaluateOverall` + `evaluateScore`). Then:
   - the decision is printed with every reason, its level and the policy key that set the level (`collector/src/policy/explain.ts`, a static map from reason code to key, for example `sla-overdue` → `remediation.overdue.<severity>`);
   - the actual decision is compared with `expect`. A mismatch prints both decisions and fails.
4. **Snapshot (optional):**
   - read `index.json` and `projects/*.json` from `--snapshot` with the strict schemas. An unsupported `schemaVersion` is an error;
   - for each project, rebuild the Security inputs from the snapshot (findings, coverage, controls, `countsComplete`, readability), apply the current exceptions and SLAs, and re-evaluate Security and the overall status;
   - print `would change: platform security amber → red (sla-overdue high ×1)` or `unchanged`;
   - findings whose `ruleId` was withheld cannot match `rule` / `advisory` selectors. They are reported as "not evaluable from this snapshot (details withheld)", never as unmatched;
   - the directory is opened read-only. Nothing is written anywhere, and a test pins this.
5. **Exit codes:** 0 = valid and every case passed (warnings allowed); 1 = a validation error, a failed case, or a warning with `--fail-on-warnings`; 2 = usage error (unknown flag, unreadable directory).

The CLI output is English only, like the collector's logs **(BC)**. The docs that explain it are EN + IT.

Case file (`PolicyCaseSchema`, strict):

```yaml
name: An overdue high alert raises Security to red when escalation is on
kind: security # security | overall
now: '2026-01-15T12:00:00Z' # optional; default 2026-01-15T12:00:00Z
security:
  findings: # minimal findings; status defaults to open
    - id: example-org/platform-mono#code-scanning#2
      severity: high
      detectedAt: '@now-31d' # ISO or @now±N(d|h) relative to `now`
      ruleId: js/prototype-pollution-utility # optional (rule selectors)
  exceptions: [] # same entries as exceptions.yaml (date tokens allowed here)
  unreadable: [] # optional "owner/repo|source" pairs
expect:
  status: red
  reasons: [open-high-alerts, sla-overdue] # must be present
  absent: [security-exception-active] # optional: must be absent
```

- `kind: overall` takes `overall: { dimensions: Record<Dimension, HealthStatus> }` and may expect `score` (int or null).
- In the case, `source`, `repository` and the alert number come from the finding `id`.
- The other Security inputs are fixed to: all controls enabled, coverage green, counts complete, no external counts.
- The repository ships 8 synthetic cases in `config/policy-cases/` that match the demo policies (listed in the plan). A private config directory brings its own, or gets the warning.
- JSON Schema `config/schema/policy-case.schema.json` is generated for editor support.

### 5.8 History and "What changed" (v0.7.0 integration)

What history adds, and what it does not:

- "Overdue since" is **not** computed from history. It is `dueAt`, from the alert's creation time (D8). History keeps counts only and starts with the first v0.7.0 collection, so it would be wrong for older alerts.
- History gives the **trend** of overdue and accepted counts, and "What changed" gives what **crossed a line between two collections**.

Changes:

- History schema `1.2`, with `SUPPORTED_HISTORY_SCHEMA_VERSIONS = ['1.0','1.1','1.2']`. `HistoryProjectPoint` gains optional `risk: { overdue: nullableCount, accepted: nullableCount }` from `ProjectSummary.risk`. A missing `risk` means "not tracked then" and is shown as such, never as 0.
- The baseline is unchanged. It keeps `status === 'open'` findings, accepted ones included. So adding, expiring or removing an exception never makes an alert "new" or "resolved".
- `changes.json` keeps `schemaVersion` `1.0`, with additive optional fields written by 0.9.0:
  - `projects[].newlyOverdue`, max 50: `{ id, severity: 'critical' | 'high', componentId, repository, dueAt, htmlUrl }`. These are counted open findings with `sla.state === 'overdue'` and `previousCollectedAt < dueAt ≤ generatedAt`;
  - `projects[].expiredExceptions`, max 50: `{ id, repository, expires }`. These are the project's exceptions whose expiry instant lies in the same window;
  - `totals.newlyOverdue` and `totals.expiredExceptions`.
  - Both lists are filled only when `basis.state === 'compared'`. Otherwise they are empty, and the page shows the basis message as today.
  - A policy change that makes old findings overdue at once does **not** fill `newlyOverdue`, because their `dueAt` is before the window. Those findings appear as a Security status change instead **(BC)**.
- The "What changed" page gets two sub-lists per project: "Newly overdue" / "Scaduti da poco" and "Exceptions expired" / "Eccezioni scadute".
- CSV, columns appended at the end so existing positions stay stable **(BC)**:
  - `portfolio.csv`: `overdue`, `overdue_critical_high`, `accepted`, `exception_issues`;
  - `findings-summary.csv`: `overdue`, `accepted` per component row.
  - `unknown` for null, as in v0.7.0.

### 5.9 Why not OPA / Rego (D11)

- **Weight:** OPA is a separate Go binary (tens of MB), or a WASM build plus a Rego compile step in CI. Both add a supply-chain surface and a toolchain to a project that has none today.
- **Two languages:** the health rules are already typed TypeScript driven by a Zod-validated YAML. Rego would duplicate them, or force a rewrite of every evaluator for no new capability.
- **What OPA would give** (schema validation, decision tests, explanations) is covered by Zod, the generated JSON Schema, the decision cases and the reason → policy-key explanations.
- **Revisit when** policies need arbitrary owner-written logic (for example, conditions across dimensions per business unit). That would be a new ADR.

JSON Schema stays the published contract. `scripts/generate-json-schema.ts` gains `exceptions.schema.json` and `policy-case.schema.json`. A new test regenerates every schema in memory and compares it with `config/schema/*.json`, so the generated files can never drift from Zod.

### 5.10 CI (D12)

`.github/workflows/ci.yml` gains:

```yaml
policy-check:
  name: Policy check
  permissions:
    contents: read
  uses: ./.github/workflows/rw-node-quality-host.yml
  with:
    node-version: '24'
    lint-command: npm run policy:check
    typecheck-command: ''
    format-check-command: ''
```

- The header comment lists the job.
- The job runs on every pull request and every push to `main`, so every change to `config/` is checked. A path filter is avoided on purpose, because a required check skipped by a path filter never reports.
- `validate:config` (already in `ci:build`, `collect-data.yml` and `rw-hub-cloudflare-deploy.yml`) now validates the exceptions too. So a private deploy configuration with a broken exceptions file fails before collection, without changing those workflows.
- `.github/CODEOWNERS` gains an explicit `/config/exceptions.yaml @massilp` line with the comment "risk acceptances: owner review" **(BC)**. It is redundant with `*` today, and documents the intent.

### 5.11 UI (Warm Graphite, EN + IT)

Shared rules:

- Every state has text and a symbol, never colour alone.
- Dates use the existing locale date formatting. Ages are whole days ("30 d" / "30 g").
- Withheld values show the existing "withheld for non-public repositories" text.

**Project page** (`#security` fold, `src/pages/[...lang]/projects/[id].astro`, or a new `src/components/RiskPanel.astro`):

- **Remediation line** at the top of the fold:
  - "Overdue: 1 high · oldest since 14 Jan 2026" or "Nothing overdue";
  - when SLAs are off, "Remediation SLAs are off in the policies.";
  - with incomplete counts, "≥ n", as today.
- **Alert rows** (critical / high list) gain a meta line, with the row attribute `data-sla-state`:
  - overdue: "Age 30 d · SLA 30 d · overdue since 14 Jan 2026", with an `Overdue` pill (clock icon + text);
  - within: "due in 4 d";
  - paused: "Accepted until 4 Feb 2026 (EXC-ALPHA-001)", with an `Accepted` pill;
  - unknown: "age unknown".
- Accepted critical/high findings are listed under their own sub-heading "Accepted by exception" / "Accettati con eccezione", after the counted ones. They are never mixed in.
- **"Exceptions" table** (`id="exceptions"`), one row per project exception:
  - id;
  - scope: repository · source · selector, or the withheld text;
  - owner;
  - reason, or the withheld text;
  - state badge: "Active until <date>", "Expiring <date>", "Expired on <date>", "Stale: matches nothing", or "Not verifiable: source not readable";
  - matched count;
  - ticket link.

  Legend: "Accepted findings do not count towards the status until the exception expires. The hub never dismisses alerts on GitHub."

- **Security dimension card:** an extra line "1 overdue · 1 accepted" when either is non-zero.
- **Why panel:** the new reasons, with EN/IT texts.

**Security page** (`security.astro`):

- The totals strip gains "Overdue" and "Accepted" totals, with "≥" when incomplete and "?" when unknown.
- Each project card gains a line "Overdue {n} · Accepted {m} · Exceptions needing attention {k}", linking to the project's `#exceptions`.
- New fold **"Remediation queue"** / **"Coda di remediation"** (`<details class="sec-queue disclosure" open>`):
  - a table of every counted **and** accepted open critical/high finding across projects, sorted by state (overdue first, then within by `dueAt`, then paused, then unknown);
  - columns: Severity · Alert (title or withheld, with the GitHub link) · Project · Age · SLA · Due / overdue since · State (Overdue / Within SLA / Accepted until … / Age unknown);
  - at most 100 rows, then "and N more on the project pages";
  - each row has `data-finding-id` and `data-sla-state`;
  - on phones the table uses the existing responsive `data-label` pattern.

**Data quality page:** a new card **"Security exceptions"** / **"Eccezioni di sicurezza"** (`id="h-exceptions"`) with four lists:

- expired, "remove or renew";
- stale, "matches no open alert";
- unverifiable, with the unreadable source;
- orphaned ids, "repository not in the catalog".

Plus "expiring soon". Each item links to the project's `#exceptions`.

**How to read:** a new section `#risk` "Exceptions and remediation SLAs" / "Eccezioni e SLA di remediation":

- accepted vs dismissed on GitHub;
- the five exception states;
- the SLA table read from the effective policies, with the overdue level per class and "informative" when `info`;
- "overdue since = alert creation + SLA days";
- why an unknown age is never "within SLA".

**Portfolio:** no new bar or column **(BC)**. The Security bar's tooltip gains "· {n} overdue · {m} accepted" when non-zero.

**Design-first (standing owner rule):** before coding, the project-page risk panel, the remediation queue and the Data quality card are drawn as artboards in the Claude Design canvas with Warm Graphite. The owner reviews after delivery, so this does not block. After the build, the canvas and the DS README are updated. No artifact link goes into the repository.

### 5.12 Mock data (synthetic)

New alerts in `fixtures/github`:

| Repository                   | Alert                                                                 | Created                 |
| ---------------------------- | --------------------------------------------------------------------- | ----------------------- |
| `project-alpha-backend`      | code scanning #15 `java/xxe`, high, open, CodeQL                      | `@now-45d`              |
| `project-beta-api` (private) | code scanning #7 `py/flask-debug`, medium, open, CodeQL               | `@now-20d`              |
| `platform-mono`              | code scanning #2 `js/prototype-pollution-utility`, high, open, CodeQL | `@now-738h` (30 d 18 h) |

`fixtures/exceptions/exceptions.yaml` (dates resolve against `GOLDEN_NOW = 2026-01-15T12:00Z`):

| id               | Repository · source · selector                                | Created → expires                    | State at golden time                                              |
| ---------------- | ------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------- |
| `EXC-ALPHA-001`  | alpha-backend · code-scanning · alert 15                      | `@now-10d` → `@now+20d` (2026-02-04) | active, accepts high #15                                          |
| `EXC-ALPHA-002`  | alpha-frontend · dependabot · alert 5 (fixed)                 | `@now-50d` → `@now+10d`              | stale                                                             |
| `EXC-BETA-001`   | beta-api · code-scanning · rule `py/flask-debug`, tool CodeQL | `@now-15d` → `@now+60d`              | active, accepts medium #7; selector and reason withheld (private) |
| `EXC-BETA-002`   | beta-web · secret-scanning · alert 2                          | `@now-5d` → `@now+25d`               | unverifiable (secret scanning 403)                                |
| `EXC-PLAT-001`   | platform-mono · code-scanning · rule `js/path-injection`      | `@now-60d` → `@now-1d` (2026-01-14)  | expired: medium #5 counts again                                   |
| `EXC-PLAT-002`   | platform-mono · dependabot · advisory `GHSA-demo-0004-mono`   | `@now-170d` → `@now+7d` (2026-01-22) | active, expiring soon, accepts low #9                             |
| `EXC-LEGACY-001` | `example-org/legacy-tool` · dependabot · alert 3              | `@now-30d` → `@now+30d`              | orphaned                                                          |

The owners are `team-alpha`, `team-beta` and `team-platform`. Tickets are `https://github.com/example-org/<repo>/issues/<n>`.

Resulting golden story, with the demo policies (`overdue.critical: red`, `overdue.high: red`):

| Project  | Security          | Overall         | Overdue                                                     | Accepted   | Exceptions                          |
| -------- | ----------------- | --------------- | ----------------------------------------------------------- | ---------- | ----------------------------------- |
| Alpha    | amber (unchanged) | unchanged       | 0                                                           | 1 (high)   | 1 active, 1 stale                   |
| Beta     | red (unchanged)   | unchanged       | 0 (critical #3 due 2026-01-19T12:00Z, in 4 d)               | 1 (medium) | 1 active (withheld), 1 unverifiable |
| Platform | **amber → red**   | **amber → red** | 1 high (#2, due 2026-01-14T18:00Z, age 30 d, overdue < 1 d) | 1 (low)    | 1 expired, 1 active expiring soon   |
| Gamma    | grey (unchanged)  | unchanged       | null                                                        | null       | none                                |

Run level: `exceptions: { source: 'fixture', total: 7, orphaned: ['EXC-LEGACY-001'] }`.

The v0.7.0 history fixture is adjusted so that its latest baseline already contains `alpha-backend#code-scanning#15` and `platform-mono#code-scanning#2`, both open high, so neither shows as "new". The golden `changes.json` then shows for Platform:

- overall and Security amber → red;
- `newlyOverdue: [#2]`, because due 2026-01-14T18:00Z is inside (2026-01-14T12:00Z, 2026-01-15T12:00Z];
- `expiredExceptions: [EXC-PLAT-001]`, because its expiry 2026-01-15T00:00Z is inside the same window.

The other projects show no risk changes.

`config/exceptions.yaml` stays `exceptions: []`. The mock source does not read it (D13).

### 5.13 Docs (EN + IT)

- `configuration.md`: the `remediation` and `exceptions` policy blocks; the `exceptions.yaml` contract with an example per selector; the policy cases format; the `--exceptions` flag; the mock fixture rule.
- `security.md`:
  - no new permission and no write: exceptions never dismiss on GitHub;
  - what is published about an exception, and what is withheld for non-public repositories;
  - the `created_at` facts and sources (§9);
  - the recommendation to keep real exceptions in a private config repository.
- `operations.md`:
  - how to add, renew and remove an exception by pull request;
  - running `npm run policy:check` locally and with `--snapshot public/data` (read-only);
  - the CI job;
  - opting in to SLA escalation.
- `architecture.md`: the data flow (match → SLA → evaluate) and the trust boundary (the exceptions file is reviewed config; its text is scrubbed before publication). Snapshot version `1.6`.
- README / README.it:
  - Security dimension text (accepted, overdue);
  - `policy:check` in the commands list;
  - roadmap: remove "security exceptions with expiry", "policy-as-code" and "remediation SLAs".
- `PRODUCT.md`, `DESIGN.md`: the risk panel, the remediation queue and the Accepted / Overdue pills.
- `CHANGELOG.md`.
- ADR 0008 (EN + IT).

## 6. Tests (summary; exact cases in the plan)

- **Unit, model:** exceptions schema (each selector rule, secret only `alert`, owner rejects an e-mail, reason length, real dates, duplicates); policies defaults; JSON Schema drift test.
- **Unit, exceptions:** cross-checks (horizon, ticket host, orphan warning); each state; inclusive expiry at the UTC boundary; precedence; withholding; the canary in `reason` is scrubbed.
- **Unit, SLA:** each row of the §5.3 table; the exception pauses but does not reset; SLAs off → nulls.
- **Unit, security:** default `info` never changes the status; opt-in `high: red` turns amber into red; expired → amber; stale and unverifiable → info; grey stays grey.
- **Unit, policy:check:** exit codes, explanations, failing case diff, warnings, `--snapshot` read-only (no file created or modified), withheld findings "not evaluable".
- **Integration:** golden numbers of §5.12, schema 1.6, run metadata, collection report line, canaries blocked, `changes.json` risk lists, history 1.2 reads a 1.0 and a 1.1 file.
- **Site / e2e:** risk panel, exceptions table, remediation queue order, Data quality card, How to read section, IT strings, `data-sla-state` attributes, no horizontal overflow at 412 px.

## 7. Risks

- **Broad selectors.** One `rule` or `advisory` exception can accept many alerts, including future ones. Mitigations:
  - the horizon cap;
  - `matched` and `findingIds` are shown;
  - optional `tool` scoping;
  - secret scanning is alert-only.
- **Public exceptions file.** In the public demo repository the exceptions are synthetic. Real exceptions say what a team accepts. The docs recommend a private config repository (the existing deploy pattern), and withholding protects non-public repositories on a public site.
- **Old `created_at` on reopened alerts.** A reopened alert keeps its original creation time and can be overdue at once. This is documented as intended (the risk was known that long).
- **UTC dates.** An owner in CET may expect a local midnight expiry. The docs and the UI say "UTC".
- **Demo turns Platform red.** Intended, and visible in the demo config comment. The v0.7.0 and v0.8.0 goldens change for Platform. The plan updates the history fixture accordingly.
- **Drift with v0.7.0 and v0.8.0.** File layout (`primitives.ts`, history modules, i18n keys, the level enum) and version numbers (snapshot 1.6, history 1.2, ADR 0008) may move. The plan says: take the next free number and adapt.

## 8. Left to the builder (implementer)

- Exact Astro markup of the risk panel and the queue, and whether the panel is a component, following the Warm Graphite patterns.
- Internal helper names beyond the interfaces in the plan.
- Whether `explain.ts` is a map or a switch, as long as every new reason code and every existing Security reason has an explanation.

## 9. Sources (checked 2026-10-21)

- `@octokit/openapi-types` (in `node_modules`, used by `@octokit/rest` 22): `code-scanning-alert-items.created_at` and `dependabot-alert.created_at` are required; `secret-scanning-alert.created_at` is optional; `alert-created-at` is described as "The time that the alert was created in ISO 8601 format". The code scanning list `state` parameter: "Set to `open`, `closed`, `fixed`, or `dismissed` to list code scanning alerts in a specific state"; the Dependabot `state` parameter is an optional comma-separated filter.
- Codebase: `collector/src/providers/types.ts` (`createdAt` on the three alert DTOs), `collector/src/providers/github/github-provider.ts` (mapping from `created_at`, no `state` filter), `collector/src/normalizers/security-model.ts` (`toFindings`, `countOpen`, withholding), `collector/src/evaluators/health.ts` (`evaluateSecurity`), `collector/src/config/load.ts`, `scripts/generate-json-schema.ts`, `scripts/update-golden-snapshots.ts`, `.github/workflows/ci.yml`, `rw-node-quality-host.yml`.
- v0.7.0 branch `feat/history-trends`: `shared/model/history.ts`, `collector/src/history/baseline.ts` (`openCriticalHigh` uses `status === 'open'`).
- GitHub REST, Dependabot alerts and code scanning alerts (state filters, `created_at`): <https://docs.github.com/en/rest/dependabot/alerts>, <https://docs.github.com/en/rest/code-scanning/code-scanning>, <https://docs.github.com/en/rest/secret-scanning/secret-scanning>.
- Open Policy Agent distribution (single static Go binary, or Wasm compilation of Rego): <https://www.openpolicyagent.org/docs/latest/#running-opa>, <https://www.openpolicyagent.org/docs/latest/wasm/>.
