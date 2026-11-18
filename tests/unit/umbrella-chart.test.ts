import { describe, expect, it } from 'vitest';
import type { ProjectConfig } from '@model/index';
import {
  mapChartToComponents,
  parseUmbrellaChart,
} from '../../collector/src/normalizers/umbrella-chart';

function config(
  components: { id: string; repository: string; chartDependency?: string }[],
): ProjectConfig {
  return { components } as unknown as ProjectConfig;
}

const dep = (name: string, version: string | null, alias: string | null = null) => ({
  name,
  alias,
  version,
});

describe('parseUmbrellaChart', () => {
  it('parses version and dependencies, normalising v-prefixed versions', () => {
    const text = `
version: 0.11.8
dependencies:
  - name: p-api
    version: v0.15.0
  - name: p-api
    alias: p-api-services
    version: 0.15.0
`;
    expect(parseUmbrellaChart(text)).toEqual({
      version: '0.11.8',
      dependencies: [dep('p-api', '0.15.0'), dep('p-api', '0.15.0', 'p-api-services')],
    });
  });

  it('keeps a range as text', () => {
    expect(
      parseUmbrellaChart('version: 1.0.0\ndependencies:\n  - name: a\n    version: ~1.2\n')
        ?.dependencies[0]?.version,
    ).toBe('~1.2');
    expect(parseUmbrellaChart('version: ~1.2')?.version).toBe('~1.2');
  });

  it('returns null for invalid charts', () => {
    expect(parseUmbrellaChart('::')).toBeNull();
    expect(parseUmbrellaChart('dependencies: {}')).toBeNull();
    expect(parseUmbrellaChart('dependencies:\n  - version: 1.0.0\n')).toBeNull();
    expect(parseUmbrellaChart('# ' + 'x'.repeat(70 * 1024))).toBeNull();
  });

  it('accepts a chart without dependencies', () => {
    expect(parseUmbrellaChart('version: 1.0.0')).toEqual({ version: '1.0.0', dependencies: [] });
  });
});

describe('mapChartToComponents', () => {
  it('maps by repository name, then id, with zero configuration', () => {
    const cfg = config([
      { id: 'api', repository: 'o/p-api' },
      { id: 'web', repository: 'o/other' },
    ]);
    const m = mapChartToComponents(cfg, {
      version: '1.0.0',
      dependencies: [dep('p-api', '0.15.0'), dep('web', '2.0.0'), dep('extra', '1.0.0')],
    });
    expect(m.byComponent.get('api')).toEqual({ version: '0.15.0', conflict: false });
    expect(m.byComponent.get('web')).toEqual({ version: '2.0.0', conflict: false });
    expect(m.unmapped).toEqual(['extra']);
    expect(m.aliases).toEqual([]);
  });

  it('counts lockstep aliases once and flags diverging ones as a conflict', () => {
    const cfg = config([{ id: 'api', repository: 'o/p-api' }]);
    const same = mapChartToComponents(cfg, {
      version: null,
      dependencies: [dep('p-api', '0.15.0'), dep('p-api', '0.15.0', 'p-api-services')],
    });
    expect(same.byComponent.get('api')).toEqual({ version: '0.15.0', conflict: false });
    const diff = mapChartToComponents(cfg, {
      version: null,
      dependencies: [dep('p-api', '0.15.0'), dep('p-api', '0.16.0', 'p-api-services')],
    });
    expect(diff.byComponent.get('api')).toEqual({ version: null, conflict: true });
  });

  it('chartDependency on an alias maps only that entry and lists the other as an alias', () => {
    const cfg = config([{ id: 'api', repository: 'o/p-api', chartDependency: 'p-api-services' }]);
    const m = mapChartToComponents(cfg, {
      version: null,
      dependencies: [dep('p-api', '0.14.0'), dep('p-api', '0.16.0', 'p-api-services')],
    });
    expect(m.byComponent.get('api')).toEqual({ version: '0.16.0', conflict: false });
    expect(m.aliases).toEqual(['p-api']);
    expect(m.unmapped).toEqual([]);
  });

  it('does not map monorepo components by the shared repository name', () => {
    const cfg = config([
      { id: 'a', repository: 'o/mono' },
      { id: 'b', repository: 'o/mono' },
    ]);
    const m = mapChartToComponents(cfg, { version: null, dependencies: [dep('mono', '1.0.0')] });
    expect(m.byComponent.size).toBe(0);
    expect(m.unmapped).toEqual(['mono']);
  });
});
