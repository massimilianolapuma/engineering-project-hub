# ADR 0001: Architettura static-first e GitHub-native

- **Stato:** Accettato
- **Data:** 2026-10-03
- **English version:** [docs/architecture/adr/0001-static-first-github-native.md](../../../architecture/adr/0001-static-first-github-native.md)

## Contesto

Serve una vista a livello di progetto che copra molti repository GitHub. Vincoli:

- nessuna infrastruttura permanente e nessun database;
- tutto ospitato ed eseguito su GitHub;
- nessuna credenziale nel browser;
- i dati di sicurezza devono essere mostrati senza far trapelare dettagli sensibili.

## Decisione

- Un **collector TypeScript** viene eseguito in **GitHub Actions** a intervalli
  pianificati. Legge la REST API di GitHub con credenziali in sola lettura e scrive
  **snapshot JSON sanitizzati**.
- Una **build statica Astro** genera ogni pagina a partire da quegli snapshot in fase di
  build. La build viene pubblicata su **GitHub Pages**.
- Il browser **non chiama mai l'API di GitHub**. Il JavaScript lato client è limitato a
  filtri, tempi relativi e cambio di tema, e la CSP vieta gli script inline e di terze
  parti.
- Catalogo e policy sono **YAML nel repository**, validati con Zod. La discovery tramite
  topic o custom properties è rimandata a una fase successiva.
- La modalità mock (fixture sintetiche) è quella predefinita, così il sito funziona senza
  credenziali.

## Alternative considerate

- **SPA che chiama l'API di GitHub con un token utente.** Scartata: i token risiederebbero
  nel browser, ogni utente avrebbe bisogno di permessi su ogni repository e i rate limit si
  applicherebbero per utente.
- **Portale server o in stile Backstage con database.** Scartato per l'MVP: richiede
  infrastruttura permanente, autenticazione e attività operative. Potrebbe arrivare in
  seguito.
- **GitHub Projects o dashboard di organizzazione.** Scartati: non sono in grado di
  modellare un coordinator con submodule, il drift di versione o la copertura come
  dimensioni separate.

## Conseguenze

- Positive: nessuna superficie di attacco a runtime, costi di esercizio contenuti,
  verificabilità (gli snapshot sono artifact) e dati identici per ogni utente.
- Negative: i dati sono aggiornati solo quanto lo consente la pianificazione (6 h per
  impostazione predefinita) e all'interno del sito non c'è autorizzazione per utente. La
  visibilità segue il pubblico di Pages; ciò è mitigato da `publication.audience` e
  documentato in [security.md](../../security.md).
- Mitigazione per l'aggiornamento dei dati: gli indicatori di dato non aggiornato sono
  calcolati nel browser.
