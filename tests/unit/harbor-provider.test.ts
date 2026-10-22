import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProvidersFileSchema } from '@model/index';
import { createExternalClient } from '../../collector/src/providers/external/http';
import { createHarborProvider } from '../../collector/src/providers/external/harbor';
import { createMockExternalProviders } from '../../collector/src/providers/external/mock';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const REPORT = 'application/vnd.security.vulnerability.report; version=1.1';
const SCANNER_CANARY = `ghp_${'x'.repeat(36)}`;

function overview(status: string, summary?: Record<string, number>, extra = {}) {
  return {
    [REPORT]: {
      scan_status: status,
      end_time: '2026-01-14T10:00:00.000Z',
      scanner: { name: SCANNER_CANARY, vendor: 'v', version: '1' },
      summary: summary ? { total: 8, fixable: 3, summary } : undefined,
      ...extra,
    },
  };
}

function provider(artifact: unknown, status = 200) {
  const calls: { url: URL; headers: Headers }[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), headers: new Headers(init?.headers) });
    return Response.json(artifact, { status });
  }) as typeof fetch;
  const client = createExternalClient({
    id: 'harbor',
    baseUrl: 'https://harbor.example.com',
    timeoutSeconds: 20,
    authHeader: 'Basic x',
    fetch: fetcher,
  });
  return { harbor: createHarborProvider(client), calls };
}

describe('Harbor provider', () => {
  it('requests /api/v2.0/projects/alpha/repositories/team%252Fbackend/artifacts/1.4.0 with the three query flags and the X-Accept-Vulnerabilities header', async () => {
    const { harbor, calls } = provider({ digest: DIGEST });
    await harbor.getArtifact('alpha', 'team/backend', '1.4.0');
    const url = calls[0]!.url;
    expect(url.host).toBe('harbor.example.com');
    expect(url.pathname).toBe(
      '/api/v2.0/projects/alpha/repositories/team%252Fbackend/artifacts/1.4.0',
    );
    expect(url.searchParams.get('with_scan_overview')).toBe('true');
    expect(url.searchParams.get('with_accessory')).toBe('true');
    expect(url.searchParams.get('with_tag')).toBe('false');
    expect(calls[0]!.headers.get('x-accept-vulnerabilities')).toBe(
      'application/vnd.security.vulnerability.report; version=1.1, application/vnd.scanner.adapter.vuln.report.harbor+json; version=1.0',
    );
    expect(calls[0]!.headers.get('authorization')).toBe('Basic x');
  });

  it('maps Success with {Critical:0, High:0, Medium:2, Low:6}, fixable 3, total 8', async () => {
    const { harbor } = provider({
      digest: DIGEST,
      scan_overview: overview('Success', { Critical: 0, High: 0, Medium: 2, Low: 6 }),
    });
    expect(await harbor.getArtifact('a', 'r', 't')).toEqual({
      ok: true,
      data: {
        digest: DIGEST,
        scan: {
          status: 'success',
          endTime: '2026-01-14T10:00:00.000Z',
          critical: 0,
          high: 0,
          medium: 2,
          low: 6,
          unknown: 0,
          fixable: 3,
          total: 8,
        },
        signatures: { cosign: false, notation: false },
      },
    });
  });

  it('a severity Harbor omits is 0 on a successful scan', async () => {
    const { harbor } = provider({
      scan_overview: overview('Success', { High: 1 }),
    });
    expect(await harbor.getArtifact('a', 'r', 't')).toMatchObject({
      data: { scan: { critical: 0, high: 1, medium: 0, low: 0 } },
    });
  });

  it('Negligible 4 + Unknown 1 → unknown 5', async () => {
    const { harbor } = provider({
      scan_overview: overview('Success', { Negligible: 4, Unknown: 1, None: 0 }),
    });
    expect(await harbor.getArtifact('a', 'r', 't')).toMatchObject({
      data: { scan: { unknown: 5 } },
    });
  });

  it('Running → running, counts null; Pending/Scheduled → pending; Error → error', async () => {
    const running = await provider({ scan_overview: overview('Running') }).harbor.getArtifact(
      'a',
      'r',
      't',
    );
    expect(running).toMatchObject({
      data: {
        scan: {
          status: 'running',
          critical: null,
          high: null,
          medium: null,
          low: null,
          total: null,
        },
      },
    });
    for (const s of ['Pending', 'Scheduled'])
      expect(
        await provider({ scan_overview: overview(s) }).harbor.getArtifact('a', 'r', 't'),
      ).toMatchObject({ data: { scan: { status: 'pending', critical: null } } });
    expect(
      await provider({ scan_overview: overview('Error') }).harbor.getArtifact('a', 'r', 't'),
    ).toMatchObject({ data: { scan: { status: 'error', critical: null } } });
  });

  it('no overview → not-scanned, counts null', async () => {
    expect(await provider({ digest: DIGEST }).harbor.getArtifact('a', 'r', 't')).toMatchObject({
      data: { scan: { status: 'not-scanned', critical: null, total: null, endTime: null } },
    });
  });

  it('a digest that is not sha256 is null', async () => {
    expect(await provider({ digest: 'md5:zz' }).harbor.getArtifact('a', 'r', 't')).toMatchObject({
      data: { digest: null },
    });
  });

  it('accessories signature.cosign → cosign true, notation false', async () => {
    const { harbor } = provider({
      digest: DIGEST,
      accessories: [{ type: 'signature.cosign' }, { type: 'sbom.something' }],
    });
    expect(await harbor.getArtifact('a', 'r', 't')).toMatchObject({
      data: { signatures: { cosign: true, notation: false } },
    });
    const n = provider({ accessories: [{ type: 'signature.notation' }] });
    expect(await n.harbor.getArtifact('a', 'r', 't')).toMatchObject({
      data: { signatures: { cosign: false, notation: true } },
    });
  });

  it('404 → not-found; 401 → not-authorised', async () => {
    expect(await provider({}, 404).harbor.getArtifact('a', 'r', 't')).toMatchObject({
      ok: false,
      error: { classification: 'not-found' },
    });
    expect(await provider({}, 401).harbor.getArtifact('a', 'r', 't')).toMatchObject({
      ok: false,
      error: { classification: 'not-authorised' },
    });
  });

  it('the DTO never contains the scanner name, tags or labels', async () => {
    const { harbor } = provider({
      digest: DIGEST,
      tags: [{ name: 'secret-tag' }],
      labels: [{ name: 'secret-label' }],
      scan_overview: overview('Success', { Critical: 1 }),
    });
    const text = JSON.stringify(await harbor.getArtifact('a', 'r', 't'));
    expect(text).not.toContain(SCANNER_CANARY);
    expect(text).not.toContain('secret-tag');
    expect(text).not.toContain('secret-label');
  });

  it('a malformed body → invalid-data', async () => {
    expect(
      await provider({ scan_overview: 'nope' }).harbor.getArtifact('a', 'r', 't'),
    ).toMatchObject({
      ok: false,
      error: { classification: 'invalid-data' },
    });
  });
});

describe('mock Harbor provider', () => {
  it('reads fixtures/providers/harbor.json (raw API responses) keyed "<project>/<repository>:<reference>" through the same projection', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hub-mock-harbor-'));
    const raw = {
      digest: DIGEST,
      scan_overview: overview('Success', { Medium: 2, Low: 6 }),
      accessories: [{ type: 'signature.cosign' }],
    };
    await writeFile(join(dir, 'harbor.json'), JSON.stringify({ 'alpha/team/backend:1.4.0': raw }));
    const providers = ProvidersFileSchema.parse({
      schemaVersion: '1.0',
      harbor: { enabled: true, baseUrl: 'https://harbor.example.invalid' },
    });
    const { harbor } = createMockExternalProviders(dir, () => new Date(0), providers);
    const result = await harbor!.getArtifact('alpha', 'team/backend', '1.4.0');
    expect(result).toMatchObject({
      ok: true,
      data: {
        digest: DIGEST,
        scan: { status: 'success', medium: 2, low: 6 },
        signatures: { cosign: true },
      },
    });
    expect(JSON.stringify(result)).not.toContain(SCANNER_CANARY);
    expect(await harbor!.getArtifact('alpha', 'x', 'y')).toMatchObject({
      error: { classification: 'not-found' },
    });
  });
});
