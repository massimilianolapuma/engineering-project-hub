# scan-trivy

Composite action that wraps `aquasecurity/trivy-action` (pinned to a commit SHA) for
filesystem or container image scans, and uploads the SARIF report to GitHub Code Scanning.

## Inputs

| Input               | Required | Default               | Description                                                   |
| ------------------- | -------- | --------------------- | ------------------------------------------------------------- |
| `scan-type`         | yes      | —                     | `fs` or `image`                                               |
| `scan-ref`          | no       | `.`                   | Filesystem path to scan (`fs`)                                |
| `image-ref`         | no       | `''`                  | Image reference to scan (`image`)                             |
| `scanners`          | no       | `vuln,misconfig`      | Comma-separated scanners                                      |
| `severity`          | no       | `CRITICAL,HIGH`       | Comma-separated severities to report                          |
| `exit-code`         | no       | `0`                   | Exit code when findings are reported (`0` advisory, `1` fail) |
| `sarif-output`      | no       | `trivy-results.sarif` | SARIF output file name                                        |
| `sarif-category`    | no       | `trivy`               | GitHub Code Scanning category                                 |
| `db-already-cached` | no       | `false`               | Skip the DB cache restore when an earlier scan in the job ran |

## Usage

```yaml
# Filesystem scan
- name: Trivy — filesystem scan
  uses: ./.github/actions/scan-trivy
  with:
    scan-type: fs
    scan-ref: '.'
    scanners: 'vuln,misconfig,license'
    sarif-category: 'trivy-fs'

# Container image scan
- name: Trivy — image scan
  uses: ./.github/actions/scan-trivy
  with:
    scan-type: image
    image-ref: ghcr.io/owner/app:sha-abc1234
    exit-code: '1'
    sarif-category: 'trivy-container'
```

## Notes

- The calling job needs `security-events: write` for the SARIF upload (plus `actions: read`
  in private repositories).
- The SARIF upload runs with `if: always() && !env.ACT`: it runs even when Trivy reports
  findings (`exit-code` > 0) and is skipped under nektos/act.
- `ignore-unfixed: true` is applied to both scans to cut noise.
- Update the pinned `aquasecurity/trivy-action` SHA through Dependabot PRs only.
