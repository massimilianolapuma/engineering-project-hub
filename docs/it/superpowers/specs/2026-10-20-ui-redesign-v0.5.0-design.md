# Redesign UI v0.5.0 — "Warm Graphite", prima di tutto la leggibilità

Versione inglese: [../../../superpowers/specs/2026-10-20-ui-redesign-v0.5.0-design.md](../../../superpowers/specs/2026-10-20-ui-redesign-v0.5.0-design.md)

Stato: bozza in attesa di approvazione · Data: 2026-10-20 · Release di destinazione: v0.5.0

## 1. Intento e motivazioni

Il mondo "Survey Sheet" della v0.4.0 (metafora della carta topografica: tratteggio a 45°, riferimenti di griglia A–F, marrone delle curve di livello, note a margine, legenda grande) ha dato carattere al portale, ma lo ha reso difficile da digerire: a colpo d'occhio ogni elemento compete allo stesso volume e l'occhio non ha un punto di ingresso. Il proprietario l'ha provato con dati mock e ha trovato le schermate visivamente pesanti e i concetti difficili da leggere.

La v0.5.0 sostituisce quel mondo. L'obiettivo è che ogni pagina dica prima una cosa sola, poi mostri la lista, poi il dettaglio solo su richiesta. Il carattere nasce da sobrietà e precisione, non da una metafora.

I principi di prodotto in `PRODUCT.md` non cambiano: lo sconosciuto non è mai zero, il complessivo è sempre spiegato dalle sue dimensioni, il rischio reale è la cosa più visibile, sola lettura, static-first.

## 2. Obiettivi, non-obiettivi, anti-obiettivi

Obiettivi

- Un primo viewport che si capisce in circa tre secondi su ogni pagina.
- Un unico sistema visivo ("Warm Graphite") applicato a tutte le pagine: Portfolio, Project, Security, Versions, Workflows, Data quality, Catalog, più una nuova pagina "Come leggere".
- Uno **score** di progetto (0–100) per ordinare e confrontare i progetti, coerente con lo stato di salute.
- Sconosciuto / non autorizzato / punti ciechi restano espliciti e distinti, con un trattamento visivo più leggero del tratteggio attuale.
- WCAG 2.2 AA nei temi chiaro e scuro; lo stato mai affidato al solo colore.

Non-obiettivi

- Nessuna storia o trend: lo score ordina solo lo snapshot di oggi. Una vista "Cosa è cambiato dall'ultima raccolta" è nella roadmap (richiede snapshot archiviati), non nella v0.5.0.
- Nessuna reimplementazione del triage degli alert di GitHub: la lista completa degli alert vive in GitHub Security Overview.
- Nessuna modifica a sorgenti dati, permessi o sanitizzazione del collector.

Anti-obiettivi (un fallimento anche se "funziona")

- Uno score che fa sembrare buono un progetto con un problema critico aperto.
- Uno score mostrato per un progetto i cui dati non siamo riusciti a leggere per la maggior parte.
- Lo sconosciuto reso come zero, come sano, o come visivamente più calmo di una lacuna opzionale.
- Una pagina in cui il colore è l'unico portatore di stato.
- I segnali tipici delle dashboard "da AI": bordi colorati laterali sulle card, glassmorphism, testo con gradiente, tile KPI decorativi senza una decisione dietro.

## 3. Vincoli (invariati, dalle regole di progetto)

- Sito Astro statico, nessun backend a runtime, nessuna chiamata alle API GitHub e nessun token nel browser, sola lettura per progetto.
- Nessun servizio commerciale esterno a runtime: i font sono self-hosted tramite `@fontsource/*`.
- Bilingue EN (predefinito `/`) e IT (`/it/`): ogni nuova stringa in `src/i18n/en.ts` e `it.ts` (test di parità delle chiavi), ogni documento in EN e IT.
- Solo dati mock nel repository pubblico; il repository di deploy privato compila lo stesso codice con dati reali.
- Nessun nome reale di azienda o cliente da nessuna parte; il dominio di hosting protetto non è menzionato nel repository pubblico.
- La scansione dei secret sull'output resta verde: evitare stringhe UI nella forma `secret: …` / `secret = …` (attivano il pattern `credential-assignment`).

## 4. Decisioni prese con il proprietario

1. **Portfolio = lista compatta (layout "B").** Una riga per progetto, ordinata dal peggiore: pallino di stato, nome, score, cinque barre di dimensione (Delivery, Versions, Security, Coverage, Governance), motivo principale su una riga. Il dettaglio sta nella pagina Project, non nella riga.
2. **Score** per ordinare e confrontare (sezione 6). Sta accanto al pallino di stato; non sostituisce mai le dimensioni.
3. **Ambito: tutte le sezioni.** Ordine di priorità del lavoro: Portfolio + Project → Security → Versions → Workflows → Data quality → Catalog. Più una nuova pagina "Come leggere".
4. **Palette: Warm Graphite** (sezione 5), scelta al posto di Slate & Signal, Ink & Cobalt, Oat & Indigo e Paper & Ink.
5. **Security = per progetto ("B")**, con una frase di sintesi del portfolio in alto. L'hub mostra ciò che GitHub non mostra: raggruppamento per progetto logico, copertura inclusi i controlli non GitHub, punti ciechi dichiarati. Le liste complete degli alert rimandano a GitHub; nell'hub sono elencati solo gli alert critical e high (nella pagina Project).
6. **Pagina Project** come nel mockup: intestazione con stato, score e confidenza; "Perché è critico/in attenzione" in frasi; cinque card di dimensione; ambienti come percorso DEV → UAT → PROD; tabella dei componenti; sezioni rimanenti compresse.
7. **Pagina "Come leggere"** sostituisce la legenda per pagina: significato degli stati, sconosciuto vs non autorizzato vs non configurato vs non applicabile, formula dello score, soglie. Le pagine mantengono una legenda su una riga con un link a essa.
8. **"Cosa è cambiato"** va nella roadmap, non nella v0.5.0.
9. **Claude Design è il riferimento visivo.** Warm Graphite è mantenuto come design system nell'account Claude Design del proprietario (sostituisce il design system precedente come fonte dei token), e il proprietario ha approvato il 2026-10-20 un canvas di mockup hi-fi delle sette pagine (Portfolio, Project, Security, Versions, Workflows, Data quality, Catalog). Layout, tono dei testi e trattamento dei componenti seguono quel canvas; questo documento prevale dove differiscono sulle regole. I link al canvas sono privati e non vengono committati in questo repository pubblico.

## 5. Sistema visivo — Warm Graphite

I token sono definiti in `src/styles/tokens.css` (chiaro + scuro, `prefers-color-scheme` con override `[data-theme]`, come oggi). I valori sotto sono i valori approvati nel mock; il builder ritocca solo la luminosità se necessario per superare il test di contrasto, mantenendo tinta e carattere.

Neutri

| Token                                    | Light     | Dark      |
| ---------------------------------------- | --------- | --------- |
| `--bg`                                   | `#f6f5f3` | `#151311` |
| `--surface`                              | `#fffefc` | `#1c1a17` |
| `--surface-2`                            | `#f6f5f3` | `#181614` |
| `--border`                               | `#e7e5e1` | `#2c2925` |
| `--text`                                 | `#1c1917` | `#ece9e4` |
| `--text-muted`                           | `#57534e` | `#a8a29e` |
| `--border-strong` (control borders, 3:1) | `#928d86` | `#746e66` |
| `--unknown` (dashed outline, 3:1)        | `#8f8a83` | `#7f786f` |

Accento (solo link, focus, azione primaria; mai per lo stato): teal `oklch(0.52 0.09 195)` chiaro, `oklch(0.74 0.1 195)` scuro.

Stato (riempimenti per pallini e barre; `*-text` per il testo sulle tinte)

| State                     | Light fill / text                             | Dark fill / text                                |
| ------------------------- | --------------------------------------------- | ----------------------------------------------- |
| Critical (red, vermilion) | `oklch(0.6 0.19 35)` / `oklch(0.48 0.16 35)`  | `oklch(0.7 0.17 35)` / `oklch(0.82 0.11 35)`    |
| Attention (amber, ochre)  | `oklch(0.66 0.15 72)` / `oklch(0.47 0.1 65)`  | `oklch(0.8 0.14 80)` / `oklch(0.86 0.1 82)`     |
| Healthy (green, emerald)  | `oklch(0.6 0.12 165)` / `oklch(0.45 0.1 165)` | `oklch(0.72 0.12 165)` / `oklch(0.82 0.09 165)` |

Tinte delle pill (valori fissi, non color-mix, così possono essere testati per il contrasto): rosso `oklch(0.95 0.03 35)` / `oklch(0.27 0.05 35)`, ambra `oklch(0.95 0.05 85)` / `oklch(0.29 0.05 80)`, verde `oklch(0.95 0.03 165)` / `oklch(0.27 0.04 165)` (chiaro / scuro). I riempimenti di stato raggiungono 3:1 su `--surface` come elementi grafici (l'ambra chiaro è stato scurito a ocra per questo); ogni `*-text` raggiunge 4.5:1 sulla propria tinta e su `--surface`.
| Unknown | no fill, 1.5px dashed `--unknown` outline, muted text | same |

Le pill di stato poste prima del testo (motivi nelle liste, righe dei workflow) stanno in una colonna a larghezza fissa, così il testo che le segue inizia sempre alla stessa x, qualunque sia la lunghezza dell'etichetta (feedback del proprietario sul mockup). La severità mantiene la propria scala (critical / high / medium / low), mai disegnata con i toni di salute; il builder può riusare le tinte rosso/ambra per i badge critical/high come etichette di testo, con il glifo a barre o l'etichetta sempre presenti.

Tipografia: **IBM Plex Sans** (400/500/600/700) per tutto, cifre tabulari per score e conteggi; **IBM Plex Mono** (400/500) solo per codice, nomi di repository e versioni. Sostituire `@fontsource/public-sans` e `@fontsource/geist-mono` con `@fontsource/ibm-plex-sans` e `@fontsource/ibm-plex-mono`. Testo del corpo ≥ 14px, interlinea ≈ 1.5; etichette piccole ≥ 12px.

Forma e spazio: raggio 8px (controlli, pill 999px), 10px (card, tabelle); bordi da 1px; nessuna ombra pesante; nessun bordo laterale colorato; padding generoso (pill ≥ 4px × 10px, celle ≥ 8px × 10px).

Simboli di stato (copertura e controlli), usati ovunque con lo stesso significato: ✓ abilitato · ! richiesto ma non configurato · ⧖ scansione obsoleta · ? non visibile (non autorizzato / sconosciuto / raccolta fallita) · – non richiesto / non applicabile. Ogni simbolo ha un nome accessibile; il colore è secondario.

Rimossi dalla v0.4.0: `--hatch`, `--hatch-void`, marrone `--frame`, riferimenti di griglia, neatline del foglio, note a margine, variante legenda del foglio, Public Sans.

## 6. Score

Scopo: ordinare e confrontare i progetti nello snapshot di oggi. Calcolato dal collector (nuovo evaluator accanto agli evaluator di salute), pubblicato nello snapshot, solo visualizzato dal sito.

Formula (scelta mia, documentata e configurabile):

- Punti per dimensione misurata: verde 100, ambra 60, rosso 20. Il grigio (non misurato) è escluso, mai contato come 0.
- Media pesata sulle dimensioni misurate. Pesi predefiniti: delivery 25, version 15, security 30, coverage 15, governance 15.
- **I limiti (cap) mantengono il numero coerente con lo stato:** complessivo rosso → score ≤ 49; complessivo ambra → score ≤ 89; complessivo grigio (qualche dimensione richiesta sconosciuta, nessuna rossa o ambra) → anche score ≤ 89, così un progetto in parte illeggibile non si classifica mai insieme a quelli completamente sani (scelta mia). Un progetto rosso è quindi sempre sotto qualsiasi progetto ambra o grigio.
- Un progetto verde è sempre 100 (il verde richiede che ogni dimensione richiesta sia verde). È voluto (scelta mia): lo score separa i progetti che richiedono attenzione; quelli sani pareggiano in cima e sono ordinati per nome.
- **Non applicabile non è sconosciuto** (scelta mia): una dimensione che è grigia solo perché non c'è nulla da misurare (es. motivo di delivery `no-critical-workflows`) è esclusa sia da `measured` sia da `required`, quindi non abbassa la confidenza né spinge un progetto in "dati insufficienti". Grigio per qualsiasi altro motivo (non autorizzato, sconosciuto, raccolta fallita) conta come non misurato.
- **Confidenza:** dimensioni `measured / required`, mostrata accanto allo score ("misurate 4 su 5").
- **Dati insufficienti:** se è misurata meno della metà delle dimensioni richieste, nessun numero: il sito mostra "— dati insufficienti" e ordina questi progetti in un gruppo a parte, mai in fondo come se andassero bene.
- Arrotondato a intero.

Esito del mock (verifica di coerenza): Beta ≈ 38, Alpha ≈ 76, Platform ≈ 88, Gamma = dati insufficienti.

Configurazione: blocco opzionale `score` in `config/policies.yaml` (`weights`, `points`, `caps`, `minMeasuredRatio`) con i valori predefiniti sopra, così `schemaVersion` delle policy resta `1.0`. Lo schema dello snapshot passa a **1.3**: il riepilogo di progetto in `PortfolioIndex` e `ProjectSnapshot` ottengono `score: { value: number | null, measured: number, required: number }`. I documenti (EN + IT) descrivono la formula; la pagina "Come leggere" la mostra.

## 7. Pagine

Tutte le pagine: una frase o un blocco dominante in alto, poi la lista ordinata dal peggiore, dettaglio su richiesta. L'header mantiene navigazione, selettore del tema e cambio lingua. Mobile: le righe vanno a capo (nome + stato + score sulla prima riga, barre + motivo sulla seconda); nessuno scroll orizzontale della pagina; le tabelle che non possono andare a capo scorrono dentro il proprio contenitore.

**Portfolio.** Titolo + una frase ("3 progetti su 4 richiedono attenzione"), conteggi come pulsanti filtro (critical, attention, healthy, unknown). Filtri: ricerca, stato, business unit, ordinamento (score predefinito) in linea; ciclo di vita e severità sotto "Altri filtri". Colonne della lista: pallino di stato, progetto (link), score con confidenza al passaggio del mouse/testo secondario, cinque barre di dimensione con etichette una sola volta nell'intestazione e un nome accessibile per barra, motivo principale. Riga di progetto sconosciuto: pallino tratteggiato e barre tratteggiate, il motivo indica la causa ("2 errori di raccolta"), link a Data quality. Legenda su una riga sotto la lista con link a "Come leggere". Footer: raccolto il (UTC), "dati sintetici" quando è mock.

**Project.** Breadcrumb; intestazione con nome, pill di stato, score e confidenza, business unit, ciclo di vita, coordinatore; riquadro "Perché è <stato>" che elenca prima i motivi rossi come frasi con link; cinque card di dimensione (stato, riepilogo su una riga, link alla propria sezione); percorso degli ambienti DEV → UAT → PROD con versione e allineato/in ritardo; tabella dei componenti (versione e drift, CI, alert, simboli di copertura); sezioni comprimibili: Workflows, Security (alert critical e high elencati con link, gli altri come conteggi + "Apri in GitHub"), Copertura per controllo, Errori di raccolta.

**Security.** Frase di sintesi ("1 alert critical aperto · 3 controlli richiesti che non vediamo"); totali di severità del portfolio con una nota "conteggi incompleti" quando un progetto è in parte illeggibile; una card per progetto, dal peggiore: stato, copertura "2 su 4 richiesti", conteggi per severità, punti ciechi come chip espliciti, simboli dei controlli, link al progetto e a GitHub. Matrice di copertura del portfolio come sezione secondaria, compressa. Nessuna tabella completa degli alert.

**Versions (come nel mockup).** Frase di sintesi ("2 progetti hanno PROD in ritardo · 1 versione dichiarata non corrisponde"); una card per progetto, dal peggiore: versione del coordinatore e sua fonte, percorso degli ambienti, poi una tabella "Da verificare" solo per i problemi (manifest vs submodule vs ultima release, submodule non mappato con link al catalogo), ciascuno spiegato in una frase; componenti allineati compressi in una riga; i progetti completamente allineati sono una singola riga; i progetti sconosciuti una card tratteggiata con la causa.

**Workflows (come nel mockup).** Frase di sintesi; solo i workflow critici per il catalogo; per progetto, dal peggiore, solo le righe con problemi: pill di stato a larghezza fissa (failed, missing, stale, non visibile), nome e file del workflow, repository, cosa è successo con un link; i workflow riusciti compressi in un conteggio; i progetti tutti verdi su una singola riga. Una nota dichiara che il portale legge le esecuzioni e non le avvia mai.

**Data quality (come nel mockup).** Frase di sintesi; conteggi dei repository (nel catalogo, letti completamente, letti in parte, illeggibili); "Cosa non abbiamo potuto leggere, per causa" raggruppato per classificazione (403, 404 con la nota che un 404 può significare accesso mancante) con elenco di progetto, sorgente, repository, più come risolvere (concedere accesso in lettura); sorgenti obsolete con età; submodule non mappati con link al catalogo; capacità di raccolta come pill; dettagli dell'esecuzione compressi in fondo.

**Catalog (come nel mockup).** Stesso comportamento di oggi (modifica nella UI, proposta come pull request, il discovery propone soltanto, nulla viene salvato, nessuna chiamata a GitHub). Lista laterale dei progetti con badge di modifica in sospeso e "Nuovo progetto", repository scoperti con "Usa"; modulo con fieldset General, Project type (radio segmentati con aiuto), Components (righe con rimozione), Environments, Workflows, Security controls; un riquadro "Proposta" con pill di validazione, riepilogo delle modifiche e azioni, primaria "Proponi su GitHub" (accento), "Scarica YAML", "Annulla modifiche".

**Come leggere (nuova).** Significato degli stati, i cinque simboli, le distinzioni sconosciuto / non autorizzato / non configurato / non applicabile, la formula dello score e i cap, soglie riassunte da `policies.yaml`, link ai documenti. EN + IT, nella navigazione come link secondario (footer o utility dell'header).

## 8. Lasciato al builder

- Dettagli responsive che i mockup non mostrano (layout phone), entro le regole della sezione 7.
- Ritocco finale della luminosità dei token se il test di contrasto non concorda con i valori calcolati.
- Disegno delle icone per pallini di stato e simboli (SVG, tratto coerente).
- Suddivisione dei componenti (es. `ScoreBadge`, `DimensionBars`, `ControlSymbol`, `ReasonList`) e organizzazione del CSS.
- Se la confidenza dello score è un tooltip, testo secondario o entrambi (deve essere accessibile senza hover).

## 9. Verifica

- Unit: evaluator dello score (pesi, cap, esclusione del grigio, dati insufficienti, arrotondamento) con i progetti mock; test di contrasto esteso ai nuovi token e tinte in entrambi i temi; parità delle chiavi i18n.
- Snapshot golden rigenerati (schema 1.3); il test sullo schema non supportato continua a passare.
- Integrazione: la build contiene tutte le pagine inclusa "Come leggere"; scansione dei secret sull'output pulita.
- E2E (Playwright, desktop + mobile): filtri e ordinamento del Portfolio, resa della riga sconosciuta, apertura/chiusura delle sezioni della pagina Project, focus da tastiera.
- Giro di verifica in Claude Design: pagine compilate confrontate con il canvas approvato; commenti del proprietario risolti prima della release.
- Controlli di design: critique di impeccable sul Portfolio rispetto al 25/40 della v0.4.0; audit `web-design-guidelines`; screenshot a 375, 768, 1280 px in chiaro e scuro rivisti prima della release.
- Rigenerare `DESIGN.md` e `.impeccable/design.json` dalla build rilasciata; aggiornare il surface brief; README (EN + IT) e CHANGELOG.
- Fatto significa (scelta mia): critique di impeccable sul Portfolio ≥ 32/40 senza problemi P0/P1 aperti; audit `web-design-guidelines` senza rilievi di accessibilità o focus residui; suite di contrasto, unit, integrazione ed e2e verdi; screenshot rivisti dal proprietario.

## 10. Release

v0.5.0 da `feat/ui-redesign-v0.5.0` tramite pull request (il proprietario esegue il merge; il proprietario imposta eventuali secret). Dopo il merge, Claude crea la release GitHub `v0.5.0`, poi aggiorna lo SHA del reusable workflow e `hub-ref` in `.github/workflows/deploy-hub.yml` del repository di deploy privato (stesso flusso della v0.3.0) e verifica l'esecuzione del deploy e il redirect protetto da accesso. La v0.4.0 non è distribuita sul sito protetto (scelta del proprietario).
