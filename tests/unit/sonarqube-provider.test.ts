import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROVIDERS_OFF, ProvidersFileSchema } from '@model/index';
import { createExternalClient } from '../../collector/src/providers/external/http';
import { createMockExternalProviders } from '../../collector/src/providers/external/mock';
import { createSonarQubeProvider } from '../../collector/src/providers/external/sonarqube';

const SHA = 'ae4b58f791cf66bf510c92ca102cc34470fbdf7d';
type Measure = { metric: string; value?: string; period?: unknown; periods?: unknown };

function provider(opts: {
  measures?: Measure[];
  analyses?: unknown;
  measuresStatus?: number;
  analysesStatus?: number;
}) {
  const seen: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    seen.push(url.pathname + url.search);
    if (url.pathname.endsWith('/api/measures/component'))
      return Response.json(
        { component: { key: 'k', measures: opts.measures ?? [] } },
        { status: opts.measuresStatus ?? 200 },
      );
    if (url.pathname.endsWith('/api/project_analyses/search'))
      return Response.json(opts.analyses ?? { analyses: [] }, {
        status: opts.analysesStatus ?? 200,
      });
    return new Response('nope', { status: 404 });
  }) as typeof fetch;
  const client = createExternalClient({
    id: 'sonarqube',
    baseUrl: 'https://sonar.example.com',
    timeoutSeconds: 20,
    authHeader: 'Bearer t',
    fetch: fetcher,
  });
  return { sonar: createSonarQubeProvider(client), seen };
}
const full: Measure[] = [
  { metric: 'alert_status', value: 'OK' },
  { metric: 'lines_to_cover', value: '8000' },
  { metric: 'uncovered_lines', value: '1100' },
  { metric: 'new_coverage', period: { index: 1, value: '88.5' } },
];
const analysis = { analyses: [{ key: 'AX', date: '2026-01-14T10:00:00+0100', revision: SHA }] };

describe('SonarQube provider', () => {
  it('maps lines_to_cover 8000, uncovered_lines 1100, alert_status OK, new_coverage period value 88.5', async () => {
    const { sonar } = provider({ measures: full, analyses: analysis });
    expect(await sonar.getProject('proj')).toEqual({
      ok: true,
      data: {
        linesToCover: 8000,
        uncoveredLines: 1100,
        newCoverage: 88.5,
        qualityGate: 'OK',
        analysedAt: '2026-01-14T10:00:00+01:00',
        revision: SHA,
      },
    });
  });

  it('reads new_coverage from periods[0].value on older servers, and value first when present', async () => {
    const old = provider({
      measures: [
        { metric: 'new_coverage', periods: [{ index: 1, value: '41.2' }] },
        { metric: 'lines_to_cover', value: '3000' },
        { metric: 'uncovered_lines', value: '1050' },
        { metric: 'alert_status', value: 'ERROR' },
      ],
    });
    expect(await old.sonar.getProject('proj')).toMatchObject({
      ok: true,
      data: { newCoverage: 41.2, qualityGate: 'ERROR' },
    });
    const direct = provider({
      measures: [{ metric: 'new_coverage', value: '10', period: { value: '99' } }],
    });
    expect(await direct.sonar.getProject('proj')).toMatchObject({ data: { newCoverage: 10 } });
  });

  it('normalises "2026-01-14T10:00:00+0100" to "2026-01-14T10:00:00+01:00"', async () => {
    const { sonar } = provider({ measures: full, analyses: analysis });
    const r = await sonar.getProject('proj');
    expect(r.ok && r.data.analysedAt).toBe('2026-01-14T10:00:00+01:00');
    const z = provider({
      measures: full,
      analyses: { analyses: [{ date: '2026-01-14T10:00:00Z', revision: SHA }] },
    });
    const rz = await z.sonar.getProject('proj');
    expect(rz.ok && rz.data.analysedAt).toBe('2026-01-14T10:00:00Z');
  });

  it('an unparsable date or a revision that is not 40 hex becomes null', async () => {
    const { sonar } = provider({
      measures: full,
      analyses: { analyses: [{ date: 'yesterday', revision: 'abc' }] },
    });
    expect(await sonar.getProject('proj')).toMatchObject({
      ok: true,
      data: { analysedAt: null, revision: null },
    });
  });

  it('no analysis yet → analysedAt and revision null', async () => {
    const { sonar } = provider({ measures: full, analyses: { analyses: [] } });
    expect(await sonar.getProject('proj')).toMatchObject({
      ok: true,
      data: { analysedAt: null, revision: null },
    });
  });

  it('sends the key, the metric keys and branch when sonarBranch is set', async () => {
    const { sonar, seen } = provider({ measures: full, analyses: analysis });
    await sonar.getProject('org_proj:x', 'release/1.x');
    expect(seen).toHaveLength(2);
    const measures = new URL(`https://h${seen[0]}`);
    expect(measures.pathname).toBe('/api/measures/component');
    expect(measures.searchParams.get('component')).toBe('org_proj:x');
    expect(measures.searchParams.get('metricKeys')).toBe(
      'alert_status,lines_to_cover,uncovered_lines,new_coverage',
    );
    expect(measures.searchParams.get('branch')).toBe('release/1.x');
    const analyses = new URL(`https://h${seen[1]}`);
    expect(analyses.pathname).toBe('/api/project_analyses/search');
    expect(analyses.searchParams.get('project')).toBe('org_proj:x');
    expect(analyses.searchParams.get('ps')).toBe('1');
    expect(analyses.searchParams.get('branch')).toBe('release/1.x');
  });

  it('does not send branch without sonarBranch', async () => {
    const { sonar, seen } = provider({ measures: full, analyses: analysis });
    await sonar.getProject('proj');
    expect(seen.some((s) => s.includes('branch='))).toBe(false);
  });

  it('never requests /api/qualitygates/project_status (deprecated; the gate comes from alert_status)', async () => {
    const { sonar, seen } = provider({ measures: full, analyses: analysis });
    await sonar.getProject('proj');
    await sonar.getProject('proj', 'main');
    expect(seen.filter((s) => s.includes('qualitygates'))).toEqual([]);
    expect(
      seen.every((s) => s.startsWith('/api/measures/') || s.startsWith('/api/project_analyses/')),
    ).toBe(true);
  });

  it('missing metric → null, not 0; unknown alert_status → null', async () => {
    const { sonar } = provider({
      measures: [
        { metric: 'alert_status', value: 'WARN' },
        { metric: 'lines_to_cover', value: 'abc' },
      ],
    });
    expect(await sonar.getProject('proj')).toMatchObject({
      ok: true,
      data: { linesToCover: null, uncoveredLines: null, newCoverage: null, qualityGate: null },
    });
  });

  it('negative or fractional line counts and a coverage above 100 are null', async () => {
    const { sonar } = provider({
      measures: [
        { metric: 'lines_to_cover', value: '-5' },
        { metric: 'uncovered_lines', value: '1.5' },
        { metric: 'new_coverage', value: '140' },
      ],
    });
    expect(await sonar.getProject('proj')).toMatchObject({
      data: { linesToCover: null, uncoveredLines: null, newCoverage: null },
    });
  });

  it('404 → not-found, 403 → not-authorised (from either call), malformed body → invalid-data', async () => {
    expect(await provider({ measuresStatus: 404 }).sonar.getProject('p')).toMatchObject({
      ok: false,
      error: { classification: 'not-found' },
    });
    expect(
      await provider({ measures: full, analysesStatus: 403 }).sonar.getProject('p'),
    ).toMatchObject({ ok: false, error: { classification: 'not-authorised' } });
    const bad = createExternalClient({
      id: 'sonarqube',
      baseUrl: 'https://sonar.example.com',
      timeoutSeconds: 20,
      authHeader: 'Bearer t',
      fetch: (async () => Response.json({ component: { measures: 'nope' } })) as typeof fetch,
    });
    expect(await createSonarQubeProvider(bad).getProject('p')).toMatchObject({
      ok: false,
      error: { classification: 'invalid-data' },
    });
  });
});

describe('mock SonarQube provider', () => {
  const now = new Date('2026-01-15T12:00:00Z');
  async function mock(fixture: unknown, enabled = true) {
    const dir = await mkdtemp(join(tmpdir(), 'hub-mock-ext-'));
    if (fixture !== undefined)
      await writeFile(join(dir, 'sonarqube.json'), JSON.stringify(fixture));
    const providers = enabled
      ? ProvidersFileSchema.parse({
          schemaVersion: '1.0',
          sonarqube: { enabled: true, baseUrl: 'https://sonarqube.example.invalid' },
        })
      : PROVIDERS_OFF;
    return createMockExternalProviders(dir, () => now, providers).sonarqube;
  }

  it('reads fixtures/providers/sonarqube.json by key with @now tokens', async () => {
    const sonar = (await mock({
      'k:1': {
        linesToCover: 8000,
        uncoveredLines: 1100,
        newCoverage: 88.5,
        qualityGate: 'OK',
        analysedAt: '@now-1d',
        revision: null,
      },
    }))!;
    expect(await sonar.getProject('k:1')).toEqual({
      ok: true,
      data: {
        linesToCover: 8000,
        uncoveredLines: 1100,
        newCoverage: 88.5,
        qualityGate: 'OK',
        analysedAt: '2026-01-14T12:00:00.000Z',
        revision: null,
      },
    });
  });

  it('a missing key or a missing file → not-found; $error → that error; disabled → null', async () => {
    const sonar = (await mock({
      x: { $error: { classification: 'not-authorised', httpStatus: 403 } },
    }))!;
    expect(await sonar.getProject('absent')).toMatchObject({
      ok: false,
      error: { classification: 'not-found' },
    });
    expect(await sonar.getProject('x')).toMatchObject({
      ok: false,
      error: { classification: 'not-authorised' },
    });
    expect(await (await mock(undefined))!.getProject('x')).toMatchObject({
      ok: false,
      error: { classification: 'not-found' },
    });
    expect(await mock({}, false)).toBeNull();
  });
});
