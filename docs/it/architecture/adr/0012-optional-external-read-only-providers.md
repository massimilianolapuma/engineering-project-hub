# ADR 0012: Provider esterni facoltativi in sola lettura dietro un unico client HTTP verificato

- **Stato:** Accettata
- **Data:** 2026-11-03
- **Versione inglese:** [docs/architecture/adr/0012-optional-external-read-only-providers.md](../../../architecture/adr/0012-optional-external-read-only-providers.md)

## Contesto

Finora il collector parlava con un solo host: l'API di GitHub. I team usano anche SonarQube (quality
gate e copertura), Harbor (immagini, scansioni e firme) e Argo CD (cosa è davvero rilasciato in ogni
ambiente). Quelle risposte colmano lacune reali: un repository senza artefatto di copertura,
un'immagine scansionata nel registry, un ambiente non sincronizzato con Git. Portano però anche i
primi host non GitHub, tre nuove credenziali e dati con una forma decisa da sistemi che l'hub non
controlla.

## Decisione

1. **Spenti se non configurati.** I provider stanno in un file facoltativo
   `<configDir>/providers.yaml`, mai pubblicato. File assente, oppure `enabled: false`, vuol dire che
   l'hub non contatta alcun host di provider. La sorgente mock legge invece
   `fixtures/providers/providers.yaml`, che attiva i tre provider su fixture sintetiche.
2. **Credenziali solo dall'ambiente.** `SONARQUBE_TOKEN`, `HARBOR_ROBOT_NAME` +
   `HARBOR_ROBOT_SECRET`, `ARGOCD_TOKEN`. Sono passate solo allo step Collect e aggiunte all'elenco
   di valori che lo scanner dell'output non deve mai trovare. Un provider attivo senza credenziale
   segna i suoi elementi `not-authorised` e l'esecuzione continua; mezza credenziale Harbor è un
   errore di configurazione.
3. **Un unico client condiviso.** Ogni provider passa da `collector/src/providers/external/http.ts`:
   solo `https`, l'host esatto del `baseUrl` configurato (controllato prima di ogni richiesta),
   percorsi da modelli fissi con ogni parametro codificato, redirect rifiutati, un timeout, un limite
   di 1 MiB sulla risposta letta in streaming, nessun log ed errori con un messaggio fisso per classe
   (mai il corpo o l'URL). Ogni provider ha una concorrenza di 2 e un limite di elementi per
   esecuzione (`maxItems`).
4. **Proiezioni in sola lettura.** SonarQube: misure e ultima analisi delle project key associate.
   Harbor: un artefatto per riferimento d'immagine associato, con riepilogo della scansione e
   accessori. Argo CD: un'applicazione per ambiente associato. Ogni risposta è ridotta a una
   proiezione rigida; nient'altro viene tenuto. L'hub non avvia mai una scansione, una
   sincronizzazione o un'analisi.
5. **Associazioni nel catalogo.** `sonarProjectKey`, `sonarBranch`, `containerImages` e
   `argocdApplication` stanno accanto ai componenti e agli ambienti che descrivono. Sono nomi, mai
   host o credenziali, e vengono pubblicati con il catalogo.
6. **Ogni provider alimenta una vista esistente.** SonarQube è una fonte della Qualità
   (`policies.quality.sources`), Harbor una fonte di container scanning e firma degli artefatti
   (ADR 0011), Argo CD la versione rilasciata di un ambiente (con accanto la versione dichiarata). I
   motivi "non sincronizzato", "degradato" e "gate non superato" sono informativi di default.

## Alternative considerate

- **Codice HTTP proprio per ogni provider.** Scartata: tre punti da verificare per vincolo
  dell'host, redirect e log.
- **URL di base nel catalogo.** Scartata: gli host sono dettagli d'infrastruttura che non vanno
  pubblicati; il catalogo sì.
- **Argo CD e Harbor tramite le loro CLI.** Scartata: binari in più nel job di raccolta e output più
  difficile da limitare.

## Conseguenze

- Nuovi secret facoltativi in `collect-data.yml`; la documentazione indica i permessi minimi per
  ciascuno.
- Qualità dei dati mostra una scheda Provider (stato e conteggi per provider), così un provider
  configurato male si vede e non resta silenzioso.
- Lo schema snapshot `1.8` pubblica gli stati dei provider, le fonti e i gate della Qualità e gli
  ambienti con versione dichiarata e rilasciata, sincronizzazione e salute.
- Aggiungere un altro provider vuol dire una proiezione e un modello di percorso, non un nuovo
  canale di rete.
