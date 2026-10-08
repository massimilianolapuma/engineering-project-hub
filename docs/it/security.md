# Sicurezza

> 🇬🇧 [English version](../security.md) · Segnalare una vulnerabilità: [SECURITY.md](../../SECURITY.md)

## Threat model (sintesi)

| #   | Minaccia                                                                                        | Mitigazione                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | Una credenziale (token, chiave privata della App) finisce nel sito statico                      | I secret esistono solo nel job `collect`. I job build e deploy non ne hanno. Il gate delle credenziali viene eseguito sugli snapshot, e `scan-output` analizza `dist/` e `public/data/` alla ricerca dei pattern e dei valori esatti delle credenziali d'ambiente. Il logging di Octokit è disabilitato.                                                                                            |
| T2  | Viene pubblicato il valore o la posizione di un alert di secret scanning                        | Gli alert sono richiesti con `hide_secret=true`. Il DTO non ha campi per valore, posizione, file o commit. Viene conservato solo il nome del _tipo_ di secret.                                                                                                                                                                                                                                      |
| T3  | Vengono pubblicati un payload API grezzo, uno stack trace, un header o una variabile d'ambiente | Allowlist: proiezione sul DTO, poi schemi Zod strict che rifiutano le chiavi sconosciute. I messaggi di errore sono classificati e ripuliti (header, stack frame, query string e codice rimossi).                                                                                                                                                                                                   |
| T4  | Dettagli di repository privati trapelano tramite una Page pubblica                              | `publication.audience: public` (predefinito) omette titoli e rule id dei finding nei repository non pubblici. Vedi più avanti le indicazioni sulle Pages private.                                                                                                                                                                                                                                   |
| T5  | Dati malevoli nei repository monitorati (titoli di alert, tag, URL, manifest costruiti ad arte) | Il testo viene ripulito e troncato. I link devono essere `https` su host in allowlist (`github.com`), senza credenziali, query o fragment. I file di contratto sono validati con Zod. Astro effettua l'escape dell'HTML. La CSP blocca gli script inline e di terze parti.                                                                                                                          |
| T6  | "Zero alert" interpretato come "sicuro"                                                         | La copertura è una dimensione separata. Unknown (Sconosciuto) non è mai 0. 403 significa Not authorised (Non autorizzato) e un 404 ambiguo significa Unknown (Sconosciuto). La sicurezza non è mai verde se la copertura non è completa.                                                                                                                                                            |
| T7  | Credenziali con privilegi eccessivi                                                             | GitHub App con permessi in sola lettura, installata solo sui repository monitorati. Nessuno scope di scrittura in alcun punto del collector.                                                                                                                                                                                                                                                        |
| T8  | Supply chain (action, npm)                                                                      | Le action sono fissate a SHA completi. Dependabot copre npm e le action. zizmor e Trivy vengono eseguiti in CI. `npm ci` usa il lockfile. I font sono self-hosted, senza CDN. Ogni deploy pubblica una SBOM CycloneDX (`/sbom.cdx.json`) e attestazioni firmate di provenienza e SBOM del bundle esatto (`gh attestation verify site.tar -R <owner>/<repo>`, bundle nell'artifact `site-attested`). |
| T9  | Il portale viene usato per modificare qualcosa                                                  | Il collector esegue solo richieste GET. Non chiude alert, non avvia workflow e non scrive sui repository.                                                                                                                                                                                                                                                                                           |

## Dati pubblicati

- Nomi dei repository, visibilità, branch predefinito, flag di archiviazione, topic, SHA e
  link dell'ultimo commit.
- Nomi, date e link di release e tag. Versioni dichiarate nel release manifest.
- Esecuzioni dei workflow monitorati: id, numero, tentativo, stato, conclusione, branch,
  evento, SHA, timestamp, link e i **nomi di job/step** falliti (mai i log).
- Finding: identificativo, categoria, severità e stato normalizzati e originali, rule id o
  advisory id\*, titolo sanitizzato\*, repository, componente, date, disponibilità di una
  fix, link GitHub, strumento, classificazione del dato.
- Stati dei controlli per repository, conteggi riportati dagli scanner esterni e link ai
  relativi report (solo host in allowlist).
- Errori di raccolta classificati (repository, fonte, classe, stato HTTP, breve dettaglio
  ripulito).

\* Omessi per i repository non pubblici quando `audience: public`.

## Dati mai pubblicati

Valori o frammenti di secret, path dei file e numeri di riga dei secret, contenuti dei file,
snippet di codice, contenuti dei commit, log, header HTTP, query string, payload API
grezzi, stack trace, variabili d'ambiente, token, la chiave privata della App, gli actor
dei workflow (non raccolti) e tutto ciò che è al di fuori degli schemi degli snapshot.

## Modello di autorizzazione

- **Consigliata: GitHub App**, installata solo sui repository monitorati, con permessi di
  repository in sola lettura: **Metadata**, **Contents**, **Actions**, **Code scanning
  alerts** (`security_events`), **Dependabot alerts** (`vulnerability_alerts`) e **Secret
  scanning alerts** (`secret_scanning_alerts`). Deployments ed Environments non sono
  necessari all'MVP (per elencare gli ambienti serve Actions: read). I nomi dei permessi
  sono stati verificati sulla pagina GitHub
  [permissions-required-for-github-apps](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps)
  il 2026-10-03.
- **Fallback (solo MVP): un PAT fine-grained** in `GH_READ_TOKEN`. Limitalo ai repository
  monitorati, assegnagli gli stessi permessi in sola lettura e usa una scadenza breve. È
  legato a una persona, quindi è preferibile la App.
- **`GITHUB_TOKEN`**: ultima risorsa. Può leggere solo il repository corrente.
- Non esiste alcun fallback silenzioso tra le modalità. La modalità usata è registrata in
  ogni snapshot (`run.authenticationMode`) e mostrata nella pagina Qualità dati.

## Privilegio minimo nei workflow

- Ogni workflow ha `permissions: contents: read` a livello top.
- `collect`: `contents: read`. I secret sono mappati solo nell'`env` dello step del
  collector.
- `build`: `contents: read`, `pages: read` (configure-pages). Nessun secret.
- `deploy`: `pages: write` e `id-token: write`, solo nel reusable job di deploy.
- CI: nessun secret. Il lint del titolo della PR richiede `pull-requests: write` e
  `statuses: write`. Gli upload SARIF (zizmor, Trivy) richiedono `security-events: write`, solo su quei job.
- `persist-credentials: false` è impostato sul checkout ovunque.

## Hardening del repository (impostazioni GitHub)

Applicate su `massimilianolapuma/engineering-project-hub` (repository pubblico). Vanno
ricontrollate dopo un trasferimento o un fork:

| Impostazione                                  | Valore                                                                                                                     |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Secret scanning + push protection             | Attivi: una credenziale committata viene bloccata al push e segnalata.                                                     |
| CodeQL (setup predefinito)                    | `javascript-typescript` e `actions`, suite di query `extended`.                                                            |
| Alert e aggiornamenti di sicurezza Dependabot | Attivi.                                                                                                                    |
| Segnalazione privata delle vulnerabilità      | Attiva (vedi [SECURITY.md](../../SECURITY.md)).                                                                            |
| Permessi predefiniti di `GITHUB_TOKEN`        | Sola lettura; le Actions non possono approvare pull request. Ogni workflow dichiara i propri permessi.                     |
| Policy delle Actions                          | Ogni action deve essere fissata a uno SHA di commit completo (`sha_pinning_required`).                                     |
| Ruleset `main`                                | Pull request obbligatoria, 7 check obbligatori, niente cancellazione o force push; bypass admin solo tramite pull request. |
| Ruleset `release-tags` (`refs/tags/v*`)       | Niente creazione, modifica, cancellazione o force push, salvo admin dell'organizzazione (release).                         |
| Strategia di merge                            | Solo squash; i branch vengono eliminati dopo il merge.                                                                     |
| Environment `github-pages`                    | Deploy solo da `main`.                                                                                                     |
| Organizzazione                                | Autenticazione a due fattori obbligatoria per i membri (impostata dall'interfaccia dell'organizzazione).                   |

## Sanitizzazione

Esiste un unico modulo centrale, `collector/src/sanitizers/sanitize.ts`, con l'elenco
condiviso dei pattern in `shared/security/patterns.ts`:

1. **Proiezione**: i provider mappano le risposte su DTO minimi (allowlist). I campi
   sconosciuti vengono scartati.
2. **Pulizia** (`scrubText`): rimuove blocchi PEM, code fence e codice inline, stack frame,
   i valori di `Authorization`, `Cookie` e di altri header, token GitHub (`gh*_`,
   `github_pat_`), `Bearer …`, credenziali `key=value`, chiavi AWS e Slack, credenziali
   incorporate negli URL, query string e fragment, caratteri di controllo e i valori esatti
   delle credenziali d'ambiente. Poi tronca il risultato.
3. **Link** (`sanitizeUrl`): devono essere `https` su `publication.allowedLinkHosts`.
   Credenziali, query e fragment vengono rimossi.
4. **Schemi strict**: gli schemi degli snapshot sono `.strict()`, quindi le chiavi
   sconosciute fanno fallire l'esecuzione.
5. **Gate** (`assertPublishable`): qualsiasi corrispondenza con un pattern in un file
   serializzato interrompe l'esecuzione prima della scrittura. Vengono riportati solo i
   nomi dei pattern, mai i valori.
6. **Scansione dell'output** (`npm run scan:output`): ricontrolla i `dist/` e `public/data/`
   finali, inclusi i tipi di file vietati (`.env`, `.pem`, `.key`, `.npmrc`).

I test usano valori canary (`ghp_exampleSecretValue`, `github_pat_exampleSecretValue`,
`Bearer example-token`, `PRIVATE KEY`, `password=example`). Questi si trovano solo in
`tests/helpers/canaries.ts` e mai nelle fixture che alimentano la build pubblicata.

## Rischio di GitHub Pages e repository privati

GitHub Pages è hosting statico. Sulla maggior parte dei piani un sito Pages è
**pubblico**, anche quando il repository è privato. Le Pages private (con controllo degli
accessi) richiedono GitHub Enterprise Cloud. **Verifica il tuo piano effettivo.**

| Situazione                                                    | Raccomandazione                                                                                                                                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I repository monitorati sono pubblici                         | `audience: public` va bene.                                                                                                                                                                       |
| Alcuni repository monitorati sono privati, la Page è pubblica | Mantieni `audience: public` (dettagli omessi). Ricorda che nomi dei repository, conteggi, stati e versioni vengono comunque pubblicati. Se anche questo è riservato, non usare una Page pubblica. |
| Page con controllo degli accessi (Pages private)              | `audience: restricted` è accettabile. Chiunque possa aprire il sito vede i dettagli di tutti i progetti, quindi il portale **non applica alcuna autorizzazione per progetto o per alert**.        |

**Portale riservato e vista sanitizzata.** Un portale riservato mostra il dettaglio
sanitizzato completo a un pubblico autorizzato su tutti i progetti monitorati. Una vista
sanitizzata pubblica o executive mostra solo stati e conteggi aggregati. L'MVP implementa
entrambe tramite `publication.audience`. L'autorizzazione per utente è fuori ambito,
perché è nei link a GitHub che GitHub applica i permessi reali di ciascun utente.

Non indebolire mai la sanitizzazione per "vedere di più". Segui invece il link a GitHub.

## Rotazione delle credenziali

1. **GitHub App**: genera una nuova chiave privata nelle impostazioni della App, aggiorna il
   secret `GH_APP_PRIVATE_KEY`, esegui manualmente `deploy-pages.yml` per verificare, poi
   elimina la vecchia chiave.
2. **PAT** (`GH_READ_TOKEN`): crea un nuovo token fine-grained con lo stesso ambito,
   aggiorna il secret, verifica, poi revoca il vecchio token. Ruotalo prima della scadenza
   (si consigliano 90 giorni o meno).
3. Dopo la rotazione controlla la pagina Qualità dati: la modalità di autenticazione è
   quella attesa e non ci sono nuove voci Not authorised (Non autorizzato).

## Risposta a un'esposizione accidentale

1. **Contenimento**: disabilita il deployment di Pages (Settings → Pages) oppure rilascia
   una build nota come sicura. Annulla qualsiasi workflow `deploy-pages` in esecuzione.
2. **Revoca**: ruota subito la credenziale coinvolta (vedi sopra). Per un secret trapelato
   trovato in un repository monitorato, segui il processo di gestione degli incidenti di
   quel repository.
3. **Rimozione**: elimina gli artifact dei workflow che contengono l'esposizione
   (Actions → run → artifacts) e riesegui il deploy, così Pages serve contenuti puliti. Le
   cache della CDN possono impiegare alcuni minuti a scadere.
4. **Correzione**: aggiungi il pattern trapelato a `shared/security/patterns.ts` e un test
   con canary. Individua il campo che ha aggirato l'allowlist.
5. **Segnalazione**: segui [SECURITY.md](../../SECURITY.md) e registra una nota
   post-incidente.

## Advisory noto su una dipendenza

`npm audit` segnala un advisory di livello high per `http-cache-semantics`
(GHSA-ch52-4w7c-c8xp), usato dalla cache delle immagini di Astro. Riguarda le cache HTTP
condivise nei server. Il portale è una build statica senza server a runtime e senza
immagini remote, quindi qui non è sfruttabile. Segui la fix upstream tramite Dependabot.

## Limitazioni

- Nessuna autorizzazione per alert o per progetto all'interno del sito. Il pubblico del
  sito coincide con quello di Pages.
- Nessun alert non significa nessuna vulnerabilità. La copertura dipende dai controlli
  configurati e da ciò che restituiscono le API (fino a 300 alert per fonte e per
  repository).
- I risultati degli scanner esterni sono considerati attendibili così come dichiarati in
  `.security/project-security-status.json`. Nell'MVP quel file non è firmato (roadmap:
  attestation).
- La sanitizzazione è basata su pattern, in aggiunta all'allowlist. Nuovi formati di
  credenziali possono richiedere nuovi pattern.
