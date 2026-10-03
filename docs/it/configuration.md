# Configurazione

> 🇬🇧 [English version](../configuration.md)

Tutto è configuration as code, versionato in `config/` e validato con Zod da
`npm run validate:config`, che viene eseguito anche in CI e prima di ogni raccolta. Gli
editor con il YAML language server ottengono l'autocompletamento dagli JSON Schema generati
in `config/schema/` (`npm run schema:generate`). Le chiavi sconosciute vengono
**rifiutate**, quindi un refuso non può essere ignorato silenziosamente.

## `config/projects.yaml`: catalogo

```yaml
discovery:
  topics: false # reserved (roadmap): repository topics discovery
  customProperties: false # reserved (roadmap): GitHub custom properties

projects:
  - id: project-alpha # lowercase slug, unique
    name: Project Alpha
    description: Free text (≤ 500 chars)
    businessUnit: Payments
    lifecycle: production # experimental | development | production | maintenance | deprecated

    coordinator:
      repository: example-org/project-alpha-coordinator # owner/name
      defaultBranch: main # optional: otherwise the repository default; mismatch = governance amber
      manifestPath: release-manifest.yaml # optional (default shown)
      notApplicableControls: [containerScanning] # optional

    components: # at least one
      - id: backend # slug, unique, "coordinator" is reserved
        name: Backend API
        repository: example-org/project-alpha-backend
        type: service # service | webapp | worker | deployment | infrastructure | library | other
        defaultBranch: main # optional
        submodulePath: services/backend # optional: path of the submodule in the coordinator
        versionSource: auto # optional: auto | submodule | manifest | release (see below)
        releaseTagPrefix: backend- # optional: stripped before version comparison
        notApplicableControls: [] # optional: controls that do not apply (e.g. containerScanning on Helm)

    environments: # optional, display order
      - { id: dev, name: DEV }
      - { id: prod, name: PROD }

    trackedWorkflows: # optional
      - id: ci # slug, unique
        name: Continuous Integration
        file: ci-main.yml # workflow file name in .github/workflows
        critical: true # critical workflows drive Delivery health
        appliesTo: [backend, frontend] # optional: component ids or "coordinator"; default = all components

    securityControls: # all eight are mandatory
      codeScanning: { required: true }
      secretScanning: { required: true }
      dependabot: { required: true }
      containerScanning: { required: false }
      iacScanning: { required: false }
      dast: { required: false }
      sbom: { required: false }
      artifactSignature: { required: false }

    securityStatusPath: .security/project-security-status.json # optional (default shown)
```

Le regole di validazione sono:

- formato `owner/name`
- id univoci per progetti, componenti, ambienti e workflow
- `submodulePath` univoco
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

### Aggiungere un progetto (senza modifiche al codice)

1. Aggiungi una voce sotto `projects:` in `config/projects.yaml`.
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
componente. Il pannello **Suggerimenti** elenca i submodule del coordinator non collegati
ad alcun componente (dall'ultima esecuzione del collector); _Aggiungi come componente_ crea
un componente collegato tramite il suo `submodulePath` configurato, con il repository
precompilato quando noto.

La pagina resta statica e in sola lettura: è generata da `public/data/catalog.json` (scritto
dal collector, non legge mai direttamente `config/`), valida in tempo reale nel browser con
lo stesso schema Zod di `npm run validate:config` e genera l'**intero**
`config/projects.yaml` (valori vuoti e predefiniti omessi). Non chiama mai le API di GitHub
e non contiene token: copia o scarica lo YAML, apri `config/projects.yaml` nell'editor di
GitHub (link derivato da `repository.url` in `package.json`), committa su un nuovo branch e
apri una PR. Si applicano i tuoi permessi GitHub e la CI valida il risultato. I commenti del
file scritto a mano non vengono conservati: rivedi il diff prima del commit.

## `config/policies.yaml`: policy di salute

Sono policy dell'MVP, non valutazioni del rischio universali. Modificarle non richiede
interventi sul codice o sul frontend.

| Chiave                                  | Default                       | Significato                                                                                                                        |
| --------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `freshness.snapshotStaleHours`          | 24                            | Il sito segnala lo snapshot come non aggiornato (calcolato nel browser).                                                           |
| `freshness.workflowRunStaleDays`        | 14                            | Un'ultima esecuzione completata più vecchia di questo valore è non aggiornata.                                                     |
| `freshness.securityScanStaleDays`       | 7                             | Un'ultima analisi di code scanning più vecchia di questo valore è non aggiornata.                                                  |
| `freshness.securityStatusFileStaleDays` | 7                             | I risultati di stato delle pipeline più vecchi di questo valore sono non aggiornati.                                               |
| `delivery.queuedThresholdMinutes`       | 60                            | In coda o in esecuzione da più di questo valore significa Attenzione (Attention).                                                  |
| `delivery.missingCriticalWorkflow`      | amber                         | Stato per un workflow critico mancante o mai eseguito.                                                                             |
| `delivery.failedCriticalWorkflow`       | red                           | Stato per un workflow critico fallito o annullato.                                                                                 |
| `security.redOnSeverities`              | [critical]                    | I finding aperti con queste severità rendono rosso il Rischio sicurezza.                                                           |
| `security.amberOnSeverities`            | [high, medium, low]           | I finding aperti con queste severità rendono ambra il Rischio sicurezza.                                                           |
| `security.openSecretAlertIsRed`         | true                          | Un alert di secret scanning aperto è rosso.                                                                                        |
| `security.requiredControlFailedIsRed`   | true                          | Un controllo obbligatorio fallito è rosso.                                                                                         |
| `security.staleScanIsAmber`             | true                          | Una scansione obbligatoria non aggiornata è ambra.                                                                                 |
| `security.incompleteCoverageIsAmber`    | true                          | Una copertura non verde rende ambra il Rischio sicurezza.                                                                          |
| `coverage.greenThresholdPercent`        | 100                           | La copertura è verde a partire da questa percentuale.                                                                              |
| `version.componentDrift`                | amber                         | La versione dichiarata differisce dall'ultima release.                                                                             |
| `version.environmentBehind`             | amber                         | Ambiente indietro rispetto alla versione del coordinator, o non coerente con essa.                                                 |
| `version.unresolvableSubmodule`         | red                           | Un submodule configurato non può essere risolto.                                                                                   |
| `version.unknownManifestComponent`      | red                           | Il manifest fa riferimento a un componente sconosciuto.                                                                            |
| `version.unmappedSubmodule`             | amber                         | Un submodule non associato ad alcun componente.                                                                                    |
| `version.untaggedSubmodule`             | amber                         | Il coordinator fissa uno SHA che non è un tag di release del componente.                                                           |
| `version.manifestSubmoduleMismatch`     | amber                         | Il manifest dichiara una versione diversa da quella fissata dal submodule.                                                         |
| `governance.*`                          | amber                         | Workflow standard mancante, repository archiviato, file di stato mancante o non valido, branch predefinito non corrispondente.     |
| `overall.criticalDimensions`            | [delivery, version, security] | Un rosso in queste dimensioni rende rosso il progetto. Un rosso altrove conta come ambra.                                          |
| `overall.requiredDimensions`            | tutte e cinque                | Devono essere tutte verdi perché lo stato Complessivo sia verde.                                                                   |
| `overall.greyRequiredDimension`         | grey                          | Effetto di una dimensione obbligatoria Unknown (Sconosciuto): grey o amber.                                                        |
| `publication.audience`                  | public                        | `public` omette titoli dei finding e rule id dei repository non pubblici. `restricted` richiede Pages con controllo degli accessi. |
| `publication.allowedLinkHosts`          | [github.com]                  | Vengono pubblicati solo i link verso questi host.                                                                                  |

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

## Variabili d'ambiente

| Variabile                                                   | Dove                             | Scopo                                                      |
| ----------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------- |
| `DATA_SOURCE`                                               | variabile di repository / env    | `mock` (predefinito) o `github`                            |
| `GH_APP_ID`, `GH_APP_PRIVATE_KEY`, `GH_APP_INSTALLATION_ID` | Actions secrets                  | Autenticazione tramite GitHub App (consigliata)            |
| `GH_READ_TOKEN`                                             | Actions secret                   | PAT fine-grained di fallback                               |
| `GITHUB_TOKEN`                                              | automatico                       | Ultimo fallback (solo repository corrente)                 |
| `GITHUB_API_URL`                                            | automatico / env                 | URL base dell'API (GitHub Enterprise Server)               |
| `SITE_URL`, `BASE_PATH`                                     | impostate dal workflow di deploy | `site` e `base` di Astro (da configure-pages)              |
| `SNAPSHOT_DIR`                                              | locale / test                    | Directory alternativa degli snapshot per la build del sito |
