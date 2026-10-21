# Operatività

> 🇬🇧 [English version](../operations.md)

## Workflow pianificati

| Workflow           | Pianificazione                                        | Note                                                                                                                             |
| ------------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `deploy-pages.yml` | `17 */6 * * *` (ogni 6 h, UTC)                        | `collect` → `build` → `deploy`. Viene eseguito anche al push su `main` e su richiesta. `concurrency: pages` senza cancellazione. |
| `collect-data.yml` | su richiesta / `repository_dispatch` (`collect-data`) | Raccolta di prova (dry run) che produce l'artifact `snapshots` e un job summary. Non effettua il deploy.                         |
| `ci.yml`           | PR, push su `main`                                    | Quality gate solo su dati mock.                                                                                                  |

GitHub può ritardare le esecuzioni pianificate nei momenti di carico e disabilita le
pianificazioni dopo 60 giorni senza attività sul repository. Riattivale dalla scheda
Actions.

Per cambiare la frequenza, modifica il `cron` in `deploy-pages.yml`. Mantieni la soglia di
dato non aggiornato (`freshness.snapshotStaleHours`) superiore all'intervallo.

## Monitoraggio del collector

- **Job summary**: ogni raccolta aggiunge `collection-report.md` (progetti, stato
  complessivo, conteggi degli errori, errori classificati) al riepilogo dell'esecuzione.
- L'**artifact** `snapshots` contiene il JSON sanitizzato, incluso
  `collection-report.json`.
- La **pagina Qualità dati** (`/data-quality/`) mostra l'ultima esecuzione, la modalità di
  autenticazione, la disponibilità delle capability, le sorgenti non accessibili, le
  sorgenti non aggiornate, i submodule non risolti e gli errori per progetto.
- **Banner di dato non aggiornato**: il sito mostra un banner quando lo snapshot è più
  vecchio di `snapshotStaleHours`. Il calcolo avviene nel browser di chi consulta il sito,
  quindi anche un sito che ha smesso di aggiornarsi viene segnalato.
- Tieni d'occhio le esecuzioni fallite di `deploy-pages`. I fallimenti sono strutturali,
  ad esempio config, credenziali, schema o sanitizzazione non validi, e richiedono un
  intervento. Gli errori sui singoli repository **non** fanno fallire l'esecuzione.

## Rate limit

- Il costo è di circa `repos × 8 + tracked workflow targets × (1–2) + submodules + 2 × projects`
  chiamate REST per esecuzione. Con il catalogo demo sono circa 120.
- Il throttling di Octokit ritenta una volta quando l'attesa è ≤ 60 s (limiti primari e
  secondari), con al massimo 4 chiamate in parallelo.
- Un'installazione di GitHub App ha limiti più alti di un PAT. Per cataloghi grandi è
  preferibile la App.
- Se compaiono errori `rate-limited`, riduci la frequenza della pianificazione, suddividi
  il catalogo oppure abbassa la concorrenza in `collector/src/run.ts`.

## Riesecuzione manuale

- **Aggiornamento completo e pubblicazione**: Actions → _Deploy — GitHub Pages_ →
  _Run workflow_.
- **Solo raccolta (dry run)**: Actions → _Collect — Data snapshots_ → _Run workflow_,
  scegliendo `mock` o `github`. Poi scarica l'artifact `snapshots` per ispezionarlo.
- **Trigger esterno**:
  `gh api repos/<owner>/<repo>/dispatches -f event_type=collect-data`. Esegue la raccolta
  senza deploy.
- **In locale**: `DATA_SOURCE=github GH_READ_TOKEN=… npm run collect:github && npm run
validate:snapshots`.

## Dati non aggiornati

1. Controlla l'ultima esecuzione di `deploy-pages`. Se la pianificazione è stata
   disabilitata, riattivala.
2. Se le esecuzioni riescono ma le sorgenti non sono aggiornate, la causa è a monte:
   workflow non eseguiti nei repository monitorati, scansioni non effettuate o file di
   stato non aggiornati. Va risolta lì. Il portale lo segnala, non lo corregge.
3. Modifica le soglie in `policies.yaml` solo quando non corrispondono alla cadenza reale
   del team.

## Errori parziali

| Classe           | Causa tipica                                                                                    | Azione                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `not-authorised` | App non installata sul repository, permesso mancante, ambito del PAT                            | Installa la App o concedi il permesso di lettura. Non concedere mai la scrittura. |
| `not-found`      | Repository rinominato o eliminato, refuso nel catalogo                                          | Correggi `config/projects/<id>.yaml`.                                             |
| `not-configured` | Funzionalità disabilitata (alert Dependabot, secret scanning, nessuna analisi di code scanning) | Abilitala nel repository, oppure contrassegnala come non obbligatoria.            |
| `rate-limited`   | Troppe chiamate                                                                                 | Vedi "Rate limit".                                                                |
| `invalid-data`   | Manifest o file di stato malformato, oppure che fa riferimento a un altro repository            | Correggi il file nel repository monitorato.                                       |
| `error`          | 5xx o rete                                                                                      | Di solito transitorio. L'esecuzione successiva ritenta.                           |

## Rollback

- **Sito**: riesegui una precedente esecuzione riuscita di `deploy-pages` (Actions → run →
  _Re-run all jobs_) oppure fai il revert del commit su `main`. Pages serve l'ultimo
  artifact rilasciato finché un nuovo deploy non va a buon fine.
- **Configurazione o policy**: fai il revert della modifica in `config/` (PR).
  L'esecuzione successiva la applica.
- **Emergenza** (esposizione di dati): vedi [security.md → Risposta a un'esposizione
  accidentale](security.md#risposta-a-unesposizione-accidentale). Per prima cosa disabilita
  Pages.

## Pubblicare il riepilogo di qualità dalla CI

La dimensione Qualità legge l'artifact `hub-quality-summary` di ogni repository monitorato
(contratto: [Configurazione](configuration.md#artifact-hub-quality-summary-ogni-repository-opzionale)).
Aggiungi due step allo **stesso job che esegue i test e scrive `coverage/cobertura.xml`**:
ogni job gira su un runner nuovo, quindi un job separato non vedrebbe il file di copertura.
Gli step trasformano il file Cobertura in `quality-summary.json` e lo caricano, solo sul
branch predefinito, con una conservazione di 30 giorni:

```yaml
test:
  runs-on: ubuntu-latest
  permissions:
    contents: read
  steps:
    - uses: actions/checkout@<sha-completo-del-commit>
    # ... configura il tuo toolchain ...
    - name: Esegui i test con la copertura
      run: <il tuo comando di test> # deve scrivere coverage/cobertura.xml
    - name: Scrivi quality-summary.json
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
    - uses: actions/upload-artifact@<sha-completo-del-commit>
      if: github.ref == format('refs/heads/{0}', github.event.repository.default_branch)
      with:
        name: hub-quality-summary
        path: quality-summary.json
        retention-days: 30
```

Note:

- Fissa l'action a uno SHA completo, come ogni action di questo progetto.
- Mantieni esattamente il nome dell'artifact e del file; lo zip deve restare sotto 64 KB.
- Caricalo solo da esecuzioni sul branch predefinito del repository stesso: le esecuzioni da
  fork o da altri branch sono ignorate dal collector.
- La conservazione è anche l'orizzonte di aggiornamento: dopo il periodo l'artifact scade e
  il report diventa `expired` (non visibile, mai 0%). I report più vecchi di
  `freshness.qualityReportStaleDays` (14 per impostazione predefinita) risultano non
  aggiornati.
- La copertura è letta dagli attributi radice Cobertura `lines-covered` e `lines-valid`. Per
  gli altri formati calcola i due numeri e imposta `format` di conseguenza.

## Storico tra le esecuzioni

Ogni raccolta aggiunge a `history.json` un punto compatto per progetto, e il collector lo
confronta con il precedente per scrivere `changes.json` (la pagina "Cosa è cambiato"). Il
runner parte vuoto ogni volta, quindi è GitHub Actions a portare lo storico:

- il job `collect` esegue prima `npm run history:restore`. Legge l'artifact `hub-history`
  più recente del **proprio** repository con `GITHUB_TOKEN` e `actions: read` (mai con le
  credenziali del collector); poi il collector aggiunge e scrive il nuovo file;
- il job carica un nuovo artifact `hub-history` (solo `history.json`, 90 giorni), solo con
  `data-source: github` e solo se il ripristino è finito in `restored` o `none`. Dopo un
  ripristino `failed` (o uno step di ripristino andato in errore) non si carica nulla: lo
  storico nuovo, di una sola voce, diventerebbe l'artifact più recente e farebbe perdere
  tutta la catena, quindi resta il più recente quello precedente e la prossima esecuzione
  riprova. Un'esecuzione mock manuale non può mai rompere la catena reale;
- un'esecuzione mock non ripristina mai: parte dal `fixtures/history/history.json`
  sintetico.

Il ripristino scorre fino a 500 artifact (5 pagine da 100), dal più recente, e se un artifact
affidabile non è un archivio valido prova il successivo (fino a 3 archivi non validi) prima
di arrendersi con `bad-archive`.

Sono accettati solo artifact del branch predefinito, di questo repository (non di un
fork), di un'altra esecuzione, fino a 5 MiB e del workflow di deploy o di raccolta. Tutto il
resto non viene usato.

### Stati del ripristino

Lo stato è in `history.json` (`restore.state`), in `changes.json` (`basis.state`), nella
scheda "Storico" di Qualità dei dati e nel riepilogo del job. Uno stato diverso da
`restored` non fa mai fallire la raccolta, e la pagina "Cosa è cambiato" lo spiega invece di
dire "nessun cambiamento".

| Stato            | Significato                                                                                                    | Cosa fare                                                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `restored`       | Lo storico precedente è stato letto ed esteso.                                                                 | Niente.                                                                                                                                                            |
| `fixture`        | Esecuzione mock, partita dalla fixture sintetica.                                                              | Niente. Dati demo.                                                                                                                                                 |
| `none`           | Nessuno storico precedente (prima esecuzione, artifact scaduti, `--fresh-history`).                            | Niente. I cambiamenti compaiono dopo la prossima raccolta.                                                                                                         |
| `restore-failed` | Non è stato possibile scaricare l'artifact (non autorizzato, archivio non valido, errore API).                 | Verifica che il job `collect` abbia `actions: read` (il log del workflow stampa il codice del motivo). Non si carica nulla, quindi la prossima esecuzione riprova. |
| `unreadable`     | Il file precedente era troppo grande, non JSON, non valido per lo schema o non pubblicabile; è stato scartato. | Di solito è un caso isolato. Se si ripete, controlla l'esecuzione precedente.                                                                                      |
| `incompatible`   | Il file precedente usa una versione di schema che questa versione non legge.                                   | Niente: lo storico riparte da questa raccolta.                                                                                                                     |
| `source-changed` | Lo storico precedente veniva dall'altra fonte dati (mock o GitHub).                                            | Niente: lo storico riparte da questa raccolta. Voci più vecchie dell'altra fonte, dietro un'ultima voce corrispondente, vengono scartate con una nota.             |

Lo storico non blocca mai gli snapshot. Se lo storico ripristinato supera i controlli ma non
è comunque pubblicabile, viene scartato (stato `unreadable`). Se non si riesce a costruire
nemmeno uno storico da zero, `history.json` e `changes.json` non vengono scritti per
quell'esecuzione, gli snapshot sì, e il riepilogo del job mostra
`History | not written this run` con il motivo sotto "History notes".

Limiti: lo storico copre al massimo 500 progetti (un catalogo più grande non ha storico e
riceve una nota). Per progetto tiene al massimo 500 repository, alert critici/alti aperti,
fonti illeggibili e chiavi di errore, e 200 versioni. Un elenco al limite può essere stato
tagliato, quindi il "Cosa è cambiato" successivo non elenca alert (o errori) nuovi per quel
progetto e lo segna come parziale. Se `history.json` supera gli 8 MiB letti dall'esecuzione
successiva, le raccolte più vecchie vengono scartate con una nota.

### Azzerare lo storico

Avvia a mano il workflow **Collect — Data snapshots** (`workflow_dispatch`) con
`data-source: github` e `fresh-history: true`. Salta il ripristino, registra il motivo
`fresh-history` nel riepilogo del job e il nuovo storico sostituisce la catena. In
alternativa, elimina tutti gli artifact `hub-history` (repository, Actions, Artifacts): la
raccolta successiva riparte da zero (stato `none`). Impostare `history.enabled: false`
**non** azzera nulla: non si carica nessun nuovo artifact, quindi quello vecchio viene
ripristinato di nuovo quando lo riattivi.

### Concorrenza e scadenza

Il job `collect` gira nel gruppo di concorrenza `hub-collect` con
`cancel-in-progress: false`, così due raccolte non ripristinano mai la stessa base
sovrascrivendosi a vicenda. L'artifact dura 90 giorni: se nessuna raccolta gira per più
tempo, la catena si perde e lo storico riparte (stato `none`).

## Dati locali e `ci:build`

`npm run ci:build` esegue `collect:mock`, che sovrascrive `public/data`. Uno snapshot locale
con dati reali (per esempio da `collect:github`) va raccolto di nuovo dopo di esso.

**Aggiornamento allo snapshot 1.4** (dimensione Qualità): il sito legge solo
`schemaVersion` 1.4. Un `public/data` 1.3 esistente non supera la validazione finché non viene
raccolto di nuovo (`collect:github`, o la prossima esecuzione pianificata). Ricorda che
`npm run ci:build` sovrascrive `public/data` con dati mock.

Un `npm run collect:github` locale aggiunge a `public/data/history.json` (il percorso
predefinito dello storico è la directory di output), quindi uno storico locale con dati reali
cresce tra le esecuzioni come quello della CI. `npm run ci:build` ci scrive sopra lo storico mock.

## Conservazione degli artifact

| Artifact                                              | Conservazione           | Contenuto                                  |
| ----------------------------------------------------- | ----------------------- | ------------------------------------------ |
| `snapshots`                                           | 14 giorni               | JSON sanitizzato + collection report       |
| `site`                                                | 1 giorno                | `dist/` generata, passata al job di deploy |
| `github-pages`                                        | default di GitHub       | Artifact di deployment di Pages            |
| Report di coverage CI                                 | default upstream        | Coverage di Vitest (`coverage/`)           |
| `hub-quality-summary` (in ogni repository monitorato) | 30 giorni (consigliato) | `quality-summary.json`: solo conteggi      |
| `hub-history`                                         | 90 giorni               | `history.json`: solo punti compatti        |

Gli artifact contengono solo dati sanitizzati e pubblicabili. Non contengono mai
credenziali, file temporanei o payload grezzi.
