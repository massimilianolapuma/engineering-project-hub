# Programma della roadmap: da "predisposto" a rilasciato — design

English: [../../../superpowers/specs/2026-10-21-roadmap-program-design.md](../../../superpowers/specs/2026-10-21-roadmap-program-design.md)

Stato: l'owner ha chiesto di implementare tutta la roadmap del README senza ulteriori domande (2026-10-21); rivede dopo la consegna · Data: 2026-10-21

## 1. Intento

Il README elenca una roadmap di elementi per cui il codice è "predisposto ma non implementato". L'owner vuole che vengano rilasciati tutti, poi userà l'hub e darà un riscontro. Ogni decisione di perimetro e di design qui sotto è una scelta del builder, registrata perché l'owner possa verificarla.

## 2. Vincoli validi per tutto il programma (regole di progetto invariate)

- Sola lettura verso i repository monitorati e verso ogni sistema esterno che fa da **fonte**: solo GET, nessuna scrittura, nessun dismiss, nessun trigger.
- Static-first: nessun backend a runtime, nessuna chiamata a GitHub dal browser; tutto è calcolato dal collector e pubblicato come JSON sanificato.
- Nessuna dipendenza commerciale. Ogni nuovo provider è **opzionale, spento di default**, funziona con fixture mock e senza credenziali, e in caso di errore va a `unknown` / `not-authorised`, mai a "sano" o a 0.
- Allowlist Zod rigorosa su ogni campo pubblicato; testi e link sanificati; allowlist degli host per i link.
- Sconosciuto ≠ zero; 403 ≠ nessun dato; 404 ambiguo = sconosciuto.
- EN + IT per tutta la documentazione e tutte le stringhe della UI (test di parità i18n).
- Solo dati mock nella demo pubblica; nomi sintetici (Alpha, Beta, Gamma, Platform).
- Token di design Warm Graphite; lo stato mai affidato al solo colore; WCAG 2.2 AA.
- Lo schema degli snapshot sale una sola volta per ogni release che lo modifica; gli snapshot più vecchi non vengono letti.
- `npm run ci:build` / `collect:mock` sovrascrivono `public/data` (lo snapshot reale dell'owner): non vanno mai eseguiti; usare invece `npm run fixtures:update` e una directory di output temporanea.
- Non usare né terminare mai la porta 4321; e2e con una configurazione temporanea sulla porta 4377.
- Container solo tramite podman.

## 3. Scomposizione e ordine (scelta del builder)

La roadmap è composta da più progetti indipendenti. Vengono rilasciati uno dopo l'altro, ciascuno con la propria spec, il proprio piano, branch, PR e release minor, perché condividono lo schema degli snapshot e il catalogo i18n.

| Release | Tema                     | Elementi della roadmap                                                                                                                                            | Perché in quest'ordine                                                                                               |
| ------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| v0.7.0  | Storico e cambiamenti    | Storico e andamento; "Cosa è cambiato dall'ultima raccolta"; export CSV                                                                                           | Massimo valore per uno strumento decisionale; ogni dimensione successiva ottiene un andamento senza costi aggiuntivi |
| v0.8.0  | Controlli sui repository | Action fissate allo SHA; versioni dei workflow riutilizzabili; branch protection / ruleset; scorecard dei repository; discovery tramite custom properties e topic | Tutto nativo GitHub, stesso modello di permessi; alimenta la Governance                                              |
| v0.9.0  | Governo del rischio      | Eccezioni di sicurezza con scadenza; SLA di remediation; policy-as-code                                                                                           | Si basa sui finding già raccolti; serve lo storico (v0.7.0) per "in ritardo da"                                      |
| v0.10.0 | Provider supply chain    | SBOM (CycloneDX / SPDX); firme e attestazioni Cosign; Trivy, Checkov, ZAP; SonarQube; Harbor; Argo CD                                                             | Nuovi provider opzionali dietro `SourceProvider` / `ControlProvider`; la superficie più ampia, quindi dopo il nucleo |
| v0.11.0 | Output                   | Prometheus / Grafana; notifiche Azure DevOps, Jira e Microsoft Teams; vista executive sanificata                                                                  | Consuma tutto quanto sopra; le notifiche sono le uniche scritture verso l'esterno, quindi vengono per ultime         |

## 4. Direzione per ogni release (ciascuna avrà la propria spec dettagliata)

### v0.7.0 Storico e cambiamenti

- Il collector mantiene uno storico compatto e limitato (per progetto: stato complessivo, punteggio, stato per dimensione, conteggi dei finding aperti; per esecuzione: timestamp e metadati dell'esecuzione). Nessun payload grezzo.
- Lo storico persiste tra un'esecuzione e l'altra senza nuova infrastruttura: il workflow di raccolta ripristina lo `history` precedente dall'artifact degli snapshot dell'ultima esecuzione riuscita nel repository dell'hub stesso (Actions: read su sé stesso) e il collector vi aggiunge i nuovi punti; in locale legge la directory di output esistente. Uno storico mancante o illeggibile riparte da zero e lo dichiara; non inventa mai punti passati.
- UI: un piccolo andamento (sparkline del punteggio, striscia degli stati) per progetto e nel portfolio; una pagina "Cosa è cambiato dall'ultima raccolta" che elenca cambi di stato, finding critici/alti nuovi e risolti, spostamenti di versione, nuovi errori di raccolta.
- Export CSV: file CSV statici generati in fase di build (portfolio, riepilogo dei finding, versioni), collegati dalle pagine. Nessun recupero di dati lato client oltre a quanto già esiste.

### v0.8.0 Controlli sui repository

- Da GitHub (sola lettura): dai file di workflow già letti → action fissate o no a uno SHA completo; riferimenti a workflow riutilizzabili e loro versioni rispetto all'ultimo tag del repository referenziato; branch protection e ruleset sul branch di default (`GET` delle regole di un branch).
- Una "scorecard del repository": per ogni repository, un piccolo insieme di controlli con nome, con esito superato / non superato / sconosciuto e un rapporto; legge anche i risultati OpenSSF Scorecard quando arrivano al code scanning (nome del tool).
- Discovery: propone voci di catalogo a partire dalle custom properties e dai topic dei repository (chiavi configurabili), sempre e solo come proposte.
- I nuovi controlli alimentano la dimensione Governance tramite le policy, configurabili e informative per default dove altrimenti farebbero diventare rossi i progetti dall'oggi al domani.

### v0.9.0 Governo del rischio

- Eccezioni di sicurezza: un file di configurazione revisionato che elenca i finding accettati (repository, tool, regola o numero di alert), responsabile, motivo e scadenza obbligatoria. Le eccezioni attive tolgono il finding dal calcolo dello stato ma restano visibili; quelle scadute tornano e vengono segnalate.
- SLA di remediation: giorni per severità nelle policy; i finding oltre lo SLA sono "in ritardo", mostrati con la loro età; un critico/alto in ritardo alza lo stato.
- Policy-as-code: policy ed eccezioni validate da JSON Schema, un comando `policy:check` che valuta le policy sulle fixture e spiega ogni decisione, e un job di CI che lo esegue a ogni modifica di `config/`.

### v0.10.0 Provider supply chain

- Prima il nativo GitHub: SBOM dall'export SBOM del dependency graph (`GET …/dependency-graph/sbom`, SPDX), riassunto in conteggi; attestazioni e firme degli artifact dall'API delle attestazioni o da un riepilogo di CI; Trivy / Checkov / ZAP come tool di code scanning (per nome del tool) e come controlli richiesti.
- Provider esterni opzionali, spenti di default, ciascuno con le proprie credenziali in sola lettura e fixture mock: SonarQube (quality gate, coverage come seconda fonte per la Qualità), Harbor (vulnerabilità e firme delle immagini), Argo CD (sync / health delle applicazioni e versione deployata per ambiente).

### v0.11.0 Output

- Prometheus: un file di metriche statico in formato text exposition pubblicato con gli snapshot; un JSON di dashboard Grafana in `examples/`.
- Notifiche: uno step di workflow separato e opt-in che invia un digest sanificato dei cambiamenti (da v0.7.0) a Microsoft Teams, Jira o Azure DevOps. Dry-run di default (scrive i file del payload), solo in caso di cambiamenti, non include mai segreti o payload grezzi. Scrive solo verso la destinazione della notifica, mai verso i repository monitorati.
- Vista executive: una pagina sanificata (stato del portfolio, andamento, principali rischi in parole semplici), senza nomi di repository quando il pubblico della pubblicazione è ristretto.

## 5. Anti-obiettivi per tutto il programma

- Un provider non configurato mostrato come sano o come zero.
- Qualsiasi scrittura verso un repository monitorato o verso un sistema fonte.
- Un progetto che diventa rosso dall'oggi al domani solo perché è comparso un nuovo controllo (i nuovi controlli partono informativi, a meno che l'owner non scelga diversamente).
- Punti di storico mai raccolti.
- Segreti, token, payload API grezzi, contenuti di file o dati personali in snapshot, CSV, metriche o notifiche.

## 6. Lasciato al builder

Tutto ciò che non è fissato sopra, nella spec di ciascuna release.
