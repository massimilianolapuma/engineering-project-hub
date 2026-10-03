# Security Policy

> 🇮🇹 La versione italiana segue la versione inglese.

## Reporting a vulnerability

Please **do not** open a public issue, pull request or discussion for a suspected
vulnerability. Do not disclose it publicly before it is fixed.

Report it privately through GitHub's **private vulnerability reporting**: open the
repository's **Security** tab and choose **Report a vulnerability**. If that option is not
available, contact the repository maintainers listed in `.github/CODEOWNERS` through your
organisation's internal channels.

Please include:

- a description of the issue and its impact;
- steps to reproduce, or a proof of concept that uses only synthetic data;
- the affected version or commit;
- optionally, a suggested fix.

**Never** include real credentials, tokens, secret values or confidential repository data
in a report. If a credential has been exposed, rotate it first. See
[docs/security.md](docs/security.md#response-to-accidental-exposure).

We aim to acknowledge reports within 5 business days and to agree on a fix timeline based
on severity.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✅        |

## Scope

The scope covers the collector (`collector/`), the shared model, the static site (`src/`),
the scripts and the GitHub Actions workflows in this repository. Issues in monitored
repositories, in GitHub itself or in third-party dependencies should be reported to their
owners. Dependency advisories are tracked through Dependabot.

Security design, threat model and data handling: [docs/security.md](docs/security.md).

---

# Politica di sicurezza

## Segnalare una vulnerabilità

**Non** aprire issue, pull request o discussioni pubbliche per una sospetta vulnerabilità e
non divulgarla prima della correzione.

Segnala in privato tramite la **segnalazione privata delle vulnerabilità** di GitHub:
scheda **Security** del repository → **Report a vulnerability**. Se l'opzione non è
disponibile, contatta i maintainer indicati in `.github/CODEOWNERS` tramite i canali
interni della tua organizzazione.

Includi:

- descrizione del problema e del suo impatto;
- passi per riprodurlo, oppure un proof of concept che usi solo dati sintetici;
- versione o commit interessati;
- facoltativamente, una proposta di correzione.

**Non** inserire mai credenziali reali, token, valori di secret o dati riservati dei
repository nella segnalazione. Se una credenziale è stata esposta, ruotala subito: vedi
[docs/it/security.md](docs/it/security.md).

Puntiamo a prendere in carico le segnalazioni entro 5 giorni lavorativi e a concordare i
tempi di correzione in base alla gravità.

## Versioni supportate

| Versione | Supportata |
| -------- | ---------- |
| 0.1.x    | ✅         |

## Ambito

L'ambito comprende il collector, il modello condiviso, il sito statico, gli script e i
workflow GitHub Actions di questo repository. Le vulnerabilità nei repository monitorati,
in GitHub stesso o nelle dipendenze di terze parti vanno segnalate ai rispettivi
responsabili.
