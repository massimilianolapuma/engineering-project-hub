# ADR 0014: Mappa dei controlli tecnici con i riferimenti DORA e ISO 27001 collegati, mai un'affermazione di adeguatezza

- **Stato:** Accettata
- **Data:** 2026-11-04
- **Versione inglese:** [docs/architecture/adr/0014-control-map.md](../../../architecture/adr/0014-control-map.md)

## Contesto

Ai team che rilasciano per clienti regolamentati viene chiesto di mostrare quali controlli tecnici
sono attivi per DORA (Regolamento (UE) 2022/2554 e RTS 2024/1774) e ISO/IEC 27001:2022. L'hub
raccoglie già gran parte delle evidenze (SBOM, firme, analisi, regole dei branch, alert, versioni)
ma le mostra pagina per pagina. Un assessment DevSecOps ha valutato le stesse pratiche su una scala
0–5 con obiettivi. Il rischio: un unico punteggio accanto al nome di due normative si legge come
«conformità», e l'hub non vede affatto governance, contratti o misure organizzative.

## Decisione

1. **Solo controlli tecnici, riferimenti come dati.** 25 controlli (spec 2026-11-04 §5.2), ognuno
   con gli articoli DORA e i controlli dell'Allegato A ISO per cui fornisce evidenze tecniche.
   Nessun testo visibile, intestazione CSV o descrizione di metrica afferma l'adeguatezza; un test
   lo verifica. La governance è esclusa.
2. **Livelli 0–5 da soglie di policy.** Ogni controllo converte il valore misurato nella scala
   dell'assessment con scale predefinite nel codice, modificabili in `policies.yaml`
   (`controlMap.thresholds`).
3. **Sconosciuto non è 0.** Una fonte illeggibile è «non visibile» con un motivo; i controlli
   "% delle repository" usano solo le repository leggibili e non si calcolano se ne è stata letta
   meno della metà. Non applicabile solo quando non c'è niente da verificare, o il catalogo lo dice
   con un motivo. I controlli `required: false` contano comunque.
4. **Punteggio = media dei livelli misurati × 20**, con «misurati N su M», assente sotto la metà.
   Le righe delle business unit sono mediane.
5. **Segnale di deploy per ambiente.** Le metriche di rilascio usano un ambiente per progetto e un
   segnale dichiarato: esecuzioni di workflow, un file delle versioni modificato dalle pull request
   di promozione, storico Argo CD, release, oppure `external` (non visibile). Gli ambienti dei
   clienti raggiunti tramite mirror e altri sistemi di CI sono quindi dichiarati, non indovinati.
6. **Legata al pubblico.** La mappa (blocco dello snapshot, pagina, CSV, metriche) viene prodotta
   solo con `publication.audience: restricted` o con i dati dimostrativi.
7. **Solo lettura, limitata.** Solo nuove GET: ambienti, commit di un percorso, un file a un
   commit, date dei commit, release; push protection dai metadati della repository; OIDC dai file
   di workflow già letti (solo i nomi degli input). Schema degli snapshot 1.9.

## Conseguenze

- I responsabili hanno una pagina che indica le lacune per progetto e business unit, con il
  requisito a cui ciascuna è collegata, e un CSV per i propri report.
- Il punteggio può ancora essere sovrainterpretato; l'introduzione, l'impostazione dei riferimenti
  e questa ADR lo mitigano.
- I numeri dei riferimenti vanno tenuti allineati ai testi; stanno in una sola costante del modello.
- I permessi mancanti della GitHub App (ambienti, impostazioni di sicurezza) rendono i controlli non
  visibili invece di farli fallire.
- Le metriche di rilascio su DEV o sulle release sono approssimazioni; la cella indica ambiente e
  segnale.
