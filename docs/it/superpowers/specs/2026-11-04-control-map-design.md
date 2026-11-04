# Mappa dei controlli: controlli tecnici DORA e ISO 27001, punteggio e heatmap — design

English: [../../../superpowers/specs/2026-11-04-control-map-design.md](../../../superpowers/specs/2026-11-04-control-map-design.md)

Stato: bozza per la revisione del proprietario (verifica del builder fatta, risposte del proprietario incluse) · Data: 2026-11-04 · Release di destinazione: **v0.16.0**

## 1. Intento e motivazione

Il proprietario conduce assessment DevSecOps per business unit i cui clienti sono soggetti a **DORA**
(Regolamento (UE) 2022/2554, resilienza operativa digitale) e verificati rispetto a **ISO/IEC
27001:2022**. L'ultimo assessment (una presentazione, conservata fuori dal repository) ha valutato 14
KPI per business unit su una scala di maturità 0–5 e li ha mostrati come heatmap. Oggi quel quadro
si costruisce a mano, una volta, dalle interviste.

L'hub raccoglie già gran parte delle evidenze che quei KPI richiedono (SBOM, firme, scansioni, regole
sui branch, scadenze di rimedio, copertura, stato di Argo CD). Questa release le trasforma in una
**mappa dei controlli continua e basata su evidenze**: ogni controllo tecnico che l'hub può
verificare, per progetto, valutato sulla stessa scala 0–5, mostrato come heatmap con gli articoli
DORA e i controlli ISO 27001 Annex A collegati.

**Come appare il successo:** il proprietario apre una pagina e vede, per progetto e per business
unit, quali controlli tecnici hanno evidenze, quanto sono maturi, cosa manca e a quali requisiti
normativi si collega ciascun controllo, senza raccogliere nulla a mano.

## 2. Obiettivi, non-obiettivi, anti-obiettivi

Obiettivi

- Un catalogo di **controlli tecnici** (§5.2) calcolati dai dati che l'hub legge, ciascuno con un
  livello 0–5, un valore misurato, la fonte, la freschezza e i riferimenti DORA / ISO 27001.
- Un **punteggio dei controlli** per progetto (0–100) e aggregati per business unit.
- Una nuova pagina **"Mappa dei controlli"** ("Control map") con la heatmap: progetti (raggruppati per
  business unit) × controlli (raggruppati per area), più un dettaglio per cella.
- **Metriche di delivery** (frequenza dei deploy, lead time, tasso di errore dei rilasci, tempo di
  ripristino) calcolate da un segnale di deploy dichiarato per ambiente nel catalogo, oneste sugli
  ambienti che l'hub non vede.
- Un export CSV della heatmap (evidenza per gli audit) e metriche Prometheus del punteggio.
- EN + IT, come ogni pagina.

Non-obiettivi

- **Requisiti di governance e organizzativi** (policy, ruoli, contratti con fornitori ICT terzi, piani
  di continuità operativa, segnalazione degli incidenti alle autorità, formazione). L'hub non li vede
  e non li chiede.
- FinOps (costi taggati, idle spend), logging e monitoraggio a runtime, il contenuto dei vault dei
  segreti: oggi nessuna fonte.
- Pubblici per cliente o esterni: per ora la pagina è interna, con tutto il dettaglio, per chiunque
  possa aprire l'hub (decisione del proprietario).
- L'andamento nel tempo della mappa (storico) in questa release.

Anti-obiettivi (fallimento anche se "funziona")

- **Qualsiasi dichiarazione di conformità.** L'app non dice mai "conforme a DORA", "conforme a ISO
  27001" o una percentuale di "aderenza a DORA". Dice quali controlli tecnici hanno evidenze ed
  elenca gli articoli e i controlli Annex A collegati **come riferimento**.
- Un valore sconosciuto mostrato come livello 0 o come superato: sconosciuto è "non visibile", mai 0
  (la regola costante dell'hub).
- Una metrica di delivery calcolata su un altro ambiente senza dirlo (es. deploy in DEV mostrati come
  frequenza di produzione).
- Un controllo non spiegabile: ogni livello mostra il valore misurato, la soglia che l'ha prodotto e
  la fonte.

## 3. Vincoli

Come ogni release (spec di programma §2): sola lettura verso repository e fonti monitorate; sito
statico; allowlist Zod rigorosa; sconosciuto ≠ zero; 403 ≠ nessun dato; EN + IT; token Primer e
Octicon, stato con icona + parola, WCAG 2.2 AA; interfaccia disegnata in Claude Design e **approvata
dal proprietario prima del codice dell'interfaccia**; solo dati sintetici nel repository (nessun nome
reale di azienda, business unit, team o progetto); mai `npm run ci:build` / `collect:mock`; solo
podman.

## 4. Decisioni in breve

| #   | Decisione                                                                                                                                                                                                                                                                                                                                                                                           | Perché                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| C1  | Livelli 0–5 con la legenda dell'assessment (Assente, Iniziale, Ripetibile, Definito, Gestito, Ottimizzato). Ogni controllo trasforma il valore misurato in un livello con soglie in `policies.yaml` (`controlMap.thresholds`), valori predefiniti dai target dell'assessment **(BC)**                                                                                                               | Stesso linguaggio dell'assessment; le soglie sono policy, non codice                                        |
| C2  | Un controllo è **non visibile** (livello nullo) quando la fonte non si è potuta leggere, e **non applicabile** secondo le regole del §5.4; nessuno dei due conta nel punteggio. Un controllo di sicurezza che il catalogo segna `required: false` **conta comunque** (decisione del proprietario 2026-11-04): per DORA e ISO una lacuna resta una lacuna anche se nessuno ha chiesto quel controllo | Sconosciuto ≠ zero; la mappa mostra la maturità reale, non l'ambizione del progetto                         |
| C3  | Punteggio dei controlli del progetto = media dei livelli noti applicabili × 20 (0–100), mostrato con "misurati N di M"; sotto la metà misurata → "dati insufficienti", nessun numero **(BC)**                                                                                                                                                                                                       | Stessa regola di confidenza del punteggio del progetto                                                      |
| C4  | Riga della business unit = mediana dei livelli dei suoi progetti per controllo (non visibile se lo sono tutti) **(BC)**                                                                                                                                                                                                                                                                             | La mediana resiste a un progetto anomalo                                                                    |
| C5  | I riferimenti sono dati: ogni controllo elenca articoli DORA (Regolamento e RTS 2024/1774) e controlli ISO 27001:2022 Annex A; titolo, testi ed export non dicono mai "conforme" **(BC, decisione del proprietario)**                                                                                                                                                                               | Anti-obiettivo 1                                                                                            |
| C6  | Le metriche di delivery vengono da un **segnale di deploy per ambiente** nel catalogo (§5.3); predefinito `external` = non visibile. Le metriche usano l'ambiente segnato `delivery: true` (predefinito: l'ultimo ambiente) e la cella lo nomina **(BC)**                                                                                                                                           | La produzione è spesso rilasciata da pipeline del cliente che l'hub non vede (indicazione del proprietario) |
| C7  | Nuovo schema dello snapshot **1.9**: `controlMap` nel riepilogo e nello snapshot di ogni progetto; storico invariato **(BC)**                                                                                                                                                                                                                                                                       | Un unico punto validato per livelli, valori e fonti                                                         |
| C8  | ADR **0014**: "Mappa dei controlli: controlli tecnici basati su evidenze con riferimenti normativi, mai una dichiarazione di conformità"                                                                                                                                                                                                                                                            | Nuovo significato pubblico dei punteggi; confine di ciò che l'hub afferma                                   |
| C9  | Pubblicata solo quando `publication.audience` è `restricted` o la fonte dati è `mock` (demo); su un sito pubblico con dati reali pagina, CSV e metriche non vengono prodotti **(BC)**                                                                                                                                                                                                               | Livelli e valori descrivono i punti deboli di ogni progetto                                                 |

## 5. Design

### 5.1 Livelli

| Livello | Nome (EN / IT)          | Significato (dalla legenda dell'assessment)                          |
| ------- | ----------------------- | -------------------------------------------------------------------- |
| 0       | Absent / Assente        | Il controllo non è presente                                          |
| 1       | Initial / Iniziale      | Pratiche ad hoc, nessuna metrica, reattivo                           |
| 2       | Repeatable / Ripetibile | Prime pipeline/template, controlli manuali, KPI parziali             |
| 3       | Defined / Definito      | Standardizzato, copertura parziale                                   |
| 4       | Managed / Gestito       | Applicato (policy as code, gate), verificabile, misurazione continua |
| 5       | Optimised / Ottimizzato | Continuo, completo, self-service                                     |

Ogni controllo qui sotto definisce come il valore misurato diventa un livello; il builder scrive le
soglie predefinite esatte in `policies.yaml` a partire dai target elencati, e il proprietario può
cambiarle.

### 5.2 Controlli

Aree e controlli. "Fonte" è ciò che l'hub legge già, salvo dove indicato **nuovo**. I riferimenti sono
il Regolamento DORA 2022/2554 (art.) e l'RTS 2024/1774 (art. RTS), e ISO/IEC 27001:2022 Annex A.

**A. Catena di fornitura**

| Controllo             | Valore misurato                                              | Scala dei livelli (predefinita)                                              | Fonte                      | DORA                     | ISO 27001  |
| --------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------- | -------------------------- | ------------------------ | ---------- |
| `sbom-coverage`       | % repository con uno SBOM leggibile                          | 0 → 0%, 1 > 0%, 2 ≥ 25%, 3 ≥ 50%, 4 ≥ 85%, 5 = 100%                          | supply chain (ADR 0011)    | art. 8; art. RTS 4–5, 16 | 5.9, 5.21  |
| `image-signature`     | % immagini distinte con firma verificata                     | stessa scala, 4 ≥ 85%                                                        | supply chain, Harbor       | art. RTS 16              | 5.21, 8.24 |
| `build-provenance`    | % ultime release con attestazione di provenienza della build | stessa scala, 4 ≥ 85%                                                        | attestazioni delle release | art. RTS 16              | 5.21, 8.25 |
| `license-policy`      | licenze segnalate                                            | 5 = 0 con una policy impostata, 3 = 0 senza policy, 1 > 0, ignoto senza SBOM | supply chain               | art. RTS 16              | 5.32       |
| `dependency-scanning` | % repository con alert sulle dipendenze attivi               | stessa scala, 4 ≥ 90%                                                        | controlli (Dependabot)     | art. RTS 10              | 8.8        |

**B. Vulnerabilità e test di sicurezza**

| Controllo            | Valore misurato                                                                      | Scala dei livelli (predefinita)                                                                                           | Fonte                                                      | DORA                     | ISO 27001  |
| -------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------ | ---------- |
| `sast`               | % repository con code scanning e analisi entro la finestra di freschezza             | stessa scala, 4 ≥ 90%                                                                                                     | controlli (code scanning)                                  | art. 25; art. RTS 10, 16 | 8.28, 8.29 |
| `container-scanning` | % repository con immagini che hanno una scansione                                    | stessa scala, 4 ≥ 90%                                                                                                     | controlli, Harbor                                          | art. 25; art. RTS 10     | 8.8        |
| `iac-scanning`       | % repository con IaC che hanno una scansione                                         | stessa scala, 4 ≥ 90%                                                                                                     | controlli                                                  | art. RTS 10, 16          | 8.9        |
| `dast`               | % componenti applicabili con un risultato DAST                                       | stessa scala, 4 ≥ 70%                                                                                                     | controlli                                                  | art. 25                  | 8.29       |
| `vulnerability-age`  | alert critici/alti aperti oltre la scadenza di rimedio                               | 5 = 0 e nessuno a meno di 7 giorni dalla scadenza, 4 = 0, 3 ≤ 2, 2 ≤ 5, 1 > 5                                             | scadenze di rimedio (v0.9.0)                               | art. RTS 10              | 8.8        |
| `security-mttr`      | mediana dei giorni per chiudere gli alert critici/alti chiusi negli ultimi 90 giorni | 5 ≤ 1g, 4 ≤ 7g (il target ≤ 8h dell'assessment è per gli incidenti: vale per il 5 quando ≤ 8h), 3 ≤ 30g, 2 ≤ 90g, 1 > 90g | **nuovo**: alert chiusi (date di correzione/archiviazione) | art. 10–11; art. RTS 10  | 8.8, 5.26  |

**C. Segreti**

| Controllo           | Valore misurato                                                                                                 | Scala dei livelli (predefinita)                               | Fonte                                              | DORA              | ISO 27001  |
| ------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------- | ----------------- | ---------- |
| `secret-scanning`   | % repository con secret scanning e push protection                                                              | 4 ≥ 90% con push protection, 3 ≥ 90% solo scanning, poi scala | controlli + **nuovo**: stato della push protection | art. RTS 7, 11    | 5.17, 8.24 |
| `exposed-secrets`   | alert di secret scanning aperti                                                                                 | 5 = 0 da 90 giorni, 4 = 0, 1 > 0                              | alert                                              | art. RTS 7        | 5.17       |
| `workload-identity` | % workflow di deploy che si autenticano con OIDC (`id-token: write`) invece che con chiavi cloud a lunga durata | stessa scala, 4 ≥ 85%                                         | **nuovo**: file di workflow già letti              | art. RTS 7, 20–21 | 5.17, 8.5  |

**D. Cambiamenti e accessi**

| Controllo                | Valore misurato                                                                    | Scala dei livelli (predefinita)                   | Fonte                                                            | DORA            | ISO 27001  |
| ------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------- | --------------- | ---------- |
| `branch-protection`      | % repository con branch predefinito protetto, PR obbligatoria, force push bloccato | stessa scala, 4 ≥ 90%                             | controlli dei repository (v0.8.0)                                | art. RTS 17, 21 | 8.4, 8.32  |
| `required-checks`        | % repository che richiedono status check prima del merge                           | stessa scala, 4 ≥ 85%                             | controlli dei repository                                         | art. RTS 17     | 8.29, 8.32 |
| `pipeline-integrity`     | % repository con action fissate su SHA e workflow riusabili aggiornati             | stessa scala, 4 ≥ 85%                             | controlli dei repository                                         | art. RTS 16     | 5.21, 8.25 |
| `environment-separation` | ambienti dichiarati e produzione protetta (revisori obbligatori o tempo di attesa) | vedi definizione sotto                            | catalogo + **nuovo**: regole di protezione degli ambienti GitHub | art. RTS 17     | 8.31       |
| `config-drift`           | % ambienti allineati con Git (Argo CD)                                             | stessa scala, 4 ≥ 95%; non visibile senza Argo CD | Argo CD                                                          | art. RTS 17     | 8.9        |

**E. Delivery e ripristino** (sull'ambiente `delivery`, §5.3)

| Controllo             | Valore misurato                                             | Scala dei livelli (predefinita, target dell'assessment)           | Fonte                        | DORA                    | ISO 27001 |
| --------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------- | ----------------------- | --------- |
| `deploy-frequency`    | deploy a settimana (ultimi 30 giorni)                       | 5 ≥ 1/giorno, 4 ≥ 2/settimana, 3 ≥ 1/settimana, 2 ≥ 1/mese, 1 > 0 | **nuovo**: segnale di deploy | art. RTS 17             | 8.32      |
| `lead-time`           | mediana delle ore dal merge al deploy                       | 5 ≤ 1h, 4 ≤ 24h, 3 ≤ 7g, 2 ≤ 30g, 1 > 30g                         | **nuovo**                    | art. RTS 17             | 8.32      |
| `change-failure-rate` | % deploy falliti o annullati con rollback                   | 5 ≤ 5%, 4 ≤ 15%, 3 ≤ 30%, 2 ≤ 45%, 1 > 45%                        | **nuovo**                    | art. 11; art. RTS 17    | 8.32      |
| `time-to-restore`     | mediana delle ore da un deploy fallito al successo seguente | 5 ≤ 1h, 4 ≤ 8h, 3 ≤ 24h, 2 ≤ 7g, 1 > 7g                           | **nuovo**                    | art. 11–12; art. RTS 26 | 5.30      |
| `test-coverage`       | copertura delle righe (Qualità, v0.6.0)                     | 5 ≥ 90%, 4 ≥ 80%, 3 ≥ 60%, 2 ≥ 30%, 1 > 0%                        | qualità                      | art. RTS 16             | 8.29      |

**F. Evidenze**

| Controllo            | Valore misurato                                                     | Scala dei livelli (predefinita)             | Fonte              | DORA    | ISO 27001     |
| -------------------- | ------------------------------------------------------------------- | ------------------------------------------- | ------------------ | ------- | ------------- |
| `evidence-freshness` | % delle fonti di evidenza del progetto lette entro la loro finestra | 5 = 100%, 4 ≥ 90%, 3 ≥ 75%, 2 ≥ 50%, 1 > 0% | freschezza (tutte) | art. 13 | 5.36, cl. 9.1 |

**Definizioni per le nuove fonti**

- `workload-identity`: i file di workflow che il lettore dei controlli dei repository già scarica. Un
  workflow _fa deploy_ quando usa un'action di login cloud (`azure/login`,
  `aws-actions/configure-aws-credentials`, `google-github-actions/auth`) o un `environment:` in un
  job. Usa **OIDC** quando il job o il workflow concede `id-token: write` e il login non riceve
  credenziali segrete in input (`creds`, `credentials_json`, `aws-secret-access-key`,
  `client-secret`); altrimenti usa chiavi a lunga durata.
- `environment-separation`: gli ambienti GitHub del repository coordinatore (e del repository di un
  segnale di deploy `workflow`). Un ambiente del catalogo corrisponde a un ambiente GitHub tramite il
  nuovo campo facoltativo `githubEnvironment` (predefinito: il suo `id`). La "produzione" è l'ambiente
  `delivery`. Scala: 0 = nessun ambiente dichiarato, 1 = un ambiente, 2 = più ambienti dichiarati ma
  nessuno in GitHub, 3 = ambienti GitHub separati, 4 = produzione protetta (revisori obbligatori o
  tempo di attesa), 5 = 4 e produzione limitata a branch o tag protetti.

Il builder conferma ogni nuova fonte sulla documentazione delle API (permessi, campi) e la annota; un
controllo la cui fonte richiede un permesso che il deploy non ha è **non visibile**, con il motivo,
mai 0.

### 5.3 Segnale di deploy per ambiente (catalogo)

`environments[]` riceve un campo facoltativo `deploySignal` e un facoltativo `delivery: true`:

```yaml
environments:
  - id: dev
    name: DEV
    deploySignal: { type: workflow, workflow: deploy-dev } # un id di trackedWorkflows
  - id: prod
    name: PROD
    delivery: true
    deploySignal:
      type: versions-file
      repository: coordinator # oppure un id di componente
      path: environments/prod.yaml
      key: umbrella # percorso puntato alla versione rilasciata (semver)
      tagPrefix: v # il tag di release di quella versione, per il lead time
```

**Formato del file di versioni** (il caso reale del proprietario, reso generico): un file YAML (o
JSON) per ambiente, aggiornato solo da pull request di promozione, con la versione rilasciata in
`key` (es. un `umbrella: 0.5.2` al primo livello). L'hub elenca i commit che hanno toccato il file
(i 100 più recenti nella finestra) e legge il valore a ogni commit. Una versione più alta del commit
precedente è una **promozione** (evento di deploy); una più bassa è un **rollback**; la stessa
versione (modifiche di formattazione) viene ignorata. Un valore che non è semver rende quel commit
illeggibile (saltato, contato nelle note della cella).

| `type`          | Evento di deploy                                                       | Fallimento                                        | Ripristino                                          |
| --------------- | ---------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------- |
| `workflow`      | un'esecuzione completata del workflow tracciato sul branch predefinito | esito `failure`                                   | il primo `success` dopo un fallimento               |
| `versions-file` | un commit che alza la versione (promozione)                            | una promozione poi annullata (versione più bassa) | il tempo da quella promozione al commit di rollback |
| `argocd`        | una nuova sync dell'applicazione (storico)                             | sync o health falliti                             | la successiva sync sana                             |
| `release`       | una release pubblicata (come "consegnata al cliente")                  | non misurabile (CFR/TTR non visibili)             | non visibile                                        |
| `external`      | non visibile (pipeline del cliente)                                    | non visibile                                      | non visibile                                        |

- Predefinito `external`: le quattro celle di delivery dicono "non visibile — rilasciato da pipeline
  esterne".
- Lead time: workflow → dal merge dello SHA di testa alla fine dell'esecuzione; file di versioni →
  dalla creazione del tag di release `<tagPrefix><versione>` (nel repository del segnale) al commit
  di promozione; release → non misurato. Se non si risolve, quel deploy non ha lead time. Gli orari
  del file di versioni sono orari di promozione (merge della PR di promozione), un'approssimazione del
  deploy vero e proprio: la pagina lo dice.
- La cella nomina l'ambiente ("PROD", oppure "DEV" quando il proprietario segna DEV come `delivery`).
- Finestra: ultimi 30 giorni per la frequenza, ultimi 90 giorni per CFR, TTR e lead time
  (configurabili).

### 5.4 Applicabilità, letture parziali e punteggio

**Non applicabile** quando non c'è nulla da controllare, mai perché un controllo è facoltativo:

- l'oggetto del controllo non esiste: nessuna immagine container → `container-scanning`,
  `image-signature` non applicabili; nessun file IaC rilevato → `iac-scanning` non applicabile; nessun
  workflow di deploy → `workload-identity` non applicabile; nessun ambiente → i controlli di delivery,
  `environment-separation` e `config-drift` non applicabili;
- tutti i repository del progetto elencano il controllo in `notApplicableControls` (o il controllo dei
  repository in `notApplicableChecks`);
- il progetto elenca il controllo nel nuovo campo facoltativo
  `controlMap.notApplicable: [{ check, reason }]` (catalogo, per progetto; motivo obbligatorio,
  mostrato nella cella).

**Letture parziali.** Per i controlli "% dei repository" il valore si calcola sui repository letti;
la cella dice "k di n leggibili". Se se ne è letta meno della metà il controllo è non visibile. Un
repository non leggibile non conta mai come mancante.

**Punteggio**

- Livello per progetto dal valore misurato (C1), oppure nullo / non applicabile (C2).
- Punteggio dei controlli = round(media(livelli noti applicabili) × 20); "misurati N di M"; sotto il
  50% → nessuno.
- Punteggio di area = lo stesso sui controlli dell'area.
- Business unit: mediana per controllo (C4) e mediana del punteggio dei controlli.
- Nulla cambia lo **stato** o il **punteggio** esistenti del progetto: la mappa è una lente separata.

### 5.5 Pagina "Mappa dei controlli" (prima il design)

- Nuova route `controls/` (navigazione dopo Sicurezza; Octicon da scegliere con i mockup, es.
  `checklist`), etichetta "Mappa dei controlli" / "Control map". Si disattiva con
  `policies.controlMap.enabled: false`.
- **Frase iniziale:** "Controlli tecnici con evidenze dai dati raccolti, con i riferimenti DORA e ISO
  27001 collegati. Non è una valutazione di conformità: i requisiti di governance e organizzativi sono
  fuori ambito."
- **Heatmap:** righe = business unit (aggregate) con i loro progetti annidati; colonne = controlli
  raggruppati per area; cella = numero del livello + colore (scala sequenziale, validata per la
  visione dei colori e il contrasto; "non visibile" tratteggiato, "n/a" vuoto); il numero è sempre
  stampato (mai solo il colore). Intestazione e prima colonna fisse; scorrimento orizzontale dentro
  la tabella sugli schermi piccoli.
- **Colonna del punteggio:** punteggio dei controlli con "misurati N di M".
- **Dettaglio della cella** (clic o tastiera): nome del controllo, livello e significato, valore
  misurato, soglia che ha fissato il livello, fonte ed età, l'ambiente (controlli di delivery),
  riferimenti DORA e ISO, e link alle sezioni della pagina del progetto che contengono le evidenze.
- **Legenda** con i sei livelli, non visibile e n/a; una sezione "Riferimenti" che elenca ogni
  controllo con i suoi articoli DORA e controlli ISO (una tabella).
- Filtri: business unit, area, `?team=` (come nel Portfolio).
- Export CSV `exports/control-map.csv` (progetto, business unit, controllo, livello, valore, fonte,
  data di raccolta).
- La pagina del progetto riceve un blocco "Controlli" che porta alla sua riga nella heatmap.
- L'editor del catalogo **conserva** `deploySignal`, `delivery`, `githubEnvironment` e
  `controlMap.notApplicable` al salvataggio (oggi eliminerebbe i campi sconosciuti degli ambienti);
  modificarli dall'interfaccia dell'editor arriverà in una release successiva.
- **Prima i mockup:** heatmap chiara/scura, 390px, dettaglio della cella, sezione dei riferimenti,
  approvati in Claude Design prima di qualsiasi codice dell'interfaccia.

### 5.6 Metriche

`hub_project_control_score{project}` (assente quando i dati sono insufficienti),
`hub_project_control_level{project,check}` (assente quando non visibile),
`hub_project_control_measured{project}`; aggiunte alla dashboard Grafana come un pannello.

## 6. Test (riepilogo)

Test unitari per controllo (valore → livello a ogni soglia; fonte nulla → non visibile; non
applicabile; letture parziali); parser dei segnali di deploy su fixture per ogni tipo (incluso un
file di versioni con una promozione, un rollback e un valore non semver; esecuzioni fallite poi
riuscite); punteggio e mediana di BU; parità i18n; integrazione del sito (pagina, navigazione, CSV,
limitazione per pubblico); un test che nessun testo **visibile** EN/IT della pagina, intestazioni del
CSV o HELP delle metriche dica "compliant", "compliance with", "conforme" o "conformità" come
dichiarazione (il codice di motivo esistente `governance-compliant` è una chiave interna e resta);
e2e (dettaglio da tastiera nella heatmap, filtri); golden con dati mock per ogni tipo di segnale e
almeno un ambiente esterno.

## 7. Lasciato al builder

Testi esatti nel rispetto degli anti-obiettivi; l'Octicon; la scala di colori (validata); la
dimensione delle finestre nei limiti indicati; i campi delle API per le fonti **nuove**, verificati
sulla documentazione; le fixture mock.

## 8. Rischi

- **Accuratezza dei riferimenti.** I numeri di articoli e controlli vengono dall'elenco degli
  articoli dell'RTS 2024/1774 e da ISO 27001:2022 Annex A; il piano li ricontrolla tutti sui testi
  ufficiali prima della release.
- **Metriche approssimate.** Le metriche di delivery su DEV o sulle release sono approssimazioni; la
  pagina nomina sempre l'ambiente e il tipo di segnale.
- **Nuovi permessi.** Lo stato della push protection e le regole di protezione degli ambienti possono
  richiedere permessi che la GitHub App non ha; quei controlli risultano allora "non visibili" con il
  motivo.
- **Lettura eccessiva del punteggio.** Mitigata dalla frase iniziale, dall'impostazione come
  riferimenti e dall'ADR 0014.

## 9. Fonti

- Regolamento (UE) 2022/2554 (DORA), Capo II e art. 24–25.
- Regolamento delegato (UE) 2024/1774 della Commissione (RTS sul quadro per la gestione dei rischi
  ICT), Titolo II art. 2–27.
- ISO/IEC 27001:2022 Annex A.
- L'assessment DevSecOps del proprietario (KPI, legenda 0–5, target), non nel repository.
