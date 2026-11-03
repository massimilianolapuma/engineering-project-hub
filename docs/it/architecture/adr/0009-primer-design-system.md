# ADR 0009: GitHub Primer come design system (token e Octicons, senza React, senza mai spacciarsi per GitHub)

- **Stato:** Accettata
- **Data:** 2026-11-03
- **Versione inglese:** [docs/architecture/adr/0009-primer-design-system.md](../../../architecture/adr/0009-primer-design-system.md)

## Contesto

L'hub copre un vuoto di GitHub: nessuna dashboard pubblicata da GitHub, e nessuna GitHub App, offre
una vista per progetto di delivery, versioni, sicurezza e controlli su molti repository (le GitHub
App forniscono autenticazione e accesso alle API, non un'interfaccia). Fino alla v0.9.0 l'hub aveva
un aspetto proprio, "Warm Graphite" (font IBM Plex, neutri caldi, tinte oklch). Il 2026-11-02 il
responsabile ha deciso che l'hub deve sembrare GitHub (colori, icone, struttura), così chi lavora in
GitHub lo legge come un'estensione naturale degli strumenti che usa già. Non deve fingersi GitHub.

Il sito è Astro statico con una CSP rigida (`script-src 'self'`, niente CDN, niente web font) e ogni
pagina è generata lato server ([ADR 0001](0001-static-first-github-native.md)). Il login resta fuori
dal sito: oggi Cloudflare Access con login GitHub, le Pages private / SSO di GitHub quando l'hub
passerà in un'organizzazione aziendale.

## Decisione

1. **Token Primer, non una libreria UI Primer.** `@primer/primitives` (11.10.0, versione esatta)
   fornisce le variabili CSS: colori funzionali, dimensioni, raggi e tipografia. I componenti usano
   direttamente i token funzionali (`--fgColor-*`, `--bgColor-*`, `--borderColor-*`, `--base-size-*`,
   `--borderRadius-*`). Niente React, niente Primer React, niente `@primer/css`: i componenti Astro
   dell'hub prendono l'aspetto Primer (Box, Label, Button, UnderlineNav, Flash, FormControl) dal
   proprio CSS.
2. **Octicons, generate in fase di build.** `@primer/octicons` (19.40.0) tramite un piccolo helper
   `octiconSvg()` e un componente `Octicon.astro`: nessun codice di icone nel browser. Ogni insieme di
   simboli passa alle Octicons con forme distinte (simboli dei controlli, icone di stato, navigazione,
   link esterni).
3. **Modalità colore Primer.** `<html data-color-mode data-light-theme data-dark-theme>` sostituisce
   il `data-theme` dell'hub; la preferenza salvata mantiene la chiave `eph-theme`, quindi una scelta
   fatta prima dell'aggiornamento resta valida.
4. **Font di sistema.** Lo stack di sistema di Primer; IBM Plex è rimosso e non si scarica nulla.
5. **Le regole di significato dell'hub restano.** Sconosciuto non è mai zero (nessun riempimento,
   contorno tratteggiato, testo attenuato); lo stato non è mai affidato al solo colore; la severità
   porta sempre la parola; il punteggio, la sua confidenza e i grafici mantengono dati e regole.
6. **Mai spacciarsi per GitHub.** Niente Octocat né marchio GitHub, niente "GitHub" come nome del
   prodotto, niente "ufficiale". Il marchio è l'Octicon `stack` e il piè di pagina dice "Non affiliato
   a GitHub · realizzato con Primer".
7. **Identità opzionale.** Le build dietro Cloudflare Access possono mostrare le iniziali
   dell'utente collegato (`PUBLIC_IDENTITY_SOURCE=cloudflare-access`); le build per GitHub Pages non
   hanno lo spazio né fanno la richiesta.

## Alternative considerate

- **Primer React.** Scartata: aggiungerebbe React e hydration a un sito statico che non spedisce
  quasi JavaScript, in conflitto con la CSP e con le pagine generate lato server.
- **`@primer/css`.** Scartata: in manutenzione, un foglio di stile globale ampio i cui nomi di classe
  collidono con gli agganci testati dell'hub.
- **Tenere Warm Graphite.** Scartata dal responsabile: l'hub deve sembrare parte di GitHub.
- **Una GitHub App con una propria interfaccia.** Non possibile: una GitHub App non ha uno spazio di
  interfaccia dentro GitHub; le pagine dell'hub servono comunque.

## Conseguenze

- Warm Graphite è ritirato nella v0.10.0; token e font non ci sono più e un test fallisce su
  qualsiasi token legacy, colore letterale o vecchio selettore di tema sotto `src/`.
- Il contrasto è verificato sui valori di Primer in entrambi i temi (WCAG AA per il testo, 3:1 per i
  segni grafici); non è servita alcuna sostituzione.
- Aggiornare Primer significa rieseguire il test di contrasto; un token rinominato fa fallire la
  build subito.
- Il lavoro successivo sull'interfaccia (provider della supply chain, v0.11.0) nasce direttamente in
  Primer.
- La struttura delle pagine non è ancora ripensata: la fase 2 la rivedrà dopo che il responsabile
  avrà provato il restyle al lavoro. Spostare il login sulle Pages private / SSO di GitHub è un
  progetto separato.
