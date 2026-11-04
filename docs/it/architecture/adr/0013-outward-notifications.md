# ADR 0013: Notifiche verso l'esterno da un job separato, dry-run di default, riepilogo senza dettagli dei repository

- **Stato:** Accettata
- **Data:** 2026-11-04
- **Versione inglese:** [docs/architecture/adr/0013-outward-notifications.md](../../../architecture/adr/0013-outward-notifications.md)

## Contesto

Fino alla v0.14.0 l'hub si limitava a leggere: raccoglieva da GitHub e dai provider facoltativi e
pubblicava un sito statico e dei file. I team hanno chiesto di sapere quando un progetto peggiora
là dove già lavorano, in un canale di Microsoft Teams, senza aprire l'hub. Pubblicare su Teams è la
prima **scrittura dell'hub verso un sistema fuori dal suo perimetro**: un messaggio in chat si può
inoltrare, citare e conservare per sempre, e la credenziale (l'URL del trigger di Workflows)
permette a chiunque la possieda di pubblicare nel canale.

## Decisione

1. **Un programma separato in un job separato.** Il notificatore (`notifier/`, `npm run notify`)
   gira in un job `notify` dopo `deploy`. Solo il suo step "Notify" riceve `TEAMS_WEBHOOK_URL`. I
   job collect, build, attest e deploy non lo ricevono mai, e il job notify non riceve mai le
   credenziali del collector (GitHub App, PAT, token dei provider). ESLint vieta gli import tra
   `notifier/` e `collector/` (e dal sito e da `shared/` verso `notifier/`).
2. **Dry-run finché tutto non dice di inviare.** L'invio richiede `mode: send` nella
   configurazione, la variabile di repository `HUB_NOTIFICATIONS=send`, dati reali (`github`) e un
   `changes.json` davvero confrontato e non sintetico. Altrimenti il contenuto viene scritto in un
   artifact da rivedere e il riepilogo nomina la prima condizione non soddisfatta.
3. **Un riepilogo senza dettagli dei repository.** Il messaggio contiene nomi dei progetti,
   stati, punteggi e conteggi, e porta solo alla pagina "Cosa è cambiato" dell'hub. Mai nomi di
   repository, id di componenti, id o titoli di alert, id di eccezioni, riferimenti ai team, link
   a GitHub o dettagli di errore. I nomi dei progetti sono resi inerti (escape). Ogni contenuto
   viene controllato per modelli di credenziale e per i valori delle credenziali nell'ambiente
   prima di essere scritto o inviato.
4. **Una volta per insieme di modifiche.** La chiave dell'insieme di modifiche è un hash della
   data della raccolta precedente e degli elementi significativi. Un registro (artifact
   `hub-notify-ledger`, 90 giorni, senza URL né contenuti) annota cosa è stato inviato; una nuova
   esecuzione lo vede, anche un tentativo precedente della stessa esecuzione. Se il registro non si
   può ripristinare in modalità send, non si invia nulla.
5. **Un unico nucleo HTTP verificato.** Il nucleo del client dell'ADR 0012 è stato spostato in
   `shared/http/` senza modifiche. Il notificatore aggiunge `postOnce`: solo POST, solo `https`, un
   host di Workflows da una lista consentita, redirect rifiutati, un timeout, una risposta limitata
   e scartata, **nessun nuovo tentativo automatico** (un POST non è idempotente), nulla nei log.
6. **Prima Microsoft Teams.** Jira e Azure DevOps sono progettati (spec §5.5.4) e arriveranno più
   avanti; fino ad allora le loro chiavi di configurazione sono rifiutate.

## Alternative considerate

- **Notificare dal job collect.** Scartata: credenziali delle fonti e delle destinazioni
  condividerebbero un job.
- **Ritentare in caso di errore.** Scartata: un timeout dopo che il canale ha accettato il messaggio
  lo pubblicherebbe due volte. Un invio fallito è visibile nel job e l'insieme di modifiche
  successivo viene inviato normalmente.
- **Un messaggio per ogni alert.** Scartata: rumore. Un riepilogo per raccolta, solo per
  peggioramenti significativi.
- **Connettori di Office 365 (Incoming Webhook).** Non disponibili: ritirati in Teams a maggio 2026.

## Conseguenze

- Nuovo segreto facoltativo `TEAMS_WEBHOOK_URL` e variabile di repository `HUB_NOTIFICATIONS`; il
  percorso di deploy protetto riceve l'input `notifications` e lo stesso segreto.
- Un flusso appartiene alla persona che l'ha creato: se lascia l'organizzazione, la pubblicazione
  si ferma (la documentazione consiglia un account di servizio e un co-proprietario). L'URL è una
  password: si ruota ricreando il trigger.
- Una notifica fallita non blocca mai un deploy: nessun job dipende da `notify`.
- Aggiungere Jira o Azure DevOps significa un renderer e una regola sull'host sullo stesso
  `postOnce`.
