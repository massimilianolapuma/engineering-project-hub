import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ChangesFileSchema,
  NotificationsConfigSchema,
  PortfolioIndexSchema,
  type ChangesFile,
} from '@model/index';
import { createHash } from 'node:crypto';
import { buildDigest, changeSetKey } from '../../notifier/src/digest';

/*
 * The digest (spec §5.5.3): only significant worsening, project ids and names, statuses,
 * scores and counts. Nothing else from changes.json is read.
 */
const read = (f: string) => JSON.parse(readFileSync(`fixtures/snapshots/${f}`, 'utf8')) as unknown;
const changes = (): ChangesFile => ChangesFileSchema.parse(read('changes.json'));
const index = () => PortfolioIndexSchema.parse(read('index.json'));
const config = (extra: Record<string, unknown> = {}) =>
  NotificationsConfigSchema.parse({ schemaVersion: '1.0', ...extra });

describe('buildDigest on the golden snapshots', () => {
  const digest = buildDigest(changes(), index(), config())!;

  it('lists the projects that worsened, worst first then by id', () => {
    expect(digest.projects.map((p) => p.id)).toEqual(['platform', 'project-beta']);
    expect(digest.omittedProjects).toBe(0);
  });

  it('counts the significant items', () => {
    expect(digest.totals).toEqual({
      projects: 2,
      overallWorsened: 2,
      becameUnknown: 0,
      newCritical: 1,
      newHigh: 0,
      newlyOverdue: 1,
      newErrors: 0,
      expiredExceptions: 1,
    });
  });

  it('keeps statuses, scores and counts per project', () => {
    const beta = digest.projects.find((p) => p.id === 'project-beta')!;
    expect(beta.name).toBe('Project Beta');
    expect(beta.overall).toEqual({ from: 'amber', to: 'red' });
    expect(beta.score).toEqual({ from: 58, to: 40 });
    expect(beta.dimensions).toEqual([
      { dimension: 'delivery', from: 'amber', to: 'red' },
      { dimension: 'security', from: 'amber', to: 'red' },
    ]);
    expect(beta.newFindings).toEqual({ critical: 1, high: 0 });
    expect(beta.newErrors).toBe(0);
    const platform = digest.projects.find((p) => p.id === 'platform')!;
    expect(platform.newlyOverdue).toEqual({ critical: 0, high: 1 });
    expect(platform.expiredExceptions).toBe(1);
    expect(platform.dimensions).toEqual([{ dimension: 'security', from: 'amber', to: 'red' }]);
  });

  it('ignores improvements and projects with nothing significant', () => {
    expect(digest.projects.some((p) => p.id === 'project-alpha')).toBe(false);
    expect(digest.projects.some((p) => p.id === 'project-gamma')).toBe(false);
  });

  it('never carries repository, alert, exception or link data', () => {
    const json = JSON.stringify(digest);
    for (const s of ['example-org', 'github.com', '#code-scanning#', 'EXC-', 'http'])
      expect(json).not.toContain(s);
  });
});

describe('change-set key', () => {
  it('sorts items by code unit, never by locale', () => {
    // localeCompare puts "a" before "B"; code-unit order puts "B" (0x42) first.
    const items: [string, string, string][] = [
      ['a', 'overall', 'amber>red'],
      ['B', 'overall', 'amber>red'],
    ];
    const expected = createHash('sha256')
      .update(
        JSON.stringify({ previous: '2026-01-14T12:00:00.000Z', items: [items[1], items[0]] }),
        'utf8',
      )
      .digest('hex')
      .slice(0, 16);
    expect(changeSetKey('2026-01-14T12:00:00.000Z', items)).toBe(expected);
  });

  it('is 16 hex characters, stable across generatedAt and sensitive to the basis', () => {
    const a = buildDigest(changes(), index(), config())!;
    expect(a.key).toMatch(/^[0-9a-f]{16}$/);
    const later = { ...changes(), generatedAt: '2026-01-15T18:00:00.000Z' };
    expect(buildDigest(later, index(), config())!.key).toBe(a.key);
    const other = changes();
    other.basis.previousCollectedAt = '2026-01-13T12:00:00.000Z';
    expect(buildDigest(other, index(), config())!.key).not.toBe(a.key);
  });
});

describe('triggers and edge cases', () => {
  it('returns null without a compared basis', () => {
    const c = changes();
    c.basis.state = 'none';
    expect(buildDigest(c, index(), config())).toBeNull();
  });

  it('counts new collection errors only when the trigger asks for them', () => {
    const d = buildDigest(changes(), index(), config({ trigger: { newErrors: { min: 1 } } }))!;
    expect(d.totals.newErrors).toBe(7);
    expect(d.projects.map((p) => p.id)).toEqual([
      'platform',
      'project-beta',
      'project-gamma',
      'project-alpha',
    ]);
  });

  it('reports a project that became unknown, never one that came back from unknown', () => {
    const c = changes();
    const alpha = c.projects.find((p) => p.id === 'project-alpha')!;
    alpha.statusChanges = [{ dimension: 'overall', from: 'amber', to: 'grey' }];
    alpha.current = { overall: 'grey', score: null };
    const gamma = c.projects.find((p) => p.id === 'project-gamma')!;
    gamma.statusChanges = [{ dimension: 'overall', from: 'grey', to: 'red' }];
    const d = buildDigest(c, index(), config())!;
    expect(d.totals.becameUnknown).toBe(1);
    expect(d.projects.find((p) => p.id === 'project-alpha')?.overall.to).toBe('grey');
    expect(d.projects.some((p) => p.id === 'project-gamma')).toBe(false);
  });

  it('caps the projects at digest.maxProjects and counts the rest', () => {
    const d = buildDigest(changes(), index(), config({ digest: { maxProjects: 1 } }))!;
    expect(d.projects).toHaveLength(1);
    expect(d.omittedProjects).toBe(1);
    expect(d.totals.projects).toBe(2);
  });
});
