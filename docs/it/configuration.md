# Configurazione

> 🇬🇧 [English version](../configuration.md)

Tutto è configuration as code, versionato in `config/` e validato con Zod da
`npm run validate:config`, che viene eseguito anche in CI e prima di ogni raccolta. Gli
editor con il YAML language server ottengono l'autocompletamento dagli JSON Schema generati
in `config/schema/` (`npm run schema:generate`). Le chiavi sconosciute vengono
**rifiutate**, quindi un refuso non può essere ignorato silenziosamente.

## Catalogo: `config/catalog.yaml` + `config/projects/<id>.yaml`

Il catalogo è salvato **in un file per progetto**: così l'editor del catalogo può proporre
una modifica come pull request su un singolo file, e Git ne conserva lo storico (vedi
[ADR 0004](architecture/adr/0004-configuration-store-and-discovery.md)):

```text
config/
  catalog.yaml            # opzionale: impostazioni di scoperta
  projects/
    project-alpha.yaml    # un ProjectConfig; il nome del file deve coincidere con l'id
    platform.yaml
  policies.yaml
  projects.yaml           # vecchio catalogo in un unico file: ancora letto e unito
```

Ogni esecuzione del collector carica questa configurazione: un riavvio riparte sempre
dall'ultimo stato salvato. Il catalogo può essere vuoto quando la scoperta è attiva
(avvio da zero).

### `config/catalog.yaml`: scoperta

```yaml
discovery:
  enabled: true
  owners: [example-org] # organizzazioni o utenti da analizzare
  includePrivate: false # forzato a false finché publication.audience è "public"
  includeForks: false
  includeArchived: false
  maxRepositories: 200 # budget API per esecuzione
```

La scoperta è **in sola lettura e produce solo proposte**. I risultati vengono pubblicati
in `catalog.json` e mostrati nell'editor del catalogo (`/it/catalog/`):

| Proposta      | Rilevata quando                                                                                                                                  | Componenti                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `coordinator` | il repository ha un `.gitmodules` con submodule che puntano a repository analizzati                                                              | uno per submodule (`submodulePath`)                                 |
| `monorepo`    | c'è un manifest di workspace: `workspaces` npm/yarn, `pnpm-workspace.yaml`, `lerna.json`, `go.work`, `[workspace]` Cargo, `turbo.json`/`nx.json` | uno per cartella del workspace (`path`, `releaseTagPrefix: <id>-v`) |
| `single`      | in tutti gli altri casi                                                                                                                          | nessuno (il repository è il progetto)                               |

- I repository che sono submodule di un coordinator scoperto non vengono proposti da soli.
- Le proposte il cui repository è già coordinator di un progetto del catalogo sono
  segnalate come tali, così da poterle confrontare e unire.
- I workflow trovati in ogni repository vengono proposti come workflow monitorati. Sono
  marcati critici i file che iniziano con `ci`, `build`, `test`, `release`, `rel-`, `cd` o
  `deploy`.
- Chiamate usate: elenco dei repository dell'owner, `.gitmodules`, elenco della root e
  delle cartelle di workspace, manifest di workspace ed elenco dei workflow. Non serve
  nessun nuovo permesso della GitHub App (Metadata, Contents, Actions).

### `config/projects/<id>.yaml`: un progetto

```yaml
id: project-alpha # slug minuscolo, univoco; deve coincidere con il nome del file
name: Project Alpha
description: Free text (≤ 500 chars)
businessUnit: Payments
lifecycle: production # experimental | development | production | maintenance | deprecated

coordinator:
  repository: example-org/project-alpha-coordinator # owner/name
  defaultBranch: main # opzionale
  manifestPath: release-manifest.yaml # opzionale (default mostrato)
  notApplicableControls: [containerScanning] # opzionale

components: # opzionale: vuoto per i progetti con un solo repository
  - id: backend
    name: Backend API
    repository: example-org/project-alpha-backend
    type: service
    submodulePath: services/backend # opzionale: path del submodule nel coordinator
    # path: services/backend          # monorepo: cartella nel repository (vedi sotto)
    versionSource: auto # opzionale: auto | submodule | manifest | release
    releaseTagPrefix: backend- # opzionale: tag di questo componente ("backend-1.2.0")

environments:
  - { id: dev, name: DEV }
  - { id: prod, name: PROD }

trackedWorkflows:
  - id: ci
    name: Continuous Integration
    file: ci-main.yml
    critical: true
    appliesTo: [backend, frontend] # componenti o "coordinator"; default = tutti i componenti

securityControls: # tutti e otto obbligatori
  codeScanning: { required: true }
  secretScanning: { required: true }
  dependabot: { required: true }
  containerScanning: { required: false }
  iacScanning: { required: false }
  dast: { required: false }
  sbom: { required: false }
  artifactSignature: { required: false }
```

### Monorepo e progetti con un solo repository

- **Monorepo**: ogni componente usa il `repository` del coordinator più un `path`. In
  questo caso il `path` è obbligatorio ed esclude `submodulePath`.
  - Versioni: con `releaseTagPrefix` (es. `api-v`) l'ultima versione è il tag semver più
    alto con quel prefisso, non la release dell'intero repository. Usa
    `versionSource: release`, oppure `manifest` con un release manifest.
  - Alert, controlli, governance ed errori sono valutati **una sola volta per
    repository**. Gli alert di code scanning e Dependabot vanno al componente il cui `path`
    contiene il file o il manifest dell'alert; tutto il resto va al coordinator.
  - I workflow valgono per l'intero repository: monitorali con `appliesTo: [coordinator]`.
- **Repository singolo**: `components: []`, workflow con `appliesTo: [coordinator]`.

Le regole di validazione sono:

- formato `owner/name`
- id univoci per progetti, componenti, ambienti e workflow
- `submodulePath` univoco e posizione del componente univoca (`repository` + `path`)
- `path` obbligatorio per i componenti nel repository del coordinator, mai insieme a
  `submodulePath`
- `appliesTo` può fare riferimento solo a componenti noti
- path relativi senza `..`
- nomi di file di workflow validi

### Mappatura dei componenti

Le associazioni sono **esplicite**. Nulla viene dedotto dai nomi dei repository.

1. Ogni componente dichiara il proprio `repository`.
2. I submodule trovati nel `.gitmodules` del coordinator vengono associati:
   - tramite il **path configurato** (`submodulePath`), altrimenti
   - tramite l'**URL remoto**, quando si risolve nell'`owner/name` del componente (sono
     supportati https, ssh e il relativo `../name.git`), altrimenti
   - restano **non associati**. Questo viene mostrato nelle viste Versioni e Qualità dati
     ed è ambra per impostazione predefinita.
3. Un componente con `submodulePath` che non compare in `.gitmodules` è **non
   risolvibile**, il che è rosso per impostazione predefinita.

### Risoluzione dello SHA del submodule e `versionSource`

Per ogni componente associato a un submodule, il collector legge lo **SHA fissato dal
coordinator** (Contents API) e lo risolve nel repository del componente:

| Stato del pin | Significato                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------- |
| `tagged`      | Lo SHA è esattamente un tag (se più tag, vince la semver più alta): versione **verificata**. |
| `ahead`       | Nessun tag; N commit dopo l'ultima release (è fissato codice non rilasciato).                |
| `behind`      | Nessun tag; più vecchio dell'ultima release.                                                 |
| `diverged`    | Nessun tag; fuori dalla storia dell'ultima release.                                          |
| `unknown`     | SHA, tag o confronto non leggibili.                                                          |

Vengono esaminati fino ai 300 tag più recenti (`GET /tags`); se nessun tag corrisponde, una
chiamata `GET /compare/{ultimaRelease}...{sha}` fornisce la distanza (si conservano solo stato
e contatori).

`versionSource` (per componente, default `auto`) sceglie la **versione attuale**:

| Valore      | Versione attuale                                                                         |
| ----------- | ---------------------------------------------------------------------------------------- |
| `auto`      | Pin verificato (tag sullo SHA del submodule) → dichiarazione del manifest → sconosciuta. |
| `submodule` | Solo il pin verificato.                                                                  |
| `manifest`  | Solo la dichiarazione del release manifest.                                              |
| `release`   | L'ultima release del componente (componente rilasciato con una cadenza propria).         |

Controlli sulle versioni (livelli in `policies.yaml` → `version`):

- **drift**: versione attuale ≠ ultima release (`componentDrift`);
- **pin senza tag**: il coordinator fissa uno SHA che non è un tag di release (`untaggedSubmodule`);
- **manifest vs submodule**: il manifest dichiara una versione diversa dal tag fissato
  (`manifestSubmoduleMismatch`).

### Monitoraggio dei workflow

Per ogni workflow monitorato e per ogni target (`appliesTo`, per impostazione predefinita
tutti i componenti), il collector legge le ultime 20 esecuzioni di `file` sul branch
predefinito. Lo stato della cella deriva dall'**ultima esecuzione completata**:

| Ultima esecuzione completata                               | Stato                                                     |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| success, neutral o skipped                                 | Riuscito (Success)                                        |
| failure, timed_out o startup_failure                       | Fallito (Failed), con il nome del job/step fallito        |
| cancelled                                                  | Annullato (Cancelled)                                     |
| nessuna esecuzione completata, ma una è in coda o in corso | In coda / In corso (Queued / In progress)                 |
| nessuna esecuzione                                         | Mai eseguito (Never run)                                  |
| file del workflow non trovato (404)                        | Assente (Missing); governance: workflow standard mancante |
| 403                                                        | Non autorizzato (Not authorised)                          |

Un'esecuzione è **non aggiornata** (stale) quando la sua ultima esecuzione completata è più
vecchia di `freshness.workflowRunStaleDays`.

### Controlli obbligatori e opzionali

- I controlli **obbligatori** contano ai fini della copertura, e un loro fallimento o
  mancato aggiornamento incide sul Rischio sicurezza.
- I controlli **opzionali** vengono mostrati ma non abbassano mai la copertura.
- `notApplicableControls` rimuove un controllo per un singolo repository: non viene né
  conteggiato né richiesto.
- **Controlli nativi di GitHub**: code scanning (con la data dell'ultima analisi, usata per
  valutare se è aggiornato), secret scanning e Dependabot.
- **Controlli di pipeline**: container e IaC scanning, DAST, SBOM e firma degli artifact.
  Vengono letti dal file di stato sicurezza.

### Applicabilità della copertura dei test (`testCoverage`)

La copertura dei test (dimensione Qualità) si applica per impostazione predefinita ai
componenti di tipo `service`, `webapp`, `worker` e `library`, e al coordinator (trattato
come un `service`). Non si applica a `deployment`, `infrastructure` e `other`. Si può
forzare per componente, o nel blocco `coordinator`, in `config/projects/<id>.yaml`:

```yaml
coordinator:
  repository: example-org/project-beta
  testCoverage: not-applicable # required | not-applicable
components:
  - id: api
    repository: example-org/project-beta-api
    type: service
    testCoverage: required
```

L'override prevale sempre sul default del tipo. I componenti non applicabili sono mostrati
con "–" e non contano mai come 0%.

### La Qualità è opzionale per impostazione predefinita

`overall.optionalDimensions` vale `[quality]`: una Qualità misurata conta per lo stato
complessivo e per il punteggio, una Qualità grigia viene ignorata, così i progetti restano
stabili finché la CI non pubblica i riepiloghi. La Qualità non è critica: una Qualità rossa
conta come ambra nel complessivo. Per renderla obbligatoria (una Qualità grigia è allora
trattata come ogni altra dimensione obbligatoria grigia) imposta `optionalDimensions: []` e aggiungi `quality` a
`requiredDimensions`. Una dimensione presente in entrambe le liste viene rifiutata in
validazione.

### Aggiungere un progetto (senza modifiche al codice)

Metodo consigliato: apri `/it/catalog/`, aggiungi una proposta scoperta (o crea un
progetto), poi **Proponi su GitHub**. A mano:

1. Crea `config/projects/<id>.yaml`.
2. `npm run validate:config`
3. `npm run collect:github` (oppure attendi l'esecuzione pianificata). Assicurati che la
   GitHub App sia installata sui nuovi repository, o che il PAT li copra.
4. Opzionale: aggiungi `release-manifest.yaml` al coordinator e
   `.security/project-security-status.json` ai componenti.
5. Apri una PR. La CI valida la configurazione.

### Editor del catalogo

La pagina **Catalogo** del portale (`/catalog/`, `/it/catalog/`) modifica il catalogo senza
scrivere YAML a mano: scegli un progetto (o creane uno), collega coordinator, componenti,
ambienti, workflow monitorati e controlli obbligatori, e scegli il `versionSource` di ogni
componente. Un componente è un submodule del coordinator (_Percorso del submodule_) oppure
una cartella del repository coordinator (_Percorso_, monorepo; obbligatorio se il
repository del componente è quello del coordinator). Un progetto può non avere componenti
(repository singolo). Il form mostra il **tipo di progetto** ricavato dai componenti:
_Multi-repository_, _Monorepo_ o _Repository singolo_.

Due pannelli partono dall'ultima esecuzione del collector:

- **Repository scoperti** elenca le proposte della discovery (`discovery` in
  `catalog.json`) raggruppate per tipo (_Coordinator_, _Monorepo_, _Repository singolo_) con
  il link al repository, gli indizi e il numero di componenti, oltre al numero di repository
  analizzati e a quelli non analizzabili (solo la classificazione). Una proposta non presente
  nel catalogo ha _Aggiungi come progetto_: importa la configurazione proposta nell'editor
  (all'id si aggiunge `-2`, `-3`… se già usato) e la seleziona. Una proposta già nel catalogo
  (stesso repository coordinator) ha _Confronta / unisci_: apre quel progetto ed elenca i
  componenti e i workflow monitorati della proposta che mancano al progetto, ciascuno con un
  pulsante _Aggiungi_. Le proposte restano proposte: nulla viene salvato automaticamente. Se
  la discovery è disattivata, il pannello spiega come attivarla in `config/catalog.yaml`
  (`discovery.enabled`, `owners`).
- **Suggerimenti** elenca i submodule del coordinator non collegati ad alcun componente;
  _Aggiungi come componente_ crea un componente collegato tramite il suo `submodulePath`
  configurato, con il repository precompilato quando noto.

La pagina resta statica e in sola lettura: è generata da `public/data/catalog.json` (scritto
dal collector, non legge mai direttamente `config/`) e valida in tempo reale nel browser con
lo stesso schema Zod di `npm run validate:config`. Genera **un file per progetto**,
`config/projects/<id>.yaml` (un solo documento di progetto, valori vuoti e predefiniti
omessi), ed elenca le **Modifiche in sospeso** rispetto al catalogo pubblicato. Ogni modifica
si propone tramite l'editor web di GitHub e diventa quindi una pull request; l'editor non
chiama mai le API di GitHub e non contiene token, e si applicano i tuoi permessi GitHub:

| Modifica   | Azione                         | Cosa succede                                                                                                                                                              |
| ---------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nuovo      | Proponi su GitHub (nuovo file) | Apre `github.com/<owner>/<repo>/new/main?filename=config/projects/<id>.yaml&value=…` precompilato. Oltre ~7000 caratteri lo YAML viene copiato e la pagina si apre vuota. |
| Modificato | Modifica su GitHub             | Copia lo YAML negli appunti e apre `…/edit/main/config/projects/<id>.yaml`: sostituisci il contenuto incollando.                                                          |
| Rimosso    | Elimina su GitHub              | Apre `…/delete/main/config/projects/<id>.yaml`.                                                                                                                           |

Poi scegli _Create a new branch and start a pull request_; la CI valida il file e la prima
esecuzione del collector dopo il merge lo usa. Un progetto rinominato è un nuovo file più
uno rimosso. Ogni modifica in sospeso si può anche copiare o scaricare come `<id>.yaml`. Il
repository è ricavato da `repository.url` in `package.json`; senza, le azioni GitHub sono
nascoste. In alternativa, _Scarica tutto (projects.yaml legacy)_ scarica tutti i progetti in
un unico `config/projects.yaml` legacy, ancora accettato dal loader: usalo **al posto dei**
file in `config/projects/`, mai insieme (lo stesso id due volte è un errore).

Il portale è in sola lettura: le modifiche si propongono come pull request e la CI le applica
dopo il merge; alla successiva esecuzione viene sempre ripristinata la configurazione
salvata. I commenti dei file scritti a mano non vengono conservati: rivedi il diff prima del
commit.

## `config/policies.yaml`: policy di salute

Sono policy dell'MVP, non valutazioni del rischio universali. Modificarle non richiede
interventi sul codice o sul frontend.

| Chiave                                  | Default                                                                      | Significato                                                                                                                                        |
| --------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `freshness.snapshotStaleHours`          | 24                                                                           | Il sito segnala lo snapshot come non aggiornato (calcolato nel browser).                                                                           |
| `freshness.workflowRunStaleDays`        | 14                                                                           | Un'ultima esecuzione completata più vecchia di questo valore è non aggiornata.                                                                     |
| `freshness.securityScanStaleDays`       | 7                                                                            | Un'ultima analisi di code scanning più vecchia di questo valore è non aggiornata.                                                                  |
| `freshness.securityStatusFileStaleDays` | 7                                                                            | I risultati di stato delle pipeline più vecchi di questo valore sono non aggiornati.                                                               |
| `freshness.qualityReportStaleDays`      | 14                                                                           | Un report di copertura dei test (`generatedAt`) più vecchio di questo valore è non aggiornato: viene ancora contato, ma limita a ambra.            |
| `delivery.queuedThresholdMinutes`       | 60                                                                           | In coda o in esecuzione da più di questo valore significa Attenzione (Attention).                                                                  |
| `delivery.missingCriticalWorkflow`      | amber                                                                        | Stato per un workflow critico mancante o mai eseguito.                                                                                             |
| `delivery.failedCriticalWorkflow`       | red                                                                          | Stato per un workflow critico fallito o annullato.                                                                                                 |
| `security.redOnSeverities`              | [critical]                                                                   | I finding aperti con queste severità rendono rosso il Rischio sicurezza.                                                                           |
| `security.amberOnSeverities`            | [high, medium, low]                                                          | I finding aperti con queste severità rendono ambra il Rischio sicurezza.                                                                           |
| `security.openSecretAlertIsRed`         | true                                                                         | Un alert di secret scanning aperto è rosso.                                                                                                        |
| `security.requiredControlFailedIsRed`   | true                                                                         | Un controllo obbligatorio fallito è rosso.                                                                                                         |
| `security.staleScanIsAmber`             | true                                                                         | Una scansione obbligatoria non aggiornata è ambra.                                                                                                 |
| `security.incompleteCoverageIsAmber`    | true                                                                         | Una copertura non verde rende ambra il Rischio sicurezza.                                                                                          |
| `coverage.greenThresholdPercent`        | 100                                                                          | La copertura è verde a partire da questa percentuale.                                                                                              |
| `quality.greenThresholdPercent`         | 80                                                                           | La copertura di righe è verde a partire da questa percentuale.                                                                                     |
| `quality.amberThresholdPercent`         | 60                                                                           | Ambra a partire da questa percentuale, rosso sotto.                                                                                                |
| `quality.missingReportIsAmber`          | true                                                                         | Un componente applicabile senza report visibile limita la Qualità a ambra (un rosso resta rosso).                                                  |
| `version.componentDrift`                | amber                                                                        | La versione dichiarata differisce dall'ultima release.                                                                                             |
| `version.environmentBehind`             | amber                                                                        | Ambiente indietro rispetto alla versione del coordinator, o non coerente con essa.                                                                 |
| `version.unresolvableSubmodule`         | red                                                                          | Un submodule configurato non può essere risolto.                                                                                                   |
| `version.unknownManifestComponent`      | red                                                                          | Il manifest fa riferimento a un componente sconosciuto.                                                                                            |
| `version.unmappedSubmodule`             | amber                                                                        | Un submodule non associato ad alcun componente.                                                                                                    |
| `version.untaggedSubmodule`             | amber                                                                        | Il coordinator fissa uno SHA che non è un tag di release del componente.                                                                           |
| `version.manifestSubmoduleMismatch`     | amber                                                                        | Il manifest dichiara una versione diversa da quella fissata dal submodule.                                                                         |
| `governance.*`                          | amber                                                                        | Workflow standard mancante, repository archiviato, file di stato mancante o non valido, branch predefinito non corrispondente.                     |
| `overall.criticalDimensions`            | [delivery, version, security]                                                | Un rosso in queste dimensioni rende rosso il progetto. Un rosso altrove conta come ambra.                                                          |
| `overall.requiredDimensions`            | [delivery, version, security, coverage, governance]                          | Devono essere tutte verdi perché lo stato Complessivo sia verde.                                                                                   |
| `overall.optionalDimensions`            | [quality]                                                                    | Conta come una dimensione obbligatoria non critica quando è misurata, ignorata quando è grigia. Una dimensione non può stare in entrambe le liste. |
| `overall.greyRequiredDimension`         | grey                                                                         | Effetto di una dimensione obbligatoria Unknown (Sconosciuto): grey o amber.                                                                        |
| `score.weights`                         | delivery 25, version 15, security 30, coverage 15, governance 15, quality 10 | Peso di ogni dimensione nel punteggio del progetto. Vedi [Punteggio del progetto](#punteggio-del-progetto).                                        |
| `score.points`                          | green 100, amber 60, red 20                                                  | Punti di una dimensione misurata per stato. Il grigio non è misurato, mai 0.                                                                       |
| `score.caps`                            | red 49, amber 89, grey 89                                                    | Punteggio massimo consentito per ogni stato complessivo.                                                                                           |
| `score.minMeasuredRatio`                | 0.5                                                                          | Sotto questa quota di dimensioni obbligatorie misurate il punteggio è "dati insufficienti".                                                        |
| `publication.audience`                  | public                                                                       | `public` omette titoli dei finding e rule id dei repository non pubblici. `restricted` richiede Pages con controllo degli accessi.                 |
| `publication.allowedLinkHosts`          | [github.com]                                                                 | Vengono pubblicati solo i link verso questi host.                                                                                                  |

### Punteggio del progetto

Il collector calcola per ogni progetto un punteggio da 0 a 100, per ordinare e
confrontare i progetti nello snapshot di oggi. Il sito si limita a mostrarlo; non
sostituisce mai le dimensioni. Il blocco opzionale `score` in
`config/policies.yaml` modifica la formula (lo `schemaVersion` delle policy resta `1.0`).

- **Punti** per dimensione misurata: verde 100, ambra 60, rosso 20. Il grigio (non
  misurato) è escluso, mai contato come 0.
- **Media pesata** sulle dimensioni obbligatorie misurate (`overall.requiredDimensions`) e
  su quelle opzionali misurate (`overall.optionalDimensions`). Pesi predefiniti: delivery
  25, version 15, security 30, coverage 15, governance 15, quality 10.
- **Tetti** che mantengono il numero coerente con lo stato: complessivo rosso → al massimo
  49; complessivo ambra → al massimo 89; complessivo grigio (una dimensione obbligatoria
  sconosciuta, nessuna rossa o ambra) → al massimo 89, così un progetto in parte illeggibile
  non si classifica mai insieme a quelli sani. Un progetto rosso è quindi sempre sotto
  qualsiasi progetto ambra o grigio.
- **Verde vale 100**: il verde richiede tutte le dimensioni obbligatorie verdi, quindi i
  progetti sani sono a pari merito in cima.
- **Non applicabile non è sconosciuto**: una dimensione grigia solo perché non c'è nulla da
  misurare (motivo delivery `no-critical-workflows`) esce sia da `measured` sia da
  `required`. Il grigio per qualsiasi altro motivo (non autorizzato, sconosciuto, raccolta
  fallita) conta come non misurato.
- **Dimensioni opzionali** (`quality` per impostazione predefinita) contano quando sono
  misurate. Quando sono grigie escono sia da `measured` sia da `required`: un progetto senza
  report di copertura non perde punti e non diventa grigio.
- **Affidabilità**: `measured / required` ("misurate 4 su 5"; "misurate 6 su 6" quando la
  Qualità è misurata).
- **Dati insufficienti**: se è misurata meno di `minMeasuredRatio` (predefinito metà) delle
  dimensioni obbligatorie, `value` è `null` e il sito mostra "dati insufficienti".
- Il risultato è arrotondato all'intero.

Lo schema snapshot 1.4 lo pubblica come `score: { value, measured, required }` in ogni
snapshot di progetto e in ogni progetto di `index.json`. Con i dati mock: Platform 82,
Project Alpha 78, Project Beta 40, Project Gamma dati insufficienti.

## Contratti letti dai repository monitorati

### `release-manifest.yaml` (coordinator, opzionale)

```yaml
schemaVersion: '1.0'
version: 1.4.0 # coordinator version
components: # expected versions, keyed by component id
  backend: { version: 1.4.0 }
  frontend: { version: 2.1.0 }
environments: # what each environment is declared to run
  dev: { version: 1.4.0 }
  prod: { version: 1.3.0 }
```

In assenza di manifest, la versione del coordinator ripiega sulla sua ultima release,
poi sul suo ultimo tag, e la salute delle Versioni è ambra ("versioni note solo in parte").
Un id di componente sconosciuto nel manifest è rosso.

### `.security/project-security-status.json` (ogni repository, opzionale)

```json
{
  "schemaVersion": "1.0",
  "generatedAt": "2026-10-03T08:00:00Z",
  "repository": "example-org/example-repo",
  "version": "1.2.3",
  "commitSha": "<40-hex sha>",
  "controls": {
    "containerScanning": {
      "status": "completed",
      "tool": "trivy",
      "critical": 0,
      "high": 2,
      "medium": 4,
      "low": 1,
      "reportUrl": "https://github.com/..."
    },
    "iacScanning": {
      "status": "completed",
      "tool": "checkov",
      "critical": 0,
      "high": 0,
      "medium": 3,
      "low": 2
    },
    "dast": { "status": "not-configured" },
    "sbom": { "status": "available", "format": "cyclonedx" },
    "artifactSignature": { "status": "verified" }
  }
}
```

Gli stati vengono mappati sugli stati dei controlli come segue:

| Valore nel file di stato                   | Stato del controllo                                                         |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| `completed`, `available`, `verified`       | Attivo (Enabled), oppure Non aggiornato (Stale) se più vecchio della soglia |
| `failed`, `not-verified`                   | Scansione fallita (Scan failed)                                             |
| `not-configured`, oppure controllo assente | Non configurato (Not configured)                                            |
| `not-run`, `running`                       | Configurato, non eseguito (Configured, not run)                             |

I seguenti casi contano come Unknown (Sconosciuto) e aggiungono un errore di raccolta
`invalid-data`: un file mancante (quando sono richiesti controlli di pipeline, compare
anche come governance ambra), un file non valido, oppure un file il cui `repository` non
corrisponde.
`reportUrl` viene pubblicato solo per host in allowlist.

### Artifact `hub-quality-summary` (ogni repository, opzionale)

La CI carica un artifact di GitHub Actions chiamato **`hub-quality-summary`** che contiene un
solo file, **`quality-summary.json`**, a ogni esecuzione sul branch predefinito. Il collector
lo legge con le stesse credenziali del resto (**Actions: read**): non serve alcun nuovo
secret. Un esempio di step è in
[Operatività](operations.md#pubblicare-il-riepilogo-di-qualità-dalla-ci).

```json
{
  "schemaVersion": "1.0",
  "repository": "example-org/project-beta-api",
  "ref": "refs/heads/main",
  "commitSha": "<sha da 40 caratteri esadecimali>",
  "generatedAt": "2026-01-14T10:00:00Z",
  "tool": "coverlet",
  "format": "cobertura",
  "lines": { "covered": 5998, "valid": 8400 }
}
```

- Lo schema è strict (le chiavi sconosciute sono rifiutate). `format` è uno tra `cobertura`,
  `lcov`, `opencover`, `jacoco`, `other`. `tool` è un identificativo breve (al massimo 40
  caratteri) e viene ripulito. `lines.covered` non può superare `lines.valid`.
- `repository` deve coincidere con il repository letto (senza distinguere maiuscole e
  minuscole), altrimenti il report è `invalid`.
- `lines.valid: 0` significa "nessun codice testabile": il componente non è applicabile,
  mai 0%.
- JSON Schema: [`config/schema/quality-summary.schema.json`](../../config/schema/quality-summary.schema.json)
  (generato da `npm run schema:generate`).

Come lo legge il collector:

- Elenca gli artifact del repository per nome (fino a 3 pagine da 30) e prende il più
  recente non scaduto la cui esecuzione è sul branch predefinito **e** proviene dallo stesso
  repository (l'esecuzione di una pull request da fork non è mai considerata affidabile).
- Lo zip è limitato a 64 KB (65 536 byte). Viene letto solo il file `quality-summary.json`.
- Un riepilogo per repository. Quando più componenti condividono un repository (un monorepo,
  o un coordinator che è anche repository di un componente), ogni riga mostra lo stesso report
  ("report del repository condiviso") e la copertura del progetto conta quel repository una
  sola volta.

| Esito                                                                      | Stato                                               |
| -------------------------------------------------------------------------- | --------------------------------------------------- |
| Nessun artifact (404)                                                      | `missing`                                           |
| Solo artifact scaduti                                                      | `expired` (motivo `quality-report-expired`)         |
| 403 sull'elenco degli artifact                                             | `not-authorised`, mai `missing`                     |
| JSON o schema non validi, altro repository, zip troppo grande o senza file | `invalid`, più un errore di raccolta `invalid-data` |
| Errore di rete o altro fallimento                                          | `unknown`                                           |
| Valido, `generatedAt` più vecchio di `freshness.qualityReportStaleDays`    | `stale` (contato, sempre mostrato con la sua età)   |
| Valido e aggiornato                                                        | `readable`                                          |

La copertura del progetto è la somma di `covered` sulla somma di `valid` dei repository
applicabili con report leggibile o non aggiornato (pesata per righe). I componenti senza
report visibile non contano mai, e mai come 0%. Stato: grigio quando nulla è applicabile o
nulla è visibile; altrimenti verde a partire da `quality.greenThresholdPercent`, ambra a
partire da `quality.amberThresholdPercent`, rosso sotto. Un report non aggiornato, oppure un
componente applicabile senza report visibile con `quality.missingReportIsAmber` a true,
limita un verde a ambra (un rosso resta rosso).

I **finding di GitHub Code Quality** sono solo informativi: i finding aperti sono contati per
repository (per categoria `reliability` / `maintainability` e per severità `error` /
`warning` / `note` / `none`) da `GET /repos/{owner}/{repo}/code-quality/findings?state=open`.
Non cambiano mai lo stato della Qualità. I conteggi sono pubblicati solo quando ogni
repository è stato leggibile o ha risposto che Code Quality non è attivo; altrimenti lo stato
è `not-authorised` o `unknown`, mai 0. GitHub
non espone alcun endpoint per la percentuale di copertura: per questo la copertura arriva dal
riepilogo della CI.

## Variabili d'ambiente

| Variabile                                                   | Dove                             | Scopo                                                                                                                                                                                                     |
| ----------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATA_SOURCE`                                               | variabile di repository / env    | `mock` (predefinito) o `github`                                                                                                                                                                           |
| `GH_APP_ID`, `GH_APP_PRIVATE_KEY`, `GH_APP_INSTALLATION_ID` | Actions secrets                  | Autenticazione tramite GitHub App (consigliata)                                                                                                                                                           |
| `GH_READ_TOKEN`                                             | Actions secret                   | PAT fine-grained di fallback                                                                                                                                                                              |
| `GITHUB_TOKEN`                                              | automatico                       | Ultimo fallback (solo repository corrente)                                                                                                                                                                |
| `GITHUB_API_URL`                                            | automatico / env                 | URL base dell'API (GitHub Enterprise Server)                                                                                                                                                              |
| `SITE_URL`, `BASE_PATH`                                     | impostate dal workflow di deploy | `site` e `base` di Astro (da configure-pages)                                                                                                                                                             |
| `SNAPSHOT_DIR`                                              | locale / test                    | Directory alternativa degli snapshot per la build del sito                                                                                                                                                |
| `POLICIES_FILE`                                             | build del sito                   | Policy spiegate nella pagina "Come leggere" (predefinito `config/policies.yaml`; valori predefiniti dello schema solo se manca il file predefinito; un file illeggibile o non valido fa fallire la build) |
