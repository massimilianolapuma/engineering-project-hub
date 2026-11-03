# Output: metriche, Grafana, sintesi direzionale

> 🇬🇧 [English version](../outputs.md)

Dalla v0.14.0 l'hub trasforma i dati che già pubblica in tre output in sola lettura:

- un **file di metriche per Prometheus**, `data/metrics/hub.prom`, scritto dal collector accanto
  allo snapshot;
- una **dashboard Grafana** che legge quelle metriche;
- una pagina **Sintesi direzionale**, oscurata in modo da poterla stampare o inoltrare.

Nessuno di essi scrive da qualche parte: nessun invio a Prometheus, nessun messaggio a chat o
tracker. Le notifiche (prima Microsoft Teams) arrivano nella v0.15.0. Ogni output è attivo di
default e si può disattivare in `config/policies.yaml` (`outputs`, vedi
[Configurazione](configuration.md#output-outputs)).

## Metriche per Prometheus

### Il file

Il collector scrive `metrics/hub.prom` nel
[formato testo 0.0.4 di Prometheus](https://prometheus.io/docs/instrumenting/exposition_formats/),
dopo gli snapshot, attraverso lo stesso controllo di pubblicazione (un file che contiene un
modello di credenziale non viene mai scritto). Il sito lo serve a `<base>/data/metrics/hub.prom`.
Il report di raccolta dice quante serie contiene: `| Metrics | written 228 series (19.9 KB) |`,
oppure `off`.

Regole:

- **Solo gauge, nessun timestamp.** Il file cambia una volta per raccolta (ogni 6 ore di
  default). `hub_collection_timestamp_seconds` dice quando i dati sono stati raccolti.
- **Sconosciuto non è mai 0.** Quando un valore non è misurabile la sua serie manca e
  `hub_project_measure_known{project,measure}` vale 0. Non leggere mai una serie mancante come 0.
- **Nessun repository, componente, team, URL o dettaglio di errore** in alcuna label. L'unica
  label per progetto è l'id del catalogo (`project="project-alpha"`), che ogni pagina già mostra.
- **Limite di dimensione** (`outputs.metrics.maxBytes`, 4 MiB di default). Oltre, il file toglie
  prima gli stati per dimensione, poi tiene solo le metriche di portfolio, e imposta
  `hub_metrics_truncated 1`. La raccolta non fallisce mai per la dimensione.

### Famiglie di metriche

| Metrica                                 | Label                                                | Valore                                                                                   |
| --------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `hub_info`                              | `collector_version`, `data_source`, `schema_version` | 1                                                                                        |
| `hub_collection_timestamp_seconds`      |                                                      | quando i dati sono stati raccolti (secondi Unix)                                         |
| `hub_collection_duration_seconds`       |                                                      | durata della raccolta                                                                    |
| `hub_projects`                          |                                                      | numero di progetti                                                                       |
| `hub_portfolio_projects`                | `status`                                             | progetti per stato complessivo (`green`, `amber`, `red`, `grey`)                         |
| `hub_project_status`                    | `project`, `status`                                  | 1 per lo stato complessivo del progetto, 0 per gli altri tre                             |
| `hub_project_dimension_status`          | `project`, `dimension`, `status`                     | lo stesso per dimensione (`coverage` = copertura dei controlli di sicurezza)             |
| `hub_project_score`                     | `project`                                            | punteggio 0–100                                                                          |
| `hub_project_open_alerts`               | `project`, `severity`                                | alert aperti per gravità (`critical`, `high`, `medium`, `low`)                           |
| `hub_project_open_alerts_complete`      | `project`                                            | 1 se i conteggi sono completi, 0 se sono un minimo                                       |
| `hub_project_overdue_alerts`            | `project`, `class`                                   | alert oltre la scadenza di rimedio (`all`, `critical_high`)                              |
| `hub_project_accepted_alerts`           | `project`                                            | alert aperti coperti da un'eccezione valida                                              |
| `hub_project_exception_issues`          | `project`                                            | eccezioni scadute, datate, non verificabili o non valide                                 |
| `hub_project_repository_controls_ratio` | `project`                                            | quota di controlli sui repository superati (0–1)                                         |
| `hub_project_supply_chain_repositories` | `project`                                            | repository considerati per le evidenze della supply chain                                |
| `hub_project_sbom_available`            | `project`                                            | repository con uno SBOM leggibile                                                        |
| `hub_project_unsigned_images`           | `project`                                            | immagini distinte (per digest) senza firma verificata                                    |
| `hub_project_flagged_licenses`          | `project`                                            | pacchetti con una licenza segnalata                                                      |
| `hub_provider_enabled`                  | `provider`                                           | 1 se SonarQube, Harbor o Argo CD è attivo                                                |
| `hub_provider_state`                    | `provider`, `state`                                  | 1 per lo stato del provider (`off`, `available`, `partial`, `not-authorised`, `unknown`) |
| `hub_project_controls_coverage_ratio`   | `project`                                            | controlli di sicurezza obbligatori presenti (0–1)                                        |
| `hub_project_quality_coverage_ratio`    | `project`                                            | copertura delle righe dai test (0–1)                                                     |
| `hub_project_collection_errors`         | `project`                                            | fonti dati non lette                                                                     |
| `hub_project_measure_known`             | `project`, `measure`                                 | 1 se la misura era nota, 0 altrimenti                                                    |
| `hub_metrics_truncated`                 |                                                      | 1 se è scattato il limite di dimensione                                                  |

### Leggerlo con Prometheus

Scegli uno dei due percorsi. Gli esempi sono in [`examples/prometheus/`](../../examples/prometheus/).

**A. Prometheus legge dall'host statico.** Usa
[`scrape-static-host.yml`](../../examples/prometheus/scrape-static-host.yml). Mantieni
`fallback_scrape_protocol: PrometheusText0.0.4`: Prometheus 3 rifiuta una risposta senza content
type `text/plain`, e GitHub Pages non può impostarlo per i file `.prom`. Una lettura ogni 15
minuti basta.

**B. Textfile collector di node_exporter.** Esegui
[`fetch-hub-metrics.sh`](../../examples/prometheus/fetch-hub-metrics.sh) da cron o da un timer
systemd. Scarica il file nella cartella del textfile collector e sostituisce il precedente solo se
lo scaricamento riesce. `node_textfile_mtime_seconds` di node_exporter dice quando il file è
cambiato l'ultima volta.

### Metriche dietro Cloudflare Access

Sull'hosting protetto ([Hosting protetto](protected-hosting.md)) il sito è dietro Cloudflare
Access. Dai a Prometheus una credenziale propria che apre solo le metriche:

1. In Zero Trust crea un **service token**.
2. Crea un'applicazione Access separata per il percorso `<host-del-tuo-hub>/data/metrics/` con
   una sola policy, azione **Service Auth**, regola quel service token. Una regola su un percorso
   più specifico prevale sull'applicazione dell'intero sito e non ne eredita nulla.
3. Salva il segreto in un file leggibile da Prometheus e usa
   [`scrape-cloudflare-access.yml`](../../examples/prometheus/scrape-cloudflare-access.yml)
   (header `CF-Access-Client-Id` e `CF-Access-Client-Secret`).
4. Verifica che il token apra solo le metriche:

   ```bash
   H1="CF-Access-Client-Id: <client-id>.access"
   H2="CF-Access-Client-Secret: $(cat /etc/prometheus/secrets/cf-access-client-secret)"
   curl -s -o /dev/null -w '%{http_code}\n' -H "$H1" -H "$H2" https://<host-del-tuo-hub>/data/metrics/hub.prom  # 200
   curl -s -o /dev/null -w '%{http_code}\n' -H "$H1" -H "$H2" https://<host-del-tuo-hub>/data/index.json        # 302 o 403
   ```

Su Cloudflare Pages, `public/_headers` serve già `/data/metrics/*` come
`text/plain; version=0.0.4; charset=utf-8`.

### Esempi di alert

L'hub non fornisce regole di alert. Tre espressioni da cui partire:

- dati troppo vecchi (due raccolte saltate): `time() - hub_collection_timestamp_seconds > 8 * 3600`;
- un progetto diventato critico: `max by (project) (hub_project_status{status="red"}) == 1` per 1 h;
- alert non visibili per mezza giornata: `hub_project_measure_known{measure="open_alerts"} == 0`
  per 12 h.

## Dashboard Grafana

[`examples/grafana/engineering-project-hub.json`](../../examples/grafana/engineering-project-hub.json)
ha dieci pannelli: progetti per stato, età dei dati, alert critici o alti scaduti, progetti per
stato nel tempo, punteggio, alert critici e alti aperti, misure non visibili, immagini non firmate,
copertura SBOM e stati dei provider. Un valore mancante mostra "Not measured", mai 0; il totale degli alert scaduti copre i progetti misurati e accanto mostra quanti non lo sono stati.

Importazione: **Dashboards → New → Import**, carica il file, poi scegli la sorgente dati
Prometheus nel menu **Data source** in alto nella dashboard. Il file non contiene UID di sorgenti
dati, quindi funziona anche con il provisioning da file (lì imposta il valore predefinito della
variabile). Usa il modello JSON classico delle dashboard (`schemaVersion` 41, Grafana 12); le
versioni più recenti di Grafana lo migrano all'importazione.

## Sintesi direzionale

La pagina `executive/` ("Sintesi direzionale" nella navigazione, dopo "Cosa è cambiato") è una
pagina da condividere con la direzione:

- **Stato del portfolio:** progetti Critici, che richiedono Attenzione, Sani o Non visibili.
- **Andamento:** gli stessi conteggi ora, `trendDays` giorni fa (7 di default) e all'inizio dello
  storico conservato, più una frase ("Progetti critici: 0 → 2 dal 3 gen 2026.").
- **Rischi principali:** fino a `topRisks` progetti (5 di default), prima i critici, ciascuno con
  al massimo tre frasi fisse ("≥ 1 alert di sicurezza critico aperto.") e se è peggiorato o
  migliorato dall'ultima raccolta.
- **Scadenze di rimedio ed eccezioni** e **Catena di fornitura:** totali del portfolio.

Cosa non mostra mai, in nessun pubblico: nomi di repository, id di componenti, titoli di alert,
nomi di immagini, pacchetti o licenze, nomi di team e link a GitHub o ad altri sistemi sorgente. I
link portano solo alle pagine dell'hub. **I nomi dei progetti restano**: se sono riservati, non
inoltrare la pagina fuori dalle persone che possono aprire l'hub.

Un conteggio sconosciuto non è mai 0: la pagina dice "non misurato", oppure "≥ n" quando solo
alcuni progetti sono stati letti.

**Per team.** Aggiungi `?team=` all'indirizzo, come nel Portfolio
(`executive/?team=pay-project-alpha-dev&team=platform`). La pagina ricalcola conteggi, andamento e
rischi per i progetti di quei team e dice "Filtrato per team: 2 di 4 progetti", senza stampare i
team. Filtra solo ciò che si vede; non limita chi può vedere la pagina
([ADR 0010](architecture/adr/0010-per-team-views-without-access-control.md)).

**Stampa o PDF.** Usa il comando di stampa del browser: navigazione, barra della raccolta e link
sono nascosti, la pagina si stampa in chiaro su A4.

Disattiva la pagina con `outputs.executive.enabled: false`: nessuna pagina e nessuna voce di
navigazione.

## Fonti (verificate il 2026-11-04)

- Content type rigoroso di Prometheus 3 e `fallback_scrape_protocol`:
  [configurazione di Prometheus](https://prometheus.io/docs/prometheus/latest/configuration/configuration/),
  [note di migrazione a Prometheus 3 riassunte da New Relic](https://docs.newrelic.com/docs/infrastructure/prometheus-integrations/migrations/v2-upgrade/).
- Textfile collector di node_exporter:
  [README di node_exporter](https://github.com/prometheus/node_exporter#textfile-collector).
- Cloudflare Access, i percorsi più specifici prevalgono e non ereditano nulla:
  [Application paths](https://developers.cloudflare.com/cloudflare-one/policies/access/app-paths/);
  [Service tokens](https://developers.cloudflare.com/cloudflare-one/identity/service-tokens/).
- Importazione Grafana e modello JSON delle dashboard:
  [Import dashboards](https://grafana.com/docs/grafana/latest/dashboards/build-dashboards/import-dashboards/).
