# Versioni dei componenti per ambiente dai deployment di ciascun componente — design

English: [../../../superpowers/specs/2026-11-20-component-deployments-design.md](../../../superpowers/specs/2026-11-20-component-deployments-design.md)

Stato: bozza per la revisione dell'owner · Data: 2026-11-20 · Release prevista: **v0.20.0** · Schema snapshot **1.12**

## 1. Intento e motivo

Dalla v0.19.0 la pagina Versioni mostra, per ogni componente dell'umbrella chart, la versione che gira
in ciascun ambiente. I componenti deployati **per conto proprio** (un database pubblicato dalla sua
pipeline, un servizio con un deploy suo) compaiono solo in "Fuori dall'umbrella" con l'ultima release:
l'hub non sa dire quale versione gira dove.

L'owner vuole tracciare per ambiente anche quei componenti. La fonte è il registro dei deployment
(v0.17.0, GitHub Deployments scritti dalla pipeline esterna). Mancano due cose:

1. Lo script di push accetta solo lo SHA di un commit. Una pipeline che deploya **una versione
   rilasciata scelta a mano** (parametro `version: 0.9.0`, nessun checkout) non ha lo SHA di quella
   release: il commit della run è la testa del branch di default, quello sbagliato.
2. L'hub legge i GitHub Deployments solo per gli ambienti del progetto, da un solo repository. Non
   legge mai i deployment del repository di un componente.

## 2. Obiettivi, non-obiettivi, anti-obiettivi

Obiettivi:

1. `scripts/report-deployment.sh` registra un deploy **per tag** (`REF=v0.9.0`) oltre che per SHA.
2. Un componente con `deployments: true` nel catalogo ottiene una riga nella tabella componenti ×
   ambienti, con la versione che i GitHub Deployments del suo repository indicano per ogni ambiente.
3. Funziona con o senza umbrella chart.

Non-obiettivi (questa iterazione):

- Modifiche a pipeline reali, alla App che scrive, o alla rete del cliente. Si fanno dopo, nei
  repository del progetto.
- Leggere i deployment propri di un componente che **è** nell'umbrella chart: la sua fonte resta il
  chart.
- Un nome d'ambiente diverso per componente.
- Nuove regole di salute delle versioni: la tabella è solo informazione.
- Il bridge pull da Azure DevOps: invariato.

Anti-obiettivi (un fallimento anche se funziona):

- Mostrare "non deployato" quando l'hub non è riuscito a leggere. Illeggibile è **sconosciuto**.
- Confondere dichiarato e deployato: una cella letta dai deployment è sempre marcata come deployata,
  anche sotto una colonna con intestazione "dichiarata".
- Qualsiasi cambiamento per un progetto che non imposta `deployments: true`.

## 3. Vincoli

- Solo GET in lettura, solo chiamate del provider già esistenti (`listDeployments`,
  `listDeploymentStatuses`). La App dell'hub ha già Deployments: read.
- Costo limitato: al massimo **20** componenti con `deployments: true` per progetto (oltre: errore di
  validazione). Per componente e ambiente: una chiamata di lista e al massimo 10 letture di stato,
  come oggi.
- La App che scrive mantiene il suo unico permesso, Deployments: read and write.
- Repository pubblico: fixture sintetiche (`example-org`), nessun nome reale.
- EN + IT per ogni stringa di UI e ogni documento.

## 4. Approcci

| Approccio                                             | Come                                                                                      | Esito                                                                                                                                 |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Tag nello script di push + flag sul componente** | La pipeline riporta `REF=v<versione>`; GitHub risolve il tag. L'hub legge per componente. | **Scelto** (owner, 2026-11-20). Modifica minima, nessun permesso nuovo.                                                               |
| B. Bridge pull                                        | Il bridge schedulato legge Azure DevOps e scrive i deployment.                            | Scartato: il bridge legge i record d'ambiente, che non portano una versione digitata come parametro della run (non verificato oltre). |
| C. Risolvere il tag sull'agent                        | La pipeline fa il checkout del mirror e trova da sé lo SHA del tag.                       | Scartato: richiede un checkout e i tag nel mirror, in ogni pipeline.                                                                  |

## 5. Design

### 5.1 Script di push: `REF`

`scripts/report-deployment.sh` accetta **esattamente uno** tra:

- `SHA` — lo SHA completo di un commit (comportamento di oggi, invariato);
- `REF` — il nome di un tag o di un branch che esiste su GitHub, per esempio `v0.9.0`.

Entrambi impostati, o nessuno: lo script si ferma con un errore prima di qualsiasi chiamata.
`REF` deve rispettare `^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$` e non deve contenere `..`.

Con `REF`:

- il deployment viene creato con `ref: <REF>`; GitHub lo risolve in un commit;
- la ricerca "già registrato?" filtra per `ref=<REF>` invece che per `sha=<SHA>` (stesso ambiente,
  fonte, id della run e tentativo di oggi);
- un nome che GitHub non conosce restituisce HTTP 422: lo script stampa il messaggio di GitHub ed
  esce con 0, come fa oggi per un commit sconosciuto.

Esempio, ultimo step di un job che deploya per versione:

```yaml
env:
  REF: v$(deployedVersion) # al posto di SHA
  VERSION: $(deployedVersion)
  ENV_NAME: test
  # GH_APP_ID, GH_INSTALLATION_ID, GH_KEY_FILE, GH_OWNER, GH_REPO_NAME, STATE, RUN_ID, RUN_URL,
  # ATTEMPT, FINISHED_AT: come oggi
```

Lato hub non serve nulla di nuovo per leggere un record così: prende già la versione dal payload,
altrimenti da un tag che somiglia a una versione.

### 5.2 Catalogo: `deployments: true` su un componente

```yaml
components:
  - id: database
    name: Database
    repository: example-org/alpha-database
    type: other
    deployments: true # nuovo, opzionale, default false
```

Significato: "questo componente è deployato per conto proprio; leggi i GitHub Deployments del suo
repository".

- Per ogni ambiente del progetto, l'hub legge i deployment del repository **del componente** il cui
  nome d'ambiente è il `githubEnvironment` dell'ambiente, altrimenti il suo `id`. Le opzioni
  `environment` e `sources` del `deploySignal` del progetto **non** si usano: appartengono al
  repository letto da quel segnale. _(Scelta da builder-check.)_
- La versione di un deployment: il campo `version` del payload del registro, altrimenti il tag da cui
  è stato fatto (`releaseTagPrefix` del componente, default `v`). Un deployment da branch non ha
  versione.
- Cosa conta come attuale: il deployment più recente con stato `success`, per data reale del deploy
  (stessa funzione usata oggi per gli ambienti del progetto).
- Il flag è ignorato (non si legge nulla) solo quando l'umbrella chart sul branch di default è stato
  letto e contiene il componente. Quando quel chart non si riesce a leggere, il componente viene
  letto e mostrato solo nel gruppo "Deployati per conto proprio", mai in entrambi i gruppi.
  _(Scelta da builder-check.)_
- Errori di validazione: più di 20 componenti con il flag in un progetto; un componente con il flag
  che condivide il repository con un altro componente o con il coordinator (i GitHub Deployments
  appartengono a un repository, quindi l'hub non saprebbe dire di chi è il deploy).
  _(Scelta da builder-check.)_

### 5.3 Snapshot 1.12

Ogni componente guadagna `environmentVersions`: `null` quando il flag è spento o ignorato; altrimenti
una voce per ogni ambiente del progetto, in ordine, con:

| Campo           | Significato                                                                                                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `environmentId` | l'ambiente del progetto                                                                                                                                                                                                                     |
| `state`         | `ok` (trovato un deployment riuscito); `none` (l'ambiente non ha alcun deployment); `no-success` (ci sono deployment, nessuno dei 10 più recenti è riuscito); oppure perché la lettura è fallita (`not-found`, `not-authorised`, `unknown`) |
| `version`       | semver, oppure null                                                                                                                                                                                                                         |
| `ref`, `sha`    | branch o tag e commit di quel deployment, oppure null                                                                                                                                                                                       |
| `deployedAt`    | data reale del deploy, oppure null                                                                                                                                                                                                          |
| `declared`      | true quando il record è stato dichiarato a mano (payload del registro `declared: true`)                                                                                                                                                     |

Una lettura fallita viene anche registrata come errore di raccolta `deploy-signal`, come oggi.
`no-success` non è `none`: l'hub non afferma "niente di registrato" quando ha guardato solo i 10 più
recenti. _(Scelta da builder-check.)_

### 5.4 Pagina Versioni

I componenti con il flag diventano righe della tabella esistente, in un secondo gruppo sotto le righe
dell'umbrella:

```
Componente     Ultima release  Umbrella (main)  LAB             DEV         TEST        PROD
                                                main @ 1a2b3c4  dichiarata  dichiarata  dichiarata
frontend       v2.2.0 ▲        2.1.0            —               2.1.0       2.1.0       2.0.3 ▲
backend        v1.4.0          1.4.0            —               1.4.0       1.4.0       1.4.0
Deployati per conto proprio
database       v0.9.0          —                main @ 9f8e7d6  0.9.0 ●     0.9.0 ●     0.8.0 ● ▲
Fuori dall'umbrella (1) ▸   shared-lib v3.1.0
```

- `●` = "deployato": letto dai GitHub Deployments. Icona più testo (title e riga di legenda), mai solo
  colore. La data del deploy è nel title della cella.
- Un record dichiarato a mano ha un segno diverso e il testo "dichiarato a mano", mai `●`.
  _(Scelta da builder-check.)_
- Stati della cella: una versione (`0.9.0 ●`); un deployment da branch (`main @ 9f8e7d6`); **nessun
  deployment registrato** (`—`; il title nomina l'ambiente letto, per esempio "nessun deployment
  registrato per l'ambiente test"); **sconosciuto** (l'etichetta tratteggiata esistente con il
  motivo: lettura fallita, oppure nessun deployment riuscito tra i 10 più recenti).
- `▲` su una cella: versione più bassa della versione più vicina alla sua sinistra. Il primo confronto
  è con l'ultima release (quindi `v0.9.0` rilasciata e `0.8.0` nel primo ambiente mostra ▲ lì).
- "Umbrella (main)" è `—` per queste righe.
- I componenti senza flag restano nella lista richiudibile "Fuori dall'umbrella", come oggi.
- **Progetto senza umbrella chart** e con almeno un componente con il flag: la stessa tabella, senza
  la colonna "Umbrella (main)" e senza l'intestazione di gruppo. Compare esattamente dove oggi compare
  la tabella dell'umbrella (chiusa nelle card allineate e sconosciute, aperta nelle card da
  verificare, al posto del percorso degli ambienti). Una sola regola nella pagina: "umbrella chart,
  oppure almeno un componente con il flag". _(Scelta da builder-check.)_
- Export CSV: una riga `component-environment` per ogni componente con il flag e ambiente con stato
  `ok`, con `version_source` = `deployment` (`declared` per un record dichiarato a mano). Nessuna
  colonna nuova. _(Scelta da builder-check.)_

### 5.5 Documentazione e demo

- `docs/deployments-ledger.md` e `docs/configuration.md` (EN + IT): `REF`, l'esempio sopra, il flag
  `deployments`.
- I dati della demo pubblica ricevono un componente con il flag e qualche deployment, così la pagina
  mostra le nuove righe.
- CHANGELOG, JSON Schema, editor del catalogo (mantiene il flag quando salva).

## 6. Deciso dall'owner

- Perimetro adesso: solo il lato hub, costruito su dati mock; le pipeline reali dopo che esiste la App
  che scrive e che il cliente permette agli agent di raggiungere `api.github.com` (2026-11-20).
- Approccio A (2026-11-20).
- Decisioni precedenti ancora valide: i GitHub Deployments sono il registro di ogni ambiente; l'hub
  verifica le versioni e non le sceglie mai; una versione dichiarata non è mai mostrata come deployata.

## 7. Lasciato al builder

- Nomi esatti dei campi e forme Zod di `environmentVersions`; riuso di `readEnvironmentState`.
- Testo delle etichette ("Deployati per conto proprio", "nessun deployment registrato") in EN e IT, e
  l'icona.
- Quanti errori di raccolta produce un componente con più ambienti illeggibili (uno per lettura o uno
  per componente).
- Test: script (`REF`, entrambi, nessuno, nome non valido, 422, seconda esecuzione idempotente),
  collector, logica della tabella, CSV, un e2e sulla pagina Versioni; golden solo con
  `npm run fixtures:update` (mai `ci:build` o `collect:mock` sulla macchina dell'owner senza chiedere).
