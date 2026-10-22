import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProvidersFileSchema } from '@model/index';
import { createExternalClient } from '../../collector/src/providers/external/http';
import { createArgoCdProvider } from '../../collector/src/providers/external/argocd';
import { createMockExternalProviders } from '../../collector/src/providers/external/mock';

const SHA = 'ae4b58f791cf66bf510c92ca102cc34470fbdf7d'.slice(0, 40);

function provider(app: unknown, status = 200) {
  const seen: URL[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    seen.push(new URL(String(input)));
    return Response.json(app, { status });
  }) as typeof fetch;
  const client = createExternalClient({
    id: 'argocd',
    baseUrl: 'https://argocd.example.com',
    timeoutSeconds: 20,
    authHeader: 'Bearer t',
    fetch: fetcher,
  });
  return { argo: createArgoCdProvider(client), seen };
}

const base = {
  spec: {
    source: { repoURL: 'https://git.internal.example/canary-6c1d.git', targetRevision: 'v1.4.0' },
  },
  status: {
    sync: { status: 'OutOfSync', revision: SHA },
    health: { status: 'Progressing' },
    summary: { images: ['registry.example.com/alpha/backend:1.4.0'] },
    operationState: { finishedAt: '2026-01-14T09:00:00Z' },
  },
};

describe('Argo CD provider', () => {
  it('GET /api/v1/applications/alpha-dev?appNamespace=argocd&project=alpha', async () => {
    const { argo, seen } = provider(base);
    await argo.getApplication({ name: 'alpha-dev', namespace: 'argocd', project: 'alpha' });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.pathname).toBe('/api/v1/applications/alpha-dev');
    expect(seen[0]!.searchParams.get('appNamespace')).toBe('argocd');
    expect(seen[0]!.searchParams.get('project')).toBe('alpha');
  });

  it('never sends a refresh query parameter', async () => {
    const { argo, seen } = provider(base);
    await argo.getApplication({ name: 'a' });
    await argo.getApplication({ name: 'a', namespace: 'n', project: 'p' });
    expect(seen.every((u) => !u.search.includes('refresh'))).toBe(true);
    expect(seen[0]!.search).toBe('');
  });

  it('maps OutOfSync/Progressing', async () => {
    const { argo } = provider(base);
    expect(await argo.getApplication({ name: 'a' })).toEqual({
      ok: true,
      data: {
        sync: 'out-of-sync',
        health: 'progressing',
        revision: SHA,
        targetRevision: 'v1.4.0',
        images: ['registry.example.com/alpha/backend:1.4.0'],
        deployedAt: '2026-01-14T09:00:00Z',
      },
    });
  });

  it('maps Synced/Healthy, Degraded, Suspended, Missing; anything else → unknown', async () => {
    const get = async (sync: string, health: string) => {
      const r = await provider({
        status: { sync: { status: sync }, health: { status: health } },
      }).argo.getApplication({ name: 'a' });
      return r.ok ? [r.data.sync, r.data.health] : null;
    };
    expect(await get('Synced', 'Healthy')).toEqual(['synced', 'healthy']);
    expect(await get('Unknown', 'Degraded')).toEqual(['unknown', 'degraded']);
    expect(await get('Whatever', 'Suspended')).toEqual(['unknown', 'suspended']);
    expect(await get('synced', 'Missing')).toEqual(['unknown', 'missing']);
    expect(await get('Synced', 'Weird')).toEqual(['synced', 'unknown']);
  });

  it('absent status → null sync and health', async () => {
    expect(await provider({}).argo.getApplication({ name: 'a' })).toMatchObject({
      ok: true,
      data: {
        sync: null,
        health: null,
        revision: null,
        targetRevision: null,
        images: [],
        deployedAt: null,
      },
    });
  });

  it('targetRevision from spec.sources[0] when spec.source is absent', async () => {
    const { argo } = provider({ spec: { sources: [{ targetRevision: 'release/1.x' }] } });
    expect(await argo.getApplication({ name: 'a' })).toMatchObject({
      data: { targetRevision: 'release/1.x' },
    });
  });

  it('deployedAt falls back to the last history entry', async () => {
    const { argo } = provider({
      status: {
        history: [{ deployedAt: '2026-01-01T00:00:00Z' }, { deployedAt: '2026-01-10T00:00:00Z' }],
      },
    });
    expect(await argo.getApplication({ name: 'a' })).toMatchObject({
      data: { deployedAt: '2026-01-10T00:00:00Z' },
    });
  });

  it('repoURL "https://git.internal.example/canary-6c1d.git" is not in the DTO', async () => {
    const { argo } = provider({
      ...base,
      spec: { ...base.spec, destination: { server: 'https://kube.internal.example' } },
      status: { ...base.status, resources: [{ name: 'secret-resource' }] },
    });
    const text = JSON.stringify(await argo.getApplication({ name: 'a' }));
    expect(text).not.toContain('canary-6c1d');
    expect(text).not.toContain('kube.internal');
    expect(text).not.toContain('secret-resource');
  });

  it('limits images to 50 strings of at most 300 characters', async () => {
    const images = Array.from({ length: 60 }, (_, i) => `img/${i}:1`);
    images.push('x'.repeat(301));
    const { argo } = provider({ status: { summary: { images } } });
    const r = await argo.getApplication({ name: 'a' });
    expect(r.ok && r.data.images).toHaveLength(50);
    const long = provider({ status: { summary: { images: ['x'.repeat(301), 'ok:1'] } } });
    const rl = await long.argo.getApplication({ name: 'a' });
    expect(rl.ok && rl.data.images).toEqual(['ok:1']);
  });

  it('403 → not-authorised; 404 → not-found', async () => {
    expect(await provider({}, 403).argo.getApplication({ name: 'a' })).toMatchObject({
      ok: false,
      error: { classification: 'not-authorised' },
    });
    expect(await provider({}, 404).argo.getApplication({ name: 'a' })).toMatchObject({
      error: { classification: 'not-found' },
    });
  });
});

describe('mock Argo CD provider', () => {
  it('reads fixtures/providers/argocd.json (raw API responses) keyed "<namespace|->/<name>" through the same projection', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hub-mock-argo-'));
    await writeFile(join(dir, 'argocd.json'), JSON.stringify({ 'argocd/a': base, '-/b': base }));
    const providers = ProvidersFileSchema.parse({
      schemaVersion: '1.0',
      argocd: { enabled: true, baseUrl: 'https://argocd.example.invalid' },
    });
    const { argocd } = createMockExternalProviders(dir, () => new Date(0), providers);
    const a = await argocd!.getApplication({ name: 'a', namespace: 'argocd' });
    expect(a).toMatchObject({ ok: true, data: { sync: 'out-of-sync', targetRevision: 'v1.4.0' } });
    expect(JSON.stringify(a)).not.toContain('canary-6c1d');
    expect(await argocd!.getApplication({ name: 'b' })).toMatchObject({ ok: true });
    expect(await argocd!.getApplication({ name: 'c' })).toMatchObject({
      error: { classification: 'not-found' },
    });
  });
});
