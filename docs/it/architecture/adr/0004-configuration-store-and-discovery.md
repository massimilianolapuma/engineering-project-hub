# ADR 0004: Archivio della configurazione, scoperta e percorso verso un backend

- **Stato:** Accettata
- **Data:** 2026-10-03
- **English version:** [docs/architecture/adr/0004-configuration-store-and-discovery.md](../../../architecture/adr/0004-configuration-store-and-discovery.md)

## Contesto

Scrivere il catalogo a mano non scala. Gli utenti vogliono:

- scoprire i repository in automatico, e vedere coordinator, monorepo e repository singoli
  come progetti candidati;
- configurare i progetti dall'interfaccia invece di modificare file YAML;
- ritrovare la configurazione salvata a ogni esecuzione;
- gestire i monorepo (componenti = cartelle di un unico repository) oltre ai progetti
  multi-repository.

Il portale è un sito statico su GitHub Pages, senza backend, database o credenziali nel
browser ([ADR 0001](0001-static-first-github-native.md)). Se questo approccio si rivelerà
utile, potrà seguire una vera applicazione con database e backend.

## Decisione

1. **Git è il database della configurazione.** Il catalogo è versionato nel repository:
   - `config/catalog.yaml` contiene le impostazioni di scoperta;
   - `config/projects/<id>.yaml` contiene un `ProjectConfig` per progetto;
   - il vecchio `config/projects.yaml` viene ancora letto.

   Ogni esecuzione ripristina la configurazione da questi file. Storico, revisione,
   rollback e audit li fornisce Git.

2. **La scoperta produce solo proposte, in sola lettura.** Il collector analizza gli owner
   configurati (solo repository pubblici finché il sito è pubblico) e classifica ogni
   repository:
   - **coordinator**: ha un `.gitmodules` con submodule che puntano a repository analizzati;
   - **monorepo**: ha un manifest di workspace (workspace npm/yarn/pnpm, lerna, `go.work`,
     Cargo, turbo/nx), e i suoi componenti sono cartelle;
   - **singolo**: tutti gli altri; i repository già usati come submodule non vengono
     proposti da soli.

   Le proposte vengono pubblicate in `catalog.json` e mostrate nell'editor del catalogo.
   Nulla entra nel portale finché non viene salvato un file di progetto.

3. **Il salvataggio è una pull request creata dall'utente su GitHub.** L'editor genera il
   file del progetto e apre GitHub. Per un progetto nuovo apre la pagina _nuovo file_ già
   compilata; per uno esistente copia il YAML e apre la pagina di _modifica_; per una
   rimozione apre la pagina di _eliminazione_. Valgono i permessi GitHub dell'utente. CI e
   ruleset del branch validano la modifica, e l'esecuzione successiva la usa.

   Niente bot e niente token nel browser. Si evitano anche le PR create con `GITHUB_TOKEN`,
   che non avviano la CI.

4. **Modello monorepo.** Un componente è un repository più un `path` opzionale.
   - Le versioni arrivano dai tag con prefisso (`api-v1.2.0`) tramite `releaseTagPrefix`.
   - I dati a livello di repository (alert, controlli, governance, errori) sono valutati
     **una sola volta per repository**.
   - Gli alert sono attribuiti ai componenti in base al percorso del file: la posizione del
     code scanning, oppure il manifest di Dependabot.
   - I progetti con un solo repository non hanno componenti.

## Punti di aggancio per un futuro backend

La decisione è pensata perché il passaggio a un'applicazione con database sia una
sostituzione, non una riscrittura:

| Aspetto             | Oggi (GitHub-native)                                           | Domani (backend + DB)                                        |
| ------------------- | -------------------------------------------------------------- | ------------------------------------------------------------ |
| Documento di config | `ProjectConfig` (Zod) in `config/projects/<id>.yaml`           | Stesso schema salvato come riga/documento                    |
| Caricamento         | `loadCatalog(configDir)`                                       | `loadCatalog()` basato sul DB (stesso tipo restituito)       |
| Salvataggio da UI   | "proponi modifica" = pagina GitHub nuovo/modifica/elimina → PR | "proponi modifica" = `PUT /api/projects/:id` (con revisione) |
| Scoperta            | `discover(ctx, catalog, policies)` nel collector               | Stesso modulo, pianificato o su richiesta                    |
| Autenticazione      | Permessi GitHub sul repository                                 | OAuth GitHub / SSO, autorizzazione per progetto              |

**Quando passare al backend.** Il passaggio va fatto quando diventa un requisito una di
queste cose:

- autorizzazione per utente o per progetto;
- inclusione di repository privati in una vista ad accesso controllato;
- salvataggi immediati senza pull request;
- più organizzazioni con pubblici diversi;
- storico e trend oltre quanto offrono gli snapshot.

## Conseguenze

- Positive:
  - niente infrastruttura, secret o bot;
  - ogni modifica è revisionata, validata dalla CI e versionata;
  - la configurazione sopravvive ai riavvii per costruzione;
  - monorepo e progetti multi-repository condividono un unico modello.
- Negative:
  - il salvataggio richiede il giro di una pull request (circa un minuto);
  - modificare un progetto esistente richiede ancora un incolla nell'editor di GitHub,
    perché GitHub precompila solo i file nuovi;
  - su un sito pubblico la scoperta non vede i repository privati.
