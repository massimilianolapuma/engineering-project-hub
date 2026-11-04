# Notifiche (Microsoft Teams)

> 🇬🇧 [English version](../notifications.md)

Dalla v0.15.0 l'hub può pubblicare un breve riepilogo in un canale di Microsoft Teams dopo ogni
raccolta, quando dei progetti sono peggiorati. È spento di default, poi in dry-run, e invia solo
dopo due consensi separati. Progetto: [ADR 0013](architecture/adr/0013-outward-notifications.md).

## Cosa contiene un messaggio

Un messaggio per raccolta, solo quando è successo qualcosa di significativo (valori predefiniti in
`config/notifications.yaml`):

- lo stato complessivo di un progetto è peggiorato (Sano → Attenzione, → Critico) o è diventato
  Sconosciuto;
- Sicurezza o Delivery sono peggiorate;
- nuovi alert critici;
- alert critici o alti appena oltre la scadenza di rimedio;
- eccezioni di sicurezza scadute.

I miglioramenti non generano mai un messaggio. Per ogni progetto: nome, stato ("Critico (prima
Attenzione)"), le dimensioni peggiorate, i conteggi e la variazione del punteggio. Con `siteUrl`
impostato, un pulsante "Apri Cosa è cambiato" porta all'hub.

**Mai in un messaggio:** nomi di repository, id di componenti, id o titoli di alert, id di
eccezioni, nomi dei team, link a GitHub, dettagli di errore. Per i dettagli si segue il link
all'hub, dietro il suo controllo d'accesso. I nomi dei progetti restano: se sono riservati, non
pubblicare per un pubblico più ampio.

## Configurazione

1. **Crea il flusso.** In Teams apri il canale → **Workflows** → modello **Send webhook alerts to
   a channel**. In "Who can trigger the flow" scegli **Anyone**: l'URL stesso è la credenziale
   (l'hub non invia altra autenticazione). Copia l'URL del webhook.
2. **Salva l'URL come segreto**: `TEAMS_WEBHOOK_URL`, nel repository (percorso GitHub Pages) o nel
   repository di deploy (percorso protetto). Mai in un file.
3. **Configura** `config/notifications.yaml` (o la configurazione del repository di deploy):
   imposta `siteUrl` all'indirizzo dell'hub (`https://…/`, che termina con `/`) e
   `targets.teams.enabled: true`. Per ora lascia `mode: dry-run`.
4. **Attiva il job.**
   - Percorso GitHub Pages: variabile di repository `HUB_NOTIFICATIONS=dry-run`.
   - Percorso protetto: passa `notifications: ${{ vars.HUB_NOTIFICATIONS }}` e il segreto nel
     workflow chiamante (vedi `examples/protected-deploy/.github/workflows/deploy-hub.yml`).
5. **Controlla un dry-run.** Dopo la raccolta successiva, il job `notify` carica
   `notification-payloads`: `digest.json`, `teams.json` (il messaggio esatto, senza l'URL) e
   `summary.md`.
6. **Invia.** Imposta `mode: send` nella configurazione **e** `HUB_NOTIFICATIONS=send`.

## Perché un'esecuzione è rimasta in dry-run

La riga `Mode` del riepilogo nomina la prima condizione non soddisfatta:

| Motivo          | Significato                                                                     |
| --------------- | ------------------------------------------------------------------------------- |
| `mode-config`   | `notifications.yaml` dice `mode: dry-run`                                       |
| `mode-variable` | la variabile `HUB_NOTIFICATIONS` (o l'input del percorso protetto) non è `send` |
| `mock-data`     | l'esecuzione ha usato i dati dimostrativi                                       |
| `not-compared`  | non c'era una raccolta precedente con cui confrontare (ancora nessuno storico)  |
| `synthetic`     | la base del confronto è sintetica (storico dimostrativo)                        |

## Niente duplicati, niente nuovi tentativi

Ogni riepilogo ha una chiave dell'insieme di modifiche (un hash della data della raccolta precedente
e degli elementi significativi). Dopo un invio riuscito la chiave viene salvata nell'artifact
`hub-notify-ledger` (90 giorni). Una **nuova esecuzione dello stesso run** vede la chiave e riporta
`skipped-duplicate`. Una raccolta successiva ha sempre una chiave nuova (la sua raccolta precedente
è un'altra), quindi viene inviata se è successo di nuovo qualcosa di significativo. Se in modalità
send il registro non si può ripristinare o leggere, non si invia nulla ("ledger unavailable"), e un
registro che il notificatore non ha salvato da sé non viene mai ricaricato.

Un invio fallito **non** viene ritentato automaticamente. Riesegui il job per riprovare, oppure
lascia che la raccolta successiva invii le proprie modifiche. Un'avvertenza: dopo un `error` dovuto a
un timeout, Teams potrebbe aver accettato comunque il messaggio, quindi una nuova esecuzione può
pubblicarlo una seconda volta. Una notifica fallita non blocca mai un deploy.

Esiti del riepilogo per Teams: `dry-run`, `off`, `sent`, `skipped-duplicate`, `not-configured`
(segreto assente), `refused` (l'URL non è un host di Workflows in https), `rejected`,
`not-authorised`, `not-found`, `too-large`, `rate-limited`, `error`. Ogni esito dopo
`skipped-duplicate` in questo elenco fa fallire il job, e lo fanno anche `not sent` (registro non
disponibile), un controllo del contenuto non superato (una credenziale trovata nel messaggio: nulla
viene scritto né inviato) e un `notifications.yaml` non valido.

## Rischi e limiti

- **Il flusso appartiene a una persona.** Se il proprietario lascia l'organizzazione, la
  pubblicazione si ferma. Crealo con un account di servizio, oppure aggiungi un co-proprietario.
- **L'URL è una password.** Chi lo possiede può pubblicare nel canale. Ruotalo eliminando e
  ricreando il trigger del flusso, poi aggiorna il segreto.
- **Limiti:** un messaggio è al massimo 28 KB (l'hub resta sotto i 24 KB e conta i progetti
  esclusi); oltre 4 richieste al secondo scatta la limitazione (l'hub ne invia una).
- **Host consentiti:** sono accettati solo host che terminano con
  `environment.api.powerplatform.com`; i cloud sovrani possono aggiungere i propri in
  `targets.teams.allowedHostSuffixes`.

## Fonti (verificate il 2026-11-04)

- [Create incoming webhooks with Workflows](https://learn.microsoft.com/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook)
  (payload Adaptive Card e MessageCard, 28 KB, limitazione, flussi orfani).
- [Retirement of Office 365 connectors within Microsoft Teams](https://devblogs.microsoft.com/microsoft365dev/retirement-of-office-365-connectors-within-microsoft-teams/)
  (connettori ritirati a maggio 2026).
