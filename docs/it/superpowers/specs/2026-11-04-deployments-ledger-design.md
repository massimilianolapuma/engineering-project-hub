# Registro dei deploy: ogni ambiente nelle GitHub Deployments — design

English: [../../../superpowers/specs/2026-11-04-deployments-ledger-design.md](../../../superpowers/specs/2026-11-04-deployments-ledger-design.md)

Stato: bozza per la revisione del responsabile (controllo del builder fatto, risposte del
responsabile integrate) · Data: 2026-11-04 · Release prevista: **v0.17.0**

## 1. Intento e motivo

I team rilasciano gli ambienti DEV e di laboratorio con GitHub Actions, quindi GitHub conosce già
quei deploy (un job con `environment:` crea un deployment GitHub). Gli altri ambienti (test,
pre-produzione, produzione) sono spesso rilasciati da sistemi che l'hub non vede: la repository
viene copiata (mirror) nell'Azure DevOps del cliente (o Google Cloud, AWS) e le sue pipeline
rilasciano da lì, con approvazioni. Un flusso tipico, come l'ha descritto il responsabile:

1. una pull request di promozione su GitHub aggiorna il file dell'ambiente con la versione da
   installare;
2. al merge, un workflow GitHub fa il mirror della repository verso Azure DevOps (ADO);
3. la modifica avvia una pipeline ADO; il responsabile la approva per l'ambiente e parte il deploy;
4. l'esito del deploy resta solo in ADO.

Per questo la mappa dei controlli (v0.16.0) legge i controlli di rilascio di quegli ambienti come
«rilasciato da pipeline esterne». Il responsabile vuole **tutti gli ambienti gestiti e visibili**,
non solo nell'hub: ogni repository deve mostrare su GitHub lo storico completo dei deploy per
ambiente, qualunque sistema li abbia fatti.

**Decisione:** le GitHub Deployments diventano il **registro unico** dei deploy di ogni ambiente di
ogni repository. I sistemi esterni lo scrivono in uno di tre modi (push dalla pipeline, bridge in
lettura, registrazione manuale dichiarata); l'hub legge solo il registro con un nuovo segnale di
deploy.

## 2. Obiettivi, non obiettivi, anti-obiettivi

Obiettivi:

- Un solo posto (le GitHub Deployments della repository) che elenca ogni deploy di ogni ambiente,
  con esito, ora, commit, versione e collegamento all'esecuzione che l'ha fatto.
- Tre modi di scriverlo, scelti per progetto:
  1. **Push**: uno step documentato alla fine di una pipeline esterna (prima ADO, poi qualunque CI
     che esegua `curl`) registra il deploy e il suo esito.
  2. **Bridge in lettura**: un workflow GitHub programmato legge in sola lettura i record di deploy
     degli environment ADO e li trascrive, senza toccare le pipeline esterne.
  3. **Dichiarato**: una registrazione manuale (form `workflow_dispatch`) quando nessun sistema è
     leggibile; sempre marcata come dichiarata.
- L'hub legge il registro con un nuovo segnale di deploy `github-deployments`: i quattro controlli
  di rilascio della mappa diventano misurabili per ogni ambiente, e `environment-separation` vede
  gli ambienti che GitHub ora conosce.
- Gli stessi strumenti valgono per ogni repository di un'organizzazione, non solo per i progetti
  del catalogo dell'hub.

Non obiettivi (questa release):

- Bridge per Google Cloud Deploy, AWS CodePipeline o altri (il formato del record è già pronto).
- Import da Jira o altri sistemi di ticketing (per ora basta la registrazione dichiarata).
- Avviare, approvare o annullare qualcosa in ADO o GitHub: il bridge legge soltanto ADO.
- Sostituire le regole di protezione degli ambienti GitHub o le approvazioni ADO.

Anti-obiettivi (fallimento anche se funziona):

- Un deploy mostrato come riuscito che non è avvenuto, o un fallimento mostrato come riuscito.
  Sconosciuto resta sconosciuto: un record il cui esito non è leggibile non viene scritto.
- Uno scrittore che possa modificare codice, workflow, impostazioni o altro oltre ai deployment.
- Credenziali di una linea o di un cliente capaci di scrivere i deploy delle repository di altri
  senza che sia visibile e revocabile.
- Nomi di clienti, aziende o persone in questa repository pubblica (esempi sempre sintetici).

## 3. Vincoli

- Repository pubblica: neutra, solo esempi sintetici; documentazione EN + IT.
- Sola lettura verso i sistemi esterni; su GitHub lo scrittore tocca solo i deployment e i loro
  stati.
- Dry-run di default per ogni scrittore programmabile (come il notifier, ADR 0013): scrive solo
  con un consenso esplicito.
- Nessuna nuova dipendenza di runtime; il bridge e lo scrittore manuale sono script TypeScript in
  questa repository eseguiti da workflow riusabili (`rw-*`), come il collector.
- Solo Podman per eventuali container (nessuno previsto).

## 4. Decisioni in breve

| #   | Decisione                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Le GitHub Deployments sono il registro. Nomi degli ambienti su GitHub = `githubEnvironment` dell'ambiente nel catalogo dell'hub (default il suo `id`): `dev`, `test`, `prod`…                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| D2  | Una GitHub App per organizzazione GitHub per scrivere, nome proposto `<org>-deployment-reporter`, permessi **Deployments: read and write** e solo Metadata: read, webhook spento, installata sulle repository scelte. Una chiave privata per linea o progetto esterno, revocabile da sola; ogni token è ristretto a una repository al momento della richiesta. **Decisione del responsabile (2026-11-04)**, accettando il limite noto: qualunque chiave dell'App può ottenere un token per qualunque repository dove l'App è installata, e GitHub non registra quale chiave ha scritto; l'isolamento tra linee si basa sulla custodia e sulla revoca delle chiavi, e l'unico permesso in gioco è Deployments. |
| D3  | Formato del record (§5.1): deployment sullo SHA del commit con un `payload` JSON che indica la fonte, l'esecuzione esterna e la versione; stati `success` / `failure`; un `log_url` verso l'esecuzione esterna.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D4  | Scrittori idempotenti: un deploy è identificato da `(fonte, id del record esterno, ambiente)`, dove l'id include il tentativo (id del record di deploy dell'environment ADO; step push: id dell'esecuzione + nome e tentativo dello stage; il bridge raggruppa i record per job di uno stage). Scriverlo due volte non cambia nulla; uno stage ripetuto è un record nuovo, quindi fallito poi riuscito conta come un deploy fallito più il suo ripristino. (Controllo del builder, scelta del builder.)                                                                                                                                                                                                       |
| D5  | Il bridge è un workflow riusabile in questa repository (`rw-deployments-bridge.yml`), eseguito a orari fissi da una repository centrale chiamante (per il responsabile: la repository privata di deploy) che contiene il file di mappa. (Scelta del builder da confermare; si potrà proporre più avanti a un toolchain condiviso.)                                                                                                                                                                                                                                                                                                                                                                            |
| D6  | Autenticazione ADO del bridge: service principal Microsoft Entra con workload identity federation da GitHub Actions (nessun segreto salvato); in alternativa un PAT (Environment: Read & manage, Build: Read; Azure DevOps non ha uno scope Environment in sola lettura per i PAT).                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D7  | Hub: nuovo segnale di deploy `github-deployments` (§5.5); l'App dell'hub ha bisogno di **Deployments: read**. I record dichiarati contano, e la cella dice quanti sono.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D8  | Un commit che GitHub non conosce (mirror non allineato) non viene mai inventato: il record viene saltato ed elencato nel riepilogo dell'esecuzione.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D9  | Dry-run di default per il bridge e lo scrittore manuale; per scrivere servono l'input `mode: write` e la variabile di repository `HUB_DEPLOYMENTS_BRIDGE=write`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| D10 | L'ora reale del deploy viaggia nel payload (`startedAt`, `finishedAt`, ISO 8601 UTC): gli orari di GitHub sono l'ora di scrittura e non si possono retrodatare. L'hub usa `finishedAt` per i record del registro e l'ora dello stato solo per i record che non l'hanno (job Actions). (Controllo del builder, scelta del builder.)                                                                                                                                                                                                                                                                                                                                                                            |
| D11 | Il bridge legge con l'App dell'hub in sola lettura (Contents: read: verifica del commit, `versionFrom`) e scrive con l'App dei deploy: le chiavi di scrittura non leggono mai il codice. Lo step push non ha bisogno di leggere: GitHub rifiuta un deployment su un commit sconosciuto (422) e lo step lo segnala. (Controllo del builder, scelta del builder.)                                                                                                                                                                                                                                                                                                                                               |
| D12 | Un job del bridge per ogni coppia (organizzazione GitHub, tenant ADO): il workflow chiamante ripete il job riusabile con i segreti di quella coppia; la mappa è divisa per job. (Controllo del builder, scelta del builder.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D13 | Di default l'hub conta ogni deployment dell'ambiente. Il workflow di mirror del responsabile è un semplice mirror git e quello di promozione, per quanto noto, non usa `environment:`, quindi nessuno dei due crea deployment. Un filtro facoltativo `sources` sul segnale (es. `[azure-devops]`) esclude gli altri creatori se un job con `environment:` dovesse mai registrare un deploy non avvenuto. (Risposta del responsabile; il filtro è una scelta di sicurezza del builder.)                                                                                                                                                                                                                        |

## 5. Progetto

### 5.1 Formato del record (il contratto che ogni scrittore rispetta)

Un deploy della versione `V` del commit `SHA` nell'ambiente `E`:

- `POST /repos/{owner}/{repo}/deployments` con `ref: SHA`, `environment: E`, `auto_merge: false`,
  `required_contexts: []`, `transient_environment: false`, `production_environment` vero solo per
  l'ambiente di rilascio del catalogo (o quando lo scrittore lo indica), `description` ≤ 140
  caratteri, e:

```json
{
  "payload": {
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
}
```

`source` ∈ `azure-devops`, `manual`, `other` (in futuro `google-cloud-deploy`, `aws-codepipeline`);
`kind` ∈ `deploy`, `rollback` (facoltativo; l'hub ricava un rollback anche da una semver più
bassa); `version` facoltativa (altrimenti l'hub usa il commit); `attempt` default 1; `startedAt` /
`finishedAt` sono gli orari reali del deploy (D10), `finishedAt` obbligatorio per `success` /
`failure`.

- Poi `POST /deployments/{id}/statuses` con `state` `success` o `failure` (`error` vale come
  fallimento), `log_url` = `runUrl`, `environment_url` facoltativo, `auto_inactive` di default.
- I deployment creati dai job di GitHub Actions (`environment:`) non hanno payload: sono già nel
  registro e l'hub li legge allo stesso modo (`source` = `github-actions`).
- Idempotenza (D4): prima di creare, lo scrittore elenca `GET /deployments?sha=SHA&environment=E`
  e salta se esiste già un deployment con gli stessi `payload.source`, `payload.runId` e
  `payload.attempt`; se a un record esistente manca lo stato finale, lo aggiunge.

### 5.2 Ricetta push (step della pipeline esterna)

Documentata in `docs/deployments-ledger.md` (EN/IT), nessun codice nelle repository esterne:

- uno snippet YAML per ADO: `DownloadSecureFile@1` per la chiave dell'App, uno step bash che firma
  un JWT, lo scambia con un token di installazione ristretto a una repository e a
  `deployments: write`, poi scrive il record del §5.1 con `condition: always()` e lo stato del job
  convertito nell'esito;
- lo stesso come script shell generico (`scripts/report-deployment.sh`, da copiare) per gli altri
  sistemi di CI;
- requisiti: uscita HTTPS dall'agente verso `api.github.com` (gli agenti Microsoft-hosted ce
  l'hanno; quelli self-hosted nella rete di un cliente hanno bisogno di accesso in uscita o di un
  proxy); il mirror conserva gli SHA dei commit.

### 5.3 Bridge in lettura (Azure DevOps)

- `rw-deployments-bridge.yml` (riusabile) esegue `npm run deployments:bridge` da una release
  verificata dell'hub, come `rw-hub-cloudflare-deploy.yml` esegue il collector.
- Input: `map` (percorso nella repository chiamante, default `config/deployments-bridge.yaml`),
  `mode` (`dry-run` di default, `write`), `since-days` (default 7; la prima esecuzione può
  recuperare fino a 90 giorni).
- File di mappa (validato con Zod, JSON Schema generato come gli altri file di configurazione):

```yaml
schemaVersion: '1.0'
sources:
  - type: azure-devops
    organization: example-org # dev.azure.com/<organization>
    project: example-project
    environments:
      - ado: prod # nome dell'environment ADO
        repository: example-org/example-service # owner/repo GitHub
        github: prod # nome dell'ambiente GitHub
        production: true
        versionFrom: { file: environments/prod.yaml, key: umbrella } # facoltativo
        commitFrom: self # facoltativo: alias della risorsa repository della pipeline che è il mirror
```

- `commitFrom` (default `self`): quando lo YAML della pipeline sta in un'altra repository ADO,
  l'alias della voce `resources.repositories` che è il mirror; la sua versione è il commit.
  (Controllo del builder, scelta del builder.)
- Per ogni environment ADO mappato: legge i suoi record di deploy degli ultimi `since-days` (REST
  ADO: Environments → environment deployment records; il builder conferma endpoint e
  `api-version` sulla documentazione Microsoft e li annota), tiene i record completati (succeeded →
  `success`, failed → `failure`, canceled/skipped → non scritti), prende il commit sorgente
  dell'esecuzione, verifica che esista su GitHub (D8), ricava `version` se c'è `versionFrom` (file
  al commit, come fa il segnale versions-file) e scrive il record del §5.1 (D4).
- Autenticazione ADO (D6): il job chiede un token OIDC a GitHub e lo scambia con Entra per un
  token sulla risorsa Azure DevOps (`499b84ac-1321-427f-aa17-267ca6975798`); il service principal è
  aggiunto all'organizzazione ADO con accesso in lettura al progetto e ai suoi environment.
  Alternativa: segreto PAT.
- Autenticazione GitHub: l'App dei deploy del D2 (token di installazione per repository).
- Uscita: una tabella nel riepilogo del job (ambiente, record letti, scritti, saltati e perché),
  nessun log con token; il dry-run mostra cosa verrebbe scritto.
- Limiti: al massimo 100 record per ambiente ed esecuzione, un timeout per chiamata, nessun
  nuovo tentativo sulle POST.

### 5.4 Record dichiarato (manuale)

- `rw-deployments-declare.yml` (riusabile, `workflow_dispatch` nel chiamante): input repository,
  ambiente, SHA del commit o versione, prefisso del tag (default `v`), esito, data (default ora),
  nota. Una versione si risolve nel commit del tag `<prefisso><versione>`; se il tag manca il
  record viene rifiutato. Scrive il §5.1 con `source: manual`, `declared: true`, `runUrl` =
  l'esecuzione del workflow, `finishedAt` = la data. Stessa App, stessa regola del dry-run.
- Il job di dichiarazione gira in un ambiente GitHub protetto della repository chiamante
  (`deployments-declare`, revisori obbligatori): un deploy dichiarato richiede una seconda persona.
  (Controllo del builder, scelta del builder.)

### 5.5 Hub: segnale di deploy `github-deployments`

- Catalogo: `deploySignal: { type: github-deployments, repository: coordinator | <id componente>, environment?: <nome ambiente GitHub>, tagPrefix?: 'v', sources?: [<fonte>] }`
  (ambiente di default: `githubEnvironment ?? id` dell'ambiente del catalogo; `sources` assente =
  tutti i deployment; `github-actions` indica i deployment senza payload del registro).
- Lettura (solo GET, App dell'hub con **Deployments: read**):
  `GET /repos/{o}/{r}/deployments?environment=E&per_page=100` (prima pagina, finestra = finestra
  di tendenza), poi gli stati di ogni deployment nella finestra. Limite: 100 deployment per
  ambiente.
- Eventi: un deployment con uno stato `success` (anche se poi `inactive`) = deploy; `failure` /
  `error` = fallimento; senza stato finale = ignorato. Ora dell'evento = `payload.finishedAt`,
  altrimenti l'ora dello stato finale (D10). Rollback = `payload.kind: rollback`, o una
  `payload.version` semver più bassa del deploy precedente. Tempo di consegna: quando
  `payload.version` e il `tagPrefix` del segnale (default `v`) indicano un tag, dalla data del
  commit di quel tag, come fa il segnale `versions-file`; altrimenti dalla data del commit
  rilasciato. Metriche di rilascio come nella v0.16.0 (four keys). (Controllo del builder, scelta
  del builder.)
- La cella indica il segnale («Deployment GitHub») e, se ci sono record dichiarati, annota
  «comprende N dichiarati».
- Sconosciuto non è mai 0: un 403 o un elenco illeggibile è non visibile (`needs-permission` /
  `source-unreadable`) con un errore di raccolta `deploy-signal`; un ambiente senza alcun
  deployment nella finestra vale frequenza 0 misurata solo se ha almeno un deployment precedente,
  altrimenti è non visibile («nessun deploy registrato»).
- `environment-separation` legge già gli ambienti GitHub: gli ambienti creati dal registro lo
  rendono misurabile.

### 5.6 Documentazione e decisioni

- `docs/deployments-ledger.md` (EN/IT): motivo, formato del record, i tre scrittori, l'App (nome,
  permessi, una chiave per linea), configurazione dell'identità ADO, la mappa, dry-run e
  scrittura.
- ADR 0015: le GitHub Deployments come registro di ogni ambiente; scrittori fuori dall'hub.
- `docs/control-map.md`: il nuovo segnale; `docs/security.md`: l'App dei deploy e i permessi del
  job del bridge (`id-token: write` per OIDC, nessun'altra scrittura).

## 6. Test (sintesi)

Test unitari per il formato del record e l'idempotenza (la stessa esecuzione due volte scrive una
volta), la conversione dei record ADO (succeeded / failed / canceled, commit sconosciuto saltato),
lo schema della mappa, dry-run contro scrittura, il segnale dell'hub (riuscito poi inattivo,
fallito, rollback per tipo e per versione, conteggio dei dichiarati, 403); provider e fixture mock
per ADO e per le GitHub Deployments; golden con un progetto demo su `github-deployments`; lint dei
workflow (actionlint, zizmor) per i nuovi workflow riusabili. La prova reale su un'organizzazione
ADO è l'ultimo passo, quando sarà disponibile.

## 7. Lasciato al builder

Endpoint ADO esatti e `api-version` (verificati sulla documentazione Microsoft), nomi di file e
script, l'impaginazione del riepilogo, i limiti dei campi del form di dichiarazione, e come il
bridge riusa il nucleo HTTP di `shared/http/`.

## 8. Rischi

- **Mappa sbagliata**: scrive deploy nella repository o nell'ambiente sbagliati. La mappa si rivede
  in pull request, e il dry-run mostra ogni scrittura prima della prima esecuzione `write`.
- **Mirror disallineato** (commit non su GitHub): saltato e segnalato, mai inventato.
- **Diffusione delle chiavi**: una chiave per linea, token ristretti, solo il permesso Deployments.
- **Consenso del cliente**: leggere l'ADO di un cliente richiede che configuri l'identità; la
  ricetta push richiede una modifica alla sua pipeline. Ogni progetto sceglie ciò che il cliente
  consente.

## 9. Fonti

- GitHub REST: deployments e deployment statuses; environments (verificate il 2026-11-04).
- Microsoft Learn: environment di Azure DevOps e storico dei deploy; workload identity federation
  di Microsoft Entra e service principal per Azure DevOps (verificate il 2026-11-04).
- DevOps Research and Assessment, "four keys" (definizioni delle metriche di rilascio, come nella
  v0.16.0).
