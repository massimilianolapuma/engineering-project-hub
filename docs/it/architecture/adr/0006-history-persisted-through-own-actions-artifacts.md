# ADR 0006: Storico conservato tramite gli artifact Actions del repository stesso

- **Stato:** Accettata
- **Data:** 2026-10-21
- **Versione inglese:** [docs/architecture/adr/0006-history-persisted-through-own-actions-artifacts.md](../../../architecture/adr/0006-history-persisted-through-own-actions-artifacts.md)

## Contesto

Il proprietario vuole vedere se ogni progetto sta migliorando: un andamento del punteggio,
una striscia di stato per progetto, una pagina "Cosa è cambiato dall'ultima raccolta" ed
esportazioni CSV. Servono le raccolte precedenti, ma il portale è statico e senza backend
([ADR 0001](0001-static-first-github-native.md)), e il runner di Actions parte vuoto a ogni
esecuzione. Lo snapshot viene sostituito a ogni raccolta e il suo schema cambia di tanto in
tanto ([ADR 0002](0002-snapshot-contract-and-provider-abstraction.md)), quindi lo storico
non può stare al suo interno.

## Decisione

1. **Due nuovi file pubblicati, con versione propria (D1).** `history.json`
   (`kind: hub-history`, schema `1.0`) e `changes.json` (`kind: hub-changes`, `1.0`) stanno
   accanto allo snapshot, che resta `1.4`. Lo storico sopravvive ai cambi di schema dello
   snapshot e un `public/data` esistente resta leggibile.
2. **Un artifact `hub-history` dedicato (D2).** Solo `history.json`, conservazione di 90
   giorni, caricato solo con `data-source: github` (più a lungo dei 14 giorni di
   `snapshots`). Un'esecuzione mock manuale non può mai rompere la catena reale.
3. **Ripristino con un piccolo script Node (D3).** `npm run history:restore` elenca gli
   artifact `hub-history` del **proprio** repository con `GITHUB_TOKEN` e `actions: read`
   sul job `collect` (mai con le credenziali del collector), accetta solo il branch
   predefinito, questo repository (non un fork), un'altra esecuzione, al massimo 5 MiB e
   un'esecuzione del workflow di deploy o di raccolta con un evento consentito, e legge lo
   zip con il lettore esistente a dimensione limitata. Il collector tratta poi il file come
   input non attendibile: lettura strict (limite 8 MiB), link ricontrollati con l'allowlist
   corrente, testo ripulito di nuovo, output controllato dal gate.
4. **Il mock non ripristina mai (D4).** Un'esecuzione mock parte sempre dal
   `fixtures/history/history.json` sintetico; uno storico scritto dall'altra fonte dati
   viene scartato (`source-changed`). Storico mock e reale non si incontrano mai e i file
   golden restano deterministici.
5. **Limitato e confrontato nel collector (D5, D6, D7, D12).** La retention è una policy
   (`history.maxEntries` 120, `history.maxAgeDays` 90). Il collector calcola
   `changes.json`, confrontando gli alert per coppia (repository, fonte) solo quando la
   coppia era leggibile in entrambe le raccolte, così una fonte illeggibile non risulta mai
   risolta. Le voci conservano solo i progetti presenti nel catalogo corrente.
6. **Uno storico nuovo non è mai "nessun cambiamento".** Ogni stato diverso da un vero
   confronto (`none`, `restore-failed`, `unreadable`, `incompatible`, `source-changed`)
   viene scritto nei file e spiegato nella pagina. Uno storico mancante o non valido non fa
   mai fallire la build del sito (D11).
7. **Raccolte serializzate.** Il job `collect` gira nel gruppo di concorrenza
   `hub-collect` senza annullare, così due esecuzioni non ripristinano mai la stessa base.

## Alternative considerate

- **Un branch o un commit git nel repository.** Scartata: richiede `contents: write`, che
  rompe il modello in sola lettura e a privilegio minimo, e sporca la cronologia del
  repository.
- **La cache di GitHub Actions.** Scartata: può essere eliminata dopo 7 giorni di mancato
  uso, è legata a un branch e non è pensata per conservare stato.
- **Un archivio esterno (bucket, database).** Scartata: nuova infrastruttura o dipendenza
  commerciale per un portale statico e GitHub-native.
- **Lo storico dentro lo snapshot.** Scartata: si perde a ogni cambio di schema dello
  snapshot, e lo snapshot viene sostituito a ogni esecuzione.

## Conseguenze

- Positive:
  - nessun nuovo secret, servizio o permesso di scrittura; l'unica nuova chiamata è una
    `GET` sul repository stesso;
  - lo storico sopravvive ai cambi di schema dello snapshot e funziona con dati mock e senza
    credenziali;
  - un artifact piantato non può arrivare al sito: controlli di provenienza, dimensione,
    schema e sanitizzazione, e ogni errore fa semplicemente ripartire da zero.
- Negative:
  - fino a 90 giorni senza esecuzioni perdono la catena e lo storico riparte;
  - eliminare o far scadere l'artifact azzera lo storico (è anche l'azzeramento
    documentato);
  - `collect` richiede `actions: read` (solo sul proprio repository) e le raccolte sono
    serializzate;
  - la prima raccolta dopo l'aggiornamento non ha nulla con cui confrontarsi.
