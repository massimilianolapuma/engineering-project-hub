# ADR 0008: Risk governance come policy-as-code tipizzata: eccezioni in configurazione rivista, mai dismiss su GitHub, niente OPA

- **Stato:** Accettata
- **Data:** 2026-10-21
- **Versione inglese:** [docs/architecture/adr/0008-risk-governance-policy-as-code.md](../../../architecture/adr/0008-risk-governance-policy-as-code.md)

## Contesto

Il responsabile vuole accettare rischi noti senza nasconderli, vedere quali alert sono in ritardo
rispetto a un obiettivo di remediation e verificare una modifica alle policy prima che arrivi a una
raccolta. L'hub è in sola lettura ([ADR 0001](0001-static-first-github-native.md)), le policy sono
YAML tipizzati guidati da Zod ([ADR 0004](0004-configuration-store-and-discovery.md)) e un progetto non
deve diventare rosso dall'oggi al domani perché è comparsa una regola nuova
([ADR 0007](0007-repository-controls-informative-by-default.md)).

## Decisione

1. **Le eccezioni stanno in configurazione rivista, mai in dismiss su GitHub.**
   `config/exceptions.yaml` (opzionale) contiene accettazioni con responsabile, motivo e durata
   limitata. L'hub non scrive nulla su GitHub: l'alert resta aperto lì. Un finding con eccezione
   mantiene `status: open`; un solo helper, `countsAsOpen`, decide cosa viene contato, così lo storico
   non vede mai un alert "risolto" finto.
2. **Scadenza obbligatoria.** `expires - created` è limitato da `exceptions.maxDays` (180). Un'eccezione
   scaduta riporta i suoi finding nei conteggi e per default aggiunge un motivo ambra a Sicurezza.
3. **Selettori stretti.** `alert` per ogni sorgente; `rule` (con `tool` opzionale) per il code
   scanning; `advisory` per Dependabot. Il secret scanning accetta solo `alert`.
4. **Sconosciuto non significa accettato.** Un'eccezione su una fonte non leggibile è `non verificabile`
   e non accetta nulla. Un'eccezione obsoleta (nessun alert aperto corrisponde) viene segnalata.
5. **SLA di remediation dalla data di creazione dell'alert.** Giorni per classe (critical 7, high 30,
   medium 90, low 180, secret 7). Un'eccezione attiva mette in pausa il ritardo ma non azzera mai
   l'orologio. Un'età sconosciuta non è mai "nello SLA".
6. **Mai rosso per default.** Ogni livello di ritardo vale `info` per default. La demo lo attiva per
   critical e high e lo dice in un commento.
7. **Policy-as-code in TypeScript.** Zod è il validatore, lo JSON Schema è generato da esso e un test li
   tiene allineati. `npm run policy:check` valida, spiega ogni decisione con la chiave di policy dietro
   ogni motivo, esegue casi di decisione con i motori reali e può rivalutare uno snapshot in sola lettura.
   Un job CI `policy-check` lo esegue a ogni pull request.
8. **Dati nascosti.** Per i repository non pubblici con audience pubblica, regola o advisory, tool, motivo
   e ticket sono pubblicati come `null`.
9. **Schema 1.6, storico 1.2.** Lo snapshot aggiunge le eccezioni, `exception` e `sla` dei finding e i
   riepiloghi di rischio; lo storico aggiunge conteggi `risk` opzionali; `changes.json` aggiunge
   `newlyOverdue` ed `expiredExceptions` (additivi, ancora `1.0`).

## Perché non OPA / Rego

- **Peso.** OPA è un binario Go separato (decine di MB), oppure una build WASM più un passo di
  compilazione Rego in CI. Entrambi aggiungono superficie di supply chain e una toolchain a un progetto
  che oggi non ne ha.
- **Due linguaggi.** Le regole di salute sono già TypeScript tipizzato guidato da un YAML validato con
  Zod. Rego le duplicherebbe, o costringerebbe a riscrivere ogni valutatore senza nuove capacità.
- **Ciò che OPA darebbe** (validazione degli schemi, test di decisione, spiegazioni) è coperto da Zod,
  dallo JSON Schema generato, dai casi di decisione e dalle spiegazioni motivo → chiave di policy.
- **Da rivedere quando** le policy richiederanno logica arbitraria scritta dal responsabile, per
  esempio condizioni tra dimensioni per business unit. Sarebbe una nuova ADR.

## Alternative considerate

- **Fare dismiss degli alert su GitHub.** Scartata: richiede un permesso di scrittura, perde
  responsabile, motivo e scadenza e fa vedere allo storico un alert "risolto".
- **Eccezioni senza scadenza.** Scartata: le accettazioni del rischio vanno riviste.
- **Orologio dello SLA dalla prima volta che l'hub ha visto l'alert.** Scartata: sbagliato per alert più
  vecchi e richiede uno storico che potrebbe non esistere.
- **Ritardo vincolante per default.** Scartata: i progetti cambierebbero stato all'aggiornamento.

## Conseguenze

- I finding accettati sono visibili (in un elenco a parte, con responsabile, motivo e scadenza) ma escono
  dai conteggi e dallo stato finché l'eccezione non scade.
- Un'eccezione ampia per `rule` o `advisory` può accettare alert futuri: il limite di durata, la colonna
  "Corrispondenze" e il `tool` opzionale lo limitano.
- Il file delle eccezioni dice cosa un team accetta: quelle reali vanno in un repository di
  configurazione privato.
- L'aggiornamento dallo snapshot 1.5 richiede una nuova raccolta; lo storico 1.0 e 1.1 viene ancora letto.
