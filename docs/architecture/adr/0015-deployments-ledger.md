# ADR 0015: GitHub Deployments as the ledger of every environment, written from outside the hub

- **Status:** Accepted
- **Date:** 2026-11-04
- **Italian version:** [docs/it/architecture/adr/0015-deployments-ledger.md](../../it/architecture/adr/0015-deployments-ledger.md)

## Context

The control map (ADR 0014) measures delivery from one environment per project. DEV and lab
environments are deployed by GitHub Actions, so GitHub knows them. Test, pre-production and
production are often deployed by systems the hub cannot see: the repository is mirrored to a
customer's Azure DevOps (or a cloud provider) and its pipelines deploy, with approvals, from there.
Those environments read "deployed by external pipelines". The owner wants every environment of
every repository to be visible, in GitHub and in the hub.

## Decision

1. **GitHub Deployments are the ledger.** Every deploy of every environment is a GitHub deployment
   on the deployed commit, with a final status and a link to the run that did it. Environment
   names follow the hub catalog.
2. **Three writers, outside the hub's collect job:**
   - a push step at the end of external pipelines (`scripts/report-deployment.sh`);
   - a pull bridge that reads Azure DevOps environment deployment records read-only
     (`rw-deployments-bridge.yml`);
   - a declared record entered through a protected, reviewed form (`rw-deployments-declare.yml`).
     The writers are a separate program (`ledger/`), isolated from the collector and the notifier by
     ESLint, like the notifier (ADR 0013).
3. **A contract, not a convention.** The deployment `payload` carries the source, the external run,
   the attempt, the version and the real start and end times (GitHub's own timestamps are write
   times). A deploy is written once per (source, run, attempt, environment). A commit GitHub does
   not know is never recorded.
4. **Least privilege.**
   - **Writing:** one GitHub App per organisation with only Deployments: read and write, one
     private key per line or external project, and tokens narrowed to one repository and
     `deployments: write`. The owner accepted the limit that any key of the App can address any
     repository it is installed on.
   - **Reading:** the bridge reads GitHub with the hub's read-only App, so writer keys never read
     code.
   - **Azure DevOps:** the bridge reads it through Microsoft Entra workload identity federation,
     with no stored secret, or a PAT as a fallback.
5. **Dry-run by default.** The bridge and the declared form write only with the input `mode: write`
   and the repository variable `HUB_DEPLOYMENTS_BRIDGE=write`.
6. **The hub reads only the ledger** through the `github-deployments` deploy signal (hub App:
   Deployments: read). Declared records count and are named in the cell.

## Consequences

- One place shows the full deploy history per environment for people and for the hub. The
  delivery metrics stop depending on where a customer runs its pipelines.
- External pipelines or customer tenants have to grant something: a step and a key (push), or a
  read identity (bridge). Each project picks what its customer allows.
- A wrong bridge map can write deploys to the wrong repository. The map is reviewed in pull
  requests, and dry-run shows every write first.
- Google Cloud Deploy, AWS CodePipeline and ticketing imports can be added as further writers of
  the same contract.
