# ADR 0010: Viste per team senza controllo degli accessi per persona su hosting statico

- **Stato:** Accettata
- **Data:** 2026-11-03
- **Versione inglese:** [docs/architecture/adr/0010-per-team-views-without-access-control.md](../../../architecture/adr/0010-per-team-views-without-access-control.md)

## Contesto

I responsabili hanno chiesto la "propria dashboard": i progetti su cui lavorano, senza il resto del
portfolio in mezzo. In GitHub un responsabile appartiene a più team, di solito uno per progetto, con
nomi del tipo `<linea>-<progetto>-<ruolo>`, più alcuni team trasversali che coprono molti repository.

L'hub è un sito statico ([ADR 0001](0001-static-first-github-native.md)). Per ora l'azienda lo
pubblica solo su GitHub Pages. Le Pages private controllano l'accesso all'**intero sito**: chi può
aprirlo vede ogni pagina e ogni file di dati. Nascondere un progetto a una persona richiede un
componente che sappia chi sta guardando e serva i dati dopo un controllo degli accessi; l'hosting
statico non ce l'ha.

## Decisione

1. **Una vista, non un controllo degli accessi.** I progetti elencano i loro team GitHub nel
   catalogo (`teams: ["<org>/<team-slug>"]`). Il Portfolio filtra per team nel browser e il link
   conserva un parametro `team` per ogni team selezionato, così un responsabile salva nei preferiti
   la propria vista. Chiunque può aprire il sito continua a vedere tutti i progetti; la
   documentazione lo dice dove descrive la funzione.
2. **I team vengono da GitHub, decide il catalogo.** Con il permesso di organizzazione **Members:
   read**, il collector legge i team delle organizzazioni e i repository a cui ogni team accede, e
   si limita a **proporre** team nell'editor del catalogo: per accesso in scrittura (write,
   maintain o admin) ai repository del progetto, oppure per un nome che segue la regola configurata.
   Nulla cambia il catalogo senza una pull request.
3. **Dati minimi.** Si usano solo slug dei team, conteggi dei repository e livelli di accesso. Nomi,
   descrizioni e membri dei team non vengono mai salvati; i team segreti vengono ignorati e solo
   contati. La discovery dei team è disattivata quando `publication.audience` è `public`.
4. **Slug nei link.** `?team=` porta solo lo slug, quindi il catalogo rifiuta uno stesso slug in due
   organizzazioni.

## Alternative considerate

- **Accesso per persona subito** (un componente server con "Accedi con GitHub"). Scartato per l'MVP:
  oggi l'azienda permette solo GitHub Pages, e cambia l'architettura static-first.
- **Un campo con le persone per progetto.** Scartato: i team esistono già in GitHub, le persone
  cambiano team più spesso di quanto i progetti cambino team, e un elenco di persone è un dato
  personale che all'hub non serve.
- **Leggere l'appartenenza ai team per mostrare "i miei team" in automatico.** Scartato: serve
  l'identità di chi guarda (non disponibile su Pages statiche) ed elenchi di membri che l'hub non
  deve pubblicare.

## Conseguenze

- La vista di un responsabile è un preferito; condividere il link condivide la vista, non l'accesso.
- Il nuovo permesso GitHub (Members: read) è opzionale: senza, il filtro funziona comunque dal
  catalogo e la discovery segnala `not-authorised`.
- Lo schema dello snapshot `1.7` porta `teams`.

## In seguito: accesso per persona

Registrato perché l'MVP non lo blocchi. Un piccolo componente server davanti ai file statici (per
esempio Cloudflare Pages Functions, o ciò che l'azienda consente) con "Accedi con GitHub" tramite la
GitHub App dell'hub. Con il token dell'utente, GitHub restituisce i repository che vedono sia l'App
sia quella persona; una persona vede un progetto quando contiene almeno uno di quei repository,
quando uno dei suoi team è nei `teams` del progetto, oppure quando un file di accessi manuale la
elenca. Le pagine trasversali vengono ricalcolate sui progetti visibili e i file di dati vengono
serviti solo dopo il controllo degli accessi. Il campo `teams` costruito qui si riusa così com'è.
Serve un ADR che modifichi l'ADR 0001; niente di tutto questo è progettato qui.
