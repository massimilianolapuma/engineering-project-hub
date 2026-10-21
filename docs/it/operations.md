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
Un job minimo che trasforma un file Cobertura in `quality-summary.json` e lo carica, solo sul
branch predefinito, con una conservazione di 30 giorni:

```yaml
quality-summary:
  if: github.ref == format('refs/heads/{0}', github.event.repository.default_branch)
  runs-on: ubuntu-latest
  permissions:
    contents: read
  steps:
    # ... esegui i test e scrivi prima coverage/cobertura.xml ...
    - name: Scrivi quality-summary.json
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

## Dati locali e `ci:build`

`npm run ci:build` esegue `collect:mock`, che sovrascrive `public/data`. Uno snapshot locale
con dati reali (per esempio da `collect:github`) va raccolto di nuovo dopo di esso.

## Conservazione degli artifact

| Artifact                                              | Conservazione           | Contenuto                                  |
| ----------------------------------------------------- | ----------------------- | ------------------------------------------ |
| `snapshots`                                           | 14 giorni               | JSON sanitizzato + collection report       |
| `site`                                                | 1 giorno                | `dist/` generata, passata al job di deploy |
| `github-pages`                                        | default di GitHub       | Artifact di deployment di Pages            |
| Report di coverage CI                                 | default upstream        | Coverage di Vitest (`coverage/`)           |
| `hub-quality-summary` (in ogni repository monitorato) | 30 giorni (consigliato) | `quality-summary.json`: solo conteggi      |

Gli artifact contengono solo dati sanitizzati e pubblicabili. Non contengono mai
credenziali, file temporanei o payload grezzi.
