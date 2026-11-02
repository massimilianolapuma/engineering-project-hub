# Restyling Primer — l'hub sembra una parte di GitHub

English: [../../../superpowers/specs/2026-11-02-primer-restyle-design.md](../../../superpowers/specs/2026-11-02-primer-restyle-design.md)

Stato: approvato dal titolare il 2026-11-03 · Data: 2026-11-02 · Release prevista: v0.10.0 (rilasciata prima del lavoro supply chain)

## 1. Intento e motivazione

L'hub copre i vuoti della reportistica di GitHub: salute del portfolio per progetto logico, versioni tra ambienti, copertura dei controlli che GitHub non vede, evidenze di supply chain. Una verifica di quanto pubblica GitHub (metriche Copilot e Security overview integrate, le action OSPO in `github-community-projects`, `org-metrics-dashboard`) non ha trovato nulla che copra questo perimetro, quindi l'hub resta.

Il titolare vuole che chi apre l'hub accanto a una tab di GitHub percepisca lo stesso prodotto: stesso stile, colori, icone e struttura delle pagine, come un'estensione naturale di GitHub. La strada è il design system aperto di GitHub, **Primer** (MIT): i suoi design token (`@primer/primitives`) e le icone (Octicons).

Questa è la **fase 1: un restyling**. Contenuti, pagine, dati e regole restano come oggi. Il titolare proverà l'hub ristilizzato in azienda e solo dopo si rimetteranno in discussione struttura e contenuti (fase 2).

I principi di `PRODUCT.md` non cambiano: sconosciuto non è mai zero, lo stato complessivo è sempre spiegato dalle sue dimensioni, il rischio reale è la cosa più visibile, sola lettura, static-first.

## 2. Obiettivi, non-obiettivi, anti-obiettivi

Obiettivi

- Ogni pagina sembra una pagina GitHub: colori Primer in chiaro e scuro, font di sistema di GitHub, Octicons, header stile GitHub con navigazione a tab sottolineate, box con bordi, righe stile elenco Issues, badge Label e Counter, bottoni GitHub.
- Warm Graphite sostituito del tutto: `tokens.css` ricostruito sui token Primer, `global.css` e ogni componente li usano, IBM Plex rimosso.
- Il **punteggio Portfolio** (0–100, tetti, affidabilità, dati insufficienti) e **tutti i grafici** (sparkline, barre per dimensione, strip di stato, trend, coverage meter) restano con gli stessi dati e significato; cambia solo l'aspetto.
- WCAG 2.2 AA in chiaro e scuro; lo stato mai affidato al solo colore (simbolo o etichetta sempre presenti).
- La UI funziona allo stesso modo con qualsiasi hosting (oggi Cloudflare Pages + Access, poi GitHub Pages privato).

Non-obiettivi (fase 1)

- Nessuna modifica a pagine, sezioni, ordine, testi, dati, schema dello snapshot o collector. La ristrutturazione è la fase 2, dopo le osservazioni del titolare.
- Nessuna modifica al login. Il passaggio da Cloudflare Access a GitHub Pages con visibilità privata (GitHub Enterprise Cloud: appartenenza all'org + SAML SSO, niente Cloudflare, niente OAuth App) è un progetto separato, da fare quando l'hub entra nell'organizzazione aziendale.
- Nessun tema Primer aggiuntivo (dimmed, alto contrasto, daltonici) in fase 1: solo chiaro e scuro.
- Niente React, niente Primer React, niente `@primer/css`.

Anti-obiettivi (fallimento anche se "funziona")

- **Spacciarsi per GitHub.** L'hub somiglia a GitHub ma non dichiara mai di esserlo: niente Octocat o logo GitHub, niente "GitHub" come nome del prodotto, niente "ufficiale". L'hub tiene il suo nome con un'Octicon come marchio. Una pagina che imita GitHub è un rischio di marchio e di phishing.
- Sconosciuto mostrato come zero, come sano o più tranquillo di una lacuna opzionale (il trattamento tratteggiato di "sconosciuto" sopravvive al restyling).
- Un punteggio che cambia valore o significato a causa del restyling.
- Il colore come unico portatore dello stato.
- Un aspetto migrato a metà: tinte Warm Graphite, IBM Plex o vecchie icone rimaste su qualche pagina.

## 3. Vincoli (dalle regole del progetto)

- Sito Astro statico, nessun backend runtime, nessuna chiamata alle API GitHub e nessun token nel browser, sola lettura.
- Nessun servizio esterno a runtime. La CSP resta come in `src/layouts/Base.astro` e `public/_headers` (`script-src 'self'`, `img-src 'self' data:`, `font-src 'self'`, `connect-src 'self'`). Token Primer e Octicons sono inclusi al build; il font di sistema non richiede file di font.
- Bilingue EN (default `/`) e IT (`/it/`): ogni nuova stringa in `src/i18n/en.ts` e `it.ts` (test di parità delle chiavi), ogni documento in EN e IT.
- Solo dati mock nel repo pubblico; nessun nome reale di aziende; il dominio dell'hosting protetto non viene citato.
- La scansione segreti sull'output resta verde (evitare stringhe UI della forma `secret: …`).
- Dipendenze fissate a versioni esatte, come il resto di `package.json`.

## 4. Decisioni prese con il titolare

1. **Primer sostituisce Warm Graphite** come design system (titolare, 2026-11-02).
2. **Tenere il punteggio Portfolio e i grafici**; tutto il resto è in discussione, ma solo a restyling finito e provato in azienda (titolare).
3. **Login:** Cloudflare Access con login GitHub resta finché l'hub è un progetto personale; sarà sostituito dal metodo ufficiale GitHub nell'organizzazione aziendale (titolare). La fase 1 non deve dipendere da Cloudflare.
4. **Design-first in Claude Design** (regola stabile del titolare): design system Primer e mockup delle pagine in Claude Design, revisione del titolare, poi codice. I link Claude Design sono privati e non vengono committati.
5. **Prima il restyling** (titolare, 2026-11-02): il restyling parte da `main` (pagine v0.9.0) e viene rilasciato prima della parte sito del lavoro supply chain. La UI supply chain (Task 9 di `docs/superpowers/plans/2026-10-21-supply-chain-providers.md`) viene poi costruita direttamente in Primer, con i mockup nel design system Primer; per essa non si fanno artboard Warm Graphite.
6. **Skill** (confermate dal titolare): Claude Design, `impeccable`, `ui-ux-pro-max:design-system`, `dataviz`, `color-expert`, `web-design-guidelines`, `design:accessibility-review`. `frontend-design` esclusa (spinge verso uno stile distintivo, l'opposto di somigliare a GitHub).

## 5. Sistema visivo — Primer

### 5.1 Pacchetti (mia scelta)

- `@primer/primitives` (versione esatta): importare da `src/styles/tokens.css` i file CSS dei token necessari (temi colore funzionali chiaro e scuro, dimensioni, tipografia). I componenti usano direttamente i token funzionali Primer (`--fgColor-default`, `--bgColor-muted`, `--borderColor-default`, …).
- `@primer/octicons` (versione esatta, il pacchetto SVG semplice): un componente `Octicon.astro` produce l'SVG al build. Nessun JS a runtime.
- Rimuovere `@fontsource/ibm-plex-sans` e `@fontsource/ibm-plex-mono`.

### 5.2 Tema

Il meccanismo Primer sostituisce `[data-theme]`: `data-color-mode="auto|light|dark"` con `data-light-theme="light"` e `data-dark-theme="dark"` su `<html>`. Il selettore di tema esistente (auto / chiaro / scuro) e `public/theme-init.js` mantengono comportamento e memorizzazione, ora scrivendo `data-color-mode`. I meta `theme-color` seguono lo sfondo pagina di Primer.

### 5.3 Mappatura dei token (mia scelta; i mockup Claude Design possono rifinirla)

| Ruolo nell'hub                                        | Token Primer                                                                                                                                        |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sfondo pagina / sfondo box / aree incassate           | `--bgColor-default` / `--bgColor-default` / `--bgColor-muted`                                                                                       |
| Bordi / bordi forti dei controlli                     | `--borderColor-default` / `--borderColor-emphasis`                                                                                                  |
| Testo / testo secondario                              | `--fgColor-default` / `--fgColor-muted`                                                                                                             |
| Link, anello di focus, sottolineatura tab selezionata | `--fgColor-accent`, `--focus-outlineColor`, `--underlineNav-borderColor-active`                                                                     |
| Azione primaria (es. "Proponi su GitHub")             | bottone primario Primer (verde), come su GitHub                                                                                                     |
| Critico / attenzione / sano                           | famiglie `danger` / `attention` / `success` (`--fgColor-*`, `--bgColor-*-muted`, `--bgColor-*-emphasis`, `--borderColor-*-emphasis`)                |
| Sconosciuto                                           | nessun riempimento, contorno tratteggiato `--borderColor-emphasis`, testo `--fgColor-muted` (distinto da ogni stato)                                |
| Severità critica / alta / media / bassa               | Label `danger` / `severe` / `attention` / neutra, sempre con la parola                                                                              |
| Grafici, serie categoriali                            | token data-visualisation di Primer (`--data-<colore>-color-emphasis` / `-muted`); i segni che codificano uno stato usano le famiglie di stato sopra |

Il bottone primario verde mentre anche "sano" è verde segue GitHub; è accettabile perché lo stato porta sempre un simbolo o un'etichetta.

I nomi esatti dei token si verificano sulla versione fissata di `@primer/primitives`; dove un nome differisce, chi costruisce sceglie il token funzionale più vicino e lo registra in `DESIGN.md`.

### 5.4 Tipografia e forma

- Font: stack Primer `--fontStack-system` e `--fontStack-monospace`. Corpo 14px, interlinea come Primer; monospace per codice, nomi di repository e versioni (come oggi). Cifre tabulari per punteggi e conteggi.
- Raggi, spaziature e bordi dai token di dimensione Primer (raggio 6px su box e bottoni, pill pieni). Nessuna ombra tranne quelle overlay di Primer sui menu.
- Larghezza contenuto: container large di GitHub (max 1280px) con i margini di GitHub.

### 5.5 Icone

Ogni icona e simbolo di stato diventa un'Octicon con nome accessibile. I sei simboli di copertura mantengono il significato; mappatura proposta (i mockup confermano): abilitato `check-circle`, richiesto ma non configurato `alert`, scansione vecchia `clock`, non visibile `question`, scansione fallita `x-circle`, non applicabile `dash`. Le altre icone seguono l'uso GitHub (repo, workflow, shield, package, git-branch, rocket per i deploy).

**Tutti i set di simboli passano a Octicons, non solo la copertura** (mia scelta): i segni dei controlli di repository (`RepositoryControlsSection.astro`), il segno di dato vecchio in `QualitySection.astro`, tutti i set in `src/lib/symbols.ts`, e più avanti i simboli di evidenza supply chain (verificato, presente, mancante/fallito, sconosciuto, non applicabile), che seguiranno le stesse regole quando verrà costruito il Task 9. Regole: all'interno di un set ogni significato ha una **forma distinta**, non solo un colore distinto (es. verificato `verified` vs presente `dot-fill`); sconosciuto mantiene il tratteggio; ogni simbolo mantiene il testo nascosto per i lettori di schermo. I test che verificano i caratteri dei glifi (es. `⧖` in `tests/integration/site.test.ts`) vengono riscritti per verificare il nome accessibile o un attributo `data-symbol`, non il glifo.

## 6. Cornice delle pagine e componenti

### 6.1 Cornice (conta come aspetto, non struttura: nessuna pagina si sposta)

- **Header** come quello attuale di github.com, in entrambi i temi: marchio Octicon dell'hub + "Engineering Project Hub" a sinistra; a destra "Come leggere", selettore di tema, cambio lingua e lo spazio identità opzionale (6.3).
- **Navigazione a tab sottolineate** sotto l'header, come le tab di un repository: le voci attuali nell'ordine di oggi, ciascuna con un'Octicon. **Nessun Counter sulle tab in fase 1** (mia scelta): scegliere un numero per tab è una decisione di contenuto, rimandata alla fase 2. La pagina corrente ha la sottolineatura attiva. Mobile: la riga di tab scorre in orizzontale, come su GitHub.
- **La barra di run e il banner di dato vecchio restano** con stesso contenuto e visibilità (mia scelta: spostarli sarebbe un cambio di contenuto e nasconderebbe il rischio): fonte dati (sintetica se mock), ultimo run come tempo relativo con stato "vecchio", modalità di autenticazione. Stanno subito sotto la navigazione a tab, nello stile di una riga subhead GitHub con Label; il banner diventa un Flash Primer (warning) mantenendo `role="status"`.
- **Footer** come su GitHub: link come oggi e una riga breve "Non affiliato a GitHub · realizzato con Primer" (EN/IT). Non ripete la barra di run.

### 6.2 Componenti (stesse props e comportamento, nuovo aspetto)

| Oggi                                                                         | Diventa                                                                                                                                      |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Card, sezioni, tabelle                                                       | Box Primer: riga di intestazione, righe separate da bordi, righe stile elenco Issues per le liste di progetti                                |
| `Pill`, `StatusBadge`, `RiskPill`                                            | Label Primer (varianti di stato), Label di severità                                                                                          |
| Conteggi                                                                     | Counter Primer                                                                                                                               |
| Bottoni e bottoni filtro                                                     | Button Primer (default, primary, invisible) e gruppo filtri in stile SegmentedControl                                                        |
| Sezioni comprimibili                                                         | `<details>` nello stile Details/Box di Primer                                                                                                |
| Breadcrumb                                                                   | Breadcrumbs Primer                                                                                                                           |
| Percorso ambienti DEV → UAT → PROD                                           | step orizzontali in stile Timeline Primer (decidono i mockup)                                                                                |
| `ScoreBadge`                                                                 | stesso valore e regole, stile Label/Counter Primer, affidabilità come testo secondario                                                       |
| `DimensionBars`, `Sparkline`, `StatusStrip`, `TrendSection`, `CoverageMeter` | stesse forme SVG e dati; colori da 5.3; griglie e assi in `--borderColor-muted` / `--fgColor-muted`; aspetto ProgressBar Primer per le barre |
| `StatusDot`, `StatusIcon`, `ControlSymbol`                                   | Octicons (5.5) con colore di stato, nome accessibile invariato                                                                               |
| Form del catalogo                                                            | aspetto FormControl Primer (etichette, input, select, gruppi radio, messaggi di validazione)                                                 |

### 6.3 Spazio identità opzionale (mia scelta)

Quando l'hosting espone l'utente autenticato, l'header ne mostra il nome (con le iniziali in un cerchio), nella posizione dell'avatar di GitHub. Si abilita al build con un'impostazione pubblica (es. `PUBLIC_IDENTITY_SOURCE=cloudflare-access`), spenta di default (demo pubblica, GitHub Pages). Con Cloudflare Access un piccolo script same-origin legge `/cdn-cgi/access/get-identity` (consentito da `connect-src 'self'`). Nessuna immagine avatar: gli avatar GitHub sono cross-origin e la CSP resta `img-src 'self' data:`. Se la chiamata fallisce o l'impostazione è spenta, lo spazio resta vuoto e nulla si rompe. Con il futuro hosting GitHub Pages privato non esiste un'API di identità, quindi lo spazio resta vuoto.

## 7. Processo e consegne

1. **Claude Design** — creare un design system "Primer (hub)" dai valori chiaro e scuro di `@primer/primitives` e dall'elenco componenti di 6.2; archiviare Warm Graphite come storico. Canvas di mockup: tutte le 9 pagine (Portfolio, Progetto, Sicurezza, Versioni, Workflow, Modifiche, Qualità dei dati, Catalogo, Come leggere) in chiaro, più Portfolio e Progetto in scuro e Portfolio a larghezza telefono. Revisione e approvazione del titolare prima di qualsiasi codice.
2. **Build** — token, cornice, componenti, pagine, nell'ordine Portfolio + Progetto → Sicurezza → Versioni → Workflow → Modifiche → Qualità dei dati → Catalogo → Come leggere.
3. **Test** — riscrivere `tests/unit/tokens-contrast.test.ts` per Primer: risolve i valori Primer usati dall'hub (chiaro e scuro) e verifica testo 4.5:1, grafica e contorno "sconosciuto" 3:1. I test unit, integration ed e2e esistenti restano verdi; selettori e2e aggiornati solo dove cambia il markup. Verifica visiva con Playwright in entrambi i temi e a larghezza telefono.
4. **Revisione** — `web-design-guidelines` e `design:accessibility-review` sulle pagine costruite; critique `impeccable` rispetto ai mockup approvati.
5. **Documentazione** — `DESIGN.md` rigenerato dalla build rilasciata (impeccable documenter); ADR 0009 "Primer come design system" (EN + IT); README e CHANGELOG; "Come leggere" aggiornato con i nuovi simboli. Dopo ogni correzione UI, aggiornare anche il canvas Claude Design e il README del DS (regola stabile del titolare).
6. **Release** — v0.10.0; il titolare la prova in azienda e raccoglie osservazioni per la fase 2.

### 7.1 Sequenza con il lavoro supply chain (mia scelta, a seguito della decisione 5)

- Il restyling prende la versione **v0.10.0** e il primo numero ADR libero al momento del merge (**0009**). Il lavoro supply chain passa a **v0.11.0** e gli ADR del suo piano diventano 0010 e 0011. Quando `feat/supply-chain-providers` viene ribasato sul `main` ristilizzato, piano e spec vengono aggiornati per nuova versione, numeri ADR e "token Primer" al posto di "token Warm Graphite" nel Task 9.
- I commit solo-collector già presenti su `feat/supply-chain-providers` non toccano il sito e non sono impattati.

## 8. Lasciato a chi costruisce

- Nomi esatti dei token Primer per ruolo, entro la mappatura di 5.3, registrati in `DESIGN.md`.
- Quale Octicon per ogni voce di navigazione e icona non di stato.
- Come importare i file CSS Primer (solo i temi e i file di dimensione necessari, per tenere piccolo il CSS).
- Se dividere `global.css` per componente; nomi delle classi.
- Breakpoint responsive esatti, seguendo quelli di Primer.

## 9. Seguiti (fuori da questo progetto)

- **Supply chain v0.11.0**: rebase, poi Task 9 costruito in Primer (7.1).
- **Fase 2 — struttura e contenuti**, dalle osservazioni del titolare in azienda. Punteggio e grafici restano.
- **Migrazione del login** a GitHub Pages con visibilità privata nell'organizzazione aziendale (GitHub Enterprise Cloud, SAML SSO).
- **GitHub App** resta l'identità del collector; spostarla nell'organizzazione aziendale fa parte della migrazione del login.
- Temi Primer aggiuntivi (dimmed, alto contrasto, daltonici) se richiesti.
