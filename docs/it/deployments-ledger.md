# Registro dei deploy

> Versione inglese: [docs/deployments-ledger.md](../deployments-ledger.md)

Le GitHub Deployments sono il **registro di ogni deploy di ogni ambiente** di una repository
([ADR 0015](architecture/adr/0015-deployments-ledger.md)). I deploy DEV e di laboratorio fatti da
GitHub Actions ci sono già: un job con `environment:` crea un deployment. Gli ambienti di test,
pre-produzione e produzione rilasciati da altri sistemi si aggiungono con uno di tre scrittori:

| Scrittore                                           | Come                                                                                                   | Quando                                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| **Push** (`scripts/report-deployment.sh`)           | un ultimo step nel job di deploy esterno registra il deploy e il suo esito                             | si può modificare la pipeline esterna; in tempo reale                             |
| **Bridge in lettura** (`rw-deployments-bridge.yml`) | un workflow GitHub programmato legge in sola lettura i record di deploy degli environment Azure DevOps | non si possono o non si vogliono toccare le pipeline; ritardo = la programmazione |
| **Dichiarato** (`rw-deployments-declare.yml`)       | un form manuale, approvato da una seconda persona, marcato `declared`                                  | nessun sistema può registrare il deploy                                           |

L'hub legge il registro con il segnale di deploy `github-deployments`
([Mappa dei controlli](control-map.md)): i controlli di rilascio diventano misurabili per ogni
ambiente, e `environment-separation` vede gli ambienti che GitHub ora conosce.

## Il record

Un deploy del commit `SHA` nell'ambiente `E` è un deployment GitHub su `SHA` con ambiente `E`,
seguito da uno stato `success` o `failure` il cui `log_url` punta all'esecuzione esterna. Il suo
`payload`:

```json
{
  "ledger": 1,
  "source": "azure-devops",
  "runId": "12345",
  "runUrl": "https://dev.azure.com/example-org/example-project/_build/results?buildId=12345",
  "attempt": 1,
  "version": "0.5.2",
  "startedAt": "2026-11-04T09:12:00Z",
  "finishedAt": "2026-11-04T09:20:31Z",
  "declared": false,
  "kind": "deploy"
}
```

- `finishedAt` è la fine **reale** del deploy. Gli orari di GitHub sono l'ora di scrittura e non
  si possono retrodatare, quindi l'hub usa `finishedAt` (un bridge che recupera 90 giorni mostra
  comunque ogni deploy alla sua data reale).
- Un deploy è identificato da `source`, `runId`, `attempt` e ambiente: scriverlo due volte non
  cambia nulla; uno stage ripetuto (`attempt` 2) è un record nuovo, quindi un fallimento seguito
  da un successo vale come un deploy fallito e il suo ripristino.
- `kind: rollback` indica un rollback; l'hub legge come rollback anche una versione più bassa del
  deploy precedente.
- Un commit che GitHub non conosce (mirror in ritardo) non viene mai registrato: gli scrittori lo
  saltano e lo segnalano.
- Lo JSON Schema della mappa del bridge è `config/schema/deployments-bridge.schema.json`.

## La GitHub App che scrive

Una GitHub App per organizzazione GitHub, per esempio `<org>-deployment-reporter`:

- permessi di repository: **Deployments: read and write** (Metadata: read lo aggiunge GitHub);
  nient'altro: niente codice, niente Actions, niente impostazioni;
- webhook spento; installabile "Only on this account"; installata sulle repository che servono;
- **una chiave privata per linea o progetto esterno**, revocabile da sola; ogni token viene
  ristretto a una repository e a `deployments: write` al momento della richiesta.

Limite noto (accettato dal responsabile): qualunque chiave dell'App può chiedere un token per
qualunque repository dove l'App è installata, e GitHub non registra quale chiave ha scritto.
Tenere le chiavi nei gestori di segreti dei sistemi esterni, ruotarle e revocare una chiave quando
un progetto finisce. L'unico permesso in gioco è Deployments.

L'hub mantiene la propria App in sola lettura; per leggere il registro le serve **Deployments:
read**. Il bridge in lettura la usa anche per verificare che un commit esista e per leggere il
file della versione (D11): le chiavi di scrittura non leggono mai il codice.

## Push: uno step alla fine del deploy esterno

Requisiti: l'agente raggiunge `https://api.github.com` (gli agenti Microsoft-hosted sì; un agente
self-hosted nella rete di un cliente ha bisogno di accesso in uscita o di un proxy), e il mirror
conserva gli SHA dei commit. `scripts/report-deployment.sh` richiede bash, openssl, curl e jq.
Esempio Azure DevOps, nel job di deploy di ogni ambiente:

```yaml
- task: DownloadSecureFile@1
  name: ghAppKey
  inputs:
    secureFile: github-deployment-reporter.pem
- bash: |
    # Agent.JobStatus qui vale Succeeded, SucceededWithIssues, Failed o Canceled.
    case "$AGENT_JOBSTATUS" in
      Succeeded | SucceededWithIssues) STATE=success ;;
      Failed) STATE=failure ;;
      *) echo "deploy $AGENT_JOBSTATUS: not recorded"; exit 0 ;;
    esac
    STATE="$STATE" FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)" ./scripts/report-deployment.sh
  displayName: Report deployment to GitHub
  condition: always()
  env:
    GH_APP_ID: $(GITHUB_DEPLOY_APP_ID)
    GH_INSTALLATION_ID: $(GITHUB_DEPLOY_INSTALLATION_ID)
    GH_KEY_FILE: $(ghAppKey.secureFilePath)
    GH_OWNER: example-org
    GH_REPO_NAME: example-service
    SHA: $(Build.SourceVersion)
    ENV_NAME: prod # id dell'ambiente nel catalogo dell'hub
    RUN_ID: $(Build.BuildId)
    ATTEMPT: $(System.StageAttempt)
    RUN_URL: $(System.CollectionUri)$(System.TeamProject)/_build/results?buildId=$(Build.BuildId)
    PRODUCTION: 'true'
```

`scripts/report-deployment.sh` va copiato nella repository esterna (o preso da una release
dell'hub). Un deploy annullato non viene registrato, come nel bridge. Un commit che GitHub non
conosce restituisce HTTP 422: lo script esce con 0 e il messaggio "commit not on GitHub", così il
job di deploy non fallisce.

## Bridge in lettura: Azure DevOps → GitHub

Il bridge legge, per ogni environment Azure DevOps mappato, i suoi record di deploy (api-version
7.1, verificata su Microsoft Learn il 2026-11-04):

- `GET https://dev.azure.com/{org}/{project}/_apis/distributedtask/environments?name=…`
- `GET …/_apis/distributedtask/environments/{id}/environmentdeploymentrecords?top=100`
  (record: `result`, `startTime`, `finishTime`, `definition.id` = pipeline, `owner.id` =
  esecuzione, `stageAttempt`)
- `GET …/_apis/pipelines/{pipelineId}/runs/{runId}` (`resources.repositories[alias].version` =
  il commit)

Esiti: `succeeded` e `succeededWithIssues` → `success`, `failed` → `failure`; i deploy annullati,
saltati, abbandonati o in corso non vengono scritti. Al massimo 100 record per ambiente ed
esecuzione.

1. **Mappa** nella repository chiamante, `config/deployments-bridge.yaml`
   ([esempio](../../examples/deployments/deployments-bridge.yaml)): organizzazione, progetto ed
   environment Azure DevOps → repository e ambiente GitHub, `production`, `versionFrom`
   facoltativo (file e chiave della versione promossa) e `commitFrom` (alias della repository
   quando lo YAML della pipeline sta altrove).
2. **Identità Azure DevOps** (consigliata, nessun segreto salvato): una app registration Microsoft
   Entra con una federated credential per la repository chiamante (issuer
   `https://token.actions.githubusercontent.com`, subject `repo:<owner>/<repo>:ref:refs/heads/main`
   o l'ambiente usato), aggiunta all'organizzazione Azure DevOps come utente (Basic o Stakeholder)
   con accesso in lettura al progetto e ai suoi environment. Impostare le variabili di repository
   `ADO_TENANT_ID` e `ADO_CLIENT_ID`. Alternativa: un PAT con Environment: read e Build: read, come
   segreto `ADO_PAT`.
3. **Segreti** della repository chiamante: `LEDGER_APP_ID`, `LEDGER_APP_PRIVATE_KEY` (App dei
   deploy), `GH_APP_ID`, `GH_APP_PRIVATE_KEY` (App di lettura dell'hub).
4. **Workflow chiamante**: [esempio](../../examples/deployments/caller-bridge.yml), un job per
   organizzazione GitHub e tenant Azure DevOps, a orari fissi.
5. **Prima il dry-run.** Il bridge scrive solo quando l'input `mode` è `write` **e** la variabile
   di repository `HUB_DEPLOYMENTS_BRIDGE` è `write`. Fino ad allora il riepilogo del job mostra,
   per ambiente, i record letti, quelli che verrebbero scritti e quelli saltati con il motivo
   (`not-completed`, `commit-not-on-github`, `commit-unverified`, `commit-unreadable`,
   `ado-environment-not-found`). La prima esecuzione può recuperare fino a 90 giorni
   (`since-days`).

## Dichiarato: quando nessun sistema può registrarlo

[Esempio di chiamante](../../examples/deployments/caller-declare.yml): un form
`workflow_dispatch` con repository, ambiente, versione o commit, esito, data e nota. Una versione
si risolve nel commit del tag `<prefisso><versione>`; se il tag manca il record viene rifiutato.
Il workflow è chiuso per default:

- il job gira nell'ambiente `deployments-declare` della repository chiamante. Assegnargli revisori
  obbligatori e salvare `LEDGER_APP_ID`, `LEDGER_APP_PRIVATE_KEY`, `GH_APP_ID` e
  `GH_APP_PRIVATE_KEY` come **segreti di ambiente** lì, non come segreti di repository: le chiavi
  esistono solo dopo che una seconda persona approva l'esecuzione, e senza di esse il job fallisce;
- repository e ambiente devono comparire nella lista approvata `config/deployments-declare.yaml`
  della repository chiamante ([esempio](../../examples/deployments/deployments-declare.yaml));
  tutto il resto viene rifiutato prima di chiedere un token.

L'hub conta i record dichiarati e la cella indica "includes N declared".

## Nel catalogo dell'hub

```yaml
environments:
  - id: prod
    name: PROD
    delivery: true
    deploySignal: { type: github-deployments, repository: coordinator }
    # facoltativi: environment: production (nome GitHub, default githubEnvironment ?? id),
    #              tagPrefix: v, sources: [azure-devops] (conta solo questi scrittori)
```

`sources` è spento di default (conta ogni deployment dell'ambiente). Usarlo se un job di GitHub
Actions con `environment:` dovesse registrare un "deploy" che non è avvenuto (per esempio un job
che usa solo i segreti dell'ambiente).
