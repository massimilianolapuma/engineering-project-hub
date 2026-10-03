# Mattoni della CI

> English version: [docs/ci/workflows.md](../../ci/workflows.md)
> Decisione: [ADR 0003](../architecture/adr/0003-ci-building-blocks-and-collect-deploy-split.md)

La CI/CD è composta da piccoli **reusable workflow** (`.github/workflows/rw-*.yml`) e
**composite action** (`.github/actions/*`), chiamati da tre workflow di progetto: `ci.yml`,
`collect-data.yml` e `deploy-pages.yml`. Tutti i job girano su runner GitHub-hosted
(`ubuntu-latest`). I workflow con suffisso `-host` installano i tool direttamente sul runner
(tool cache) invece di usare un container di job.

Convenzioni comuni a tutti i file:

- ogni action di terze parti è pinnata a uno SHA di commit completo, con la versione in un
  commento;
- i permessi a livello workflow sono `contents: read`, e ogni scope aggiuntivo è concesso
  per singolo job con un commento che lo giustifica;
- input, output e dati dell'evento arrivano in `run:` solo tramite `env:`, mai come `${{ }}`
  dentro lo script;
- `actions/checkout` usa sempre `persist-credentials: false`;
- ogni job ha un `timeout-minutes`.

## Reusable workflow

| Workflow                     | Scopo                                                                                                                    | Input (default)                                                                                                                                                                                           | Permessi del job                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `rw-pr-title-lint.yml`       | Titolo della PR conforme a Conventional Commits (`amannn/action-semantic-pull-request`), con job summary                 | `types` (feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert), `require-scope` (`false`), `header-pattern`, `subject-pattern`, `exempt-branch-prefixes` (`release-please--branches--`) | `contents: read`, `pull-requests: write`, `statuses: write`                       |
| `rw-node-quality-host.yml`   | `npm ci`, poi i comandi di lint, typecheck e format check (un comando vuoto salta il suo step)                           | `node-version` (`24`), `working-directory` (`.`), `lint-command`, `typecheck-command`, `format-check-command` (`npm run <script> --if-present`)                                                           | `contents: read`                                                                  |
| `rw-npm-build-test-host.yml` | `npm ci`, comando di build, `npm run ci:test` (Vitest + coverage), artifact di coverage `coverage-<run_id>`              | `node-version` (`24`), `working-directory` (`.`), `build-command` (`npm run build --if-present`), `coverage-report-dir` (`coverage`)                                                                      | `contents: read`                                                                  |
| `rw-playwright-e2e-host.yml` | `npm ci`, `npx playwright install --with-deps <browsers>`, build, test Playwright con `CI=1`; trace caricate se fallisce | `node-version` (`24`), `working-directory` (`.`), `browsers` (`chromium`), `build-command` (`npm run build`), `test-command` (`npx playwright test`)                                                      | `contents: read`                                                                  |
| `rw-actionlint.yml`          | actionlint dal tarball di release, verificato con uno SHA-256 pinnato nel file (v1.7.12); shellcheck se disponibile      | `actionlint-version`, `actionlint-sha256`, `config-file`, `shellcheck` (`true`), `fail-on-error` (`true`)                                                                                                 | `contents: read`                                                                  |
| `rw-zizmor.yml`              | Audit di sicurezza zizmor su `.github/` (audit offline), SARIF verso Code Scanning + artifact del job                    | nessuno (config: `.github/zizmor.yml`)                                                                                                                                                                    | `contents: read`, `security-events: write`                                        |
| `rw-trivy-fs.yml`            | Scansione Trivy del filesystem (vuln, misconfig, license), SARIF verso Code Scanning (categoria `trivy-fs`)              | `scan-path` (`.`), `severity` (`CRITICAL,HIGH`), `exit-code` (`1`)                                                                                                                                        | `contents: read`, `security-events: write`                                        |
| `rw-pages-deploy-host.yml`   | GitHub Pages: job `build` (build interna o `artifact-name` pre-costruito), poi job `deploy` via OIDC                     | `artifact-name`, `node-version` (`24`), `working-directory` (`.`), `build-command` (`npm run build`), `output-dir` (`dist`), `environment-name` (`github-pages`)                                          | build: `contents: read`, `pages: read`; deploy: `pages: write`, `id-token: write` |

Ogni file inizia con un commento di intestazione che ne descrive lo scopo, un esempio di
chiamata e come provarlo in locale.

## Composite action

| Action           | Scopo                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `setup-node-env` | `actions/setup-node` con cache npm basata su `<working-directory>/package-lock.json`                         |
| `test-vitest`    | esegue `npm run ci:test`; la directory di coverage la decide la config Vitest del progetto (qui `coverage/`) |
| `scan-trivy`     | `aquasecurity/trivy-action` (log in tabella + SARIF) e `github/codeql-action/upload-sarif`                   |

## Workflow di progetto

| Workflow           | Trigger                                                                      | Job                                                                                                                                                                                                                                                              |
| ------------------ | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`           | `pull_request` verso `main` (anche modifiche del titolo), `push` su `main`   | `pr-title-lint` (solo PR), `node-quality`, `build-test` (`npm run ci:build`, coverage in `coverage/`), `e2e` (`npm run ci:build` + `npm run test:e2e`, Chromium), `actionlint`, `zizmor`, `trivy-fs` (advisory, `exit-code: "0"`). Nessun secret, solo dati mock |
| `collect-data.yml` | `workflow_call`, `workflow_dispatch`, `repository_dispatch` (`collect-data`) | `collect`: l'unico job che riceve credenziali. Risolve la data source (`input` → `vars.DATA_SOURCE` → `mock`), esegue il collector, valida gli snapshot e carica l'artifact `snapshots`                                                                          |
| `deploy-pages.yml` | `schedule` (`17 */6 * * *`), `push` su `main`, `workflow_dispatch`           | `collect` (chiama `collect-data.yml`), `build` (nessun secret: scarica `snapshots`, `npm run build:site`, `scan:output`, carica `site`), `deploy` (chiama `rw-pages-deploy-host.yml` con `artifact-name: site`)                                                  |

Il repository è pubblico, quindi GitHub Code Scanning è disponibile senza costi e `zizmor` e
`trivy-fs` caricano sempre il SARIF. Sono gli unici job con `security-events: write`.

## Eseguire i controlli in locale

```bash
# Lint dei workflow (stessa versione della CI: 1.7.12)
actionlint .github/workflows/*.yml

# Audit di sicurezza dei workflow, offline, con la config del repository
zizmor --offline .github/

# Job della CI con nektos/act, usando podman come container engine
podman machine start                       # macOS: avviare una volta la VM podman
export DOCKER_HOST="unix://$(podman machine inspect --format '{{.ConnectionInfo.PodmanSocket.Path}}')"
ACT_OPTS=(--container-daemon-socket - -P ubuntu-latest=catthehacker/ubuntu:act-latest)
act pull_request --workflows .github/workflows/ci.yml -j node-quality "${ACT_OPTS[@]}"
act pull_request --workflows .github/workflows/ci.yml -j build-test "${ACT_OPTS[@]}" \
  --env TMPDIR="$PWD/.astro"
act pull_request --workflows .github/workflows/ci.yml -j e2e "${ACT_OPTS[@]}"
act workflow_dispatch --workflows .github/workflows/collect-data.yml "${ACT_OPTS[@]}" \
  --input data-source=mock
```

`--container-daemon-socket -` evita che act monti il socket del container engine nel
container del job: qui non serve e non funziona con il socket della podman machine.

Note su act:

- Gli step con guard `!env.ACT` vengono saltati: l'upload verso Code Scanning e gli upload
  di artifact diagnostici (coverage, SARIF di zizmor, trace di Playwright). L'artifact
  server di act non supporta `actions/upload-artifact` v7, quindi anche l'upload di
  `snapshots` alla fine di `collect-data.yml` fallisce in locale; gli step precedenti
  vengono comunque verificati.
- Su Apple silicon aggiungere `--container-architecture linux/arm64` (o `linux/amd64`).
- Con podman, `build-test` richiede `--env TMPDIR="$PWD/.astro"` (una directory del
  workspace creata dallo step di build): il test di integrazione costruisce il sito in una
  directory temporanea, e nel container di act `/tmp` sta su un filesystem diverso dal
  workspace, cosa che rompe i rename di file di Astro (`EXDEV`). I runner GitHub-hosted non
  hanno questo problema.
- Il job `deploy` non si può eseguire in locale perché richiede OIDC e la Pages API reali.

## Impostazioni del repository

Sono impostazioni una tantum e non si possono applicare dai workflow:

- **Pages**: Settings → Pages → Source: "GitHub Actions". Finché non è impostata,
  `actions/configure-pages` fallisce perché `GET /repos/{owner}/{repo}/pages` risponde 404.
- **Environment `github-pages`**: creato da GitHub quando si abilita Pages. Aggiungere una
  deployment branch rule che consenta solo `main`.
- **Variabile `DATA_SOURCE`**: `mock` o `github`. Se non è impostata, il deploy usa `mock`.
- **Secret** (opzionali, servono solo con `DATA_SOURCE=github`): `GH_APP_ID`,
  `GH_APP_PRIVATE_KEY` e `GH_APP_INSTALLATION_ID` (preferiti), oppure `GH_READ_TOKEN`
  (fine-grained PAT in sola lettura). Senza secret il collector ripiega sul `GITHUB_TOKEN`
  del workflow, che può leggere solo questo repository.
- **Pull request** (consigliato): consentire solo lo squash merge, con il titolo della PR
  come messaggio di commit predefinito, e richiedere i check della CI su `main` con un
  ruleset.
- **`.github/zizmor.yml`** deve esistere: `rw-zizmor.yml` lo passa come `config`.

### Permessi della GitHub App per il collector (sola lettura)

La tabella associa ogni endpoint REST al permesso che richiede. Fonte:
[Permissions required for GitHub Apps](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps).
I nomi delle chiavi API vengono da
[Create an installation access token](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app).

| Endpoint                                                         | Permesso (nome UI)               | Chiave API               | Accesso |
| ---------------------------------------------------------------- | -------------------------------- | ------------------------ | ------- |
| `GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs` | Actions                          | `actions`                | read    |
| `GET /repos/{owner}/{repo}/releases/latest`                      | Contents                         | `contents`               | read    |
| `GET /repos/{owner}/{repo}/tags`                                 | Metadata                         | `metadata`               | read    |
| `GET /repos/{owner}/{repo}/contents/{path}`                      | Contents                         | `contents`               | read    |
| `GET /repos/{owner}/{repo}/code-scanning/alerts`                 | Code scanning alerts             | `security_events`        | read    |
| `GET /repos/{owner}/{repo}/dependabot/alerts`                    | Dependabot alerts                | `vulnerability_alerts`   | read    |
| `GET /repos/{owner}/{repo}/secret-scanning/alerts`               | Secret scanning alerts           | `secret_scanning_alerts` | read    |
| `GET /repos/{owner}/{repo}/deployments`                          | Deployments                      | `deployments`            | read    |
| `GET /repos/{owner}/{repo}/environments`                         | **Actions** (non "Environments") | `actions`                | read    |

Il permesso "Environments" (`environments`) copre solo i **secret e le variabili**
d'ambiente, ad esempio `GET …/environments/{environment_name}/secrets` e `…/variables`.
Per elencare gli environment serve **Actions: read**, quindi alla App "Environments" non
serve, a meno che non debba leggere le variabili d'ambiente. "Metadata: read" è sempre
concesso implicitamente.

## Aggiornare le versioni pinnate

Dependabot (`.github/dependabot.yml`) apre ogni settimana una PR raggruppata per le GitHub
Actions (`chore(ci)`) e una per npm (`chore(deps)`; le major in un gruppo separato).
Aggiorna gli SHA nei workflow e nelle composite action. actionlint non è un'action: per
aggiornarlo cambiare insieme `ACTIONLINT_DEFAULT_VERSION` ed entrambi i valori
`ACTIONLINT_SHA256_*` in `rw-actionlint.yml`, usando il `checksums.txt` della release. Dopo
ogni modifica eseguire `actionlint` e `zizmor --offline .github/` con zero finding.
