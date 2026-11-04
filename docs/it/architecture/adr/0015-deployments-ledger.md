# ADR 0015: le GitHub Deployments come registro di ogni ambiente, scritto da fuori dell'hub

- **Stato:** Accettata
- **Data:** 2026-11-04
- **Versione inglese:** [docs/architecture/adr/0015-deployments-ledger.md](../../../architecture/adr/0015-deployments-ledger.md)

## Contesto

La mappa dei controlli (ADR 0014) misura il rilascio su un ambiente per progetto. Gli ambienti DEV
e di laboratorio sono rilasciati da GitHub Actions, quindi GitHub li conosce. Test,
pre-produzione e produzione sono spesso rilasciati da sistemi che l'hub non vede: la repository
viene copiata nell'Azure DevOps di un cliente (o di un cloud provider) e le sue pipeline
rilasciano da lì, con approvazioni. Quegli ambienti risultano «rilasciato da pipeline esterne». Il
responsabile vuole ogni ambiente di ogni repository visibile, su GitHub e nell'hub.

## Decisione

1. **Le GitHub Deployments sono il registro.** Ogni deploy di ogni ambiente è un deployment
   GitHub sul commit rilasciato, con uno stato finale e un collegamento all'esecuzione che l'ha
   fatto. I nomi degli ambienti seguono il catalogo dell'hub.
2. **Tre scrittori, fuori dal job di raccolta dell'hub:**
   - uno step push alla fine delle pipeline esterne (`scripts/report-deployment.sh`);
   - un bridge che legge in sola lettura i record di deploy degli environment Azure DevOps
     (`rw-deployments-bridge.yml`);
   - un record dichiarato inserito da un form protetto e approvato (`rw-deployments-declare.yml`).
     Gli scrittori sono un programma separato (`ledger/`), isolato da collector e notifier tramite
     ESLint, come il notifier (ADR 0013).
3. **Un contratto, non una convenzione.** Il `payload` del deployment porta fonte, esecuzione
   esterna, tentativo, versione e orari reali di inizio e fine (gli orari di GitHub sono quelli di
   scrittura). Un deploy viene scritto una sola volta per (fonte, esecuzione, tentativo, ambiente).
   Un commit che GitHub non conosce non viene mai registrato.
4. **Privilegi minimi.**
   - **Scrittura:** una GitHub App per organizzazione con solo Deployments: read and write, una
     chiave privata per linea o progetto esterno, e token ristretti a una repository e a
     `deployments: write`. Il responsabile ha accettato il limite che qualunque chiave dell'App
     può agire su qualunque repository dove l'App è installata.
   - **Lettura:** il bridge legge GitHub con l'App in sola lettura dell'hub, così le chiavi di
     scrittura non leggono mai il codice.
   - **Azure DevOps:** il bridge lo legge tramite workload identity federation Microsoft Entra,
     senza segreti salvati, o con un PAT come alternativa.
5. **Dry-run di default.** Il bridge e il form dichiarato scrivono solo con l'input `mode: write` e
   la variabile di repository `HUB_DEPLOYMENTS_BRIDGE=write`.
6. **L'hub legge solo il registro** tramite il segnale di deploy `github-deployments` (App
   dell'hub: Deployments: read). I record dichiarati contano e la cella li indica.

## Conseguenze

- Un solo posto mostra lo storico completo dei deploy per ambiente, alle persone e all'hub. Le
  metriche di rilascio non dipendono più da dove un cliente esegue le proprie pipeline.
- Le pipeline esterne o i tenant dei clienti devono concedere qualcosa: uno step e una chiave
  (push), o un'identità in lettura (bridge). Ogni progetto sceglie ciò che il cliente consente.
- Una mappa del bridge sbagliata può scrivere deploy nella repository sbagliata. La mappa si rivede
  in pull request, e il dry-run mostra prima ogni scrittura.
- Google Cloud Deploy, AWS CodePipeline e import da sistemi di ticketing si possono aggiungere come
  ulteriori scrittori dello stesso contratto.
