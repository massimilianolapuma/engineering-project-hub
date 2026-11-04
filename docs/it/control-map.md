# Mappa dei controlli

> Versione inglese: [docs/control-map.md](../control-map.md)

La mappa dei controlli (pagina `controls/`, dalla v0.16.0) mostra per ogni progetto **25 controlli
tecnici** che l'hub può documentare con i dati che già raccoglie, sulla scala 0–5 di un assessment
DevSecOps. Ogni controllo indica i riferimenti DORA (Regolamento (UE) 2022/2554 e RTS 2024/1774) e
dell'Allegato A della ISO/IEC 27001:2022 per cui fornisce evidenze tecniche.

**Non è una valutazione di adeguatezza normativa.** L'hub non afferma mai che un requisito sia
soddisfatto: i riferimenti dicono a quali requisiti un controllo è _collegato_. I requisiti di
governance e organizzativi (politiche, ruoli, contratti, registri, formazione, audit) sono esclusi.
Progetto: [ADR 0014](architecture/adr/0014-control-map.md).

## Chi la vede

La mappa viene prodotta solo con `publication.audience: restricted`, o con i dati dimostrativi
(`dataSource: mock`). In un'installazione pubblica con dati reali il collector non scrive
`controlMap` e il sito non ha pagina, voce di navigazione, CSV né metriche. Si spegne con
`policies.controlMap.enabled: false`.

## Livelli

| Livello | Nome        | Significato                                                   |
| ------- | ----------- | ------------------------------------------------------------- |
| 0       | Assente     | Il controllo non è presente                                   |
| 1       | Iniziale    | Ad hoc, senza metriche, reattivo                              |
| 2       | Ripetibile  | Prime pipeline o template, controlli manuali, misure parziali |
| 3       | Definito    | Standardizzato, copertura parziale                            |
| 4       | Gestito     | Imposto e verificabile, misurato in continuo                  |
| 5       | Ottimizzato | Continuo, completo, self-service                              |

- **Non visibile** (tratteggiato): la fonte non è leggibile, o lo è meno della metà delle
  repository. Non vale mai 0 e non abbassa il punteggio. La cella dice il motivo.
- **Non applicabile** (vuoto): niente da verificare (nessuna immagine container, nessun workflow
  di deploy, nessun ambiente), o il catalogo esclude il controllo con un motivo
  (`controlMap.notApplicable`). Un controllo che il catalogo segna `required: false` **conta
  comunque**.
- I controlli "% delle repository" si calcolano sulle repository leggibili, indicate come
  "k su n lette".
- **Punteggio** = media dei livelli misurati × 20 (0–100), con «misurati N su M». Se è misurata
  meno della metà dei controlli applicabili il punteggio non viene mostrato.
- **Riga della business unit** = mediana dei livelli dei suoi progetti per ogni controllo
  (arrotondata per difetto); il punteggio è la mediana dei punteggi dei progetti.

## Controlli

Scale predefinite; ognuna si cambia in `policies.yaml` (`controlMap.thresholds.<controllo>`:
cinque valori per i livelli 1–5). Scale "%": 1 > 0%, 2 ≥ 25%, 3 ≥ 50%, 4 ≥ l'obiettivo, 5 = 100%.
I riferimenti di ogni controllo sono nella tabella della
[versione inglese](../control-map.md#checks) e nella sezione «Controlli e riferimenti collegati»
della pagina.

| Controllo                | Misura                                                                     | Scala predefinita                                                                                 |
| ------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `sbom-coverage`          | % repository con SBOM                                                      | %, 4 ≥ 85%                                                                                        |
| `image-signature`        | % immagini (per digest) con firma verificata                               | %, 4 ≥ 85%                                                                                        |
| `build-provenance`       | % repository la cui release ha attestazioni di provenienza                 | %, 4 ≥ 85%                                                                                        |
| `license-policy`         | pacchetti con licenza segnalata                                            | 5 = 0 con politica, 3 = 0 senza, 1 > 0                                                            |
| `dependency-scanning`    | % repository con Dependabot attivo                                         | %, 4 ≥ 90%                                                                                        |
| `sast`                   | % repository con code scanning recente                                     | %, 4 ≥ 90%                                                                                        |
| `container-scanning`     | % repository con analisi dei container                                     | %, 4 ≥ 90%                                                                                        |
| `iac-scanning`           | % repository con analisi IaC                                               | %, 4 ≥ 90%                                                                                        |
| `dast`                   | % repository con DAST                                                      | %, 4 ≥ 70%                                                                                        |
| `vulnerability-age`      | alert critici/alti oltre la scadenza di rimedio                            | 5 = 0 e nessuno in scadenza entro 7 giorni, 4 = 0, 3 ≤ 2, 2 ≤ 5, 1 > 5                            |
| `security-mttr`          | giorni mediani per chiudere gli alert critici/alti chiusi nella finestra   | 5 ≤ 1, 4 ≤ 7, 3 ≤ 30, 2 ≤ 90, 1 > 90 giorni                                                       |
| `secret-scanning`        | % repository con secret scanning                                           | %; 4–5 richiedono anche la push protection su ≥ 90% (altrimenti massimo 3)                        |
| `exposed-secrets`        | alert di secret scanning aperti                                            | 5 = 0 e nessuno nella finestra, 4 = 0, 1 > 0                                                      |
| `workload-identity`      | % workflow di deploy che usano OIDC invece di chiavi cloud di lunga durata | %, 4 ≥ 85%                                                                                        |
| `branch-protection`      | % repository con branch protetto, pull request obbligatoria, force push no | %, 4 ≥ 90%                                                                                        |
| `required-checks`        | % repository con controlli di stato obbligatori                            | %, 4 ≥ 85%                                                                                        |
| `pipeline-integrity`     | % repository con action fissate e workflow riusabili aggiornati            | %, 4 ≥ 85%                                                                                        |
| `environment-separation` | ambienti dichiarati e produzione protetta                                  | 1 un ambiente, 2 nessuno in GitHub, 3 separati, 4 produzione protetta, 5 anche limitata ai branch |
| `config-drift`           | % ambienti allineati a Git                                                 | %, 4 ≥ 95%                                                                                        |
| `deploy-frequency`       | deploy a settimana (ambiente di rilascio, ultimi 30 giorni)                | 1 > 0, 2 ≥ 1 al mese, 3 ≥ 1 a settimana, 4 ≥ 2 a settimana, 5 ≥ 1 al giorno                       |
| `lead-time`              | ore mediane dalla modifica al suo deploy                                   | 5 ≤ 1 h, 4 ≤ 24 h, 3 ≤ 7 giorni, 2 ≤ 30 giorni, 1 oltre                                           |
| `change-failure-rate`    | % modifiche fallite o annullate con rollback                               | 5 ≤ 5%, 4 ≤ 15%, 3 ≤ 30%, 2 ≤ 45%, 1 oltre                                                        |
| `time-to-restore`        | ore mediane da un fallimento al deploy successivo riuscito                 | 5 ≤ 1 h, 4 ≤ 8 h, 3 ≤ 24 h, 2 ≤ 7 giorni, 1 oltre                                                 |
| `test-coverage`          | copertura delle righe                                                      | 1 > 0%, 2 ≥ 30%, 3 ≥ 60%, 4 ≥ 80%, 5 ≥ 90%                                                        |
| `evidence-freshness`     | % fonti di evidenza lette e non scadute                                    | 1 > 0%, 2 ≥ 50%, 3 ≥ 75%, 4 ≥ 90%, 5 = 100%                                                       |

**Identità dei workload.** Un workflow _fa deploy_ quando usa un'action di login cloud
(`azure/login`, `aws-actions/configure-aws-credentials`, `google-github-actions/auth`) o un job con
`environment:`. Usa **OIDC** quando il workflow, o ogni job di deploy, concede `id-token: write` e
lo step di login non ha nessuno degli input `creds`, `credentials_json`, `aws-secret-access-key`,
`client-secret`. Si leggono solo i **nomi** degli input, mai i valori.

**Separazione degli ambienti.** Gli ambienti GitHub della repository coordinatrice. Un ambiente
del catalogo corrisponde a un ambiente GitHub tramite `githubEnvironment` (default: il suo `id`).
La produzione è l'ambiente `delivery` (default: l'ultimo). Protetto = revisori obbligatori o un
tempo di attesa.

## Segnali di deploy (controlli di rilascio)

Frequenza dei deploy, tempo di consegna, tasso di modifiche fallite e tempo di ripristino usano
**un ambiente per progetto**: quello con `delivery: true`, altrimenti l'ultimo. Ogni ambiente dice
come osservare i suoi deploy con `deploySignal` (default `external`):

| `type`          | Deploy                                                                            | Fallimenti                              | Tempo di consegna                                   |
| --------------- | --------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------- |
| `workflow`      | esecuzioni completate con successo di un workflow tracciato (ultime 20)           | esecuzioni fallite                      | head commit → fine dell'esecuzione                  |
| `versions-file` | un commit che **alza** la versione semver a `key` nel file                        | un commit che la **abbassa** (rollback) | commit del tag `<tagPrefix><versione>` → promozione |
| `argocd`        | voci dello storico Argo CD                                                        | non visibili                            | non visibile                                        |
| `release`       | release pubblicate della coordinatrice                                            | non visibili                            | non visibile                                        |
| `external`      | nessuno: i quattro controlli non sono visibili («rilasciato da pipeline esterne») |                                         |                                                     |

File delle versioni: si leggono gli ultimi 100 commit che toccano il percorso, poi il file a ogni
commit nella finestra di 90 giorni (al massimo 50). Un commit che lascia invariata la versione
(formattazione, commenti) viene ignorato; un valore non semver viene saltato e segnalato nella
cella. I rollback contano come modifiche fallite e il ripristino avviene al rollback.

```yaml
environments:
  - id: prod
    name: PROD
    githubEnvironment: production
    delivery: true
    deploySignal:
      type: versions-file
      repository: coordinator # o l'id di un componente
      path: environments/prod.yaml
      key: umbrella # percorso puntato della versione installata (semver)
      tagPrefix: v
controlMap:
  notApplicable:
    - { check: dast, reason: servizio interno senza interfaccia web }
```

Le metriche di rilascio su DEV, sulle release o sullo storico Argo CD sono **approssimazioni**:
la cella indica sempre l'ambiente e il segnale.

## Permessi

Le nuove letture sono solo GET: ambienti GitHub (`GET /repos/{o}/{r}/environments`), commit di un
percorso, file a un commit, date dei commit, release (Contents: read), e lo stato della push
protection nei metadati della repository (`security_and_analysis`, restituito solo a chi può
vederlo). Senza un permesso il controllo è **non visibile** con il motivo, mai 0. Vedi
[Sicurezza](security.md#modello-di-autorizzazione).

## Output

- Pagina `controls/` (EN, IT): heatmap per business unit, dettaglio della cella con valore, soglia
  raggiunta, repository lette, ambiente e segnale, riferimenti e collegamento alle evidenze nella
  pagina del progetto; filtri per business unit, area e `?team=`; legenda; tabella dei riferimenti.
- Pagina del progetto: un blocco «Controlli» con punteggio e collegamento alla sua riga.
- `exports/control-map.csv`: una riga per progetto e controllo.
- Metriche: `hub_project_control_score`, `hub_project_control_measured`,
  `hub_project_control_applicable`, `hub_project_control_level{check}`; pannello Grafana «Control map».
- Schema degli snapshot 1.9: `project.controlMap` e `summary.controlMap`.

## Fonti

Verificate il 2026-11-04 sui testi pubblicati; quel giorno le pagine EUR-Lex non erano
raggiungibili, quindi confermare i numeri degli articoli su EUR-Lex prima di usarli verso
l'esterno.

- Regolamento (UE) 2022/2554 (DORA), capo II (art. 5–16) e art. 24–25.
- Regolamento delegato (UE) 2024/1774 della Commissione (RTS sul quadro di gestione dei rischi ICT).
- ISO/IEC 27001:2022, Allegato A.
