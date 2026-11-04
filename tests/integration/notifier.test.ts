import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse, stringify } from 'yaml';
import { runNotifier } from '../../notifier/src/run';

/*
 * The notifier run (spec §5.5.6) on the golden snapshots: dry-run by default, never a request on
 * mock data, one POST per change set in send mode, the secret never written anywhere.
 */
const SECRET = 's3cr3tvalue-teams-sig';
const WEBHOOK = `https://abc.environment.api.powerplatform.com/powerautomate/x?sig=${SECRET}`;
let dir: string;
const p = (...parts: string[]) => join(dir, ...parts);
const now = () => new Date('2026-11-04T10:00:00.000Z');
const ok = () => vi.fn(async () => new Response(null, { status: 202 }));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'eph-notify-'));
  cpSync('fixtures/snapshots', p('snap'), { recursive: true });
  cpSync('config', p('config'), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Real, compared, non-synthetic data and Teams enabled in send mode. */
function makeReal() {
  const index = JSON.parse(readFileSync(p('snap', 'index.json'), 'utf8'));
  index.run.dataSource = 'github';
  writeFileSync(p('snap', 'index.json'), JSON.stringify(index));
  const changes = JSON.parse(readFileSync(p('snap', 'changes.json'), 'utf8'));
  changes.basis.synthetic = false;
  writeFileSync(p('snap', 'changes.json'), JSON.stringify(changes));
  const cfg = parse(readFileSync(p('config', 'notifications.yaml'), 'utf8'));
  cfg.mode = 'send';
  cfg.targets.teams.enabled = true;
  writeFileSync(p('config', 'notifications.yaml'), stringify(cfg));
}
const sendEnv = (extra: Record<string, string> = {}) => ({
  HUB_NOTIFICATIONS: 'send',
  DATA_SOURCE: 'github',
  TEAMS_WEBHOOK_URL: WEBHOOK,
  ...extra,
});
const run = (env: NodeJS.ProcessEnv, fetch = ok()) =>
  runNotifier({
    snapshots: p('snap'),
    config: p('config'),
    out: p('out'),
    ledger: p('ledger', 'ledger.json'),
    env,
    fetch,
    now,
  });
const outText = () =>
  readdirSync(p('out'))
    .map((f) => readFileSync(p('out', f), 'utf8'))
    .join('\n');

describe('dry-run on the golden snapshots', () => {
  it('writes the digest, the Teams payload and the summary, and sends nothing', async () => {
    const fetch = ok();
    const r = await run({}, fetch);
    expect(r.exitCode).toBe(0);
    expect(readdirSync(p('out')).sort()).toEqual(['digest.json', 'summary.md', 'teams.json']);
    expect(r.summary).toContain('| Mode | dry-run (mode-config) |');
    expect(r.summary).toMatch(/\| Change set \| [0-9a-f]{16} \|/);
    expect(r.summary).toContain('| Teams | dry-run |');
    expect(fetch).not.toHaveBeenCalled();
    const teams = JSON.parse(readFileSync(p('out', 'teams.json'), 'utf8'));
    expect(teams.method).toBe('POST');
    expect(JSON.stringify(teams)).not.toContain('powerplatform');
    expect(outText()).not.toContain('example-org/');
  });

  it('says "not configured" without notifications.yaml', async () => {
    rmSync(p('config', 'notifications.yaml'));
    const r = await run({});
    expect(r.exitCode).toBe(0);
    expect(r.summary).toContain('not configured');
  });
});

describe('send mode', () => {
  it('tells the workflow to upload the ledger only when this run saved a new one', async () => {
    makeReal();
    const out1 = p('gh-output-1');
    writeFileSync(out1, '');
    await run(sendEnv({ GITHUB_OUTPUT: out1 }));
    expect(readFileSync(out1, 'utf8')).toContain('ledger=saved');

    const out2 = p('gh-output-2');
    writeFileSync(out2, '');
    const dup = await run(sendEnv({ GITHUB_OUTPUT: out2 }));
    expect(dup.summary).toContain('skipped-duplicate');
    expect(readFileSync(out2, 'utf8')).not.toContain('ledger=saved');

    // An unparsable ledger blocks this run but is never re-published.
    writeFileSync(p('ledger', 'ledger.json'), '{"kind":"something-else"}');
    const out3 = p('gh-output-3');
    writeFileSync(out3, '');
    const bad = await run(sendEnv({ GITHUB_OUTPUT: out3 }));
    expect(bad.exitCode).toBe(1);
    expect(readFileSync(out3, 'utf8')).not.toContain('ledger=saved');
  });

  it('posts once per change set and records it in the ledger', async () => {
    makeReal();
    const fetch = ok();
    const first = await run(sendEnv(), fetch);
    expect(first.exitCode).toBe(0);
    expect(first.summary).toContain('| Teams | sent |');
    expect(fetch).toHaveBeenCalledTimes(1);
    const ledger = JSON.parse(readFileSync(p('ledger', 'ledger.json'), 'utf8'));
    expect(ledger.entries).toHaveLength(1);
    expect(JSON.stringify(ledger)).not.toContain(SECRET);

    const again = ok();
    const second = await run(sendEnv(), again);
    expect(second.summary).toContain('| Teams | skipped-duplicate |');
    expect(again).not.toHaveBeenCalled();
    expect(outText() + first.summary + second.summary).not.toContain(SECRET);
  });

  it('sends nothing when the ledger could not be restored', async () => {
    makeReal();
    const fetch = ok();
    const r = await run(sendEnv({ HUB_LEDGER_STATE: 'failed' }), fetch);
    expect(r.exitCode).toBe(1);
    expect(r.summary).toContain('ledger unavailable: not sending to avoid duplicates');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports a missing webhook secret as not-configured', async () => {
    makeReal();
    const r = await run(sendEnv({ TEAMS_WEBHOOK_URL: '' }));
    expect(r.exitCode).toBe(1);
    expect(r.summary).toContain('| Teams | not-configured |');
  });

  it('refuses a webhook on another host without a request', async () => {
    makeReal();
    const fetch = ok();
    const r = await run(
      sendEnv({ TEAMS_WEBHOOK_URL: 'https://evil.example.com/x?sig=abcdefgh' }),
      fetch,
    );
    expect(r.exitCode).toBe(1);
    expect(r.summary).toContain('| Teams | refused |');
    expect(r.summary).not.toContain('evil.example.com');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never writes or sends a payload that contains a secret', async () => {
    makeReal();
    const index = JSON.parse(readFileSync(p('snap', 'index.json'), 'utf8'));
    index.projects.find((x: { id: string }) => x.id === 'project-beta').name = WEBHOOK.slice(0, 99);
    writeFileSync(p('snap', 'index.json'), JSON.stringify(index));
    const fetch = ok();
    const r = await run(sendEnv({ TEAMS_WEBHOOK_URL: WEBHOOK.slice(0, 99) }), fetch);
    expect(r.exitCode).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(r.summary).toContain('environment-credential');
    expect(r.summary + outText()).not.toContain(SECRET.slice(0, 10));
  });
});
