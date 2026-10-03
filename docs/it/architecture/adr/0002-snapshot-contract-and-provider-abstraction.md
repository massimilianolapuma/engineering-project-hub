# ADR 0002: Contratto degli snapshot e astrazione dei provider

- **Stato:** Accettato
- **Data:** 2026-10-03
- **English version:** [docs/architecture/adr/0002-snapshot-contract-and-provider-abstraction.md](../../../architecture/adr/0002-snapshot-contract-and-provider-abstraction.md)

## Contesto

Il sito non deve dipendere dai formati dell'API di GitHub. Seguiranno altri provider
(Harbor, SonarQube, Trivy, ZAP, Argo CD, Azure DevOps…). I dati di sicurezza devono essere
pubblicati a partire da una **allowlist**, non filtrando ciò che sappiamo essere
pericoloso.

## Decisione

- `shared/model/` definisce l'**unico contratto** tra collector e sito: schemi Zod e tipi
  inferiti per catalogo, policy, contratti esterni (release manifest, file di stato
  sicurezza) e snapshot (`schemaVersion: "1.0"`).
- Ogni schema degli snapshot è **`.strict()`**. Le chiavi sconosciute fanno fallire la
  validazione, il che rende lo schema l'allowlist di pubblicazione.
- I valori sono normalizzati (severità, stato, categoria, stato del controllo) e gli
  originali del provider vengono conservati (`originalSeverity`, `originalStatus`).
- **Lo stato sconosciuto è modellato esplicitamente**: i conteggi sono `number | null`, i
  controlli hanno nove stati e gli errori sono classificati. Nulla assume 0 come valore
  predefinito.
- I provider implementano `SourceProvider` e restituiscono `ProviderResult<T>`, che
  contiene i dati oppure un errore classificato e non lancia mai eccezioni. L'MVP include
  `GitHubProvider` e `MockProvider`. Le sorgenti di sicurezza diverse da GitHub
  implementeranno `ControlProvider`. Fino ad allora i loro risultati arrivano tramite il
  contratto `.security/project-security-status.json`.
- La salute è calcolata da evaluator puri a partire da `policies.yaml`. Ogni stato riporta
  codici di motivo e parametri, che il sito traduce (EN/IT).
- Il sito rivalida gli snapshot in fase di build e rifiuta le versioni di schema non
  supportate con una pagina di errore controllata.

## Conseguenze

- Positive: i provider possono essere aggiunti senza toccare il sito, gli snapshot golden
  rendono le modifiche revisionabili e la sanitizzazione è strutturale, non best-effort.
- Negative: aggiungere un campo pubblicato comporta una modifica dello schema, la
  rigenerazione dei golden (`npm run fixtures:update`) ed eventualmente un incremento di
  `schemaVersion` con il relativo supporto nel sito.
- Regola di versionamento: i campi aggiuntivi e opzionali mantengono `1.x`. Rimozioni o
  modifiche semantiche richiedono una nuova versione elencata in
  `SUPPORTED_SNAPSHOT_SCHEMA_VERSIONS`.
