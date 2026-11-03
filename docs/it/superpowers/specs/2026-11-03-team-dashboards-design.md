# Dashboard per team — "i miei progetti" tramite i team GitHub

English: [../../../superpowers/specs/2026-11-03-team-dashboards-design.md](../../../superpowers/specs/2026-11-03-team-dashboards-design.md)

Stato: bozza per la revisione del titolare (verifica del costruttore fatta) · Data: 2026-11-03 · Release prevista: dopo la v0.10.0 (ordine rispetto al lavoro supply chain deciso nel piano, vedi §9)

## 1. Intento e perché

Il catalogo ora censisce ogni progetto. La domanda successiva del titolare: come fa ogni persona ad avere la _propria_ dashboard?

L'immagine data dal titolare: un responsabile con più progetti e molti repository apre l'hub e vede i **suoi** progetti, poi entra in un progetto e nei suoi repository. L'appartenenza deve venire da GitHub (team e permessi), con una configurazione manuale nel catalogo quando GitHub non basta.

Per ora l'azienda ospiterà l'hub solo su **GitHub Pages con visibilità privata**. Le Pages private aprono o chiudono l'intero sito in base all'accesso in lettura al repository dell'hub, e la pagina non sa chi la sta guardando. Nascondere davvero i progetti persona per persona richiede quindi un componente server, che il titolare rimanda a quando il progetto si sarà dimostrato interessante. Per l'MVP il titolare accetta che **chiunque possa aprire l'hub veda tutti i progetti** (2026-11-03).

L'MVP è quindi una _vista_, non un confine di sicurezza: i progetti riportano i loro team GitHub e la home filtra per team con un link salvabile nei preferiti. Un responsabile sceglie i suoi team una volta, salva il link e lo apre ogni mattina.

Come l'azienda nomina i team (titolare, 2026-11-03):

- I **team trasversali** lavorano sui repository di molti progetti (per esempio un team piattaforma o sicurezza).
- I **team di progetto** seguono `<linea>-<progetto>-<ruolo>`: linea di business, progetto, ruolo (per esempio `dev`). Un responsabile di solito è membro di più team, uno per progetto.

## 2. Obiettivi, non obiettivi, anti-obiettivi

Obiettivi

- Ogni progetto del catalogo può riportare un elenco di team GitHub.
- La home ha un filtro **Team** che accetta più team insieme. La selezione vive nel link (`/?team=a&team=b`), e un progetto compare quando ha almeno uno dei team selezionati.
- La discovery legge i team da GitHub e li **propone** per ogni progetto nell'editor del catalogo, usando l'accesso team → repository e la regola di nomenclatura. Nulla entra nel catalogo senza la pull request dell'editor.
- L'editor del catalogo modifica l'elenco dei team.
- Lo stesso campo `teams` è l'ingresso di un futuro controllo d'accesso per persona (§8), così nulla va rifatto.

Non obiettivi (MVP)

- Nessuna modifica al login e nessun controllo d'accesso per persona: chiunque apra l'hub vede tutti i progetti.
- Nessun componente server, nessun dato utente salvato da nessuna parte.
- Nessun filtro per team su Sicurezza, Versioni, Modifiche, Workflow o Qualità dei dati. Solo la home filtra per team.
- Nessuna lettura dei **membri** dei team (chi è in un team): solo i team e i loro repository.
- Nessun "ricorda i miei team" nella memoria del browser: la memoria è il link.

Anti-obiettivi (fallimento anche se "funziona")

- Presentare il filtro per team come controllo d'accesso, nell'interfaccia o nei documenti. È una vista.
- Un nome reale di team, linea di business o progetto aziendale nel repository pubblico (documenti, fixture, test, esempi).
- Una discovery che scrive nel catalogo, o che propone team partendo da dati che non poteva leggere.
- Un filtro per team che scarta progetti in silenzio: i team del link che non esistono nel catalogo e i progetti senza team sono sempre conteggiati nella riga dei risultati.
- Qualsiasi permesso di scrittura, o un permesso GitHub più ampio di **Members: read** (organizzazione) per questa funzione.

## 3. Vincoli (dalle regole del progetto)

- Sito Astro statico, CSP rigida (`script-src 'self'`, `connect-src 'self'`), nessuna chiamata a GitHub dal browser. Il filtro lavora nel browser sull'elenco già generato, come i filtri esistenti in `src/scripts/portfolio-filters.ts`; senza JavaScript compare l'elenco completo.
- Collector GitHub App in sola lettura; ogni nuovo permesso è in sola lettura ed è documentato in `docs/security.md` (EN + IT).
- Bilingue EN (`/`) e IT (`/it/`): ogni stringa in `src/i18n/en.ts` e `it.ts`, ogni documento in EN e IT.
- Solo dati fittizi nel repository pubblico (`example-org`); le fixture usano team inventati come `pay-project-alpha-dev` e `platform`.
- Interfaccia in Primer (ADR 0009). **Design prima del codice:** i mockup delle schermate modificate in Claude Design (design system Primer), approvati dal titolare prima di scrivere codice dell'interfaccia. I link di Claude Design non vengono mai committati.
- Mai eseguire `npm run ci:build` o `npm run collect:mock` in locale (sovrascrivono lo snapshot reale in `public/data`). Container solo con Podman.

## 4. Decisioni prese con il titolare

1. **In azienda l'hosting è solo GitHub Pages** per ora; un componente server arriverà dopo, se il progetto cresce (titolare, 2026-11-03).
2. **MVP senza filtro d'accesso:** chiunque abbia accesso all'hub vede tutti i progetti (titolare, 2026-11-03).
3. **"I miei progetti" = un campo `teams` nel catalogo più un link `?team=`** (titolare, 2026-11-03).
4. **I team sono team GitHub.** I team trasversali coprono molti progetti; i team di progetto seguono `<linea>-<progetto>-<ruolo>`; un responsabile è in più team, uno per progetto (titolare, 2026-11-03). Per questo il filtro accetta più team.

## 5. Design

### 5.1 Catalogo: `teams` su ogni progetto

`config/projects/<id>.yaml` riceve un campo facoltativo:

```yaml
teams:
  - example-org/pay-project-alpha-dev
  - example-org/platform
```

- Ogni voce è `<org>/<team-slug>`, la forma usata dalle API di GitHub. Formato dello slug: lettere minuscole, cifre, `-` e `_`, da 1 a 100 caratteri; organizzazione con lo stesso formato di `discovery.owners`.
- Valore predefinito `[]`. I duplicati sono un errore di validazione.
- Il link usa **solo lo slug** (`?team=pay-project-alpha-dev`), così i preferiti restano leggibili. _Scelta mia:_ la build fallisce con un messaggio chiaro quando due team del catalogo hanno lo stesso slug in organizzazioni diverse (raro; se succede, costa un riferimento da rinominare).
- `ProjectConfigSchema` in `shared/model/catalog.ts` riceve `teams`; lo schema JSON viene rigenerato (`npm run schema:generate`).

### 5.2 Snapshot e indice

- `project.teams` viene copiato nello snapshot del progetto e nella voce dell'indice del portafoglio (`toProjectSummary` in `collector/src/build-snapshot.ts`).
- È un aumento minore della versione dello schema dello snapshot (la prossima libera dopo il lavoro supply chain: 1.7 o 1.8, vedi §9), con fixture e snapshot di riferimento aggiornati.
- _Scelta mia:_ l'export CSV del portafoglio (`src/lib/exports.ts`) riceve una colonna `teams`, con i valori uniti da `;`.

### 5.3 Discovery: proposta dei team

Nuove impostazioni in `config/catalog.yaml`, in un **blocco `teams` di primo livello**, indipendente dalla discovery dei repository. _Scelta mia:_ i suggerimenti dei team devono funzionare con `discovery.enabled: false`, che è l'impostazione attuale del titolare, senza attivare la scansione completa dei repository.

```yaml
teams:
  discovery: true # legge i team e i loro repository (organizzazione, Members: read)
  naming: # facoltativo: come sono nominati i team di progetto
    pattern: '{line}-{project}-{role}'
    roles: [dev, ops, qa]
    lines: # prefisso della linea → business unit
      pay: Payments
      fin: Finance
  maxTeams: 300
```

`CatalogSettingsSchema` / `CatalogSchema` ricevono un blocco `teams` facoltativo. `discovery` non cambia.

Lettura:

- **Organizzazioni lette:**
  - I proprietari dei repository già presenti nel catalogo (coordinatori e componenti), più `discovery.owners` quando la discovery dei repository è attiva.
  - Solo quelli che sono organizzazioni (gli account utente non hanno team), ognuno letto una volta sola.
- **Endpoint:** `GET /orgs/{org}/teams` (paginato), poi `GET /orgs/{org}/teams/{team_slug}/repos` per ogni team.
  - Entrambi richiedono il permesso di organizzazione **Members: read** (verificato nelle tabelle dei permessi di GitHub, 2026-11-03).
  - Le voci dei repository riportano il permesso del team su ogni repository (`permissions` / `role_name`). Il piano lo verifica sull'API reale; se manca, ripiega su `GET /orgs/{org}/teams/{team_slug}/repos/{owner}/{repo}`, ma solo per i repository del catalogo.
- **Limiti:** `maxTeams` (predefinito 300, massimo 1000) e il limitatore di concorrenza esistente.
- **Cosa si tiene:** solo lo slug e il nome del team, i nomi completi dei repository e il livello di permesso del team su ognuno.
  - Descrizioni, membri e le altre impostazioni del team vengono scartati prima di salvare qualsiasi cosa.
- **Team segreti:** _Scelta mia:_ i team con `privacy: secret` vengono saltati prima di salvare qualsiasi cosa. Le Pages private possono ammettere collaboratori esterni che non sono membri dell'organizzazione, e i nomi dei team segreti sono pensati solo per i membri.
  - L'esecuzione riporta quanti ne ha saltati (un numero, mai i nomi).
  - Un team segreto può comunque essere scritto a mano in un file di progetto.
- **Pubblico aperto:** _Scelta mia:_ con `publication.audience: public`, `teams.discovery` è forzato a spento, come `includePrivate`. I nomi dei team descrivono l'organizzazione e restano fuori da una build pubblica.
  - I team scritti a mano nei file di progetto vengono pubblicati così come sono, e i documenti lo dicono.
- **Permesso mancante:** se l'App non ha Members: read (un 403), il risultato dei team registra `not-authorised`, l'editor del catalogo spiega come concederlo, e l'esecuzione non fallisce.
  - _Scelta mia:_ questo stato vive solo nel risultato dei team di `catalog.json`. Le capacità dell'esecuzione in `index.json` e la pagina Qualità dei dati non cambiano.
  - L'inserimento dei team a mano continua a funzionare.

I risultati finiscono in `catalog.json` come risultato `teams` separato, accanto a `discovery`: suggerimenti per progetto, più le note sui team saltati e sul permesso mancante. Vale `null` quando `teams.discovery` è spento.

Proposte:

- **Per accesso:** per ogni progetto del catalogo, un team viene proposto quando non è già in `teams` e ha almeno accesso in **scrittura** (write, maintain o admin) ad almeno uno dei repository del progetto (coordinatore o componenti).
  - Ogni proposta riporta la sua prova, per esempio "accesso in scrittura a 3 repository su 5".
  - _Scelta mia:_ l'accesso in sola lettura e triage è ignorato, così un team ampio in sola lettura non viene proposto per ogni progetto.
- **Per nome:** un team il cui slug corrisponde a `teams.naming` viene scomposto in linea, progetto e ruolo.
  - La scomposizione è univoca: la linea deve essere una chiave di `lines`, il ruolo deve essere in `roles`, e il progetto è quello che resta in mezzo.
  - La parte progetto è usata come indizio, come l'attuale `hintedProjectId`: se coincide con l'id di un progetto del catalogo, il team viene proposto per quel progetto anche senza accesso ai repository.
  - La linea suggerisce la business unit per le proposte di nuovi progetti.
  - Il pattern accetta esattamente i segnaposto `{line}`, `{project}` e `{role}`, ognuno una volta, uniti da `-`. Qualsiasi altro pattern è un errore di configurazione.
- Anche le proposte di **nuovi** progetti (le proposte di discovery esistenti) riportano i loro team.
- Nulla viene aggiunto a un file di progetto finché il titolare non lo salva tramite l'editor del catalogo (pull request).

### 5.4 Editor del catalogo (`/catalog/`)

- Un campo **Team** su ogni progetto: i team attuali come Label rimovibili, un campo per aggiungere `<org>/<slug>` (validato come in §5.1), e i suggerimenti della discovery con la loro prova e un pulsante "Aggiungi".
- Il salvataggio funziona come oggi: una pull request sul file del progetto.
- Quando la discovery dei team è spenta o non autorizzata, l'area dei suggerimenti spiega il motivo in una riga.

### 5.5 Home: il filtro per team

- Un controllo **Team** nella riga dei filtri, accanto a "Business unit". È un menu a tendina con caselle di spunta nello stile SelectPanel di Primer, e permette di selezionare più team. Elenca solo i team presenti nel catalogo.
  - _Scelta mia:_ i team sono raggruppati per linea di business quando `teams.naming` li scompone; gli altri stanno sotto "Team trasversali".
- I team selezionati compaiono come Label rimovibili accanto al controllo.
- Il link tiene un parametro `team` per ogni team selezionato (`/?team=a&team=b`). Il filtro si applica al caricamento, e il link si può salvare nei preferiti e condividere, come i filtri esistenti `q`, `health`, `bu`, `sort`, `lifecycle` e `severity`.
- Corrispondenza:
  - Un progetto compare quando i suoi `teams` contengono almeno uno degli slug selezionati (OR).
  - Il filtro per team si combina con gli altri filtri in AND, come fanno oggi.
  - I progetti senza team non corrispondono mai a un filtro per team.
- **Nulla scartato in silenzio:**
  - Un valore `team` nel link che nessun progetto del catalogo usa compare comunque come Label marcata "non nel catalogo" e non corrisponde a nulla.
  - La riga dei risultati mantiene la forma "{shown} di {total} progetti". Mentre un filtro per team è attivo, aggiunge "· N progetti senza team non mostrati" quando gli altri filtri li avrebbero mostrati, come il segmento esistente per i conteggi di avvisi sconosciuti (`resultsLine` in `src/lib/portfolio-filters-core.ts`). Le nuove stringhe al plurale vanno in EN e IT.
  - "Cancella filtri" toglie anche i team.
- Ogni riga di progetto mostra i suoi team come piccole Label, al massimo 3, poi "+N".
- La pagina del progetto (`/projects/<id>/`) elenca i team del progetto nella riga di metadati dell'intestazione. È qui che il responsabile "entra nel progetto e nei suoi repository". L'elenco dei repository non cambia.
- Quando nessun progetto del catalogo ha team, il controllo Team non viene mostrato.
- Telefoni: il controllo sta dentro la sezione a scomparsa "Filtri" esistente, senza scorrimento orizzontale a 390px.
- Accessibilità:
  - Il menu è un elemento a scomparsa con un gruppo etichettato di caselle di spunta, quindi si usa con tastiera e lettore di schermo.
  - Ogni Label rimovibile è un pulsante con nome accessibile "Rimuovi il team {name}".
  - I valori presi dal link sono inseriti come testo, mai come HTML.

### 5.6 Documentazione

EN + IT per tutti questi:

- **`docs/configuration.md`:** il campo `teams`, il blocco `teams` in `config/catalog.yaml` (`discovery`, `naming`, `maxTeams`), e come un responsabile salva il suo link nei preferiti.
- **`docs/security.md`:**
  - Il nuovo permesso di organizzazione **Members: read**, con i suoi endpoint.
  - La nota che il filtro per team non è un controllo d'accesso.
- **`docs/operations.md`:** il caso `not-authorised` per i team.
- **README:** un breve paragrafo "I miei progetti".
- **CHANGELOG:** una voce sotto `[Unreleased]`.
- **Un nuovo ADR** (prossimo numero libero, vedi §9): "Viste per team senza controllo d'accesso per persona su hosting statico". Registra:
  - Le Pages private sono tutto o niente.
  - L'MVP è una vista.
  - La direzione futura di §8, e perché riusa `teams`.

## 6. Gestione degli errori e casi limite

- Un team non valido in un file di progetto fa fallire la validazione, con il file e la voce nel messaggio, come per gli altri errori del catalogo.
- Un team rinominato o cancellato in GitHub resta elencato nel catalogo. La discovery lo segnala come "non trovato in GitHub" nell'editor, e l'hub non modifica il catalogo.
- Più team di `maxTeams`: la discovery si ferma al limite e lo dice nel risultato dei team mostrato nell'editor del catalogo. Le proposte sono allora parziali, mai sbagliate.
- Una collisione di slug tra organizzazioni causa un errore di build (§5.1).

## 7. Test

- **Modello:** schema di `teams`, formati di slug e organizzazione, duplicati, collisione di slug tra organizzazioni.
- **Parser della nomenclatura:** pattern validi, segnaposto sbagliati, ricerca di linea e ruolo, progetti con trattini nel nome, e nomi che non corrispondono.
- **Discovery** (risposte GitHub simulate, `example-org` fittizio):
  - Proposte per accesso (solo scrittura o superiore; i team in sola lettura non vengono proposti) e per nome.
  - Funziona con `discovery.enabled: false`, leggendo le organizzazioni dei repository del catalogo.
  - I team segreti vengono saltati e solo contati.
  - Il pubblico aperto forza la funzione a spento.
  - Un 403 porta a `not-authorised` senza far fallire l'esecuzione.
  - Il limite `maxTeams`.
  - Sopravvivono solo i campi tenuti (un test che la descrizione di un team non arrivi mai nell'output).
- **Logica del filtro:** una funzione pura `teamMatch(selected, projectTeams)` e la riga dei risultati con team che non sono nel catalogo e con progetti senza team. Test unitari, come per `severityMatch`.
- **e2e:**
  - `/?team=a&team=b` mostra l'unione.
  - Un team che non è nel catalogo mostra la sua Label.
  - "Cancella filtri" toglie anche i team.
  - La pagina del progetto elenca i suoi team.
  - Uso del menu da tastiera.
  - Nessuno scorrimento orizzontale a 390px.
  - Ogni verifica sia in EN sia in IT.
- **Editor del catalogo:** aggiungere e togliere un team, accettare un suggerimento, e il contenuto della pull request.
- **Export:** la colonna `teams`.
- **Contratti:** il test di parità delle chiavi i18n e la scansione dei segreti nell'output restano verdi.

## 8. Più avanti: accesso per persona (non nell'MVP)

Registrato perché l'MVP non lo blocchi. Un piccolo componente server davanti al sito statico (per esempio Cloudflare Pages Functions, o quello che l'azienda permetterà) con "Accedi con GitHub" tramite la GitHub App dell'hub.

- Con il token dell'utente, GitHub restituisce i repository che vedono sia l'App sia quella persona. Una persona vede un progetto quando contiene almeno uno di quei repository, oppure quando uno dei suoi team è nei `teams` del progetto, oppure quando un file di accesso manuale la elenca.
- Le pagine che coprono più progetti vengono ricalcolate sui soli progetti visibili.
- I file di dati vengono serviti solo dopo il controllo d'accesso.
- Serve un ADR che modifichi l'ADR 0001 (prima lo statico). Nulla di questo è progettato qui.

## 9. Lasciato al costruttore e al piano

- **Ordine rispetto al lavoro supply chain** (`feat/supply-chain-providers`, previsto come v0.11.0 con gli ADR 0010–0011 e lo schema snapshot 1.7):
  - Il ramo che si unisce per secondo prende il prossimo numero di ADR e la prossima versione minore dello schema, e si ribasa.
  - Il piano dichiara l'ordine assunto; _la mia scelta_ è che la supply chain entri per prima, quindi questo sarebbe l'ADR 0012, lo schema 1.8 e la v0.12.0.
- Mockup in Claude Design prima del codice dell'interfaccia:
  - La riga dei filtri della home con il controllo Team aperto e chiuso.
  - Le Label dei team selezionati.
  - Le Label dei team nelle righe.
  - I metadati nell'intestazione del progetto.
  - Il campo Team dell'editor del catalogo.
  - Tema chiaro e scuro, desktop e 390px.
- Il testo esatto delle nuove stringhe (EN + IT), nel tono esistente.
- La forma esatta del risultato `teams` in `catalog.json`, purché l'editor mostri la prova di ogni suggerimento.
