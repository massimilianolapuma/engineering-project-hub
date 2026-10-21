# History and change: trends, "What changed", CSV export — design

Italiano: [../../it/superpowers/specs/2026-10-21-history-trends-design.md](../../it/superpowers/specs/2026-10-21-history-trends-design.md)

Status: builder's design under the program spec (owner reviews after delivery) · Date: 2026-10-21 · Target release: v0.7.0

Program spec: [2026-10-21-roadmap-program-design.md](2026-10-21-roadmap-program-design.md) (§2 constraints and §4 "v0.7.0 History and change" are binding). Every decision not fixed there is marked **(builder's call)**.

## 1. Intent and why

Today every collection replaces the previous one. The hub answers "how is it now?" but not "is it getting better?" or "what moved since yesterday?". For a decision tool these are the first questions after a status change.

v0.7.0 adds three things:

- a **compact, bounded history** kept between runs without new infrastructure;
- a **"What changed since last collection"** page;
- **CSV export** of the portfolio, an alert summary and the versions, as static files.

Facts checked in the codebase before deciding:

- `writeSnapshots` deletes the output directory before writing (`rm -rf`), so the collector must read any previous history **before** it writes.
- The collect job uploads `public/data` as the `snapshots` artifact with **14 days** retention. The collect job has only `contents: read`.
- Snapshots are regenerated every run and only `schemaVersion` 1.4 is read (`SUPPORTED_SNAPSHOT_SCHEMA_VERSIONS = ['1.4']`). A history kept inside the snapshot would become unreadable at the next snapshot bump.
- The site reads `public/data` (or `SNAPSHOT_DIR`) at build time only. Golden snapshots are built with `GOLDEN_NOW = 2026-01-15T12:00:00.000Z` from `fixtures/github`.
- `scripts/scan-output.ts` scans only a fixed list of text extensions, which does not include `.csv`.
- Finding ids are stable and readable: `<owner>/<repo>#code-scanning#<n>`, `#dependabot#<n>`, `#secret-scanning#<n>`.

## 2. Goals, non-goals, anti-goals

Goals

- Per project and per run: overall status, score, per-dimension status, open finding counts by severity, collection error count. Per run: timestamp and run metadata. Nothing else.
- History persists between runs in GitHub Actions using only the hub's own artifacts, and locally using the existing output directory.
- A trend per project (score sparkline and status strip) and a compact trend on the portfolio.
- A "What changed" page:
  - status changes (overall and per dimension);
  - new and resolved critical/high alerts;
  - version moves;
  - new collection errors.
- Three static CSV files, safe to open in a spreadsheet.
- Works with mock data and without credentials. The public demo shows a synthetic trend.

Non-goals

- No raw payloads, titles of resolved alerts, or per-finding history. Only counts and the small "baseline" needed to compute the next diff (§5.3).
- No history for the Quality per-component table, for workflows or for environments.
- No client-side charting library, no client-side fetch of JSON or CSV.
- No notifications. They come in v0.11.0 and consume `changes.json`.
- No backfill: history starts with the first v0.7.0 collection.

Anti-goals (failure even if it "works")

- A history point that was never collected, or an interpolated one.
- A missing score drawn as 0, or a gap drawn as a line.
- "No changes" shown when the previous history could not be read.
- An alert shown as "resolved" only because its source became unreadable. An alert shown as "new" only because its source became readable.
- Mock points mixed into a real history, or the reverse.
- A CSV cell that a spreadsheet runs as a formula.
- Secrets, tokens, raw payloads or file contents in `history.json`, `changes.json` or the CSV files.

## 3. Constraints (program spec §2, unchanged)

- Read-only towards monitored repositories and sources. The only new API calls read the hub's **own** repository artifacts, with the workflow `GITHUB_TOKEN` and `actions: read` on itself.
- Static-first, no backend, no GitHub calls from the browser.
- Strict Zod allowlist on every published field. Sanitised text and links. Host allowlist for links.
- Unknown ≠ zero; 403 ≠ no data; ambiguous 404 = unknown.
- EN + IT for all docs and UI strings (i18n parity test).
- Mock data only in the public demo, with synthetic names.
- Warm Graphite tokens; status never by colour alone; WCAG 2.2 AA.
- Snapshot schema bumps once per release that changes it. This release does **not** change it (§5.1).
- Never run `npm run ci:build` or `collect:mock`. Never use or kill port 4321. Podman only.

## 4. Decisions in short (all builder's calls unless noted)

| #   | Decision                                                                                                                                          | Why                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| D1  | Two new published files, `history.json` and `changes.json`, each with its own `kind` and `schemaVersion: "1.0"`                                   | History must survive snapshot bumps; the snapshot model stays 1.4, so existing `public/data` stays readable    |
| D2  | A dedicated artifact `hub-history` (only `history.json`), 90 days retention, uploaded only for `data-source: github`                              | Longer than the 14-day `snapshots` retention; a manual mock run can never break the real chain                 |
| D3  | Restore with a small Node script (`npm run history:restore`) that uses Octokit and the existing zip reader                                        | Testable selection logic, size caps, provenance checks; no new action                                          |
| D4  | Mock source never restores: it always starts from the synthetic `fixtures/history/history.json`                                                   | Deterministic demo and golden files; mock and real history never meet                                          |
| D5  | Retention in policies: `history.enabled` (true), `history.maxEntries` (120), `history.maxAgeDays` (90)                                            | 120 = 30 days at the 6-hour schedule; bounded file size                                                        |
| D6  | The collector computes `changes.json`; the site only renders it                                                                                   | The diff needs the previous baseline, which the collector replaces                                             |
| D7  | Alerts are compared per (repository, source) pair, only when that pair was readable in **both** collections                                       | Prevents fake "resolved" and fake "new"                                                                        |
| D8  | CSV: RFC 4180, comma, CRLF, UTF-8 **with BOM**, English snake_case headers, one file set for both locales, `unknown` for null                     | BOM makes Excel read accents; stable machine-readable headers; null never becomes an empty cell that sums as 0 |
| D9  | CSV injection: a **string** cell starting with `=` `+` `-` `@` TAB or CR gets a leading `'`; numbers are never prefixed                           | OWASP guidance; the hub emits only non-negative numbers, so no negative number is ever corrupted               |
| D10 | Sparkline on a fixed 0–100 scale, server-rendered SVG, gaps for null                                                                              | Small moves do not look dramatic; no JS; unknown is never 0                                                    |
| D11 | A history or changes file that is missing or invalid never fails the site build; the page shows why. `validate:snapshots` fails on an invalid one | Older data and first runs keep working; CI still catches a broken file                                         |
| D12 | Entries keep only projects in the current catalog                                                                                                 | A removed (maybe confidential) project does not linger in a public file                                        |

## 5. Design

### 5.1 Files and versions (D1)

The snapshot set (`index.json`, `projects/*.json`, `catalog.json`) is unchanged and stays `schemaVersion` **1.4**. Two files are added next to it in the output directory:

| File           | `kind`        | `schemaVersion` | Read back by the collector? | Read by the site? |
| -------------- | ------------- | --------------- | --------------------------- | ----------------- |
| `history.json` | `hub-history` | `1.0`           | Yes (next run)              | Yes (trends)      |
| `changes.json` | `hub-changes` | `1.0`           | No (regenerated each run)   | Yes (page)        |

Why not bump the snapshot to 1.5 and embed history:

- The history file is the only input that crosses runs **and** releases. If it were part of the snapshot, the next snapshot bump (v0.8.0) would make the previous file unreadable, and every release would wipe the history.
- History has its own compatibility rule: a collector lists `SUPPORTED_HISTORY_SCHEMA_VERSIONS`. A later history version must be additive and ship an upgrader from `1.0`. An unsupported version starts fresh with state `incompatible` (§5.4). It is never partly read.
- Keeping the snapshot at 1.4 means no forced re-collect: an existing `public/data` without the new files still builds, and the pages say "no history yet".

The `kind` literal stops one file being parsed as the other.

`history.json` is serialised **without indentation** (it is the only large file). `changes.json` is pretty-printed like the snapshots. Both go through the same `assertPublishable` gate as the snapshots.

### 5.2 History model (`shared/model/history.ts`)

```ts
const projectId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);

HistoryProjectPointSchema = z.object({
  id: projectId,
  overall: HealthStatusSchema,
  score: z.number().int().min(0).max(100).nullable(), // null = insufficient data, never 0
  scoreMeasured: z.number().int().min(0),
  scoreRequired: z.number().int().min(0),
  /** Missing key = dimension not tracked at that time (older collector), not grey. */
  dimensions: z.partialRecord(DimensionSchema, HealthStatusSchema),
  open: z.object({ critical: nullableCount, high: nullableCount,
                   medium: nullableCount, low: nullableCount }).strict(),
  countsComplete: z.boolean(),
  collectionErrors: z.number().int().min(0),
}).strict();

HistoryEntrySchema = z.object({
  collectedAt: isoDate,                       // = index.generatedAt of that run
  dataSource: DataSourceSchema,
  authenticationMode: AuthenticationModeSchema,
  collectorVersion: z.string().max(50),
  projects: z.array(HistoryProjectPointSchema).max(500),
}).strict();

HistoryBaselineSchema = z.object({            // only for the latest entry
  collectedAt: isoDate,
  projects: z.array(z.object({
    id: projectId,
    /** Repositories whose alerts were collected in that run (security controls). */
    repositories: z.array(RepositoryRefSchema).max(500),
    /** Open critical/high alerts, at most 500 per project. */
    findings: z.array(z.object({
      id: z.string().max(200),
      severity: z.enum(['critical', 'high']),
      componentId: z.string().max(64),
      repository: z.string().max(200),
      source: FindingSourceSchema,
      htmlUrl: httpsUrl.nullable(),
    }).strict()).max(500),
    /** "owner/repo|source" pairs whose alerts could not be read in that run. */
    unreadable: z.array(z.string().max(250)).max(500),
    versions: z.array(z.object({
      kind: z.enum(['coordinator', 'component']),
      componentId: z.string().max(64).nullable(),   // null for the coordinator
      version: z.string().max(100).nullable(),
    }).strict()).max(200),
    /** "owner/repo|source|classification" keys of the run's collection errors. */
    errors: z.array(z.string().max(300)).max(500),
  }).strict()).max(500),
}).strict();

HistoryFileSchema = z.object({
  kind: z.literal('hub-history'),
  schemaVersion: z.enum(SUPPORTED_HISTORY_SCHEMA_VERSIONS),   // ['1.0']
  generatedAt: isoDate,
  retention: z.object({ maxEntries: z.number().int(), maxAgeDays: z.number().int() }).strict(),
  restore: z.object({ state: HistoryRestoreStateSchema, previousEntries: z.number().int().min(0) }).strict(),
  entries: z.array(HistoryEntrySchema).min(1).max(1000),       // oldest → newest
  baseline: HistoryBaselineSchema,
}).strict()
  .refine(f => f.baseline.collectedAt === f.entries.at(-1)!.collectedAt)
  .refine(entries strictly increasing by collectedAt);
```

- `HistoryRestoreStateSchema = z.enum(['restored', 'fixture', 'none', 'restore-failed', 'unreadable', 'incompatible', 'source-changed'])` (§5.4).
- Sources of each point:
  - a point comes from the run's `ProjectSummary`: `overall`, `score`, the six dimension statuses, `openCounts.{critical,high,medium,low}`, `countsComplete`, `collectionErrorCount`;
  - the baseline comes from the run's `ProjectSnapshot`.
- In the baseline:
  - `repositories` are the repositories of the project's security controls in that run, that is the repositories whose alerts were collected;
  - `findings` are the open alerts with severity critical/high;
  - `unreadable` lists every (repository, alert source) pair with a collection error for `code-scanning`, `dependabot`, `secret-scanning` or `security-status-file`. A `repository` error makes all four pairs of that repository unreadable;
  - `versions` are the coordinator version and each component's `effectiveVersion`;
  - `errors` are the de-duplicated collection error keys.
- Size (builder's estimate): about 250 bytes per project per entry. 50 projects × 120 entries ≈ 1.5 MB, well under the 20 MB scan cap.

### 5.3 Changes model

```ts
ChangesFileSchema = z
  .object({
    kind: z.literal('hub-changes'),
    schemaVersion: z.literal('1.0'),
    generatedAt: isoDate,
    basis: z
      .object({
        state: z.enum([
          'compared',
          'none',
          'restore-failed',
          'unreadable',
          'incompatible',
          'source-changed',
        ]),
        previousCollectedAt: isoDate.nullable(),
        synthetic: z.boolean(), // true when the previous points are mock fixtures
      })
      .strict(),
    totals: z.object({ statusChanges, newFindings, resolvedFindings, versionMoves, newErrors }), // ints
    projects: z.array(
      z
        .object({
          id: projectId,
          added: z.boolean(), // not in the previous entry → nothing compared
          previous: z
            .object({ overall: HealthStatusSchema, score: score.nullable() })
            .strict()
            .nullable(),
          current: z.object({ overall: HealthStatusSchema, score: score.nullable() }).strict(),
          statusChanges: z.array(
            z
              .object({
                dimension: z.union([DimensionSchema, z.literal('overall')]),
                from: HealthStatusSchema,
                to: HealthStatusSchema,
              })
              .strict(),
          ),
          newFindings: z
            .array({ id, severity, componentId, repository, title: shortText.nullable(), htmlUrl })
            .max(50),
          resolvedFindings: z.array({ id, severity, componentId, repository, htmlUrl }).max(50),
          findingsTruncated: z.number().int().min(0),
          /** Some (repository, source) pairs were unreadable in one of the two runs: not compared. */
          findingsPartial: z.boolean(),
          versionMoves: z.array({
            kind,
            componentId,
            from: z.string().max(100),
            to: z.string().max(100),
          }),
          newErrors: z.array({
            repository,
            source: CollectionErrorSchema.shape.source,
            classification,
          }),
          resolvedErrors: z.number().int().min(0),
        })
        .strict(),
    ),
  })
  .strict();
```

Diff rules (pure function, `collector/src/history/changes.ts`):

- **Previous** means the last restored entry and the restored baseline. When the restore state is not `restored` or `fixture`, `basis.state` takes that state (with `none` for `none`), every project has `added: false`, `previous: null` and empty lists, and `totals` are all 0. The page never reads those zeros as "no changes": it shows the basis message instead (§5.7).
- **Status changes:** `overall` first, then the six dimensions in `DimensionSchema` order, when `from !== to`. A move to or from `grey` is a change (it means "became unknown" or "became measurable"). A dimension missing from the previous point is not compared.
- **Findings:** only severities critical and high, keyed by finding `id`.
  - A current alert is **new** when its id is not in the previous baseline **and** its repository is in the previous `repositories` **and** its (repository, source) pair is not in the previous `unreadable` list.
  - A previous alert is **resolved** when its id is not open now **and** its repository is monitored now **and** its pair is not in the current `unreadable` list.
  - A repository monitored in only one of the two runs (a component added, removed or moved to another repository in the catalog) is not compared: its alerts existed before or still exist, they were just not monitored.
  - `findingsPartial` is true when any pair is unreadable in either run, or when the monitored repositories differ between the two runs.
  - Lists are sorted critical first, then by id, and capped at 50 each. The rest is counted in `findingsTruncated`.
  - A new alert carries the current snapshot's `title` (already withheld by the publication policy when needed). A resolved one carries no title.
- **Version moves:** coordinator version and each component's `effectiveVersion`, only when **both** values are known and differ. A known → unknown change is a visibility loss and shows up as a new collection error, not as a move.
- **Errors:** new = current keys not in the previous baseline; `resolvedErrors` = previous keys not current.
- A project not in the previous entry has `added: true` and nothing compared. A project in the previous entry but no longer in the catalog is dropped (D12).
- `totals` sum the lists over projects. `newFindings` and `resolvedFindings` include truncated items.

### 5.4 Loading previous history and its states

`loadPreviousHistory(opts)` in `collector/src/history/load.ts` returns `{ state, file: HistoryFile | null }`:

| Situation                                                          | `state`                                | File used                                                                      |
| ------------------------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------ |
| `history.enabled: false`                                           | n/a: no history and no changes written | none                                                                           |
| Data source `mock`                                                 | `fixture`                              | `fixtures/history/history.json`, `@now…` tokens resolved against the run clock |
| `HISTORY_RESTORE_STATE=failed` (CI could not fetch the artifact)   | `restore-failed`                       | none                                                                           |
| `HISTORY_RESTORE_STATE=none`, or no file at the history path       | `none`                                 | none                                                                           |
| File larger than 8 MiB (8 388 608 bytes), not JSON, or schema fail | `unreadable`                           | none                                                                           |
| `kind` correct but `schemaVersion` not supported                   | `incompatible`                         | none                                                                           |
| Valid, but `entries.at(-1).dataSource` differs from the run's      | `source-changed`                       | none                                                                           |
| Valid and same data source                                         | `restored`                             | yes                                                                            |

- The history path is `--history-from <dir>`, then `$HISTORY_FROM`, then the `--out` directory (default `public/data`). It reads `<dir>/history.json`. `--fresh-history` forces `none`.
- The file is untrusted input:
  - it is read with one handle and a size check (no check-then-use race, as in `scan-output.ts`);
  - it is parsed with the strict schema;
  - every `htmlUrl` is re-checked with `sanitizeUrl` against the **current** `publication.allowedLinkHosts`, and dropped to `null` when not allowed;
  - every `version` and finding `id` goes through `scrubIdentifier`;
  - the final output passes `assertPublishable`.
- Restored entries are cleaned before use:
  - entries with `collectedAt` at or after the current run are dropped;
  - entries are sorted and de-duplicated by `collectedAt`;
  - projects not in the current catalog are removed, and entries left empty are dropped.
- A fresh state never fails the collection. The state is written to `history.restore.state`, to `changes.basis.state`, and as one line in `collection-report.md`: for example `History: restored 12 previous collections` or `History: started fresh (restore-failed)`. The report reaches the job summary.

### 5.5 Appending and retention

`appendHistory(previous, run, policies, now)` in `collector/src/history/append.ts`:

1. Take the cleaned previous entries (empty when fresh).
2. Append the current entry built from `index.projects` and `index.run`.
3. Drop entries older than `now − maxAgeDays`, then keep the last `maxEntries`. The current entry always survives (`maxEntries ≥ 2`).
4. Replace the baseline with the current run's baseline.
5. Write `retention` (the effective values) and `restore` (`state` and the number of previous entries kept).

Policies (new optional block, `shared/model/policies.ts`, policies `schemaVersion` stays `1.0`):

```yaml
history:
  enabled: true # false = no history.json / changes.json, pages say "history is off"
  maxEntries: 120 # 2–1000; 120 ≈ 30 days at the 6-hour schedule
  maxAgeDays: 90 # 1–400; older entries are dropped
```

### 5.6 Persistence in GitHub Actions (D2, D3)

`collect-data.yml`, job `collect`:

- `permissions: { contents: read, actions: read }`. `actions: read` is there only to list and download this repository's own artifacts. The caller job `collect` in `deploy-pages.yml` gets the same `actions: read`, because a called workflow cannot exceed its caller.
- `concurrency: { group: hub-collect, cancel-in-progress: false }` on the job. Two collections never restore the same base and overwrite each other.
- New step **Restore previous history**, after "Validate configuration" and before "Collect", only when `data-source == 'github'`:
  - env `GITHUB_TOKEN: ${{ github.token }}`. The collector credentials are **not** given to this step.
  - It runs `npm run --silent history:restore -- --out .history-restore`.
  - It writes `state=restored|none|failed` and `reason=<code>` to `$GITHUB_OUTPUT`. It always exits 0.
- The **Collect** step gets two more env values: `HISTORY_FROM: .history-restore` and `HISTORY_RESTORE_STATE: ${{ steps.history.outputs.state }}`. Step outputs are mapped through env, never inlined, as the workflow already does.
- New step **Upload history artifact**, after "Upload snapshots artifact", only when `data-source == 'github'`:
  - `actions/upload-artifact` pinned to the same SHA as today;
  - `name: hub-history`, `path: public/data/history.json`, `retention-days: 90`, `if-no-files-found: warn`.
- `.history-restore/` is added to `.gitignore`. It is outside `public/data`, so nothing restored is published until the collector has re-validated and rewritten it.

`scripts/restore-history.ts`, with its selection logic in `collector/src/history/select-artifact.ts` (pure):

1. `GET /repos/{owner}/{repo}` (from `GITHUB_REPOSITORY`) → `id`, `default_branch`.
2. `GET /repos/{owner}/{repo}/actions/artifacts?name=hub-history&per_page=30`.
3. Keep artifacts where all of these hold:
   - `expired === false`;
   - `workflow_run.head_branch === default_branch`;
   - `workflow_run.repository_id === id` and `workflow_run.head_repository_id === id` (never a fork run);
   - `workflow_run.id !== GITHUB_RUN_ID`;
   - `size_in_bytes ≤ 5 MiB` (5 242 880).

   Sort them newest first.

4. For at most the first 5 candidates, `GET /actions/runs/{run_id}` and accept the first whose:
   - `path`, without any `@ref` suffix, is `.github/workflows/deploy-pages.yml` or `.github/workflows/collect-data.yml`;
   - `event` is one of `schedule`, `push`, `workflow_dispatch`, `repository_dispatch`.

   This is defence in depth: a pull-request workflow cannot plant a "history".

5. Download the zip (`rest.actions.downloadArtifact`, `archive_format: 'zip'`), then `readZipEntry(buf, 'history.json', 8_388_608)` (the existing `collector/src/util/zip.ts`). Write `.history-restore/history.json`.
6. Outcomes:

   | Outcome                             | `state`    | `reason`         |
   | ----------------------------------- | ---------- | ---------------- |
   | Downloaded and written              | `restored` | none             |
   | No candidate                        | `none`     | `no-artifact`    |
   | 403 on any call                     | `failed`   | `not-authorised` |
   | `ZipError` or an oversized artifact | `failed`   | `bad-archive`    |
   | Any other error                     | `failed`   | `api-error`      |

   The script prints only the state and the reason, never a payload or a URL with a token.

"Last successful run" (program spec §4) is defined as: the newest default-branch run of the hub's own deploy or collect workflow that reached the upload step. That step runs only after the collector and `validate:snapshots` have succeeded (builder's call). `history.json` is also inside the `snapshots` artifact, so the deploy job and the site see it as before.

Locally, `npm run collect -- --source github` appends to `public/data/history.json` with no flag, because the default history path is the output directory. Nothing needs `ci:build`.

### 5.7 UI

Data loading (`src/lib/data.ts`):

- `loadHistory()` and `loadChanges()` read `history.json` and `changes.json` from the snapshot directory.
- They return `{ ok: false, kind: 'missing' | 'invalid' }` instead of throwing (D11). An invalid file logs one warning at build time.

Shared rules:

- Charts are server-rendered inline SVG with Warm Graphite tokens, `aria-hidden`, and a text equivalent next to them. Status is shown by colour **and** shape: a strip cell's height encodes the status (red full, amber ⅔, green ⅓, grey a dashed outline at full height), and the text labels carry the meaning.
- A null score is a gap. A single isolated point is a dot. Values are never interpolated across gaps.
- A dimension missing from an older entry renders as "not tracked", never as grey.

**Portfolio** (`index.astro`):

- A new column **Trend** / **Andamento** after the score: a 96×20 sparkline of the last 30 points and a delta text, for example `▲ +14 · 12 d`, with the accessible label "Score up 14 points over 12 days (13 collections)".
- The delta compares the first and last **measured** points in the window.
- Fewer than 2 measured points: "Not enough measured points". No history file: "No history yet".
- On phones the trend sits under the score in the same cell (builder's call, following the existing responsive table).
- A "Download CSV" link to `exports/portfolio.csv` sits next to the list tools.

**Project page** (`projects/[id].astro`):

- A new block **Trend** / **Andamento** after the dimension cards (`<section id="trend">`):
  - a 320×56 sparkline with 0 and 100 guide labels;
  - an overall status strip, one cell per entry;
  - a sentence with first and last measured score, dates and number of collections;
  - the note "Gaps are collections where the score could not be measured; they are never drawn as 0.";
  - a `<details>` "Show history as a table": date, overall, score, the six dimensions as text badges, open critical/high. This table is the full text alternative.
- At most 120 points (the retention).
- A link "What changed for this project" to `changes/#p-<id>`.

**What changed** (`src/pages/[...lang]/changes.astro`, route `changes/`, `PageKey 'changes'`):

- The nav item sits right after Portfolio. Nav label: "What changed" / "Cosa è cambiato". Page title: "What changed since last collection" / "Cosa è cambiato dall'ultima raccolta".
- Lede:
  - `compared`: "Compared with the collection of {date} ({relative})." When `synthetic` is true, a note says "Demo data: earlier collections are synthetic."
  - Otherwise, one basis message per state (§5.8). None of them ever says "no changes".
- A summary line with the five totals, each a link to its first occurrence.
- One card per project, projects with changes first, then by current status (worst first), with id anchor `p-<id>`:
  - status changes as `Dimension: [from badge] → [to badge]`;
  - score `58 → 40`;
  - new critical/high alerts, linked to GitHub, with a "title withheld" label when the title is null;
  - resolved alerts (id and link only);
  - version moves `component: 3.0.2 → 3.1.0`;
  - new collection errors (repository, source, cause), plus "N errors no longer occur";
  - the `findingsPartial` note when true;
  - "No changes." when every list is empty;
  - "New in this collection: nothing to compare." when `added`.
- Missing `changes.json`: "No change data in this snapshot (collected before v0.7.0 or with history turned off)."

**Data quality**: a "History" card shows:

- the restore state as a sentence, for example "Restored 12 previous collections (oldest 3 Jan 2026)" or "Started fresh: the previous history could not be restored";
- the retention ("up to 120 collections, at most 90 days");
- the number of entries.

**How to read**: a new section `#trends` "Trends, changes and CSV" / "Andamento, cambiamenti e CSV". It explains:

- what a point is;
- that gaps are never 0 and values are never interpolated;
- the retention values, read from `policies.yaml` through `src/lib/policies.ts`;
- the alert comparison rule (only sources readable in both collections);
- the CSV conventions (UTF-8 with BOM, comma, `unknown` = not readable and never 0, `n/a` = not applicable, a leading apostrophe protects text that starts with `=`, `+`, `-` or `@`).

**Security and Versions** pages: one CSV link each (`exports/findings-summary.csv`, `exports/versions.csv`).

**Design-first** (standing owner rule): before coding the UI, the trend cell, the trend block and the changes page are drawn as artboards in the Claude Design canvas with Warm Graphite. The owner reviews after delivery, so this does not block. After the build, the canvas and the DS README are updated. No artifact link goes into the repository.

### 5.8 EN/IT strings (main ones; full list in the plan)

| Key                            | EN                                                                                                                                                      | IT                                                                                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `nav.changes`                  | What changed                                                                                                                                            | Cosa è cambiato                                                                                                                                                          |
| `changes.title`                | What changed since last collection                                                                                                                      | Cosa è cambiato dall'ultima raccolta                                                                                                                                     |
| `changes.basis.none`           | This is the first collection with history. Changes appear after the next collection.                                                                    | Questa è la prima raccolta con storico. I cambiamenti compariranno dopo la prossima raccolta.                                                                            |
| `changes.basis.restore-failed` | The previous history could not be restored, so changes cannot be computed. This does not mean "no changes".                                             | Non è stato possibile ripristinare lo storico precedente, quindi i cambiamenti non si possono calcolare. Non significa "nessun cambiamento".                             |
| `changes.basis.unreadable`     | The previous history file was not valid and was set aside. History starts again from this collection.                                                   | Il file dello storico precedente non era valido ed è stato scartato. Lo storico riparte da questa raccolta.                                                              |
| `changes.basis.incompatible`   | The previous history uses a format this version does not read. History starts again from this collection.                                               | Lo storico precedente usa un formato che questa versione non legge. Lo storico riparte da questa raccolta.                                                               |
| `changes.basis.source-changed` | The previous history came from another data source (mock or GitHub). History starts again from this collection.                                         | Lo storico precedente proveniva da un'altra fonte dati (mock o GitHub). Lo storico riparte da questa raccolta.                                                           |
| `changes.findingsPartial`      | Some alerts were not compared: their source was unreadable, or not monitored, in one of the two collections. They are never counted as new or resolved. | Alcuni alert non sono stati confrontati: la loro fonte non era leggibile, o non era monitorata, in una delle due raccolte. Non vengono mai contati come nuovi o risolti. |
| `trend.title`                  | Trend                                                                                                                                                   | Andamento                                                                                                                                                                |
| `trend.none`                   | No history yet                                                                                                                                          | Ancora nessuno storico                                                                                                                                                   |
| `trend.notEnough`              | Not enough measured points                                                                                                                              | Punti misurati insufficienti                                                                                                                                             |
| `trend.gapNote`                | Gaps are collections where the score could not be measured; they are never drawn as 0.                                                                  | I vuoti sono raccolte in cui il punteggio non era misurabile; non vengono mai disegnati come 0.                                                                          |
| `exports.portfolio`            | Download CSV                                                                                                                                            | Scarica CSV                                                                                                                                                              |
| `exports.findings`             | Alert summary (CSV)                                                                                                                                     | Riepilogo alert (CSV)                                                                                                                                                    |
| `exports.versions`             | Versions (CSV)                                                                                                                                          | Versioni (CSV)                                                                                                                                                           |

### 5.9 CSV export (D8, D9)

- Static Astro endpoints generate the files at build time from the same validated data the pages use:
  - `src/pages/exports/portfolio.csv.ts`
  - `src/pages/exports/findings-summary.csv.ts`
  - `src/pages/exports/versions.csv.ts`

  They are served at `<base>/exports/*.csv` and shared by both locales. Pages link to them with `exportHref(name)` in `src/lib/routes.ts`, which honours the base path. The link has a `download` attribute.

- Format (builder's call):
  - RFC 4180, comma separator, CRLF after every row including the last;
  - a UTF-8 BOM (`﻿`) at the start;
  - English snake_case headers;
  - booleans `true` / `false`, ISO dates;
  - `unknown` for a null value, `n/a` for a column that does not apply to the row.

  Excel with an Italian list separator (`;`) needs Data → From Text/CSV. This is documented, not worked around with a `sep=` line, which breaks other parsers and BOM detection.

- Cell encoding (`src/lib/csv.ts`, pure):
  1. A `number` is written with `String(n)`. The hub emits only non-negative numbers, so it is never prefixed.
  2. A `null` is written as `unknown`.
  3. A string whose first character is `=`, `+`, `-`, `@`, TAB or CR gets a `'` prefix.
  4. Then, if the cell contains `,`, `"`, CR or LF, it is wrapped in `"…"` with inner quotes doubled.
- Columns:
  - `portfolio.csv`: one row per project, in index order.
    `project_id, project_name, business_unit, lifecycle, overall, score, score_measured, score_required, delivery, version, security, controls_coverage, controls_coverage_percent, governance, quality, quality_percent, open_critical, open_high, open_medium, open_low, counts_complete, open_secret_alerts, failed_critical_workflows, collection_errors, collected_at, previous_overall, previous_score, previous_collected_at`.
    The `previous_*` columns come from the previous history entry (`n/a` when there is none). Using previous values instead of a delta keeps every number non-negative.
  - `findings-summary.csv`: one row per project × repository, from `securityControls` (so a repository with zero alerts still appears).
    `project_id, component_id, repository, open_critical, open_high, open_medium, open_low, open_informational, open_unknown, sources_complete`.
    - When none of the repository's alert sources was readable, all counts are `unknown`.
    - When some were readable, counts are numbers (a lower bound) and `sources_complete` is `false`.
    - No titles, rule ids or paths.
  - `versions.csv`: one row per coordinator, component and environment.
    `row_type (coordinator|component|environment), project_id, item_id, item_name, repository, version, version_source, declared_version, latest_release, drift, manifest_consistency, pin_status, environment_status`.
- `scripts/scan-output.ts` adds `.csv` to `TEXT_EXT`, so the publication gate scans the exports.

### 5.10 Mock history (synthetic, deterministic)

`fixtures/history/history.json` is a valid history `1.0` file except that timestamps are `@now-Nd` tokens. With `GOLDEN_NOW = 2026-01-15T12:00:00.000Z` they resolve to 3–14 Jan 2026 at 12:00. It has 12 daily entries (`@now-12d` … `@now-1d`), all `dataSource: mock`, `authenticationMode: mock`, `collectorVersion: 0.6.0`.

| Project  | Points (oldest → newest, then current run)                                                                                                                                       | Shows                                                    |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Alpha    | 64, 64, 66, 66, 68, 70, **null** (`@now-6d`, overall grey, governance green, other dimensions grey), 72, 72, 74, 76, 76 → current **78**; overall amber; previous delivery amber | Improving trend, a gap, a version move, a resolved alert |
| Beta     | 62, 62, 60, 60, 60, 58 ×7 → current **40**; previous overall amber, all six dimensions amber                                                                                     | Status drop, new critical, new collection error          |
| Platform | absent before `@now-9d`; 84 ×3 (quality amber) then 82 ×6 (quality red) → current **82**                                                                                         | Project added later (no invented points), no changes     |
| Gamma    | all null, all dimensions grey, counts null, 2 collection errors → current null                                                                                                   | Unknown throughout: no line, never 0                     |

The baseline (for `@now-1d`) is chosen so that the golden `changes.json` contains exactly:

- **Alpha:**
  - status change `delivery amber → green`, score 76 → 78;
  - resolved high `example-org/project-alpha-backend#code-scanning#9`;
  - version move `component frontend 2.0.3 → 2.1.0`;
  - the open `example-org/project-alpha-frontend#dependabot#7` is in the baseline, so it is not new.
- **Beta:**
  - `overall amber → red`, `delivery amber → red`, `security amber → red`, score 58 → 40;
  - new critical `example-org/project-beta-api#code-scanning#3` (title withheld);
  - new error `example-org/project-beta-web | secret-scanning | not-authorised` (the coordinator and api secret-scanning errors are in the baseline);
  - `findingsPartial: true`.
- **Platform:** no changes.
- **Gamma:** no changes, `findingsPartial: true` (repository errors).
- `totals`: `{ statusChanges: 4, newFindings: 1, resolvedFindings: 1, versionMoves: 1, newErrors: 1 }`.

The golden `history.json` has 13 entries, `restore.state: "fixture"`, `previousEntries: 12`. Trend values used in tests:

| Project  | Delta                      | Span    | Collections |
| -------- | -------------------------- | ------- | ----------- |
| Alpha    | +14                        | 12 days | 13          |
| Beta     | −22                        | 12 days | 13          |
| Platform | −2                         | 9 days  | 10          |
| Gamma    | not enough measured points |         |             |

`scripts/update-golden-snapshots.ts` takes the mock path, which reads the fixture every time and never the previous golden output, so `npm run fixtures:update` stays idempotent.

### 5.11 Docs (EN + IT)

- `configuration.md`: the `history` policies block, the collector flags `--history-from` and `--fresh-history`, the env `HISTORY_FROM` and `HISTORY_RESTORE_STATE`, the CSV files and their columns.
- `operations.md`:
  - how history persists (`hub-history`, 90 days);
  - restore states and what to do for each;
  - how to reset history (delete the `hub-history` artifacts or set `history.enabled: false` for one run);
  - concurrency;
  - the artifact retention table.
- `security.md`:
  - `actions: read` on the hub's own repository only;
  - the restored file treated as untrusted input (provenance checks, size caps, strict parse, re-sanitisation);
  - CSV injection protection;
  - what `history.json`, `changes.json` and the CSV files never contain.
- `architecture.md`: data flow (restore → collect → append → publish), new files, trust boundary row for the restore step.
- README (EN/IT):
  - Views table: the "What changed" row, the Trend column, the CSV links;
  - feature list;
  - roadmap: remove "history and trends, including a 'What changed since last collection' view" and "CSV export".
- `CHANGELOG.md` `[Unreleased]`.
- **ADR 0006** "History persisted through the hub's own Actions artifacts", EN + IT. It records:
  - D1 to D4;
  - the alternatives: a git branch or commit in the repository (rejected: needs `contents: write` and pollutes history), the GitHub Actions cache (rejected: evictable after 7 days unused, branch-scoped, not meant for state), an external store (rejected: new infrastructure or commercial dependency), history inside the snapshot (rejected: lost at every snapshot bump);
  - the consequences: up to 90 days without a run loses the chain; concurrency serialised; mock never restores.

## 6. Tests (summary; exact cases in the plan)

- **Unit, model:** strict schemas reject extra keys; reject a baseline date that differs from the last entry; reject non-increasing entries; `partialRecord` accepts a missing dimension; policies defaults 120 / 90 / true and bounds.
- **Unit, load:** each of the restore states in §5.4; the 8 MiB cap; a future entry is dropped; a removed project is pruned; a disallowed link host becomes `null`; a canary in a restored version never reaches the output.
- **Unit, append:** retention by age and by count; the current entry always kept.
- **Unit, changes:**
  - the golden scenario totals;
  - unreadable-pair rules in both directions;
  - grey transitions count;
  - version unknown → known is not a move;
  - truncation at 50;
  - fresh states give an empty diff with the right `basis.state`.
- **Unit, restore:** artifact selection (expired, other branch, fork `head_repository_id`, current run, oversized, wrong workflow path, `pull_request` event); 403 → `failed / not-authorised`; no candidate → `none`.
- **Unit, CSV:** cell encoding table; BOM; CRLF; `unknown` and `n/a`; golden column headers.
- **Unit, trend:** sparkline segments with gaps; delta and span; strip heights.
- **Integration, collector:** goldens including `history.json` and `changes.json`; idempotent `fixtures:update`; a canary in the history fixture blocked.
- **Integration, site:** `/changes/` and `/it/changes/` render; the Trend column; the project trend block and its table; Data quality history card; the CSV files exist in `dist/exports/` with BOM and headers; a build from a 1.4 snapshot without history still passes and says "No history yet".
- **e2e** (temp config on port 4377): nav to "What changed" on desktop and Pixel 7; trend `<details>` table opens by keyboard; the CSV link responds with `text/csv` (or at least 200 and the BOM).

## 7. Left to the builder

- Exact SVG geometry, tokens for the strip and the sparkline, responsive layout, following `DESIGN.md`.
- Ordering of cards and lists beyond what is fixed above.
- Whether `loadHistory` caches per directory like `loadSiteData` (expected: yes).
- The Octokit retry and throttling plugins in the restore script (expected: retry only, no throttling needed for at most 7 calls).
- Wording polish of EN/IT strings, keeping the meaning of §5.8.
