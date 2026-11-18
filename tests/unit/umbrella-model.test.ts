import { describe, expect, it } from 'vitest';
import {
  ComponentUmbrellaSchema,
  EnvironmentComponentVersionsSchema,
  ProjectConfigSchema,
  UmbrellaChartSummarySchema,
  type ProjectConfig,
} from '@model/index';
import type { RawProjectData } from '../../collector/src/collectors/collect';
import type { EnvironmentState } from '../../collector/src/collectors/environment-states';
import type { BuildContext } from '../../collector/src/normalizers/model';
import { umbrellaModel } from '../../collector/src/normalizers/umbrella-model';
import { toComponents, toEnvironments } from '../../collector/src/normalizers/versions';
import { fail, ok, type FileDTO, type ProviderResult } from '../../collector/src/providers/types';
import { NOW, policies, repoData } from '../helpers/factories';

const PATH = 'charts/umbrella/Chart.yaml';

const chart = (deps: Record<string, string>, version = '1.5.0') =>
  ok<FileDTO>({
    text: [
      `version: ${version}`,
      'dependencies:',
      ...Object.entries(deps).flatMap(([name, v]) => [`  - name: ${name}`, `    version: ${v}`]),
    ].join('\n'),
  });

function config(versionSource = 'auto', withChart = true): ProjectConfig {
  return ProjectConfigSchema.parse({
    id: 'p',
    name: 'P',
    businessUnit: 'x',
    lifecycle: 'production',
    coordinator: {
      repository: 'example-org/coord',
      ...(withChart ? { umbrellaChart: { path: PATH } } : {}),
    },
    components: [
      {
        id: 'api',
        name: 'API',
        repository: 'example-org/api',
        type: 'service',
        versionSource,
      },
      { id: 'web', name: 'Web', repository: 'example-org/web', type: 'webapp' },
    ],
    environments: [
      {
        id: 'dev',
        name: 'Dev',
        deploySignal: { type: 'versions-file', repository: 'coordinator', path: 'x', key: 'k' },
      },
      {
        id: 'prod',
        name: 'Prod',
        deploySignal: { type: 'versions-file', repository: 'coordinator', path: 'x', key: 'k' },
      },
    ],
    securityControls: Object.fromEntries(
      [
        'codeScanning',
        'secretScanning',
        'dependabot',
        'containerScanning',
        'iacScanning',
        'dast',
        'sbom',
        'artifactSignature',
      ].map((c) => [c, { required: false }]),
    ),
  });
}

function build(
  cfg: ProjectConfig,
  umbrella: RawProjectData['umbrella'],
  envVersions: Record<string, string> = {},
  declared: Record<string, string> = { api: '0.9.0', web: '0.8.0' },
) {
  const states = new Map<string, EnvironmentState>(
    Object.entries(envVersions).map(([id, v]) => [
      id,
      { repository: 'example-org/coord', declared: ok(v) },
    ]),
  );
  const raw = {
    config: cfg,
    repos: [
      repoData('coord', { componentId: 'coordinator' }),
      repoData('api', { componentId: 'api' }),
      repoData('web', { componentId: 'web' }),
    ],
    manifest: fail({ classification: 'not-found' }),
    gitmodules: ok({ text: '' }),
    submodules: [],
    submoduleRefs: new Map(),
    pins: [],
    componentTags: new Map(),
    workflows: [],
    environmentStates: states,
    umbrella,
  } as unknown as RawProjectData;
  const ctx: BuildContext = { projectId: 'p', policies: policies(), now: NOW, errors: [] };
  const model = umbrellaModel(ctx, raw);
  const components = toComponents(
    ctx,
    raw,
    {
      schemaVersion: '1.0',
      version: '1.0.0',
      components: Object.fromEntries(Object.entries(declared).map(([k, v]) => [k, { version: v }])),
      environments: {},
    },
    [],
    model.components,
  );
  const environments = toEnvironments(
    cfg,
    null,
    null,
    new Map(),
    [],
    [],
    states,
    model.environments,
  );
  return { ctx, model, components, environments };
}

const read = (ref: string, file: ProviderResult<FileDTO>) => ({ ref, file });

describe('umbrellaModel', () => {
  it('publishes the chart on main, unmapped and aliases', () => {
    const { model } = build(config(), {
      main: chart({ api: '1.0.0', extra: '2.0.0' }),
      release: null,
      environments: new Map(),
    });
    expect(model.summary).toEqual({
      path: PATH,
      state: 'ok',
      chartVersion: '1.5.0',
      unmapped: ['extra'],
      aliases: [],
    });
  });

  it('uses the release chart as the auto version source and falls back to the pin when the component is not in it', () => {
    const { components } = build(config(), {
      main: chart({ api: '1.0.0', web: '3.0.0' }),
      release: read('v1.5.0', chart({ api: '1.2.0' })),
      environments: new Map(),
    });
    const api = components.find((c) => c.id === 'api')!;
    expect(api.effectiveVersion).toBe('1.2.0');
    expect(api.effectiveVersionSource).toBe('umbrella');
    expect(api.umbrella).toEqual({
      inUmbrella: true,
      main: '1.0.0',
      release: '1.2.0',
      conflict: false,
    });
    const web = components.find((c) => c.id === 'web')!;
    expect(web.effectiveVersion).toBe('0.8.0');
    expect(web.effectiveVersionSource).toBe('manifest');
    expect(web.umbrella).toEqual({
      inUmbrella: true,
      main: '3.0.0',
      release: null,
      conflict: false,
    });
  });

  it('versionSource umbrella stays unknown when the release read failed', () => {
    const { components } = build(config('umbrella'), {
      main: chart({ api: '1.0.0' }),
      release: read('v1.5.0', fail({ classification: 'not-found' })),
      environments: new Map(),
    });
    const api = components.find((c) => c.id === 'api')!;
    expect(api.effectiveVersion).toBeNull();
    expect(api.effectiveVersionSource).toBe('unknown');
  });

  it('falls through to the manifest when the release chart has a conflict', () => {
    const dup = ok<FileDTO>({
      text: 'version: 1.5.0\ndependencies:\n  - name: api\n    version: 1.1.0\n  - name: api\n    version: 1.2.0\n',
    });
    const { components } = build(config(), {
      main: chart({ api: '1.0.0' }),
      release: read('v1.5.0', dup),
      environments: new Map(),
    });
    const api = components.find((c) => c.id === 'api')!;
    expect(api.umbrella?.conflict).toBe(true);
    expect(api.effectiveVersion).toBe('0.9.0');
    expect(api.effectiveVersionSource).toBe('manifest');
  });

  it('records an invalid chart once as an umbrella-chart collection error', () => {
    const bad = ok<FileDTO>({ text: 'dependencies: [unclosed' });
    const { ctx, model } = build(config(), {
      main: bad,
      release: read('v1.5.0', bad),
      environments: new Map([['dev', read('v1.4.0', bad)]]),
    });
    expect(model.summary?.state).toBe('invalid');
    const errors = ctx.errors.filter((e) => e.source === 'umbrella-chart');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.classification).toBe('invalid-data');
  });

  it('bounds and scrubs chart content so the snapshot schemas accept it', () => {
    const deps = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`dep-${i}`, '1.0.0']));
    const long = 'x'.repeat(150);
    const text = [
      `version: ${long}`,
      'dependencies:',
      ...Object.entries({ ...deps, api: long }).flatMap(([n, v]) => [
        `  - name: ${n}`,
        `    version: ${v}`,
      ]),
    ].join('\n');
    const file = ok<FileDTO>({ text });
    const { model, components } = build(config(), {
      main: file,
      release: read('v1.5.0', file),
      environments: new Map([['dev', read('v1.4.0', file)]]),
    });
    expect(model.summary!.unmapped.length).toBeLessThanOrEqual(50);
    expect(() => UmbrellaChartSummarySchema.parse(model.summary)).not.toThrow();
    for (const u of model.components.values()) ComponentUmbrellaSchema.parse(u);
    for (const e of model.environments.values()) EnvironmentComponentVersionsSchema.parse(e);
    expect(components.find((c) => c.id === 'api')!.umbrella!.main!.length).toBeLessThanOrEqual(100);
  });

  it('fills environment component versions, conflict cells and skipped environments', () => {
    const dup = ok<FileDTO>({
      text: [
        'version: 1.4.0',
        'dependencies:',
        '  - name: api',
        '    version: 1.1.0',
        '  - name: api',
        '    version: 1.2.0',
        '  - name: web',
        '    version: 3.0.0',
      ].join('\n'),
    });
    const { environments } = build(
      config(),
      {
        main: chart({ api: '1.0.0' }),
        release: null,
        environments: new Map<string, ReturnType<typeof read> | 'skipped'>([
          ['dev', read('v1.4.0', dup)],
          ['prod', 'skipped'],
        ]),
      },
      { dev: '1.4.0', prod: '1.3.0' },
    );
    const dev = environments.find((e) => e.id === 'dev')!.componentVersions!;
    expect(dev.ref).toBe('v1.4.0');
    expect(dev.state).toBe('ok');
    expect(dev.versions.find((v) => v.componentId === 'api')?.conflict).toBe(true);
    expect(dev.versions.find((v) => v.componentId === 'web')).toEqual({
      componentId: 'web',
      version: '3.0.0',
      conflict: false,
    });
    expect(environments.find((e) => e.id === 'prod')!.componentVersions).toEqual({
      ref: 'v1.3.0',
      state: 'skipped',
      versions: [],
    });
  });

  it('reports a missing environment tag once as an umbrella-chart collection error', () => {
    const { ctx, environments } = build(
      config(),
      {
        main: chart({ api: '1.0.0' }),
        release: null,
        environments: new Map([
          ['dev', read('v1.4.0', fail({ classification: 'not-found' }))],
          ['prod', read('v1.3.0', fail({ classification: 'not-found' }))],
        ]),
      },
      { dev: '1.4.0', prod: '1.3.0' },
    );
    expect(ctx.errors.filter((e) => e.source === 'umbrella-chart')).toHaveLength(1);
    expect(environments.find((e) => e.id === 'dev')!.componentVersions).toEqual({
      ref: 'v1.4.0',
      state: 'not-found',
      versions: [],
    });
  });

  it('changes nothing without umbrellaChart', () => {
    const { model, components, environments } = build(config('auto', false), undefined);
    expect(model.summary).toBeNull();
    expect(components.every((c) => c.umbrella === null)).toBe(true);
    expect(environments.every((e) => e.componentVersions === null)).toBe(true);
  });
});
