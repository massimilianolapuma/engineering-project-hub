# Operations

> 🇮🇹 [Versione italiana](it/operations.md)

## Scheduled workflows

| Workflow           | Schedule                                           | Notes                                                                                                                 |
| ------------------ | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `deploy-pages.yml` | `17 */6 * * *` (every 6 h, UTC)                    | `collect` → `build` → `deploy`. Also runs on push to `main` and on demand. `concurrency: pages` without cancellation. |
| `collect-data.yml` | on demand / `repository_dispatch` (`collect-data`) | Dry-run collection that produces the `snapshots` artifact and a job summary. It does not deploy.                      |
| `ci.yml`           | PR, push to `main`                                 | Quality gates on mock data only.                                                                                      |

GitHub may delay scheduled runs at busy times, and it disables schedules after 60 days with
no repository activity. Re-enable them in the Actions tab.

To change the frequency, edit the `cron` in `deploy-pages.yml`. Keep the stale threshold
(`freshness.snapshotStaleHours`) above the interval.

## Monitoring the collector

- **Job summary**: each collection appends `collection-report.md` (projects, overall
  state, error counts, classified errors) to the run summary.
- **Artifact** `snapshots` holds the sanitised JSON, including `collection-report.json`.
- **Data quality page** (`/data-quality/`) shows the last run, authentication mode,
  capability availability, inaccessible sources, stale sources, unresolved submodules and
  errors per project.
- **Stale banner**: the site shows a banner when the snapshot is older than
  `snapshotStaleHours`. This is computed in the viewer's browser, so a site that stopped
  updating is still flagged.
- Watch for failed `deploy-pages` runs. Failures are structural, such as invalid config,
  credentials, schema or sanitisation, and need action. Errors on individual repositories
  do **not** fail the run.

## Rate limits

- Cost is about `repos × 8 + tracked workflow targets × (1–2) + submodules + 2 × projects`
  REST calls per run. With the demo catalog, that is about 120.
- Octokit throttling retries once when the wait is ≤ 60 s (primary and secondary limits),
  with at most 4 calls in parallel.
- A GitHub App installation gets higher limits than a PAT. Prefer the App for large
  catalogs.
- If you see `rate-limited` errors, reduce the schedule frequency, split the catalog, or
  lower the concurrency in `collector/src/run.ts`.

## Manual re-run

- **Full refresh and publish**: Actions → _Deploy — GitHub Pages_ → _Run workflow_.
- **Collection only (dry run)**: Actions → _Collect — Data snapshots_ → _Run workflow_, choosing
  `mock` or `github`. Then download the `snapshots` artifact to inspect it.
- **External trigger**:
  `gh api repos/<owner>/<repo>/dispatches -f event_type=collect-data`. This collects
  without deploying.
- **Locally**: `DATA_SOURCE=github GH_READ_TOKEN=… npm run collect:github && npm run
validate:snapshots`.

## Stale data

1. Check the last `deploy-pages` run. If the schedule was disabled, re-enable it.
2. If runs succeed but sources are stale, the cause is upstream: workflows not running
   in monitored repositories, scans not executed, or status files not refreshed. Fix it
   there. The portal reports this; it does not fix it.
3. Tune the thresholds in `policies.yaml` only when they do not match the team's real
   cadence.

## Partial errors

| Class            | Typical cause                                                                    | Action                                                           |
| ---------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `not-authorised` | App not installed on the repository, missing permission, PAT scope               | Install the App or grant the read permission. Never grant write. |
| `not-found`      | Repository renamed or deleted, typo in the catalog                               | Fix `config/projects/<id>.yaml`.                                 |
| `not-configured` | Feature disabled (Dependabot alerts, secret scanning, no code scanning analysis) | Enable it in the repository, or mark it as not required.         |
| `rate-limited`   | Too many calls                                                                   | See "Rate limits".                                               |
| `invalid-data`   | Malformed manifest or status file, or one naming another repository              | Fix the file in the monitored repository.                        |
| `error`          | 5xx or network                                                                   | Usually transient. The next run retries.                         |

## Rollback

- **Site**: re-run a previous successful `deploy-pages` run (Actions → run → _Re-run all
  jobs_) or revert the commit on `main`. Pages serves the last deployed artifact until a
  new deploy succeeds.
- **Configuration or policies**: revert the change in `config/` (PR). The next run applies
  it.
- **Emergency** (data exposure): see [security.md → Response to accidental
  exposure](security.md#response-to-accidental-exposure). Disable Pages first.

## Publishing the quality summary from CI

The Quality dimension reads the artifact `hub-quality-summary` from each monitored
repository (contract: [Configuration](configuration.md#hub-quality-summary-artifact-each-repository-optional)).
Add two steps to the **same job that runs the tests and writes `coverage/cobertura.xml`**:
each job runs on a fresh runner, so a separate job would not see the coverage file. The steps
turn the Cobertura file into `quality-summary.json` and upload it, only on the default branch,
with a 30-day retention:

```yaml
test:
  runs-on: ubuntu-latest
  permissions:
    contents: read
  steps:
    - uses: actions/checkout@<full-commit-sha>
    # ... set up your toolchain ...
    - name: Run tests with coverage
      run: <your test command> # must write coverage/cobertura.xml
    - name: Write quality-summary.json
      if: github.ref == format('refs/heads/{0}', github.event.repository.default_branch)
      run: |
        python3 - <<'PY'
        import json, os, datetime
        import xml.etree.ElementTree as ET
        root = ET.parse('coverage/cobertura.xml').getroot()
        summary = {
            'schemaVersion': '1.0',
            'repository': os.environ['GITHUB_REPOSITORY'],
            'ref': os.environ['GITHUB_REF'],
            'commitSha': os.environ['GITHUB_SHA'],
            'generatedAt': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            'tool': 'coverlet',
            'format': 'cobertura',
            'lines': {
                'covered': int(root.get('lines-covered')),
                'valid': int(root.get('lines-valid')),
            },
        }
        json.dump(summary, open('quality-summary.json', 'w'))
        PY
    - uses: actions/upload-artifact@<full-commit-sha>
      if: github.ref == format('refs/heads/{0}', github.event.repository.default_branch)
      with:
        name: hub-quality-summary
        path: quality-summary.json
        retention-days: 30
```

Notes:

- Pin the action to a full commit SHA, like every action in this project.
- Keep the artifact name and file name exactly as above; the zip must stay under 64 KB.
- Upload it only from default-branch runs of the repository itself: runs from forks or other
  branches are ignored by the collector.
- Retention is also the freshness horizon: after the retention period the artifact expires
  and the report becomes `expired` (not visible, never 0%). Reports older than
  `freshness.qualityReportStaleDays` (14 by default) show as stale.
- Coverage is read from the Cobertura root attributes `lines-covered` and `lines-valid`.
  For other formats, compute the two numbers and set `format` accordingly.

## Local data and `ci:build`

`npm run ci:build` runs `collect:mock`, which overwrites `public/data`. A local real-data
snapshot (for example from `collect:github`) must be re-collected after it.

**Upgrading to snapshot 1.4** (Quality dimension): the site reads only `schemaVersion` 1.4.
An existing 1.3 `public/data` fails validation until it is re-collected (`collect:github`, or
the next scheduled run). Remember that `npm run ci:build` overwrites `public/data` with mock
data.

## Artifact retention

| Artifact                                             | Retention             | Content                                 |
| ---------------------------------------------------- | --------------------- | --------------------------------------- |
| `snapshots`                                          | 14 days               | Sanitised JSON + collection report      |
| `site`                                               | 1 day                 | Built `dist/`, handed to the deploy job |
| `github-pages`                                       | GitHub default        | Pages deployment artifact               |
| CI coverage report                                   | upstream default      | Vitest coverage (`coverage/`)           |
| `hub-quality-summary` (in each monitored repository) | 30 days (recommended) | `quality-summary.json`: counts only     |

Artifacts contain only sanitised, publishable data. They never contain credentials,
temporary files or raw payloads.
