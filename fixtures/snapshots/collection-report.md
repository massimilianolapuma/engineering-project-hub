## Engineering Project Hub — collection report

| Field | Value |
|---|---|
| Generated at | 2026-01-15T12:00:00.000Z |
| Data source | mock |
| Authentication | mock |
| Duration | 0 ms |
| Repositories | 12 total · 5 ok · 5 with errors · 2 unavailable |
| History | fixture · 13 entries |
| Metrics | written 298 series (25.4 KB) |

Exceptions: 7 loaded (fixture) · 3 active · 1 expired · 1 stale · 1 unverifiable · 1 orphaned

Providers: sonarqube partial (3 items, 1 error) · harbor available (3, 1 error) · argocd partial (5, 1 error)

### Projects

| Project | Overall | Collection errors |
|---|---|---|
| platform | red | 0 |
| project-alpha | amber | 1 |
| project-beta | red | 8 |
| project-gamma | grey | 3 |

### Collection errors

| Repository | Source | Classification | HTTP |
|---|---|---|---|
| example-org/project-alpha-frontend | harbor | not-found | 404 |
| example-org/project-beta-coordinator | secret-scanning | not-authorised | 403 |
| example-org/project-beta-api | secret-scanning | not-authorised | 403 |
| example-org/project-beta-web | secret-scanning | not-authorised | 403 |
| example-org/project-beta-api | dependency-sbom | not-authorised | 403 |
| example-org/project-beta-api | attestations | not-authorised | 403 |
| example-org/project-beta-coordinator | argocd | not-authorised | 403 |
| example-org/project-beta-helm | repository-rules | not-authorised | 403 |
| example-org/project-beta-coordinator | github-environments | not-authorised | 403 |
| example-org/project-gamma-coordinator | repository | not-found | 404 |
| example-org/project-gamma-service | repository | not-authorised | 403 |
| example-org/project-gamma-service | sonarqube | not-authorised | 403 |
