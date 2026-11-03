import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { CatalogSchema, PoliciesSchema, type Catalog, type ProjectConfig } from '@model/index';
import { loadCatalog } from '../../collector/src/config/load';
import { discover } from '../../collector/src/discovery/discover';
import { discoverTeams } from '../../collector/src/discovery/teams';
import { MockProvider } from '../../collector/src/providers/mock/mock-provider';
import { fail, type SourceProvider } from '../../collector/src/providers/types';
import { createLimiter } from '../../collector/src/util/concurrency';
import { fixedClock } from '../../collector/src/util/clock';

const policies = (audience: 'public' | 'restricted' = 'restricted') => {
  const p = PoliciesSchema.parse(parse(readFileSync('config/policies.yaml', 'utf8')));
  p.publication.audience = audience;
  return p;
};
const mock = () => new MockProvider('fixtures/github', fixedClock('2026-01-15T12:00:00.000Z'));
const ctx = (
  provider: SourceProvider = mock(),
  audience: 'public' | 'restricted' = 'restricted',
) => ({
  provider,
  limit: createLimiter(4),
  cache: new Map(),
  policies: policies(audience),
});

const NAMING = {
  pattern: '{line}-{project}-{role}',
  roles: ['dev', 'ops'],
  lines: { pay: 'Payments' },
};

/** The shipped demo catalog, with overrides. */
async function catalog(
  over: { teams?: object; discovery?: object; projects?: (ps: ProjectConfig[]) => unknown[] } = {},
): Promise<Catalog> {
  const base = await loadCatalog('config');
  return CatalogSchema.parse({
    discovery: { ...base.discovery, ...over.discovery },
    teams: { discovery: true, naming: NAMING, maxTeams: 300, ...over.teams },
    projects: over.projects ? over.projects(structuredClone(base.projects)) : base.projects,
  });
}

/** A catalog project "tools" on example-org/tools-cli, with no team access to it. */
const toolsProject = (gamma: ProjectConfig) => ({
  ...gamma,
  id: 'tools',
  name: 'Tools',
  teams: [],
  coordinator: { ...gamma.coordinator, repository: 'example-org/tools-cli' },
  components: [],
  trackedWorkflows: [],
  environments: [],
});
const withProject = (extra: (ps: ProjectConfig[]) => unknown) => (ps: ProjectConfig[]) => [
  ...ps,
  extra(ps),
];
const gammaOf = (ps: ProjectConfig[]) => ps.find((p) => p.id === 'project-gamma')!;

/** MockProvider with some calls replaced. */
function stub(over: Partial<SourceProvider>): SourceProvider {
  const m = mock();
  return new Proxy(m, {
    get: (t, k) => (k in over ? over[k as keyof SourceProvider] : Reflect.get(t, k, t)),
  }) as SourceProvider;
}

describe('team discovery', () => {
  it('returns null when teams.discovery is false and when the audience is public', async () => {
    const off = await catalog({ teams: { discovery: false } });
    expect((await discoverTeams(ctx(), off, policies(), null)).teams).toBeNull();
    const on = await catalog();
    expect(
      (await discoverTeams(ctx(mock(), 'public'), on, policies('public'), null)).teams,
    ).toBeNull();
  });

  it('suggests by access with write or higher only', async () => {
    const { teams } = await discoverTeams(ctx(), await catalog(), policies(), null);
    expect(teams!.status).toBe('ok');
    expect(teams!.suggestions.filter((s) => s.projectId === 'project-alpha')).toEqual([
      {
        projectId: 'project-alpha',
        team: 'example-org/pay-project-alpha-ops',
        reason: 'access',
        writeRepositories: 1,
        totalRepositories: 5,
      },
    ]);
    expect(teams!.suggestions.some((s) => s.team === 'example-org/readers')).toBe(false);
    expect(
      teams!.suggestions.some(
        (s) => s.projectId === 'project-alpha' && s.team === 'example-org/platform',
      ),
    ).toBe(false);
  });

  it('suggests by name when the slug names the project', async () => {
    const c = await catalog({ projects: withProject((ps) => toolsProject(gammaOf(ps))) });
    const { teams } = await discoverTeams(ctx(), c, policies(), null);
    expect(teams!.suggestions.filter((s) => s.projectId === 'tools')).toEqual([
      {
        projectId: 'tools',
        team: 'example-org/pay-tools-dev',
        reason: 'name',
        writeRepositories: 0,
        totalRepositories: 1,
      },
    ]);
  });

  it('skips secret teams and only counts them', async () => {
    const c = await catalog({
      projects: (ps) =>
        ps.map((p) =>
          p.id === 'project-gamma' ? { ...p, teams: ['example-org/secret-audit'] } : p,
        ),
    });
    const { teams } = await discoverTeams(ctx(), c, policies(), null);
    expect(teams!.secretSkipped).toBe(1);
    // teamsRead counts every listed team (the maxTeams bound), secret ones included.
    expect(teams!.teamsRead).toBe(7);
    const { notFound, ...rest } = teams!;
    expect(JSON.stringify(rest)).not.toContain('secret-audit');
    expect(notFound.some((n) => n.team === 'example-org/secret-audit')).toBe(false);
  });

  it('never stores a team description or name', async () => {
    const text = JSON.stringify(await discoverTeams(ctx(), await catalog(), policies(), null));
    expect(text).not.toContain('never kept');
    expect(text).not.toContain('Secret audit');
  });

  it('flags project teams missing from GitHub', async () => {
    const c = await catalog({
      projects: (ps) =>
        ps.map((p) => (p.id === 'project-gamma' ? { ...p, teams: ['example-org/gone-team'] } : p)),
    });
    const { teams } = await discoverTeams(ctx(), c, policies(), null);
    expect(teams!.notFound).toContainEqual({
      projectId: 'project-gamma',
      team: 'example-org/gone-team',
    });
    expect(teams!.notFound).toContainEqual({
      projectId: 'platform',
      team: 'example-org/security',
    });
    expect(teams!.notFound.some((n) => n.team === 'example-org/platform')).toBe(false);
  });

  it('works with discovery.enabled false: the orgs come from catalog repositories', async () => {
    const c = await catalog({ discovery: { enabled: false } });
    const { teams } = await discoverTeams(ctx(), c, policies(), null);
    expect(teams!.orgs).toEqual(['example-org']);
    expect(teams!.status).toBe('ok');
  });

  it('reports not-authorised without throwing', async () => {
    const p = stub({ listOrgTeams: async () => fail({ classification: 'not-authorised' }) });
    const { teams } = await discoverTeams(ctx(p), await catalog(), policies(), null);
    expect(teams).toMatchObject({ status: 'not-authorised', suggestions: [], notFound: [] });
    expect(teams!.errors).toContainEqual({
      target: 'example-org',
      classification: 'not-authorised',
    });
  });

  it('partial on limit: proposals kept, no notFound', async () => {
    const c = await catalog({
      teams: { maxTeams: 2 },
      projects: (ps) =>
        ps.map((p) => (p.id === 'project-gamma' ? { ...p, teams: ['example-org/gone-team'] } : p)),
    });
    const { teams } = await discoverTeams(ctx(), c, policies(), null);
    expect(teams).toMatchObject({ limitReached: true, status: 'partial', notFound: [] });
    expect(teams!.teamsRead).toBe(2);
    expect(teams!.suggestions.map((s) => s.team)).toEqual(['example-org/pay-project-alpha-ops']);
  });

  it('partial on a team failure: the team is in errors, the others still count', async () => {
    const m = mock();
    const p = stub({
      listTeamRepositories: async (org: string, slug: string) =>
        slug === 'pay-project-alpha-ops'
          ? fail({ classification: 'error' })
          : m.listTeamRepositories(org, slug),
    });
    const { teams } = await discoverTeams(ctx(p), await catalog(), policies(), null);
    expect(teams!.status).toBe('partial');
    expect(teams!.errors).toEqual([
      { target: 'example-org/pay-project-alpha-ops', classification: 'error' },
    ]);
    // Its access is unknown, but its name still points to the project.
    expect(
      teams!.suggestions.filter((s) => s.team === 'example-org/pay-project-alpha-ops'),
    ).toEqual([
      {
        projectId: 'project-alpha',
        team: 'example-org/pay-project-alpha-ops',
        reason: 'name',
        writeRepositories: 0,
        totalRepositories: 5,
      },
    ]);
  });

  it('fills teams on new-project proposals', async () => {
    const c = await catalog();
    const found = await discover(ctx(), c, policies());
    expect(found!.proposals.some((p) => p.project.id === 'tools')).toBe(true);
    const { discovery } = await discoverTeams(ctx(), c, policies(), found);
    const tools = discovery!.proposals.find((p) => p.project.id === 'tools')!;
    expect(tools.project.teams).toEqual(['example-org/pay-tools-dev']);
    expect(tools.project.businessUnit).toBe('Payments');
    // Proposals for projects already in the catalog are left alone.
    const alpha = discovery!.proposals.find((p) => p.projectId === 'project-alpha');
    if (alpha) expect(alpha.project.teams).toEqual([]);
  });
});
