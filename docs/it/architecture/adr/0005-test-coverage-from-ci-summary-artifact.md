# ADR 0005: Copertura dei test da un artifact di riepilogo della CI, non da Sonar o dalla UI di GitHub

- **Stato:** Accettata
- **Data:** 2026-10-21
- **Versione inglese:** [docs/architecture/adr/0005-test-coverage-from-ci-summary-artifact.md](../../../architecture/adr/0005-test-coverage-from-ci-summary-artifact.md)

## Contesto

Il proprietario vuole vedere, per ogni progetto, quanta parte del codice è coperta dai test,
accanto a delivery, versioni e sicurezza. Fatti verificati il 2026-10-21:

- SonarQube importa la copertura dai report della CI e la tratta come una misura di
  qualità, accanto al rating di sicurezza ma non parte di esso. Il suo futuro in alcune
  organizzazioni è incerto, quindi l'hub non deve dipenderne.
- GitHub Code Quality mostra la copertura di righe nelle pull request da un report Cobertura,
  ma nessun endpoint REST o GraphQL restituisce la percentuale di copertura. La sua API REST
  restituisce solo i finding (conteggi per categoria e severità).
- L'hub ha già una dimensione chiamata `coverage`. Indica la quota dei controlli di
  sicurezza obbligatori attivi, non la copertura dei test.

Il portale è in sola lettura, statico e senza backend ([ADR 0001](0001-static-first-github-native.md));
ogni campo pubblicato passa da una allowlist rigorosa ([ADR 0002](0002-snapshot-contract-and-provider-abstraction.md)).

## Decisione

1. **Una sesta dimensione, Qualità.** La copertura dei test è una dimensione a sé, non parte
   del rischio sicurezza. La dimensione `coverage` esistente mantiene il suo id e nella UI e
   nei documenti è rinominata "Copertura controlli" / "Controls coverage".
2. **La CI pubblica un piccolo riepilogo come artifact.** Ogni repository carica un artifact
   di GitHub Actions chiamato `hub-quality-summary` con un solo file, `quality-summary.json`
   (schema strict, versione `1.0`: repository, ref, SHA del commit, data, strumento, formato
   e `lines.covered` / `lines.valid`), a ogni esecuzione sul branch predefinito. Il collector
   lo legge con il permesso che ha già (Actions: read). Nessun nuovo secret, nessuna
   dipendenza commerciale.
3. **Limiti di fiducia e dimensione.** Il collector prende l'artifact non scaduto più recente
   la cui esecuzione è sul branch predefinito e proviene dallo stesso repository (mai
   l'esecuzione di una pull request da fork), legge lo zip solo fino a 64 KB e un solo file,
   lo valida e verifica che `repository` coincida. Qualsiasi altro caso è `invalid` e nulla
   di esso viene pubblicato.
4. **Sconosciuto non è zero.** Un repository senza report leggibile è "non visibile"
   (mancante, scaduto, non valido, non autorizzato, sconosciuto), mai 0%. `lines.valid: 0` è
   non applicabile. Un 403 è `not-authorised`, mai "mancante". La copertura del progetto è la
   somma pesata per righe sui report leggibili o non aggiornati, ogni repository contato una
   sola volta. Un report non aggiornato conta ancora ma limita lo stato a ambra.
5. **La Qualità è opzionale per impostazione predefinita.** Un nuovo
   `overall.optionalDimensions` (predefinito `[quality]`) fa contare una Qualità misurata per
   lo stato complessivo e per il punteggio, mentre una grigia viene ignorata, così i progetti
   esistenti restano stabili finché la CI non pubblica i riepiloghi. La Qualità non è
   critica: un rosso conta come ambra nel complessivo. Peso nel punteggio 10.
6. **I finding di Code Quality sono informativi.** I finding aperti sono contati per
   repository (categoria e severità) e mostrati nella sezione Qualità. Non cambiano mai lo
   stato. Il nome del permesso per questi endpoint è documentato solo in parte, quindi un
   errore è mostrato come non autorizzato o sconosciuto, mai nascosto.
7. **Schema snapshot 1.4** aggiunge `qualityHealth`, la dimensione `quality`, la capability
   `codeQuality` e la sorgente non aggiornata `quality-report`. Gli snapshot precedenti non
   vengono letti.

## Alternative considerate

- **Dipendere da SonarQube.** Scartata: il suo futuro è incerto e aggiunge una dipendenza
  commerciale. Un provider SonarQube resta nella roadmap e il contratto lascia spazio per
  aggiungerlo.
- **Leggere la copertura da GitHub Code Quality.** Impossibile: nessun endpoint restituisce
  la percentuale.
- **Analizzare nel collector i report di copertura grezzi.** Scartata: i report sono grandi,
  specifici dello strumento e contengono path di file. Il riepilogo rende l'allowlist
  banalmente sicura: solo conteggi.
- **Fondere la copertura nella dimensione esistente o nella sicurezza.** Scartata: i due
  significati collidono, e la copertura dei test non deve mai abbassare o nascondere il
  rischio di sicurezza.
- **La copertura come contesto nella pagina Sicurezza.** Non scelta dal proprietario: la
  Qualità ha invece una scheda, una barra e una sezione proprie.

## Conseguenze

- Positive:
  - funziona con i permessi attuali, con i dati mock e senza credenziali;
  - un report mancante o illeggibile è sempre esplicito, mai 0% e mai sano;
  - il contratto è neutro rispetto allo strumento (`cobertura`, `lcov`, `opencover`,
    `jacoco`, `other`).
- Negative:
  - ogni repository monitorato richiede uno step di CI per produrre il riepilogo (un esempio
    è in [Operatività](../../operations.md#pubblicare-il-riepilogo-di-qualità-dalla-ci));
  - un riepilogo per repository: nessun dettaglio per path in un monorepo, e i finding non
    sono divisi per componente;
  - gli artifact scadono (consigliati 30 giorni), quindi un repository che smette di
    eseguire la CI sul branch predefinito passa da non aggiornato a scaduto.
