# Governo del rischio: eccezioni di sicurezza, SLA di remediation, policy-as-code — design

English: [../../../superpowers/specs/2026-10-21-risk-governance-design.md](../../../superpowers/specs/2026-10-21-risk-governance-design.md)

Stato: design di chi costruisce nell'ambito del programma roadmap (l'owner rivede dopo la consegna) · Data: 2026-10-21 · Release prevista: v0.9.0

Spec padre: [2026-10-21-roadmap-program-design.md](2026-10-21-roadmap-program-design.md) (§2 vincoli, §4 "v0.9.0 Risk governance", §5 anti-obiettivi). È vincolante. Ogni decisione di questo documento non fissata lì è **scelta di chi costruisce** ed è marcata **(SC)**.

Dipende da:

- v0.7.0 ([2026-10-21-history-trends-design.md](2026-10-21-history-trends-design.md)): `history.json`, `changes.json`, la pagina "Cosa è cambiato" e gli export CSV;
- v0.8.0 ([2026-10-21-repository-controls-design.md](2026-10-21-repository-controls-design.md)): schema snapshot 1.5, schema storico 1.1, ADR 0007, lo schema di livelli `info | amber | red`.

Entrambe vengono integrate prima di questa release. Questa release prende lo schema snapshot **1.6**, lo schema storico **1.2** e l'**ADR 0008**.

## 1. Intento e motivo

L'hub mostra gli alert di sicurezza aperti e li trasforma in uno stato Sicurezza. A un team che deve decidere cosa correggere prima mancano due risposte:

- **"Questo lo conosciamo e lo accettiamo fino a una data. Smetti di contarlo, ma non dimenticarlo."** Oggi l'unico modo è fare dismiss dell'alert su GitHub. L'hub non deve mai scrivere su un repository monitorato, e un dismiss non lascia nell'hub né una scadenza né una traccia di revisione.
- **"Da quanto è aperto, ed è in ritardo?"** Oggi un alert è aperto o no. La sua età e una scadenza di remediation non si vedono.

Ne segue un terzo bisogno: le regole che trasformano i finding in colori sono YAML. Quando qualcuno le cambia, nessuno vede l'effetto fino alla raccolta successiva. L'owner vuole policy-as-code: regole validate da uno schema, con un comando che mostra ogni decisione e gira in CI.

Fatti verificati il 2026-10-21 prima di decidere:

- **I finding sono già per alert, con la loro data di creazione.** `SecurityFinding` (`shared/model/snapshot.ts`) ha `id` (`<owner>/<repo>#<fonte>#<numero>`), `source`, `severity`, `status`, `ruleId`, `detectedAt` e `updatedAt`. `detectedAt` viene dal `created_at` dell'alert. I DTO in `collector/src/providers/types.ts` portano `createdAt`, mappato in `collector/src/providers/github/github-provider.ts` da `a.created_at` per code scanning, Dependabot e secret scanning. **Non serve nessuna nuova chiamata API né nuovo permesso.**
- Nei tipi OpenAPI di GitHub distribuiti con Octokit (`@octokit/openapi-types`), `created_at` è **obbligatorio** sugli alert di code scanning e di Dependabot, e **opzionale** sugli alert di secret scanning. Descrizione: "The time that the alert was created in ISO 8601 format". Quindi l'età di un alert di secret scanning può essere sconosciuta.
- Le chiamate di elenco non passano filtri `state`: alert aperti, corretti e chiusi con dismiss arrivano tutti al collector. Si conta solo `status === 'open'` (`countOpen` in `collector/src/normalizers/security-model.ts`).
- Le chiavi grezze necessarie al confronto stanno solo nei DTO. `ruleId` e l'id dell'advisory Dependabot diventano `null` nel finding pubblicato quando i dettagli sono nascosti (audience pubblica, repository non pubblico). Il confronto deve quindi avvenire **prima** di nascondere.
- Gli scanner esterni di `.security/project-security-status.json` riportano **solo conteggi**, senza record per finding e senza data. Non possono avere eccezioni né età.
- La configurazione è caricata da `collector/src/config/load.ts` da una directory (`--config`, default `config`). `config.local/` è ignorata da git e si usa come directory sostitutiva completa. Il workflow riutilizzabile di deploy passa la directory di configurazione di un repository privato. Gli JSON Schema in `config/schema/` sono **generati da Zod** con `npm run schema:generate`. Nessun test verifica che siano aggiornati.
- Gli snapshot golden usano la fonte mock, `config/` e `GOLDEN_NOW = 2026-01-15T12:00:00.000Z`. I timestamp delle fixture usano i token `@now-Nd` / `@now-Nh` (`collector/src/util/clock.ts`).
- La v0.7.0 costruisce la baseline dei cambiamenti dai finding con `status === 'open'` (`collector/src/history/baseline.ts`, branch `feat/history-trends`). Se i finding con eccezione smettessero di essere `open`, aggiungere un'eccezione farebbe comparire l'alert come "risolto" in "Cosa è cambiato".

## 2. Obiettivi, non-obiettivi, anti-obiettivi

Obiettivi

- **Eccezioni di sicurezza** in un file revisionato: un finding accettato esce dai conteggi e dallo stato finché l'eccezione è attiva, e resta visibile come "accettato fino al <data>". Un'eccezione scaduta rimette in gioco il finding ed è segnalata. Un'eccezione che non corrisponde a nulla è segnalata come obsoleta.
- **SLA di remediation:** giorni per severità nelle policy. Ogni finding aperto mostra età, SLA e scadenza. I finding in ritardo sono contati, e un critical o high in ritardo può alzare lo stato quando l'owner lo attiva.
- **Policy-as-code:** policy ed eccezioni validate da schema. `npm run policy:check` le valida, esegue casi di decisione e spiega ogni decisione, e può rivalutare una directory di snapshot esistente senza scrivere nulla. Un job di CI lo esegue su ogni pull request.
- Interfaccia in EN e IT, Warm Graphite: pagina progetto, pagina Sicurezza, Qualità dei dati, Come leggere.
- Funziona con dati di esempio e senza credenziali, come il resto.

Non-obiettivi

- Nessuna scrittura su GitHub: niente dismiss, niente riapertura, niente commenti sugli alert, niente creazione di issue.
- Nessuna eccezione per i conteggi degli scanner esterni (file di stato): non hanno identità per finding.
- Nessun flusso di approvazione delle eccezioni dentro l'hub. La revisione è la pull request sul repository di configurazione.
- Nessun calendario lavorativo per gli SLA (weekend, festività). I giorni sono giorni di calendario in UTC.
- Niente OPA / Rego (§5.9).
- Nessuno storico per finding. Lo storico tiene solo conteggi, come nella v0.7.0.

Anti-obiettivi (programma §5, specializzati)

- Un finding che sparisce senza traccia perché ha un'eccezione. I finding accettati sono sempre contati ed elencati a parte.
- Un'eccezione senza owner, motivo o scadenza, o con una scadenza oltre l'orizzonte delle policy.
- Un'eccezione che resta "attiva" quando la fonte degli alert non è leggibile: è **non verificabile**, mai "a posto".
- Un'età sconosciuta mostrata come "nei tempi". È "età sconosciuta".
- Un progetto che diventa rosso dopo l'aggiornamento solo perché esistono gli SLA. I ritardi sono **informativi per default**.
- Pubblicare il motivo o la regola di un'eccezione di un repository non pubblico quando `publication.audience` è `public`.
- Eccezioni o ritardi che creano alert "nuovi" o "risolti" fittizi in "Cosa è cambiato".

## 3. Vincoli (programma §2, invariati)

- Sola lettura verso i repository monitorati e verso ogni fonte. Non serve nessuna nuova chiamata API.
- Statico prima di tutto, nessun backend, nessuna chiamata a GitHub dal browser.
- Allowlist Zod rigorosa su ogni campo pubblicato. Testi e link sanificati. Allowlist degli host per i link.
- Sconosciuto ≠ zero; 403 ≠ nessun dato; 404 ambiguo = sconosciuto.
- EN + IT per tutta la documentazione e i testi dell'interfaccia (test di parità i18n).
- Solo dati di esempio nella demo pubblica, con nomi sintetici.
- Token Warm Graphite; stato mai affidato al solo colore; WCAG 2.2 AA.
- Un solo aumento dello schema snapshot per release (1.5 → 1.6). Gli snapshot precedenti non vengono letti.
- Mai eseguire `npm run ci:build` o `collect:mock`. Mai usare o terminare la porta 4321 (e2e sulla 4377). Solo podman.

## 4. Decisioni in breve

| #   | Decisione                                                                                                                                                                                                                                     | Perché                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Le eccezioni stanno in `<configDir>/exceptions.yaml`, opzionale. Nessun file = nessuna eccezione. JSON Schema `config/schema/exceptions.schema.json`, generato da Zod **(SC)**                                                                | Stesso posto, stesso percorso di revisione e stesso schema di override (`config.local/`, configurazione privata di deploy) di policy e catalogo |
| D2  | Un finding con eccezione mantiene `status: 'open'` (la verità di GitHub) e riceve `exception: { id, state, expires }`. Il conteggio usa un solo helper condiviso, `countsAsOpen(f)` **(SC)**                                                  | L'hub non finge che GitHub sia cambiato. La baseline della v0.7.0 continua a vedere l'alert aperto, quindi nessun "risolto" fittizio            |
| D3  | Selettori: `alert` (numero) per ogni fonte; `rule` (+ `tool` opzionale) per code scanning; `advisory` (GHSA o CVE) per Dependabot. Secret scanning accetta **solo** `alert` **(SC)**                                                          | Regole e advisory coprono finding ricorrenti. Accettare un intero tipo di segreto nasconderebbe segreti esposti in futuro                       |
| D4  | Obbligatori `owner`, `reason` (10–300 caratteri), `created`, `expires` (date). `expires − created ≤ exceptions.maxDays` (default **180**). `ticket` opzionale, con host in `publication.allowedLinkHosts` **(SC)**                            | Un'accettazione a tempo, con un responsabile e motivata. Una sola allowlist di host per ogni link pubblicato                                    |
| D5  | Stati dell'eccezione a ogni raccolta: `active`, `expired`, `stale` (nessun finding aperto corrisponde), `unverifiable` (fonte non leggibile). Le eccezioni orfane (repository in nessun progetto) sono contate a livello di raccolta **(SC)** | Sconosciuto ≠ zero: una fonte illeggibile non può né confermare né smentire una corrispondenza                                                  |
| D6  | I finding di un'eccezione scaduta tornano a contare e il progetto riceve il motivo Sicurezza `security-exception-expired` a livello amber (`exceptions.expiredIsAmber: true`) **(SC)**                                                        | "Quelle scadute tornano e sono segnalate" (programma §4). Tocca solo chi ha creato eccezioni                                                    |
| D7  | Giorni di SLA per classe: critical 7, high 30, medium 90, low 180, secret 7 (secret scanning, qualunque severità). Severità informational e unknown senza SLA **(SC)**                                                                        | Valori comuni nella gestione delle vulnerabilità. La severità del secret scanning è sempre `unknown`, quindi serve una classe a sé              |
| D8  | Età = adesso − `created_at` dell'alert. Scadenza = `created_at` + giorni di SLA. Un'eccezione attiva sospende il "in ritardo" ma non riavvia mai l'orologio **(SC)**                                                                          | Deterministico dai dati raccolti, senza bisogno dello storico. Un'eccezione non deve diventare un modo per far ripartire lo SLA                 |
| D9  | Escalation del ritardo per classe: `remediation.overdue.<classe>: info \| amber \| red`, **default `info` per ogni classe**. Il `config/policies.yaml` della demo la attiva con `critical: red, high: red` **(SC)**                           | Programma §5: mai rosso dalla sera alla mattina. La demo mostra l'effetto, e il commento dice che è una scelta esplicita                        |
| D10 | `npm run policy:check`: validazione + casi di decisione in `<configDir>/policy-cases/*.yaml` + rivalutazione opzionale con `--snapshot <dir>`. Non scrive mai **(SC)**                                                                        | Mostra l'effetto di una modifica alle policy nella pull request, prima della raccolta successiva                                                |
| D11 | Niente OPA / Rego. Zod è il validatore, il JSON Schema è generato da Zod, e un test li tiene allineati **(SC)**                                                                                                                               | Nessun nuovo runtime, nessun secondo linguaggio di policy per un insieme di regole piccolo e tipizzato (§5.9, ADR 0008)                         |
| D12 | CI: un job `policy-check` in `ci.yml` su ogni pull request, tramite l'esistente `rw-node-quality-host.yml` **(SC)**                                                                                                                           | Copre ogni modifica a `config/` senza filtro di percorso (un check obbligatorio saltato resta in attesa). Nessun nuovo workflow riutilizzabile  |
| D13 | La fonte mock legge `fixtures/exceptions/exceptions.yaml`, dove `created` / `expires` possono usare token `@now±Nd`. Le raccolte reali leggono `<configDir>/exceptions.yaml`, solo date assolute **(SC)**                                     | Golden deterministici e una demo dal vivo che non "scade" mai, come la fixture dello storico della v0.7.0 (lì D4)                               |
| D14 | Schema snapshot **1.5 → 1.6**. Storico **1.1 → 1.2** (conteggi `risk` opzionali). `changes.json` resta `1.0` con campi opzionali aggiunti **(SC)**                                                                                            | Un aumento per release. Lo storico segue lo schema additivo della v0.8.0                                                                        |
| D15 | ADR 0008: "Governo del rischio come policy-as-code tipizzata: eccezioni in configurazione revisionata, mai dismiss su GitHub, niente OPA"                                                                                                     | Registra perché l'hub tiene un proprio livello di accettazione accanto ai dismiss di GitHub                                                     |

## 5. Design

### 5.1 File delle eccezioni (`exceptions.yaml`, contratto 1.0)

```yaml
# yaml-language-server: $schema=./schema/exceptions.schema.json
schemaVersion: '1.0'
exceptions:
  - id: EXC-0001 # univoco, ^[A-Za-z0-9][A-Za-z0-9._-]{2,39}$
    repository: example-org/project-beta-api # owner/nome, senza distinzione maiuscole/minuscole
    source: code-scanning # code-scanning | dependabot | secret-scanning
    match: { rule: py/flask-debug, tool: CodeQL } # oppure { alert: 42 } oppure { advisory: GHSA-xxxx-xxxx-xxxx }
    owner: team-beta # un team o un ruolo, mai un indirizzo e-mail
    reason: Debug mode is only reachable in the local profile; removal planned with the settings refactor.
    created: '2026-01-05' # data di revisione, YYYY-MM-DD (UTC)
    expires: '2026-03-31' # ultimo giorno in cui l'eccezione vale (incluso, UTC)
    ticket: https://github.com/example-org/project-beta-api/issues/12 # opzionale
```

Regole dello schema (Zod, `shared/model/exceptions.ts`, oggetti strict):

- `match` è esattamente uno di questi:
  - `{ alert: int ≥ 1 }`;
  - `{ rule: stringa ≤ 200, tool?: stringa ≤ 50 }`, solo con `code-scanning`;
  - `{ advisory: /^(GHSA(-[A-Za-z0-9]{4}){3}|CVE-\d{4}-\d{4,})$/i }`, solo con `dependabot`.
- `secret-scanning` accetta solo `alert` (D3).
- `owner`: `^@?[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$`. Un team GitHub (`@example-org/team-beta`) o il nome di un ruolo. La regex rifiuta gli indirizzi e-mail (nessuna `@` dopo il primo carattere).
- `reason`: senza spazi ai bordi, da 10 a 300 caratteri.
- `created` ed `expires`: stringhe `YYYY-MM-DD` che sono date di calendario reali, con `expires ≥ created`. Si consiglia di metterle tra apici. Il pacchetto `yaml` (schema core YAML 1.2) tiene comunque come stringhe le date senza apici.
- `ticket`: URL `https`, ≤ 500 caratteri.
- A livello di file:
  - `exceptions` ha al massimo 500 voci;
  - gli id sono univoci;
  - nessuna coppia di voci condivide `(repository in minuscolo, source, selettore)`.

Controlli incrociati che richiedono policy o catalogo (`validateExceptions`, `collector/src/policy/exceptions.ts`):

| Controllo                                              | Esito                                         |
| ------------------------------------------------------ | --------------------------------------------- |
| `expires − created` > `exceptions.maxDays` (in giorni) | errore                                        |
| host di `ticket` non in `publication.allowedLinkHosts` | errore (host identico, come in `sanitizeUrl`) |
| `repository` in nessun progetto del catalogo           | avviso ("orfana")                             |
| scaduta al momento della validazione                   | avviso ("rimuovi o rinnova")                  |
| in scadenza entro `exceptions.expiringSoonDays`        | avviso                                        |
| `created` successiva a oggi (UTC)                      | avviso                                        |

- Gli errori fanno fallire `validate:config`, il collector (exit 1, strutturale, come ogni errore di configurazione) e `policy:check`.
- Gli avvisi sono stampati e non fanno mai fallire il collector.
- Il controllo dell'orizzonte confronta due date statiche, mai "adesso". Un file valido oggi resta valido domani, e una raccolta non può mai rompersi perché il tempo passa.

Caricamento (D13, `collector/src/config/load.ts`):

- `loadExceptions(file, { allowDateTokens, now })` restituisce `{ source: 'config' | 'fixture' | 'none', file: ExceptionsFile | null, warnings }`.
  - Un file mancante dà `none`.
  - Con `allowDateTokens` (solo mock), i valori `created` / `expires` come `@now-10d` sono risolti con `resolveRelativeTime` nella data UTC dell'istante risultante, prima del parsing.
  - Le raccolte reali rifiutano i token tramite la regex della data.
- `loadConfig(configDir, opts)` restituisce anche `exceptions`.
- `collector/src/index.ts` riceve `--exceptions <file>`:
  - default per `--source github`: `<config>/exceptions.yaml`;
  - default per mock: `fixtures/exceptions/exceptions.yaml` (token ammessi).
- `scripts/validate-config.ts` valida `<dir>/exceptions.yaml` se presente e stampa `✔ <dir>/exceptions.yaml: N exception(s)`.
- `config/exceptions.yaml` è distribuito con `exceptions: []` e un esempio commentato **(SC)**. La configurazione del repository resta valida, e il formato reale è documentato accanto alle policy.

### 5.2 Corrispondenza e stati delle eccezioni (`collector/src/policy/exceptions.ts`, pura)

Input: per repository, i finding con le loro **chiavi di confronto non pubblicate**, la leggibilità di ogni fonte di alert, le eccezioni e `now`.

- `toFindings` restituisce, accanto a ogni `SecurityFinding`, `keys: { alert: number, ruleId: string | null, tool: string | null, advisoryIds: string[] }`, prese dal DTO prima di nascondere i dettagli. Le chiavi restano dentro il collector.
- Un finding è candidato solo se il suo `status` GitHub è `'open'`.
- Corrispondenza:
  - `alert`: stesso repository (senza distinzione maiuscole/minuscole), stessa fonte, stesso numero;
  - `rule`: finding di code scanning con `ruleId === rule` (e `tool === match.tool` se indicato, senza distinzione maiuscole/minuscole);
  - `advisory`: finding Dependabot con GHSA o CVE uguale (senza distinzione maiuscole/minuscole).
- Scadenza: un'eccezione scade a `expires + 1 giorno, 00:00:00Z` (ultimo giorno incluso, UTC).
- Stato di ogni eccezione a `now`, vince la prima condizione vera:
  1. `expired`: `now ≥ scadenza`;
  2. `unverifiable`: la fonte di `(repository, source)` non era leggibile in questa raccolta (qualunque risultato fallito tranne `not-configured`, compresi un repository saltato e un limite di pagine). Una fonte `not-configured` per definizione non ha alert, quindi vale come vuota, la stessa regola che usa `countsComplete`;
  3. `stale`: nessun finding aperto corrisponde;
  4. `active`.
- `expiringSoon`: `active` e `scadenza − now ≤ exceptions.expiringSoonDays` giorni.
- Quale eccezione porta un finding, quando ne corrispondono più di una:
  - una attiva batte una scaduta;
  - poi `alert` batte `rule` / `advisory`;
  - poi la `expires` più lontana;
  - poi l'`id` più piccolo.
- Ogni corrispondenza conta nel `matched` di ogni eccezione che corrisponde, quindi un'eccezione per regola oscurata da un'eccezione per alert non è obsoleta.
- Un'eccezione orfana (repository in nessun progetto del catalogo) non ha record per progetto. Solo il suo id compare in `index.run.exceptions.orphaned`.
- Monorepo: la corrispondenza è per repository, quindi ogni progetto e componente che possiede il finding vede la stessa eccezione.

Effetto sui conteggi (D2):

- `countsAsOpen(f) = f.status === 'open' && f.exception?.state !== 'active'`, esportato da `shared/model`.
- Sostituisce `status === 'open'` in:
  - `countOpen`, `openSecretAlerts`, `byCategory`, `bySource`;
  - i "critical/high elencati" del sito e i "finding critici" della pagina Sicurezza;
  - il riepilogo finding CSV della v0.7.0.
- La **baseline della v0.7.0 resta su `status === 'open'`** di proposito (§5.8).
- `securityHealth.acceptedCounts` conta `status === 'open' && exception.state === 'active'` per severità.

Pubblicazione (D4, stessa regola dei titoli dei finding):

- Quando `publication.audience === 'public'` e il repository non è pubblico, `selector.value` (regola o advisory), `selector.tool`, `reason` e `ticketUrl` sono pubblicati come `null`.
- I numeri di alert, `owner`, le date, lo stato e i conteggi sono sempre pubblicati. I numeri di alert sono già nei link pubblicati.
- `reason` passa da `scrubText` (≤ 200 caratteri dopo la pulizia). `owner`, regola e tool passano da `scrubIdentifier`. `ticket` passa da `link()` (sanitizeUrl + allowlist degli host).

### 5.3 SLA di remediation (`collector/src/policy/sla.ts`, pura)

Per ogni finding con `status === 'open'` delle tre fonti GitHub, con `remediation.enabled`:

- Classe: `secret` per il secret scanning; altrimenti la severità se è critical, high, medium o low; altrimenti nessuna classe.
- `days = remediation.days[classe]`. Un valore `null` significa nessuno SLA.
- L'oggetto `sla` (su ogni finding aperto, `null` altrimenti):

  | Situazione                    | `state`   | `days` | `dueAt`                 | `ageDays`                           | `overdueDays`                        |
  | ----------------------------- | --------- | ------ | ----------------------- | ----------------------------------- | ------------------------------------ |
  | nessuna classe, o `days` null | `none`    | null   | null                    | età arrotondata per difetto, o null | null                                 |
  | `detectedAt` null             | `unknown` | days   | null                    | null                                | null                                 |
  | eccezione attiva              | `paused`  | days   | creazione + days        | floor((now − creazione)/g)          | null                                 |
  | `now > dueAt`                 | `overdue` | days   | creazione + days × 24 h | floor                               | floor((now − dueAt)/g), può essere 0 |
  | altrimenti                    | `within`  | days   | creazione + days × 24 h | floor                               | null                                 |

- `remediation.enabled: false` → ogni `sla` è `null`, ogni conteggio dei ritardi è `null` ("non misurato") e non si aggiunge nessun motivo SLA.
- `overdueDays` può essere 0 (in ritardo da meno di un giorno). L'interfaccia allora dice "in ritardo da meno di un giorno", mai "0 giorni" **(SC)**.
- L'interfaccia mostra "in ritardo dal <dueAt>". Quella data viene dalla creazione dell'alert, **non** dallo storico, quindi è corretta anche per un alert più vecchio dello storico dell'hub (D8).

Riepilogo di progetto `securityHealth.remediation`:

- `enabled`;
- `slaDays: { critical, high, medium, low, secret }`, una copia della policy, così il sito non legge mai le policy per etichettare una riga;
- `overdue: { critical, high, medium, low, secret }` conteggi dei finding `countsAsOpen` in stato `overdue`. Ciascuno è `null` quando gli SLA sono spenti o quando nessuna fonte di alert GitHub era leggibile, come `openCounts`. Sono un minimo quando `countsComplete` è false;
- `oldestOverdueSince`: il `dueAt` più vecchio tra i finding in ritardo, oppure `null`;
- `slaUnknown`: finding aperti con una classe ma `detectedAt` null.

### 5.4 Valutazione Sicurezza (`evaluateSecurity`, estesa)

`SecurityInputs` riceve `remediation` (sopra) ed `exceptions` (i record del progetto). Nuovi motivi, aggiunti a quelli esistenti:

| Codice                            | Livello                                                   | Parametri                                                  | Quando                                   |
| --------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------- |
| `sla-overdue`                     | `remediation.overdue[classe]` (default `info`)            | `{ severity: classe, count, days }`                        | uno per classe con ritardi > 0           |
| `sla-age-unknown`                 | `info`                                                    | `{ count }`                                                | `slaUnknown > 0`                         |
| `security-exception-active`       | `info`                                                    | `{ count }` (finding accettati)                            | almeno un finding accettato              |
| `security-exception-expired`      | `amber` se `exceptions.expiredIsAmber`, altrimenti `info` | `{ count, ids }` (id separati da virgola, max 10 poi "+N") | almeno un'eccezione scaduta del progetto |
| `security-exception-stale`        | `info`                                                    | `{ count, ids }`                                           | almeno un'eccezione obsoleta             |
| `security-exception-unverifiable` | `info`                                                    | `{ count, ids }`                                           | almeno un'eccezione non verificabile     |

- Ordine: dopo i motivi di severità, prima di `coverage-incomplete`.
- Il ritorno anticipato grigio ("nessuna fonte leggibile") non cambia. Eccezioni e SLA non trasformano mai uno sconosciuto in verde.
- I finding accettati non contano nei motivi `open-*`, perché quei motivi usano i conteggi.
- `no-open-alerts` significa sempre nessun alert aperto contato. Può stare accanto a `security-exception-active`.
- Stato complessivo e score non cambiano nel meccanismo. Vedono solo lo stato Sicurezza.

### 5.5 Policy (`config/policies.yaml`, lo `schemaVersion` delle policy resta `1.0`)

```yaml
remediation:
  enabled: true # false = no SLA computed or shown ("not measured")
  days: # calendar days from the alert's creation; null = no SLA for that class
    critical: 7
    high: 30
    medium: 90
    low: 180
    secret: 7 # secret scanning alerts, whatever their severity
  overdue: # what an overdue finding does to Security: info (default) | amber | red
    critical: info
    high: info
    medium: info
    low: info
    secret: info

exceptions:
  maxDays: 180 # longest allowed created → expires span (1–366)
  expiringSoonDays: 14 # active exceptions expiring within this many days are flagged (0–90)
  expiredIsAmber: true # an expired exception adds an amber Security reason
```

- Entrambi i blocchi sono opzionali (`.prefault({})`). `days.*`: intero 1–3650 o null. Livelli: riusare l'enum di livello della v0.8.0 se è esportato, altrimenti aggiungere `EnforcementLevelSchema = z.enum(['info','amber','red'])` a `enums.ts`.
- Il `config/policies.yaml` della demo imposta `overdue.critical: red` e `overdue.high: red`, con il commento "opt-in: the schema default is info" (D9).
- `src/lib/policies.ts` (`DEFAULTS_INPUT`) non cambia, perché i blocchi hanno un prefault.

### 5.6 Modello snapshot (schema 1.5 → 1.6)

`shared/model/enums.ts`:

- `SNAPSHOT_SCHEMA_VERSION = '1.6'`, `SUPPORTED = ['1.6']`, con il commento di storia `1.6: security exceptions, remediation SLAs`;
- i sei codici motivo del §5.4.

`shared/model/exceptions.ts` (nuovo):

- `ExceptionSourceSchema`, `ExceptionMatchSchema`, `ExceptionEntrySchema`, `ExceptionsFileSchema` (§5.1);
- `ExceptionStateSchema = z.enum(['active','expired','stale','unverifiable'])`;
- `PolicyCaseSchema` (§5.7).

`shared/model/snapshot.ts`:

```ts
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

SecurityFindingSchema gains:
  exception: z.object({ id: z.string().max(40), state: z.enum(['active','expired']), expires: day })
              .strict().nullable(),
  sla: z.object({
    state: z.enum(['within','overdue','paused','none','unknown']),
    days: z.number().int().min(1).nullable(),
    dueAt: isoDate.nullable(),
    ageDays: z.number().int().min(0).nullable(),
    overdueDays: z.number().int().min(0).nullable(),
  }).strict().nullable(),

SecurityExceptionSchema = z.object({
  id: z.string().max(40),
  repository: z.string().max(200),
  source: ExceptionSourceSchema,
  selector: z.object({
    kind: z.enum(['alert','rule','advisory']),
    value: z.string().max(200).nullable(),   // null = withheld (§5.2)
    tool: z.string().max(50).nullable(),
  }).strict(),
  owner: z.string().max(65),
  reason: shortText.nullable(),              // null = withheld
  created: day, expires: day,
  ticketUrl: httpsUrl.nullable(),
  state: ExceptionStateSchema,
  expiringSoon: z.boolean(),
  matched: nullableCount,                    // null when unverifiable
  findingIds: z.array(z.string().max(200)).max(50),
}).strict();

SecuritySummarySchema gains:
  acceptedCounts: SeverityCountsSchema,
  remediation: z.object({
    enabled: z.boolean(),
    slaDays: z.object({ critical, high, medium, low, secret: int ≥ 1 nullable }).strict(),
    overdue: z.object({ critical, high, medium, low, secret: nullableCount }).strict(),
    oldestOverdueSince: isoDate.nullable(),
    slaUnknown: z.number().int().min(0),
  }).strict(),
  exceptionStates: z.object({ active, expired, stale, unverifiable, expiringSoon: int ≥ 0 }).strict(),

ProjectSnapshotSchema gains:
  securityExceptions: z.array(SecurityExceptionSchema).max(500),   // sorted by state, then id

ProjectSummarySchema gains:
  risk: z.object({
    overdue: nullableCount,              // sum of the five overdue classes
    overdueCriticalHigh: nullableCount,
    accepted: nullableCount,             // sum of acceptedCounts
    exceptionIssues: z.number().int().min(0),   // expired + stale + unverifiable
  }).strict(),

RunMetadataSchema gains:
  exceptions: z.object({
    source: z.enum(['config','fixture','none']),
    total: z.number().int().min(0),
    orphaned: z.array(z.string().max(40)).max(100),   // ids only, never the repository
  }).strict(),
```

- Le primitive (`isoDate`, `httpsUrl`, `shortText`, `nullableCount`) si importano da dove le ha messe la v0.7.0 (`shared/model/primitives.ts`).
- `collection-report.md` riceve una riga: `Exceptions: 7 loaded (fixture) · 3 active · 1 expired · 1 stale · 1 unverifiable · 1 orphaned`.

### 5.7 `npm run policy:check` (D10)

`package.json`: `"policy:check": "tsx scripts/policy-check.ts"`. Il nucleo è `collector/src/policy/check.ts`, `runPolicyCheck(opts): Promise<{ exitCode: 0 | 1 | 2; lines: string[] }>`, così si può testare in unità. Lo script stampa le righe ed esce.

Opzioni:

| Opzione               | Default                    | Significato                                                               |
| --------------------- | -------------------------- | ------------------------------------------------------------------------- |
| `--config <dir>`      | `config`                   | policy, catalogo ed eccezioni da controllare                              |
| `--exceptions <file>` | `<config>/exceptions.yaml` | un altro file di eccezioni                                                |
| `--cases <dir>`       | `<config>/policy-cases`    | casi di decisione; directory mancante = avviso "no decision cases"        |
| `--snapshot <dir>`    | nessuno                    | rivaluta una directory di snapshot esistente, in sola lettura             |
| `--now <iso>`         | orologio di sistema        | l'istante per gli stati delle eccezioni e la rivalutazione dello snapshot |
| `--fail-on-warnings`  | spento                     | gli avvisi portano l'exit code a 1                                        |

Passi:

1. **Validare:** carica catalogo, policy ed eccezioni con le stesse funzioni del collector. Stampa una riga per ogni errore e avviso, con file e percorso (`exceptions[2] (EXC-PLAT-002): expires in 7 days (2026-01-22)`).
2. **Spiegare le policy:** una breve tabella di come gli input Sicurezza diventano livelli, dalle policy effettive: quali severità sono rosse o ambra, i giorni di SLA e il livello di ritardo per classe, l'orizzonte delle eccezioni, e se un'eccezione scaduta è ambra.
3. **Casi di decisione:** ogni `*.yaml` nella directory dei casi è letto con `PolicyCaseSchema` e valutato con le funzioni **reali** (`applyExceptions`, `applySla`, `evaluateSecurity`, oppure `evaluateOverall` + `evaluateScore`). Poi:
   - la decisione è stampata con ogni motivo, il suo livello e la chiave di policy che ha deciso il livello (`collector/src/policy/explain.ts`, una mappa statica da codice motivo a chiave, per esempio `sla-overdue` → `remediation.overdue.<severity>`);
   - la decisione effettiva è confrontata con `expect`. Una differenza stampa entrambe le decisioni e fallisce.
4. **Snapshot (opzionale):**
   - legge `index.json` e `projects/*.json` da `--snapshot` con gli schemi rigorosi. Uno `schemaVersion` non supportato è un errore;
   - per ogni progetto ricostruisce gli input Sicurezza dallo snapshot (finding, copertura, controlli, `countsComplete`, leggibilità), applica le eccezioni e gli SLA attuali, e rivaluta Sicurezza e stato complessivo;
   - stampa `would change: platform security amber → red (sla-overdue high ×1)` oppure `unchanged`;
   - i finding con `ruleId` nascosto non possono corrispondere a selettori `rule` / `advisory`. Sono riportati come "not evaluable from this snapshot (details withheld)", mai come senza corrispondenza;
   - la directory è aperta in sola lettura. Nulla viene scritto da nessuna parte, e un test lo fissa.
5. **Exit code:** 0 = valido e ogni caso superato (avvisi ammessi); 1 = un errore di validazione, un caso fallito, o un avviso con `--fail-on-warnings`; 2 = errore d'uso (opzione sconosciuta, directory illeggibile).

L'output della CLI è solo in inglese, come i log del collector **(SC)**. La documentazione che lo spiega è EN + IT.

File di caso (`PolicyCaseSchema`, strict):

```yaml
name: An overdue high alert raises Security to red when escalation is on
kind: security # security | overall
now: '2026-01-15T12:00:00Z' # optional; default 2026-01-15T12:00:00Z
security:
  findings: # minimal findings; status defaults to open
    - id: example-org/platform-mono#code-scanning#2
      severity: high
      detectedAt: '@now-31d' # ISO or @now±N(d|h) relative to `now`
      ruleId: js/prototype-pollution-utility # optional (rule selectors)
  exceptions: [] # same entries as exceptions.yaml (date tokens allowed here)
  unreadable: [] # optional "owner/repo|source" pairs
expect:
  status: red
  reasons: [open-high-alerts, sla-overdue] # must be present
  absent: [security-exception-active] # optional: must be absent
```

- `kind: overall` prende `overall: { dimensions: Record<Dimension, HealthStatus> }` e può attendersi `score` (intero o null).
- Nel caso, `source`, `repository` e il numero di alert vengono dall'`id` del finding.
- Gli altri input Sicurezza sono fissi: tutti i controlli attivi, copertura verde, conteggi completi, nessun conteggio esterno.
- Il repository include 8 casi sintetici in `config/policy-cases/`, coerenti con le policy della demo (elencati nel piano). Una directory di configurazione privata porta i propri, oppure riceve l'avviso.
- Si genera il JSON Schema `config/schema/policy-case.schema.json` per il supporto negli editor.

### 5.8 Storico e "Cosa è cambiato" (integrazione con la v0.7.0)

Cosa aggiunge lo storico, e cosa no:

- "In ritardo dal" **non** si calcola dallo storico. È `dueAt`, dalla creazione dell'alert (D8). Lo storico tiene solo conteggi e parte dalla prima raccolta v0.7.0, quindi sarebbe sbagliato per gli alert più vecchi.
- Lo storico dà l'**andamento** dei conteggi di ritardi e accettazioni, e "Cosa è cambiato" dà ciò che **ha superato una soglia tra due raccolte**.

Modifiche:

- Schema storico `1.2`, con `SUPPORTED_HISTORY_SCHEMA_VERSIONS = ['1.0','1.1','1.2']`. `HistoryProjectPoint` riceve il campo opzionale `risk: { overdue: nullableCount, accepted: nullableCount }` da `ProjectSummary.risk`. Un `risk` mancante significa "non tracciato allora" ed è mostrato così, mai come 0.
- La baseline non cambia. Tiene i finding con `status === 'open'`, compresi quelli accettati. Così aggiungere, far scadere o togliere un'eccezione non rende mai un alert "nuovo" o "risolto".
- `changes.json` mantiene `schemaVersion` `1.0`, con campi opzionali aggiunti scritti dalla 0.9.0:
  - `projects[].newlyOverdue`, max 50: `{ id, severity: 'critical' | 'high', componentId, repository, dueAt, htmlUrl }`. Sono finding aperti contati con `sla.state === 'overdue'` e `previousCollectedAt < dueAt ≤ generatedAt`;
  - `projects[].expiredExceptions`, max 50: `{ id, repository, expires }`. Sono le eccezioni del progetto il cui istante di scadenza cade nella stessa finestra;
  - `totals.newlyOverdue` e `totals.expiredExceptions`.
  - Entrambe le liste si riempiono solo con `basis.state === 'compared'`. Altrimenti sono vuote, e la pagina mostra il messaggio sulla base come oggi.
  - Una modifica alle policy che manda subito in ritardo finding vecchi **non** riempie `newlyOverdue`, perché il loro `dueAt` è prima della finestra. Quei finding compaiono invece come cambiamento di stato Sicurezza **(SC)**.
- La pagina "Cosa è cambiato" riceve due sottoliste per progetto: "Scaduti da poco" / "Newly overdue" ed "Eccezioni scadute" / "Exceptions expired".
- CSV, colonne aggiunte in fondo così le posizioni esistenti restano stabili **(SC)**:
  - `portfolio.csv`: `overdue`, `overdue_critical_high`, `accepted`, `exception_issues`;
  - `findings-summary.csv`: `overdue`, `accepted` per riga di componente.
  - `unknown` per null, come nella v0.7.0.

### 5.9 Perché non OPA / Rego (D11)

- **Peso:** OPA è un binario Go separato (decine di MB), oppure una build WASM più un passo di compilazione Rego in CI. Entrambi aggiungono superficie di supply chain e una toolchain a un progetto che oggi non ne ha.
- **Due linguaggi:** le regole di salute sono già TypeScript tipizzato guidato da uno YAML validato con Zod. Rego le duplicherebbe, o costringerebbe a riscrivere ogni valutatore senza nessuna capacità nuova.
- **Ciò che OPA darebbe** (validazione di schema, test di decisione, spiegazioni) è coperto da Zod, dal JSON Schema generato, dai casi di decisione e dalle spiegazioni motivo → chiave di policy.
- **Da riconsiderare quando** le policy avranno bisogno di logica arbitraria scritta dall'owner (per esempio condizioni tra dimensioni per business unit). Servirebbe un nuovo ADR.

Il JSON Schema resta il contratto pubblicato. `scripts/generate-json-schema.ts` aggiunge `exceptions.schema.json` e `policy-case.schema.json`. Un nuovo test rigenera in memoria ogni schema e lo confronta con `config/schema/*.json`, così i file generati non possono mai divergere da Zod.

### 5.10 CI (D12)

`.github/workflows/ci.yml` riceve:

```yaml
policy-check:
  name: Policy check
  permissions:
    contents: read
  uses: ./.github/workflows/rw-node-quality-host.yml
  with:
    node-version: '24'
    lint-command: npm run policy:check
    typecheck-command: ''
    format-check-command: ''
```

- Il commento di intestazione elenca il job.
- Il job gira su ogni pull request e su ogni push su `main`, quindi ogni modifica a `config/` è controllata. Si evita di proposito un filtro di percorso, perché un check obbligatorio saltato da un filtro di percorso non riporta mai un esito.
- `validate:config` (già in `ci:build`, `collect-data.yml` e `rw-hub-cloudflare-deploy.yml`) ora valida anche le eccezioni. Così una configurazione privata di deploy con un file di eccezioni rotto fallisce prima della raccolta, senza cambiare quei workflow.
- `.github/CODEOWNERS` riceve una riga esplicita `/config/exceptions.yaml @massilp` con il commento "risk acceptances: owner review" **(SC)**. Oggi è ridondante con `*`, e documenta l'intento.

### 5.11 Interfaccia (Warm Graphite, EN + IT)

Regole comuni:

- Ogni stato ha testo e simbolo, mai solo il colore.
- Le date usano la formattazione esistente per lingua. Le età sono giorni interi ("30 g" / "30 d").
- I valori nascosti mostrano il testo esistente "nascosto per i repository non pubblici".

**Pagina progetto** (fold `#security`, `src/pages/[...lang]/projects/[id].astro`, oppure un nuovo `src/components/RiskPanel.astro`):

- **Riga di remediation** in cima al fold:
  - "In ritardo: 1 high · il più vecchio dal 14 gen 2026" oppure "Niente in ritardo";
  - quando gli SLA sono spenti, "Gli SLA di remediation sono spenti nelle policy.";
  - con conteggi incompleti, "≥ n", come oggi.
- **Righe degli alert** (elenco critical / high) ricevono una riga di dettaglio, con l'attributo di riga `data-sla-state`:
  - in ritardo: "Età 30 g · SLA 30 g · in ritardo dal 14 gen 2026", con una pillola `In ritardo` (icona orologio + testo);
  - nei tempi: "scade tra 4 g";
  - sospeso: "Accettato fino al 4 feb 2026 (EXC-ALPHA-001)", con una pillola `Accettato`;
  - sconosciuto: "età sconosciuta".
- I finding critical/high accettati sono elencati sotto un sottotitolo proprio "Accettati con eccezione" / "Accepted by exception", dopo quelli contati. Non sono mai mescolati.
- **Tabella "Eccezioni"** (`id="exceptions"`), una riga per eccezione del progetto:
  - id;
  - ambito: repository · fonte · selettore, oppure il testo di dettaglio nascosto;
  - owner;
  - motivo, oppure il testo di dettaglio nascosto;
  - badge di stato: "Attiva fino al <data>", "In scadenza il <data>", "Scaduta il <data>", "Obsoleta: non corrisponde a nulla" oppure "Non verificabile: fonte non leggibile";
  - numero di corrispondenze;
  - link al ticket.

  Legenda: "I finding accettati non contano per lo stato finché l'eccezione non scade. L'hub non fa mai dismiss degli alert su GitHub."

- **Scheda dimensione Sicurezza:** una riga in più "1 in ritardo · 1 accettato" quando uno dei due non è zero.
- **Pannello "perché":** i nuovi motivi, con testi EN/IT.

**Pagina Sicurezza** (`security.astro`):

- La striscia dei totali riceve i totali "In ritardo" e "Accettati", con "≥" se incompleti e "?" se sconosciuti.
- Ogni scheda progetto riceve una riga "In ritardo {n} · Accettati {m} · Eccezioni da sistemare {k}", con link a `#exceptions` del progetto.
- Nuovo fold **"Coda di remediation"** / **"Remediation queue"** (`<details class="sec-queue disclosure" open>`):
  - una tabella di ogni finding critical/high aperto, contato **e** accettato, di tutti i progetti, ordinata per stato (prima in ritardo, poi nei tempi per `dueAt`, poi sospesi, poi sconosciuti);
  - colonne: Severità · Alert (titolo o nascosto, con il link a GitHub) · Progetto · Età · SLA · Scadenza / in ritardo dal · Stato (In ritardo / Nei tempi / Accettato fino al … / Età sconosciuta);
  - al massimo 100 righe, poi "e altri N nelle pagine dei progetti";
  - ogni riga ha `data-finding-id` e `data-sla-state`;
  - sui telefoni la tabella usa lo schema responsivo esistente con `data-label`.

**Pagina Qualità dei dati:** una nuova scheda **"Eccezioni di sicurezza"** / **"Security exceptions"** (`id="h-exceptions"`) con quattro elenchi:

- scadute, "rimuovi o rinnova";
- obsolete, "non corrisponde a nessun alert aperto";
- non verificabili, con la fonte illeggibile;
- id orfani, "repository non nel catalogo".

Più "in scadenza". Ogni voce rimanda a `#exceptions` del progetto.

**Come leggere:** una nuova sezione `#risk` "Eccezioni e SLA di remediation" / "Exceptions and remediation SLAs":

- accettato contro dismiss su GitHub;
- i quattro stati di un'eccezione;
- la tabella degli SLA letta dalle policy effettive, con il livello di ritardo per classe e "informativo" quando è `info`;
- "in ritardo dal = creazione dell'alert + giorni di SLA";
- perché un'età sconosciuta non è mai "nei tempi".

**Portfolio:** nessuna nuova barra o colonna **(SC)**. Il tooltip della barra Sicurezza riceve "· {n} in ritardo · {m} accettati" quando non sono zero.

**Prima il design (regola fissa dell'owner):** prima di scrivere codice, il pannello rischi della pagina progetto, la coda di remediation e la scheda di Qualità dei dati si disegnano come artboard nel canvas di Claude Design con Warm Graphite. L'owner rivede dopo la consegna, quindi non è bloccante. Dopo la build si aggiornano il canvas e il README del DS. Nessun link agli artifact entra nel repository.

### 5.12 Dati di esempio (sintetici)

Nuovi alert in `fixtures/github`:

| Repository                   | Alert                                                                   | Creato                  |
| ---------------------------- | ----------------------------------------------------------------------- | ----------------------- |
| `project-alpha-backend`      | code scanning #15 `java/xxe`, high, aperto, CodeQL                      | `@now-45d`              |
| `project-beta-api` (privato) | code scanning #7 `py/flask-debug`, medium, aperto, CodeQL               | `@now-20d`              |
| `platform-mono`              | code scanning #2 `js/prototype-pollution-utility`, high, aperto, CodeQL | `@now-738h` (30 g 18 h) |

`fixtures/exceptions/exceptions.yaml` (date risolte rispetto a `GOLDEN_NOW = 2026-01-15T12:00Z`):

| id               | Repository · fonte · selettore                                  | Creata → scade                       | Stato all'istante golden                                         |
| ---------------- | --------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------- |
| `EXC-ALPHA-001`  | alpha-backend · code-scanning · alert 15                        | `@now-10d` → `@now+20d` (2026-02-04) | attiva, accetta high #15                                         |
| `EXC-ALPHA-002`  | alpha-frontend · dependabot · alert 5 (corretto)                | `@now-50d` → `@now+10d`              | obsoleta                                                         |
| `EXC-BETA-001`   | beta-api · code-scanning · regola `py/flask-debug`, tool CodeQL | `@now-15d` → `@now+60d`              | attiva, accetta medium #7; selettore e motivo nascosti (privato) |
| `EXC-BETA-002`   | beta-web · secret-scanning · alert 2                            | `@now-5d` → `@now+25d`               | non verificabile (secret scanning 403)                           |
| `EXC-PLAT-001`   | platform-mono · code-scanning · regola `js/path-injection`      | `@now-60d` → `@now-1d` (2026-01-14)  | scaduta: medium #5 torna a contare                               |
| `EXC-PLAT-002`   | platform-mono · dependabot · advisory `GHSA-demo-0004-mono`     | `@now-170d` → `@now+7d` (2026-01-22) | attiva, in scadenza, accetta low #9                              |
| `EXC-LEGACY-001` | `example-org/legacy-tool` · dependabot · alert 3                | `@now-30d` → `@now+30d`              | orfana                                                           |

Gli owner sono `team-alpha`, `team-beta` e `team-platform`. I ticket sono `https://github.com/example-org/<repo>/issues/<n>`.

Storia golden risultante, con le policy della demo (`overdue.critical: red`, `overdue.high: red`):

| Progetto | Sicurezza         | Complessivo     | In ritardo                                                       | Accettati  | Eccezioni                               |
| -------- | ----------------- | --------------- | ---------------------------------------------------------------- | ---------- | --------------------------------------- |
| Alpha    | amber (invariato) | invariato       | 0                                                                | 1 (high)   | 1 attiva, 1 obsoleta                    |
| Beta     | red (invariato)   | invariato       | 0 (critical #3 scade 2026-01-19T12:00Z, tra 4 g)                 | 1 (medium) | 1 attiva (nascosta), 1 non verificabile |
| Platform | **amber → red**   | **amber → red** | 1 high (#2, scadenza 2026-01-14T18:00Z, età 30 g, ritardo < 1 g) | 1 (low)    | 1 scaduta, 1 attiva in scadenza         |
| Gamma    | grey (invariato)  | invariato       | null                                                             | null       | nessuna                                 |

A livello di raccolta: `exceptions: { source: 'fixture', total: 7, orphaned: ['EXC-LEGACY-001'] }`.

La fixture dello storico della v0.7.0 viene adattata così che la sua ultima baseline contenga già `alpha-backend#code-scanning#15` e `platform-mono#code-scanning#2`, entrambi high aperti, e nessuno dei due compaia come "nuovo". Il `changes.json` golden mostra allora per Platform:

- complessivo e Sicurezza amber → red;
- `newlyOverdue: [#2]`, perché la scadenza 2026-01-14T18:00Z cade in (2026-01-14T12:00Z, 2026-01-15T12:00Z];
- `expiredExceptions: [EXC-PLAT-001]`, perché la sua scadenza 2026-01-15T00:00Z cade nella stessa finestra.

Gli altri progetti non mostrano cambiamenti di rischio.

`config/exceptions.yaml` resta `exceptions: []`. La fonte mock non lo legge (D13).

### 5.13 Documentazione (EN + IT)

- `configuration.md`: i blocchi di policy `remediation` ed `exceptions`; il contratto di `exceptions.yaml` con un esempio per selettore; il formato dei casi di policy; l'opzione `--exceptions`; la regola della fixture mock.
- `security.md`:
  - nessun nuovo permesso e nessuna scrittura: le eccezioni non fanno mai dismiss su GitHub;
  - cosa si pubblica di un'eccezione, e cosa si nasconde per i repository non pubblici;
  - i fatti e le fonti su `created_at` (§9);
  - la raccomandazione di tenere le eccezioni reali in un repository di configurazione privato.
- `operations.md`:
  - come aggiungere, rinnovare e togliere un'eccezione con una pull request;
  - eseguire `npm run policy:check` in locale e con `--snapshot public/data` (sola lettura);
  - il job di CI;
  - attivare l'escalation degli SLA.
- `architecture.md`: il flusso dei dati (corrispondenza → SLA → valutazione) e il confine di fiducia (il file delle eccezioni è configurazione revisionata; il suo testo viene ripulito prima della pubblicazione). Versione snapshot `1.6`.
- README / README.it:
  - testo della dimensione Sicurezza (accettati, in ritardo);
  - `policy:check` nell'elenco dei comandi;
  - roadmap: togliere "eccezioni di sicurezza con scadenza", "policy-as-code" e "SLA di remediation".
- `PRODUCT.md`, `DESIGN.md`: il pannello rischi, la coda di remediation e le pillole Accettato / In ritardo.
- `CHANGELOG.md`.
- ADR 0008 (EN + IT).

## 6. Test (sintesi; i casi esatti sono nel piano)

- **Unità, modello:** schema delle eccezioni (ogni regola dei selettori, secret solo `alert`, owner che rifiuta un'e-mail, lunghezza del motivo, date reali, duplicati); default delle policy; test di divergenza dei JSON Schema.
- **Unità, eccezioni:** controlli incrociati (orizzonte, host del ticket, avviso di orfana); ogni stato; scadenza inclusiva al confine UTC; precedenza; dettagli nascosti; il canary in `reason` viene ripulito.
- **Unità, SLA:** ogni riga della tabella del §5.3; l'eccezione sospende ma non riavvia; SLA spenti → null.
- **Unità, sicurezza:** il default `info` non cambia mai lo stato; l'opt-in `high: red` porta amber a red; scaduta → amber; obsoleta e non verificabile → info; grigio resta grigio.
- **Unità, policy:check:** exit code, spiegazioni, differenza di un caso fallito, avvisi, `--snapshot` in sola lettura (nessun file creato o modificato), finding nascosti "non valutabili".
- **Integrazione:** numeri golden del §5.12, schema 1.6, metadati di raccolta, riga del report di raccolta, canary bloccati, liste di rischio in `changes.json`, storico 1.2 che legge un file 1.0 e uno 1.1.
- **Sito / e2e:** pannello rischi, tabella delle eccezioni, ordine della coda di remediation, scheda di Qualità dei dati, sezione di Come leggere, testi IT, attributi `data-sla-state`, nessuno scorrimento orizzontale a 412 px.

## 7. Rischi

- **Selettori ampi.** Una sola eccezione `rule` o `advisory` può accettare molti alert, anche futuri. Mitigazioni:
  - il limite dell'orizzonte;
  - `matched` e `findingIds` sono mostrati;
  - l'ambito `tool` opzionale;
  - il secret scanning accetta solo alert singoli.
- **File delle eccezioni pubblico.** Nel repository della demo pubblica le eccezioni sono sintetiche. Le eccezioni reali dicono che cosa accetta un team. La documentazione raccomanda un repository di configurazione privato (lo schema di deploy esistente), e i dettagli nascosti proteggono i repository non pubblici su un sito pubblico.
- **`created_at` vecchio sugli alert riaperti.** Un alert riaperto mantiene la creazione originale e può essere subito in ritardo. È documentato come voluto (il rischio era noto da allora).
- **Date in UTC.** Un owner in CET può aspettarsi la scadenza a mezzanotte locale. Documentazione e interfaccia dicono "UTC".
- **La demo porta Platform al rosso.** Voluto, e visibile nel commento della configurazione della demo. I golden della v0.7.0 e della v0.8.0 cambiano per Platform. Il piano aggiorna di conseguenza la fixture dello storico.
- **Divergenze con v0.7.0 e v0.8.0.** Struttura dei file (`primitives.ts`, moduli dello storico, chiavi i18n, enum dei livelli) e numeri di versione (snapshot 1.6, storico 1.2, ADR 0008) possono cambiare. Il piano dice: prendere il primo numero libero e adattarsi.

## 8. Lasciato a chi costruisce (chi implementa)

- Il markup Astro esatto del pannello rischi e della coda, e se il pannello è un componente, seguendo gli schemi Warm Graphite.
- I nomi degli helper interni oltre alle interfacce del piano.
- Se `explain.ts` è una mappa o uno switch, purché ogni nuovo codice motivo e ogni motivo Sicurezza esistente abbia una spiegazione.

## 9. Fonti (verificate il 2026-10-21)

- `@octokit/openapi-types` (in `node_modules`, usato da `@octokit/rest` 22): `code-scanning-alert-items.created_at` e `dependabot-alert.created_at` sono obbligatori; `secret-scanning-alert.created_at` è opzionale; `alert-created-at` è descritto come "The time that the alert was created in ISO 8601 format". Il parametro `state` dell'elenco di code scanning: "Set to `open`, `closed`, `fixed`, or `dismissed` to list code scanning alerts in a specific state"; il parametro `state` di Dependabot è un filtro opzionale separato da virgole.
- Codebase: `collector/src/providers/types.ts` (`createdAt` sui tre DTO di alert), `collector/src/providers/github/github-provider.ts` (mappatura da `created_at`, nessun filtro `state`), `collector/src/normalizers/security-model.ts` (`toFindings`, `countOpen`, dettagli nascosti), `collector/src/evaluators/health.ts` (`evaluateSecurity`), `collector/src/config/load.ts`, `scripts/generate-json-schema.ts`, `scripts/update-golden-snapshots.ts`, `.github/workflows/ci.yml`, `rw-node-quality-host.yml`.
- Branch v0.7.0 `feat/history-trends`: `shared/model/history.ts`, `collector/src/history/baseline.ts` (`openCriticalHigh` usa `status === 'open'`).
- GitHub REST, alert di Dependabot e di code scanning (filtri di stato, `created_at`): <https://docs.github.com/en/rest/dependabot/alerts>, <https://docs.github.com/en/rest/code-scanning/code-scanning>, <https://docs.github.com/en/rest/secret-scanning/secret-scanning>.
- Distribuzione di Open Policy Agent (singolo binario Go statico, oppure compilazione Wasm di Rego): <https://www.openpolicyagent.org/docs/latest/#running-opa>, <https://www.openpolicyagent.org/docs/latest/wasm/>.
