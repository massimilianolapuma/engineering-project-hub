import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { NotificationsConfigSchema } from '@model/index';

/*
 * config/notifications.yaml (spec §5.5.1, v0.15.0: Microsoft Teams only). Never published.
 * Strict at every level: Jira and Azure DevOps keys come in a later release.
 */
const demo = () =>
  parse(readFileSync('config/notifications.yaml', 'utf8')) as Record<string, unknown>;

describe('NotificationsConfigSchema', () => {
  it('the demo file is dry-run with Teams off and the documented defaults', () => {
    expect(NotificationsConfigSchema.parse(demo())).toEqual({
      schemaVersion: '1.0',
      mode: 'dry-run',
      locale: 'en',
      siteUrl: null,
      trigger: {
        overallWorsened: true,
        becameUnknown: true,
        dimensionsWorsened: ['security', 'delivery'],
        newFindings: { severities: ['critical'], min: 1 },
        newlyOverdue: { severities: ['critical', 'high'], min: 1 },
        newErrors: { min: 0 },
        expiredExceptions: { min: 1 },
      },
      digest: { maxProjects: 10 },
      targets: {
        teams: { enabled: false, allowedHostSuffixes: ['environment.api.powerplatform.com'] },
      },
    });
  });

  it('fills the defaults from a minimal file', () => {
    const c = NotificationsConfigSchema.parse({ schemaVersion: '1.0' });
    expect(c.mode).toBe('dry-run');
    expect(c.targets.teams.enabled).toBe(false);
    expect(c.digest.maxProjects).toBe(10);
  });

  it.each([
    ['plain http siteUrl', { siteUrl: 'http://hub.example.com/' }],
    ['siteUrl with a query', { siteUrl: 'https://hub.example.com/?a=1' }],
    ['siteUrl with a fragment', { siteUrl: 'https://hub.example.com/#x' }],
    ['siteUrl without the trailing slash', { siteUrl: 'https://hub.example.com/hub' }],
    ['too many projects', { digest: { maxProjects: 51 } }],
    ['a Jira target (later release)', { targets: { jira: {} } }],
    ['a suffix with a leading dot', { targets: { teams: { allowedHostSuffixes: ['.x.com'] } } }],
    ['an unknown mode', { mode: 'loud' }],
    ['an unknown key', { channel: 'x' }],
  ])('rejects %s', (_, extra) => {
    expect(NotificationsConfigSchema.safeParse({ ...demo(), ...extra }).success).toBe(false);
  });

  it('accepts an https siteUrl ending with a slash', () => {
    const c = NotificationsConfigSchema.parse({ ...demo(), siteUrl: 'https://hub.example.com/' });
    expect(c.siteUrl).toBe('https://hub.example.com/');
  });
});

describe('validate-config with notifications.yaml', () => {
  const run = (dir: string) =>
    spawnSync('npx', ['tsx', 'scripts/validate-config.ts', dir], { encoding: 'utf8' });

  it('validates the demo file', () => {
    const r = run('config');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('notifications.yaml: dry-run · teams off');
  });

  it('works without the file and fails on an invalid one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eph-notify-cfg-'));
    try {
      cpSync('config', dir, { recursive: true });
      rmSync(join(dir, 'notifications.yaml'));
      expect(run(dir).status).toBe(0);
      writeFileSync(join(dir, 'notifications.yaml'), "schemaVersion: '1.0'\nmode: loud\n");
      const bad = run(dir);
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain('notifications.yaml');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
