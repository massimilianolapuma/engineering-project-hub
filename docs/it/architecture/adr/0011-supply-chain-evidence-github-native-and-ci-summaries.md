# ADR 0011: Evidenze della supply chain da fonti native GitHub e riepiloghi CI

- **Stato:** Accettata
- **Data:** 2026-11-03
- **Versione inglese:** [docs/architecture/adr/0011-supply-chain-evidence-github-native-and-ci-summaries.md](../../../architecture/adr/0011-supply-chain-evidence-github-native-and-ci-summaries.md)

## Contesto

Cinque degli otto controlli di ogni progetto (container scanning, IaC scanning, DAST, SBOM e firma
degli artefatti) potevano essere letti solo dal file `.security/project-security-status.json`, che
ogni repository scrive a mano. La maggior parte dei repository non lo ha mai scritto, quindi quei
controlli risultavano "non configurati" o sconosciuti anche quando l'evidenza esisteva: un SBOM nel
grafo delle dipendenze di GitHub, attestazioni sugli asset delle release, risultati di Trivy, Checkov
o ZAP caricati in code scanning, firme delle immagini verificate in CI.

Quell'evidenza porta due trappole. "Firmato" può voler dire che una firma **esiste** oppure che
qualcuno l'ha **verificata** contro un'identità, e solo la CI può fare la seconda cosa (ha il digest
dell'immagine, l'identità di firma e gli strumenti). E lo SBOM del grafo delle dipendenze nasce da
un'esportazione che chiede a GitHub di **eseguire un job**: la prima richiesta dell'hub che non è una
semplice lettura.

## Decisione

1. **Nessuna nuova dimensione.** L'evidenza alimenta i controlli esistenti (Sicurezza e Copertura dei
   controlli). Una sezione `supplyChain` su ogni progetto la spiega: conteggi SBOM, conteggi delle
   licenze, attestazioni della release, firme e provenienza delle immagini, stato del riepilogo CI.
2. **Fonti in ordine.** Ciascuno dei cinque controlli si risolve da un elenco ordinato di fonti
   (`policies.supplyChain.precedence`): code scanning, lo SBOM del grafo delle dipendenze, le
   attestazioni degli asset dell'ultima release, il riepilogo CI, Harbor (ADR 0012) e il file di
   stato. Vince la prima fonte con una risposta definitiva; il controllo registra `source` ed
   `evidence`.
3. **Presenza o verifica della CI, mai dell'hub.** `present` vuol dire che la firma o l'attestazione
   esiste in GitHub o nel registry; `verified` vuol dire che la CI l'ha verificata con cosign o
   `gh attestation verify` e ha riportato il risultato nell'artefatto **`hub-supply-chain-summary`**
   (`supply-chain-summary.json`, contratto 1.0); `reported` vuol dire risultati di scansione
   riportati da uno strumento. L'hub non scarica mai i bundle, non controlla mai le firme e non si
   fida mai di un "verificato" che non arrivi dalla CI.
4. **L'esportazione SBOM è su richiesta.** `supplyChain.sbom.dependencyGraph` vale `false` di
   default. Se attiva, il collector chiama `generate-report` una volta per repository e per
   esecuzione, poi scarica il report indicato; è l'unica eccezione a "solo GET, non avvia nulla".
   L'host di download è vincolato a una allowlist nel codice, la dimensione è limitata e si tengono
   solo i conteggi. Se spenta, lo SBOM arriva dal riepilogo CI, altrimenti dal file di stato,
   altrimenti è sconosciuto.
5. **Solo conteggi.** Nomi dei pacchetti, testi delle licenze, nomi `LicenseRef`, bundle delle
   attestazioni e certificati non vengono mai pubblicati. Le licenze personalizzate sono raggruppate
   come `LicenseRef-*`.
6. **Trivy, Checkov e ZAP** sono riconosciuti dal nome dello strumento di code scanning (e da un
   prefisso di categoria facoltativo) e associati a container scanning, IaC scanning e DAST. I loro
   alert restano finding normali con categoria `container`, `iac` o `dast`, mai contati due volte.
7. **Informativi di default.** Artefatti non firmati e licenze segnalate aggiungono motivi a livello
   `info`, a meno che il proprietario non alzi `supplyChain.levels`.

## Alternative considerate

- **Verificare le firme nell'hub** (cosign nel collector). Scartata: il collector avrebbe bisogno di
  credenziali del registry, delle identità di firma e dell'accesso di rete ai transparency log, e una
  verifica fallita nell'hub non si distingue da una configurazione rotta.
- **L'endpoint SBOM sincrono.** Scartata: GitHub lo ritira (13 nov 2026) a favore dell'esportazione
  asincrona.
- **Esportazione SBOM attiva di default.** Scartata: è l'unica richiesta che fa lavorare GitHub,
  quindi il proprietario la attiva in modo esplicito.
- **Una settima dimensione "Supply chain".** Scartata: mostrerebbe due volte gli stessi controlli e
  sposterebbe ogni punteggio.

## Conseguenze

- La GitHub App ottiene **Attestations: read**. Contents, Actions e Code scanning alerts (già
  concessi) coprono l'esportazione SBOM, il riepilogo CI e le analisi per strumento.
- I repository possono portare un controllo da "non configurato" a `verified` aggiungendo un job CI
  che scrive il riepilogo, senza modifiche all'hub.
- Lo schema snapshot `1.8` porta `source` ed `evidence` sui controlli e la sezione `supplyChain`;
  `supply-chain.csv` è una nuova esportazione.
- "Sconosciuto" resta diverso da "non firmato": una fonte illeggibile non conta mai come mancante.
