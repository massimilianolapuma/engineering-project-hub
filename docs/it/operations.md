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
| `not-found`      | Repository rinominato o eliminato, refuso nel catalogo                                          | Correggi `projects.yaml`.                                                         |
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

## Conservazione degli artifact

| Artifact              | Conservazione     | Contenuto                                  |
| --------------------- | ----------------- | ------------------------------------------ |
| `snapshots`           | 14 giorni         | JSON sanitizzato + collection report       |
| `site`                | 1 giorno          | `dist/` generata, passata al job di deploy |
| `github-pages`        | default di GitHub | Artifact di deployment di Pages            |
| Report di coverage CI | default upstream  | Coverage di Vitest (`coverage/`)           |

Gli artifact contengono solo dati sanitizzati e pubblicabili. Non contengono mai
credenziali, file temporanei o payload grezzi.
