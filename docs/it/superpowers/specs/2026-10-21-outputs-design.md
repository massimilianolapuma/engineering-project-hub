# Output: metriche Prometheus, notifiche, vista direzionale — design

English: [../../../superpowers/specs/2026-10-21-outputs-design.md](../../../superpowers/specs/2026-10-21-outputs-design.md)

Stato: design del builder sotto lo spec di programma (il proprietario rivede dopo la consegna) · Data: 2026-10-21 · Release di destinazione: v0.11.0

Spec di programma: [2026-10-21-roadmap-program-design.md](2026-10-21-roadmap-program-design.md) (§2 vincoli, §4 "v0.11.0 Outputs" e §5 anti-obiettivi sono vincolanti). Ogni decisione non fissata lì è marcata **(BC)** (scelta del builder).

Dipende dalle quattro release che vengono unite prima:

- v0.7.0 ([2026-10-21-history-trends-design.md](2026-10-21-history-trends-design.md)): `history.json`, `changes.json` (la fonte delle notifiche), `src/lib/trend.ts`, gli helper CSV, il ripristino dell'artifact `hub-history` (`collector/src/history/select-artifact.ts`);
- v0.8.0 ([2026-10-21-repository-controls-design.md](2026-10-21-repository-controls-design.md)): snapshot 1.5, storico 1.1, ADR 0007;
- v0.9.0 ([2026-10-21-risk-governance-design.md](2026-10-21-risk-governance-design.md)): snapshot 1.6, storico 1.2, `ProjectSummary.risk`, `changes.projects[].newlyOverdue`, ADR 0008;
- v0.10.0 ([2026-10-21-supply-chain-providers-design.md](2026-10-21-supply-chain-providers-design.md)): snapshot 1.7, ADR 0009 e 0010, il client HTTP esterno solo GET.

Questa release prende l'**ADR 0011**. **Non** cambia lo schema dello snapshot (resta 1.7), dello storico (resta 1.2) né `changes.json` (resta 1.0) (D1).

## 1. Intento e motivazione

Oggi tutto ciò che l'hub sa vive nelle sue pagine. Tre tipi di lettore lì non possono usarlo:

- i **sistemi di monitoraggio**, che vogliono numeri da raccogliere, graficare e su cui generare allarmi (Prometheus, Grafana);
- i **team che lavorano in una chat o in un tracker**, che vogliono sapere di un cambiamento quando avviene, non quando si ricordano di aprire l'hub (Microsoft Teams, Jira, Azure DevOps);
- i **dirigenti**, che vogliono una pagina leggibile in un minuto, da stampare e inoltrare, senza nomi di repository né link a sistemi che non possono aprire.

La v0.11.0 aggiunge questi tre output. Leggono solo ciò che il collector ha già validato e pubblicato. Le notifiche sono le **uniche scritture verso l'esterno** dell'intero programma, quindi arrivano per ultime e sono la parte più vincolata di questo design.

Fatti verificati prima di decidere (2026-10-21; fonti al §9):

- **Microsoft Teams.** I connettori Office 365 in Teams, compreso il classico "Incoming Webhook", sono stati ritirati: il rilascio finale si è svolto dal 18 al 22 maggio 2026, dopo di che i connettori smettono di funzionare. Il sostituto indicato da Microsoft è un flusso **Workflows** (Power Automate) con il trigger "When a Teams webhook request is received". Accetta una POST il cui corpo è un `message` con un array `attachments` di Adaptive Card (`contentType: application/vnd.microsoft.card.adaptive`). Il proprietario del flusso sceglie chi può chiamare il trigger: "Anyone" (l'URL con la sua firma è la credenziale, e non va inviato alcun header di autenticazione) oppure gli utenti del tenant (serve un token OAuth). Gli URL dei trigger sono passati da `*.logic.azure.com` a `*.environment.api.powerplatform.com`; i vecchi URL hanno smesso di funzionare il 30 nov 2025. Dal 2 giu 2026 il percorso può contenere un segmento di scale unit (`/direct/cu/20/workflows/…`). I messaggi sono limitati a circa 28 KB. Teams visualizza Adaptive Card fino alla versione 1.5. La pubblicazione nei canali privati non è supportata.
- **Jira Cloud.** `POST /rest/api/3/issue` crea una issue; `description` accetta Atlassian Document Format (ADF). Risposta `201 { id, key, self }`; errori 400, 401, 403, 422. Scope OAuth classico `write:jira-work` (granulari, beta: `write:issue:jira`, `write:comment:jira`, `write:comment.property:jira`, `write:attachment:jira`, `read:issue:jira`). Permessi: _Browse projects_ e _Create issues_ nel progetto di destinazione. Autenticazione: HTTP Basic con l'e-mail dell'account Atlassian e un API token. Un token **con scope** va usato tramite `https://api.atlassian.com/ex/jira/{cloudId}`; un token senza scope funziona su `https://<site>.atlassian.net`. Durata del token 1–365 giorni.
- **Azure DevOps.** `POST https://dev.azure.com/{organization}/{project}/_apis/wit/workitems/${type}?api-version=7.1` con media type `application/json-patch+json`, un array JSON Patch (`op`, `path`, `value`), risposta `200` WorkItem. Scope `vso.work_write`. Un PAT va in un header HTTP Basic: Base64 di `:{PAT}` (nome utente vuoto). Microsoft raccomanda i token Microsoft Entra al posto dei PAT; **i PAT globali smettono di funzionare il 1 dic 2026**, i PAT con ambito organizzazione continuano a funzionare.
- **Prometheus.** Formato di esposizione testuale `text/plain; version=0.0.4`: le righe terminano con `\n`, compresa l'ultima; una sola `# HELP` e una sola `# TYPE` per nome di metrica, `TYPE` prima del primo campione; i valori delle label escapano `\\`, `\"`, `\n`; i timestamp dei campioni sono facoltativi. **Prometheus 3 fa fallire uno scrape il cui `Content-Type` manca o non è riconosciuto**, a meno che la configurazione dello scrape imposti `fallback_scrape_protocol` (valori ammessi: `PrometheusProto`, `OpenMetricsText0.0.1`, `OpenMetricsText1.0.0`, `PrometheusText0.0.4`, `PrometheusText1.0.0`). Una configurazione di scrape può aggiungere header alla richiesta con `http_headers` (`values`, `secrets`, `files`).
- **Textfile collector di node_exporter.** `--collector.textfile.directory`; legge `*.prom`; aggiornamento atomico scrivendo un file temporaneo e rinominandolo; "Timestamps are not supported".
- **Service token di Cloudflare Access.** Il client invia `CF-Access-Client-Id` e `CF-Access-Client-Secret`; l'azione della policy di Access deve essere **Service Auth**.
- **actions/upload-artifact.** `overwrite: true` elimina un artifact con lo stesso nome nella run prima di caricarlo; senza, un secondo caricamento con lo stesso nome fallisce. `retention-days` 1–90.
- **In questo codice.** `publication.audience` vale `public | restricted`. `public` omette titoli e rule id dei finding nei repository non pubblici; `restricted` significa "il sito è dietro un controllo di accesso" e mostra tutto il dettaglio. Il job collect contiene le uniche credenziali delle sorgenti (ADR 0003). `scan-output.ts` analizza un elenco fisso di estensioni. Lo script di ripristino della v0.7.0 sceglie gli artifact dell'hub stesso per nome, branch, repository e percorso del workflow fidato.

## 2. Obiettivi, non-obiettivi, anti-obiettivi

Obiettivi

- Un file statico di metriche Prometheus, pubblicato con gli snapshot, che Prometheus può raccogliere dall'host statico o che node_exporter può esporre; e un JSON di dashboard Grafana che si importa in qualunque Grafana con una data source Prometheus.
- Un job di notifica opt-in che pubblica un riepilogo sanificato dei cambiamenti significativi (da `changes.json`) su Microsoft Teams, Jira e/o Azure DevOps. Dry-run per impostazione predefinita, solo in caso di cambiamento, mai due volte per lo stesso insieme di cambiamenti.
- Una pagina direzionale (EN/IT): conteggi di stato del portfolio, andamento, rischi principali in parole semplici, conteggi degli scaduti quando misurati; stampabile; senza nomi di repository né link ai sistemi sorgente.
- Documentazione per ogni output, compresa la configurazione per destinazione e ogni nuovo secret.

Non-obiettivi

- Nessun push verso Prometheus (Pushgateway, remote write) e nessun server `/metrics`: l'hub non ha runtime.
- Nessuna regola Alertmanager distribuita come codice. La documentazione mostra due espressioni di allarme di esempio.
- Nessuna notifica per singolo finding, nessuna modalità commento, nessun aggiornamento o chiusura di issue/work item precedenti, nessuna sincronizzazione bidirezionale.
- Nessuna destinazione Slack, e-mail o webhook generico in questa release.
- Nessuna autenticazione Microsoft Entra / service principal per Azure DevOps e nessun OAuth per Jira in questa release (solo PAT e API token; rischi al §8).
- Nessun Azure DevOps Server (on-premises) e nessun URL `*.visualstudio.com`.
- Nessun nuovo campo nello snapshot, nessuna modifica allo storico.

Anti-obiettivi (fallimento anche se "funziona")

- Un valore sconosciuto esportato come `0`, oppure un progetto con conteggi sconosciuti mostrato come "0 alert" nella pagina direzionale o in una notifica.
- Una notifica inviata da dati mock, da un dry-run, senza una base di confronto, o due volte per lo stesso insieme di cambiamenti.
- Una notifica o la pagina direzionale che contiene un nome di repository, un id di componente, un id o titolo di alert, un link GitHub, un dettaglio di errore, un secret o un payload grezzo.
- Una credenziale di destinazione visibile al job collect, build o deploy, stampata in un log o scritta in un artifact.
- Qualsiasi richiesta a un host fuori dalla allowlist della destinazione, qualsiasi richiesta che non sia l'unica POST documentata, o qualsiasi scrittura su un repository monitorato.
- Un fallimento delle notifiche che blocca il deploy del sito.

## 3. Vincoli (spec di programma §2, invariati)

Sola lettura verso repository monitorati e sorgenti; static-first; nessuna dipendenza commerciale; allowlist Zod rigorosa su ogni campo pubblicato o inviato; testo e link sanificati con allowlist degli host; sconosciuto ≠ zero; 403 ≠ nessun dato; 404 ambiguo = sconosciuto; EN + IT; solo dati mock nella demo pubblica; Warm Graphite, stato mai solo con il colore, WCAG 2.2 AA; mai `npm run ci:build` / `collect:mock`; mai la porta 4321 (e2e sulla 4377); solo podman. Nessuna nuova dipendenza di runtime o di sviluppo.

## 4. Decisioni in breve

| #   | Decisione                                                                                                                                                                                                                                                                                                                                                                   | Perché                                                                                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Nessun aumento di schema. I tre output derivano da `index.json`, `history.json` e `changes.json` (snapshot 1.7, storico 1.2, changes 1.0) **(BC)**                                                                                                                                                                                                                          | Ogni valore che serve è già pubblicato e validato; un aumento forzerebbe una nuova raccolta per nulla                          |
| D2  | Il collector scrive `<out>/metrics/hub.prom` (servito su `<base>/data/metrics/hub.prom`), formato testuale 0.0.4, **solo gauge, senza timestamp dei campioni, senza label di repository o componente in nessun pubblico** **(BC)**                                                                                                                                          | "Pubblicato con gli snapshot" (programma §4); il textfile collector vieta i timestamp; bassa cardinalità e nulla da oscurare   |
| D3  | Sconosciuto non è mai 0: una serie numerica è **omessa** quando il valore è sconosciuto, e `hub_project_measure_known{project,measure}` dice 0 o 1. Gli stati sono one-hot su `green\|amber\|red\|grey` (grey è uno stato, non uno zero) **(BC)**                                                                                                                           | `absent()` da solo è scomodo per gli allarmi; un gauge esplicito 0/1 no                                                        |
| D4  | Limite di dimensione `outputs.metrics.maxBytes` (predefinito 2 MiB). Oltre il limite: si elimina la famiglia per dimensione; se ancora oltre, restano solo le famiglie di portfolio. `hub_metrics_truncated 1` in entrambi i casi, più una nota nel report di raccolta **(BC)**                                                                                             | File limitato, degrado deterministico, mai una raccolta fallita                                                                |
| D5  | Due percorsi di scrape documentati: Prometheus raccoglie dall'host statico (con `fallback_scrape_protocol: PrometheusText0.0.4` e, su Cloudflare, un header `Content-Type` più un service token di Access); oppure un job cron scarica il file nella directory del textfile collector di node_exporter **(BC)**                                                             | GitHub Pages non può impostare `Content-Type` per `.prom`; Prometheus 3 lo rifiuta senza il fallback                           |
| D6  | Dashboard Grafana `examples/grafana/engineering-project-hub.json`: data source scelta tramite una variabile di template `datasource` chiamata `DS_PROMETHEUS`; i pannelli usano `${DS_PROMETHEUS}`; nessun UID scritto nel file, nessun `__inputs` **(BC)**                                                                                                                 | Funziona sia con l'importazione da interfaccia sia con il provisioning da file (il provisioning non risolve `__inputs`)        |
| D7  | Il notificatore è un **programma separato** (`notifier/`, `npm run notify`) eseguito da un **job separato** in un workflow riutilizzabile separato `notify.yml`. I secret delle destinazioni esistono solo nel suo step "Notify". ESLint vieta a `collector/**` e `src/**` di importare `notifier/**` **(BC, ADR 0011)**                                                    | Credenziali delle sorgenti e delle destinazioni non condividono mai un job né un percorso di codice                            |
| D8  | La modalità effettiva è **dry-run** a meno che valgano tutte: `notifications.yaml` `mode: send`, variabile di repository `HUB_NOTIFICATIONS=send`, fonte dati `github`, `changes.basis.state = compared`, `basis.synthetic = false`. Il dry-run scrive i payload esatti su file e li carica come artifact **(BC)**                                                          | Due opt-in indipendenti; dati mock o non confrontati non possono mai raggiungere un canale reale                               |
| D9  | Il riepilogo contiene solo id e nomi di progetto, stati, punteggi, conteggi e link **all'hub stesso**. Mai nomi di repository, id di componente, id o titoli di alert, link GitHub o dettagli di errore, in nessun pubblico **(BC)**                                                                                                                                        | Un canale di chat o un tracker è fuori dal perimetro dell'hub; chi legge segue il link all'hub (protetto) per i dettagli       |
| D10 | Soglie di significatività in configurazione; predefinite: stato complessivo peggiorato o diventato sconosciuto, Sicurezza o Delivery peggiorate, ≥ 1 nuovo alert critico, ≥ 1 critico/alto scaduto da poco. I miglioramenti non sono un trigger **(BC)**                                                                                                                    | "Solo in caso di cambiamento" (programma §4) significa cambiamento significativo, non ogni differenza                          |
| D11 | Chiave di de-duplicazione `changeSetKey` = primi 16 caratteri esadecimali dello SHA-256 su `basis.previousCollectedAt` e sull'elenco canonico degli elementi significativi. Un artifact registro `hub-notify-ledger` (90 giorni) registra `(destinazione, chiave)` dopo ogni invio riuscito. Ripristino del registro fallito in modalità send → non si invia nulla **(BC)** | Rieseguire l'intero workflow ricalcola la stessa differenza con un nuovo `generatedAt`; una chiave sul contenuto lo intercetta |
| D12 | Destinazioni: **Teams** = webhook di Workflows, Adaptive Card 1.5 in un involucro `message`; **Jira** = crea una issue per insieme di cambiamenti (REST v3, ADF); **Azure DevOps** = crea un work item per insieme di cambiamenti (7.1, JSON Patch). La modalità commento non è offerta **(BC)**                                                                            | Un elemento da smistare per insieme di cambiamenti, simmetrico tra i tracker; le soglie tengono basso il volume                |
| D13 | Un solo client HTTP verso l'esterno: solo POST, solo `https:`, host verificato contro la allowlist della destinazione prima di qualsiasi richiesta, `redirect: 'error'`, timeout 20 s, risposta letta con limite di 64 KiB e scartata tranne `id`/`key`, **nessun nuovo tentativo automatico**, messaggi di errore fissi, non registra mai URL, header o corpo **(BC)**     | La POST non è idempotente; un nuovo tentativo potrebbe duplicare. Un solo punto da verificare                                  |
| D14 | Pagina direzionale `executive/`: mai nomi di repository, id di componente, titoli di alert o link ai sistemi sorgente, **in entrambi i pubblici**. CSS di stampa. Tabella dell'andamento dallo storico. Rischi principali da modelli di frase fissi. Conteggi degli scaduti quando `risk` è presente, altrimenti "non misurato" **(BC)**                                    | Più rigoroso del programma §4 (vedi §5.1); una sola regola da verificare, qualunque pubblico scelga il proprietario            |
| D15 | Configurazione: nuovo `<configDir>/notifications.yaml` (mai pubblicato; proprio schema Zod e JSON Schema); le policy ottengono un blocco facoltativo `outputs` (`metrics`, `executive`), lo `schemaVersion` delle policy resta `1.0` **(BC)**                                                                                                                               | I dettagli delle destinazioni sono infrastruttura; gli interruttori degli output sono policy                                   |
| D16 | ADR 0011: "Notifiche verso l'esterno da un job separato, dry-run per impostazione predefinita, riepilogo senza dettagli di repository"                                                                                                                                                                                                                                      | Prima scrittura verso un sistema esterno: un cambiamento documentato del confine di fiducia                                    |

## 5. Design

### 5.1 Pubblico e oscuramento (D9, D14)

Il programma §4 dice: "nessun nome di repository quando il pubblico della pubblicazione è restricted". In questo codice `restricted` è il portale **a dettaglio completo** dietro un login, e `public` è quello leggibile da chiunque che già omette i dettagli dei finding privati ma pubblica comunque i nomi dei repository (`security.md`).

La pagina direzionale e le notifiche sono gli output che più probabilmente **escono dal perimetro**: stampati in PDF, inoltrati per e-mail, pubblicati in un canale, copiati in un ticket. Quindi il builder applica la regola nella sua forma più rigorosa:

- **Pagina direzionale:** nessun nome di repository, id di componente, id o titolo di alert, e nessun link a GitHub o ad altri sistemi sorgente, in **entrambi** i pubblici. Rimanda solo a pagine dell'hub (solo a schermo; in stampa non compaiono URL).
- **Notifiche:** stessa regola (D9). I link puntano solo a `siteUrl` (l'hub).
- **Metriche:** non esiste alcuna label di repository o componente (D2). La label `project` è l'id del catalogo, che ogni pagina già pubblica.

Conseguenze: la regola del programma §4 vale qualunque cosa imposti il proprietario; i test verificano un solo invariante (nessun `github.com`, nessuna stringa `owner/repo` del catalogo) invece di una matrice. La pagina direzionale lo dichiara nella sua introduzione: "Pronta da condividere: nessun nome di repository, titolo di alert o link ai sistemi sorgente."

I **nomi** dei progetti restano: un dirigente deve sapere di quale progetto si parla. Se anche i nomi dei progetti sono riservati, il proprietario non deve inoltrare la pagina né attivare notifiche verso un pubblico più ampio; la documentazione lo dice.

### 5.2 Blocco `outputs` delle policy (D15)

```yaml
outputs:
  metrics:
    enabled: true # false = nessun metrics/hub.prom
    maxBytes: 2097152 # 65 536–16 777 216; oltre il limite il file degrada (§5.3.4)
  executive:
    enabled: true # false = nessuna pagina direzionale e nessuna voce di menu
    topRisks: 5 # 1–10 progetti in "Rischi principali"
    trendDays: 7 # 1–90; la colonna di confronto della tabella dell'andamento
```

Tutte le chiavi sono facoltative; quando il blocco manca valgono i valori predefiniti sopra. `src/lib/policies.ts` li espone al sito, come gli altri blocchi.

### 5.3 Metriche Prometheus (D2–D5)

#### 5.3.1 File e writer

- Renderer puro `renderMetrics(index: PortfolioIndex, policies: Policies): { text: string; series: number; truncated: 'none' | 'dimensions' | 'portfolio-only' }` in `collector/src/outputs/prometheus.ts`.
- `writeSnapshots` scrive `metrics/hub.prom` dopo gli snapshot, attraverso lo stesso controllo `assertPublishable`. Disattivato → nessun file.
- Scritto per ultimo e in modo atomico (nome temporaneo + rinomina dentro la directory di output), così un lettore non vede mai un file a metà.
- `scan-output.ts` aggiunge `.prom` a `TEXT_EXT`.
- Il report di raccolta ottiene una riga: `Metrics | written 182 series (11.4 KB)`, `written (truncated: dimensions)` oppure `off`.
- Codifica UTF-8, fine riga `\n`, newline finale, famiglie nell'ordine fisso del §5.3.2, serie dentro una famiglia ordinate per label. Deterministico: il file golden è stabile byte per byte.

#### 5.3.2 Famiglie di metriche

Sono tutte `gauge`. I valori delle label vengono da enum, dall'id del progetto (slug del catalogo `^[a-z0-9][a-z0-9-]{0,62}$`) o dalla versione del collector verificata come semver. Passano comunque per l'escaping del formato (`\\`, `\"`, `\n`) come difesa in profondità.

| Metrica                               | Label                                                | Valore                                                                                      | Gestione dello sconosciuto               |
| ------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `hub_info`                            | `collector_version`, `data_source`, `schema_version` | 1                                                                                           | n/d                                      |
| `hub_collection_timestamp_seconds`    |                                                      | `index.generatedAt` in secondi Unix                                                         | n/d                                      |
| `hub_collection_duration_seconds`     |                                                      | `run.durationMs / 1000`                                                                     | n/d                                      |
| `hub_projects`                        |                                                      | numero di progetti                                                                          | n/d                                      |
| `hub_portfolio_projects`              | `status`                                             | progetti per stato complessivo (4 serie, zeri ammessi: un conteggio è noto)                 | n/d                                      |
| `hub_project_status`                  | `project`, `status`                                  | one-hot su green, amber, red, grey (4 serie per progetto)                                   | grey = 1                                 |
| `hub_project_dimension_status`        | `project`, `dimension`, `status`                     | one-hot per dimensione (6 × 4 per progetto)                                                 | grey = 1                                 |
| `hub_project_score`                   | `project`                                            | 0–100                                                                                       | omessa quando `score.value` è null       |
| `hub_project_open_alerts`             | `project`, `severity`                                | conteggio aperti, severità critical, high, medium, low                                      | omessa quando il conteggio è null        |
| `hub_project_open_alerts_complete`    | `project`                                            | 1 quando `countsComplete`, altrimenti 0                                                     | n/d                                      |
| `hub_project_overdue_alerts`          | `project`, `class`                                   | `risk.overdue` (`class="all"`) e `risk.overdueCriticalHigh` (`class="critical_high"`)       | omessa quando null o quando `risk` manca |
| `hub_project_controls_coverage_ratio` | `project`                                            | `coverage.percentage / 100`                                                                 | omessa quando null                       |
| `hub_project_quality_coverage_ratio`  | `project`                                            | `quality.percentage / 100`                                                                  | omessa quando null                       |
| `hub_project_collection_errors`       | `project`                                            | `collectionErrorCount`                                                                      | n/d                                      |
| `hub_project_measure_known`           | `project`, `measure`                                 | 1 o 0 per `score`, `open_alerts`, `overdue_alerts`, `controls_coverage`, `quality_coverage` | sempre presente (è il suo scopo)         |
| `hub_metrics_truncated`               |                                                      | 0, oppure 1 quando si applica il §5.3.4                                                     | n/d                                      |

- `open_alerts` è noto quando **tutti e quattro** i conteggi di severità sono non null. Un insieme noto solo in parte pubblica le severità note e `measure_known` 0, e `open_alerts_complete` dice se i conteggi sono un limite inferiore.
- I valori di `dimension` sono quelli di `DimensionSchema` (`delivery`, `version`, `security`, `coverage`, `governance`, `quality`). Il testo HELP di `hub_project_dimension_status` dice che `coverage` significa copertura dei **controlli**.
- Ogni famiglia ha una `# HELP` di una riga in inglese (i metadati delle metriche non sono localizzati) e la sua `# TYPE gauge`.
- Cardinalità per progetto: 4 + 24 + 1 + 4 + 1 + 2 + 1 + 1 + 1 + 5 = 44 serie al massimo. 500 progetti ≈ 22 000 serie ≈ 1,9 MB, sotto il limite predefinito.

Esempio (golden, abbreviato):

```text
# HELP hub_project_score Project score 0-100; series absent when the score could not be measured (see hub_project_measure_known).
# TYPE hub_project_score gauge
hub_project_score{project="project-alpha"} 78
hub_project_score{project="project-beta"} 40
# HELP hub_project_measure_known 1 when the measure was known in the last collection, 0 when it was not (never read a missing series as 0).
# TYPE hub_project_measure_known gauge
hub_project_measure_known{measure="score",project="project-gamma"} 0
```

#### 5.3.3 Cosa le metriche non contengono mai

Label di repository, componente, ambiente, workflow, alert o utente; titoli; URL; dettagli di errore; business unit (testo libero). Nulla che non sia nella tabella sopra.

#### 5.3.4 Limite di dimensione

Si producono tutte le famiglie. Se la lunghezza in byte supera `maxBytes`, si riproduce senza `hub_project_dimension_status`. Se la supera ancora, si producono solo `hub_info`, `hub_collection_*`, `hub_projects`, `hub_portfolio_projects` e `hub_metrics_truncated`. La raccolta non fallisce mai.

#### 5.3.5 Come lo legge Prometheus (documentazione, `examples/prometheus/`)

**A. Scrape dall'host statico.** `examples/prometheus/scrape-static-host.yml`:

```yaml
scrape_configs:
  - job_name: engineering-project-hub
    scrape_interval: 15m # il file cambia ogni 6 h; raccogliere più spesso non aggiunge nulla
    scheme: https
    metrics_path: /<base>/data/metrics/hub.prom
    fallback_scrape_protocol: PrometheusText0.0.4 # necessario su Prometheus 3 quando l'host non invia un tipo text/plain
    static_configs:
      - targets: ['<owner>.github.io']
```

- GitHub Pages non può impostare header, quindi `fallback_scrape_protocol` è necessario.
- Cloudflare Pages: `public/_headers` ottiene una regola `/data/metrics/*` con `Content-Type: text/plain; version=0.0.4; charset=utf-8` (il `Cache-Control: no-store` esistente per `/data/*` vale già).
- Cloudflare Access: si crea un **service token** e un'applicazione Access separata per il percorso `<host>/data/metrics/`, la cui azione di policy è **Service Auth** con quel token, così il token apre solo il percorso delle metriche. Prometheus lo invia con:

  ```yaml
  http_headers:
    CF-Access-Client-Id:
      values: ['<client-id>.access']
    CF-Access-Client-Secret:
      files: ['/etc/prometheus/secrets/cf-access-client-secret']
  ```

  Il builder verifica, sulla documentazione al momento della costruzione, che un'applicazione limitata a un percorso abbia la precedenza su quella dell'intero sito, e ne registra l'esito.

- Freschezza: allarme su `time() - hub_collection_timestamp_seconds > 8 * 3600` (due esecuzioni ogni 6 ore mancate).

**B. Textfile collector di node_exporter.** `examples/prometheus/fetch-hub-metrics.sh` (sh POSIX, per cron o un timer systemd): `curl --fail --silent --show-error --max-time 30 [-H CF-Access-…]` in `hub.prom.$$` nella directory del textfile collector, poi `mv` su `hub.prom`. In caso di errore lascia il file precedente ed esce con codice diverso da zero. Il file non ha timestamp, come richiede il collector. node_exporter aggiunge `node_textfile_mtime_seconds`, che indica quando il file è cambiato l'ultima volta; `hub_collection_timestamp_seconds` indica quando i dati sono stati raccolti.

Allarmi di esempio nella documentazione (non distribuiti come regole):

- `max by (project) (hub_project_status{status="red"}) == 1` per 1 h;
- `hub_project_measure_known{measure="open_alerts"} == 0` per 12 h ("alert non visibili").

### 5.4 Dashboard Grafana (D6)

`examples/grafana/engineering-project-hub.json`, modello JSON di dashboard attuale di Grafana (`schemaVersion` impostato a quello che Grafana scrive al momento della costruzione; il builder registra la versione di Grafana usata per verificarlo):

- Template:
  - `DS_PROMETHEUS`: `type: datasource`, `query: prometheus`, etichetta "Data source";
  - `project`: `type: query`, `datasource: { type: prometheus, uid: "${DS_PROMETHEUS}" }`, `query: label_values(hub_project_status, project)`, selezione multipla, con "All".
- Pannelli (ogni `datasource` è `{ "type": "prometheus", "uid": "${DS_PROMETHEUS}" }`):
  1. Stat: progetti per stato — `hub_portfolio_projects` per `status`, value mapping con testo, non solo colore.
  2. Time series: progetti per stato nel tempo — `sum by (status) (hub_project_status{project=~"$project"})`.
  3. Time series: punteggio — `hub_project_score{project=~"$project"}`, min 0, max 100, `spanNulls: false` (un punteggio mancante è un vuoto).
  4. Bar gauge: critici e alti aperti — `hub_project_open_alerts{project=~"$project",severity=~"critical|high"}`.
  5. Tabella: non visibili — `hub_project_measure_known{project=~"$project"} == 0`.
  6. Stat: critici/alti scaduti — `sum(hub_project_overdue_alerts{class="critical_high"})`, testo "No data" = "Non misurato".
  7. Stat: età dei dati — `time() - hub_collection_timestamp_seconds`, unità secondi, soglie a 8 h.
- Titolo "Engineering Project Hub", tag `engineering-hub`, `uid` `engineering-project-hub` (UID della dashboard, non di una data source), `id: null`, nessuna `version`.
- Importazione: Dashboards → New → Import → caricare il file → scegliere la data source Prometheus nel menu `DS_PROMETHEUS` dopo l'importazione (o impostarne il valore predefinito nel provisioning).

### 5.5 Notifiche

#### 5.5.1 Configurazione `<configDir>/notifications.yaml` (D15)

Zod rigoroso `NotificationsConfigSchema` in `shared/model/notifications.ts`, JSON Schema `config/schema/notifications.schema.json` (generato). File mancante → notifiche "non configurate": il notificatore scrive un riepilogo di una riga ed esce con 0. Il file non viene mai pubblicato (non è copiato nella directory di output).

```yaml
schemaVersion: '1.0'
mode: dry-run # dry-run | send. send richiede anche la variabile di repository HUB_NOTIFICATIONS=send
locale: en # en | it: lingua del riepilogo
siteUrl: null # es. https://hub.example.com/ — l'unico host di link in un riepilogo; https, senza query né frammento
trigger:
  overallWorsened: true # green→amber, green/amber→red
  becameUnknown: true # complessivo a grey da uno stato misurato
  dimensionsWorsened: [security, delivery] # dimensioni il cui peggioramento è significativo; [] = nessuna
  newFindings: { severities: [critical], min: 1 } # severities: critical | high
  newlyOverdue: { severities: [critical, high], min: 1 } # campo della v0.9.0; ignorato se assente
  newErrors: { min: 0 } # 0 = i nuovi errori di raccolta non sono mai un trigger
digest:
  maxProjects: 10 # 1–50; gli altri sono contati come "altri N progetti"
targets:
  teams:
    enabled: false
    allowedHostSuffixes: ['.environment.api.powerplatform.com'] # i cloud sovrani aggiungono i loro
  jira:
    enabled: false
    baseUrl: https://example.atlassian.net # oppure https://api.atlassian.com/ex/jira/<cloudId> per un token con scope
    projectKey: OPS # ^[A-Z][A-Z0-9_]{1,9}$
    issueType: Task # nome del tipo di issue, ≤ 60 caratteri
    labels: [engineering-hub] # ^[A-Za-z0-9_.-]{1,50}$, ≤ 5
  azureDevOps:
    enabled: false
    organization: example-org # ^[A-Za-z0-9][A-Za-z0-9-]{0,49}$
    project: Platform Ops # ≤ 64 caratteri, nessun carattere di controllo
    workItemType: Task # ≤ 60 caratteri, lettere, cifre, spazi
    areaPath: null # facoltativo, ≤ 256 caratteri
    tags: [engineering-hub] # ^[A-Za-z0-9 _.-]{1,40}$, ≤ 5
```

- `jira.baseUrl` deve essere `https://<name>.atlassian.net` (senza percorso) oppure `https://api.atlassian.com/ex/jira/<cloudId>` (UUID); qualsiasi altra forma è un errore di configurazione.
- Il `config/notifications.yaml` della demo ha ogni destinazione `enabled: false` e `mode: dry-run`.
- `validate:config` valida il file quando è presente.

#### 5.5.2 Secret (solo nello step "Notify")

| Secret              | Destinazione | Contenuto                                                                                                              | Privilegio minimo                                                                                                                               |
| ------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `TEAMS_WEBHOOK_URL` | Teams        | L'URL del trigger di Workflows. Il suo parametro `sig` è la credenziale                                                | Un flusso per canale, creato da "Send webhook alerts to a channel"; "Chi può attivare": **Anyone** (l'URL è il secret) oppure utenti del tenant |
| `JIRA_EMAIL`        | Jira         | E-mail dell'account Atlassian (trattata come secret: dato personale)                                                   | Un account dedicato (di servizio)                                                                                                               |
| `JIRA_API_TOKEN`    | Jira         | API token, preferibilmente **con scope** (`write:jira-work`, o l'insieme granulare del §1), scadenza ≤ 365 giorni      | _Browse projects_ + _Create issues_ solo in `projectKey`                                                                                        |
| `AZDO_PAT`          | Azure DevOps | PAT **con ambito organizzazione**, scope **Work Items: Read & write** (`vso.work_write`), scadenza più breve possibile | Membro solo di `project`, con permesso di creare work item di tipo `workItemType`                                                               |

- Tutti e quattro sono aggiunti a `sensitiveEnvValues()`, così il controllo di pubblicazione, il controllo dei payload del notificatore e `scan-output` intercettano un valore trapelato.
- I trigger Teams per "utenti del tenant" richiedono un token OAuth; il notificatore non lo supporta nella v0.11.0 (non invia alcun header di autenticazione a Teams). La documentazione lo dice e raccomanda "Anyone" con l'URL custodito come secret.

#### 5.5.3 Significatività e riepilogo (D9, D10)

Funzione pura `buildDigest(changes, index, config): Digest | null` in `notifier/src/digest.ts`:

- `null` quando `changes.basis.state !== 'compared'`. Il riepilogo dice perché (`basis: none`, `restore-failed`, …).
- Per progetto, gli **elementi significativi**, in questo ordine:
  - `overall`: `from → to` quando è peggiorato (`green < amber < red`) e `trigger.overallWorsened`, oppure quando `to = grey` da uno stato misurato e `trigger.becameUnknown`. Da grey a qualsiasi stato non è un peggioramento;
  - `dimension:<d>`: stessa regola per ogni `d` in `trigger.dimensionsWorsened` (nessun "diventato sconosciuto" per le dimensioni);
  - `newFindings:<sev>`: conteggio dei `newFindings` con quella severità, quando la somma su `trigger.newFindings.severities` è ≥ `min`;
  - `newlyOverdue:<sev>`: lo stesso per `newlyOverdue` (campo assente → nessuno);
  - `newErrors`: conteggio, quando `newErrors.min > 0` e il conteggio è ≥ min.
- Un progetto senza elementi significativi non è nel riepilogo. I miglioramenti non sono mai elementi.
- `Digest` (Zod rigoroso, `notifier/src/model.ts`):

  ```ts
  {
    key: string,                    // /^[0-9a-f]{16}$/
    generatedAt: utcDate,           // changes.generatedAt
    previousCollectedAt: utcDate,
    locale: 'en' | 'it',
    siteUrl: httpsUrl | null,
    totals: { projects, overallWorsened, becameUnknown, newCritical, newHigh, newlyOverdue, newErrors }, // interi
    projects: Array<{               // max digest.maxProjects; prima lo stato attuale peggiore, poi id
      id: projectId,
      name: string ≤ 100,           // dall'index (nome visualizzato del catalogo)
      overall: { from: HealthStatus | null, to: HealthStatus },
      score: { from: int | null, to: int | null },
      dimensions: Array<{ dimension: Dimension, from: HealthStatus, to: HealthStatus }>,
      newFindings: { critical: int, high: int },
      newlyOverdue: { critical: int, high: int },
      newErrors: int,
    }>,
    omittedProjects: int,
  }
  ```

- `key` (D11): SHA-256 (Node `crypto`) del JSON UTF-8 di `{ previous: basis.previousCollectedAt, items: [[projectId, itemKind, detail], …] }` con gli elementi ordinati, primi 16 caratteri esadecimali. `detail` è `from>to` per gli elementi di stato e il conteggio per gli elementi di conteggio. `generatedAt` **non** fa parte della chiave.
- Link: `{siteUrl}changes/` per `locale: en`, `{siteUrl}it/changes/` per `locale: it` (il prefisso di lingua del sito). Nessun altro URL viene mai costruito.
- Nient'altro di `changes.json` viene letto: id di alert, titoli, repository, URL, repository e classificazioni degli errori, stringhe di versione non entrano mai nel riepilogo.

#### 5.5.4 Renderer (puri, `notifier/src/render/*.ts`)

Tutte le stringhe visibili vengono dal catalogo i18n (chiavi `notify.*` in `src/i18n/en.ts` e `it.ts`, con test di parità). Le parole di stato sono sempre scritte ("Rosso (prima Ambra)"), mai solo con il colore. Il testo dalla configurazione (nomi di progetto) è escapato per il formato della destinazione.

**Teams** (`teams.ts`): corpo

```json
{
  "type": "message",
  "attachments": [
    {
      "contentType": "application/vnd.microsoft.card.adaptive",
      "contentUrl": null,
      "content": {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "type": "AdaptiveCard",
        "version": "1.5",
        "body": [
          {
            "type": "TextBlock",
            "text": "Engineering hub: 2 progetti richiedono attenzione",
            "weight": "Bolder",
            "size": "Medium",
            "wrap": true
          },
          {
            "type": "TextBlock",
            "text": "Confronto con la raccolta del 14 gen 2026, 12:00 UTC",
            "isSubtle": true,
            "wrap": true
          },
          {
            "type": "Container",
            "items": [
              {
                "type": "TextBlock",
                "text": "Project Beta: Rosso (prima Ambra)",
                "weight": "Bolder",
                "wrap": true
              },
              {
                "type": "FactSet",
                "facts": [
                  {
                    "title": "Cambi di stato",
                    "value": "Delivery Ambra → Rosso · Sicurezza Ambra → Rosso"
                  },
                  { "title": "Nuovi alert", "value": "1 critico" },
                  { "title": "Punteggio", "value": "58 → 40" }
                ]
              }
            ]
          }
        ],
        "actions": [
          {
            "type": "Action.OpenUrl",
            "title": "Apri Cosa è cambiato",
            "url": "https://hub.example.com/it/changes/"
          }
        ]
      }
    }
  ]
}
```

- `actions` solo quando `siteUrl` è impostato. Nessun `Action.Submit` (non supportato dai webhook).
- I caratteri markdown nei nomi di progetto (`\ * _ [ ] ( ) # > ~ \``) sono escapati con la barra rovesciata; il builder verifica la resa in un vero canale Teams durante la verifica manuale del Task 9 e la registra.
- Limite del corpo 24 576 byte (sotto il limite di circa 28 KB per messaggio): i progetti vengono tolti dalla fine e contati in "altri N progetti" finché il corpo rientra.

**Jira** (`jira.ts`): `POST {baseUrl}/rest/api/3/issue`, `Content-Type: application/json`, `Accept: application/json`:

```json
{
  "fields": {
    "project": { "key": "OPS" },
    "issuetype": { "name": "Task" },
    "summary": "Engineering hub: 2 projects need attention (14 Jan → 15 Jan 2026)",
    "labels": ["engineering-hub", "hub-cs-1a2b3c4d5e6f7a8b"],
    "description": {
      "type": "doc",
      "version": 1,
      "content": [
        {
          "type": "paragraph",
          "content": [
            { "type": "text", "text": "Compared with the collection of 14 Jan 2026, 12:00 UTC." }
          ]
        },
        {
          "type": "bulletList",
          "content": [
            {
              "type": "listItem",
              "content": [
                {
                  "type": "paragraph",
                  "content": [
                    {
                      "type": "text",
                      "text": "Project Beta: Red (was Amber). Delivery Amber → Red; Security Amber → Red. 1 new critical alert. Score 58 → 40."
                    }
                  ]
                }
              ]
            }
          ]
        },
        {
          "type": "paragraph",
          "content": [
            {
              "type": "text",
              "text": "Open What changed",
              "marks": [{ "type": "link", "attrs": { "href": "https://hub.example.com/changes/" } }]
            }
          ]
        },
        {
          "type": "paragraph",
          "content": [{ "type": "text", "text": "Change set 1a2b3c4d5e6f7a8b" }]
        }
      ]
    }
  }
}
```

- `summary` ≤ 255 caratteri. I nodi di testo ADF portano solo testo semplice (niente markdown, quindi nessun escaping oltre al JSON).
- La label `hub-cs-<key>` contrassegna la issue per chi la cerca; il notificatore non interroga mai Jira (nessuna chiamata di lettura).
- Successo = `201` con un corpo il cui `key` corrisponde a `^[A-Z][A-Z0-9_]+-\d+$`; la chiave finisce nel riepilogo del job (una chiave di issue non è un secret).

**Azure DevOps** (`azure-devops.ts`): `POST https://dev.azure.com/{organization}/{project}/_apis/wit/workitems/${type}?api-version=7.1`, `Content-Type: application/json-patch+json`; `organization`, `project` e `type` codificati ciascuno con `encodeURIComponent`, `$` letterale prima del tipo:

```json
[
  {
    "op": "add",
    "path": "/fields/System.Title",
    "value": "Engineering hub: 2 projects need attention (14 Jan → 15 Jan 2026)"
  },
  {
    "op": "add",
    "path": "/fields/System.Description",
    "value": "<p>Compared with …</p><ul><li>Project Beta: Red (was Amber). …</li></ul><p><a href=\"https://hub.example.com/changes/\">Open What changed</a></p><p>Change set 1a2b3c4d5e6f7a8b</p>"
  },
  {
    "op": "add",
    "path": "/fields/System.Tags",
    "value": "engineering-hub; hub-cs-1a2b3c4d5e6f7a8b"
  }
]
```

- `System.Description` è HTML: ogni testo è escapato in HTML; si emettono solo i tag fissi `p`, `ul`, `li`, `a href`, e `href` è solo basato su `siteUrl`.
- `/fields/System.AreaPath` si aggiunge quando `areaPath` è impostato. `System.Title` ≤ 255 caratteri.
- Successo = `200` con un `id` intero; l'id finisce nel riepilogo del job.

#### 5.5.5 Client HTTP verso l'esterno (D13, `notifier/src/http.ts`)

`postOnce({ target, url, body, contentType, headers, allowed, timeoutSeconds = 20, fetch })`:

- Costruisce l'URL da modelli fissi (API `URL`), poi verifica: `protocol === 'https:'`, nessun username o password, host ammesso per la destinazione (Teams: termina con uno degli `allowedHostSuffixes`; Jira: uguale all'host di `baseUrl` e percorso che inizia con il percorso di `baseUrl`; Azure DevOps: uguale a `dev.azure.com`). Fallimento → `{ outcome: 'refused', reason: 'host-not-allowed' }` senza alcuna richiesta.
- Solo `method: 'POST'` (il tipo non ammette altro). `redirect: 'error'`, `AbortSignal.timeout`.
- Legge al massimo 64 KiB della risposta, interpreta il JSON solo per estrarre `key` (Jira) o `id` (Azure DevOps), poi lo scarta.
- Classificazione: 2xx atteso → `sent`; 400 / 422 → `rejected`; 401 / 403 → `not-authorised`; 404 → `not-found`; 413 → `too-large`; 429 → `rate-limited`; altri ≥ 400, rete, timeout, redirect → `error`. Messaggi fissi per classe. URL, header, corpi di richiesta e risposta non sono mai registrati né restituiti.
- **Nessun nuovo tentativo.** Una destinazione fallita si ritenta solo rieseguendo il job; il registro salta le destinazioni già servite.
- Non usa mai il client GET della v0.10.0 e non è importabile da `collector/**`.

#### 5.5.6 Modalità, de-duplicazione ed esecuzione del notificatore (D8, D11)

`npm run notify -- --snapshots <dir> --config <configDir> --out <dir> [--ledger <file>]`:

1. Carica `notifications.yaml` (mancante → "non configurato", uscita 0) e `index.json` + `changes.json` con gli schemi rigorosi (changes mancante o non valido → "nessun dato di cambiamento", uscita 0).
2. **Modalità effettiva**: `send` solo quando la configurazione ha `mode: send`, env `HUB_NOTIFICATIONS=send`, env `DATA_SOURCE=github`, `index.run.dataSource = github`, `basis.state = compared` e `basis.synthetic = false`. Altrimenti `dry-run`, e il riepilogo nomina la prima condizione non soddisfatta (`mode-config`, `mode-variable`, `mock-data`, `not-compared`, `synthetic`).
3. `buildDigest`. `null` o nessun progetto → "nessun cambiamento significativo", uscita 0, niente prodotto.
4. Produce il payload di **ogni** destinazione in dry-run (attiva o no, così il proprietario può vederlo in anteprima), delle destinazioni **attive** in modalità send.
5. Controllo dei payload: ogni corpo serializzato passa per `findSecretPatterns` e `sensitiveEnvValues()`. Una corrispondenza → quel payload non viene scritto né inviato; uscita 1; il riepilogo nomina il pattern, mai il valore.
6. Scrive `<out>/digest.json`, `<out>/teams.json`, `<out>/jira.json`, `<out>/azure-devops.json` (ognuno `{ method, pathTemplate, body }`, nessun host per Teams, nessuna credenziale) e `<out>/summary.md`.
7. In modalità send:
   - carica il registro (`--ledger`); `HUB_LEDGER_STATE=failed` → non invia nulla, uscita 1 ("registro non disponibile: nessun invio per evitare duplicati");
   - per ogni destinazione attiva nell'ordine Teams, Jira, Azure DevOps: se `(destinazione, chiave)` è nel registro → `skipped-duplicate`; se mancano i suoi secret → `not-configured` (uscita 1 alla fine); altrimenti `postOnce`. Con `sent`, aggiunge `{ target, key, sentAt }` al registro;
   - riscrive il registro (al massimo 200 voci, si tengono le più recenti).
8. Scrive in `summary.md` righe come `Teams | sent`, `Jira | sent OPS-42`, `Azure DevOps | skipped-duplicate`, `Mode | dry-run (mock-data)`, `Change set | 1a2b3c4d5e6f7a8b`, e lo aggiunge a `$GITHUB_STEP_SUMMARY` se impostato. Uscita 1 quando una destinazione attiva è finita in `refused`, `rejected`, `not-authorised`, `not-found`, `too-large`, `rate-limited`, `error` o `not-configured`.

File del registro (`kind: 'hub-notify-ledger'`, `schemaVersion: '1.0'`, `entries: [{ target: 'teams'|'jira'|'azure-devops', key, sentAt }]`, rigoroso, ≤ 200). Non contiene URL, chiavi di issue né payload.

#### 5.5.7 Workflow (D7)

Nuovo workflow riutilizzabile **`.github/workflows/notify.yml`** (`on: workflow_call`), job `notify`:

- input `artifact-name`, `data-source`, `mode` (il chiamante passa `vars.HUB_NOTIFICATIONS`); secret facoltativi `TEAMS_WEBHOOK_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `AZDO_PAT`;
- `permissions: {}` a livello di workflow; per il job `permissions: { contents: read, actions: read }` — `actions: read` solo per elencare e scaricare gli artifact `hub-notify-ledger` di questo repository; `concurrency: { group: hub-notify, cancel-in-progress: false }`; `timeout-minutes: 10`;
- step:
  1. checkout (`persist-credentials: false`), setup di Node, `npm ci`;
  2. scarica l'artifact degli snapshot in `.notify-in/` (stessa run);
  3. **Restore ledger** (solo quando `inputs.mode == 'send'`): solo env `GITHUB_TOKEN: ${{ github.token }}`; `npm run --silent notify:restore-ledger -- --out .notify-ledger`; scrive `state=restored|none|failed` in `$GITHUB_OUTPUT`; esce sempre con 0;
  4. **Notify**: l'**unico** step con i quattro secret in `env`, più `HUB_NOTIFICATIONS`, `DATA_SOURCE`, `HUB_LEDGER_STATE` mappati da input e output degli step (mai inseriti in `run:`); esegue `npm run notify -- --snapshots .notify-in --config config --out notify-out --ledger .notify-ledger/ledger.json`; scrive `mode=send|dry-run` in `$GITHUB_OUTPUT`;
  5. `npm run scan:output -- notify-out` (`if: always()`);
  6. carica `notification-payloads` (`notify-out/`, conservazione 7 giorni, `if-no-files-found: ignore`);
  7. carica `hub-notify-ledger` (`.notify-ledger/ledger.json`, conservazione 90 giorni, `overwrite: true`) solo quando `steps.notify.outputs.mode == 'send'`.
- Il ripristino del registro riusa le regole di selezione della v0.7.0 (`candidateArtifacts`, `runIsTrusted`) generalizzate con un `name` di artifact e un'opzione per **includere la run corrente** (un nuovo tentativo deve vedere il registro del tentativo precedente). Stessi limiti: artifact ≤ 5 MiB, `readZipEntry(…, 'ledger.json', 1 MiB)`.

**`deploy-pages.yml`** ottiene:

```yaml
notify:
  name: Notify
  needs: [collect, deploy]
  if: ${{ vars.HUB_NOTIFICATIONS == 'dry-run' || vars.HUB_NOTIFICATIONS == 'send' }}
  permissions:
    contents: read
    actions: read
  uses: ./.github/workflows/notify.yml
  with:
    artifact-name: ${{ needs.collect.outputs.artifact-name }}
    data-source: ${{ needs.collect.outputs.data-source }}
    mode: ${{ vars.HUB_NOTIFICATIONS }}
  secrets:
    TEAMS_WEBHOOK_URL: ${{ secrets.TEAMS_WEBHOOK_URL }}
    JIRA_EMAIL: ${{ secrets.JIRA_EMAIL }}
    JIRA_API_TOKEN: ${{ secrets.JIRA_API_TOKEN }}
    AZDO_PAT: ${{ secrets.AZDO_PAT }}
```

- Dopo `deploy`, così il link "Cosa è cambiato" nel riepilogo punta ai dati che descrive. Nulla dipende da `notify`: un fallimento delle notifiche non blocca mai un deploy.
- I job collect, build, attest e deploy non ricevono mai i quattro secret.
- **`rw-hub-cloudflare-deploy.yml`** (il percorso protetto, con dati reali) ottiene lo stesso job, opt-in tramite un nuovo input `notifications` (`''` predefinito, `dry-run` o `send`) e i quattro secret facoltativi. Fa il checkout dell'hub al `hub-ref` verificato e della configurazione del chiamante esattamente come il suo job `collect`. Il chiamante di esempio in `examples/protected-deploy/` mostra la variabile e i secret commentati.
- `.gitignore`: `notify-out/`, `.notify-in/`, `.notify-ledger/`.

### 5.6 Vista direzionale (D14)

Percorso `executive/` (`src/pages/[...lang]/executive.astro`, `PageKey 'executive'`). Voce di menu "Executive summary" / "Sintesi direzionale", posta dopo "Cosa è cambiato". Titolo della pagina "Executive summary" / "Sintesi per la direzione". Nascosta (nessuna pagina, nessuna voce di menu) quando `outputs.executive.enabled: false`.

Modello puro `buildExecutiveView(index, history | null, changes | null, outputs, now)` in `src/lib/executive.ts`:

1. **Introduzione**: "Stato di {n} progetti al {date}." più la frase di oscuramento del §5.1. Una nota "Dati demo" quando `run.dataSource = mock`; il banner esistente dei dati non aggiornati quando lo sono.
2. **Stato del portfolio**: quattro riquadri nell'ordine Rosso, Ambra, Verde, Non visibile, ognuno con l'icona di stato, la parola e il conteggio. I conteggi sommano al numero di progetti.
3. **Andamento** (da `history.json`): una tabella con righe Rosso, Ambra, Verde, Non visibile, Progetti e colonne:
   - "Ora ({date})": l'ultima voce;
   - "{trendDays} giorni fa ({date})": la voce più recente con `collectedAt ≤ now − trendDays`; nessuna → celle "Storico insufficiente";
   - "Inizio dello storico ({date})": la voce più vecchia.
   - Una frase sotto, per esempio "Progetti rossi: 0 → 2 dall'8 gen 2026." (`Progetti` cambia quando dei progetti sono stati aggiunti dopo; la frase non tratta mai un progetto mancante come verde).
   - Storico mancante o non valido → "Ancora nessuno storico." Storico disattivato → "Lo storico è disattivato."
4. **Rischi principali** (al massimo `topRisks`): progetti con stato complessivo rosso, poi grigio, poi ambra; dentro un gruppo, prima più critici aperti, poi più alti aperti, poi punteggio più basso (null in fondo), poi id. Ogni voce:
   - nome del progetto (link alla sua pagina dell'hub a schermo), parola e icona di stato;
   - direzione: "Peggiorato dall'ultima raccolta" quando `changes` riporta un peggioramento complessivo per il progetto, "Migliorato dall'ultima raccolta" quando è migliorato, altrimenti nulla;
   - fino a tre frasi da modelli fissi, i primi tipi che corrispondono in questo ordine:

     | Tipo                   | Condizione                                                    | Modello IT                                                                           |
     | ---------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
     | `not-measurable`       | complessivo grigio                                            | "Lo stato non si può misurare: nessuna fonte dati era leggibile."                    |
     | `critical-open`        | `openCounts.critical > 0`                                     | "{n} alert di sicurezza critici aperti." (`≥ {n}` quando i conteggi sono incompleti) |
     | `overdue`              | `risk.overdueCriticalHigh > 0`                                | "{n} alert critici o alti oltre la scadenza di rimedio."                             |
     | `high-open`            | `openCounts.high > 0`                                         | "{n} alert di sicurezza alti aperti."                                                |
     | `secrets`              | `openSecretAlerts > 0`                                        | "{n} secret esposti segnalati."                                                      |
     | `delivery-failing`     | delivery rossa                                                | "Le pipeline critiche falliscono."                                                   |
     | `controls-missing`     | coverage rossa                                                | "Mancano controlli di sicurezza obbligatori."                                        |
     | `versions-out-of-line` | version rossa                                                 | "Le versioni rilasciate non sono allineate."                                         |
     | `quality-low`          | quality rossa                                                 | "La copertura dei test è sotto la soglia."                                           |
     | `partly-visible`       | non grigio e (`collectionErrorCount > 0` o `!countsComplete`) | "Una parte dello stato non è visibile: {n} fonti dati non erano leggibili."          |

   - Nessun repository, componente, alert o link. Forme plurali tramite il modello esistente `{ one, other }`.
   - Nessun progetto rosso, grigio o ambra → "Nessun progetto richiede attenzione."
5. **Scadenze di rimedio** (v0.9.0): "Alert scaduti: {n}, di cui critici o alti: {m}, in {k} progetti." Somme sui progetti dove il valore è noto; "≥" quando alcuni sono sconosciuti; "Non misurato (le scadenze di rimedio sono disattivate o non sono state raccolte)." quando ogni valore è null o `risk` manca.
6. **Piè di pagina**: data di raccolta, fonte dati, link "Come leggere questa pagina" (`how-to-read/#executive`).

Stampa (`@media print` in `src/styles/global.css`): nasconde navigazione dell'intestazione, selettore del tema, skip link e link del piè di pagina; forza i token chiari; testo nero su bianco; `@page { size: A4; margin: 15mm }`; riquadri e voci di rischio `break-inside: avoid`; link stampati come testo semplice (nessuna espansione dell'URL); la tabella dell'andamento mantiene i bordi. Nessun pulsante di stampa (nessuno script nuovo) **(BC)**.

Regole comuni: token Warm Graphite, stato con icona + parola + colore, tabelle con `<caption>` e `<th scope>`, contrasto WCAG 2.2 AA (test esistente sul contrasto dei token).

**Come leggere** ottiene `#executive` "Executive summary" / "Sintesi direzionale": cosa significa ogni blocco, la regola della colonna dell'andamento, l'ordine dei rischi, che i conteggi sconosciuti non sono mai 0 e la regola di oscuramento.

**Qualità dei dati** ottiene una riga nella scheda della run: "Metriche per Prometheus: `data/metrics/hub.prom`" (link), oppure "disattivate".

**Design-first** (regola permanente del proprietario): la pagina direzionale (schermo e stampa) viene disegnata come artboard nel canvas di Claude Design con Warm Graphite prima di scrivere codice. Il proprietario rivede dopo la consegna; questo non blocca. Dopo la costruzione si aggiornano il canvas e il README del DS. Nessun link agli artifact entra nel repository.

### 5.7 Stringhe EN/IT (principali; elenco completo nel piano)

| Chiave                          | EN                                                                                  | IT                                                                                            |
| ------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `nav.executive`                 | Executive summary                                                                   | Sintesi direzionale                                                                           |
| `executive.title`               | Executive summary                                                                   | Sintesi per la direzione                                                                      |
| `executive.redaction`           | Prepared for sharing: no repository names, alert titles or links to source systems. | Pronta da condividere: nessun nome di repository, titolo di alert o link ai sistemi sorgente. |
| `executive.notVisible`          | Not visible                                                                         | Non visibile                                                                                  |
| `executive.trend.notEnough`     | Not enough history                                                                  | Storico insufficiente                                                                         |
| `executive.risks.none`          | No project needs attention.                                                         | Nessun progetto richiede attenzione.                                                          |
| `executive.overdue.notMeasured` | Not measured (remediation deadlines are off or were not collected).                 | Non misurato (le scadenze di rimedio sono disattivate o non sono state raccolte).             |
| `notify.title`                  | Engineering hub: {n} project(s) need attention                                      | Engineering hub: {n} progetto/i richiedono attenzione                                         |
| `notify.compared`               | Compared with the collection of {date}                                              | Confronto con la raccolta del {date}                                                          |
| `notify.statusWas`              | {to} (was {from})                                                                   | {to} (prima {from})                                                                           |
| `notify.openChanges`            | Open What changed                                                                   | Apri Cosa è cambiato                                                                          |
| `notify.more`                   | {n} more project(s)                                                                 | Altri {n} progetti                                                                            |

### 5.8 Dati mock e golden

Nessun nuovo input di fixture: gli output derivano dai golden esistenti (`GOLDEN_NOW = 2026-01-15T12:00:00.000Z`).

- `fixtures/snapshots/metrics/hub.prom` diventa un golden scritto da `npm run fixtures:update`. Valori attesi (dopo v0.9.0 e v0.10.0; il builder rilegge il golden `index.json` dopo il rebase e adatta i numeri, mai le regole):
  - `hub_collection_timestamp_seconds 1768478400`;
  - `hub_portfolio_projects{status="red"} 2`, `amber 1`, `green 0`, `grey 1` (Beta e Platform rossi, Alpha ambra, Gamma grigio);
  - `hub_project_score{project="project-beta"} 40`; nessun `hub_project_score{project="project-gamma"}`; `hub_project_measure_known{measure="score",project="project-gamma"} 0`;
  - `hub_project_open_alerts{project="project-beta",severity="critical"} 1`; `hub_project_open_alerts_complete{project="project-beta"} 0`;
  - `hub_project_overdue_alerts{class="critical_high",project="platform"} 1`;
  - nessuna riga contiene `example-org/`.
- Riepilogo golden dal golden `changes.json` con i trigger predefiniti: Beta (complessivo ambra → rosso, Delivery e Sicurezza ambra → rosso, 1 nuovo critico) e Platform (complessivo e Sicurezza ambra → rosso, 1 alto scaduto da poco). Il miglioramento di Alpha non è un elemento. `totals = { projects: 2, overallWorsened: 2, becameUnknown: 0, newCritical: 1, newHigh: 0, newlyOverdue: 1, newErrors: 0 }`. Modalità effettiva `dry-run (mock-data)`.
- Golden della pagina direzionale: riquadri Rosso 2, Ambra 1, Verde 0, Non visibile 1; rischi principali nell'ordine Beta, Platform, Gamma, Alpha.

## 6. Test (sintesi; casi esatti nel piano)

- **Unit, metriche:** regole del formato (HELP/TYPE una volta e prima dei campioni, newline finale, escaping di `\`, `"`, newline), stati one-hot, serie sconosciute omesse e `measure_known` 0, conteggi parziali, nessuna label di repository, determinismo, i due passi di troncamento con un `maxBytes` minimo, un canary nel nome di un progetto non raggiunge mai il file (rifiutato dal controllo).
- **Unit, Grafana:** il JSON si interpreta; ogni data source di pannello e di target è `{ type: 'prometheus', uid: '${DS_PROMETHEUS}' }`; esiste una variabile `datasource` `DS_PROMETHEUS`; nessun'altra stringa UID; ogni `expr` usa solo metriche `hub_*` che il renderer emette.
- **Unit, notifiche:** schema della configurazione e valori predefiniti; regole di significatività (peggioramento, grigio, miglioramenti ignorati, soglie, `newlyOverdue` assente); stabilità e sensibilità della chiave (stessi elementi → stessa chiave; `previousCollectedAt` diverso → chiave diversa; `generatedAt` ignorato); il riepilogo non contiene repository né URL diversi da `siteUrl`; forma esatta di ogni renderer, escaping, limiti; tabella della risoluzione della modalità; salto e aggiunta nel registro; rifiuti della allowlist degli host (http, altro host, userinfo con `@`, Teams `logic.azure.com`), `redirect: 'error'`, nessun nuovo tentativo, classificazione degli errori, nulla registrato (spia su console) — tutto con una **`fetch` iniettata**, mai un endpoint reale.
- **Unit, workflow:** `notify.yml` e `deploy-pages.yml` interpretati come YAML: i secret compaiono solo nell'env dello step Notify; `collect` non li riceve mai; permessi del job esattamente `contents: read, actions: read`; `deploy` non dipende da `notify`.
- **Unit, pagina direzionale:** conteggi, colonne dell'andamento (con e senza un punto a `trendDays`), ordine e frasi dei rischi, "≥" per conteggi incompleti, scaduti "non misurato".
- **Integrazione, collector:** golden `metrics/hub.prom`; `outputs.metrics.enabled: false` → nessun file; riga del report.
- **Integrazione, notificatore:** sui golden, `npm run notify` scrive i quattro file di payload e `summary.md`, modalità `dry-run (mock-data)`, nessuna richiesta (spia su fetch), nessun `example-org/` in alcun payload.
- **Integrazione, sito:** `/executive/` e `/it/executive/` si generano; nessun `github.com` né nome di repository del catalogo nel loro HTML; foglio di stile di stampa presente; ancora in Come leggere; link alle metriche in Qualità dei dati; `dist/data/metrics/hub.prom` esiste.
- **e2e** (configurazione temporanea, porta 4377): navigazione alla pagina direzionale su desktop e Pixel 7; `page.emulateMedia({ media: 'print' })` nasconde la navigazione.

## 7. Lasciato al builder

- Formulazione esatta delle HELP, ordine delle famiglie dentro i gruppi fissi, layout dei pannelli Grafana.
- Layout e token della pagina direzionale entro `DESIGN.md`; i dettagli del foglio di stile di stampa.
- L'elenco esatto di escaping per il markdown di Teams dopo averne verificato la resa.
- Se il ripristino del registro vive in `scripts/restore-ledger.ts` o condivide `scripts/restore-history.ts` con un flag (atteso: un helper condiviso, due script di ingresso).
- Rifinitura delle stringhe EN/IT, mantenendo il significato del §5.7.

## 8. Rischi

- **Il webhook di Workflows appartiene a una persona.** Il flusso gira con l'account di chi l'ha creato; se quell'account se ne va, la pubblicazione si ferma. La documentazione raccomanda un account di servizio come proprietario del flusso.
- **Trigger "Anyone".** Chi ha l'URL può pubblicare nel canale. È un secret come una password: si ruota eliminando e ricreando il trigger del flusso.
- **PAT e API token sono credenziali di lunga durata.** Microsoft e Atlassian raccomandano Entra / OAuth. Si consiglia una scadenza ≤ 90 giorni; l'identità di workload Entra per Azure DevOps è un'idea successiva.
- **Notifiche perse.** Un invio fallito non viene ritentato automaticamente (nessun duplicato per costruzione); la raccolta successiva notifica solo il proprio insieme di cambiamenti. Il riepilogo e lo stato del job rendono visibile il fallimento.
- **Applicazione Access limitata a un percorso.** La precedenza di un'applicazione di percorso su quella del sito va verificata sulla documentazione di Cloudflare al momento della costruzione; fino ad allora la documentazione dice "verifica con `curl` che il service token apra solo il percorso delle metriche".
- **Deriva rispetto a v0.7.0–v0.10.0.** Nomi di file (`select-artifact.ts`, `trend.ts`, `sensitiveEnvValues`), nomi dei campi di `risk`, ordine del menu e numeri dei golden possono cambiare. Il piano dice: adattarsi a ciò che c'è su `main`, mantenere le regole.

## 9. Fonti (verificate il 2026-10-21)

- Ritiro dei connettori Teams (date finali 18–22 maggio 2026; sostituto Workflows): <https://devblogs.microsoft.com/microsoft365dev/retirement-of-office-365-connectors-within-microsoft-teams/>
- Creare webhook in ingresso con Workflows: <https://learn.microsoft.com/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook>
- Connettore Teams, "When a Teams webhook request is received" (schema del corpo, Anyone o utenti del tenant, limite di circa 28 KB, canali privati): <https://learn.microsoft.com/connectors/teams/#microsoft-teams-webhook>
- Spostamento degli URL dei trigger da `logic.azure.com` (30 nov 2025) e percorso con scale unit (2 giu 2026): <https://learn.microsoft.com/troubleshoot/power-platform/power-automate/flow-run-issues/triggers-troubleshoot>
- Domini di Power Automate (`*.api.powerplatform.com`): <https://learn.microsoft.com/power-automate/ip-address-configuration>
- Versione di Adaptive Card per host (Teams 1.5): <https://learn.microsoft.com/adaptive-cards/resources/partners>; azioni supportate dai webhook: <https://learn.microsoft.com/microsoftteams/platform/webhooks-and-connectors/how-to/connectors-using>
- Jira REST v3 Create issue (OpenAPI `swagger-v3.v3.json`: `POST /rest/api/3/issue`, 201/400/401/403/422, scope, permessi, ADF): <https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-post>
- Autenticazione Basic di Jira con API token: <https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/>
- API token Atlassian (token con scope tramite `api.atlassian.com/ex/jira/{cloudId}`, 1–365 giorni): <https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/>
- Azure DevOps Work Items – Create 7.1: <https://learn.microsoft.com/rest/api/azure/devops/wit/work-items/create?view=azure-devops-rest-7.1>
- PAT di Azure DevOps (Basic `:{PAT}`, ritiro dei PAT globali il 1 dic 2026): <https://learn.microsoft.com/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate>
- Formati di esposizione Prometheus: <https://prometheus.io/docs/instrumenting/exposition_formats/>
- Migrazione a Prometheus 3 (rigore su Content-Type, `fallback_scrape_protocol`): <https://prometheus.io/docs/prometheus/latest/migration/>
- Configurazione di scrape di Prometheus (valori di `fallback_scrape_protocol`, `http_headers`): <https://prometheus.io/docs/prometheus/latest/configuration/configuration/>
- Textfile collector di node_exporter: <https://github.com/prometheus/node_exporter#textfile-collector>
- Service token di Cloudflare Access: <https://developers.cloudflare.com/cloudflare-one/identity/service-tokens/>
- Importazione in Grafana: <https://grafana.com/docs/grafana/latest/dashboards/build-dashboards/import-dashboards/>
- actions/upload-artifact (`overwrite`, conservazione 1–90): <https://github.com/actions/upload-artifact>
