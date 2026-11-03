import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import {
  CatalogSchema,
  CatalogSettingsSchema,
  ProjectConfigSchema,
  TEAM_REF,
  TeamNamingSchema,
  parseTeamName,
  teamSlug,
  type TeamNaming,
} from '@model/index';
import { loadCatalog } from '../../collector/src/config/load';

const alpha = parse(readFileSync('config/projects/project-alpha.yaml', 'utf8')) as Record<
  string,
  unknown
>;
const project = (over: Record<string, unknown>) => ({ ...alpha, ...over });

const N: TeamNaming = {
  pattern: '{line}-{project}-{role}',
  roles: ['dev', 'ops'],
  lines: { pay: 'Payments' },
};

describe('teams on projects', () => {
  it('accepts org/slug refs and defaults to []', () => {
    const ok = ProjectConfigSchema.parse(project({ teams: ['example-org/pay-project-alpha-dev'] }));
    expect(ok.teams).toEqual(['example-org/pay-project-alpha-dev']);
    const { teams: _drop, ...rest } = alpha;
    expect(ProjectConfigSchema.parse(rest).teams).toEqual([]);
  });

  it('rejects upper-case slugs, refs without an org and duplicates', () => {
    expect(ProjectConfigSchema.safeParse(project({ teams: ['example-org/Pay'] })).success).toBe(
      false,
    );
    expect(ProjectConfigSchema.safeParse(project({ teams: ['pay-team'] })).success).toBe(false);
    const dup = ProjectConfigSchema.safeParse(
      project({ teams: ['example-org/platform', 'example-org/platform'] }),
    );
    expect(dup.success).toBe(false);
    const issue = dup.error!.issues.find((i) => i.message.includes('duplicate team'));
    expect(issue?.path).toEqual(['teams', 1]);
  });

  it('TEAM_REF matches org/slug only', () => {
    expect(TEAM_REF.test('example-org/platform')).toBe(true);
    expect(TEAM_REF.test('example-org/<img>')).toBe(false);
  });

  it('rejects the same slug in two orgs across the catalog', () => {
    const beta = parse(readFileSync('config/projects/project-beta.yaml', 'utf8')) as Record<
      string,
      unknown
    >;
    const r = CatalogSchema.safeParse({
      projects: [
        project({ teams: ['example-org/platform'] }),
        { ...beta, teams: ['other-org/platform'] },
      ],
    });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.message).join('\n')).toContain(
      'same team slug "platform" in example-org and other-org',
    );
  });

  it('teamSlug returns the part after the org', () => {
    expect(teamSlug('example-org/platform')).toBe('platform');
  });
});

describe('team naming rule', () => {
  it('accepts patterns with each placeholder once, dash-separated', () => {
    for (const pattern of ['{line}-{project}-{role}', '{role}-{line}-{project}']) {
      expect(TeamNamingSchema.safeParse({ ...N, pattern }).success).toBe(true);
    }
    for (const pattern of ['{line}-{project}', '{line}-{line}-{role}', '{line}_{project}_{role}']) {
      expect(TeamNamingSchema.safeParse({ ...N, pattern }).success).toBe(false);
    }
  });

  it('parses line, project and role', () => {
    expect(parseTeamName('pay-project-alpha-dev', N)).toEqual({
      line: 'pay',
      project: 'project-alpha',
      role: 'dev',
      businessUnit: 'Payments',
    });
  });

  it('parses with the role first', () => {
    expect(
      parseTeamName('dev-pay-project-alpha', { ...N, pattern: '{role}-{line}-{project}' }),
    ).toEqual({ line: 'pay', project: 'project-alpha', role: 'dev', businessUnit: 'Payments' });
  });

  it('returns null for names the rule does not fully match', () => {
    for (const slug of [
      'platform',
      'pay-dev',
      'xyz-project-alpha-dev',
      'pay-project-alpha-qa',
      'pay-x',
      'pay-dev-project-alpha',
    ]) {
      expect(parseTeamName(slug, N), slug).toBeNull();
    }
    expect(parseTeamName('pay-project-alpha-dev', undefined)).toBeNull();
  });
});

describe('catalog teams settings', () => {
  it('CatalogSettingsSchema accepts a teams block', () => {
    expect(
      CatalogSettingsSchema.safeParse({ teams: { discovery: true, naming: N, maxTeams: 10 } })
        .success,
    ).toBe(true);
    expect(CatalogSettingsSchema.safeParse({ teams: { maxTeams: 0 } }).success).toBe(false);
    expect(CatalogSettingsSchema.safeParse({ teams: { nope: 1 } }).success).toBe(false);
  });

  it('defaults to discovery off with maxTeams 300', () => {
    expect(CatalogSchema.parse({ projects: [] }).teams).toEqual({
      discovery: false,
      maxTeams: 300,
    });
  });

  it('the loader carries catalog.yaml teams into Catalog.teams', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eph-teams-'));
    await mkdir(join(dir, 'projects'));
    await cp('config/projects/project-beta.yaml', join(dir, 'projects/project-beta.yaml'));
    await writeFile(
      join(dir, 'catalog.yaml'),
      "teams:\n  discovery: true\n  naming:\n    pattern: '{line}-{project}-{role}'\n    roles: [dev]\n    lines: { pay: Payments }\n  maxTeams: 50\n",
    );
    const c = await loadCatalog(dir);
    expect(c.teams).toEqual({
      discovery: true,
      naming: { pattern: '{line}-{project}-{role}', roles: ['dev'], lines: { pay: 'Payments' } },
      maxTeams: 50,
    });
  });

  it('the shipped demo config has teams on alpha, beta and platform, none on gamma', async () => {
    const c = await loadCatalog('config');
    const byId = Object.fromEntries(c.projects.map((p) => [p.id, p.teams]));
    expect(byId['project-alpha']).toEqual([
      'example-org/pay-project-alpha-dev',
      'example-org/platform',
    ]);
    expect(byId['project-beta']).toEqual(['example-org/pay-project-beta-dev']);
    expect(byId['platform']).toEqual(['example-org/platform', 'example-org/security']);
    expect(byId['project-gamma']).toEqual([]);
    expect(c.teams.discovery).toBe(true);
  });
});
