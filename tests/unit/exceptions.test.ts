import { describe, expect, it } from 'vitest';
import type { ExceptionEntry, SecurityFinding } from '@model/index';
import {
  applyExceptions,
  expiryInstant,
  orphanedExceptionIds,
  validateExceptions,
  type FindingKeys,
  type MatchableFinding,
  type SourceReadability,
} from '../../collector/src/policy/exceptions';
import { CANARIES } from '../helpers/canaries';
import { NOW, policies } from '../helpers/factories';

const REPO = 'example-org/platform-mono';
const CATALOG = new Set([REPO, 'example-org/project-beta-api']);

function entry(over: Partial<ExceptionEntry> = {}): ExceptionEntry {
  return {
    id: 'EXC-0001',
    repository: REPO,
    source: 'code-scanning',
    match: { alert: 5 },
    owner: 'team-platform',
    reason: 'Accepted for the demo only.',
    created: '2026-01-05',
    expires: '2026-02-04',
    ...over,
  };
}

const SOURCE_OF = {
  'code-scanning': 'github-code-scanning',
  dependabot: 'github-dependabot',
  'secret-scanning': 'github-secret-scanning',
} as const;

function finding(
  source: keyof typeof SOURCE_OF,
  alert: number,
  keys: Partial<FindingKeys> = {},
  over: Partial<SecurityFinding> = {},
  repository = REPO,
): MatchableFinding {
  return {
    finding: {
      id: `${repository}#${source}#${alert}`,
      projectId: 'platform',
      componentId: 'mono',
      repository,
      source: SOURCE_OF[source],
      category:
        source === 'dependabot' ? 'dependency' : source === 'secret-scanning' ? 'secret' : 'code',
      severity: 'high',
      originalSeverity: 'high',
      status: 'open',
      originalStatus: 'open',
      ruleId: null,
      title: null,
      detectedAt: '2026-01-01T12:00:00.000Z',
      updatedAt: null,
      fixAvailable: null,
      htmlUrl: null,
      tool: null,
      repositoryPrivate: false,
      dataClassification: 'public',
      ...over,
    },
    keys: { alert, ruleId: null, tool: null, advisoryIds: [], ...keys },
  };
}

const READABLE: SourceReadability = new Map();
const unreadable = (...keys: string[]): SourceReadability =>
  new Map(keys.map((k) => [k, 'unreadable' as const]));

function run(
  exceptions: ExceptionEntry[],
  findings: MatchableFinding[],
  opts: {
    readability?: SourceReadability;
    now?: Date;
    publicDetail?: boolean;
    audience?: 'public' | 'restricted';
    hosts?: string[];
  } = {},
) {
  return applyExceptions({
    findings,
    exceptions,
    readability: opts.readability ?? READABLE,
    publicDetail: () => opts.publicDetail ?? true,
    policies: policies((p) => {
      if (opts.audience) p.publication.audience = opts.audience;
      if (opts.hosts) p.publication.allowedLinkHosts = opts.hosts;
    }),
    now: opts.now ?? NOW,
  });
}

describe('validateExceptions', () => {
  const validate = (entries: ExceptionEntry[], hosts?: string[]) =>
    validateExceptions(
      { schemaVersion: '1.0', exceptions: entries },
      policies((p) => {
        if (hosts) p.publication.allowedLinkHosts = hosts;
      }),
      CATALOG,
      NOW,
    );

  it('created 2026-01-01 → expires 2026-06-30 (180 d) has no issue; → 2026-07-01 (181 d) is an error "exceeds exceptions.maxDays (180)"', () => {
    const ok = validate([entry({ created: '2026-01-01', expires: '2026-06-30' })]);
    expect(ok.filter((i) => i.level === 'error')).toEqual([]);
    const bad = validate([entry({ created: '2026-01-01', expires: '2026-07-01' })]);
    const err = bad.find((i) => i.level === 'error');
    expect(err?.message).toContain('exceeds exceptions.maxDays (180)');
    expect(err?.path).toBe('exceptions[0] (EXC-0001)');
  });

  it('ticket host must be in publication.allowedLinkHosts', () => {
    const e = entry({ ticket: 'https://jira.example.com/browse/SEC-1' });
    expect(validate([e], ['github.com']).some((i) => i.level === 'error')).toBe(true);
    expect(
      validate([e], ['github.com', 'jira.example.com']).filter((i) => i.level === 'error'),
    ).toEqual([]);
  });

  it('repository example-org/legacy-tool not in the catalog → warning containing "orphaned"', () => {
    const issues = validate([entry({ repository: 'example-org/legacy-tool' })]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ level: 'warning' });
    expect(issues[0]!.message).toContain('orphaned');
  });

  it('expired, expiring soon and not-yet-soon', () => {
    const msgs = (expires: string) => validate([entry({ expires })]).map((i) => i.message);
    expect(msgs('2026-01-14').join('|')).toContain('expired');
    expect(msgs('2026-01-28').join('|')).toContain('expires in 13 days');
    expect(msgs('2026-01-29')).toEqual([]);
  });

  it('created 2026-01-16 → warning "created in the future"', () => {
    const issues = validate([entry({ created: '2026-01-16' })]);
    expect(issues.map((i) => i.message).join('|')).toContain('created in the future');
    expect(issues.every((i) => i.level === 'warning')).toBe(true);
  });
});

describe('exception states', () => {
  it('expiryInstant("2026-01-14") is 2026-01-15T00:00:00.000Z', () => {
    expect(expiryInstant('2026-01-14').toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });

  it('active at 2026-01-14T23:59:59.999Z and expired at 2026-01-15T00:00:00.000Z', () => {
    const e = entry({ expires: '2026-01-14' });
    const f = [finding('code-scanning', 5)];
    const before = run([e], f, { now: new Date('2026-01-14T23:59:59.999Z') });
    expect(before.records[0]!.state).toBe('active');
    expect(before.findings[0]!.exception).toEqual({
      id: 'EXC-0001',
      state: 'active',
      expires: '2026-01-14',
    });
    const after = run([e], f, { now: new Date('2026-01-15T00:00:00.000Z') });
    expect(after.records[0]!.state).toBe('expired');
    expect(after.findings[0]!.exception).toEqual({
      id: 'EXC-0001',
      state: 'expired',
      expires: '2026-01-14',
    });
  });

  it('expired wins over unverifiable', () => {
    const r = run([entry({ expires: '2026-01-14' })], [], {
      readability: unreadable(`${REPO}|code-scanning`),
    });
    expect(r.records[0]!.state).toBe('expired');
  });

  it('dependabot unreadable (403) → unverifiable, matched null, the finding keeps exception null', () => {
    const r = run(
      [entry({ source: 'dependabot', match: { alert: 4 } })],
      [finding('code-scanning', 4)],
      {
        readability: unreadable(`${REPO}|dependabot`),
      },
    );
    expect(r.records[0]).toMatchObject({ state: 'unverifiable', matched: null });
    expect(r.findings[0]!.exception).toBeNull();
  });

  it('secret-scanning not-configured → stale, matched 0', () => {
    // A not-configured source reads as empty: it is "readable" in the readability map.
    const r = run([entry({ source: 'secret-scanning', match: { alert: 2 } })], []);
    expect(r.records[0]).toMatchObject({ state: 'stale', matched: 0 });
  });

  it('alert 5 when alert 5 is fixed → stale', () => {
    const r = run([entry()], [finding('code-scanning', 5, {}, { status: 'fixed' })]);
    expect(r.records[0]).toMatchObject({ state: 'stale', matched: 0 });
    expect(r.findings[0]!.exception).toBeNull();
  });

  it('rule js/path-injection matches code-scanning #5 (any tool); with tool "Semgrep" it does not match a CodeQL alert', () => {
    const f = [finding('code-scanning', 5, { ruleId: 'js/path-injection', tool: 'CodeQL' })];
    const any = run([entry({ match: { rule: 'js/path-injection' } })], f);
    expect(any.records[0]).toMatchObject({ state: 'active', matched: 1 });
    const semgrep = run([entry({ match: { rule: 'js/path-injection', tool: 'Semgrep' } })], f);
    expect(semgrep.records[0]).toMatchObject({ state: 'stale', matched: 0 });
    const codeql = run([entry({ match: { rule: 'js/path-injection', tool: 'codeql' } })], f);
    expect(codeql.records[0]).toMatchObject({ state: 'active', matched: 1 });
  });

  it('advisory ghsa-demo-0004-mono (lower case) matches GHSA-demo-0004-mono', () => {
    const f = [finding('dependabot', 9, { advisoryIds: ['GHSA-demo-0004-mono', 'CVE-2025-1111'] })];
    const r = run([entry({ source: 'dependabot', match: { advisory: 'ghsa-demo-0004-mono' } })], f);
    expect(r.records[0]).toMatchObject({ state: 'active', matched: 1 });
  });
});

describe('precedence and counts', () => {
  const four = () => [finding('code-scanning', 4, { ruleId: 'js/path-injection' })];

  it('alert exception and rule exception both active on #4 → finding.exception.id is the alert one; both matched 1', () => {
    const r = run(
      [
        entry({ id: 'EXC-RULE', match: { rule: 'js/path-injection' }, expires: '2026-03-01' }),
        entry({ id: 'EXC-ALERT', match: { alert: 4 } }),
      ],
      four(),
    );
    expect(r.findings[0]!.exception!.id).toBe('EXC-ALERT');
    expect(r.records.map((x) => [x.id, x.matched])).toEqual([
      ['EXC-ALERT', 1],
      ['EXC-RULE', 1],
    ]);
  });

  it('expired alert exception + active rule exception → finding carries the active rule one', () => {
    const r = run(
      [
        entry({ id: 'EXC-ALERT', match: { alert: 4 }, expires: '2026-01-14' }),
        entry({ id: 'EXC-RULE', match: { rule: 'js/path-injection' } }),
      ],
      four(),
    );
    expect(r.findings[0]!.exception).toMatchObject({ id: 'EXC-RULE', state: 'active' });
  });

  it('two active rule exceptions with expires 2026-02-01 and 2026-03-01 → the 2026-03-01 one', () => {
    const r = run(
      [
        entry({ id: 'EXC-A', match: { rule: 'js/path-injection' }, expires: '2026-02-01' }),
        entry({
          id: 'EXC-B',
          match: { rule: 'js/path-injection', tool: 'CodeQL' },
          expires: '2026-03-01',
        }),
      ],
      [finding('code-scanning', 4, { ruleId: 'js/path-injection', tool: 'CodeQL' })],
    );
    expect(r.findings[0]!.exception!.id).toBe('EXC-B');
  });

  it('records sorted by state (expired, unverifiable, stale, active) then id; findingIds sorted', () => {
    const r = run(
      [
        entry({ id: 'EXC-D', match: { alert: 4 } }),
        entry({ id: 'EXC-C', match: { alert: 99 } }),
        entry({ id: 'EXC-B', match: { alert: 5 }, source: 'secret-scanning' }),
        entry({ id: 'EXC-A', match: { alert: 6 }, expires: '2026-01-01' }),
      ],
      [finding('code-scanning', 4)],
      { readability: unreadable(`${REPO}|secret-scanning`) },
    );
    expect(r.records.map((x) => [x.id, x.state])).toEqual([
      ['EXC-A', 'expired'],
      ['EXC-B', 'unverifiable'],
      ['EXC-C', 'stale'],
      ['EXC-D', 'active'],
    ]);
    expect(r.records[3]!.findingIds).toEqual([`${REPO}#code-scanning#4`]);
  });
});

describe('flags and publication', () => {
  it('expiringSoon: expires 2026-01-28 true, 2026-01-29 false (expiringSoonDays 14)', () => {
    const f = [finding('code-scanning', 5)];
    expect(run([entry({ expires: '2026-01-28' })], f).records[0]!.expiringSoon).toBe(true);
    expect(run([entry({ expires: '2026-01-29' })], f).records[0]!.expiringSoon).toBe(false);
  });

  it('private repo + audience public → selector.value null, reason null; alert selector value "15" kept; audience restricted → both kept', () => {
    const rule = entry({ match: { rule: 'py/flask-debug', tool: 'CodeQL' } });
    const f = [finding('code-scanning', 7, { ruleId: 'py/flask-debug', tool: 'CodeQL' })];
    const hidden = run([rule], f, { publicDetail: false }).records[0]!;
    expect(hidden.selector).toEqual({ kind: 'rule', value: null, tool: 'CodeQL' });
    expect(hidden.reason).toBeNull();
    const alert = run([entry({ match: { alert: 15 } })], [finding('code-scanning', 15)], {
      publicDetail: false,
    }).records[0]!;
    expect(alert.selector).toEqual({ kind: 'alert', value: '15', tool: null });
    const shown = run([rule], f, { publicDetail: true, audience: 'restricted' }).records[0]!;
    expect(shown.selector.value).toBe('py/flask-debug');
    expect(shown.reason).toBe('Accepted for the demo only.');
  });

  it('reason containing a CANARIES value is scrubbed (record.reason does not contain it)', () => {
    for (const canary of CANARIES) {
      const r = run([entry({ reason: `Accepted until the fix lands ${canary} please` })], []);
      expect(r.records[0]!.reason ?? '').not.toContain(canary);
    }
  });

  it('ticket on github.com → ticketUrl kept; owner "@example-org/team-beta" kept', () => {
    const r = run(
      [
        entry({
          ticket: 'https://github.com/example-org/platform-mono/issues/31?x=1',
          owner: '@example-org/team-beta',
        }),
      ],
      [],
    );
    expect(r.records[0]!.ticketUrl).toBe('https://github.com/example-org/platform-mono/issues/31');
    expect(r.records[0]!.owner).toBe('@example-org/team-beta');
    const off = run([entry({ ticket: 'https://jira.example.com/browse/SEC-1' })], []);
    expect(off.records[0]!.ticketUrl).toBeNull();
  });

  it('findings that match nothing keep exception null', () => {
    const r = run([entry()], [finding('code-scanning', 8)]);
    expect(r.findings[0]!.exception).toBeNull();
  });

  it('orphanedExceptionIds returns ["EXC-LEGACY-001"] for a repository outside the catalog', () => {
    expect(
      orphanedExceptionIds(
        [entry(), entry({ id: 'EXC-LEGACY-001', repository: 'example-org/legacy-tool' })],
        CATALOG,
      ),
    ).toEqual(['EXC-LEGACY-001']);
  });
});
