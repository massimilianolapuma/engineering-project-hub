# Deployments ledger

> Italian version: [docs/it/deployments-ledger.md](it/deployments-ledger.md)

GitHub Deployments are the **ledger of every deploy of every environment** of a repository
([ADR 0015](architecture/adr/0015-deployments-ledger.md)). DEV and lab deploys made by GitHub
Actions are already there: a job with `environment:` creates a deployment. Test, pre-production
and production environments deployed by other systems are added by one of three writers:

| Writer                                        | How                                                                                       | When                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Push** (`scripts/report-deployment.sh`)     | a last step in the external deploy job reports the deploy and its result                  | you can change the external pipeline; real time                         |
| **Pull bridge** (`rw-deployments-bridge.yml`) | a scheduled GitHub workflow reads Azure DevOps environment deployment records (read-only) | you cannot or do not want to change the pipelines; delay = the schedule |
| **Declared** (`rw-deployments-declare.yml`)   | a manual form, approved by a second person, marked `declared`                             | no system can report the deploy                                         |

The hub reads the ledger with the `github-deployments` deploy signal
([Control map](control-map.md#deploy-signals-delivery-checks)): the delivery checks become
measurable for every environment, and `environment-separation` sees the environments GitHub now
knows.

## The record

A deploy of commit `SHA` to environment `E` is a GitHub deployment on `SHA` with environment `E`,
then one status `success` or `failure` whose `log_url` points at the external run. Its `payload`:

```json
{
  "ledger": 1,
  "source": "azure-devops",
  "runId": "12345",
  "runUrl": "https://dev.azure.com/example-org/example-project/_build/results?buildId=12345",
  "attempt": 1,
  "version": "0.5.2",
  "startedAt": "2026-11-04T09:12:00Z",
  "finishedAt": "2026-11-04T09:20:31Z",
  "declared": false,
  "kind": "deploy"
}
```

- `finishedAt` is the **real** end of the deploy. GitHub timestamps are the time of writing and
  cannot be backdated, so the hub uses `finishedAt` (a bridge that catches up 90 days still shows
  each deploy at its real date).
- A deploy is identified by `source`, `runId`, `attempt` and the environment: writing it twice
  changes nothing; a retried stage (`attempt` 2) is a new record, so a failure then a success
  reads as a failed deploy and its restore.
- `kind: rollback` marks a rollback; the hub also reads a lower version than the previous deploy
  as a rollback.
- A commit GitHub does not know (mirror behind) is never recorded: the writers skip it and say so.
- The JSON Schema of the bridge map is `config/schema/deployments-bridge.schema.json`.

## The GitHub App that writes

One GitHub App per GitHub organisation, for example `<org>-deployment-reporter`:

- repository permissions: **Deployments: read and write** (Metadata: read is added by GitHub);
  nothing else: no code, no Actions, no settings;
- webhook off; installable "Only on this account"; installed on the repositories that need it;
- **one private key per line or external project**, so each can be revoked alone; every token is
  narrowed to one repository and to `deployments: write` when it is requested.

Known limit (accepted by the owner): any key of the App can request a token for any repository the
App is installed on, and GitHub does not record which key wrote. Keep keys in the external
systems' secret stores, rotate them, and revoke a key when a project ends. The only permission at
stake is Deployments.

The hub keeps its own read-only App; it needs **Deployments: read** to read the ledger. The pull
bridge also uses it to check that a commit exists and to read the version file (D11), so the
writer keys never read code.

## Push: a step at the end of the external deploy

Requirements: the agent can reach `https://api.github.com` (Microsoft-hosted agents can; a
self-hosted agent in a customer network needs egress or a proxy), and the mirror keeps the commit
SHAs. `scripts/report-deployment.sh` needs bash, openssl, curl and jq. Azure DevOps example, in
the deployment job of each environment:

```yaml
- task: DownloadSecureFile@1
  name: ghAppKey
  inputs:
    secureFile: github-deployment-reporter.pem
- bash: |
    # Agent.JobStatus is Succeeded, SucceededWithIssues, Failed or Canceled at this point.
    case "$AGENT_JOBSTATUS" in
      Succeeded | SucceededWithIssues) STATE=success ;;
      Failed) STATE=failure ;;
      *) echo "deploy $AGENT_JOBSTATUS: not recorded"; exit 0 ;;
    esac
    STATE="$STATE" FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)" ./scripts/report-deployment.sh
  displayName: Report deployment to GitHub
  condition: always()
  env:
    GH_APP_ID: $(GITHUB_DEPLOY_APP_ID)
    GH_INSTALLATION_ID: $(GITHUB_DEPLOY_INSTALLATION_ID)
    GH_KEY_FILE: $(ghAppKey.secureFilePath)
    GH_OWNER: example-org
    GH_REPO_NAME: example-service
    SHA: $(Build.SourceVersion)
    ENV_NAME: prod # the hub catalog environment id
    RUN_ID: $(Build.BuildId)
    ATTEMPT: $(System.StageAttempt)
    RUN_URL: $(System.CollectionUri)$(System.TeamProject)/_build/results?buildId=$(Build.BuildId)
    PRODUCTION: 'true'
```

`scripts/report-deployment.sh` is copied into the external repository (or fetched from a hub
release). A canceled deploy is not recorded, as in the bridge. A commit GitHub does not know
returns HTTP 422: the script
exits 0 with "commit not on GitHub", so the deploy job does not fail.

## Pull bridge: Azure DevOps → GitHub

The bridge reads, for each mapped Azure DevOps environment, its deployment records (api-version
7.1, confirmed on Microsoft Learn on 2026-11-04):

- `GET https://dev.azure.com/{org}/{project}/_apis/distributedtask/environments?name=…`
- `GET …/_apis/distributedtask/environments/{id}/environmentdeploymentrecords?top=100`
  (record: `result`, `startTime`, `finishTime`, `definition.id` = pipeline, `owner.id` = run,
  `stageAttempt`)
- `GET …/_apis/pipelines/{pipelineId}/runs/{runId}` (`resources.repositories[alias].version` =
  the commit)

Results: `succeeded` and `succeededWithIssues` → `success`, `failed` → `failure`; canceled,
skipped, abandoned and running deploys are not written. At most 100 records per environment and
run.

1. **Map** in the calling repository, `config/deployments-bridge.yaml`
   ([example](../examples/deployments/deployments-bridge.yaml)): Azure DevOps organisation, project
   and environment → GitHub repository and environment, `production`, optional `versionFrom`
   (file and key of the promoted version) and `commitFrom` (repository alias when the pipeline
   YAML lives elsewhere).
2. **Azure DevOps identity** (preferred, no stored secret): a Microsoft Entra app registration with
   a federated credential for the calling repository (issuer `https://token.actions.githubusercontent.com`,
   subject `repo:<owner>/<repo>:ref:refs/heads/main` or the environment you use), added to the
   Azure DevOps organisation as a user (Basic or Stakeholder) with read access to the project and
   its environments. Set the repository variables `ADO_TENANT_ID` and `ADO_CLIENT_ID`. Fallback: a
   PAT with Environment: read and Build: read, as the secret `ADO_PAT`.
3. **Secrets** of the calling repository: `LEDGER_APP_ID`, `LEDGER_APP_PRIVATE_KEY` (deployment
   App), `GH_APP_ID`, `GH_APP_PRIVATE_KEY` (the hub's read App).
4. **Caller workflow**: [example](../examples/deployments/caller-bridge.yml), one job per GitHub
   organisation and Azure DevOps tenant, on a schedule.
5. **Dry-run first.** The bridge writes only when the input `mode` is `write` **and** the
   repository variable `HUB_DEPLOYMENTS_BRIDGE` is `write`. Until then the job summary shows, per
   environment, the records read, the ones that would be written and the ones skipped and why
   (`not-completed`, `commit-not-on-github`, `commit-unverified`, `commit-unreadable`,
   `ado-environment-not-found`). The first run may catch up to 90 days (`since-days`).

## Declared: when no system can report it

[Example caller](../examples/deployments/caller-declare.yml): a `workflow_dispatch` form with
repository, environment, version or commit, result, date and note. A version resolves to the
commit of tag `<prefix><version>`; a missing tag refuses the record. The workflow fails closed:

- the job runs in the environment `deployments-declare` of the calling repository. Give it
  required reviewers and store `LEDGER_APP_ID`, `LEDGER_APP_PRIVATE_KEY`, `GH_APP_ID` and
  `GH_APP_PRIVATE_KEY` as **environment secrets** there, not as repository secrets: the keys exist
  only after a second person approves the run, and without them the job fails;
- the repository and environment must be listed in the reviewed allowlist
  `config/deployments-declare.yaml` of the calling repository
  ([example](../examples/deployments/deployments-declare.yaml)); anything else is refused before a
  token is requested.

The hub counts declared records and the cell says "includes N declared".

## In the hub catalog

```yaml
environments:
  - id: prod
    name: PROD
    delivery: true
    deploySignal: { type: github-deployments, repository: coordinator }
    # optional: environment: production (GitHub name, default githubEnvironment ?? id),
    #           tagPrefix: v, sources: [azure-devops] (count only these writers)
```

`sources` is off by default (every deployment of the environment counts). Use it if a GitHub
Actions job with `environment:` ever records a "deploy" that did not happen (for example a job
that only uses the environment's secrets).
