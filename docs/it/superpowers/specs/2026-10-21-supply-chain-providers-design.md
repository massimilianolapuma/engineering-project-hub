# Provider di catena di fornitura: SBOM, firme e attestazioni, Trivy / Checkov / ZAP, SonarQube, Harbor, Argo CD — design

English: [../../../superpowers/specs/2026-10-21-supply-chain-providers-design.md](../../../superpowers/specs/2026-10-21-supply-chain-providers-design.md)

Stato: design del builder nell'ambito del programma di roadmap (l'owner rivede dopo la consegna) · Data: 2026-10-21 · Release prevista: v0.10.0

Spec padre: [2026-10-21-roadmap-program-design.md](2026-10-21-roadmap-program-design.md) (§2 vincoli, §4 "v0.10.0 Supply chain providers", §5 anti-obiettivi). È vincolante. Ogni decisione di questo documento non fissata lì è una **scelta del builder** ed è marcata **(BC)**.

Dipende da, tutte unite prima di questa release:

- v0.7.0 ([2026-10-21-history-trends-design.md](2026-10-21-history-trends-design.md)): `shared/model/primitives.ts`, export CSV (`src/lib/csv.ts`, `src/pages/exports/*.csv.ts`), storico 1.0.
- v0.8.0 ([2026-10-21-repository-controls-design.md](2026-10-21-repository-controls-design.md)): snapshot 1.5, ADR 0007, la chiamata alle analisi di code scanning filtrata per `tool_name` (Scorecard), l'enum di livello `info | amber | red`.
- v0.9.0 ([2026-10-21-risk-governance-design.md](2026-10-21-risk-governance-design.md)): snapshot 1.6, storico 1.2, ADR 0008, `countsAsOpen`, il pattern `<configDir>/<file>.yaml` opzionale + fixture mock (D13 lì).

Questa release prende lo schema snapshot **1.7**, **ADR 0009** e **ADR 0010**. Lo storico resta **1.2** (§5.11).

## 1. Intento e motivo

La roadmap del README elenca sei voci di catena di fornitura: SBOM (CycloneDX / SPDX), firme e attestazioni Cosign, Trivy / Checkov / ZAP, SonarQube, Harbor e Argo CD. I controlli `containerScanning`, `iacScanning`, `dast`, `sbom` e `artifactSignature` esistono già nel modello, ma oggi la loro unica fonte è il file auto-dichiarato `.security/project-security-status.json`. L'owner vuole che l'hub legga le stesse evidenze dove stanno davvero: prima in GitHub, e opzionalmente nei SonarQube, Harbor e Argo CD aziendali.

Fatti verificati il 2026-10-21 (fonti in §9):

- **Export SBOM del dependency graph.** `GET /repos/{o}/{r}/dependency-graph/sbom` restituisce SPDX JSON (`sbom.spdxVersion`, `sbom.creationInfo.created`, `sbom.packages[]` con `name`, `versionInfo`, `licenseConcluded`, `licenseDeclared`, `externalRefs[]` con `referenceType` / `referenceLocator`, e `relationships[]`). **Ha un avviso di chiusura: "will not be accessible after November 13, 2026"**, tra tre settimane. Il sostituto è asincrono:
  - `GET …/dependency-graph/sbom/generate-report` "triggers a job to generate" uno SBOM SPDX e restituisce `201 { sbom_url }`;
  - `GET …/dependency-graph/sbom/fetch-report/{sbom_uuid}` restituisce `202` durante l'elaborazione e `302` verso un URL di download temporaneo quando è pronto. Il report è conservato fino a una settimana.
  - Tutti e tre richiedono, per token fine-grained / GitHub App, **Contents: read**, già concesso.
- **Attestazioni degli artefatti.** `GET /repos/{o}/{r}/attestations/{subject_digest}` (digest `sha256:<hex>`) elenca le attestazioni con `bundle`, `bundle_url`, `repository_id`, `initiator`; `predicate_type` opzionale (`provenance`, `sbom`, `release` o personalizzato), `per_page` ≤ 100. Richiede il nuovo permesso **Attestations: read**. GitHub dice che firme e timestamp vanno verificati crittograficamente (per esempio con `gh attestation verify`). Serve un digest: non esiste un "elenco per repository".
- **Gli asset delle release hanno un digest.** L'oggetto asset di release ha un campo `digest` obbligatorio e annullabile. L'hub legge già l'ultima release di ogni componente.
- **Nomi dei tool di code scanning.** Trivy scrive il nome driver SARIF **`Trivy`** (`pkg/report/sarif.go`). Checkov scrive **`Checkov`** di default (modificabile con `--custom-tool-name`). Il report `sarif-json` di ZAP scrive **`ZAP`**. Code scanning salva il nome driver come nome del tool di alert e analisi; l'elenco delle analisi accetta `tool_name` (v0.8.0). Il SARIF di ZAP contiene anche `webRequest` / `webResponse` (cookie, corpi), che l'hub non legge mai: gli arrivano solo i conteggi degli alert per tool.
- **SonarQube.** La Web API raccomanda `Authorization: Bearer <token>` con un **user token**. `GET /api/measures/component?component=<key>&metricKeys=…` richiede **Browse** sul progetto. Chiavi metriche: `alert_status` (quality gate, `OK` o `ERROR`), `lines_to_cover`, `uncovered_lines` (quindi line coverage = (lines_to_cover − uncovered_lines) / lines_to_cover, la stessa grandezza del riepilogo CI dell'hub), `new_coverage` (coverage combinata di righe e condizioni sul codice nuovo; restituita sotto `period` / `periods`). `GET /api/project_analyses/search?project=<key>&ps=1` (Browse) restituisce `date` e `revision` dell'ultima analisi. Le date hanno la forma `2017-03-01T11:39:03+0100` (senza due punti nell'offset). `GET /api/qualitygates/project_status` è **deprecato su SonarQube Cloud dal 16 settembre 2025**, quindi l'hub legge il gate da `alert_status`.
- **API Harbor v2.0.** `GET /api/v2.0/projects/{project_name}/repositories/{repository_name}/artifacts/{reference}` (reference = tag o digest) con `with_scan_overview=true` e `with_accessory=true`. Un `repository_name` che contiene `/` va codificato due volte (`a/b` → `a%252Fb`). L'autenticazione è HTTP Basic (swagger `securityDefinitions: basic`); un robot account di progetto si autentica con nome e secret. La scan overview è indicizzata per MIME type del report e contiene `scan_status`, `end_time`, `summary.total`, `summary.fixable`, `summary.summary{Critical,High,…}`. I valori di `type` degli accessory includono `signature.cosign`, `signature.notation`, `sbom.harbor`. Permessi di progetto del robot necessari: **Read Artifact**, **Read Scan**, **List Accessory** (tutti in lettura).
- **API Argo CD.** `GET /api/v1/applications/{name}` con `appNamespace` e `project` opzionali (con `project`, un'app inesistente dà 404 e un'app fuori dal progetto dà 403). `status.sync.status`, `status.sync.revision`, `status.health.status`, `status.summary.images[]`, `status.operationState.finishedAt`, `status.history[]`, `status.reconciledAt`. **Il parametro di query `refresh` avvia un refresh e non va mai inviato.** Autenticazione: `Authorization: Bearer <token>`. Un account locale con la sola capability `apiKey` (`accounts.<name>: apiKey` in `argocd-cm`) ottiene un token con `argocd account generate-token --account <name>`. RBAC: `p, role:<r>, applications, get, <project>/*, allow` (i log dei pod sono una risorsa `logs` separata e non servono).

## 2. Obiettivi, non-obiettivi, anti-obiettivi

Obiettivi

- I cinque controlli di sicurezza non nativi ottengono fonti reali, ognuna con **fonte** ed **evidenza** esplicite, e una precedenza documentata quando rispondono più fonti.
- Una sezione **Catena di fornitura** per progetto: riepilogo SBOM (conteggi di pacchetti e licenze, mai nomi di pacchetti), firme e attestazioni di artefatti rilasciati e immagini, riepiloghi delle vulnerabilità delle immagini, e lo stato di Trivy / Checkov / ZAP.
- **SonarQube** come seconda fonte di Qualità con precedenza esplicita rispetto al riepilogo CI, più il quality gate come segnale informativo.
- **Argo CD** come fonte osservata per gli ambienti nella dimensione Versioni: sync, health e versione distribuita, accanto alla versione che il manifest dichiara.
- Ogni provider esterno è opzionale, **spento di default**, con la propria credenziale in sola lettura, allowlist dell'host, timeout e limiti, e fixture mock. Non configurato non è mai sano e mai zero.
- UI e documentazione EN + IT, Warm Graphite.

Non-obiettivi

- **Nessuna verifica crittografica dentro l'hub.** L'hub riporta ciò che dicono GitHub, Harbor o la CI (presenza o verifica in CI). Non include librerie Sigstore / Cosign **(BC, ADR 0009)**.
- Nessun nome, versione, purl di pacchetto o testo di licenza pubblicato. Solo conteggi e identificativi SPDX.
- Nessuna issue, hotspot o regola di SonarQube. Nessun elenco di vulnerabilità di Harbor (solo conteggi). Nessun albero di risorse, manifest, evento o log di Argo CD.
- Nessuna scrittura, sync, refresh, scansione o generazione di SBOM in Harbor, SonarQube o Argo CD. L'unica chiamata a GitHub che chiede a GitHub di calcolare qualcosa è la richiesta di export SBOM (§5.2, D3), ed è opt-in e spenta di default.
- Nessun link alle UI di SonarQube, Harbor o Argo CD in questa release **(BC)**: gli URL di Sonar richiedono una query string, che `sanitizeUrl` rimuove, e gli altri host sono interni. Seguito futuro.
- Nessuna nuova dimensione, nessuna nuova barra nel portfolio **(BC, D1)**.
- Nessun parsing CycloneDX nel collector: i team che producono CycloneDX pubblicano i conteggi nel riepilogo CI (§5.4).
- Nessuna API di GHCR o di altri registry OCI: solo Harbor, e i digest delle immagini riportati dalla CI.

Anti-obiettivi (programma §5, specializzati)

- Un provider non configurato, o senza credenziale, mostrato come sano, come "0 vulnerabilità" o come "non firmato".
- Un'attestazione mostrata come "verificata" quando se ne conosce solo la presenza.
- Un progetto che diventa rosso o ambra dopo l'aggiornamento perché esistono nuove fonti: ogni nuovo motivo è `info` di default, e con la configurazione di default (provider esterni spenti) ogni stato di Sicurezza, Copertura controlli, Qualità e Versioni resta invariato.
- Le stesse vulnerabilità contate due volte (alert Trivy in code scanning **e** un conteggio Harbor o del file di stato per lo stesso controllo).
- Una credenziale, un base URL interno, un nome di pacchetto, uno SBOM grezzo, un payload API grezzo, un cookie da un report ZAP o un `repoURL` di Argo CD in qualsiasi file pubblicato.

## 3. Vincoli (programma §2, invariati)

Sola lettura, solo GET; static-first; allowlist Zod rigorosa; testi e link sanitizzati con allowlist degli host; sconosciuto ≠ zero; 403 ≠ nessun dato; 404 ambiguo = sconosciuto; EN + IT; solo dati mock nella demo pubblica; Warm Graphite, stato mai affidato al solo colore, WCAG 2.2 AA; un solo salto di snapshot (1.6 → 1.7); mai `npm run ci:build` / `collect:mock`; mai la porta 4321 (e2e su 4377); solo podman.

## 4. Decisioni in breve

| #   | Decisione                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Perché                                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Nessuna nuova dimensione. Le evidenze di catena di fornitura alimentano i controlli esistenti (Sicurezza e Copertura controlli), Sonar alimenta Qualità, Argo CD alimenta Versioni. Una nuova sezione `supplyChain` spiega le evidenze **(BC)**                                                                                                                                                                                                                                                                   | I controlli esistono già; una settima barra mostrerebbe due volte la stessa cosa                                                             |
| D2  | Ogni controllo non nativo è risolto da un elenco ordinato di **fonti** (`policies.supplyChain.precedence.<control>`). Vince la prima fonte con una risposta definitiva; il controllo registra `source` ed `evidence` **(BC)**                                                                                                                                                                                                                                                                                     | Più tool possono rispondere alla stessa domanda. Un vincitore per controllo evita i doppi conteggi e rende la risposta spiegabile            |
| D3  | SBOM dall'export **asincrono** del dependency graph (generate-report → fetch-report), non dall'endpoint sincrono citato nella spec di programma. **Spento di default**, da attivare con `supplyChain.sbom.dependencyGraph: true`: la richiesta di export chiede a GitHub di eseguire un job, quindi è l'unica eccezione alla regola di sola lettura senza trigger. Da spento, il controllo SBOM viene dal riepilogo CI e altrimenti i suoi conteggi sono sconosciuti **(BC, decisione del controller, ADR 0009)** | L'endpoint sincrono chiude il 13 nov 2026. La richiesta di export legge con Contents: read e non cambia nulla nel repository                 |
| D4  | Attestazioni: una chiamata per digest degli **asset dell'ultima release** (max 5 asset), filtrata per `predicate_type` `provenance` e `sbom`. Solo presenza (`evidence: present`) **(BC)**                                                                                                                                                                                                                                                                                                                        | L'API richiede un digest, e gli asset delle release sono gli unici digest che GitHub dà all'hub senza aiuto della CI                         |
| D5  | Un artefatto di riepilogo CI **`hub-supply-chain-summary`** (`supply-chain-summary.json`, contratto 1.0) porta digest delle immagini, esiti di verifica Cosign / `gh attestation` e conteggi CycloneDX o SPDX. Gli esiti verificati in CI hanno `evidence: verified` **(BC)**                                                                                                                                                                                                                                     | Stesso modello di fiducia e stesso lettore di `hub-quality-summary` (v0.6.0). Digest delle immagini e verifica reale esistono solo in CI     |
| D6  | Trivy / Checkov / ZAP sono riconosciuti dal **nome del tool di code scanning** (configurabile, prefisso opzionale di `category` dell'analisi) e mappati su `containerScanning` / `iacScanning` / `dast`. I loro alert cambiano categoria (`container`, `iac`, `dast`) ma restano finding normali **(BC)**                                                                                                                                                                                                         | Arrivano già all'hub tramite code scanning; mancava solo la mappatura                                                                        |
| D7  | I provider esterni si configurano in un nuovo `<configDir>/providers.yaml` opzionale (mai pubblicato). Credenziali solo da env: `SONARQUBE_TOKEN`, `HARBOR_ROBOT_NAME` + `HARBOR_ROBOT_SECRET`, `ARGOCD_TOKEN` **(BC, ADR 0010)**                                                                                                                                                                                                                                                                                 | I base URL sono dettagli infrastrutturali; le mappature restano nei file di progetto accanto ai componenti che descrivono                    |
| D8  | Un solo client HTTP esterno condiviso: solo https, host esatto del `baseUrl` configurato, `redirect: 'error'`, timeout 20 s, risposta massima 1 MiB, template di path fissi, nessun log, concorrenza 2 per provider e un limite di elementi per esecuzione **(BC)**                                                                                                                                                                                                                                               | Un solo punto da verificare; nessun provider può essere puntato verso un altro host dai dati che legge                                       |
| D9  | Provider abilitato senza credenziale → ogni elemento `not-authorised`, stato del provider a livello di esecuzione `not-authorised`, un avviso nel log; la raccolta non fallisce **(BC)**                                                                                                                                                                                                                                                                                                                          | Sconosciuto ≠ zero; il resto dell'hub resta utile                                                                                            |
| D10 | Fonti di Qualità per componente: `policies.quality.sources`, default `['ci-summary', 'sonarqube']`. Un report `readable` batte uno `stale` tra le fonti, poi conta l'ordine di precedenza; se nulla è leggibile si mostra il fallimento più informativo **(BC)**                                                                                                                                                                                                                                                  | Il riepilogo CI è legato al commit del branch di default del repository; Sonar riempie i vuoti (per esempio un repository senza l'artefatto) |
| D11 | Argo CD: la versione effettiva di un ambiente è quella **distribuita** quando Argo CD la riporta, altrimenti quella **dichiarata** dal manifest. Entrambe vengono pubblicate. Out-of-sync e degraded aggiungono motivi `info` di default **(BC)**                                                                                                                                                                                                                                                                 | L'osservato batte il dichiarato; mai rosso dall'oggi al domani                                                                               |
| D12 | Sorgente mock: `fixtures/providers/providers.yaml` abilita i tre provider sulle fixture `fixtures/providers/*.json`; `config/providers.yaml` è distribuito con tutti e tre `enabled: false` **(BC)**                                                                                                                                                                                                                                                                                                              | La demo mostra ogni funzione; un'esecuzione reale non contatta mai un provider se l'owner non lo attiva (pattern di v0.9.0 D13)              |
| D13 | Schema snapshot **1.6 → 1.7**. Lo storico resta 1.2, `changes.json` invariato. CSV: `versions.csv` aggiunge colonne in fondo, nuovo `supply-chain.csv` **(BC)**                                                                                                                                                                                                                                                                                                                                                   | Un salto per release; le evidenze di catena di fornitura non sono una dimensione, quindi non entrano nell'andamento                          |
| D14 | ADR 0009: "Evidenze di catena di fornitura da fonti native GitHub e riepiloghi CI; l'hub riporta presenza o verifica in CI, non verifica mai da sé". ADR 0010: "Provider esterni opzionali in sola lettura dietro un unico client HTTP verificato"                                                                                                                                                                                                                                                                | Due cambi documentati del confine di fiducia: nuovi dati GitHub (e la richiesta di export), e i primi host non GitHub                        |

## 5. Design

### 5.1 Fonti per controllo (D2)

Id delle fonti (`ControlSourceSchema`):

| Id                     | Dati                                                                     | Dà conteggi?                                        |
| ---------------------- | ------------------------------------------------------------------------ | --------------------------------------------------- |
| `github`               | controlli nativi (code scanning, Dependabot, secret scanning), invariati | sì (finding)                                        |
| `code-scanning`        | analisi e alert di un tool mappato (D6)                                  | sì, **già finding**: mai risommati                  |
| `dependency-graph`     | export SBOM (§5.2)                                                       | no                                                  |
| `attestations`         | attestazioni GitHub dei digest degli asset di release (§5.3)             | no                                                  |
| `supply-chain-summary` | artefatto `hub-supply-chain-summary` (§5.4)                              | no                                                  |
| `harbor`               | scan overview e accessory di Harbor (§5.6)                               | sì (vulnerabilità delle immagini, conteggi esterni) |
| `status-file`          | `.security/project-security-status.json`, invariato                      | sì (conteggi esterni, come oggi)                    |

Precedenza di default (`policies.supplyChain.precedence`; ogni elenco è un sottoinsieme non vuoto, senza duplicati, degli id ammessi per quel controllo):

```yaml
precedence:
  containerScanning: [code-scanning, harbor, status-file]
  iacScanning: [code-scanning, status-file]
  dast: [code-scanning, status-file]
  sbom: [supply-chain-summary, dependency-graph, status-file]
  artifactSignature: [supply-chain-summary, attestations, harbor, status-file]
```

Risoluzione per (repository, controllo), funzione pura `resolveControl(candidates, order)`:

1. Si scorre l'elenco. Vince il primo candidato con stato **definitivo** (`enabled`, `stale`, `failed`).
2. Altrimenti vince il primo candidato con stato `not-authorised`, `collection-failed`, `unknown` o `configured-not-run` (la non-risposta più informativa).
3. Altrimenti `not-configured` (ogni fonte ha detto "non impostato" o era spenta).
4. Una fonte spenta (provider disabilitato, funzione disattivata) viene saltata, non è mai evidenza di `not-configured`.
5. `notApplicableControls` vince ancora su tutto (invariato).

`ControlStatus` aggiunge `source: ControlSource | null` ed `evidence: 'verified' | 'present' | 'reported' | null`:

- `verified`: la CI ha eseguito una verifica e ha riportato successo (`supply-chain-summary`).
- `present`: l'evidenza esiste in GitHub o in Harbor, ma nessuno l'ha verificata in questa esecuzione (`attestations`, firme `harbor`, `dependency-graph`).
- `reported`: risultati di scansione riportati da un tool (`code-scanning`, scansioni `harbor`, `status-file`).

**Conteggi e doppi conteggi.** `externalCounts` (Sicurezza) somma i conteggi dei controlli la cui fonte vincente è `harbor` o `status-file`. Un controllo vinto da `code-scanning` non contribuisce, perché i suoi alert sono già finding. Una fonte perdente non contribuisce mai.

Stato per fonte per ogni controllo:

| Controllo          | Fonte                  | Stato                                                                                                                                                                                                                               |
| ------------------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| container/iac/dast | `code-scanning`        | analisi corrispondente più recente ≤ `securityScanStaleDays` → `enabled`; più vecchia → `stale`; nessuna analisi corrispondente → `not-configured`; 403 → `not-authorised`; altri errori → `unknown`                                |
| containerScanning  | `harbor`               | ogni immagine mappata scansionata (`scan_status` Success) → `enabled` (stale secondo `end_time`); qualsiasi `Error` → `failed`; `Running`/`Pending`/nessuna → `configured-not-run`; 401/403 → `not-authorised`; tag 404 → `unknown` |
| sbom               | `supply-chain-summary` | riepilogo leggibile con blocco `sbom` → `enabled`; riepilogo leggibile senza → `not-configured`; stati del riepilogo come in v0.6.0 (mancante → `not-configured`, altri → `unknown` / `not-authorised`)                             |
| sbom               | `dependency-graph`     | export leggibile → `enabled`; "dependency graph non abilitato" (403/404 con quel messaggio) → `not-configured`; 403 → `not-authorised`; pending, troppo grande, non valido, altro → `unknown`                                       |
| artifactSignature  | `supply-chain-summary` | ogni immagine elencata con `signature.status: verified` → `enabled`; qualsiasi `failed` / `not-verified` → `failed`; qualsiasi `missing` → `not-configured`; nessuna immagine → `not-configured`                                    |
| artifactSignature  | `attestations`         | ogni asset controllato ha ≥ 1 attestazione `provenance` → `enabled`; nessuno → `not-configured`; alcuni → `failed` **(BC)**; asset senza alcun digest → `unknown`; nessuna release o nessun asset → saltata; 403 → `not-authorised` |
| artifactSignature  | `harbor`               | ogni immagine mappata ha un accessory `signature.cosign` o `signature.notation` → `enabled`; nessuna → `not-configured`; alcune → `failed`                                                                                          |

### 5.2 SBOM dal dependency graph (D3)

Raccolto solo con `supplyChain.enabled` (default `true`) **e** `supplyChain.sbom.dependencyGraph` (default **`false`**: opt-in, l'unico punto in cui l'hub chiede a GitHub di eseguire un job; ADR 0009), una volta per repository unico.

**Export spento (il default).** Non viene richiesto nulla. La fonte `dependency-graph` è spenta e saltata (§5.1 regola 4). Il controllo SBOM si risolve da `supply-chain-summary` (l'artefatto CI, conteggi CycloneDX o SPDX) e poi da `status-file`. Senza nessuno dei due, i conteggi SBOM sono sconosciuti (`null`): mai sani e mai 0.

1. **Richiesta:** `GET /repos/{o}/{r}/dependency-graph/sbom/generate-report` (header `X-GitHub-Api-Version: 2026-03-10`). `201 { sbom_url }`. Il collector estrae l'UUID da `sbom_url` con `^…/dependency-graph/sbom/fetch-report/([0-9a-fA-F-]{36})$` e non chiama mai `sbom_url` direttamente.
   - La richiesta parte **presto** per ogni repository, prima delle altre chiamate di quel repository, così GitHub lavora mentre l'hub raccoglie il resto.
2. **Recupero:** dopo le altre chiamate del repository, `GET …/sbom/fetch-report/{uuid}` con `redirect: 'manual'`.
   - `202` → attende `pollIntervalSeconds` (default 5) e riprova, al massimo `pollAttempts` (default 3) volte; ancora `202` → stato `pending` (sconosciuto, mai 0).
   - `302` → legge `Location`. Deve essere `https` e il suo host deve terminare con `githubusercontent.com` o essere `github.com` (costante di codice `SBOM_DOWNLOAD_HOST_SUFFIXES`; **chi implementa registra in `security.md` l'host osservato**). Lo scarica con `fetch` semplice **senza** header Authorization, `redirect: 'error'`, timeout 20 s e un limite di byte in streaming pari a `supplyChain.sbom.maxBytes` (default 16 MiB). Oltre il limite → `too-large`.
3. **Parsing e riepilogo** (funzione pura `summariseSpdx(json, policies)`, `collector/src/normalizers/sbom.ts`), poi il documento viene scartato:
   - Il documento deve avere `spdxVersion` conforme a `^SPDX-2\.\d$` e un array `packages`; altrimenti `invalid` più un errore `invalid-data` con fonte `dependency-sbom`.
   - Il pacchetto radice (quello che il documento `DESCRIBES`, cioè il repository stesso) è escluso dal conteggio.
   - `packages` = pacchetti rimanenti, con limite a 100 000 (oltre → `null`, stato `partial`).
   - Licenza per pacchetto: `licenseConcluded`, altrimenti `licenseDeclared`. `NOASSERTION`, `NONE`, vuota o assente → **senza licenza**.
   - Pubblicazione dell'espressione di licenza: suddivisione su `AND`, `OR`, `WITH`, parentesi. Ogni token deve essere conforme a `^[A-Za-z0-9.+-]{1,64}$` e l'intera espressione ≤ 100 caratteri, altrimenti il pacchetto conta in `otherLicenses`. Qualsiasi token `LicenseRef-…` fa contare l'espressione nel solo gruppo `LicenseRef-*` (i nomi personalizzati possono essere interni) **(BC)**.
   - `licenses`: le prime 10 espressioni per conteggio (a parità, per id), il resto sommato in `otherLicenses`.
   - `ecosystems`: dalla prima voce di `externalRefs` con `referenceType: purl`, tipo `pkg:<type>/…`, mappato tramite allowlist (`npm`, `maven`, `pypi`, `nuget`, `golang`, `cargo`, `gem`, `composer`, `githubactions`, `docker`, `pub`, `swift`, `hex`); altro → `other`; nessun purl → `unknown`.
   - `flagged`: pacchetti la cui espressione contiene un id SPDX in `supplyChain.sbom.flaggedLicenses` (default `[]`, senza distinzione di maiuscole). Solo informativo (§5.8).
   - `generatedAt`: `creationInfo.created` se è una data ISO valida, altrimenti `null`.
4. Errori: 403 con testo "dependency graph … not enabled" → `not-configured`; altro 403 → `not-authorised`; 404 → `unknown` (ambiguo); 5xx / rete → `unknown` più un errore di raccolta. Tutti registrati con fonte `dependency-sbom`.

Budget API: 1 richiesta + ≤ 4 recuperi + 1 download per repository ed esecuzione. Con 50 repository ogni 6 ore resta ampiamente nei limiti. Avviene solo se il proprietario lo attiva.

### 5.3 Attestazioni degli asset di release (D4)

Raccolte quando `supplyChain.attestations.releaseAssets` (default `true`) e il componente ha un'ultima **release** (non il ripiego sul tag).

- `ReleaseDTO` aggiunge `assets: { name, digest }[]` (dalla chiamata all'ultima release che l'hub fa già; nessuna nuova chiamata). `digest` deve essere conforme a `^sha256:[0-9a-f]{64}$`, altrimenti è ignorato.
- Al massimo `supplyChain.attestations.maxAssets` (default 5) asset con digest, ordinati per nome.
- Per asset: `GET /repos/{o}/{r}/attestations/{digest}?predicate_type=provenance&per_page=1` e la stessa con `predicate_type=sbom`. Si conserva solo `attestations.length > 0`. Il `bundle` non viene mai letto né conservato.
- 404 → nessuna per quell'asset (l'endpoint risponde 404 quando nulla corrisponde; un repository sconosciuto è già intercettato dai metadati). 403 → `not-authorised` per il repository (smette di chiamare). Altro → `unknown`.
- Riepilogo del repository: `release` (tag), `checked` (asset con digest), `withProvenance`, `withSbom`, `withoutDigest` (asset saltati perché GitHub non ha dato un digest).

### 5.4 Artefatto di riepilogo CI `hub-supply-chain-summary` (D5)

Stesso lettore e stesse regole di `hub-quality-summary`: l'artefatto non scaduto più recente il cui run ha `head_branch` uguale al branch di default, zip ≤ 64 KB, unica voce `supply-chain-summary.json`, Zod rigoroso, `repository` deve corrispondere (senza distinzione di maiuscole), `generatedAt` più vecchio di `freshness.supplyChainSummaryStaleDays` (default 14) → `stale`. Permesso richiesto: **Actions: read** (già concesso).

Contratto 1.0 (`SupplyChainSummarySchema`, `shared/model/contracts.ts`):

```json
{
  "schemaVersion": "1.0",
  "repository": "example-org/project-alpha-frontend",
  "ref": "refs/heads/main",
  "commitSha": "ae4b58f791cf66bf510c92ca102cc34470fbdf7d",
  "generatedAt": "2026-01-14T10:00:00Z",
  "sbom": {
    "format": "cyclonedx",
    "specVersion": "1.6",
    "tool": "syft",
    "packages": 812,
    "withoutLicense": 9,
    "licenses": [{ "id": "MIT", "count": 640 }],
    "ecosystems": [{ "id": "npm", "count": 812 }]
  },
  "images": [
    {
      "name": "example-org/project-alpha-frontend",
      "tag": "2.2.0",
      "digest": "sha256:<64 hex>",
      "signature": { "status": "verified", "tool": "cosign" },
      "provenance": { "status": "verified", "tool": "gh-attestation" },
      "sbomAttestation": { "status": "missing" }
    }
  ]
}
```

- `sbom` opzionale. `format: cyclonedx | spdx`, `specVersion` `^\d+\.\d+(\.\d+)?$`, `tool` ≤ 40 caratteri, conteggi interi ≥ 0 con `withoutLicense ≤ packages`, `licenses` ≤ 20 voci (`id` validato come le espressioni di §5.2, `LicenseRef-…` raggruppate in `LicenseRef-*`), `ecosystems` ≤ 20 (allowlist di §5.2).
- `images` opzionale, ≤ 10. `name`: path del repository OCI **senza host del registry** (`^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$`, ≤ 200, più un refine: con più segmenti, il primo non deve contenere `.` o `:` e non deve essere `localhost`, la regola con cui Docker riconosce un host di registry); `tag` `^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$` opzionale; `digest` `^sha256:[0-9a-f]{64}$`.
- Stati di verifica: `verified | not-verified | failed | missing`. `tool`: `cosign | notation | gh-attestation | other`.
- Chiavi extra ovunque → `invalid`. Solo conteggi ed esiti di verifica: niente chiavi, certificati, identità o voci Rekor.
- Un riepilogo per repository, condiviso da ogni componente che vi risiede (come per Qualità).
- La documentazione dà un esempio CI minimo (§5.12): syft → CycloneDX → conteggi con `jq`; `cosign verify` e `gh attestation verify oci://…` con `continue-on-error` mappati sugli stati; upload con `actions/upload-artifact`, `retention-days: 30`, solo branch di default.

### 5.5 Trivy, Checkov e ZAP come tool di code scanning (D6)

```yaml
supplyChain:
  toolControls:
    containerScanning: [{ tool: Trivy }]
    iacScanning: [{ tool: Checkov }]
    dast: [{ tool: ZAP }]
```

- Ogni regola è `{ tool: string ≤ 50, category?: string ≤ 100 }`. `tool` corrisponde al nome del tool di code scanning senza distinzione di maiuscole; `category`, se presente, deve essere un prefisso della categoria di analisi / alert (per esempio `{ tool: Trivy, category: trivy-config }` sotto `iacScanning`). Un tool può comparire sotto più controlli solo con categorie diverse; un refine rifiuta le regole ambigue.
- Chiamate: per ogni tool distinto nelle regole, `GET /repos/{o}/{r}/code-scanning/analyses?tool_name=<tool>&per_page=10&ref=refs/heads/<branch di default>` (Code scanning alerts: read, già concesso), memorizzata per repository. Generalizza la chiamata Scorecard di v0.8.0 (`listCodeScanningAnalyses(repo, tool, ref)`).
- Gli alert non vengono richiesti di nuovo: `CodeScanningAlertDTO` aggiunge `category` (da `most_recent_instance.category`) e l'elenco esistente viene filtrato per tool e categoria.
- I finding di un tool mappato ricevono `category` `container`, `iac` o `dast` invece di `code`. Per il resto nulla cambia (severità, SLA, eccezioni, "Cosa è cambiato").
- La sezione elenca anche ogni tool visto negli alert del repository che non è mappato e non è CodeQL / Scorecard, come "altri tool" (solo nomi, ripuliti, max 10), così l'owner può aggiungere una regola.

### 5.6 Provider esterni (D7, D8, D9)

`<configDir>/providers.yaml` (opzionale; assente = tutto spento; JSON Schema `config/schema/providers.schema.json`):

```yaml
# yaml-language-server: $schema=./schema/providers.schema.json
schemaVersion: '1.0'
sonarqube:
  enabled: false
  baseUrl: https://sonarqube.example.com # https, nessun path oltre un context root opzionale, nessuna credenziale
  timeoutSeconds: 20 # 1–60
  maxItems: 200 # chiavi di progetto per esecuzione (1–1000)
harbor:
  enabled: false
  baseUrl: https://harbor.example.com
  timeoutSeconds: 20
  maxItems: 200 # riferimenti di immagine per esecuzione
argocd:
  enabled: false
  baseUrl: https://argocd.example.com
  timeoutSeconds: 20
  maxItems: 200 # applicazioni per esecuzione
```

- Refine di `baseUrl`: solo `https:`, nessun username/password, nessuna query o fragment, path `^(/[A-Za-z0-9._-]+)*/?$`. `enabled: true` richiede `baseUrl`.
- Il file è caricato da `loadConfig` e non viene mai pubblicato. In `index.run.providers` arrivano solo `enabled` e lo stato risultante del provider.
- Sorgente mock: `fixtures/providers/providers.yaml` (D12).

**Mappature nel catalogo** (file di progetto; tutte opzionali):

| Dove                    | Campo                                                                          | Usato da  |
| ----------------------- | ------------------------------------------------------------------------------ | --------- |
| coordinator, componente | `sonarProjectKey: string` (`^[A-Za-z0-9_.:-]{1,400}$`), `sonarBranch?: branch` | SonarQube |
| coordinator, componente | `containerImages: [{ project, repository, tagTemplate? }]` (max 5)             | Harbor    |
| ambiente                | `argocdApplication: { name, namespace?, project? }`                            | Argo CD   |

- Harbor `project` `^[a-z0-9]+(?:[._-][a-z0-9]+)*$`; `repository` path OCI (regex di §5.4). `tagTemplate` default `{version}`, deve contenere `{version}`, gli altri caratteri `[A-Za-z0-9._-]`. Il riferimento è l'`effectiveVersion` del componente (per il coordinator: la sua versione) resa con il template; versione sconosciuta → stato immagine `unknown` senza chiamata.
- Argo CD `name` e `namespace` `^[a-z0-9]([-a-z0-9]*[a-z0-9])?$` (≤ 253), `project` uguale.
- `catalog.json` pubblica il catalogo come oggi, quindi queste mappature sono pubbliche nella demo pubblica (sintetiche). La documentazione lo dice: contengono nomi, mai host o credenziali.

**Client condiviso** (`collector/src/providers/external/http.ts`):

- `createExternalClient({ id, baseUrl, timeoutSeconds, authHeader, fetch? })` restituisce `getJson(pathTemplate, params, query)`.
  - L'URL è `baseUrl` + un path costruito da un template fisso con ogni parametro codificato con `encodeURIComponent` (i nomi di repository Harbor due volte). L'host risultante deve essere uguale all'host di `baseUrl`, altrimenti lancia un errore prima di qualsiasi richiesta.
  - `redirect: 'error'`, `AbortSignal.timeout(timeoutSeconds × 1000)`, `Accept: application/json`, `User-Agent: engineering-project-hub-collector`.
  - Il corpo è letto in streaming con un limite di 1 MiB → oltre il limite `invalid-data`.
  - Classificazione: 401 / 403 → `not-authorised`; 404 → `not-found`; 429 → `rate-limited`; altri ≥ 400, rete, timeout → `error`; errore di parsing JSON o di Zod sulla proiezione → `invalid-data`.
  - Non scrive mai log, e i suoi errori portano solo `{ classification, httpStatus, message }` con un messaggio fisso per classe (mai il corpo della risposta, mai l'URL).
- Concorrenza: un limitatore di 2 per provider; al massimo `maxItems` elementi per esecuzione (elementi in eccesso → `unknown` con dettaglio "cap reached").
- Credenziali (`resolveProviderAuth(providers, env)`, `collector/src/providers/external/auth.ts`):
  - SonarQube: `SONARQUBE_TOKEN` → `Authorization: Bearer …`.
  - Harbor: `HARBOR_ROBOT_NAME` e `HARBOR_ROBOT_SECRET` → `Authorization: Basic base64(name:secret)`. Uno senza l'altro è un errore di configurazione (exit 1), come una GitHub App parziale.
  - Argo CD: `ARGOCD_TOKEN` → `Authorization: Bearer …`.
  - Abilitato senza credenziale → D9. Disabilitato → le variabili sono ignorate.
  - `sensitiveEnvValues()` (`shared/security/patterns.ts`) aggiunge i quattro nomi, così il gate di pubblicazione e `scan-output` intercettano un valore trapelato.
- `collect-data.yml`: quattro nuovi secret `workflow_call` opzionali e secret di repository mappati solo nell'`env` dello step `Collect`, con lo stesso commento "mai stampati". `vars.PROVIDERS_CONFIG` non viene aggiunto: `providers.yaml` sta nella directory di configurazione (il repository di deploy privato per i dati reali).

**Provider SonarQube** (`collector/src/providers/external/sonarqube.ts`), per chiave mappata:

1. `GET /api/measures/component?component=<key>&metricKeys=alert_status,lines_to_cover,uncovered_lines,new_coverage[&branch=<sonarBranch>]`.
2. `GET /api/project_analyses/search?project=<key>&ps=1[&branch=…]` → `analyses[0].date` (normalizzata `+0100` → `+01:00`) e `revision` (40 hex o null).

- DTO `SonarProjectDTO { linesToCover: number|null, uncoveredLines: number|null, newCoverage: number|null, qualityGate: 'OK'|'ERROR'|null, analysedAt: string|null, revision: string|null }`. `new_coverage` si legge da `value`, poi `period.value`, poi `periods[0].value`.
- Mappatura su un report di qualità: `linesValid = lines_to_cover`, `linesCovered = lines_to_cover − uncovered_lines` (entrambi obbligatori, `0 ≤ uncovered ≤ lines_to_cover`, altrimenti `invalid`); `generatedAt = analysedAt`; `commitSha = revision`; `tool = 'sonarqube'`; obsolescenza secondo `qualityReportStaleDays`. 404 → `missing`; 401 / 403 → `not-authorised`.

**Provider Harbor** (`collector/src/providers/external/harbor.ts`), per riferimento di immagine mappato:

- `GET /api/v2.0/projects/{project}/repositories/{repository}/artifacts/{reference}?with_scan_overview=true&with_accessory=true&with_tag=false` con header `X-Accept-Vulnerabilities: application/vnd.security.vulnerability.report; version=1.1, application/vnd.scanner.adapter.vuln.report.harbor+json; version=1.0`.
- DTO `HarborArtifactDTO { digest, scan: { status, endTime, critical, high, medium, low, unknown, fixable, total } | null, signatures: { cosign: boolean, notation: boolean } }`. Si usa la prima voce della scan overview; le severità `Critical/High/Medium/Low` vanno sulla scala dell'hub e `Negligible/Unknown/None` su `unknown`.
- Stato immagine: `scanned`, `scan-failed`, `scan-pending`, `not-scanned`, `not-found` (404), `not-authorised`, `unknown`.

**Provider Argo CD** (`collector/src/providers/external/argocd.ts`), per ambiente mappato:

- `GET /api/v1/applications/{name}[?appNamespace=…][&project=…]`. **Mai** `refresh`.
- DTO `ArgoApplicationDTO { sync: string|null, health: string|null, revision: string|null, targetRevision: string|null, images: string[], deployedAt: string|null }`, proiettato da `status.sync.status`, `status.health.status`, `status.sync.revision`, `spec.source.targetRevision` (o `spec.sources[0]`), `status.summary.images` (≤ 50), e `status.operationState.finishedAt` con ripiego sull'ultimo `status.history[].deployedAt`. Nient'altro (`repoURL`, destinazione, risorse, condizioni) viene proiettato.

### 5.7 Qualità con SonarQube (D10)

`policies.quality` aggiunge:

```yaml
quality:
  sources: [ci-summary, sonarqube] # ordine = precedenza; una o entrambe
  qualityGateFailed: info # info | amber: un quality gate Sonar non superato
```

- Chiave del report: un componente con `sonarProjectKey` (e Sonar abilitato) ha due report candidati: il riepilogo CI del repository (chiave `repo:<repository>`) e il suo progetto Sonar (chiave `sonar:<key>`). Senza chiave ha solo il riepilogo CI.
- Selezione per componente: il primo candidato `readable` nell'ordine di `sources`; altrimenti il primo `stale`; altrimenti il primo candidato in questo ordine di stati: `not-authorised`, `invalid`, `expired`, `unknown`; altrimenti `missing`.
- L'aggregazione avviene sulle **chiavi di report uniche** dei report selezionati (v0.6.0 sommava i repository unici). Un monorepo con un solo riepilogo CI conta ancora una volta; due componenti con chiavi Sonar diverse nello stesso repository contano separatamente.
- Le righe `perComponent` aggiungono `source: 'ci-summary' | 'sonarqube' | null` e `qualityGate: 'passed' | 'failed' | null` (da Sonar ogni volta che una chiave è mappata e leggibile, anche se la coverage arriva dal riepilogo CI), e `newCoverage: percentage | null`. `sharedRepository` ora significa "report condiviso".
- Nuovo motivo `quality-gate-failed` (livello `quality.qualityGateFailed`, default `info`, `params.components`).
- Gli errori Sonar `not-authorised` / `unknown` sono errori di raccolta con fonte `sonarqube`.

### 5.8 Motivi di Sicurezza e Copertura controlli

Nuovi motivi di Sicurezza (dopo i motivi di severità esistenti, prima di `coverage-incomplete`):

| Codice                           | Livello (policy, default `info`)      | Quando                                                                                          |
| -------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `supply-chain-unsigned-artifact` | `supplyChain.levels.unsignedArtifact` | qualsiasi immagine o asset di release con firma/provenance `missing`, `not-verified` o `failed` |
| `supply-chain-flagged-license`   | `supplyChain.levels.flaggedLicense`   | qualsiasi repository con `flagged > 0`                                                          |

- `params`: `{ count, repositories }` (separati da virgola, max 10 poi "+N").
- I motivi di Copertura controlli non cambiano nel codice: i controlli portano semplicemente stati migliori. Un controllo obbligatorio risolto in `unknown` / `not-authorised` è già riportato lì (`required-control-unknown`, `required-control-not-authorised`), quindi Sicurezza non aggiunge un motivo.
- Con le policy di default ogni nuovo livello è `info`, quindi nessuno stato cambia. Il `config/policies.yaml` della demo imposta `flaggedLicenses: [GPL-3.0-only, AGPL-3.0-only]` (informativo) e lascia i livelli a `info`.

### 5.9 Versioni con Argo CD (D11)

`EnvironmentSnapshotSchema` diventa:

```ts
{
  id, name,
  version: string | null,              // effettiva: distribuita se nota, altrimenti dichiarata
  declaredVersion: string | null,      // manifest
  source: 'argocd' | 'manifest' | 'unknown',
  status: 'aligned' | 'behind' | 'mismatch' | 'unknown',   // versione effettiva vs coordinator
  deployment: null | {                 // null se nessuna argocdApplication è mappata o Argo CD è spento
    state: 'available' | 'not-authorised' | 'not-found' | 'unknown',
    sync: 'synced' | 'out-of-sync' | 'unknown' | null,
    health: 'healthy' | 'progressing' | 'degraded' | 'suspended' | 'missing' | 'unknown' | null,
    revision: string | null,           // SHA corto di 7 caratteri, o un ref simile a una versione
    version: string | null,
    deployedAt: isoDate | null,
    images: { componentId: string, version: string | null }[],   // max 20
  },
}
```

- Versione distribuita: `normaliseVersion(targetRevision)` quando è interpretabile come versione; altrimenti `revision` (40 hex) risolta in un tag del coordinator tramite i dati `listTags` esistenti; altrimenti `null` **(BC)**.
- `images`: ogni voce `host/path:tag` di `status.summary.images` il cui path (senza host) è uguale al `<project>/<repository>` mappato di un componente; tag → `normaliseVersion`. Le immagini non corrispondenti vengono scartate (mai pubblicate).
- Nuovi motivi di Versioni: `environment-out-of-sync` (livello `version.environmentOutOfSync`, default `info`), `environment-degraded` (`version.environmentDegraded`, default `info`), `environment-deployment-unknown` (`info`, Argo CD mappato ma non leggibile). Gli esistenti `environment-behind` / `environment-mismatch` usano la versione effettiva.
- 403 / 404 / errori di Argo CD sono errori di raccolta con fonte `argocd` e l'id dell'`environment` in `detail`.

### 5.10 Modello dello snapshot (schema 1.6 → 1.7)

`shared/model/enums.ts`:

- `SNAPSHOT_SCHEMA_VERSION = '1.7'`, `SUPPORTED = ['1.7']`, commento di storia `1.7: supply chain evidence, external providers, deployed environments`.
- `ControlSourceSchema`, `ControlEvidenceSchema`, `ProviderIdSchema = z.enum(['sonarqube','harbor','argocd'])`, `ProviderStateSchema = z.enum(['off','available','partial','not-authorised','unknown'])`.
- `CapabilitySchema` aggiunge `dependencyGraph`, `attestations` (GitHub); i provider esterni stanno in `run.providers`, non nelle capability.
- Codici motivo: i due di §5.8, `quality-gate-failed`, i tre di §5.9.

`shared/model/snapshot.ts`:

```ts
ControlStatusSchema aggiunge: source: ControlSourceSchema.nullable(), evidence: ControlEvidenceSchema.nullable()

SupplyChainSchema = z.object({
  enabled: z.boolean(),
  collectedAt: isoDate,
  totals: z.object({
    repositories, sbomAvailable, signedImages, unsignedImages, attestedAssets, flagged: nullableCount,
  }).strict(),
  repositories: z.array(z.object({
    componentIds: z.array(z.string().max(64)).min(1),
    repository: z.string().max(200),
    sbom: z.object({
      state: z.enum(['available','partial','not-configured','not-authorised','pending','too-large','invalid','unknown','off']),
      source: z.enum(['supply-chain-summary','dependency-graph']).nullable(),
      format: z.enum(['spdx','cyclonedx']).nullable(),
      specVersion: z.string().max(20).nullable(),
      generatedAt: isoDate.nullable(),
      packages: nullableCount, withoutLicense: nullableCount, flagged: nullableCount,
      licenses: z.array(z.object({ id: z.string().max(100), count: int ≥ 0 }).strict()).max(10),
      otherLicenses: int ≥ 0,
      ecosystems: z.array(z.object({ id: EcosystemSchema, count: int ≥ 0 }).strict()).max(16),
    }).strict(),
    attestations: z.object({
      state: z.enum(['available','none','not-authorised','unknown','not-applicable','off']),
      release: z.string().max(100).nullable(),
      checked: int ≥ 0, withProvenance: nullableCount, withSbom: nullableCount, withoutDigest: int ≥ 0,
    }).strict(),
    images: z.array(z.object({
      componentId: z.string().max(64),
      source: z.enum(['supply-chain-summary','harbor']),
      name: z.string().max(200).nullable(),          // null = nascosto (pubblico, repo non pubblico)
      tag: z.string().max(128).nullable(),
      digest: z.string().regex(/^sha256:[0-9a-f]{64}$/).nullable(),
      signature: z.enum(['verified','present','missing','not-verified','failed','unknown']),
      provenance: z.enum(['verified','present','missing','not-verified','failed','unknown']),
      scan: z.object({
        state: z.enum(['scanned','scan-failed','scan-pending','not-scanned','not-found','not-authorised','unknown']),
        scannedAt: isoDate.nullable(),
        counts: SeverityCountsSchema.nullable(),
        fixable: nullableCount,
      }).strict().nullable(),                         // null per le immagini del riepilogo CI
    }).strict()).max(20),
    tools: z.array(z.object({
      control: z.enum(['containerScanning','iacScanning','dast']),
      tool: z.string().max(50),
      state: ControlStateSchema,
      lastAnalysisAt: isoDate.nullable(),
      open: SeverityCountsSchema.nullable(),
    }).strict()).max(10),
    otherTools: z.array(z.string().max(50)).max(10),
    summary: z.object({                               // hub-supply-chain-summary
      state: z.enum(['readable','stale','missing','expired','invalid','not-authorised','unknown','off']),
      generatedAt: isoDate.nullable(), commitSha: sha.nullable(), runUrl: httpsUrl.nullable(),
    }).strict(),
  }).strict()).max(200),
}).strict();
```

Altre modifiche:

- `ProjectSnapshot.supplyChain: SupplyChainSchema`.
- `ProjectSummary.supplyChain: { sbomAvailable, repositories, unsignedImages, flagged }` (conteggi, `nullableCount` dove sconosciuti).
- `QualityHealth.perComponent[]` aggiunge `source`, `qualityGate`, `newCoverage` (§5.7).
- `EnvironmentSnapshotSchema` come in §5.9.
- `RunMetadataSchema` aggiunge `providers: Record<ProviderId, { enabled: boolean, state: ProviderState, items: int ≥ 0, errors: int ≥ 0 }>`.
- `CollectionErrorSchema.source` aggiunge `dependency-sbom`, `attestations`, `supply-chain-summary`, `code-scanning-analyses` (salvo che il `scorecard-analysis` di v0.8.0 venga generalizzato in questo), `sonarqube`, `harbor`, `argocd`.
- `dataFreshness.staleSources[].source` aggiunge `supply-chain-summary` e `sonarqube`.
- Il `name` delle immagini è nascosto (null) con `publication.audience: public` per i repository non pubblici (regola v0.8.0 D9). Digest, tag, stati e conteggi restano.
- `collection-report.md` aggiunge una riga: `Providers: sonarqube available (6 items) · harbor available (4) · argocd partial (5, 1 error)` oppure `Providers: all off`.

### 5.11 Storico, "Cosa è cambiato" e CSV (D13)

- Lo storico resta **1.2**. Le nuove evidenze non sono una dimensione; gli spostamenti di stato delle dimensioni compaiono già nella pagina "Cosa è cambiato".
- `versions.csv`: colonne aggiunte in fondo: `environment_source`, `declared_version`, `sync_status`, `health_status`. `n/a` per le righe che non sono ambienti; `unknown` per null.
- Nuovo `exports/supply-chain.csv`, collegato dalla pagina Sicurezza: una riga per progetto × repository: `project_id, repository, component_ids, sbom_state, sbom_source, packages, without_license, flagged, attestation_state, assets_checked, assets_with_provenance, images, images_signed, images_unsigned, container_scanning_source, iac_scanning_source, dast_source, summary_state`. Stesse regole di codifica di v0.7.0 (BOM, CRLF, `unknown`, protezione dalle formule). `component_ids` uniti con `;`.

### 5.12 UI (Warm Graphite, EN + IT)

Regole comuni: ogni stato ha testo e simbolo; "presente" e "verificata" sono parole e simboli distinti (◇ presente, ◆ verificata, ✕ mancante/fallita, ? sconosciuto con contorno tratteggiato, – non applicabile); i conteggi non sono mai mostrati senza il loro stato; i conteggi sconosciuti sono "?" mai "0".

**Pagina di progetto:** un nuovo `<details id="supply-chain" class="fold disclosure">` dopo Copertura controlli (e Controlli repository di v0.8.0), prima di Qualità.

- Riga di riepilogo: "SBOM su {n} di {m} repository · {k} immagini non firmate · {f} licenze segnalate".
- Riquadri: SBOM (pacchetti, senza licenza), Firme (verificate / presenti / mancanti), Vulnerabilità delle immagini (conteggi Harbor, o "non configurato"), Scanner (stati di Trivy · Checkov · ZAP).
- Tabella per repository: SBOM (badge di fonte "Grafo delle dipendenze" / "Riepilogo CI", pacchetti, senza licenza), Attestazioni ("2 di 3 asset con provenance"), Immagini (nome o nascosto · tag · firma · provenance · scansione), Tool.
- Elenco licenze: le licenze principali come piccoli token di codice con conteggi; `LicenseRef-*` spiegato in un tooltip.
- Legenda: "Presente: la firma o l'attestazione esiste in GitHub o nel registry. Verificata: la CI l'ha verificata con cosign o gh attestation. L'hub non verifica mai le firme da solo. Sconosciuto non vuol dire non firmato."
- La tabella Copertura controlli mostra una piccola etichetta di fonte sotto ogni stato di controllo non nativo ("da Trivy", "da Harbor", "da riepilogo CI", "file di stato").

**Pagina Sicurezza:**

- Ogni scheda di progetto aggiunge una riga "Catena di fornitura: SBOM {n}/{m} · non firmate {k}".
- Nuovo fold "Supply chain" / "Catena di fornitura" (`id="supply-chain"`): una riga per repository tra tutti i progetti con le stesse colonne della tabella di progetto, condensate, e un link CSV (`exports/supply-chain.csv`). Sui telefoni, il pattern `data-label` esistente.

**Sezione Qualità:** una colonna "Fonte" ("Riepilogo CI" / "SonarQube"), una pillola di quality gate ("Gate superato" / "Gate non superato"), la coverage del codice nuovo come testo secondario.

**Pagina Versioni:** ogni cella di ambiente mostra la versione effettiva, un badge di fonte ("Argo CD" / "Manifest") e, quando Argo CD è mappato, le pillole di sync e health ("Sincronizzata" / "Non sincronizzata"; "Integra" / "In corso" / "Degradata" / …), "dichiarata {v}" quando differisce, e le immagini dei componenti distribuite in una disclosure.

**Pagina Qualità dei dati:** una scheda "Provider": SonarQube / Harbor / Argo CD con Spento / Disponibile / Parziale / Non autorizzato / Sconosciuto e i conteggi di elementi ed errori; le capability `dependencyGraph` e `attestations`; elenchi dei repository con SBOM in attesa / troppo grande / non valido e dei riepiloghi di catena di fornitura non validi.

**Come leggere:** una nuova sezione `#supply-chain` "Supply chain evidence" / "Evidenze di catena di fornitura": fonti e precedenza, presente vs verificata, perché sconosciuto non vuol dire non firmato, conteggi SBOM e `LicenseRef-*`; la voce Qualità cita SonarQube e la precedenza; la voce Versioni spiega dichiarata vs distribuita.

**Design-first (regola fissa dell'owner):** il fold Catena di fornitura, la cella di ambiente di Versioni e la scheda Provider di Qualità dei dati vengono disegnati come artboard Warm Graphite nel canvas di Claude Design prima del codice. L'owner rivede dopo la consegna, quindi questo non blocca. Dopo la build, il canvas e il README del DS vengono aggiornati. Nessun link ad artifact entra nel repository.

### 5.13 Dati mock (sintetici; valori esatti nel piano, Task 8)

`GOLDEN_NOW = 2026-01-15T12:00:00.000Z`. I provider esterni sono abilitati solo da `fixtures/providers/providers.yaml`. Le righe del dependency graph qui sotto richiedono l'opt-in: il `config/policies.yaml` della demo (la sorgente mock legge solo fixture, quindi nulla viene richiesto a GitHub) imposta esplicitamente `supplyChain.sbom.dependencyGraph: true`, con un commento che dice che un'installazione reale lo tiene `false` salvo accettare l'eccezione dell'ADR 0009.

| Repository / elemento | SBOM                                                                                                                                                                                    | Attestazioni / immagini                                                                      | Tool / provider                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| alpha-backend         | dependency graph: 214 pacchetti, 6 senza licenza, maven                                                                                                                                 | asset della release v1.4.0 con digest: provenance ✓ sbom ✓; immagine del riepilogo firmata ◆ | Harbor `alpha/backend:1.4.0` scansionata 0/0/2/6, cosign presente; Sonar 6900/8000 gate OK (vince il riepilogo CI) |
| alpha-frontend        | riepilogo CI CycloneDX: 812 pacchetti, 9 senza licenza, 3 `LicenseRef-*`, npm                                                                                                           | firma dell'immagine del riepilogo ◆, provenance ◆                                            | analisi ZAP `@now-10d` → dast stale; tag Harbor non trovato                                                        |
| alpha-worker          | dependency graph in attesa (tre 202) → sconosciuto                                                                                                                                      | asset di release senza digest → sconosciuto                                                  | —                                                                                                                  |
| beta-api              | dependency graph 403 → non autorizzato                                                                                                                                                  | attestazioni 403; firma dell'immagine del riepilogo `missing`                                | analisi Checkov `@now-3d` con 1 alert low (iac); scansione Harbor in corso, nessuna firma                          |
| beta-web              | non abilitato → non configurato                                                                                                                                                         | —                                                                                            | Sonar 1950/3000 = 65 %, gate ERROR, codice nuovo 41.2 %                                                            |
| platform-mono         | dependency graph: 1 530 pacchetti (npm 1 480, githubactions 50), 2 GPL-3.0-only (segnalati)                                                                                             | nessun asset di release                                                                      | analisi Trivy `@now-1d`, categoria `trivy-image`, 0 alert                                                          |
| gamma-service         | repository non disponibile → sconosciuto                                                                                                                                                | —                                                                                            | Sonar 403 → non autorizzato                                                                                        |
| Argo CD               | alpha dev `v1.4.0` Synced/Healthy; alpha uat `HEAD`, revisione sconosciuta, OutOfSync/Progressing; alpha prod `v1.3.0` Synced/Healthy; beta prod `v3.1.0` Synced/Degraded; beta dev 403 |                                                                                              |                                                                                                                    |

Storia golden risultante:

- **Stato complessivo e punteggio di ogni progetto restano invariati** rispetto ai golden di v0.9.0 (tutti i nuovi livelli `info`).
- Alpha: containerScanning su alpha-backend ora è vinto da Harbor (medium 2, low 6 invece dei 1 / 3 del file di stato); Sicurezza resta ambra. uat mostra `environment-out-of-sync`.
- Beta: Qualità 8404 / 12600 = **66.7 %**, ambra (era 67.2 % con web mancante); `quality-report-missing` sparisce, compare `quality-gate-failed` (web) a `info`. Un finding low in più (Checkov, categoria `iac`). `supply-chain-unsigned-artifact` a `info`. prod `environment-degraded`; deployment di dev `not-authorised`, versione dal manifest.
- Platform: containerScanning `enabled` via code scanning (Trivy, non obbligatorio); `supply-chain-flagged-license` a `info`.
- Gamma: Qualità resta grigia; la sua riga di componente dice `not-authorised` (Sonar) invece di `unknown`.
- Canary: un nome di pacchetto SPDX `canary-internal-pkg-7f3a`, una licenza `LicenseRef-canary-acme-9b2e`, un `repoURL` di Argo CD `https://git.internal.example/canary-6c1d.git`, un'immagine Argo CD non corrispondente `registry.internal.example/canary-img-4d2e:1.0` e un nome di scanner Harbor che contiene `ghp_` + 36 caratteri non compaiono mai nell'output.

### 5.14 Documentazione (EN + IT)

- `configuration.md`: `providers.yaml`; catalogo `sonarProjectKey`, `sonarBranch`, `containerImages`, `argocdApplication`; policy `supplyChain`, `quality.sources`, `quality.qualityGateFailed`, `version.environmentOutOfSync`, `version.environmentDegraded`, `freshness.supplyChainSummaryStaleDays`; il contratto del riepilogo di catena di fornitura e il suo JSON Schema.
- `security.md`: le righe della tabella dei permessi (Contents: read per l'export SBOM, **Attestations: read** nuovo, Actions: read per il riepilogo, Code scanning alerts: read per le analisi), ogni credenziale esterna (`SONARQUBE_TOKEN`: user token di un utente dedicato con solo Browse; `HARBOR_ROBOT_NAME` / `HARBOR_ROBOT_SECRET`: robot di progetto con Read Artifact, Read Scan, List Accessory; `ARGOCD_TOKEN`: account locale solo `apiKey` con `applications, get`), cosa non viene mai pubblicato, l'host di download SBOM osservato, il confine di fiducia, la rotazione, e la data di verifica e le fonti.
- `operations.md`: come abilitare ogni provider; i secret GitHub; esempi CI per `hub-supply-chain-summary` (syft, cosign, gh attestation) e per l'upload SARIF di Trivy / Checkov / ZAP con i nomi di tool attesi; come leggere la scheda Provider.
- `architecture.md`: flusso dei dati, precedenza delle fonti, il client esterno e le righe del confine di fiducia; snapshot 1.7.
- README / README.it: testo delle dimensioni (fonti), Viste, roadmap: rimuovere le sei voci di catena di fornitura.
- `PRODUCT.md`, `DESIGN.md`: il fold Catena di fornitura, i simboli presente vs verificata, la cella di ambiente.
- `CHANGELOG.md`; ADR 0009 e ADR 0010 (EN + IT).

## 6. Test (sintesi; casi esatti nel piano)

- **Unit, modello:** file dei provider (solo https, host, enabled richiede baseUrl), mappature del catalogo (regex, `tagTemplate`), default delle policy e refine della precedenza, contratto del riepilogo (chiavi extra, regex del digest, raggruppamento `LicenseRef`), il test di drift dei JSON Schema (v0.9.0) copre i nuovi schemi.
- **Unit, SBOM:** pacchetto radice escluso, ripiego della licenza e `NOASSERTION`, tokenizzazione delle espressioni, `LicenseRef-*`, prime 10 + altre, ecosistemi dal purl, segnalati, documento non valido, limite di 100 000, nomi dei pacchetti mai nel risultato.
- **Unit, risoluzione:** ogni riga delle tabelle di §5.1; ordine di precedenza; fonti spente saltate; `code-scanning` non aggiunge mai conteggi esterni.
- **Unit, qualità:** regole di selezione, chiavi di report uniche, monorepo, mappatura Sonar (`uncovered > lines_to_cover` → invalid), livello del motivo del gate.
- **Unit, versioni:** distribuita vs dichiarata, risoluzione di uno SHA in tag, immagini non corrispondenti scartate, livelli dei motivi.
- **Provider, GitHub:** generate → fetch 202 ×3 → pending; 302 verso un host non ammesso → sconosciuto senza download; download senza header Authorization; limite di byte; chiamate alle attestazioni con `predicate_type`; analisi con `tool_name` e `ref`.
- **Provider, client esterno:** blocco dell'host (un `{param}` con `../` o `@evil` non può cambiare l'host), `redirect: 'error'`, timeout, limite di 1 MiB, tabella di classificazione, nessun corpo o URL negli errori, doppia codifica Harbor, Argo CD non invia mai `refresh`.
- **Integrazione:** storia golden di §5.13, stato complessivo e punteggio invariati, blocco providers dell'esecuzione, canary bloccati, schema 1.7, riga del report, provider disabilitati → nessuna fetch esterna (spia su fetch).
- **Sito / e2e:** fold Catena di fornitura, legenda, fold e CSV della pagina Sicurezza, badge e pillole di Versioni, scheda Provider di Qualità dei dati, sezione Come leggere, stringhe IT, nessun overflow orizzontale a 412 px.

## 7. Rischi

- **La richiesta di export SBOM è una chiamata di "calcolo".** Non cambia nulla nel repository, ma chiede a GitHub di eseguire un job. L'ADR 0009 la registra come unica eccezione. Per questo è **spenta di default**: il proprietario la attiva con `supplyChain.sbom.dependencyGraph: true`.
- **Host di download non documentato.** L'host di destinazione del 302 non è documentato. L'allowlist per suffisso fallisce in modo chiuso (`unknown`), e chi implementa registra l'host osservato.
- **Latenza asincrona.** Un export lento resta `pending` (sconosciuto) per quell'esecuzione. Il polling è limitato (≤ 3 × 5 s per repository, sovrapposto alle altre chiamate).
- **Presenza non è verifica.** Un'attestazione presente in GitHub potrebbe in teoria appartenere a un altro workflow; la UI dice "presente", solo gli esiti della CI dicono "verificata".
- **Nomi interni in `catalog.json`.** Progetti Harbor, chiavi Sonar e nomi di app Argo CD vengono pubblicati con il catalogo. Per i dati reali usare il setup di deploy privato (`audience: restricted`), come la documentazione già consiglia.
- **Migrazione di SonarQube Cloud all'API v2.** `project_status` è deprecato su Cloud; l'hub usa measures e analyses, che non lo sono. La documentazione nota che Server e Cloud potrebbero passare alla Web API v2.
- **Drift con v0.7.0–v0.9.0.** Struttura dei file (`primitives.ts`, metodo delle analisi, enum di livello, `countsAsOpen`, helper CSV) e numeri di versione (snapshot 1.7, ADR 0009–0010) possono cambiare. Il piano dice: prendere il primo numero libero e adattarsi.

## 8. Lasciato al builder (chi implementa)

- Markup Astro esatto del fold Catena di fornitura e della cella di ambiente, seguendo i pattern Warm Graphite.
- Nomi degli helper interni oltre alle interfacce del piano.
- Se il download SBOM con limite di byte usa il reader di `Response.body` o `node:stream`.
- Se Harbor e Argo CD condividono un modulo o due.

## 9. Fonti (verificate il 2026-10-21)

- SBOM REST (export, avviso di chiusura 13 nov 2026, generate-report 201 `sbom_url`, fetch-report 202 / 302, conservazione di una settimana): <https://docs.github.com/en/rest/dependency-graph/sboms>
- Permessi fine-grained (endpoint SBOM: Contents read; attestazioni di repository: Attestations read; asset di release: Contents read; alert di code scanning: Code scanning alerts read): <https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens>; permessi GitHub App (stessi nomi): <https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps>
- Attestazioni di repository (`GET /repos/{o}/{r}/attestations/{subject_digest}`, `predicate_type`, campi della risposta, "should be cryptographically verified"): <https://docs.github.com/en/rest/repos/attestations>; attestazioni utente: <https://docs.github.com/en/rest/users/attestations>
- Asset di release (campo `digest`): <https://docs.github.com/en/rest/releases/assets>
- Nome driver SARIF di Trivy `Trivy`: <https://github.com/aquasecurity/trivy/blob/main/pkg/report/sarif.go>
- Nome driver SARIF di Checkov `Checkov`, `--custom-tool-name`: <https://www.checkov.io/8.Outputs/SARIF.html>
- Report SARIF di ZAP (driver `ZAP`, contenuto di `webRequest` / `webResponse`): <https://www.zaproxy.org/docs/desktop/addons/report-generation/report-sarif-json/>
- Web API di SonarQube (Bearer con user token, Browse per measures): <https://docs.sonarsource.com/sonarqube-server/extension-guide/web-api>; definizioni delle metriche (`alert_status`, `lines_to_cover`, `uncovered_lines`, `line_coverage`, `new_coverage`): <https://docs.sonarsource.com/sonarqube-server/user-guide/code-metrics/metrics-definition>; elenco dei web service ed esempi di risposta (`measures/component`, `project_analyses/search`, `qualitygates/project_status` deprecato dal 16 set 2025 su Cloud): <https://sonarcloud.io/api/webservices/list>
- Swagger di Harbor v2.0 (parametri di get artifact, `repository_name` codificato due volte, `X-Accept-Vulnerabilities`, `NativeReportSummary`, `VulnerabilitySummary`, `Accessory`, basic auth): <https://github.com/goharbor/harbor/blob/main/api/v2.0/swagger.yaml>; tipi di accessory: <https://github.com/goharbor/harbor/blob/main/src/pkg/accessory/model/accessory.go>; permessi dei robot (Read Artifact, Read Scan, List Accessory): <https://goharbor.io/docs/main/administration/robot-accounts/>
- API di Argo CD (Bearer, semantica del parametro `project`): <https://argo-cd.readthedocs.io/en/stable/developer-guide/api-docs/>; swagger (parametri di `GET /api/v1/applications/{name}` incluso `refresh`, `appNamespace`; campi di `ApplicationStatus`): <https://github.com/argoproj/argo-cd/blob/stable/assets/swagger.json>; account locali (`apiKey`, `generate-token`): <https://argo-cd.readthedocs.io/en/stable/operator-manual/user-management/>; RBAC (`applications, get`, `logs` separato): <https://argo-cd.readthedocs.io/en/stable/operator-manual/rbac/>
- Codebase: `collector/src/providers/types.ts` (`SourceProvider`, `ControlProvider`), `collector/src/normalizers/security-model.ts` (`externalControl`, `toRepositoryControls`), `collector/src/build-snapshot.ts` (conteggi esterni), `collector/src/normalizers/quality.ts`, `collector/src/evaluators/quality.ts`, `collector/src/normalizers/versions.ts` (`toEnvironments`), `shared/model/contracts.ts`, `shared/security/patterns.ts` (`sensitiveEnvValues`), `.github/workflows/collect-data.yml`.
