# ADR 0013: Outward notifications from a separate job, dry-run by default, digest without repository detail

- **Status:** Accepted
- **Date:** 2026-11-04
- **Italian version:** [docs/it/architecture/adr/0013-outward-notifications.md](../../it/architecture/adr/0013-outward-notifications.md)

## Context

Until v0.14.0 the hub only read: it collected from GitHub and optional providers and published a
static site and files. Teams asked to hear about worsening projects where they already work, in a
Microsoft Teams channel, without opening the hub. Posting to Teams is the hub's first **write to a
system outside its perimeter**: a chat message can be forwarded, quoted and kept forever, and the
credential (the Workflows trigger URL) lets anyone who holds it post to the channel.

## Decision

1. **A separate program in a separate job.** The notifier (`notifier/`, `npm run notify`) runs in
   a `notify` job after `deploy`. Only its "Notify" step receives `TEAMS_WEBHOOK_URL`. The collect,
   build, attest and deploy jobs never receive it, and the notify job never receives the
   collector's credentials (GitHub App, PAT, provider tokens). ESLint forbids imports between
   `notifier/` and `collector/` (and from the site and `shared/` into `notifier/`).
2. **Dry-run unless everything says send.** Sending needs the config `mode: send`, the repository
   variable `HUB_NOTIFICATIONS=send`, real data (`github`), and a `changes.json` that was really
   compared and is not synthetic. Otherwise the payload is written to an artifact for review and
   the summary names the first condition that failed.
3. **A digest without repository detail.** The message carries project names, statuses,
   scores and counts, and links only to the hub's own "What changed" page. Never repository names,
   component ids, alert ids or titles, exception ids, team references, GitHub links or error
   details. Project names are escaped. Every payload is checked for credential patterns and for
   the values of credentials in the environment before it is written or sent.
4. **Once per change set.** The change set key is a hash of the previous collection date and the
   significant items. A ledger (`hub-notify-ledger` artifact, 90 days, no URL or payload) records
   what was sent; a re-run sees it, including an earlier attempt of the same run. A ledger that
   cannot be restored in send mode means nothing is sent.
5. **One audited HTTP core.** The ADR 0012 client core moved to `shared/http/` unchanged. The
   notifier adds `postOnce`: POST only, `https` only, a Workflows host from an allow-list,
   redirects refused, a timeout, a capped and discarded response, **no automatic retry** (POST is
   not idempotent), nothing logged.
6. **Microsoft Teams first.** Jira and Azure DevOps are designed (spec §5.5.4) and come later;
   their config keys are rejected until then.

## Alternatives considered

- **Notify from the collect job.** Rejected: source and target credentials would share a job.
- **Retry on failure.** Rejected: a timeout after the channel accepted the message would post it
  twice. A failed send is visible in the job and the next change set is sent normally.
- **Per-finding messages.** Rejected: noise. One digest per collection, only on significant
  worsening.
- **Office 365 connectors (Incoming Webhook).** Not available: retired in Teams in May 2026.

## Consequences

- New optional secret `TEAMS_WEBHOOK_URL` and repository variable `HUB_NOTIFICATIONS`; the
  protected deploy path gets the input `notifications` and the same secret.
- A flow belongs to the person who created it: if they leave, posting stops (the docs recommend a
  service account and a co-owner). The URL is a password: rotate it by recreating the trigger.
- A failed notification never blocks a deployment: nothing depends on the `notify` job.
- Adding Jira or Azure DevOps means a renderer and a host rule on the same `postOnce`.
