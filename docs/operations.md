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
- **Prometheus** (optional): alert on `time() - hub_collection_timestamp_seconds > 8 * 3600`
  (two missed collections) from `data/metrics/hub.prom`; see [Outputs](outputs.md#example-alerts).
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
- Repository controls add per unique repository: 1 call for the branch rules, 1 for the workflows directory and up to `maxWorkflowFiles` (30 by default) file reads, 1 for the Scorecard analysis, 1 more for classic protection when enabled, plus at most 3 calls per distinct referenced reusable-workflow repository (50 at most, so 150), once per run. A discovery run adds 1 call per scanned repository when `customProperties` is on. Lower `maxWorkflowFiles` or set `repositoryControls.enabled: false` to cut the cost.
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

**Team discovery** has its own state in `catalog.json` (`teams.status`) and in the collector log
(`Teams: <status>, <n> read, <n> suggestion(s), <n> not found`):

| State            | Meaning                                                        | Action                                                                                           |
| ---------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `ok`             | Every organisation and team was read.                          | None.                                                                                            |
| `partial`        | A team or organisation call failed, or `maxTeams` was reached. | Check `teams.errors`; raise `maxTeams` if needed. "Not found" is not computed on a limit.        |
| `not-authorised` | No organisation's teams could be read.                         | Grant the organisation permission **Members: read** to the App, or set `teams.discovery: false`. |
| `teams: null`    | Team discovery is off, or the audience is public.              | Expected for a public site.                                                                      |

## Rollback

- **Site**: re-run a previous successful `deploy-pages` run (Actions → run → _Re-run all
  jobs_) or revert the commit on `main`. Pages serves the last deployed artifact until a
  new deploy succeeds.
- **Configuration or policies**: revert the change in `config/` (PR). The next run applies
  it.
- **Emergency** (data exposure): see [security.md → Response to accidental
  exposure](security.md#response-to-accidental-exposure). Disable Pages first.

## Enforcing repository controls

Repository checks are informative by default. To make some of them count for Governance:

1. Open the project pages and read **Repository controls**. Fix or accept what you see; remember
   that "not visible" means the credentials cannot read the data, not that the check fails.
2. Optional, for the three branch-rule checks: classic branch protection is invisible without
   **Administration: read**. Grant that read-only permission to the GitHub App (or the
   fine-grained token) and set `repositoryControls.readClassicProtection: true`. It is off by
   default and the call is never made while it is `false`.
3. In `config/policies.yaml` set one check at a time to `amber` (or `red`) under
   `repositoryControls.checks`, optionally list `exemptActionOwners` (for example `actions`).
   Keep `unknownEnforcedCheck: info` until the data is complete.
4. Run `npm run validate:config`, merge, and read the next collection: the Governance reason
   `repository-check-failed` names the check and the repositories. Governance moves only when
   an enforced check fails.
5. To silence a check for one repository, add it to `notApplicableChecks` in the catalog.

See [Configuration](configuration.md#repository-controls-repositorycontrols).

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

## Publishing the supply chain summary from CI

The supply-chain controls read the artifact `hub-supply-chain-summary` from each monitored
repository (contract: [Configuration](configuration.md#hub-supply-chain-summary-artifact-each-repository-optional)).
It is the only way the hub learns that a signature or provenance was **verified**, and the only
source of image digests. Add a job like this one to the workflow that builds and pushes the image,
on the default branch only. It writes a CycloneDX SBOM with syft, verifies the image signature with
cosign and its provenance with `gh attestation verify`, writes the counts with an inline `jq`
program (the hub ships no script for this) and uploads the summary with a 30-day retention:

```yaml
supply-chain-summary:
  if: github.ref == format('refs/heads/{0}', github.event.repository.default_branch)
  needs: build # the job that pushed the image and exposes its digest and version
  runs-on: ubuntu-24.04
  permissions:
    contents: read
    packages: read
    attestations: read
  steps:
    - uses: actions/checkout@<full-commit-sha>
      with:
        persist-credentials: false
    # ... install syft and cosign (pinned versions) ...
    - name: SBOM (CycloneDX)
      run: syft dir:. -o cyclonedx-json=sbom.cdx.json
    - name: Verify image signature and provenance
      id: verify
      env:
        GH_TOKEN: ${{ github.token }}
        IMAGE: ghcr.io/${{ github.repository }}@${{ needs.build.outputs.digest }}
      run: |
        sig=verified
        cosign verify "$IMAGE" \
          --certificate-identity-regexp "^https://github.com/${GITHUB_REPOSITORY}/" \
          --certificate-oidc-issuer https://token.actions.githubusercontent.com >/dev/null 2>&1 || sig=not-verified
        prov=verified
        gh attestation verify "oci://$IMAGE" -R "$GITHUB_REPOSITORY" >/dev/null 2>&1 || prov=not-verified
        echo "sig=$sig" >> "$GITHUB_OUTPUT"
        echo "prov=$prov" >> "$GITHUB_OUTPUT"
    - name: Write supply-chain-summary.json
      env:
        DIGEST: ${{ needs.build.outputs.digest }}
        TAG: ${{ needs.build.outputs.version }}
        SIG: ${{ steps.verify.outputs.sig }}
        PROV: ${{ steps.verify.outputs.prov }}
      run: |
        jq -n \
          --arg repo "$GITHUB_REPOSITORY" --arg ref "$GITHUB_REF" --arg sha "$GITHUB_SHA" \
          --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
          --arg image "${GITHUB_REPOSITORY,,}" --arg tag "$TAG" --arg digest "$DIGEST" \
          --arg sig "$SIG" --arg prov "$PROV" \
          --slurpfile sbom sbom.cdx.json '
          def lic: [.licenses[]? | .license.id // .expression // empty] | join(" AND ");
          def counts: group_by(.) | map({ id: .[0], count: length }) | sort_by(-.count) | .[:20];
          ($sbom[0].components // []) as $c
          | {
              schemaVersion: "1.0",
              repository: $repo, ref: $ref, commitSha: $sha, generatedAt: $now,
              sbom: {
                format: "cyclonedx", specVersion: $sbom[0].specVersion, tool: "syft",
                packages: ($c | length),
                withoutLicense: ([$c[] | select(lic == "")] | length),
                licenses: ([$c[] | lic
                  | select(. != "" and length <= 100 and test("^[A-Za-z0-9.+()\\s-]+$"))] | counts),
                ecosystems: ([$c[] | (((.purl // "") | capture("^pkg:(?<t>[a-z]+)/") | .t) // "unknown")
                  | if IN("npm", "maven", "pypi", "nuget", "golang", "cargo", "gem", "composer",
                          "githubactions", "docker", "pub", "swift", "hex", "unknown")
                    then . else "other" end] | counts)
              },
              images: [{
                name: $image, tag: $tag, digest: $digest,
                signature: { status: $sig, tool: "cosign" },
                provenance: { status: $prov, tool: "gh-attestation" }
              }]
            }' > supply-chain-summary.json
    - uses: actions/upload-artifact@<full-commit-sha>
      with:
        name: hub-supply-chain-summary
        path: supply-chain-summary.json
        retention-days: 30
```

Notes:

- Pin every action to a full commit SHA and every tool to an exact version.
- `name` is the image path **without** the registry host, in lowercase (`${GITHUB_REPOSITORY,,}`
  for an image named after the repository on `ghcr.io`).
- Only SPDX ids and expressions are written as licenses; a component whose license is only a free
  name counts as "without license". The hub groups every `LicenseRef-…` as `LicenseRef-*` and never
  publishes the custom names.
- A repository that builds no image drops the `images` block (and the verify step); a repository
  that only signs images can drop `sbom`.
- If a verification fails, the step still writes `not-verified`: the hub then shows the control as
  failed, never as verified.
- The same retention and freshness rules as the quality summary apply
  (`freshness.supplyChainSummaryStaleDays`, 14 days by default).

**Trivy, Checkov and ZAP.** Upload their results as SARIF to code scanning with
`github/codeql-action/upload-sarif`; the hub reads them through the code-scanning analyses of each
tool (`supplyChain.toolControls`):

| Tool    | Report                                           | Tool name in code scanning | Control             |
| ------- | ------------------------------------------------ | -------------------------- | ------------------- |
| Trivy   | `aquasecurity/trivy-action` with `format: sarif` | `Trivy`                    | `containerScanning` |
| Checkov | `checkov -o sarif` (keep the default tool name)  | `Checkov`                  | `iacScanning`       |
| ZAP     | ZAP report `sarif-json`                          | `ZAP`                      | `dast`              |

If your tool reports under another name, or Trivy also scans IaC, add a rule with a `category`
prefix (for example `{ tool: Trivy, category: trivy-config }` under `iacScanning`) instead of
renaming the tool.

## Enabling an external provider

SonarQube, Harbor and Argo CD are off until you enable them. For each one:

1. **Configure it.** In the config directory (the private deploy repository for real data), set
   `enabled: true` and `baseUrl` in `providers.yaml`
   ([Configuration](configuration.md#external-providers-configprovidersyaml)).
2. **Map what to read.** Add `sonarProjectKey` (SonarQube), `containerImages` (Harbor) or
   `argocdApplication` (Argo CD) to the project files
   ([Provider mappings](configuration.md#provider-mappings-sonarprojectkey-containerimages-argocdapplication)).
   Run `npm run validate:config`.
3. **Create the credential** with the minimum permissions listed in
   [Security](security.md#external-providers) and store it as a repository or environment secret
   (`SONARQUBE_TOKEN`, `HARBOR_ROBOT_NAME` + `HARBOR_ROBOT_SECRET`, `ARGOCD_TOKEN`). The deploy
   workflow passes it to `collect-data.yml`, which maps it only into the Collect step.
4. **Run a collection** (manual re-run). The log warns when an enabled provider has no
   credential.
5. **Read the Providers card** on the Data quality page: `available` means every mapped item was
   read; `partial` that some were not (see the counts); `not-authorised` that the credential is
   missing or lacks a permission; `unknown` that the provider could not be reached. Items beyond
   `maxItems` are unknown, never 0.

To turn a provider off again, set `enabled: false`: its items disappear from the views at the next
collection and the secret is no longer read.

## Managing security exceptions and SLAs

An exception is a pull request on `config/exceptions.yaml` (CODEOWNERS asks the owner to review it).
The format and the rules are in [Configuration](configuration.md#security-exceptions-configexceptionsyaml).

1. **Add:** append an entry with an owner, a reason, today's date as `created` (a future date is rejected) and an `expires` date
   within `exceptions.maxDays` (180 by default). Prefer an `alert` selector; use `rule` (with `tool`)
   or `advisory` only for recurring findings.
2. **Check locally:** `npm run policy:check`. It validates the file (errors fail, warnings explain),
   prints the policy explanation and runs the decision cases.
3. **See the effect before merging:** `npm run policy:check -- --snapshot public/data` re-evaluates the
   last collected snapshot with the current exceptions and policies and prints `unchanged:` or
   `would change:` per project. It is read-only and writes nothing. Exceptions on withheld findings
   are reported as not evaluable from a published snapshot.
4. **CI:** the `policy-check` job runs the same command on every pull request and push to `main`
   (no path filter, so a required check always reports). `npm run validate:config` also validates the file in
   the collect and deploy workflows, so a broken file fails before collection.
5. **Renew:** a new `expires` (and a fresh `reason` and `created` if the review happened again), never
   beyond `maxDays` from `created`. **Remove:** delete the entry; the alert counts again at the next
   collection.
6. **Acting on the Data quality card:** _expired_ entries are renewed or removed; _stale_ entries
   (matching no open alert) are removed; _not verifiable_ entries wait for the source to be readable
   again (fix the credentials, see "Partial errors"); _orphaned_ entries name a repository that is
   in no catalog project (fix the catalog or delete the entry).

**Opting in to SLA escalation.** By default an overdue alert is informative. To make it count, set
`remediation.overdue.<class>` to `amber` or `red` in `config/policies.yaml` (the demo does it for
critical and high). Run `npm run policy:check -- --snapshot public/data` first: it shows which
projects would change. The first collection after the change may move projects at once, because the
SLA clock started when the alert was created; those findings appear as a Security status change in
"What changed", not as "newly overdue".

## History between runs

Each collection appends one compact point per project to `history.json`, and the collector
diffs it against the previous one to write `changes.json` (the "What changed" page). The
runner starts empty every time, so GitHub Actions carries the history:

- the `collect` job runs `npm run history:restore` first. It reads the hub's **own** newest
  `hub-history` artifact with `GITHUB_TOKEN` and `actions: read` (never the collector
  credentials), then the collector appends and writes the new file;
- the job uploads a new `hub-history` artifact (only `history.json`, 90 days), only for
  `data-source: github` and only when the restore ended `restored` or `none`. After a
  `failed` restore (or a restore step that crashed) nothing is uploaded: the fresh
  one-entry history would become the newest artifact and drop the whole chain, so the
  previous artifact stays newest and the next run tries again. A manual mock run can never
  break the real chain;
- a mock run never restores: it starts from the synthetic `fixtures/history/history.json`.

The restore pages through up to 500 artifacts (5 pages of 100), newest first, and if a
trusted artifact is not a valid archive it tries the next trusted one (up to 3 bad archives)
before giving up with `bad-archive`.

Only artifacts of the default branch, of this repository (not a fork), from another run, up
to 5 MiB and from the deploy or collect workflow are accepted. Anything else is not used.

### Restore states

The state is in `history.json` (`restore.state`), in `changes.json` (`basis.state`), in the
Data quality "History" card and in the job summary. A state other than `restored` never
fails the collection, and the "What changed" page then explains it instead of saying "no
changes".

| State            | Meaning                                                                                                   | What to do                                                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `restored`       | The previous history was read and extended.                                                               | Nothing.                                                                                                                                        |
| `fixture`        | Mock run, started from the synthetic fixture.                                                             | Nothing. Demo data.                                                                                                                             |
| `none`           | No previous history (first run, expired artifacts, `--fresh-history`).                                    | Nothing. Changes appear after the next collection.                                                                                              |
| `restore-failed` | The artifact could not be fetched (not authorised, bad archive, API error).                               | Check that the `collect` job has `actions: read` (the workflow log prints the reason code). Nothing is uploaded, so the next run retries.       |
| `unreadable`     | The previous file was too large, not JSON, failed the schema or could not be published; it was set aside. | Usually a one-off. Check the previous run if it repeats.                                                                                        |
| `incompatible`   | The previous file uses a schema version this version does not read.                                       | Nothing: history starts again from this collection.                                                                                             |
| `source-changed` | The previous history came from the other data source (mock or GitHub).                                    | Nothing: history starts again from this collection. Older entries from the other source, behind a matching last entry, are dropped with a note. |

History never blocks the snapshots. If the restored history passes the checks but still
cannot be published, it is set aside (state `unreadable`). If even a fresh history cannot be
built, `history.json` and `changes.json` are not written for that run, the snapshots are,
and the job summary shows `History | not written this run` with the reason under "History
notes".

Limits: history covers at most 500 projects (a larger catalog gets no history and a note).
Per project it keeps at most 500 repositories, open critical/high alerts, unreadable sources
and error keys, and 200 versions. A list at its limit may have been cut, so the next "What
changed" lists no new alerts (or errors) for that project and marks it partial. If
`history.json` would exceed the 8 MiB the next run reads, the oldest collections are dropped
with a note.

### Resetting history

Run the **Collect — Data snapshots** workflow manually (`workflow_dispatch`) with
`data-source: github` and `fresh-history: true`. It skips the restore, records the reason
`fresh-history` in the job summary, and its new history replaces the chain. Alternatively,
delete all the `hub-history` artifacts (repository, Actions, Artifacts); the next
collection starts fresh (state `none`). Setting `history.enabled: false` does **not** reset
anything: no new artifact is uploaded, so the old one is restored again when you turn it
back on.

### Concurrency and expiry

The `collect` job runs under the concurrency group `hub-collect` with
`cancel-in-progress: false`, so two collections never restore the same base and overwrite
each other. The artifact lives 90 days: if no collection runs for longer, the chain is lost
and history starts again (state `none`).

## Local data and `ci:build`

`npm run ci:build` runs `collect:mock`, which overwrites `public/data`. A local real-data
snapshot (for example from `collect:github`) must be re-collected after it.

**Upgrading to snapshot 1.5** (repository controls): the site reads only `schemaVersion` 1.5. An existing 1.4 `public/data` fails validation until it is re-collected (`collect:github`, or the next scheduled run). `history.json` 1.0 is still read; the history schema moves to 1.1 on the first collection.

**Earlier note, snapshot 1.4** (Quality dimension): the site reads only `schemaVersion` 1.4.
An existing 1.3 `public/data` fails validation until it is re-collected (`collect:github`, or
the next scheduled run). Remember that `npm run ci:build` overwrites `public/data` with mock
data.

A local `npm run collect:github` appends to `public/data/history.json` (the default history
path is the output directory), so a local real-data history grows between runs like the CI one.
`npm run ci:build` writes mock history over it.

## Artifact retention

| Artifact                                             | Retention             | Content                                 |
| ---------------------------------------------------- | --------------------- | --------------------------------------- |
| `snapshots`                                          | 14 days               | Sanitised JSON + collection report      |
| `site`                                               | 1 day                 | Built `dist/`, handed to the deploy job |
| `github-pages`                                       | GitHub default        | Pages deployment artifact               |
| CI coverage report                                   | upstream default      | Vitest coverage (`coverage/`)           |
| `hub-quality-summary` (in each monitored repository) | 30 days (recommended) | `quality-summary.json`: counts only     |
| `hub-history`                                        | 90 days               | `history.json`: compact points only     |

Artifacts contain only sanitised, publishable data. They never contain credentials,
temporary files or raw payloads.
