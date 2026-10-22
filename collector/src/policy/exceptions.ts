import type {
  ExceptionEntry,
  ExceptionsFile,
  ExceptionSource,
  FindingException,
  Policies,
  SecurityException,
  SecurityFinding,
} from '@model/index';
import { sanitizeUrl, scrubIdentifier, scrubText } from '../sanitizers/sanitize';
import { DAY_MS } from '../util/clock';

/*
 * Security exceptions: pure matching and states (spec 5.2). The exceptions file is reviewed
 * configuration. An excepted finding keeps `status: 'open'`; only `countsAsOpen` decides what
 * is counted. Match keys stay inside the collector and never reach a published object.
 */

/** Raw match keys of one finding, taken from the provider DTO before any withholding. */
export interface FindingKeys {
  alert: number;
  ruleId: string | null;
  tool: string | null;
  advisoryIds: string[];
}
/** A finding before exceptions and SLAs are applied. */
export type BaseFinding = Omit<SecurityFinding, 'exception' | 'sla'>;
export interface MatchableFinding {
  finding: BaseFinding;
  keys: FindingKeys;
}
/**
 * Key "owner/repo|code-scanning" (the repository is matched case-insensitively). The map must
 * list every (repository, source) pair in play: a missing pair is read as unreadable, so the
 * exception on it is "unverifiable" and never silently accepted or stale.
 */
export type SourceReadability = Map<string, 'readable' | 'unreadable'>;
export interface ExceptionIssue {
  level: 'error' | 'warning';
  path: string;
  message: string;
}
export type FindingWithException = BaseFinding & { exception: FindingException | null };

const FINDING_SOURCE: Record<ExceptionSource, BaseFinding['source']> = {
  'code-scanning': 'github-code-scanning',
  dependabot: 'github-dependabot',
  'secret-scanning': 'github-secret-scanning',
};

/** An exception expires at the start of the day after `expires` (inclusive last day, UTC). */
export function expiryInstant(expires: string): Date {
  return new Date(Date.parse(`${expires}T00:00:00.000Z`) + DAY_MS);
}

const pathOf = (i: number, e: ExceptionEntry) => `exceptions[${i}] (${e.id})`;

export function validateExceptions(
  file: ExceptionsFile,
  policies: Policies,
  catalogRepositories: ReadonlySet<string>,
  now: Date,
): ExceptionIssue[] {
  const issues: ExceptionIssue[] = [];
  const { maxDays, expiringSoonDays } = policies.exceptions;
  const today = now.toISOString().slice(0, 10);
  file.exceptions.forEach((e, i) => {
    const path = pathOf(i, e);
    const add = (level: ExceptionIssue['level'], message: string) =>
      issues.push({ level, path, message });

    // The horizon compares two static dates, never "now": a valid file stays valid.
    const span = Math.round((Date.parse(e.expires) - Date.parse(e.created)) / DAY_MS);
    if (span > maxDays)
      add(
        'error',
        `expires ${span} days after created, which exceeds exceptions.maxDays (${maxDays})`,
      );
    if (e.ticket) {
      const host = new URL(e.ticket).hostname.toLowerCase();
      if (!policies.publication.allowedLinkHosts.includes(host))
        add('error', `ticket host "${host}" is not in publication.allowedLinkHosts`);
    }
    if (!catalogRepositories.has(e.repository.toLowerCase()))
      add('warning', `repository ${e.repository} is in no catalog project (orphaned)`);
    const remaining = expiryInstant(e.expires).getTime() - now.getTime();
    if (remaining <= 0) add('warning', `expired on ${e.expires}: remove or renew`);
    else if (remaining <= expiringSoonDays * DAY_MS)
      add('warning', `expires in ${Math.floor(remaining / DAY_MS)} days (${e.expires})`);
    // An exception cannot be written in advance: a forward-dated `created` would stretch the
    // acceptance past exceptions.maxDays. (Collection never applies such an entry either.)
    if (e.created > today) add('error', `created in the future (${e.created})`);
  });
  return issues;
}

export function orphanedExceptionIds(
  exceptions: ExceptionEntry[],
  catalogRepositories: ReadonlySet<string>,
): string[] {
  return exceptions
    .filter((e) => !catalogRepositories.has(e.repository.toLowerCase()))
    .map((e) => e.id);
}

function matches(e: ExceptionEntry, m: MatchableFinding): boolean {
  const { finding, keys } = m;
  if (finding.status !== 'open') return false;
  if (finding.repository.toLowerCase() !== e.repository.toLowerCase()) return false;
  if (finding.source !== FINDING_SOURCE[e.source]) return false;
  if ('alert' in e.match) return keys.alert === e.match.alert;
  if ('rule' in e.match) {
    if (keys.ruleId !== e.match.rule) return false;
    return !e.match.tool || keys.tool?.toLowerCase() === e.match.tool.toLowerCase();
  }
  const wanted = e.match.advisory.toUpperCase();
  return keys.advisoryIds.some((id) => id.toUpperCase() === wanted);
}

const STATE_ORDER = { invalid: 0, expired: 1, unverifiable: 2, stale: 3, active: 4 } as const;

export function applyExceptions(input: {
  findings: MatchableFinding[];
  exceptions: ExceptionEntry[];
  readability: SourceReadability;
  publicDetail: (repository: string) => boolean;
  policies: Policies;
  now: Date;
}): { findings: FindingWithException[]; records: SecurityException[] } {
  const { policies, now } = input;
  const today = now.toISOString().slice(0, 10);
  const states = new Map<string, 'readable' | 'unreadable'>();
  for (const [key, state] of input.readability) states.set(key.toLowerCase(), state);
  const readable = (e: ExceptionEntry) =>
    states.get(`${e.repository.toLowerCase()}|${e.source}`) === 'readable';

  /** Candidate exceptions per finding id, with the state they were evaluated to. */
  const carried = new Map<string, { entry: ExceptionEntry; state: 'active' | 'expired' }[]>();
  const records: SecurityException[] = input.exceptions.map((e) => {
    const expired = now.getTime() >= expiryInstant(e.expires).getTime();
    // Never applied before its `created` date (UTC): reported invalid, whatever else is true.
    const notYetInForce = e.created > today;
    const isReadable = readable(e);
    const hits = isReadable && !notYetInForce ? input.findings.filter((m) => matches(e, m)) : [];
    const state: SecurityException['state'] = notYetInForce
      ? 'invalid'
      : expired
        ? 'expired'
        : !isReadable
          ? 'unverifiable'
          : hits.length === 0
            ? 'stale'
            : 'active';
    if (state === 'active' || state === 'expired') {
      for (const h of hits) {
        const list = carried.get(h.finding.id) ?? [];
        list.push({ entry: e, state });
        carried.set(h.finding.id, list);
      }
    }
    const reveal = input.publicDetail(e.repository);
    const kind = 'alert' in e.match ? 'alert' : 'rule' in e.match ? 'rule' : 'advisory';
    const rawValue =
      'alert' in e.match
        ? String(e.match.alert)
        : 'rule' in e.match
          ? e.match.rule
          : e.match.advisory;
    return {
      id: e.id,
      repository: e.repository,
      source: e.source,
      selector: {
        kind,
        value: kind === 'alert' ? rawValue : reveal ? scrubIdentifier(rawValue, 200) : null,
        tool:
          reveal && 'rule' in e.match && e.match.tool ? scrubIdentifier(e.match.tool, 50) : null,
      },
      owner: scrubIdentifier(e.owner, 65) ?? 'unknown',
      reason: reveal ? scrubText(e.reason, 200) : null,
      created: e.created,
      expires: e.expires,
      ticketUrl:
        reveal && e.ticket ? sanitizeUrl(e.ticket, policies.publication.allowedLinkHosts) : null,
      state,
      expiringSoon:
        state === 'active' &&
        expiryInstant(e.expires).getTime() - now.getTime() <=
          policies.exceptions.expiringSoonDays * DAY_MS,
      matched: isReadable && !notYetInForce ? hits.length : null,
      findingIds: hits
        .map((h) => h.finding.id)
        .sort()
        .slice(0, 50),
    };
  });
  records.sort(
    (a, b) =>
      STATE_ORDER[a.state] - STATE_ORDER[b.state] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  const findings = input.findings.map(({ finding }): FindingWithException => {
    const candidates = carried.get(finding.id);
    if (!candidates?.length) return { ...finding, exception: null };
    // An active exception beats an expired one, an alert selector beats a rule/advisory one,
    // then the latest expiry, then the smallest id.
    const best = [...candidates].sort(
      (a, b) =>
        Number(b.state === 'active') - Number(a.state === 'active') ||
        Number('alert' in b.entry.match) - Number('alert' in a.entry.match) ||
        (a.entry.expires < b.entry.expires ? 1 : a.entry.expires > b.entry.expires ? -1 : 0) ||
        (a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0),
    )[0]!;
    return {
      ...finding,
      exception: { id: best.entry.id, state: best.state, expires: best.entry.expires },
    };
  });
  return { findings, records };
}
