# Operatività

> 🇬🇧 [English version](../operations.md)

## Workflow pianificati

| Workflow           | Pianificazione                                        | Note                                                                                                                             |
| ------------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `deploy-pages.yml` | `17 */6 * * *` (ogni 6 h, UTC)                        | `collect` → `build` → `deploy`. Viene eseguito anche al push su `main` e su richiesta. `concurrency: pages` senza cancellazione. |
| `collect-data.yml` | su richiesta / `repository_dispatch` (`collect-data`) | Raccolta di prova (dry run) che produce l'artifact `snapshots` e un job summary. Non effettua il deploy.                         |
| `ci.yml`           | PR, push su `main`                                    | Quality gate solo su dati mock.                                                                                                  |

GitHub può ritardare le esecuzioni pianificate nei momenti di carico e disabilita le
pianificazioni dopo 60 giorni senza attività sul repository. Riattivale dalla scheda
Actions.

Per cambiare la frequenza, modifica il `cron` in `deploy-pages.yml`. Mantieni la soglia di
dato non aggiornato (`freshness.snapshotStaleHours`) superiore all'intervallo.

## Monitoraggio del collector

- **Job summary**: ogni raccolta aggiunge `collection-report.md` (progetti, stato
  complessivo, conteggi degli errori, errori classificati) al riepilogo dell'esecuzione.
- L'**artifact** `snapshots` contiene il JSON sanitizzato, incluso
  `collection-report.json`.
- La **pagina Qualità dati** (`/data-quality/`) mostra l'ultima esecuzione, la modalità di
  autenticazione, la disponibilità delle capability, le sorgenti non accessibili, le
  sorgenti non aggiornate, i submodule non risolti e gli errori per progetto.
- **Banner di dato non aggiornato**: il sito mostra un banner quando lo snapshot è più
  vecchio di `snapshotStaleHours`. Il calcolo avviene nel browser di chi consulta il sito,
  quindi anche un sito che ha smesso di aggiornarsi viene segnalato.
- Tieni d'occhio le esecuzioni fallite di `deploy-pages`. I fallimenti sono strutturali,
  ad esempio config, credenziali, schema o sanitizzazione non validi, e richiedono un
  intervento. Gli errori sui singoli repository **non** fanno fallire l'esecuzione.

## Rate limit

- Il costo è di circa `repos × 8 + tracked workflow targets × (1–2) + submodules + 2 × projects`
  chiamate REST per esecuzione. Con il catalogo demo sono circa 120.
- Il throttling di Octokit ritenta una volta quando l'attesa è ≤ 60 s (limiti primari e
  secondari), con al massimo 4 chiamate in parallelo.
- Un'installazione di GitHub App ha limiti più alti di un PAT. Per cataloghi grandi è
  preferibile la App.
- I controlli repository aggiungono, per repository univoco: 1 chiamata per le regole del branch, 1 per la cartella dei workflow e fino a `maxWorkflowFiles` (30 per impostazione predefinita) letture di file, 1 per l'analisi Scorecard, 1 in più per la protezione classica se attivata, più al massimo 3 chiamate per ogni repository di workflow riutilizzabili referenziato (al massimo 50, quindi 150), una volta per esecuzione. Una scoperta aggiunge 1 chiamata per repository analizzato quando `customProperties` è attivo. Riduci `maxWorkflowFiles` o imposta `repositoryControls.enabled: false` per ridurre il costo.
- Se compaiono errori `rate-limited`, riduci la frequenza della pianificazione, suddividi
  il catalogo oppure abbassa la concorrenza in `collector/src/run.ts`.

## Riesecuzione manuale

- **Aggiornamento completo e pubblicazione**: Actions → _Deploy — GitHub Pages_ →
  _Run workflow_.
- **Solo raccolta (dry run)**: Actions → _Collect — Data snapshots_ → _Run workflow_,
  scegliendo `mock` o `github`. Poi scarica l'artifact `snapshots` per ispezionarlo.
- **Trigger esterno**:
  `gh api repos/<owner>/<repo>/dispatches -f event_type=collect-data`. Esegue la raccolta
  senza deploy.
- **In locale**: `DATA_SOURCE=github GH_READ_TOKEN=… npm run collect:github && npm run
validate:snapshots`.

## Dati non aggiornati

1. Controlla l'ultima esecuzione di `deploy-pages`. Se la pianificazione è stata
   disabilitata, riattivala.
2. Se le esecuzioni riescono ma le sorgenti non sono aggiornate, la causa è a monte:
   workflow non eseguiti nei repository monitorati, scansioni non effettuate o file di
   stato non aggiornati. Va risolta lì. Il portale lo segnala, non lo corregge.
3. Modifica le soglie in `policies.yaml` solo quando non corrispondono alla cadenza reale
   del team.

## Errori parziali

| Classe           | Causa tipica                                                                                    | Azione                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `not-authorised` | App non installata sul repository, permesso mancante, ambito del PAT                            | Installa la App o concedi il permesso di lettura. Non concedere mai la scrittura. |
| `not-found`      | Repository rinominato o eliminato, refuso nel catalogo                                          | Correggi `config/projects/<id>.yaml`.                                             |
| `not-configured` | Funzionalità disabilitata (alert Dependabot, secret scanning, nessuna analisi di code scanning) | Abilitala nel repository, oppure contrassegnala come non obbligatoria.            |
| `rate-limited`   | Troppe chiamate                                                                                 | Vedi "Rate limit".                                                                |
| `invalid-data`   | Manifest o file di stato malformato, oppure che fa riferimento a un altro repository            | Correggi il file nel repository monitorato.                                       |
| `error`          | 5xx o rete                                                                                      | Di solito transitorio. L'esecuzione successiva ritenta.                           |

La **discovery dei team** ha un suo stato in `catalog.json` (`teams.status`) e nel log del collector
(`Teams: <stato>, <n> read, <n> suggestion(s), <n> not found`):

| Stato            | Significato                                                                   | Azione                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `ok`             | Tutte le organizzazioni e i team sono stati letti.                            | Nessuna.                                                                                                  |
| `partial`        | Una chiamata di team o organizzazione è fallita, o si è raggiunto `maxTeams`. | Controlla `teams.errors`; alza `maxTeams` se serve. Con il limite raggiunto "non trovato" non si calcola. |
| `not-authorised` | Non è stato possibile leggere i team di nessuna organizzazione.               | Concedi all'App il permesso di organizzazione **Members: read**, oppure imposta `teams.discovery: false`. |
| `teams: null`    | Discovery dei team disattivata, o pubblico esterno.                           | Atteso per un sito pubblico.                                                                              |

## Rollback

- **Sito**: riesegui una precedente esecuzione riuscita di `deploy-pages` (Actions → run →
  _Re-run all jobs_) oppure fai il revert del commit su `main`. Pages serve l'ultimo
  artifact rilasciato finché un nuovo deploy non va a buon fine.
- **Configurazione o policy**: fai il revert della modifica in `config/` (PR).
  L'esecuzione successiva la applica.
- **Emergenza** (esposizione di dati): vedi [security.md → Risposta a un'esposizione
  accidentale](security.md#risposta-a-unesposizione-accidentale). Per prima cosa disabilita
  Pages.

## Rendere vincolanti i controlli repository

I controlli repository sono informativi per impostazione predefinita. Per farne contare alcuni
per Governance:

1. Apri le pagine dei progetti e leggi **Controlli repository**. Correggi o accetta quello che
   vedi; ricorda che "non visibile" significa che le credenziali non leggono il dato, non che il
   controllo fallisce.
2. Opzionale, per i tre controlli sulle regole del branch: la protezione classica è invisibile
   senza **Administration: read**. Concedi questo permesso di sola lettura alla GitHub App (o al
   token fine-grained) e imposta `repositoryControls.readClassicProtection: true`. È spenta per
   impostazione predefinita e con `false` la chiamata non viene mai fatta.
3. In `config/policies.yaml` imposta un controllo alla volta su `amber` (o `red`) sotto
   `repositoryControls.checks`, elencando se serve `exemptActionOwners` (per esempio `actions`).
   Mantieni `unknownEnforcedCheck: info` finché i dati non sono completi.
4. Esegui `npm run validate:config`, fai il merge e leggi la raccolta successiva: il motivo di
   Governance `repository-check-failed` nomina il controllo e i repository. Governance si muove
   solo quando fallisce un controllo vincolante.
5. Per silenziare un controllo su un repository, aggiungilo a `notApplicableChecks` nel catalogo.

Vedi [Configurazione](configuration.md#controlli-repository-repositorycontrols).

## Pubblicare il riepilogo di qualità dalla CI

La dimensione Qualità legge l'artifact `hub-quality-summary` di ogni repository monitorato
(contratto: [Configurazione](configuration.md#artifact-hub-quality-summary-ogni-repository-opzionale)).
Aggiungi due step allo **stesso job che esegue i test e scrive `coverage/cobertura.xml`**:
ogni job gira su un runner nuovo, quindi un job separato non vedrebbe il file di copertura.
Gli step trasformano il file Cobertura in `quality-summary.json` e lo caricano, solo sul
branch predefinito, con una conservazione di 30 giorni:

```yaml
test:
  runs-on: ubuntu-latest
  permissions:
    contents: read
  steps:
    - uses: actions/checkout@<sha-completo-del-commit>
    # ... configura il tuo toolchain ...
    - name: Esegui i test con la copertura
      run: <il tuo comando di test> # deve scrivere coverage/cobertura.xml
    - name: Scrivi quality-summary.json
      if: github.ref == format('refs/heads/{0}', github.event.repository.default_branch)
      run: |
        python3 - <<'PY'
        import json, os, datetime
        import xml.etree.ElementTree as ET
        root = ET.parse('coverage/cobertura.xml').getroot()
        summary = {
            'schemaVersion': '1.0',
            'repository': os.environ['GITHUB_REPOSITORY'],
            'ref': os.environ['GITHUB_REF'],
            'commitSha': os.environ['GITHUB_SHA'],
            'generatedAt': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            'tool': 'coverlet',
            'format': 'cobertura',
            'lines': {
                'covered': int(root.get('lines-covered')),
                'valid': int(root.get('lines-valid')),
            },
        }
        json.dump(summary, open('quality-summary.json', 'w'))
        PY
    - uses: actions/upload-artifact@<sha-completo-del-commit>
      if: github.ref == format('refs/heads/{0}', github.event.repository.default_branch)
      with:
        name: hub-quality-summary
        path: quality-summary.json
        retention-days: 30
```

Note:

- Fissa l'action a uno SHA completo, come ogni action di questo progetto.
- Mantieni esattamente il nome dell'artifact e del file; lo zip deve restare sotto 64 KB.
- Caricalo solo da esecuzioni sul branch predefinito del repository stesso: le esecuzioni da
  fork o da altri branch sono ignorate dal collector.
- La conservazione è anche l'orizzonte di aggiornamento: dopo il periodo l'artifact scade e
  il report diventa `expired` (non visibile, mai 0%). I report più vecchi di
  `freshness.qualityReportStaleDays` (14 per impostazione predefinita) risultano non
  aggiornati.
- La copertura è letta dagli attributi radice Cobertura `lines-covered` e `lines-valid`. Per
  gli altri formati calcola i due numeri e imposta `format` di conseguenza.

## Pubblicare il riepilogo supply chain dalla CI

I controlli della supply chain leggono l'artifact `hub-supply-chain-summary` di ogni repository
monitorato (contratto: [Configurazione](configuration.md#artifact-hub-supply-chain-summary-ogni-repository-opzionale)).
È l'unico modo in cui l'hub sa che una firma o una provenienza è stata **verificata**, e l'unica
fonte dei digest delle immagini. Aggiungi un job come questo al workflow che costruisce e pubblica
l'immagine, solo sul branch di default. Scrive uno SBOM CycloneDX con syft, verifica la firma
dell'immagine con cosign e la provenienza con `gh attestation verify`, scrive i conteggi con un
programma `jq` inline (l'hub non fornisce script per questo) e carica il riepilogo con una
conservazione di 30 giorni:

```yaml
supply-chain-summary:
  if: github.ref == format('refs/heads/{0}', github.event.repository.default_branch)
  needs: build # il job che ha pubblicato l'immagine ed espone digest e versione
  runs-on: ubuntu-24.04
  permissions:
    contents: read
    packages: read
    attestations: read
  steps:
    - uses: actions/checkout@<full-commit-sha>
      with:
        persist-credentials: false
    # ... installa syft e cosign (versioni fissate) ...
    - name: SBOM (CycloneDX)
      run: syft dir:. -o cyclonedx-json=sbom.cdx.json
    - name: Verify image signature and provenance
      id: verify
      env:
        GH_TOKEN: ${{ github.token }}
        IMAGE: ghcr.io/${{ github.repository }}@${{ needs.build.outputs.digest }}
      run: |
        sig=verified
        cosign verify "$IMAGE" \
          --certificate-identity-regexp "^https://github.com/${GITHUB_REPOSITORY}/" \
          --certificate-oidc-issuer https://token.actions.githubusercontent.com >/dev/null 2>&1 || sig=not-verified
        prov=verified
        gh attestation verify "oci://$IMAGE" -R "$GITHUB_REPOSITORY" >/dev/null 2>&1 || prov=not-verified
        echo "sig=$sig" >> "$GITHUB_OUTPUT"
        echo "prov=$prov" >> "$GITHUB_OUTPUT"
    - name: Write supply-chain-summary.json
      env:
        DIGEST: ${{ needs.build.outputs.digest }}
        TAG: ${{ needs.build.outputs.version }}
        SIG: ${{ steps.verify.outputs.sig }}
        PROV: ${{ steps.verify.outputs.prov }}
      run: |
        jq -n \
          --arg repo "$GITHUB_REPOSITORY" --arg ref "$GITHUB_REF" --arg sha "$GITHUB_SHA" \
          --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
          --arg image "${GITHUB_REPOSITORY,,}" --arg tag "$TAG" --arg digest "$DIGEST" \
          --arg sig "$SIG" --arg prov "$PROV" \
          --slurpfile sbom sbom.cdx.json '
          def lic: [.licenses[]? | .license.id // .expression // empty] | join(" AND ");
          def counts: group_by(.) | map({ id: .[0], count: length }) | sort_by(-.count) | .[:20];
          ($sbom[0].components // []) as $c
          | {
              schemaVersion: "1.0",
              repository: $repo, ref: $ref, commitSha: $sha, generatedAt: $now,
              sbom: {
                format: "cyclonedx", specVersion: $sbom[0].specVersion, tool: "syft",
                packages: ($c | length),
                withoutLicense: ([$c[] | select(lic == "")] | length),
                licenses: ([$c[] | lic
                  | select(. != "" and length <= 100 and test("^[A-Za-z0-9.+()\\s-]+$"))] | counts),
                ecosystems: ([$c[] | (((.purl // "") | capture("^pkg:(?<t>[a-z]+)/") | .t) // "unknown")
                  | if IN("npm", "maven", "pypi", "nuget", "golang", "cargo", "gem", "composer",
                          "githubactions", "docker", "pub", "swift", "hex", "unknown")
                    then . else "other" end] | counts)
              },
              images: [{
                name: $image, tag: $tag, digest: $digest,
                signature: { status: $sig, tool: "cosign" },
                provenance: { status: $prov, tool: "gh-attestation" }
              }]
            }' > supply-chain-summary.json
    - uses: actions/upload-artifact@<full-commit-sha>
      with:
        name: hub-supply-chain-summary
        path: supply-chain-summary.json
        retention-days: 30
```

Note:

- Fissa ogni action a uno SHA di commit completo e ogni strumento a una versione esatta.
- `name` è il path dell'immagine **senza** host del registry, in minuscolo
  (`${GITHUB_REPOSITORY,,}` per un'immagine con il nome del repository su `ghcr.io`).
- Come licenze vengono scritti solo id ed espressioni SPDX; un componente la cui licenza è solo un
  nome libero conta come "senza licenza". L'hub raggruppa ogni `LicenseRef-…` come `LicenseRef-*`
  e non pubblica mai i nomi personalizzati.
- Un repository che non costruisce immagini toglie il blocco `images` (e lo step di verifica); un
  repository che firma solo immagini può togliere `sbom`.
- Se una verifica fallisce, lo step scrive comunque `not-verified`: l'hub mostra allora il
  controllo come fallito, mai come verificato.
- Valgono le stesse regole di conservazione e aggiornamento del riepilogo di qualità
  (`freshness.supplyChainSummaryStaleDays`, 14 giorni di default).

**Trivy, Checkov e ZAP.** Carica i loro risultati come SARIF in code scanning con
`github/codeql-action/upload-sarif`; l'hub li legge dalle analisi di code scanning di ogni
strumento (`supplyChain.toolControls`):

| Strumento | Report                                          | Nome dello strumento in code scanning | Controllo           |
| --------- | ----------------------------------------------- | ------------------------------------- | ------------------- |
| Trivy     | `aquasecurity/trivy-action` con `format: sarif` | `Trivy`                               | `containerScanning` |
| Checkov   | `checkov -o sarif` (tieni il nome predefinito)  | `Checkov`                             | `iacScanning`       |
| ZAP       | report ZAP `sarif-json`                         | `ZAP`                                 | `dast`              |

Se il tuo strumento usa un altro nome, o Trivy scansiona anche l'IaC, aggiungi una regola con un
prefisso `category` (per esempio `{ tool: Trivy, category: trivy-config }` sotto `iacScanning`)
invece di rinominare lo strumento.

## Attivare un provider esterno

SonarQube, Harbor e Argo CD restano spenti finché non li attivi. Per ciascuno:

1. **Configuralo.** Nella cartella di configurazione (il repository di deploy privato per i dati
   reali) imposta `enabled: true` e `baseUrl` in `providers.yaml`
   ([Configurazione](configuration.md#provider-esterni-configprovidersyaml)).
2. **Indica cosa leggere.** Aggiungi `sonarProjectKey` (SonarQube), `containerImages` (Harbor) o
   `argocdApplication` (Argo CD) ai file di progetto
   ([Associazioni dei provider](configuration.md#associazioni-dei-provider-sonarprojectkey-containerimages-argocdapplication)).
   Esegui `npm run validate:config`.
3. **Crea la credenziale** con i permessi minimi elencati in
   [Sicurezza](security.md#provider-esterni) e salvala come secret del repository o dell'ambiente
   (`SONARQUBE_TOKEN`, `HARBOR_ROBOT_NAME` + `HARBOR_ROBOT_SECRET`, `ARGOCD_TOKEN`). Il workflow
   di deploy la passa a `collect-data.yml`, che la mappa solo nello step Collect.
4. **Esegui una raccolta** (riesecuzione manuale). Il log avvisa quando un provider attivo non ha
   credenziale.
5. **Leggi la scheda Provider** nella pagina Qualità dei dati: `available` vuol dire che ogni
   elemento associato è stato letto; `partial` che alcuni no (vedi i conteggi); `not-authorised`
   che la credenziale manca o non ha un permesso; `unknown` che il provider non era raggiungibile.
   Gli elementi oltre `maxItems` sono sconosciuti, mai 0.

Per spegnere di nuovo un provider, imposta `enabled: false`: i suoi elementi spariscono dalle
viste alla raccolta successiva e il secret non viene più letto.

## Gestire eccezioni di sicurezza e SLA

Un'eccezione è una pull request su `config/exceptions.yaml` (CODEOWNERS chiede la revisione del
responsabile). Formato e regole sono in [Configurazione](configuration.md#eccezioni-di-sicurezza-configexceptionsyaml).

1. **Aggiungere:** aggiungi una voce con responsabile, motivo, la data di oggi come `created` (una data futura viene rifiutata) e una data
   `expires` entro `exceptions.maxDays` (180 per default). Preferisci un selettore `alert`; usa `rule`
   (con `tool`) o `advisory` solo per finding ricorrenti.
2. **Controllare in locale:** `npm run policy:check`. Valida il file (gli errori falliscono, gli avvisi
   spiegano), stampa la spiegazione delle policy ed esegue i casi di decisione.
3. **Vedere l'effetto prima del merge:** `npm run policy:check -- --snapshot public/data` rivaluta
   l'ultimo snapshot raccolto con eccezioni e policy attuali e stampa `unchanged:` o `would change:`
   per progetto. È in sola lettura e non scrive nulla. Le eccezioni su finding nascosti sono segnalate
   come non valutabili da uno snapshot pubblicato.
4. **CI:** il job `policy-check` esegue lo stesso comando a ogni pull request e push su `main` (senza
   filtro sui percorsi, così un controllo obbligatorio riporta sempre). `npm run validate:config` valida il
   file anche nei workflow di raccolta e deploy, quindi un file rotto fallisce prima della raccolta.
5. **Rinnovare:** una nuova `expires` (e un nuovo `reason` e `created` se la revisione si è ripetuta), mai
   oltre `maxDays` da `created`. **Rimuovere:** elimina la voce; l'alert torna a contare alla raccolta
   successiva.
6. **Agire sulla scheda Qualità dati:** le voci _scadute_ si rinnovano o si rimuovono; le _obsolete_
   (nessun alert aperto corrisponde) si rimuovono; le _non verificabili_ aspettano che la fonte torni
   leggibile (sistema le credenziali, vedi "Errori parziali"); le _orfane_ indicano un repository che non è
   in nessun progetto del catalogo (correggi il catalogo o elimina la voce).

**Attivare l'escalation degli SLA.** Per default un alert in ritardo è solo informativo. Perché conti,
imposta `remediation.overdue.<class>` a `amber` o `red` in `config/policies.yaml` (la demo lo fa per
critical e high). Esegui prima `npm run policy:check -- --snapshot public/data`: mostra quali progetti
cambierebbero. La prima raccolta dopo la modifica può spostare subito dei progetti, perché l'orologio
dello SLA è partito alla creazione dell'alert; quei finding compaiono come cambio di stato di Sicurezza in
"Cosa è cambiato", non come "scaduti da poco".

## Storico tra le esecuzioni

Ogni raccolta aggiunge a `history.json` un punto compatto per progetto, e il collector lo
confronta con il precedente per scrivere `changes.json` (la pagina "Cosa è cambiato"). Il
runner parte vuoto ogni volta, quindi è GitHub Actions a portare lo storico:

- il job `collect` esegue prima `npm run history:restore`. Legge l'artifact `hub-history`
  più recente del **proprio** repository con `GITHUB_TOKEN` e `actions: read` (mai con le
  credenziali del collector); poi il collector aggiunge e scrive il nuovo file;
- il job carica un nuovo artifact `hub-history` (solo `history.json`, 90 giorni), solo con
  `data-source: github` e solo se il ripristino è finito in `restored` o `none`. Dopo un
  ripristino `failed` (o uno step di ripristino andato in errore) non si carica nulla: lo
  storico nuovo, di una sola voce, diventerebbe l'artifact più recente e farebbe perdere
  tutta la catena, quindi resta il più recente quello precedente e la prossima esecuzione
  riprova. Un'esecuzione mock manuale non può mai rompere la catena reale;
- un'esecuzione mock non ripristina mai: parte dal `fixtures/history/history.json`
  sintetico.

Il ripristino scorre fino a 500 artifact (5 pagine da 100), dal più recente, e se un artifact
affidabile non è un archivio valido prova il successivo (fino a 3 archivi non validi) prima
di arrendersi con `bad-archive`.

Sono accettati solo artifact del branch predefinito, di questo repository (non di un
fork), di un'altra esecuzione, fino a 5 MiB e del workflow di deploy o di raccolta. Tutto il
resto non viene usato.

### Stati del ripristino

Lo stato è in `history.json` (`restore.state`), in `changes.json` (`basis.state`), nella
scheda "Storico" di Qualità dei dati e nel riepilogo del job. Uno stato diverso da
`restored` non fa mai fallire la raccolta, e la pagina "Cosa è cambiato" lo spiega invece di
dire "nessun cambiamento".

| Stato            | Significato                                                                                                    | Cosa fare                                                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `restored`       | Lo storico precedente è stato letto ed esteso.                                                                 | Niente.                                                                                                                                                            |
| `fixture`        | Esecuzione mock, partita dalla fixture sintetica.                                                              | Niente. Dati demo.                                                                                                                                                 |
| `none`           | Nessuno storico precedente (prima esecuzione, artifact scaduti, `--fresh-history`).                            | Niente. I cambiamenti compaiono dopo la prossima raccolta.                                                                                                         |
| `restore-failed` | Non è stato possibile scaricare l'artifact (non autorizzato, archivio non valido, errore API).                 | Verifica che il job `collect` abbia `actions: read` (il log del workflow stampa il codice del motivo). Non si carica nulla, quindi la prossima esecuzione riprova. |
| `unreadable`     | Il file precedente era troppo grande, non JSON, non valido per lo schema o non pubblicabile; è stato scartato. | Di solito è un caso isolato. Se si ripete, controlla l'esecuzione precedente.                                                                                      |
| `incompatible`   | Il file precedente usa una versione di schema che questa versione non legge.                                   | Niente: lo storico riparte da questa raccolta.                                                                                                                     |
| `source-changed` | Lo storico precedente veniva dall'altra fonte dati (mock o GitHub).                                            | Niente: lo storico riparte da questa raccolta. Voci più vecchie dell'altra fonte, dietro un'ultima voce corrispondente, vengono scartate con una nota.             |

Lo storico non blocca mai gli snapshot. Se lo storico ripristinato supera i controlli ma non
è comunque pubblicabile, viene scartato (stato `unreadable`). Se non si riesce a costruire
nemmeno uno storico da zero, `history.json` e `changes.json` non vengono scritti per
quell'esecuzione, gli snapshot sì, e il riepilogo del job mostra
`History | not written this run` con il motivo sotto "History notes".

Limiti: lo storico copre al massimo 500 progetti (un catalogo più grande non ha storico e
riceve una nota). Per progetto tiene al massimo 500 repository, alert critici/alti aperti,
fonti illeggibili e chiavi di errore, e 200 versioni. Un elenco al limite può essere stato
tagliato, quindi il "Cosa è cambiato" successivo non elenca alert (o errori) nuovi per quel
progetto e lo segna come parziale. Se `history.json` supera gli 8 MiB letti dall'esecuzione
successiva, le raccolte più vecchie vengono scartate con una nota.

### Azzerare lo storico

Avvia a mano il workflow **Collect — Data snapshots** (`workflow_dispatch`) con
`data-source: github` e `fresh-history: true`. Salta il ripristino, registra il motivo
`fresh-history` nel riepilogo del job e il nuovo storico sostituisce la catena. In
alternativa, elimina tutti gli artifact `hub-history` (repository, Actions, Artifacts): la
raccolta successiva riparte da zero (stato `none`). Impostare `history.enabled: false`
**non** azzera nulla: non si carica nessun nuovo artifact, quindi quello vecchio viene
ripristinato di nuovo quando lo riattivi.

### Concorrenza e scadenza

Il job `collect` gira nel gruppo di concorrenza `hub-collect` con
`cancel-in-progress: false`, così due raccolte non ripristinano mai la stessa base
sovrascrivendosi a vicenda. L'artifact dura 90 giorni: se nessuna raccolta gira per più
tempo, la catena si perde e lo storico riparte (stato `none`).

## Dati locali e `ci:build`

`npm run ci:build` esegue `collect:mock`, che sovrascrive `public/data`. Uno snapshot locale
con dati reali (per esempio da `collect:github`) va raccolto di nuovo dopo di esso.

**Aggiornamento allo snapshot 1.5** (controlli repository): il sito legge solo `schemaVersion` 1.5. Un `public/data` 1.4 esistente non supera la validazione finché non viene raccolto di nuovo (`collect:github`, o la prossima esecuzione pianificata). `history.json` 1.0 viene ancora letto; lo schema dello storico passa a 1.1 alla prima raccolta.

**Nota precedente, snapshot 1.4** (dimensione Qualità): il sito legge solo
`schemaVersion` 1.4. Un `public/data` 1.3 esistente non supera la validazione finché non viene
raccolto di nuovo (`collect:github`, o la prossima esecuzione pianificata). Ricorda che
`npm run ci:build` sovrascrive `public/data` con dati mock.

Un `npm run collect:github` locale aggiunge a `public/data/history.json` (il percorso
predefinito dello storico è la directory di output), quindi uno storico locale con dati reali
cresce tra le esecuzioni come quello della CI. `npm run ci:build` ci scrive sopra lo storico mock.

## Conservazione degli artifact

| Artifact                                              | Conservazione           | Contenuto                                  |
| ----------------------------------------------------- | ----------------------- | ------------------------------------------ |
| `snapshots`                                           | 14 giorni               | JSON sanitizzato + collection report       |
| `site`                                                | 1 giorno                | `dist/` generata, passata al job di deploy |
| `github-pages`                                        | default di GitHub       | Artifact di deployment di Pages            |
| Report di coverage CI                                 | default upstream        | Coverage di Vitest (`coverage/`)           |
| `hub-quality-summary` (in ogni repository monitorato) | 30 giorni (consigliato) | `quality-summary.json`: solo conteggi      |
| `hub-history`                                         | 90 giorni               | `history.json`: solo punti compatti        |

Gli artifact contengono solo dati sanitizzati e pubblicabili. Non contengono mai
credenziali, file temporanei o payload grezzi.
