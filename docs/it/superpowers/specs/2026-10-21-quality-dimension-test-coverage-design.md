# Dimensione Qualità: coverage dei test dalla CI — design

English: [../../../superpowers/specs/2026-10-21-quality-dimension-test-coverage-design.md](../../../superpowers/specs/2026-10-21-quality-dimension-test-coverage-design.md)

Stato: approvato dall'owner il 2026-10-21 · Data: 2026-10-21 · Release prevista: v0.6.0

## 1. Intento e motivo

L'owner vuole vedere, per progetto, quanta parte del codice è coperta dai test, come la mostra SonarQube, accanto a delivery, versioni e sicurezza.

Fatti verificati il 2026-10-21 prima di decidere (fonti nella conversazione, qui in sintesi):

- SonarQube importa la coverage dai report della CI e la tratta come misura di **qualità**: una condizione del quality gate accanto al security rating, non dentro.
- GitHub Code Quality (GA dal 2026-07-20, a pagamento per committer attivo) mostra la coverage di riga sulle pull request a partire da un report Cobertura e può bloccare il merge con una soglia in un ruleset. **Nessun endpoint REST o GraphQL restituisce la percentuale di coverage.** L'API REST di Code Quality restituisce solo finding (categoria `maintainability` / `reliability`) e configurazione.
- In azienda SonarQube è in uso, ma si sta decidendo se tenerlo, anche in base a cosa offre Code Quality. L'hub non deve dipendere da Sonar.
- L'hub ha già una dimensione `coverage`. Significa **copertura dei controlli di sicurezza** (quota di scanner richiesti attivi), non coverage dei test.

Quindi la coverage dei test diventa una dimensione a sé, **Qualità**. È alimentata da un piccolo file di riepilogo che la CI pubblica come artifact di GitHub Actions, e l'hub lo legge con i permessi che ha già.

## 2. Obiettivi, non-obiettivi, anti-obiettivi

Obiettivi

- Una sesta dimensione, `quality`, per progetto, con stato, motivi e percentuale aggregata di righe coperte.
- Per componente: coverage di riga, commit ed età del report, conteggi dei finding di Code Quality.
- I punti ciechi restano espliciti: un componente senza report leggibile è "non visibile", mai 0%.
- La dimensione `coverage` esistente nell'interfaccia e nei documenti diventa **Copertura controlli** / **Controls coverage**, così i due significati non si confondono più.
- Funziona con i dati di esempio e senza credenziali, come il resto.

Non-obiettivi

- Nessun provider SonarQube in questa release. Il contratto lascia spazio per aggiungerlo in seguito.
- Niente coverage di rami, condizioni, funzioni o per file. Niente andamento o storico.
- Niente coverage delle pull request: solo il branch di default.
- Nessuna azione in scrittura su GitHub: niente ruleset, niente modifiche alla configurazione di Code Quality, niente avvio di workflow.
- Il collegamento della CI aziendale è fuori da questo repository. Lo copre un prompt separato per i repo aziendali (solo locale, mai committato).

Anti-obiettivi (fallimento anche se "funziona")

- Un report mancante o illeggibile mostrato come 0% o come sano.
- Un report vecchio presentato come stato attuale.
- Un progetto che diventa grigio nel complesso, o perde lo score, solo perché un report non esiste ancora.
- La coverage conteggiata dentro il rating di sicurezza.
- La pubblicazione di percorsi di file, codice, report grezzi o payload API grezzi.

## 3. Vincoli (regole del progetto, invariate)

Solo lettura, static-first, nessun backend a runtime, nessuna dipendenza commerciale, nessuna chiamata a GitHub dal browser, allowlist Zod strict su ogni campo pubblicato, testi e link sanificati, EN + IT per documenti e interfaccia, sconosciuto ≠ zero, 403 ≠ assenza di dati, 404 ambiguo = sconosciuto.

## 4. Cosa ha deciso l'owner

- **Direzione A** del mockup nel canvas "Coverage dei test · due proposte": una nuova dimensione Qualità con card, barra e sezione propria nella pagina progetto, e una sesta barra nel portfolio. La direzione B (coverage come contesto nella pagina Sicurezza) non è stata scelta.
- La dimensione esistente prende l'etichetta "Copertura controlli".
- I finding di Code Quality compaiono nella sezione Qualità.

## 5. Design

### 5.1 Fonte dati: il contratto del riepilogo qualità

A ogni esecuzione sul branch di default, la CI carica un artifact chiamato **`hub-quality-summary`** con un solo file, `quality-summary.json`. Forma (strict, versione `1.0`):

```json
{
  "schemaVersion": "1.0",
  "repository": "example-org/project-beta-api",
  "ref": "refs/heads/main",
  "commitSha": "9f8e7d6…40 hex",
  "generatedAt": "2026-01-14T10:00:00Z",
  "tool": "coverlet",
  "format": "cobertura",
  "lines": { "covered": 5998, "valid": 8400 }
}
```

- `tool` è un identificatore breve (sanificato). `format` è un enum: `cobertura`, `lcov`, `opencover`, `jacoco`, `other`.
- `lines.valid` = 0 significa "nessun codice testabile" e diventa non applicabile, non 0%.
- Il collector:
  - elenca gli artifact del repository per nome;
  - prende il più recente non scaduto la cui run ha come head branch il branch di default;
  - scarica lo zip (limite 64 KB), legge quel solo file e lo valida con Zod;
  - controlla che `repository` corrisponda.
- La classificazione segue le regole esistenti:
  - nessun artifact → `missing`;
  - artifact scaduto → `missing` con motivo `quality-report-expired`;
  - 403 → `not-authorised`;
  - JSON o schema non validi → `invalid` più un errore di raccolta `invalid-data`;
  - `generatedAt` più vecchio di `freshness.qualityReportStaleDays` → `stale`.
- Permesso richiesto: **Actions: read**, già concesso. Nessun nuovo secret.
- **Un riepilogo per repository** (scelta di chi costruisce). Quando più componenti condividono un repository (un monorepo, o un coordinatore che è anche repo di un componente):
  - tutte le righe di quel repository mostrano lo stesso report, con la nota "report condiviso del repository";
  - l'aggregazione conta ogni repository **una sola volta**, quindi le righe non vengono mai contate due volte.
  - La suddivisione per percorso è fuori dal contratto 1.0.
- I finding di Code Quality seguono la stessa regola: si contano per repository e non si dividono mai per percorso.

### 5.2 Finding di Code Quality

- Fonte: `GET /repos/{o}/{r}/code-quality/findings?state=open`, paginato. Si tengono solo i conteggi, per `rule.category` (`reliability`, `maintainability`) e per `rule.severity`. Mai percorsi, messaggi o testo delle regole.
- `GET …/code-quality/setup` distingue "non attivo" da "non visibile".
- Il nome del permesso per token fine-grained e GitHub App **non è documentato**: chi costruisce lo verifica. Se non è leggibile, la capability vale `not-authorised` o `unknown` e l'interfaccia lo dice.
- In questa release i finding sono **solo informativi**: si vedono ma non cambiano lo stato Qualità.

> **Modifica (2026-10-21):** l'endpoint di configurazione richiede Administration: write, quindi l'hub non lo chiama. Un 404 sui finding è mostrato come sconosciuto.

### 5.3 Applicabilità per componente

- Per default la coverage si applica ai tipi `service`, `webapp`, `worker`, `library`; non si applica a `deployment`, `infrastructure` e `other` (scelta di chi costruisce).
- Il catalogo può cambiarla per singolo componente e per il coordinatore: `testCoverage: required | not-applicable`.
- Il coordinatore vale come `service`, salvo override.

### 5.4 Valutazione (nuovo blocco policies, tutto configurabile)

```yaml
quality:
  greenThresholdPercent: 80
  amberThresholdPercent: 60 # sotto = rosso
  missingReportIsAmber: true # alcuni componenti applicabili non visibili → al massimo attenzione
freshness:
  qualityReportStaleDays: 14
```

- **Stati del componente:**
  - **leggibile**: valido e recente.
  - **vecchio**: valido, ma più vecchio della soglia.
  - **non visibile**: uno tra `missing` (nessun artifact), `expired`, `invalid`, `not-authorised` (403), `unknown` (404 ambiguo o errore di rete).
  - **non applicabile.**
- **Coverage di progetto** = Σ righe coperte / Σ righe valide sui repository applicabili con un report **leggibile o vecchio**. È pesata sulle righe.
  - Un report vecchio conta comunque, ma si mostra sempre con la sua età (⧖) e limita lo stato come spiegato sotto.
  - I componenti non visibili non contano mai, e mai come 0.
- **Stato:**

  | Condizione                                  | Stato                                                        |
  | ------------------------------------------- | ------------------------------------------------------------ |
  | Nessun componente applicabile               | grigio "non applicabile" (come oggi `no-critical-workflows`) |
  | Tutti i componenti applicabili non visibili | grigio                                                       |
  | Altrimenti, per soglia                      | verde ≥ 80, attenzione ≥ 60, critico sotto 60                |

  Due casi impediscono il verde, quindi lo stato resta **al massimo attenzione** e un critico resta critico:
  - un report vecchio;
  - un componente applicabile non visibile, se `missingReportIsAmber` è true.

- **Motivi** (nuovi codici, stringhe EN/IT), ognuno con l'elenco dei componenti:
  - `quality-below-threshold`
  - `quality-below-red-threshold`
  - `quality-report-missing`
  - `quality-report-expired`
  - `quality-report-invalid`
  - `quality-report-not-authorised`
  - `quality-report-unknown`
  - `quality-report-stale`
  - `quality-not-applicable`
  - `quality-all-above-threshold`

### 5.5 Stato complessivo e score

- `quality` **non è critica**: un rosso in Qualità vale attenzione nello stato complessivo.
- È una **dimensione opzionale** (nuovo `overall.optionalDimensions`, default `[quality]`):
  - quando è misurata, conta per lo stato complessivo e per lo score come una dimensione richiesta non critica;
  - quando è grigia, viene ignorata: non rende grigio il progetto e non abbassa la quota misurata.
  - Così i progetti di oggi restano stabili finché la CI non pubblica i riepiloghi.
- Peso nello score `quality: 10`. Gli altri pesi non cambiano, e lo score resta la media pesata delle dimensioni misurate.

### 5.6 Modello snapshot (schema 1.3 → 1.4)

- L'enum `Dimension` acquisisce `quality`.
- `ProjectSnapshot.qualityHealth`:
  - `{ status, reasons, percentage|null, linesCovered, linesValid, measured, applicable, notVisible, stale, collectedAt }`;
  - `perComponent[{ componentId, state, percentage|null, linesCovered, linesValid, commitSha, generatedAt, tool, runUrl }]`;
  - `findings{ reliability, maintainability, bySeverity, state }`.
- `ProjectSummary.quality` = `{ status, percentage, measured, applicable }`.
- Nuova capability `codeQuality`. Nuova fonte di dati vecchi `quality-report` e fonti di errore di raccolta `quality-summary` / `code-quality`.
- `runUrl` punta alla run di GitHub Actions (l'allowlist degli host non cambia).
- Gli snapshot si rigenerano a ogni esecuzione. Le versioni precedenti non vengono lette, come oggi.

### 5.7 Interfaccia (come nella tavola "Proposta A" del canvas)

- **Portfolio:**
  - sesta barra, con l'ordine Delivery · Versioni · Sicurezza · Controlli · Governance · Qualità;
  - il filtro per stato comprende Qualità.
- **Pagina progetto:**
  - una sesta card di dimensione, "Qualità", con il testo "Test: 67% delle righe · soglia 80%";
  - una sezione "Qualità del codice" con tre riquadri: coverage aggregata con indicatore e soglia, finding aperti, punti ciechi;
  - una tabella per componente: coverage con indicatore e tacca della soglia, fonte del report (formato, commit, età) e finding;
  - una frase di legenda con le soglie.
- **Regole comuni:**
  - L'indicatore ha sempre accanto il numero: il colore non è mai l'unico segnale.
  - Lo sconosciuto usa un indicatore tratteggiato e il simbolo "?"; il non applicabile usa "–".
- **Come leggere:** una voce Qualità con le soglie.
- **Pagina Qualità dati:** elenca i report mancanti, scaduti e non validi.
- **Pagina Sicurezza:** invariata, a parte l'etichetta "Copertura controlli".
- **Allineamento del design:** dopo le modifiche al codice, aggiornare il canvas e il README del design system Warm Graphite (regola fissa).

### 5.8 Dati di esempio (solo sintetici)

| Progetto | Coverage | Note                                                                                                                              |
| -------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Alpha    | 84%      | tutti e 4 i componenti misurati, finding 0 / 3                                                                                    |
| Beta     | 67%      | come nel mockup: coordinator 38%, api 71%, report di web mancante, helm non applicabile                                           |
| Platform | 58%      | un solo report condiviso del monorepo, di 20 giorni fa: vecchio rispetto ai 14 giorni di default, quindi mostra ⧖ e resta critico |
| Gamma    | grigio   | nessun dato leggibile                                                                                                             |

C'è anche una fixture con un artifact scaduto e una con un riepilogo non valido. Un test canary mette in `tool` una stringa che sembra un segreto.

### 5.9 Documentazione

EN + IT:

- `configuration.md`: blocco policies, `testCoverage` nel catalogo, il contratto del riepilogo e il suo JSON Schema.
- `security.md`: nuove fonti e permessi, cosa non si pubblica mai.
- `architecture.md`: flusso dei dati.
- `operations.md`: come la CI produce l'artifact, con un esempio minimo di step.
- README: dimensioni e roadmap ("provider SonarQube" resta in roadmap).
- CHANGELOG.
- Un nuovo ADR: "Coverage dei test da un artifact di riepilogo della CI, non da Sonar né dall'interfaccia di GitHub".

## 6. Lasciato a chi costruisce

- Lettura dello zip: una piccola libreria MIT mantenuta, oppure un lettore minimo per un solo file. Il limite di 64 KB resta.
- La query esatta sugli artifact: per nome, poi scelta in base al branch di default.
- I nomi dei campi dentro `qualityHealth` oltre a quelli elencati.
- L'ordine dei componenti e il layout responsive della tabella, seguendo i pattern Warm Graphite esistenti.
- I timestamp delle fixture (token relativi `@now-…`).
