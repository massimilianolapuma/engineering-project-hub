import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProjectSnapshotSchema, type ProjectSnapshot } from '@model/index';
import {
  compareVersionCards,
  componentIssues,
  plural,
  versionCard,
  versionsLead,
} from '../../src/lib/version-checks';

const load = (id: string): ProjectSnapshot =>
  ProjectSnapshotSchema.parse(
    JSON.parse(readFileSync(join('fixtures/snapshots/projects', `${id}.json`), 'utf8')),
  );
const beta = load('project-beta');
const alpha = load('project-alpha');
const gamma = load('project-gamma');
const platform = load('platform');

describe('versions view model', () => {
  it('lists only the problems of a project to check, with aligned components apart', () => {
    const card = versionCard(beta);
    expect(card.kind).toBe('check');
    expect(
      card.rows.map((r) => (r.kind === 'component' ? r.component.name : r.submodule.path)),
    ).toEqual(['API service', 'tools/legacy-scripts']);
    const api = card.rows[0]!;
    // Drift would repeat the mismatch (manifest already declares the latest release).
    expect(api.kind === 'component' && api.issues.map((i) => i.kind)).toEqual(['mismatch']);
    expect(card.rows[1]!.kind).toBe('unmapped');
    expect(card.aligned.map((c) => c.name)).toEqual(['Web console', 'Helm deployment']);
  });

  it('keeps drift next to a mismatch when the manifest does not declare the latest release', () => {
    const api = beta.components.find((c) => c.name === 'API service')!;
    expect(api.manifestConsistency).toBe('mismatch');
    expect(api.drift).toBe('drift');
    const newer = { ...api, latestRelease: { ...api.latestRelease!, tag: 'v3.3.0' } };
    expect(componentIssues(newer).map((i) => i.kind)).toEqual(['mismatch', 'drift']);
  });

  it('flags an untagged pin and a component behind its latest release', () => {
    const card = versionCard(alpha);
    expect(card.kind).toBe('check');
    expect(
      card.rows.map((r) => (r.kind === 'component' ? [r.component.name, r.issues[0]!.kind] : [])),
    ).toEqual([
      ['Frontend', 'drift'],
      ['Settlement worker', 'pin'],
    ]);
    expect(card.aligned.map((c) => c.name)).toEqual(['Backend API', 'Helm deployment']);
  });

  it('collapses a fully aligned project to a single line', () => {
    const card = versionCard(platform);
    expect(card.kind).toBe('aligned');
    expect(card.rows).toEqual([]);
    expect(card.aligned).toHaveLength(3);
    expect(card.sameEnvVersion).toBe('2026.10.1');
  });

  it('never shows an unreadable project as aligned', () => {
    expect(versionCard(gamma).kind).toBe('unknown');
  });

  it('counts the headline: environments behind, mismatches, unreadable projects', () => {
    expect(versionsLead([beta, alpha, gamma, platform])).toEqual({
      behind: 2,
      mismatch: 1,
      unknown: 1,
    });
  });

  it('orders cards worst first and never puts unknown after healthy ones', () => {
    const sorted = [platform, gamma, alpha, beta].sort(compareVersionCards);
    expect(sorted.map((s) => s.project.id)).toEqual([
      'project-beta',
      'project-alpha',
      'project-gamma',
      'platform',
    ]);
  });

  it('picks the singular or plural form', () => {
    const forms = { one: 'one item', other: '{n} items' };
    expect(plural(1, forms)).toBe('one item');
    expect(plural(3, forms)).toBe('3 items');
    expect(plural(0, forms)).toBe('0 items');
  });
});
