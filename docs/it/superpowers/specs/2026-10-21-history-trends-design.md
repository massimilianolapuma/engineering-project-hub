# Storico e cambiamenti: andamento, "Cosa è cambiato", export CSV — design

English: [../../../superpowers/specs/2026-10-21-history-trends-design.md](../../../superpowers/specs/2026-10-21-history-trends-design.md)

Stato: design del builder nell'ambito della spec di programma (l'owner rivede dopo la consegna) · Data: 2026-10-21 · Release prevista: v0.7.0

Spec di programma: [2026-10-21-roadmap-program-design.md](2026-10-21-roadmap-program-design.md) (§2 vincoli e §4 "v0.7.0 Storico e cambiamenti" sono vincolanti). Ogni decisione non fissata lì è indicata come **(scelta del builder)**.

## 1. Intento e motivo

Oggi ogni raccolta sostituisce la precedente. L'hub risponde a "com'è adesso?" ma non a "sta migliorando?" o "cosa si è mosso da ieri?". Per uno strumento decisionale sono le prime domande dopo un cambio di stato.

La v0.7.0 aggiunge tre cose:

- uno **storico compatto e limitato**, mantenuto tra le esecuzioni senza nuova infrastruttura;
- una pagina **"Cosa è cambiato dall'ultima raccolta"**;
- **export CSV** del portfolio, di un riepilogo degli alert e delle versioni, come file statici.

Fatti verificati nel codice prima di decidere:

- `writeSnapshots` cancella la directory di output prima di scrivere (`rm -rf`), quindi il collector deve leggere l'eventuale storico precedente **prima** di scrivere.
- Il job di raccolta carica `public/data` come artifact `snapshots` con retention di **14 giorni**. Il job di raccolta ha solo `contents: read`.
- Gli snapshot vengono rigenerati a ogni esecuzione e si legge solo lo `schemaVersion` 1.4 (`SUPPORTED_SNAPSHOT_SCHEMA_VERSIONS = ['1.4']`). Uno storico contenuto nello snapshot diventerebbe illeggibile al successivo aumento di versione dello snapshot.
- Il sito legge `public/data` (o `SNAPSHOT_DIR`) solo in fase di build. Gli snapshot golden sono generati con `GOLDEN_NOW = 2026-01-15T12:00:00.000Z` da `fixtures/github`.
- `scripts/scan-output.ts` scansiona solo un elenco fisso di estensioni di testo, che non include `.csv`.
- Gli id dei finding sono stabili e leggibili: `<owner>/<repo>#code-scanning#<n>`, `#dependabot#<n>`, `#secret-scanning#<n>`.

## 2. Obiettivi, non-obiettivi, anti-obiettivi

Obiettivi

- Per progetto e per esecuzione: stato complessivo, punteggio, stato per dimensione, conteggi dei finding aperti per severità, numero di errori di raccolta. Per esecuzione: timestamp e metadati dell'esecuzione. Nient'altro.
- Lo storico persiste tra le esecuzioni in GitHub Actions usando solo gli artifact dell'hub stesso, e in locale usando la directory di output esistente.
- Un andamento per progetto (sparkline del punteggio e striscia degli stati) e un andamento compatto nel portfolio.
- Una pagina "Cosa è cambiato":
  - cambi di stato (complessivo e per dimensione);
  - alert critici/alti nuovi e risolti;
  - spostamenti di versione;
  - nuovi errori di raccolta.
- Tre file CSV statici, sicuri da aprire in un foglio di calcolo.
- Funziona con dati mock e senza credenziali. La demo pubblica mostra un andamento sintetico.

Non-obiettivi

- Niente payload grezzi, titoli degli alert risolti o storico per singolo finding. Solo conteggi e la piccola "baseline" che serve a calcolare il confronto successivo (§5.3).
- Nessuno storico per la tabella per componente della Qualità, per i workflow o per gli ambienti.
- Nessuna libreria di grafici lato client, nessun fetch lato client di JSON o CSV.
- Nessuna notifica. Arrivano nella v0.11.0 e useranno `changes.json`.
- Nessun recupero del passato: lo storico parte dalla prima raccolta v0.7.0.

Anti-obiettivi (fallimento anche se "funziona")

- Un punto di storico mai raccolto, o un punto interpolato.
- Un punteggio mancante disegnato come 0, o un vuoto disegnato come una linea.
- "Nessun cambiamento" mostrato quando lo storico precedente non era leggibile.
- Un alert mostrato come "risolto" solo perché la sua fonte è diventata illeggibile. Un alert mostrato come "nuovo" solo perché la sua fonte è diventata leggibile.
- Punti mock mescolati a uno storico reale, o viceversa.
- Una cella CSV che un foglio di calcolo esegue come formula.
- Segreti, token, payload grezzi o contenuti di file in `history.json`, `changes.json` o nei CSV.

## 3. Vincoli (spec di programma §2, invariati)

- Sola lettura verso i repository monitorati e le fonti. Le uniche nuove chiamate API leggono gli artifact del repository dell'hub **stesso**, con il `GITHUB_TOKEN` del workflow e `actions: read` su sé stesso.
- Static-first, nessun backend, nessuna chiamata a GitHub dal browser.
- Allowlist Zod rigorosa su ogni campo pubblicato. Testi e link sanificati. Allowlist degli host per i link.
- Sconosciuto ≠ zero; 403 ≠ nessun dato; 404 ambiguo = sconosciuto.
- EN + IT per tutta la documentazione e tutte le stringhe della UI (test di parità i18n).
- Solo dati mock nella demo pubblica, con nomi sintetici.
- Token Warm Graphite; lo stato mai affidato al solo colore; WCAG 2.2 AA.
- Lo schema degli snapshot sale una sola volta per ogni release che lo modifica. Questa release **non** lo modifica (§5.1).
- Non eseguire mai `npm run ci:build` o `collect:mock`. Non usare né terminare mai la porta 4321. Solo podman.

## 4. Decisioni in breve (tutte scelte del builder salvo indicazione)

| #   | Decisione                                                                                                                                                                       | Perché                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Due nuovi file pubblicati, `history.json` e `changes.json`, ciascuno con il proprio `kind` e `schemaVersion: "1.0"`                                                             | Lo storico deve sopravvivere agli aumenti di versione dello snapshot; il modello degli snapshot resta 1.4, quindi un `public/data` esistente resta leggibile  |
| D2  | Un artifact dedicato `hub-history` (solo `history.json`), retention 90 giorni, caricato solo con `data-source: github`                                                          | Più lungo dei 14 giorni di `snapshots`; un'esecuzione mock manuale non può mai interrompere la catena reale                                                   |
| D3  | Ripristino con un piccolo script Node (`npm run history:restore`) che usa Octokit e il lettore zip esistente                                                                    | Logica di selezione testabile, limiti di dimensione, controlli di provenienza; nessuna nuova action                                                           |
| D4  | La fonte mock non ripristina mai: parte sempre dal file sintetico `fixtures/history/history.json`                                                                               | Demo e file golden deterministici; storico mock e reale non si incontrano mai                                                                                 |
| D5  | Retention nelle policy: `history.enabled` (true), `history.maxEntries` (120), `history.maxAgeDays` (90)                                                                         | 120 = 30 giorni con la pianificazione ogni 6 ore; dimensione del file limitata                                                                                |
| D6  | Il collector calcola `changes.json`; il sito si limita a mostrarlo                                                                                                              | Il confronto richiede la baseline precedente, che il collector sostituisce                                                                                    |
| D7  | Gli alert si confrontano per coppia (repository, fonte), solo se la coppia era leggibile in **entrambe** le raccolte                                                            | Evita falsi "risolti" e falsi "nuovi"                                                                                                                         |
| D8  | CSV: RFC 4180, virgola, CRLF, UTF-8 **con BOM**, intestazioni in inglese snake_case, un solo insieme di file per entrambe le lingue, `unknown` per null                         | Il BOM fa leggere a Excel le lettere accentate; intestazioni stabili e leggibili dalle macchine; null non diventa mai una cella vuota che vale 0 in una somma |
| D9  | Iniezione CSV: una cella **testuale** che inizia con `=` `+` `-` `@` TAB o CR riceve un `'` iniziale; i numeri non vengono mai prefissati                                       | Indicazione OWASP; l'hub emette solo numeri non negativi, quindi nessun numero negativo viene mai alterato                                                    |
| D10 | Sparkline su scala fissa 0–100, SVG generato lato server, vuoti per null                                                                                                        | Piccoli movimenti non sembrano drammatici; niente JS; lo sconosciuto non è mai 0                                                                              |
| D11 | Un file di storico o di cambiamenti mancante o non valido non fa mai fallire la build del sito; la pagina spiega il motivo. `validate:snapshots` fallisce su un file non valido | Dati più vecchi e prime esecuzioni continuano a funzionare; la CI intercetta comunque un file rotto                                                           |
| D12 | Le voci mantengono solo i progetti presenti nel catalogo attuale                                                                                                                | Un progetto rimosso (magari riservato) non resta in un file pubblico                                                                                          |

## 5. Design

### 5.1 File e versioni (D1)

L'insieme degli snapshot (`index.json`, `projects/*.json`, `catalog.json`) non cambia e resta allo `schemaVersion` **1.4**. Accanto, nella directory di output, si aggiungono due file:

| File           | `kind`        | `schemaVersion` | Riletto dal collector?            | Letto dal sito? |
| -------------- | ------------- | --------------- | --------------------------------- | --------------- |
| `history.json` | `hub-history` | `1.0`           | Sì (esecuzione successiva)        | Sì (andamento)  |
| `changes.json` | `hub-changes` | `1.0`           | No (rigenerato a ogni esecuzione) | Sì (pagina)     |

Perché non portare lo snapshot a 1.5 e incorporarvi lo storico:

- Il file dello storico è l'unico input che attraversa esecuzioni **e** release. Se facesse parte dello snapshot, il prossimo aumento di versione (v0.8.0) renderebbe illeggibile il file precedente, e ogni release cancellerebbe lo storico.
- Lo storico ha una propria regola di compatibilità: un collector elenca `SUPPORTED_HISTORY_SCHEMA_VERSIONS`. Una versione successiva dello storico deve essere additiva e includere un convertitore da `1.0`. Una versione non supportata riparte da zero con stato `incompatible` (§5.4). Non viene mai letta in parte.
- Lasciare lo snapshot a 1.4 evita una nuova raccolta obbligatoria: un `public/data` esistente senza i nuovi file continua a generare il sito, e le pagine dicono "ancora nessuno storico".

Il letterale `kind` impedisce di interpretare un file come l'altro.

`history.json` viene serializzato **senza indentazione** (è l'unico file grande). `changes.json` è indentato come gli snapshot. Entrambi passano dallo stesso controllo `assertPublishable` degli snapshot.

### 5.2 Modello dello storico (`shared/model/history.ts`)

```ts
const projectId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);

HistoryProjectPointSchema = z.object({
  id: projectId,
  overall: HealthStatusSchema,
  score: z.number().int().min(0).max(100).nullable(), // null = dati insufficienti, mai 0
  scoreMeasured: z.number().int().min(0),
  scoreRequired: z.number().int().min(0),
  /** Chiave assente = dimensione non rilevata all'epoca (collector più vecchio), non grigio. */
  dimensions: z.partialRecord(DimensionSchema, HealthStatusSchema),
  open: z.object({ critical: nullableCount, high: nullableCount,
                   medium: nullableCount, low: nullableCount }).strict(),
  countsComplete: z.boolean(),
  collectionErrors: z.number().int().min(0),
}).strict();

HistoryEntrySchema = z.object({
  collectedAt: isoDate,                       // = index.generatedAt di quell'esecuzione
  dataSource: DataSourceSchema,
  authenticationMode: AuthenticationModeSchema,
  collectorVersion: z.string().max(50),
  projects: z.array(HistoryProjectPointSchema).max(500),
}).strict();

HistoryBaselineSchema = z.object({            // solo per l'ultima voce
  collectedAt: isoDate,
  projects: z.array(z.object({
    id: projectId,
    /** Alert critici/alti aperti, al massimo 500 per progetto. */
    findings: z.array(z.object({
      id: z.string().max(200),
      severity: z.enum(['critical', 'high']),
      componentId: z.string().max(64),
      repository: z.string().max(200),
      source: FindingSourceSchema,
      htmlUrl: httpsUrl.nullable(),
    }).strict()).max(500),
    /** Coppie "owner/repo|fonte" i cui alert non erano leggibili in quell'esecuzione. */
    unreadable: z.array(z.string().max(250)).max(500),
    versions: z.array(z.object({
      kind: z.enum(['coordinator', 'component']),
      componentId: z.string().max(64).nullable(),   // null per il coordinatore
      version: z.string().max(100).nullable(),
    }).strict()).max(200),
    /** Chiavi "owner/repo|fonte|classificazione" degli errori di raccolta dell'esecuzione. */
    errors: z.array(z.string().max(300)).max(500),
  }).strict()).max(500),
}).strict();

HistoryFileSchema = z.object({
  kind: z.literal('hub-history'),
  schemaVersion: z.enum(SUPPORTED_HISTORY_SCHEMA_VERSIONS),   // ['1.0']
  generatedAt: isoDate,
  retention: z.object({ maxEntries: z.number().int(), maxAgeDays: z.number().int() }).strict(),
  restore: z.object({ state: HistoryRestoreStateSchema, previousEntries: z.number().int().min(0) }).strict(),
  entries: z.array(HistoryEntrySchema).min(1).max(1000),       // dalla più vecchia alla più recente
  baseline: HistoryBaselineSchema,
}).strict()
  .refine(f => f.baseline.collectedAt === f.entries.at(-1)!.collectedAt)
  .refine(voci strettamente crescenti per collectedAt);
```

- `HistoryRestoreStateSchema = z.enum(['restored', 'fixture', 'none', 'restore-failed', 'unreadable', 'incompatible', 'source-changed'])` (§5.4).
- Da dove vengono i dati:
  - un punto viene dal `ProjectSummary` dell'esecuzione: `overall`, `score`, i sei stati delle dimensioni, `openCounts.{critical,high,medium,low}`, `countsComplete`, `collectionErrorCount`;
  - la baseline viene dal `ProjectSnapshot` dell'esecuzione.
- Nella baseline:
  - `findings` sono gli alert aperti con severità critica/alta;
  - `unreadable` elenca ogni coppia (repository, fonte di alert) con un errore di raccolta per `code-scanning`, `dependabot`, `secret-scanning` o `security-status-file`. Un errore `repository` rende illeggibili tutte e quattro le coppie di quel repository;
  - `versions` sono la versione del coordinatore e l'`effectiveVersion` di ogni componente;
  - `errors` sono le chiavi deduplicate degli errori di raccolta.
- Dimensione (stima del builder): circa 250 byte per progetto per voce. 50 progetti × 120 voci ≈ 1,5 MB, ben sotto il limite di scansione di 20 MB.

### 5.3 Modello dei cambiamenti

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
        synthetic: z.boolean(), // true quando i punti precedenti sono fixture mock
      })
      .strict(),
    totals: z.object({ statusChanges, newFindings, resolvedFindings, versionMoves, newErrors }), // interi
    projects: z.array(
      z
        .object({
          id: projectId,
          added: z.boolean(), // assente nella voce precedente → nulla da confrontare
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
          /** Alcune coppie (repository, fonte) erano illeggibili in una delle due esecuzioni: non confrontate. */
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

Regole del confronto (funzione pura, `collector/src/history/changes.ts`):

- **Precedente** significa l'ultima voce ripristinata e la baseline ripristinata. Quando lo stato di ripristino non è `restored` o `fixture`, `basis.state` assume quello stato (`none` per `none`), ogni progetto ha `added: false`, `previous: null` e liste vuote, e i `totals` sono tutti 0. La pagina non legge mai quegli zeri come "nessun cambiamento": mostra invece il messaggio sulla base del confronto (§5.7).
- **Cambi di stato:** prima `overall`, poi le sei dimensioni nell'ordine di `DimensionSchema`, quando `from !== to`. Un passaggio da o verso `grey` è un cambiamento (significa "diventato sconosciuto" o "diventato misurabile"). Una dimensione assente nel punto precedente non viene confrontata.
- **Finding:** solo severità critica e alta, identificati dall'`id` del finding.
  - Un alert attuale è **nuovo** quando il suo id non è nella baseline precedente **e** la sua coppia (repository, fonte) non è nell'elenco `unreadable` precedente.
  - Un alert precedente è **risolto** quando il suo id non è più aperto **e** la sua coppia non è nell'elenco `unreadable` attuale.
  - `findingsPartial` è true quando una qualsiasi coppia è illeggibile in una delle due esecuzioni.
  - Le liste sono ordinate prima i critici, poi per id, e limitate a 50 ciascuna. Il resto è contato in `findingsTruncated`.
  - Un alert nuovo riporta il `title` dello snapshot attuale (già nascosto dalla policy di pubblicazione quando serve). Uno risolto non ha titolo.
- **Spostamenti di versione:** versione del coordinatore ed `effectiveVersion` di ogni componente, solo quando **entrambi** i valori sono noti e diversi. Un passaggio da noto a sconosciuto è una perdita di visibilità e compare come nuovo errore di raccolta, non come spostamento.
- **Errori:** nuovi = chiavi attuali non presenti nella baseline precedente; `resolvedErrors` = chiavi precedenti non più presenti.
- Un progetto assente nella voce precedente ha `added: true` e nulla di confrontato. Un progetto presente nella voce precedente ma non più nel catalogo viene eliminato (D12).
- I `totals` sommano le liste di tutti i progetti. `newFindings` e `resolvedFindings` includono gli elementi troncati.

### 5.4 Caricamento dello storico precedente e suoi stati

`loadPreviousHistory(opts)` in `collector/src/history/load.ts` restituisce `{ state, file: HistoryFile | null }`:

| Situazione                                                                | `state`                                        | File usato                                                                                 |
| ------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `history.enabled: false`                                                  | n/d: non si scrivono né storico né cambiamenti | nessuno                                                                                    |
| Fonte dati `mock`                                                         | `fixture`                                      | `fixtures/history/history.json`, con i token `@now…` risolti sull'orologio dell'esecuzione |
| `HISTORY_RESTORE_STATE=failed` (la CI non ha potuto scaricare l'artifact) | `restore-failed`                               | nessuno                                                                                    |
| `HISTORY_RESTORE_STATE=none`, o nessun file nel percorso dello storico    | `none`                                         | nessuno                                                                                    |
| File oltre 8 MiB (8 388 608 byte), non JSON, o schema non valido          | `unreadable`                                   | nessuno                                                                                    |
| `kind` corretto ma `schemaVersion` non supportato                         | `incompatible`                                 | nessuno                                                                                    |
| Valido, ma `entries.at(-1).dataSource` diverso da quello dell'esecuzione  | `source-changed`                               | nessuno                                                                                    |
| Valido e stessa fonte dati                                                | `restored`                                     | sì                                                                                         |

- Il percorso dello storico è `--history-from <dir>`, poi `$HISTORY_FROM`, poi la directory `--out` (default `public/data`). Si legge `<dir>/history.json`. `--fresh-history` forza `none`.
- Il file è un input non fidato:
  - viene letto con un unico handle e un controllo di dimensione (nessuna race tra controllo e uso, come in `scan-output.ts`);
  - viene validato con lo schema rigoroso;
  - ogni `htmlUrl` viene ricontrollato con `sanitizeUrl` rispetto agli `publication.allowedLinkHosts` **attuali**, e portato a `null` se non ammesso;
  - ogni `version` e ogni `id` di finding passa da `scrubIdentifier`;
  - l'output finale passa da `assertPublishable`.
- Le voci ripristinate vengono ripulite prima dell'uso:
  - si scartano le voci con `collectedAt` uguale o successivo all'esecuzione attuale;
  - le voci vengono ordinate e deduplicate per `collectedAt`;
  - si eliminano i progetti non più nel catalogo attuale, e le voci rimaste vuote vengono scartate.
- Uno stato "riparte da zero" non fa mai fallire la raccolta. Lo stato viene scritto in `history.restore.state`, in `changes.basis.state` e come una riga in `collection-report.md`: per esempio `History: restored 12 previous collections` oppure `History: started fresh (restore-failed)`. Il report arriva al riepilogo del job.

### 5.5 Aggiunta e retention

`appendHistory(previous, run, policies, now)` in `collector/src/history/append.ts`:

1. Prende le voci precedenti ripulite (vuote quando si riparte da zero).
2. Aggiunge la voce attuale costruita da `index.projects` e `index.run`.
3. Scarta le voci più vecchie di `now − maxAgeDays`, poi tiene le ultime `maxEntries`. La voce attuale sopravvive sempre (`maxEntries ≥ 2`).
4. Sostituisce la baseline con quella dell'esecuzione attuale.
5. Scrive `retention` (i valori effettivi) e `restore` (`state` e il numero di voci precedenti mantenute).

Policy (nuovo blocco opzionale, `shared/model/policies.ts`; lo `schemaVersion` delle policy resta `1.0`):

```yaml
history:
  enabled: true # false = niente history.json / changes.json, le pagine dicono "storico disattivato"
  maxEntries: 120 # 2–1000; 120 ≈ 30 giorni con la pianificazione ogni 6 ore
  maxAgeDays: 90 # 1–400; le voci più vecchie vengono scartate
```

### 5.6 Persistenza in GitHub Actions (D2, D3)

`collect-data.yml`, job `collect`:

- `permissions: { contents: read, actions: read }`. `actions: read` serve solo a elencare e scaricare gli artifact di questo stesso repository. Il job chiamante `collect` in `deploy-pages.yml` riceve lo stesso `actions: read`, perché un workflow chiamato non può superare i permessi del chiamante.
- `concurrency: { group: hub-collect, cancel-in-progress: false }` sul job. Due raccolte non ripristinano mai la stessa base sovrascrivendosi a vicenda.
- Nuovo step **Restore previous history**, dopo "Validate configuration" e prima di "Collect", solo quando `data-source == 'github'`:
  - env `GITHUB_TOKEN: ${{ github.token }}`. Le credenziali del collector **non** vengono date a questo step.
  - Esegue `npm run --silent history:restore -- --out .history-restore`.
  - Scrive `state=restored|none|failed` e `reason=<codice>` in `$GITHUB_OUTPUT`. Termina sempre con codice 0.
- Lo step **Collect** riceve due valori env in più: `HISTORY_FROM: .history-restore` e `HISTORY_RESTORE_STATE: ${{ steps.history.outputs.state }}`. Gli output degli step passano tramite env, mai inseriti direttamente nello script, come il workflow fa già.
- Nuovo step **Upload history artifact**, dopo "Upload snapshots artifact", solo quando `data-source == 'github'`:
  - `actions/upload-artifact` fissato allo stesso SHA di oggi;
  - `name: hub-history`, `path: public/data/history.json`, `retention-days: 90`, `if-no-files-found: warn`.
- `.history-restore/` viene aggiunto a `.gitignore`. È fuori da `public/data`, quindi nulla di ripristinato viene pubblicato finché il collector non l'ha rivalidato e riscritto.

`scripts/restore-history.ts`, con la logica di selezione in `collector/src/history/select-artifact.ts` (pura):

1. `GET /repos/{owner}/{repo}` (da `GITHUB_REPOSITORY`) → `id`, `default_branch`.
2. `GET /repos/{owner}/{repo}/actions/artifacts?name=hub-history&per_page=30`.
3. Tiene gli artifact per cui valgono tutte queste condizioni:
   - `expired === false`;
   - `workflow_run.head_branch === default_branch`;
   - `workflow_run.repository_id === id` e `workflow_run.head_repository_id === id` (mai un'esecuzione da fork);
   - `workflow_run.id !== GITHUB_RUN_ID`;
   - `size_in_bytes ≤ 5 MiB` (5 242 880).

   Li ordina dal più recente.

4. Per al massimo i primi 5 candidati, `GET /actions/runs/{run_id}` e accetta il primo per cui:
   - `path`, senza un eventuale suffisso `@ref`, è `.github/workflows/deploy-pages.yml` o `.github/workflows/collect-data.yml`;
   - `event` è uno tra `schedule`, `push`, `workflow_dispatch`, `repository_dispatch`.

   È difesa in profondità: un workflow di pull request non può piazzare uno "storico".

5. Scarica lo zip (`rest.actions.downloadArtifact`, `archive_format: 'zip'`), poi `readZipEntry(buf, 'history.json', 8_388_608)` (l'esistente `collector/src/util/zip.ts`). Scrive `.history-restore/history.json`.
6. Esiti:

   | Esito                               | `state`    | `reason`         |
   | ----------------------------------- | ---------- | ---------------- |
   | Scaricato e scritto                 | `restored` | nessuno          |
   | Nessun candidato                    | `none`     | `no-artifact`    |
   | 403 su una qualsiasi chiamata       | `failed`   | `not-authorised` |
   | `ZipError` o artifact troppo grande | `failed`   | `bad-archive`    |
   | Qualsiasi altro errore              | `failed`   | `api-error`      |

   Lo script stampa solo stato e motivo, mai un payload o un URL con un token.

"Ultima esecuzione riuscita" (spec di programma §4) è definita così: l'esecuzione più recente, sul branch di default, del workflow di deploy o di raccolta dell'hub stesso che ha raggiunto lo step di upload. Quello step parte solo dopo che collector e `validate:snapshots` sono riusciti (scelta del builder). `history.json` è anche dentro l'artifact `snapshots`, quindi il job di deploy e il sito lo vedono come prima.

In locale, `npm run collect -- --source github` aggiunge a `public/data/history.json` senza bisogno di flag, perché il percorso di default dello storico è la directory di output. Nulla richiede `ci:build`.

### 5.7 UI

Caricamento dei dati (`src/lib/data.ts`):

- `loadHistory()` e `loadChanges()` leggono `history.json` e `changes.json` dalla directory degli snapshot.
- Restituiscono `{ ok: false, kind: 'missing' | 'invalid' }` invece di lanciare un errore (D11). Un file non valido registra un solo avviso in fase di build.

Regole comuni:

- I grafici sono SVG inline generati lato server con i token Warm Graphite, `aria-hidden`, con un equivalente testuale accanto. Lo stato è mostrato con colore **e** forma: l'altezza di una cella della striscia codifica lo stato (rosso piena, ambra ⅔, verde ⅓, grigio contorno tratteggiato a piena altezza), e le etichette di testo portano il significato.
- Un punteggio null è un vuoto. Un punto isolato è un pallino. I valori non vengono mai interpolati attraverso i vuoti.
- Una dimensione assente in una voce più vecchia appare come "non rilevata", mai come grigio.

**Portfolio** (`index.astro`):

- Una nuova colonna **Trend** / **Andamento** dopo il punteggio: una sparkline 96×20 degli ultimi 30 punti e un testo con la variazione, per esempio `▲ +14 · 12 g`, con l'etichetta accessibile "Punteggio in aumento di 14 punti in 12 giorni (13 raccolte)".
- La variazione confronta il primo e l'ultimo punto **misurato** nella finestra.
- Meno di 2 punti misurati: "Punti misurati insufficienti". Nessun file di storico: "Ancora nessuno storico".
- Sui telefoni l'andamento sta sotto il punteggio nella stessa cella (scelta del builder, seguendo la tabella responsive esistente).
- Un link "Scarica CSV" a `exports/portfolio.csv` accanto agli strumenti della lista.

**Pagina progetto** (`projects/[id].astro`):

- Un nuovo blocco **Trend** / **Andamento** dopo le schede delle dimensioni (`<section id="trend">`):
  - una sparkline 320×56 con le etichette guida 0 e 100;
  - una striscia dello stato complessivo, una cella per voce;
  - una frase con il primo e l'ultimo punteggio misurato, le date e il numero di raccolte;
  - la nota "I vuoti sono raccolte in cui il punteggio non era misurabile; non vengono mai disegnati come 0.";
  - un `<details>` "Mostra lo storico come tabella": data, stato complessivo, punteggio, le sei dimensioni come badge testuali, critici/alti aperti. Questa tabella è l'alternativa testuale completa.
- Al massimo 120 punti (la retention).
- Un link "Cosa è cambiato per questo progetto" a `changes/#p-<id>`.

**Cosa è cambiato** (`src/pages/[...lang]/changes.astro`, rotta `changes/`, `PageKey 'changes'`):

- La voce di navigazione sta subito dopo Portfolio. Etichetta di navigazione: "What changed" / "Cosa è cambiato". Titolo della pagina: "What changed since last collection" / "Cosa è cambiato dall'ultima raccolta".
- Introduzione:
  - `compared`: "Confronto con la raccolta del {date} ({relative})." Quando `synthetic` è true, una nota dice "Dati demo: le raccolte precedenti sono sintetiche."
  - Negli altri casi, un messaggio per ogni stato (§5.8). Nessuno di essi dice mai "nessun cambiamento".
- Una riga di riepilogo con i cinque totali, ciascuno con un link alla prima occorrenza.
- Una scheda per progetto, prima i progetti con cambiamenti, poi per stato attuale (dal peggiore), con ancora `p-<id>`:
  - cambi di stato come `Dimensione: [badge da] → [badge a]`;
  - punteggio `58 → 40`;
  - alert critici/alti nuovi, con link a GitHub, e l'etichetta "titolo nascosto" quando il titolo è null;
  - alert risolti (solo id e link);
  - spostamenti di versione `componente: 3.0.2 → 3.1.0`;
  - nuovi errori di raccolta (repository, fonte, causa), più "N errori non si verificano più";
  - la nota `findingsPartial` quando è true;
  - "Nessun cambiamento." quando tutte le liste sono vuote;
  - "Nuovo in questa raccolta: nulla da confrontare." quando `added`.
- `changes.json` assente: "Nessun dato sui cambiamenti in questo snapshot (raccolto prima della v0.7.0 o con lo storico disattivato)."

**Qualità dei dati**: una scheda "Storico" mostra:

- lo stato del ripristino come frase, per esempio "Ripristinate 12 raccolte precedenti (la più vecchia del 3 gen 2026)" oppure "Ripartito da zero: non è stato possibile ripristinare lo storico precedente";
- la retention ("fino a 120 raccolte, al massimo 90 giorni");
- il numero di voci.

**Come leggere**: una nuova sezione `#trends` "Trends, changes and CSV" / "Andamento, cambiamenti e CSV". Spiega:

- cos'è un punto;
- che i vuoti non sono mai 0 e che i valori non vengono mai interpolati;
- i valori di retention, letti da `policies.yaml` tramite `src/lib/policies.ts`;
- la regola di confronto degli alert (solo fonti leggibili in entrambe le raccolte);
- le convenzioni CSV (UTF-8 con BOM, virgola, `unknown` = non leggibile e mai 0, `n/a` = non applicabile, un apostrofo iniziale protegge il testo che inizia con `=`, `+`, `-` o `@`).

**Pagine Sicurezza e Versioni**: un link CSV ciascuna (`exports/findings-summary.csv`, `exports/versions.csv`).

**Design-first** (regola permanente dell'owner): prima di scrivere il codice della UI, la cella dell'andamento, il blocco dell'andamento e la pagina dei cambiamenti vengono disegnati come artboard nel canvas di Claude Design con Warm Graphite. L'owner rivede dopo la consegna, quindi questo non blocca. Dopo la build, il canvas e il README del DS vengono aggiornati. Nessun link agli artifact entra nel repository.

### 5.8 Stringhe EN/IT (le principali; elenco completo nel piano)

| Chiave                         | EN                                                                                                              | IT                                                                                                                                           |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `nav.changes`                  | What changed                                                                                                    | Cosa è cambiato                                                                                                                              |
| `changes.title`                | What changed since last collection                                                                              | Cosa è cambiato dall'ultima raccolta                                                                                                         |
| `changes.basis.none`           | This is the first collection with history. Changes appear after the next collection.                            | Questa è la prima raccolta con storico. I cambiamenti compariranno dopo la prossima raccolta.                                                |
| `changes.basis.restore-failed` | The previous history could not be restored, so changes cannot be computed. This does not mean "no changes".     | Non è stato possibile ripristinare lo storico precedente, quindi i cambiamenti non si possono calcolare. Non significa "nessun cambiamento". |
| `changes.basis.unreadable`     | The previous history file was not valid and was set aside. History starts again from this collection.           | Il file dello storico precedente non era valido ed è stato scartato. Lo storico riparte da questa raccolta.                                  |
| `changes.basis.incompatible`   | The previous history uses a format this version does not read. History starts again from this collection.       | Lo storico precedente usa un formato che questa versione non legge. Lo storico riparte da questa raccolta.                                   |
| `changes.basis.source-changed` | The previous history came from another data source (mock or GitHub). History starts again from this collection. | Lo storico precedente proveniva da un'altra fonte dati (mock o GitHub). Lo storico riparte da questa raccolta.                               |
| `changes.findingsPartial`      | Some alert sources could not be read in one of the two collections; their alerts are not compared.              | Alcune fonti di alert non erano leggibili in una delle due raccolte; i loro alert non vengono confrontati.                                   |
| `trend.title`                  | Trend                                                                                                           | Andamento                                                                                                                                    |
| `trend.none`                   | No history yet                                                                                                  | Ancora nessuno storico                                                                                                                       |
| `trend.notEnough`              | Not enough measured points                                                                                      | Punti misurati insufficienti                                                                                                                 |
| `trend.gapNote`                | Gaps are collections where the score could not be measured; they are never drawn as 0.                          | I vuoti sono raccolte in cui il punteggio non era misurabile; non vengono mai disegnati come 0.                                              |
| `exports.portfolio`            | Download CSV                                                                                                    | Scarica CSV                                                                                                                                  |
| `exports.findings`             | Alert summary (CSV)                                                                                             | Riepilogo alert (CSV)                                                                                                                        |
| `exports.versions`             | Versions (CSV)                                                                                                  | Versioni (CSV)                                                                                                                               |

### 5.9 Export CSV (D8, D9)

- Endpoint statici di Astro generano i file in fase di build, dagli stessi dati validati usati dalle pagine:
  - `src/pages/exports/portfolio.csv.ts`
  - `src/pages/exports/findings-summary.csv.ts`
  - `src/pages/exports/versions.csv.ts`

  Sono serviti in `<base>/exports/*.csv` e condivisi da entrambe le lingue. Le pagine li collegano con `exportHref(name)` in `src/lib/routes.ts`, che rispetta il base path. Il link ha l'attributo `download`.

- Formato (scelta del builder):
  - RFC 4180, separatore virgola, CRLF dopo ogni riga compresa l'ultima;
  - un BOM UTF-8 (`﻿`) all'inizio;
  - intestazioni in inglese snake_case;
  - booleani `true` / `false`, date ISO;
  - `unknown` per un valore null, `n/a` per una colonna che non si applica alla riga.

  Excel con separatore di elenco italiano (`;`) richiede Dati → Da testo/CSV. È documentato, non aggirato con una riga `sep=`, che rompe altri parser e il riconoscimento del BOM.

- Codifica delle celle (`src/lib/csv.ts`, pura):
  1. Un `number` si scrive con `String(n)`. L'hub emette solo numeri non negativi, quindi non viene mai prefissato.
  2. Un `null` si scrive come `unknown`.
  3. Una stringa il cui primo carattere è `=`, `+`, `-`, `@`, TAB o CR riceve un prefisso `'`.
  4. Poi, se la cella contiene `,`, `"`, CR o LF, viene racchiusa tra `"…"` con le virgolette interne raddoppiate.
- Colonne:
  - `portfolio.csv`: una riga per progetto, nell'ordine dell'indice.
    `project_id, project_name, business_unit, lifecycle, overall, score, score_measured, score_required, delivery, version, security, controls_coverage, controls_coverage_percent, governance, quality, quality_percent, open_critical, open_high, open_medium, open_low, counts_complete, open_secret_alerts, failed_critical_workflows, collection_errors, collected_at, previous_overall, previous_score, previous_collected_at`.
    Le colonne `previous_*` vengono dalla voce di storico precedente (`n/a` quando non c'è). Usare i valori precedenti invece di una differenza mantiene ogni numero non negativo.
  - `findings-summary.csv`: una riga per progetto × repository, da `securityControls` (così un repository con zero alert compare comunque).
    `project_id, component_id, repository, open_critical, open_high, open_medium, open_low, open_informational, open_unknown, sources_complete`.
    - Quando nessuna fonte di alert del repository era leggibile, tutti i conteggi sono `unknown`.
    - Quando alcune lo erano, i conteggi sono numeri (un limite inferiore) e `sources_complete` è `false`.
    - Niente titoli, id di regole o percorsi.
  - `versions.csv`: una riga per coordinatore, componente e ambiente.
    `row_type (coordinator|component|environment), project_id, item_id, item_name, repository, version, version_source, declared_version, latest_release, drift, manifest_consistency, pin_status, environment_status`.
- `scripts/scan-output.ts` aggiunge `.csv` a `TEXT_EXT`, così il controllo di pubblicazione scansiona anche gli export.

### 5.10 Storico mock (sintetico, deterministico)

`fixtures/history/history.json` è un file di storico `1.0` valido, tranne che per i timestamp, che sono token `@now-Nd`. Con `GOLDEN_NOW = 2026-01-15T12:00:00.000Z` si risolvono dal 3 al 14 gennaio 2026 alle 12:00. Contiene 12 voci giornaliere (`@now-12d` … `@now-1d`), tutte `dataSource: mock`, `authenticationMode: mock`, `collectorVersion: 0.6.0`.

| Progetto | Punti (dal più vecchio al più recente, poi l'esecuzione attuale)                                                                                                                               | Mostra                                                                              |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Alpha    | 64, 64, 66, 66, 68, 70, **null** (`@now-6d`, complessivo grigio, governance verde, altre dimensioni grigie), 72, 72, 74, 76, 76 → attuale **78**; complessivo ambra; delivery precedente ambra | Andamento in miglioramento, un vuoto, uno spostamento di versione, un alert risolto |
| Beta     | 62, 62, 60, 60, 60, 58 ×7 → attuale **40**; complessivo precedente ambra, tutte e sei le dimensioni ambra                                                                                      | Peggioramento di stato, nuovo critico, nuovo errore di raccolta                     |
| Platform | assente prima di `@now-9d`; 84 ×3 (qualità ambra) poi 82 ×6 (qualità rossa) → attuale **82**                                                                                                   | Progetto aggiunto dopo (nessun punto inventato), nessun cambiamento                 |
| Gamma    | tutto null, tutte le dimensioni grigie, conteggi null, 2 errori di raccolta → attuale null                                                                                                     | Sconosciuto per tutto il periodo: nessuna linea, mai 0                              |

La baseline (per `@now-1d`) è scelta in modo che il `changes.json` golden contenga esattamente:

- **Alpha:**
  - cambio di stato `delivery amber → green`, punteggio 76 → 78;
  - alto risolto `example-org/project-alpha-backend#code-scanning#9`;
  - spostamento di versione `component frontend 2.0.3 → 2.1.0`;
  - l'alert aperto `example-org/project-alpha-frontend#dependabot#7` è nella baseline, quindi non è nuovo.
- **Beta:**
  - `overall amber → red`, `delivery amber → red`, `security amber → red`, punteggio 58 → 40;
  - nuovo critico `example-org/project-beta-api#code-scanning#3` (titolo nascosto);
  - nuovo errore `example-org/project-beta-web | secret-scanning | not-authorised` (gli errori secret-scanning di coordinator e api sono nella baseline);
  - `findingsPartial: true`.
- **Platform:** nessun cambiamento.
- **Gamma:** nessun cambiamento, `findingsPartial: true` (errori di repository).
- `totals`: `{ statusChanges: 4, newFindings: 1, resolvedFindings: 1, versionMoves: 1, newErrors: 1 }`.

Il `history.json` golden ha 13 voci, `restore.state: "fixture"`, `previousEntries: 12`. Valori dell'andamento usati nei test:

| Progetto | Variazione                   | Intervallo | Raccolte |
| -------- | ---------------------------- | ---------- | -------- |
| Alpha    | +14                          | 12 giorni  | 13       |
| Beta     | −22                          | 12 giorni  | 13       |
| Platform | −2                           | 9 giorni   | 10       |
| Gamma    | punti misurati insufficienti |            |          |

`scripts/update-golden-snapshots.ts` segue il percorso mock, che legge ogni volta la fixture e mai l'output golden precedente, quindi `npm run fixtures:update` resta idempotente.

### 5.11 Documentazione (EN + IT)

- `configuration.md`: il blocco di policy `history`, i flag del collector `--history-from` e `--fresh-history`, le variabili `HISTORY_FROM` e `HISTORY_RESTORE_STATE`, i file CSV e le loro colonne.
- `operations.md`:
  - come persiste lo storico (`hub-history`, 90 giorni);
  - gli stati di ripristino e cosa fare per ciascuno;
  - come azzerare lo storico (cancellare gli artifact `hub-history` o impostare `history.enabled: false` per un'esecuzione);
  - la concorrenza;
  - la tabella di retention degli artifact.
- `security.md`:
  - `actions: read` solo sul repository dell'hub stesso;
  - il file ripristinato trattato come input non fidato (controlli di provenienza, limiti di dimensione, validazione rigorosa, nuova sanificazione);
  - la protezione dall'iniezione CSV;
  - cosa non contengono mai `history.json`, `changes.json` e i file CSV.
- `architecture.md`: flusso dei dati (ripristino → raccolta → aggiunta → pubblicazione), nuovi file, riga del confine di fiducia per lo step di ripristino.
- README (EN/IT):
  - tabella delle viste: la riga "Cosa è cambiato", la colonna Andamento, i link CSV;
  - elenco delle funzionalità;
  - roadmap: togliere "storico e andamento, compresa una vista 'Cosa è cambiato dall'ultima raccolta'" ed "export CSV".
- `CHANGELOG.md` `[Unreleased]`.
- **ADR 0006** "Storico mantenuto tramite gli artifact Actions dell'hub stesso", EN + IT. Registra:
  - da D1 a D4;
  - le alternative: un branch o un commit git nel repository (scartato: richiede `contents: write` e sporca la cronologia), la cache di GitHub Actions (scartata: può essere eliminata dopo 7 giorni di inutilizzo, è legata al branch, non è pensata per lo stato), uno store esterno (scartato: nuova infrastruttura o dipendenza commerciale), lo storico dentro lo snapshot (scartato: perso a ogni aumento di versione dello snapshot);
  - le conseguenze: fino a 90 giorni senza esecuzioni interrompono la catena; la concorrenza è serializzata; il mock non ripristina mai.

## 6. Test (sintesi; i casi esatti sono nel piano)

- **Unit, modello:** gli schemi rigorosi rifiutano chiavi in più; rifiutano una data di baseline diversa dall'ultima voce; rifiutano voci non crescenti; `partialRecord` accetta una dimensione assente; default delle policy 120 / 90 / true e limiti.
- **Unit, caricamento:** ciascuno degli stati di ripristino di §5.4; il limite di 8 MiB; una voce futura viene scartata; un progetto rimosso viene eliminato; un host di link non ammesso diventa `null`; un canary in una versione ripristinata non raggiunge mai l'output.
- **Unit, aggiunta:** retention per età e per numero; la voce attuale è sempre mantenuta.
- **Unit, cambiamenti:**
  - i totali dello scenario golden;
  - le regole sulle coppie illeggibili in entrambe le direzioni;
  - i passaggi da e verso grigio contano;
  - una versione da sconosciuta a nota non è uno spostamento;
  - troncamento a 50;
  - gli stati "riparte da zero" danno un confronto vuoto con il `basis.state` corretto.
- **Unit, ripristino:** selezione dell'artifact (scaduto, altro branch, `head_repository_id` di un fork, esecuzione attuale, troppo grande, percorso del workflow sbagliato, evento `pull_request`); 403 → `failed / not-authorised`; nessun candidato → `none`.
- **Unit, CSV:** tabella di codifica delle celle; BOM; CRLF; `unknown` e `n/a`; intestazioni golden.
- **Unit, andamento:** segmenti della sparkline con vuoti; variazione e intervallo; altezze della striscia.
- **Integrazione, collector:** golden inclusi `history.json` e `changes.json`; `fixtures:update` idempotente; un canary nella fixture dello storico viene bloccato.
- **Integrazione, sito:** `/changes/` e `/it/changes/` vengono generate; la colonna Andamento; il blocco andamento del progetto e la sua tabella; la scheda Storico in Qualità dei dati; i file CSV esistono in `dist/exports/` con BOM e intestazioni; una build da uno snapshot 1.4 senza storico passa comunque e dice "Ancora nessuno storico".
- **e2e** (configurazione temporanea sulla porta 4377): navigazione a "Cosa è cambiato" su desktop e Pixel 7; la tabella `<details>` dell'andamento si apre da tastiera; il link CSV risponde con `text/csv` (o almeno 200 e il BOM).

## 7. Lasciato al builder

- Geometria esatta degli SVG, token per la striscia e la sparkline, layout responsive, seguendo `DESIGN.md`.
- Ordine di schede e liste oltre quanto fissato sopra.
- Se `loadHistory` mantiene una cache per directory come `loadSiteData` (previsto: sì).
- I plugin Octokit di retry e throttling nello script di ripristino (previsto: solo retry; il throttling non serve per al massimo 7 chiamate).
- Rifinitura delle stringhe EN/IT, mantenendo il significato di §5.8.
