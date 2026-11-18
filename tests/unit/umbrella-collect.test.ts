import { describe, expect, it } from 'vitest';
import { collectUmbrellaCharts } from '../../collector/src/collectors/umbrella-chart';
import type { CollectContext, RawProjectData } from '../../collector/src/collectors/collect';
import type { EnvironmentState } from '../../collector/src/collectors/environment-states';
import { fail, ok, type SourceProvider } from '../../collector/src/providers/types';

const PATH = 'charts/umbrella/Chart.yaml';

function setup(opts: {
  versions: Record<string, string | null>;
  umbrella?: { path: string; tagPrefix: string } | null;
  release?: string | null;
  tag?: string | null;
}) {
  const calls: Array<[string, string, string | undefined]> = [];
  const provider = {
    getFile: async (repo: string, path: string, ref?: string) => {
      calls.push([repo, path, ref]);
      return ok({ text: `chart@${ref ?? 'main'}` });
    },
  } as unknown as SourceProvider;
  const ctx = {
    provider,
    limit: <T>(t: () => Promise<T>) => t(),
    cache: new Map(),
  } as unknown as CollectContext;
  const environments = Object.keys(opts.versions).map((id) => ({
    id,
    name: id,
    deploySignal: { type: 'versions-file', repository: 'coordinator', path: 'x', key: 'k' },
  }));
  const states = new Map<string, EnvironmentState>(
    Object.entries(opts.versions).map(([id, v]) => [
      id,
      { repository: 'example-org/coord', declared: ok(v) },
    ]),
  );
  const umbrella =
    opts.umbrella === null ? undefined : (opts.umbrella ?? { path: PATH, tagPrefix: 'v' });
  const raw = {
    config: {
      id: 'p',
      coordinator: {
        repository: 'example-org/coord',
        defaultBranch: 'main',
        umbrellaChart: umbrella,
      },
      components: [],
      environments,
    },
    repos: [
      {
        repository: 'example-org/coord',
        repo: ok({}),
        release: opts.release
          ? ok({ tagName: opts.release })
          : fail({ classification: 'not-found' }),
        tag: opts.tag ? ok({ name: opts.tag }) : null,
      },
    ],
    manifest: fail({ classification: 'not-found' }),
    environmentStates: states,
  } as unknown as RawProjectData;
  return { ctx, raw, calls };
}

describe('collectUmbrellaCharts', () => {
  it('reads main, the release tag and one tag per distinct environment version', async () => {
    const { ctx, raw, calls } = setup({
      versions: { dev: '1.4.0', test: '1.4.0', prod: '1.3.0', lab: null },
      release: 'v1.4.0',
    });
    await collectUmbrellaCharts(ctx, [raw]);
    expect(calls.map(([, p, r]) => [p, r])).toEqual([
      [PATH, undefined],
      [PATH, 'v1.4.0'],
      [PATH, 'v1.3.0'],
    ]);
    const u = raw.umbrella!;
    expect(u.release?.ref).toBe('v1.4.0');
    expect(u.environments.get('dev')).toBe(u.environments.get('test'));
    expect(u.environments.get('prod')).toMatchObject({ ref: 'v1.3.0' });
    expect(u.environments.has('lab')).toBe(false);
  });

  it('uses the tag fallback when there is no release, and skips the release read when neither', async () => {
    const a = setup({ versions: {}, tag: 'v2.0.0' });
    await collectUmbrellaCharts(a.ctx, [a.raw]);
    expect(a.raw.umbrella!.release?.ref).toBe('v2.0.0');
    const b = setup({ versions: {} });
    await collectUmbrellaCharts(b.ctx, [b.raw]);
    expect(b.raw.umbrella!.release).toBeNull();
    expect(b.calls).toHaveLength(1);
  });

  it('reads at most 10 environment tags, newest first, the rest skipped', async () => {
    const versions = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`e${i}`, `1.${i}.0`]),
    );
    const { ctx, raw, calls } = setup({ versions });
    await collectUmbrellaCharts(ctx, [raw]);
    const tags = calls.slice(1).map(([, , r]) => r);
    expect(tags).toHaveLength(10);
    expect(tags[0]).toBe('v1.11.0');
    expect(tags[9]).toBe('v1.2.0');
    const envs = raw.umbrella!.environments;
    expect(envs.get('e0')).toBe('skipped');
    expect(envs.get('e1')).toBe('skipped');
    expect(envs.get('e11')).toMatchObject({ ref: 'v1.11.0' });
  });

  it('builds the tag from tagPrefix and keeps prereleases', async () => {
    const { ctx, raw, calls } = setup({
      versions: { dev: '1.5.0-rc.1' },
      umbrella: { path: PATH, tagPrefix: 'release-' },
    });
    await collectUmbrellaCharts(ctx, [raw]);
    expect(calls[1]![2]).toBe('release-1.5.0-rc.1');
  });

  it('does nothing without umbrellaChart', async () => {
    const { ctx, raw, calls } = setup({ versions: { dev: '1.0.0' }, umbrella: null });
    await collectUmbrellaCharts(ctx, [raw]);
    expect(calls).toHaveLength(0);
    expect(raw.umbrella).toBeUndefined();
  });
});
