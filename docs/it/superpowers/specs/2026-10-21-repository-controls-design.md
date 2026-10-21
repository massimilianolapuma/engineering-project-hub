# Controlli repository: action pinnate, workflow riutilizzabili, regole di branch, scorecard, suggerimenti di discovery — design

English: [../../../superpowers/specs/2026-10-21-repository-controls-design.md](../../../superpowers/specs/2026-10-21-repository-controls-design.md)

Stato: design del builder nell'ambito del programma roadmap (l'owner rivede dopo la consegna) · Data: 2026-10-21 · Release prevista: v0.8.0

Spec padre: [2026-10-21-roadmap-program-design.md](2026-10-21-roadmap-program-design.md) (§2 vincoli, §4 "v0.8.0 Repository controls", §5 anti-obiettivi). È vincolante. Ogni decisione di questo documento che non è fissata lì è una **scelta del builder**, marcata **(SB)**.

Dipende da v0.7.0 ([2026-10-21-history-trends-design.md](2026-10-21-history-trends-design.md)), che viene unita prima. v0.8.0 funziona anche senza, ma il §5.10 usa i suoi `history.json` / `changes.json` quando presenti.

## 1. Intento e motivo

La roadmap del README elenca cinque voci native di GitHub:

- action pinnate a uno SHA di commit;
- versioni dei workflow riutilizzabili;
- branch protection e ruleset;
- scorecard dei repository;
- discovery tramite custom property e topic.

Condividono un solo modello di permessi (GitHub in sola lettura, per lo più permessi che l'hub ha già) e una sola destinazione: la dimensione **Governance**. L'owner vuole vedere, per progetto, se i repository seguono un'igiene di base della supply chain, senza che un progetto diventi rosso dall'oggi al domani solo perché è comparso un controllo nuovo.

Fatti verificati il 2026-10-21 (fonti al §9):

- `GET /repos/{owner}/{repo}/rules/branches/{branch}` restituisce **tutte le regole attive** che si applicano a un branch, dai ruleset del repository **e** dell'organizzazione. Le regole dei ruleset in stato `evaluate` o `disabled` **non** vengono restituite. Il branch non deve esistere per forza e il nome non può contenere wildcard. Permesso fine-grained: **Metadata: read**.
- La branch protection classica (`GET /repos/{o}/{r}/branches/{branch}/protection`) richiede **Administration: read**, un permesso che oggi l'hub non ha.
- `GET /repos/{o}/{r}/branches/{branch}` (già chiamato per l'head del branch) restituisce un booleano `protected`. La sua documentazione non lo definisce. La documentazione di "List branches" dice che `protected=true` significa "protetto da branch protection o ruleset".
- `GET /repos/{o}/{r}/properties/values` restituisce `[{ property_name, value }]`. `value` è una stringa, un array o null. Richiede **Metadata: read**. L'endpoint di organizzazione `GET /orgs/{org}/properties/values` richiede il permesso di organizzazione **Custom properties: read**, un permesso nuovo, quindi non viene usato.
- I topic arrivano con l'oggetto repository che l'hub legge già (`topics`). Nessuna chiamata in più.
- I file di workflow si leggono con la Contents API (**Contents: read**, già concesso). La lista REST dei workflow (`listRepoWorkflows`, Actions: read) dà i nomi dei file ma non il contenuto.
- OpenSSF Scorecard carica un SARIF con nome del tool **`Scorecard`** (da `scorecard`, con l'iniziale maiuscola). Gli id delle regole sono il nome del check senza trattini più `ID` (`Pinned-Dependencies` → `PinnedDependenciesID`). Un risultato (e quindi un alert di code scanning) viene emesso **solo per i check sotto il punteggio minimo della policy**. Il punteggio sta solo nel testo del messaggio (`"score is N: …"`), che l'hub non raccoglie.
- `GET /repos/{o}/{r}/code-scanning/analyses` (Code scanning alerts: read, già concesso) accetta `tool_name`.
- Indicazione di GitHub: pinnare una action allo SHA di commit completo è l'unico modo per usarla come release immutabile. Le forme di `uses:` sono:
  - step: `{owner}/{repo}@{ref}`, `{owner}/{repo}/{path}@{ref}`, `./path`, `docker://{image}:{tag}`;
  - job (workflow riutilizzabili): `{owner}/{repo}/.github/workflows/{file}@{ref}` e `./.github/workflows/{file}`.

## 2. Obiettivi, non-obiettivi, anti-obiettivi

Obiettivi

- Per repository, sei **controlli repository** con nome, ognuno `pass`, `fail`, `unknown` o `not-applicable`, con un rapporto "superati / (superati + falliti)" e gli sconosciuti mostrati accanto.
- Per repository, i dettagli dietro i controlli:
  - i riferimenti alle action e se ognuno è pinnato;
  - i riferimenti ai workflow riutilizzabili, con la loro versione rispetto all'ultima release o tag del repository referenziato;
  - le regole di branch attive sul branch di default;
  - un riepilogo OpenSSF Scorecard quando i risultati di Scorecard arrivano nel code scanning.
- I controlli nuovi alimentano Governance tramite le policy. Ogni controllo è **informativo per default** e l'owner sceglie per controllo se renderlo `amber` o `red`.
- La discovery usa custom property e topic configurabili per proporre raggruppamenti di progetto, id e tipi di componente, sempre e solo come proposte.
- Con la sorgente mock e senza credenziali tutto funziona come il resto dell'hub.

Non-obiettivi

- Nessuna scrittura: nessuna creazione di ruleset, nessuna pull request di pinning, nessuna esecuzione di Scorecard.
- Nessuna API pubblica OpenSSF (`api.securityscorecards.dev`). È un host esterno e chiamarlo esporrebbe i nomi dei repository privati. Si usano solo i dati già presenti nel code scanning.
- Nessun punteggio numerico Scorecard. Sta solo nel testo dei messaggi degli alert, che non viene mai raccolto.
- Niente composite action (`.github/actions/*/action.yml`), niente controlli sulla config di Dependabot, niente controllo CODEOWNERS in questa release **(SB)**.
- Niente ruleset sui tag e niente ruleset di push: solo regole sul branch di default.
- Niente lettura delle custom property a livello di organizzazione (richiede un permesso nuovo).

Anti-obiettivi (programma §5, specializzati)

- Un repository di cui non si leggono workflow o regole mostrato come `pass`, o come `fail`. È `unknown`.
- Un progetto che dopo l'aggiornamento diventa rosso o ambra solo perché questi controlli esistono. I default sono `info`.
- Pubblicare il contenuto dei workflow: nomi degli step, script `run:`, input `with:`, `env`, espressioni. Si tengono solo identificatori di action `owner/repo[/path]`, ref e nomi dei file di workflow, e solo dopo una validazione rigida.
- Pubblicare valori di custom property diversi dalle chiavi configurate.
- Un repository referenziato non visibile riportato come "indietro".

## 3. Vincoli (programma §2, invariati)

Le regole del progetto restano invariate:

- sola lettura, solo GET, static-first, nessuna chiamata dal browser;
- opzionale, funziona senza credenziali, sconosciuto ≠ zero, 403 ≠ nessun dato, 404 ambiguo = sconosciuto;
- allowlist Zod rigida, testi e link sanificati, allowlist degli host;
- EN + IT, Warm Graphite, stato mai affidato al solo colore, WCAG 2.2 AA;
- un solo bump dello snapshot per release;
- mai `npm run ci:build` / `collect:mock` (sovrascrivono `public/data`);
- e2e sulla porta 4377, solo podman.

## 4. Decisioni in breve

| #   | Decisione                                                                                                                                                                                                                  | Motivo                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| D1  | Nessuna dimensione nuova. I controlli alimentano **Governance** tramite motivi. Il portfolio non ha barre nuove **(SB)**                                                                                                   | Il programma §4 dice "alimenta Governance". Una settima barra aggiungerebbe rumore per un segnale per lo più informativo |
| D2  | Sei controlli, id fissi (§5.4) **(SB)**                                                                                                                                                                                    | Pochi, spiegabili e nativi di GitHub. Ognuno corrisponde a una sola sorgente di dati                                     |
| D3  | Ogni controllo è `info` per default. `policies.repositoryControls.checks.<id>: info \| amber \| red`                                                                                                                       | Programma §4/§5: mai rosso dall'oggi al domani. L'owner sceglie                                                          |
| D4  | I file di workflow si leggono da `.github/workflows/` sul branch di default via Contents. Al massimo 30 file per repository, ciascuno ≤ 256 KiB **(SB)**                                                                   | Contents: read è già concesso. I limiti proteggono il budget API da repository non fidati                                |
| D5  | I controlli di branch usano la rules API (Metadata: read). La protezione classica si legge solo con `readClassicProtection: true` (richiede Administration: read, spento per default) **(SB)**                             | Nessun permesso nuovo per default. Un `unknown` onesto quando la protezione classica può nascondere la risposta          |
| D6  | Un tipo di regola assente dalla rules API mentre il branch dichiara `protected: true` è `unknown`, non `fail`, a meno che la protezione classica sia stata letta **(SB)**                                                  | Può essere impostato dalla protezione classica, invisibile senza Administration: read                                    |
| D7  | La versione di un workflow riutilizzabile si confronta con l'ultima release del repository referenziato, o in mancanza con l'ultimo tag. Un ref uguale allo SHA di un tag si risolve in quel tag. Non visibile → `unknown` | Le stesse sorgenti di versione che l'hub usa già per i componenti                                                        |
| D8  | OpenSSF Scorecard è un **riepilogo**, non un settimo controllo **(SB)**                                                                                                                                                    | I suoi alert sono già finding di Security. Contarli di nuovo in Governance sarebbe un doppio conteggio                   |
| D9  | I dettagli delle action (identificatore, ref) e i target dei workflow riutilizzabili sono nascosti per i repository non pubblici quando `publication.audience: public`. I conteggi restano **(SB)**                        | Stessa regola dei titoli dei finding oggi                                                                                |
| D10 | Suggerimenti di discovery: la custom property vince sul topic. Si leggono e si tengono solo le chiavi configurate. Nuovo tipo di proposta `grouped` **(SB)**                                                               | Le property sono gestite dagli admin, i topic sono liberi. Le property non configurate possono essere sensibili          |
| D11 | Schema dello snapshot **1.4 → 1.5** (v0.7.0 resta su 1.4). `history.json` / `changes.json` non cambiano, salvo l'estensione opzionale del §5.10                                                                            | Un bump per release. Lo storico sopravvive ai bump dello snapshot per progetto (v0.7.0 D1)                               |
| D12 | ADR 0007: "Controlli repository dai file di workflow e dalla rules API, informativi per default"                                                                                                                           | Prima volta che il collector legge file fuori da un'allow-list fissa. Cambia un confine di fiducia documentato           |

## 5. Design

### 5.1 Dati raccolti per repository unico

I dati si raccolgono solo con `policies.repositoryControls.enabled` (default `true`). Se è spento, nessuna di queste chiamate viene fatta e la sezione dice "spento".

| Dato                        | Chiamata                                                                                                                 | Permesso (fine-grained / App)            | Limite                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- | ---------------------------------------------------------------------- |
| Elenco file di workflow     | `GET /repos/{o}/{r}/contents/.github/workflows?ref={branch}`                                                             | Contents: read                           | nomi che rispettano `^[A-Za-z0-9._-]+\.ya?ml$`, primi 30 in ordine     |
| Testo del file di workflow  | `GET /repos/{o}/{r}/contents/.github/workflows/{file}?ref={branch}`                                                      | Contents: read                           | ≤ 256 KiB (`MAX_FILE_BYTES` esistente)                                 |
| Regole del branch           | `GET /repos/{o}/{r}/rules/branches/{branch}` (`per_page=100`, 1 pagina)                                                  | Metadata: read                           | 100 regole                                                             |
| Flag `protected` del branch | `GET /repos/{o}/{r}/branches/{branch}` esistente (head), nuovo campo mappato                                             | Contents o Metadata: read (già chiamato) | nessuno                                                                |
| Protezione classica (opz.)  | `GET /repos/{o}/{r}/branches/{branch}/protection`, solo con `readClassicProtection: true`                                | **Administration: read** (opt-in)        | nessuno                                                                |
| Analisi Scorecard           | `GET /repos/{o}/{r}/code-scanning/analyses?tool_name=Scorecard&per_page=1`                                               | Code scanning alerts: read               | 1 elemento                                                             |
| Alert Scorecard             | lista esistente degli alert di code scanning, filtrata su `toolName` = `Scorecard` (senza distinzione maiuscole)         | già raccolti                             | limite esistente di 300 alert                                          |
| Repository referenziati     | `getLatestRelease` → `getLatestTag` esistenti, più `listTags` quando un ref è uno SHA. Memoizzati sull'intera esecuzione | Contents / Metadata: read                | al massimo 50 repository referenziati distinti per esecuzione **(SB)** |

Il collector analizza il testo dei workflow in memoria e lo scarta. Il testo non esce mai dagli strati provider e normalizzatore, come `.gitmodules` oggi.

**Allow-list di `getFile`.** Si estende con un solo pattern: `.github/workflows/<nome>` dove `<nome>` rispetta la regex qui sopra. `..`, barre nel nome e qualsiasi altro percorso sono rifiutati prima della chiamata.

### 5.2 Analisi dei riferimenti nei workflow (`collector/src/normalizers/workflow-refs.ts`)

- Il file si analizza con la dipendenza `yaml` esistente. `maxAliasCount: 100` e `uniqueKeys` non è imposto. Un file che non si analizza rende `partial` i dati delle action del repository (`unparsable` +1).
- L'analisi guarda solo `jobs.<id>.uses` (workflow riutilizzabile) e `jobs.<id>.steps[*].uses` (action). Tutto il resto viene ignorato e mai salvato.
- Al massimo 200 riferimenti per file e 1 000 per repository. Oltre, il conteggio dei riferimenti è `null` e il controllo di pinning è `unknown` **(SB)**.
- Ogni stringa `uses` viene classificata:

  | Forma                                                             | `kind`              | Contata per il pinning? | Pinnata quando              |
  | ----------------------------------------------------------------- | ------------------- | ----------------------- | --------------------------- |
  | `./…`                                                             | `local`             | no                      | —                           |
  | `docker://image@sha256:<64 hex>`                                  | `docker`            | sì                      | sempre (digest)             |
  | `docker://image[:tag]`                                            | `docker`            | sì                      | mai                         |
  | `{owner}/{repo}/.github/workflows/{file}@{ref}`                   | `reusable-workflow` | sì                      | `ref` è di 40 hex minuscoli |
  | `{owner}/{repo}[/{path}]@{ref}`                                   | `action`            | sì                      | `ref` è di 40 hex minuscoli |
  | qualsiasi altra cosa (senza `@`, con `${{`, caratteri non validi) | `invalid`           | sì, come **unknown**    | —                           |

- Regex di validazione:
  - owner: `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$`;
  - repo: `^[A-Za-z0-9._-]{1,100}$`;
  - segmenti di percorso: `^[A-Za-z0-9._-]{1,100}$`, al massimo 5 segmenti;
  - ref: `^[A-Za-z0-9._/-]{1,100}$`.
- `exemptActionOwners` (policy, default `[]`) elenca gli owner le cui action non pinnate contano come pinnate. Un valore tipico è `["actions", "github"]`, ma il default resta rigoroso **(SB)**.

### 5.3 Aggiornamento dei workflow riutilizzabili

Per ogni coppia distinta `(owner/repo, ref)` tra i riferimenti `reusable-workflow`:

| Situazione                                                                                    | `status`                                           |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Repository referenziato non visibile (403 / 404 / errore), o oltre il limite di 50 repository | `unknown`                                          |
| Né release né tag leggibili                                                                   | `unknown`                                          |
| `ref` è uno SHA di 40 hex uguale al commit di un tag in `listTags`                            | risolto in quel tag, poi confrontato               |
| `ref` è uno SHA di 40 hex senza tag corrispondente                                            | `untagged`                                         |
| `ref` è semver (dopo `normaliseVersion`) e uguale all'ultima                                  | `current`                                          |
| `ref` è semver e minore dell'ultima                                                           | `behind`                                           |
| `ref` è semver e maggiore dell'ultima (pre-release)                                           | `current`                                          |
| `ref` è un alias di major `v2` con la stessa major dell'ultima                                | `current` (major flottante; il pinning lo segnala) |
| `ref` è un alias di major con major minore                                                    | `behind`                                           |
| Qualsiasi altra cosa (un branch come `main`)                                                  | `floating`                                         |

Un repository referenziato **non pubblico** è trattato come non visibile (`unknown`, nessun `latest`, nessun URL, nessun tag) salvo `publication.audience: restricted`, così un repository condiviso privato non espone mai stato o versioni a un sito pubblico. `latest` e ogni nome di tag passano per `scrubIdentifier`.

`latest` è `normaliseVersion(release.tagName)` o `normaliseVersion(tag.name)`. Il confronto usa `compareVersions` di `collector/src/util/semver.ts`.

### 5.4 I sei controlli (D2)

Id dei controlli (`RepositoryCheckIdSchema`), in ordine di visualizzazione:

1. **`actions-pinned`**: ogni riferimento contato (§5.2) è pinnato o esentato.
   - `not-applicable`: la cartella dei workflow è assente (404) o non c'è nessun riferimento contato.
   - `fail`: almeno un riferimento leggibile non è pinnato (il fail vince sui file illeggibili).
   - `unknown`: l'elenco ha risposto 403 o errore; oppure qualche file è illeggibile o non analizzabile, o esiste un riferimento `invalid`, o si è raggiunto il limite, e niente è non pinnato.
   - `pass`: negli altri casi.
2. **`reusable-workflows-current`**:
   - `not-applicable`: nessun riferimento remoto a workflow riutilizzabili.
   - `fail`: qualche riferimento è `behind`.
   - `unknown`: nessuno è behind e qualcuno è `unknown`, `untagged` o `floating`; oppure i dati dei workflow sono `unknown`.
   - `pass`: tutti sono `current`.
3. **`branch-protected`**:
   - `pass`: la chiamata alle regole ha restituito almeno una regola; oppure la protezione classica è stata letta ed esiste; oppure la chiamata alle regole è fallita o non ha restituito nulla mentre `protected === true`.
   - `fail`: la chiamata alle regole è riuscita senza regole, e `protected === false`, e (se letta) la protezione classica è assente.
   - `unknown`: negli altri casi.
4. **`pull-request-required`**: tipo di regola `pull_request` (o `required_pull_request_reviews` classico).
5. **`force-push-blocked`**: tipo di regola `non_fast_forward` (o `allow_force_pushes.enabled === false` classico).
6. **`status-checks-required`**: tipo di regola `required_status_checks` (o `required_status_checks` classico presente).

I controlli 4–6 seguono la stessa regola:

- `pass` se presente.
- Se assente:
  - `fail` se la chiamata alle regole è riuscita e `protected === false`, oppure la protezione classica è stata letta e non lo ha;
  - `unknown` se `protected === true` o `null` e la protezione classica non è stata letta (D6).
- `unknown` se la chiamata alle regole è fallita e la protezione classica non è stata letta.

Eccezioni a livello di repository:

- **Repository archiviato:** ogni controllo è `not-applicable` (un repository archiviato è in sola lettura).
- **Repository non disponibile** (metadati falliti): ogni controllo è `unknown`, mai non applicabile.
- **Override del catalogo:** `notApplicableChecks: RepositoryCheckId[]` su coordinatore e componenti (come `notApplicableControls`). Nei monorepo un controllo è non applicabile per il repository solo se **ogni** target del repository lo elenca **(SB)**.

Rapporto, per repository e per progetto:

- `superati / (superati + falliti)`, come percentuale intera arrotondata per eccesso da .5, oppure `null` se il denominatore è 0;
- `unknown` e `notApplicable` si mostrano accanto e non entrano mai nel denominatore.
- I conteggi di progetto sommano sui **repository unici** (un monorepo conta una volta), come per Qualità.

### 5.5 Riepilogo delle regole di branch

Le regole di branch si riassumono; i `parameters` grezzi delle regole non si pubblicano mai, tranne `required_approving_review_count` (intero 0–10).

- `ruleTypes` è la lista senza duplicati dei tipi di regola attivi, filtrata da un enum di allow-list `BranchRuleTypeSchema`. I suoi valori sono i tipi documentati il 2026-10-21:
  - `creation`, `update`, `deletion`, `required_linear_history`, `merge_queue`, `required_deployments`, `required_signatures`;
  - `pull_request`, `required_status_checks`, `non_fast_forward`;
  - `commit_message_pattern`, `commit_author_email_pattern`, `committer_email_pattern`, `branch_name_pattern`, `tag_name_pattern`;
  - `workflows`, `code_scanning`, `code_quality`, `code_coverage`, `copilot_code_review`, `license_compliance_scanning`;
  - `file_path_restriction`, `max_file_path_length`, `file_extension_restriction`, `max_file_size`.
- I tipi futuri sconosciuti si contano in `otherRules` e non si pubblicano mai per nome.
- `source`:
  - `rulesets` se la rules API ha restituito regole;
  - `classic` se vale solo la protezione classica (letta o dedotta da `protected`);
  - `both`, `none` o `unknown` negli altri casi.

### 5.6 Riepilogo OpenSSF Scorecard (D8)

Per repository:

- `state`:
  - `available` se esiste un'analisi Scorecard;
  - `not-used` se la chiamata alle analisi ha restituito una lista vuota o 404 (non è un fallimento, è informativo);
  - `not-authorised` con 403;
  - `unknown` negli altri casi.
- `lastAnalysisAt`: dall'analisi.
- `openAlerts`: il numero di alert di code scanning aperti con tool `Scorecard`, oppure `null` se gli alert non erano leggibili.
- `failingChecks`: i nomi dei check Scorecard ricavati dagli id delle regole tramite un'allow-list. Gli id fuori lista si contano in `otherFailing`. L'allow-list:
  - `Binary-Artifacts`, `Branch-Protection`, `CI-Tests`, `CII-Best-Practices`, `Code-Review`, `Contributors`, `Dangerous-Workflow`;
  - `Dependency-Update-Tool`, `Fuzzing`, `License`, `Maintained`, `Packaging`, `Pinned-Dependencies`, `SAST`;
  - `SBOM`, `Security-Policy`, `Signed-Releases`, `Token-Permissions`, `Vulnerabilities`, `Webhooks`.
- La UI dice "Check sotto il minimo della tua policy Scorecard", non "falliti". Scorecard emette un risultato solo sotto il punteggio minimo.
- Questi alert restano nei finding di Security come oggi. Security non cambia.

### 5.7 Policy (`config/policies.yaml`, lo `schemaVersion` delle policy resta `1.0`)

```yaml
repositoryControls:
  enabled: true
  checks: # info = mostrato, non cambia mai Governance (default per ogni controllo)
    actions-pinned: info
    reusable-workflows-current: info
    branch-protected: info
    pull-request-required: info
    force-push-blocked: info
    status-checks-required: info
  unknownEnforcedCheck: info # info | amber: un controllo applicato che è sconosciuto
  exemptActionOwners: []
  maxWorkflowFiles: 30 # 1–100
  readClassicProtection: false # true richiede Administration: read
```

- Il blocco è opzionale (`.prefault({})`). I livelli dei controlli sono `z.enum(['info','amber','red'])`.
- **Motivi di Governance** (codici nuovi, EN/IT):
  - `repository-check-failed`: uno per controllo con almeno un repository che fallisce. Livello = il livello di policy del controllo. `params`: `{ check, repositories (separati da virgola, max 10 poi "+N"), count }`.
  - `repository-check-unknown`: uno per controllo **applicato** (livello ≠ `info`) con repository sconosciuti. Livello = `unknownEnforcedCheck`. I controlli informativi non ricevono il motivo di sconosciuto; li mostra la sezione.
  - `repository-checks-passed`: `info`, aggiunto quando ogni controllo applicabile è superato su ogni repository leggibile.
- I motivi `info` non cambiano mai lo stato (`statusFrom` esistente). `governance-compliant` si aggiunge ancora quando lo stato è verde.
- Lo score non cambia: Governance mantiene il peso 15 e si muove solo quando un controllo applicato ne cambia lo stato.

### 5.8 Modello dello snapshot (schema 1.4 → 1.5)

`shared/model/enums.ts`:

- `SNAPSHOT_SCHEMA_VERSION = '1.5'` e `SUPPORTED = ['1.5']`, con il commento di storia `1.5: repository controls, discovery hints`.
- Nuovi: `RepositoryCheckIdSchema`, `RepositoryCheckStateSchema = z.enum(['pass','fail','unknown','not-applicable'])`, `BranchRuleTypeSchema`, `ScorecardCheckSchema`.
- Nuova capability `repositoryRules`.
- Codici motivo: `repository-check-failed`, `repository-check-unknown`, `repository-checks-passed`.

`shared/model/snapshot.ts`: `RepositoryControlsHealthSchema` con la forma dello spec inglese §5.8, cioè:

- aggregati `passed`, `failed`, `unknown`, `notApplicable`, `ratio`;
- `perCheck` (6 elementi con livello e conteggi);
- `repositories[]` con `componentIds`, `repository`, `checks` (6), conteggi e `ratio`, e:
  - `actions`: stato, numero di file, totale, pinnati, non pinnati, sconosciuti, `detailsWithheld`, `unpinnedRefs` max 20, `truncated`;
  - `reusableWorkflows` (max 20, con `latest`, `status`, `url` del repository referenziato);
  - `branchRules`: stato, branch, `protected`, `source`, `ruleTypes`, `otherRules`, `requiredApprovals`, `classicRead`;
  - `scorecard`: stato, `lastAnalysisAt`, `openAlerts`, `failingChecks`, `otherFailing`.

Altre modifiche:

- `ProjectSnapshot.repositoryControls`.
- `ProjectSummary.repositoryControls: { passed, failed, unknown, notApplicable, ratio }`.
- `CollectionErrorSchema.source` aggiunge `workflow-files`, `repository-rules`, `scorecard-analysis`.
  - Gli errori si registrano una volta per repository unico.
  - Un 404 sulla cartella dei workflow è atteso (non è un errore). Un 404 sulle regole è `unknown` e si registra.
  - I repository referenziati non producono mai errori di raccolta (non sono monitorati).
- `DiscoveryProposalSchema`:
  - `kind` aggiunge `'grouped'`;
  - nuovo `hintedProjectId: slug | null`;
  - nuovo `hints: { source: 'property'|'topic', key, value }[]` (max 10), solo con le chiavi configurate.
- `fileName` = `^[A-Za-z0-9._-]+\.ya?ml$` (max 100). `target` si ricostruisce dalle parti validate, mai copiato dalla stringa grezza.

### 5.9 Suggerimenti di discovery (`catalog.yaml`)

```yaml
discovery:
  topics: true # flag riservato esistente, ora attivo
  customProperties: true # flag riservato esistente, ora attivo (1 chiamata per repository scansionato)
  hints:
    projectProperty: hub-project
    componentProperty: hub-component
    typeProperty: hub-component-type
    projectTopicPrefix: project- # topic "project-tools" → progetto "tools"
    typeTopicPrefix: type- # topic "type-worker" → tipo worker
```

- `hints` è opzionale con questi default. Le chiavi rispettano `^[a-z0-9][a-z0-9_-]{0,49}$`. I prefissi rispettano `^[a-z0-9-]{1,30}$`.
- Per ogni repository scansionato:
  - si leggono i topic (già presenti);
  - con `customProperties` attivo, si chiama `getCustomPropertyValues`;
  - si tengono **solo** le tre chiavi configurate. Solo valori stringa (array o null si ignorano con evidenza "suggerimento ignorato").
- Valori: progetto e componente devono essere slug, e il tipo deve essere un `ComponentType`. Altrimenti si ignorano con evidenza.
  - La property vince sul topic.
  - Più topic `project-*` → ambiguo → ignorato con evidenza.
- Effetti:
  1. Il rilevamento strutturale (coordinatore / monorepo / singolo) non cambia e vince per la struttura.
  2. Un **tipo** suggerito sostituisce `guessType` per il componente di quel repository.
  3. Un id di **componente** suggerito sostituisce lo slug (reso comunque unico).
  4. I repository che sono proposte `single` con lo stesso progetto suggerito e non rivendicati da un coordinatore si uniscono in una proposta **`grouped`**:
     - id progetto = il suggerimento;
     - coordinatore = il repository con suggerimento di componente `coordinator`, altrimenti il primo in ordine alfabetico;
     - gli altri diventano componenti con `versionSource: release`;
     - le loro proposte `single` vengono eliminate.
  5. Quando l'id di progetto suggerito è un progetto esistente del catalogo e il repository non ne fa parte, si imposta `hintedProjectId`. L'editor del catalogo mostra "Suggerito per il progetto X". Non unisce automaticamente.
- 403 sulle property → voce `not-authorised` in `errors[]`, e i suggerimenti arrivano solo dai topic. 404 → nessuna property.
- Le proposte restano proposte. Niente entra nel catalogo finché non si salva un file di progetto (invariato).

### 5.10 Storico e "Cosa è cambiato" (dipendenza da v0.7.0, opzionale)

Senza alcuna modifica, i cambi di stato di Governance compaiono già nella pagina "Cosa è cambiato" come cambi di stato di dimensione. Succede solo quando l'owner applica un controllo.

Quando v0.7.0 è unita (**(SB)**, Task 7 del piano):

- `schemaVersion` dello storico `1.1`, con `SUPPORTED_HISTORY_SCHEMA_VERSIONS = ['1.0','1.1']`. Un file 1.0 si legge e semplicemente non ha i campi nuovi.
- `HistoryProjectPoint` riceve l'opzionale `controls: { passed, failed, unknown }`. `HistoryBaseline.projects[]` riceve l'opzionale `checks: string[]`: chiavi `"owner/repo|check|pass"` o `"owner/repo|check|fail"`, al massimo 600.
- `changes.json` (`schemaVersion` resta `1.0`, campo opzionale aggiuntivo) riceve per progetto `checkChanges: [{ repository, check, from: 'pass'|'fail', to: 'pass'|'fail' }]` (max 50), più `totals.checkChanges`.
  - Contano solo i passaggi pass ↔ fail, e solo quando entrambe le esecuzioni conoscono lo stato (come per i movimenti di versione). Una baseline precedente senza `checks` → non confrontata.
- La pagina "Cosa è cambiato" li elenca sotto "Controlli repository".
- Il CSV del portfolio riceve `controls_passed`, `controls_failed`, `controls_unknown`.

Se v0.7.0 non è unita quando si implementa questa release, il Task 7 si salta e si registra come follow-up.

### 5.11 UI (Warm Graphite)

**Pagina di progetto:** un nuovo `<details id="repository-controls" class="fold disclosure">` dopo Copertura controlli e prima di Qualità.

- Titolo: "Controlli repository" / "Repository controls".
- Riga di sintesi: "{passed} di {applicable} controlli superati · {unknown} non visibili", con il rapporto.
- **Riquadri:** controlli superati (rapporto), non visibili (numero di sconosciuti, contorno tratteggiato), OpenSSF Scorecard (repository `available`, numero di check sotto il minimo).
- **Matrice dei controlli:**
  - righe = repository unici (con gli id dei componenti), colonne = i sei controlli;
  - le celle usano i simboli di stato esistenti: superato ✓, fallito ✕, sconosciuto "?" in contorno tratteggiato, non applicabile "–", ognuno con testo nascosto per i lettori di schermo;
  - le intestazioni di colonna hanno un piccolo tag "Informativo" / "Informative" quando il livello è `info`, e "Conta per Governance" / "Counts for Governance" altrimenti.
- **Liste di dettaglio** (ognuna richiudibile):
  - riferimenti non pinnati (workflow · target · ref), oppure "Dettagli nascosti per i repository non pubblici";
  - workflow riutilizzabili (target · ref · ultima · stato);
  - regole di branch (sorgente, tipi di regola come piccoli token di codice, approvazioni);
  - Scorecard (ultima analisi, check sotto il minimo).
- Una frase di legenda: "I controlli informativi non cambiano mai lo stato di Governance. Non visibile non significa fallito."
- L'ancora della card della dimensione Governance passa da `#workflows` a `#repository-controls` **(SB)**. La sezione finisce con un link "Workflow standard →" a `#workflows`, per i motivi di governance esistenti.

**Portfolio:** nessuna barra o colonna nuova (D1). Il testo del tooltip della barra Governance riceve "· controlli {passed}/{applicable}" **(SB)**.

**Come leggere:**

- la voce Governance cita i controlli repository;
- una nuova voce "Controlli repository" spiega i sei controlli, informativo contro applicato, e perché sconosciuto ≠ fallito.

**Qualità dei dati:**

- la capability `repositoryRules` è elencata;
- una lista dei repository di cui non si sono letti workflow o regole.

**Editor del catalogo:**

- tipo di proposta `grouped` ("Raggruppato dai suggerimenti");
- un badge "Suggerito per il progetto {id}";
- righe di evidenza dei suggerimenti.

Tutte le stringhe sono EN + IT, e il test di parità è automatico. I passaggi `ui-ux-pro-max` e `web-design-guidelines` si fanno sulla sezione nuova prima del merge. Manutenzione del design: aggiornare il README del DS Warm Graphite e il canvas dopo il codice (regola permanente).

### 5.12 Dati mock (sintetici; valori esatti nel piano, Task 4)

SHA condivisi:

- `D = 0123456789abcdef0123456789abcdef01234567` (action pinnate);
- tag di ci-templates: `v2.4.0 = a1b2c3d4e5f60718293a4b5c6d7e8f9012345678`, `v2.3.0 = b2c3…`, `v2.1.0 = c3d4…`.

Una nuova fixture `example-shared__ci-templates.json` (un owner diverso, così la discovery non la elenca) ha la release `v2.4.0`.

| Progetto | Superati | Falliti | Sconosciuti | N/A | Rapporto | Storia                                                                                                                                                      |
| -------- | -------- | ------- | ----------- | --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alpha    | 25       | 0       | 0           | 5   | 100      | Tutto pinnato. Il coordinatore chiama il workflow riutilizzabile allo SHA di v2.4.0 (aggiornato). Quattro regole ovunque. Helm non ha workflow              |
| Beta     | 5        | 7       | 8           | 4   | 42       | `@v4` / `@v6` in api, riutilizzabile `@v2.1.0` indietro, web non protetto, coordinatore solo protezione classica (dettagli sconosciuti), regole di helm 403 |
| Platform | 4        | 1       | 1           | 0   | 80       | `pnpm/action-setup@v4`, riutilizzabile `@main` (flottante) e un `example-private/templates` non visibile (sconosciuto); ruleset di organizzazione           |
| Gamma    | 0        | 0       | 12          | 0   | null     | Repository non disponibili → tutto sconosciuto                                                                                                              |

- Scorecard:
  - beta-api ha un'analisi `@now-2d` con alert aperti `TokenPermissionsID` (high) e `PinnedDependenciesID` (medium);
  - alpha-backend ha un'analisi `@now-3d` e nessun alert;
  - gli altri non lo usano.
- Discovery:
  - nuove fixture `example-org__tools-api.json` e `example-org__tools-cli.json` (topic `project-tools`) → una proposta `grouped` "tools";
  - `docs-site` riceve la property `hub-project: platform` → `hintedProjectId: "platform"`;
  - `tools-cli` ha anche una property non configurata `cost-center: CC-1234`, che non deve mai comparire nell'output.
- Lo stato di Governance di ogni progetto mock è **invariato** rispetto ai golden di v0.7.0 (tutti i controlli `info`).

### 5.13 Documentazione (EN + IT)

- `configuration.md`: le policy `repositoryControls`, `notApplicableChecks` nel catalogo, gli `hints` della discovery.
- `security.md`: le righe della tabella permessi (Metadata per regole e property, Contents per i workflow, Administration: read opzionale), cosa non si pubblica mai da file di workflow e property, e data e fonti della verifica.
- `architecture.md`: flusso dei dati, e il confine di fiducia per i file di workflow come input non fidato.
- `operations.md`: come scegliere l'applicazione dei controlli, e come concedere Administration: read per la protezione classica.
- README / README.it: dimensioni (testo di Governance), roadmap (rimuovere le cinque voci).
- CHANGELOG.
- ADR 0007 (EN + IT).

## 6. Test (sintesi; casi esatti nel piano)

- **Unit, parser:** ogni forma di `uses` del §5.2, i limiti, una bomba di alias YAML, un `uses` con `${{` trattato come `invalid`, e un nome di step con un canary segreto che non compare mai nell'output.
- **Unit, aggiornamento:** ogni riga del §5.3.
- **Unit, controlli:** i percorsi pass / fail / unknown / not-applicable di ogni controllo. D6 (regola assente + `protected: true` → unknown). Archiviato → tutto N/A. Non disponibile → tutto sconosciuto. L'override nei monorepo richiede ogni target.
- **Unit, governance:** i default lasciano lo stato invariato. `actions-pinned: red` rende rosso un progetto che fallisce. `unknownEnforcedCheck: amber` su un controllo applicato sconosciuto lo rende ambra. Nessun motivo di sconosciuto per i controlli informativi.
- **Unit, discovery:** la property vince sul topic, valori non validi ignorati, proposta `grouped`, `hintedProjectId`, property non configurata mai tenuta.
- **Provider:** forma delle richieste (`ref`, `tool_name=Scorecard`, `per_page`), classificazione di 403 / 404, e che la chiamata alla protezione classica non si fa mai con il flag spento.
- **Integrazione:** i numeri golden del §5.12, Governance invariata, canary bloccati, schema 1.5.
- **Sito / e2e:** sezione presente, matrice con alternative testuali, la card Governance punta a `#repository-controls`, stringhe IT, il tag "Informativo".

## 7. Rischi

- **La semantica di `protected` nell'endpoint del singolo branch non è documentata.** Con D6 può solo trasformare un `fail` potenziale in `unknown` o in un pass per `branch-protected`, mai nascondere un'assenza reale. Chi implementa registra il comportamento osservato in `security.md`.
- **Molte celle `unknown` per i repository con ruleset più `protected: true`.** È onesto per costruzione. L'owner può attivare `readClassicProtection` con Administration: read.
- **Budget API:** fino a 33 chiamate in più per repository (1 elenco + 30 file + regole + analisi), più al massimo 150 per i repository referenziati. Su un portfolio di 50 repository resta ben dentro le 5 000 richieste l'ora. `maxWorkflowFiles` lo limita.
- **Nomi di branch con `/`** vanno codificati nell'URL del percorso delle regole. L'espansione `{branch}` di Octokit li codifica, e un test lo fissa.
- **Deriva dei file di v0.7.0** (chiavi i18n, navigazione, `primitives.ts`, tipi dello storico): il piano dice di adattarsi.

## 8. Lasciato al builder (chi implementa)

- Markup Astro esatto e layout responsive della matrice (scorrimento orizzontale con prima colonna fissa, o card impilate su schermi stretti), seguendo i pattern Warm Graphite.
- Nomi degli helper interni oltre alle interfacce del piano.
- Se analizzare lo YAML una volta per file nel provider o nel normalizzatore (deve restare fuori dal modello pubblicato).

## 9. Fonti (verificate il 2026-10-21)

- Regole per un branch, ruleset: <https://docs.github.com/en/rest/repos/rules>
- Permessi dei token fine-grained per endpoint (rules, rulesets, properties/values, topics, tags: Metadata read; branch protection: Administration read; contents, releases: Contents read; analisi di code scanning: Code scanning alerts read; property di organizzazione: Custom properties read): <https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens>
- Branch (campo `protected`, parametro `protected` di List branches): <https://docs.github.com/en/rest/branches/branches>
- Valori delle custom property di un repository: <https://docs.github.com/en/rest/repos/custom-properties>
- Sintassi dei workflow (forme di `steps[*].uses`, "commit SHA … safest for stability and security"): <https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax>
- Output SARIF di OpenSSF Scorecard (nome del driver, id delle regole, risultati solo sotto il punteggio minimo, messaggio "score is N"): <https://github.com/ossf/scorecard/blob/main/pkg/scorecard/sarif.go>
