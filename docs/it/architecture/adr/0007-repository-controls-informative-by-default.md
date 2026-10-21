# ADR 0007: Controlli repository da file dei workflow e API delle regole, informativi per impostazione predefinita

- **Stato:** Accettata
- **Data:** 2026-10-21
- **Versione inglese:** [docs/architecture/adr/0007-repository-controls-informative-by-default.md](../../../architecture/adr/0007-repository-controls-informative-by-default.md)

## Contesto

Il proprietario vuole vedere se i repository di ogni progetto seguono l'igiene di base della
supply chain: action fissate a uno SHA di commit, workflow riutilizzabili aggiornati, branch di
default protetto e un riepilogo OpenSSF Scorecard, più suggerimenti di scoperta da custom
property e topic. L'hub è in sola lettura e usa soprattutto permessi che ha già
([ADR 0001](0001-static-first-github-native.md)), e un progetto non deve diventare rosso da un
giorno all'altro perché è comparso un nuovo controllo.

## Decisione

1. **Sei controlli con nome per repository, non una nuova dimensione (D1, D2).**
   `actions-pinned`, `reusable-workflows-current`, `branch-protected`,
   `pull-request-required`, `force-push-blocked` e `status-checks-required` alimentano
   **Governance** tramite motivi. Il portfolio non ha una settima barra.
2. **Informativi per impostazione predefinita.** Ogni livello è `info` nelle policy: mostrato
   nella pagina del progetto, non cambia mai uno stato né il punteggio. Il proprietario li
   rende vincolanti uno per uno (`amber` o `red`); `unknownEnforcedCheck` è `info` di default.
3. **Sconosciuto non è fallito.** Un 403 è `not-authorised`, un 404 ambiguo è `unknown` (un 404
   sulla cartella dei workflow significa nessun workflow) e una regola assente dall'API mentre il
   branch riporta `protected: true` è `unknown` salvo che la protezione classica sia stata letta
   (D6).
4. **Dati da permessi già concessi.** Regole del branch e custom property richiedono Metadata:
   read, i file dei workflow Contents: read, le analisi Scorecard Code scanning alerts: read. La
   protezione classica richiede Administration: read, quindi è spenta per impostazione
   predefinita (`readClassicProtection`) e non viene mai chiamata da spenta. L'endpoint delle
   property di organizzazione (richiede un nuovo permesso di organizzazione) non è usato.
5. **I file dei workflow sono input non attendibile.** Letti tramite l'API Contents, limitati,
   analizzati in memoria con un limite sugli alias e ridotti a riferimenti `uses:` validati in un
   solo modulo. Testo dei workflow, nomi degli step, `run:`, `with:` ed `env:` non ne escono e non
   vengono mai pubblicati; le destinazioni pubblicate sono ricostruite da parti validate e ripulite.
6. **I dati privati restano privati (D9).** Con `publication.audience: public`, i riferimenti non
   fissati e le destinazioni dei workflow riutilizzabili dei repository non pubblici sono nascosti
   (i conteggi restano) e un repository di workflow riutilizzabili non pubblico è trattato come
   non visibile.
7. **Schema 1.5, storico 1.1.** Lo snapshot ottiene `repositoryControls`; lo storico ottiene
   conteggi e stati dei controlli opzionali, così "Cosa è cambiato" può elencare i passaggi da
   superato a fallito. Lo storico precedente viene letto.
8. **Suggerimenti di scoperta.** Si leggono solo tre chiavi di property configurate e due prefissi
   di topic; ogni altra property è scartata prima di salvare. I suggerimenti possono raggruppare
   repository in una proposta `grouped` e suggerire un progetto esistente. Le proposte restano
   proposte.

## Alternative considerate

- **Una settima dimensione.** Scartata: più rumore per un segnale per lo più informativo.
- **Vincolanti per impostazione predefinita.** Scartata: i progetti esistenti cambierebbero stato
  all'aggiornamento.
- **Leggere la protezione classica di default.** Scartata: richiede un nuovo permesso.
- **Salvare il testo dei workflow e analizzarlo nel sito.** Scartata: testo non attendibile
  attraverserebbe il confine di fiducia e verrebbe pubblicato.

## Conseguenze

- Positive:
  - l'igiene della supply chain diventa visibile senza cambiare alcuno stato all'aggiornamento;
  - nessun nuovo permesso predefinito, segreto o chiamata di scrittura;
  - rendere vincolante un controllo è una modifica di una riga nelle policy.
- Negative:
  - più chiamate API per esecuzione (regole, file dei workflow, Scorecard, repository
    referenziati);
  - senza Administration: read la protezione solo classica resta "non visibile";
  - un `public/data` 1.4 esistente va raccolto di nuovo.
