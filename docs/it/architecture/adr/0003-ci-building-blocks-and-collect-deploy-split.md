# ADR 0003: Mattoni CI riusabili e separazione collect/build/deploy

- **Stato:** Accepted
- **Data:** 2026-10-03
- **Versione inglese:** [docs/architecture/adr/0003-ci-building-blocks-and-collect-deploy-split.md](../../../architecture/adr/0003-ci-building-blocks-and-collect-deploy-split.md)

## Contesto

Engineering Project Hub è un portale statico GitHub-native. Un collector Node.js legge i
dati di più repository tramite la GitHub API e scrive snapshot JSON sanitizzati, che una
build Astro pubblica su GitHub Pages. La CI/CD deve:

- applicare un insieme completo di quality gate: lint del titolo della PR, lint, typecheck e
  format check, test unitari e di integrazione con coverage, test end-to-end, lint dei
  workflow, audit di sicurezza dei workflow e scansione del filesystem;
- aggiornare i dati a intervalli regolari e pubblicare su GitHub Pages;
- gestire in sicurezza le credenziali GitHub. Il collector ha bisogno di una GitHub App o di
  un token in sola lettura; build e deploy non ne hanno bisogno.

Il repository è pubblico e usa runner GitHub-hosted (piano Free).

## Decisione

1. **Mattoni riusabili.** Ogni gate è un piccolo reusable workflow
   (`.github/workflows/rw-*.yml`) o una composite action (`.github/actions/*`) con input
   documentati, chiamati da tre workflow di progetto (`ci.yml`, `collect-data.yml`,
   `deploy-pages.yml`). I mattoni seguono le convenzioni di una toolchain CI interna
   mantenuta dall'autore, così restano generici e riusabili da altri repository.
   L'inventario è in [docs/it/ci/workflows.md](../../ci/workflows.md).
2. **Collect, build e deploy sono job separati, concatenati tramite reusable workflow.**
   - `collect-data.yml` (`workflow_call`, `workflow_dispatch`, `repository_dispatch`) è
     l'**unico** job che riceve secret (`GH_APP_ID`, `GH_APP_PRIVATE_KEY`,
     `GH_APP_INSTALLATION_ID`, `GH_READ_TOKEN`, tutti opzionali). Li riceve via `env:` nel
     solo step `Collect`. Il `GITHUB_TOKEN` del job ha solo `contents: read`. Il job valida
     gli snapshot e li carica come artifact `snapshots`.
   - `deploy-pages.yml` chiama `collect-data.yml` passando i secret in modo esplicito. Il
     job `build` non riceve **alcun secret**: scarica `snapshots`, costruisce il sito con
     `SITE_URL`/`BASE_PATH` presi da `actions/configure-pages`, esegue `scan:output` e carica
     `site`. Il job `deploy` chiama `rw-pages-deploy-host.yml` con `artifact-name: site`.
     Solo questo job ha `pages: write` e `id-token: write`, e si autentica con OIDC, non con
     un secret.
   - Di conseguenza una dipendenza di build compromessa non vede mai le credenziali, e il
     job che vede le credenziali non può pubblicare.
3. **Privilegio minimo ovunque.** I permessi a livello workflow sono `contents: read`. Gli
   scope di scrittura sono concessi per singolo job, con un commento che li giustifica. Ogni
   action di terze parti è pinnata a uno SHA completo e `actions/checkout` non conserva mai
   le credenziali. Ogni input, output o campo dell'evento che arriva in `run:` passa da
   `env:`. Ogni job ha un timeout, e le run di CI e deploy usano gruppi `concurrency`.
4. **Code scanning sempre attivo.** Per i repository pubblici il Code Scanning è gratuito,
   quindi `zizmor` e `trivy-fs` caricano sempre il SARIF. Sono gli unici job con
   `security-events: write`.
5. **Dati mock di default.** La CI non usa mai secret e costruisce il sito da dati mock. Il
   deploy usa `vars.DATA_SOURCE`, che vale `mock` se non impostata.

## Conseguenze

**Positive**

- Ogni gate si può eseguire, revisionare e modificare da solo, e riusare in altri
  repository.
- I secret sono confinati in un solo step di un solo job. Build e deploy non possono farli
  trapelare.
- I deploy su Pages non si cancellano a vicenda (`concurrency: pages` e `pages-<repo>`,
  `cancel-in-progress: false`).
- Dependabot mantiene aggiornati gli SHA pinnati con PR settimanali raggruppate.

**Negative / rischi**

- Più file rispetto a un unico workflow monolitico. Mitigazione: commenti di intestazione
  in ogni file e inventario in `docs/it/ci/workflows.md`.
- `rw-zizmor.yml` richiede che `.github/zizmor.yml` esista.
- Il deploy richiede impostazioni di repository una tantum: sorgente Pages impostata su
  "GitHub Actions" e una regola di deployment branch sull'environment `github-pages`.
