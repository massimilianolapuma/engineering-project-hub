# Versioni dei componenti per ambiente da un chart Helm umbrella — design

English: [../../../superpowers/specs/2026-11-18-umbrella-chart-versions-design.md](../../../superpowers/specs/2026-11-18-umbrella-chart-versions-design.md)

Stato: bozza per la revisione del responsabile · Data: 2026-11-18 · Release prevista: **v0.19.0** · Schema snapshot **1.11**

## 1. Intento e motivazione

Il responsabile vuole che la pagina Versioni risponda, **per progetto**: _quali versioni dei componenti
sono state rilasciate, e dove sono arrivate?_ Oggi l'hub mostra una versione "corrente" per componente
(il pin del submodule, altrimenti il release manifest) e una versione per ambiente (da v0.18.0, dai
segnali di deploy). Non sa dire quale versione di ogni componente gira in ogni ambiente.

Molti progetti deployano tramite un **chart Helm umbrella** nel coordinator: le `dependencies` del suo
`Chart.yaml` elencano un sub-chart per componente con una versione esatta, la `version` del chart è la
release del prodotto (`v0.11.8` → `version: 0.11.8`) e ogni ambiente esegue una versione dell'umbrella.
Quindi il chart umbrella **al tag della versione di un ambiente** dice esattamente quali versioni dei
componenti girano in quell'ambiente. Il progetto reale da cui nasce la richiesta (19 repository) ha questa
forma:

- chart in `infrastructure/helm/<nome>/Chart.yaml`, dipendenze chiamate come le repository dei componenti
  (`<org>/<prodotto>-billing-fe` → dipendenza `<prodotto>-billing-fe`);
- versioni degli ambienti dichiarate da un workflow di promozione in `environments/<env>.yaml` (segnale
  `versions-file`), per esempio TEST 0.11.8, PROD 0.11.3;
- un componente elencato due volte con un `alias` (stesso chart, tenuto allineato);
- componenti fuori dall'umbrella (database deployati da una pipeline manuale separata, librerie
  condivise, infrastruttura);
- un ambiente LAB che esegue `main` con tag di immagini di sviluppo, non una release.

Il responsabile ha scelto di leggere il chart umbrella nell'hub (approccio A sotto): nessuna modifica
alle repository o alle pipeline del progetto.

## 2. Obiettivi, non obiettivi, anti-obiettivi

Obiettivi:

1. Per un progetto il cui coordinator dichiara un chart umbrella, mostrare nella pagina Versioni una
   matrice **componenti × ambienti**: ultima release di ogni componente, la sua versione nell'umbrella sul
   branch di default e la sua versione in ogni ambiente.
2. Segnalare dove una versione è **ferma**: rilasciata ma non ancora nell'umbrella; presente in un
   ambiente precedente ma non ancora nel successivo.
3. Usare l'umbrella come fonte della versione corrente del componente (ciò che contiene l'ultima release
   del prodotto), così il controllo esistente "corrente contro ultima release" confronta le cose giuste.
4. Generico per qualunque chart Helm umbrella; nessuna configurazione per i componenti la cui dipendenza
   si chiama come la loro repository.

Non obiettivi (in questa iterazione):

- Valutare i values per ambiente (`condition: <dep>.enabled`): un componente disattivato in un ambiente
  mostra comunque lì la versione del chart. Documentato come limite.
- Versioni dei componenti negli ambienti da branch (LAB su `main` con tag di sviluppo): la colonna mostra
  `main @ <sha>`, non le versioni per componente.
- Una vista su tutto il portfolio.
- Nuove regole di salute delle Versioni o nuovi ambra. La matrice è informazione; l'unico effetto sulla
  salute è quello che deriva dall'obiettivo 3 (il drift ora confronta la versione dell'umbrella con
  l'ultima release).
- Verifica delle immagini (Harbor, immagini Argo CD): invariata.

Anti-obiettivi (un fallimento anche se funziona):

- Mostrare una versione d'ambiente **dichiarata** come se fosse **deployata**: ogni colonna d'ambiente
  mantiene l'etichetta della sua fonte (file versioni = dichiarata, deployment GitHub / Argo CD =
  deployata).
- Inventare una versione: un chart illeggibile, un tag mancante o una dipendenza non abbinata si mostrano
  come sconosciuti, mai come "non deployato" e mai dedotti da un'altra colonna.
- Rumore per i progetti senza chart umbrella: non cambia nulla se `umbrellaChart` non è configurato.

## 3. Vincoli

- Solo GET in lettura, solo API contents di GitHub (`getFile(repo, path, ref)` esiste già). La repository
  OCI dei chart (Harbor) non viene mai contattata.
- Costo limitato: una lettura sul branch di default più una per ogni versione d'ambiente **distinta**, al
  massimo **10** letture di tag per progetto (prima le versioni più recenti; le altre sconosciute con una
  nota).
- Dimensione del file ≤ il limite YAML esistente di 64 KiB; parsing con le impostazioni YAML sicure
  esistenti.
- Repository pubblica: fixture sintetiche (`example-org`), nessun nome reale in codice, documenti o
  golden.
- EN + IT per ogni testo dell'interfaccia e documento.

## 4. Approcci

| Approccio                                     | Cos'è                                                                                                                                                                  | Compromesso                                                                                                                                                                           |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. L'hub legge il chart umbrella (scelto)** | Il catalogo dice dov'è il chart; il collector legge `Chart.yaml` sul branch di default e al tag della versione di ogni ambiente, e abbina le dipendenze ai componenti. | Nessuna modifica alle repository del progetto, generico per gli umbrella Helm, riusa le versioni d'ambiente di v0.18.0. Solo Helm: altri pacchetti richiederanno un altro adattatore. |
| B. Il chart al tag di release come manifest   | Usare le versioni del chart come versioni "dichiarate" dei componenti (una colonna).                                                                                   | Poco lavoro, ma non dice **dove** sono le versioni, quindi non risponde alla domanda.                                                                                                 |
| C. Il coordinator pubblica un riepilogo       | Un workflow scrive come artifact CI un JSON con le versioni dei componenti per ambiente.                                                                               | L'hub resta indipendente da Helm, ma servono modifiche alle pipeline del team di progetto e bisogna aspettarle.                                                                       |

Il responsabile ha scelto A ("A va bene, poi vediamo"): B non risponde alla domanda, C sposta il lavoro sul
team e aggiunge una dipendenza.

## 5. Design

### 5.1 Catalogo

Coordinator, facoltativo:

```yaml
coordinator:
  repository: example-org/alpha-coordinator
  umbrellaChart:
    path: deploy/helm/alpha/Chart.yaml # percorso relativo, obbligatorio
    tagPrefix: v # facoltativo, default "v": versione d'ambiente 1.4.0 → tag v1.4.0
```

Componente, facoltativo: `chartDependency: <nome o alias della dipendenza>` per forzare l'abbinamento.

Abbinamento di un componente a una dipendenza, vince la prima corrispondenza:

1. `chartDependency` (corrisponde all'`alias` di una dipendenza, altrimenti al suo `name`);
2. una dipendenza il cui `name` è il nome della repository del componente senza l'owner
   (`example-org/alpha-backend` → `alpha-backend`), prima le voci **senza** alias;
3. una dipendenza il cui `name` è l'id del componente.

Più voci con lo stesso nome (alias) e la stessa versione contano una volta; versioni diverse → la cella
del componente è un **conflitto** (versione sconosciuta, nota con gli alias), mai la versione di una voce
scelta al posto dell'altra. Quando `chartDependency` indica un alias, solo quella voce si abbina al
componente e le altre voci dello stesso chart sono elencate come alias, non come non abbinate.
_(Scelta dopo la verifica del builder.)_ Le dipendenze che non corrispondono a nessun componente sono
elencate come **non abbinate** (come oggi i submodule non mappati). I componenti senza dipendenza sono
**fuori dall'umbrella**.

`versionSource` aggiunge `umbrella`. `auto` diventa: umbrella (solo se `umbrellaChart` è configurato e il
componente ne fa parte) → pin del submodule → manifest. I progetti senza `umbrellaChart` mantengono
l'ordine di oggi. Se la lettura al tag di release fallisce o non contiene il componente, `auto` passa al
pin e poi al manifest (come fa oggi `pick()`); `versionSource: umbrella` resta sconosciuta. _(Scelta dopo
la verifica del builder.)_

### 5.2 Raccolta

Dopo la risoluzione degli ambienti (`collectEnvironmentStates` di v0.18.0 + manifest/Argo CD):

1. Leggere il chart sul branch di default del coordinator.
2. Leggere il chart al **tag dell'ultima release** del coordinator (altrimenti al suo ultimo tag
   raggiungibile), mai alla versione dichiarata dal manifest, che potrebbe non essere ancora taggata — è
   la fonte della `versionSource` umbrella. _(Scelta dopo la verifica del builder.)_
3. Per ogni ambiente con una versione semver (dichiarata o deployata, come pubblicata sull'ambiente),
   leggere il chart a `tagPrefix + versione`. Solo versioni distinte, prima le più recenti, massimo 10.
4. Gli ambienti senza versione semver (sconosciuta, o un deploy da branch come LAB) non generano letture.

Parsing: `version` (chart), `dependencies[].{name, alias?, version}`; le versioni non semver delle
dipendenze (range come `~1.2`) sono tenute come testo e non confrontate. Un chart senza `dependencies` è
valido (vuoto).

Errori: file o tag mancante (404) → stato `not-found`; errori di YAML o di forma → `invalid`; 403 →
`not-authorised`. Registrati una volta per repository e classificazione con una nuova fonte di errore di
raccolta `umbrella-chart`.

### 5.3 Snapshot 1.11

- `coordinator.umbrellaChart`: `null` se non configurato, altrimenti
  `{ path, state: 'ok'|'not-found'|'invalid'|'not-authorised'|'unknown', chartVersion, unmapped: string[] }`
  per la lettura sul **branch di default**.
- `component.umbrella`: `null` se non configurato, altrimenti
  `{ inUmbrella: boolean, main: string|null, release: string|null, conflict: boolean }` — versione sul
  branch di default e al tag dell'ultima release.
- `component.effectiveVersionSource` aggiunge `umbrella`.
- `environment.componentVersions`: `null` se non configurato o se non c'è stata lettura (nessuna versione
  semver), altrimenti `{ ref: 'v1.4.0', state: <come sopra> | 'skipped', versions: [{ componentId,
version|null, conflict: boolean }] }` (solo i componenti presenti nell'umbrella a quel ref). `skipped` =
  oltre il limite di 10 letture. _(Scelta dopo la verifica del builder: la forma può portare ciò che serve
  all'interfaccia per spiegare una cella sconosciuta.)_

### 5.4 Pagina Versioni

In ogni card di progetto, quando `umbrellaChart` è configurato, una tabella **Componenti per ambiente**
(IT) / **Components by environment** (EN). Dove compare (decisione del responsabile):

- Card **da verificare**: la tabella è aperta e **sostituisce** il percorso degli ambienti
  (LAB → … → PROD); l'intestazione di ogni ambiente porta la sua versione e la pill di stato (Indietro,
  Allineato, Non è una release), così non si perde nulla del percorso. Segue la lista "Da verificare".
- Card **allineate** e **sconosciute** (grigie): il design a una riga / tratteggiato resta; la tabella sta
  in un riquadro chiuso "Componenti per ambiente ▸".
- Progetti senza `umbrellaChart`: invariati.

La tabella:

```
Componente     Ultima release  Umbrella (main)  LAB             DEV        TEST       PROD
                                                main @ 1a2b3c4  dichiarata dichiarata dichiarata
frontend       v2.2.0 ▲        2.1.0            —               2.1.0      2.1.0      2.0.3 ▲
backend        v1.4.0          1.4.0            —               1.4.0      1.4.0      1.4.0
Fuori dall'umbrella (2) ▸   database v0.9.0 · …
```

- Sotto l'intestazione di ogni ambiente: la fonte della sua versione (dichiarata / deployata) oppure
  `main @ sha`.
- ▲ segna "versione più nuova in attesa a sinistra": ultima release sopra l'umbrella su main; un ambiente
  sotto l'ambiente precedente. Testo più icona (mai solo colore); una riga di legenda lo spiega.
- Le celle sconosciute usano l'etichetta tratteggiata "sconosciuto" esistente, con il motivo nel titolo
  (non trovato, conflitto, troppe versioni).
- Le dipendenze non abbinate sono elencate sotto la tabella.
- Mobile: la tabella scorre dentro il suo contenitore; la pagina non scorre mai in orizzontale.
- Export CSV `versions.csv`: una riga per componente × ambiente con la versione e il ref del chart.

La pagina di progetto non cambia, salvo un link alla card Versioni.

### 5.5 Demo

Sintetica: il coordinator di Project Alpha riceve un chart umbrella (backend, frontend, worker), i tag delle
versioni dei suoi ambienti, un componente rilasciato ma non ancora nell'umbrella, PROD una versione
indietro e una dipendenza non abbinata. Golden rigenerati.

## 6. Deciso dal responsabile

- Approccio A; per progetto, non su tutto il portfolio.
- La tabella compare in ogni progetto con umbrella: aperta nelle card da verificare (al posto del percorso
  degli ambienti), chiusa in un riquadro nelle card allineate e sconosciute.
- L'umbrella è la versione del componente che conta ("umbrella credo, in caso da verificare"): verificato
  sul chart reale il 2026-11-18 (nomi delle dipendenze = nomi delle repository, versioni semver, versione
  del chart = release del prodotto).
- LAB mostra `main @ sha`.

## 7. Lasciato al builder

- La struttura esatta dei file (la forma attesa è un lettore `collector/src/collectors/umbrella-chart.ts`
  e un normalizzatore), l'helper di parsing, la suddivisione dei componenti dell'interfaccia.
- Ordine e spareggi dentro il limite di 10 letture.
- La formulazione precisa di note e legende (EN/IT) nel significato descritto sopra.
