# Notifications (Microsoft Teams)

> 🇮🇹 [Versione italiana](it/notifications.md)

From v0.15.0 the hub can post a short digest to a Microsoft Teams channel after each collection,
when projects got worse. It is off by default, then dry-run, and sends only after two separate
opt-ins. Design: [ADR 0013](architecture/adr/0013-outward-notifications.md).

## What a message contains

One message per collection, only when something significant happened (defaults in
`config/notifications.yaml`):

- a project's overall status got worse (Healthy → Attention, → Critical) or became Unknown;
- Security or Delivery got worse;
- new critical alerts;
- critical or high alerts newly past their remediation deadline;
- security exceptions that expired.

Improvements never trigger a message. For each project: its name, status ("Critical (was
Attention)"), the dimensions that got worse, the counts and the score change. With `siteUrl` set, an
"Open What changed" button links to the hub.

**Never in a message:** repository names, component ids, alert ids or titles, exception ids, team
names, GitHub links, error details. The reader follows the link to the hub, behind its own access
control, for detail. Project names stay: if they are confidential, do not post to a wider
audience.

## Setup

1. **Create the flow.** In Teams, open the channel → **Workflows** → template **Send webhook
   alerts to a channel**. For "Who can trigger the flow" choose **Anyone**: the URL itself is the
   credential (the hub sends no other authentication). Copy the webhook URL.
2. **Store the URL as a secret**: `TEAMS_WEBHOOK_URL`, in the repository (GitHub Pages path) or in
   the deploy repository (protected path). Never in a file.
3. **Configure** `config/notifications.yaml` (or the deploy repository's config): set `siteUrl` to
   the hub's address (`https://…/`, ending with `/`) and `targets.teams.enabled: true`. Keep
   `mode: dry-run` for now.
4. **Turn the job on.**
   - GitHub Pages path: repository variable `HUB_NOTIFICATIONS=dry-run`.
   - Protected path: pass `notifications: ${{ vars.HUB_NOTIFICATIONS }}` and the secret in the
     calling workflow (see `examples/protected-deploy/.github/workflows/deploy-hub.yml`).
5. **Check a dry run.** After the next collection, the `notify` job uploads
   `notification-payloads`: `digest.json`, `teams.json` (the exact message, without the URL) and
   `summary.md`.
6. **Send.** Set `mode: send` in the config **and** `HUB_NOTIFICATIONS=send`.

## Why a run stayed dry-run

The summary's `Mode` line names the first condition that failed:

| Reason          | Meaning                                                                 |
| --------------- | ----------------------------------------------------------------------- |
| `mode-config`   | `notifications.yaml` says `mode: dry-run`                               |
| `mode-variable` | the variable `HUB_NOTIFICATIONS` (or the protected input) is not `send` |
| `mock-data`     | the run used the demo data                                              |
| `not-compared`  | there was no previous collection to compare with (no history yet)       |
| `synthetic`     | the comparison basis is synthetic (demo history)                        |

## No duplicates, no retries

Each digest has a change-set key (a hash of the previous collection date and the significant
items). After a successful send the key is stored in the `hub-notify-ledger` artifact (90 days).
A re-run of the same workflow run, or a later run with the same changes, sees the key and reports
`skipped-duplicate`. If the ledger cannot be restored in send mode, nothing is sent ("ledger
unavailable"). A failed send is **not** retried automatically: re-run the job, or the next change
set is sent normally. A notification failure never blocks a deployment.

Summary outcomes for Teams: `dry-run`, `off`, `sent`, `skipped-duplicate`, `not-configured` (no
secret), `refused` (the URL is not a Workflows host over https), `rejected`, `not-authorised`,
`not-found`, `too-large`, `rate-limited`, `error`. Any outcome after `skipped-duplicate` in this
list makes the job fail.

## Risks and limits

- **The flow belongs to a person.** If its owner leaves, posting stops. Create it with a service
  account, or add a co-owner.
- **The URL is a password.** Anyone with it can post to the channel. Rotate it by deleting and
  recreating the flow's trigger, then update the secret.
- **Limits:** a message is at most 28 KB (the hub keeps it under 24 KB and counts the projects left
  out); more than 4 requests per second are throttled (the hub sends one).
- **Host allow-list:** only hosts ending with `environment.api.powerplatform.com` are accepted;
  sovereign clouds can add theirs in `targets.teams.allowedHostSuffixes`.

## Sources (checked 2026-11-04)

- [Create incoming webhooks with Workflows](https://learn.microsoft.com/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook)
  (Adaptive Card and MessageCard payloads, 28 KB, throttling, orphan flows).
- [Retirement of Office 365 connectors within Microsoft Teams](https://devblogs.microsoft.com/microsoft365dev/retirement-of-office-365-connectors-within-microsoft-teams/)
  (connectors retired in May 2026).
