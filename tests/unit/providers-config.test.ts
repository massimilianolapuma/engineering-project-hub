import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROVIDERS_OFF, ProvidersFileSchema, RunProvidersSchema } from '@model/index';
import { ConfigError, loadProviders } from '../../collector/src/config/load';

const file = (over: Record<string, unknown> = {}) => ({
  schemaVersion: '1.0',
  sonarqube: { enabled: true, baseUrl: 'https://sonar.example.com' },
  ...over,
});
const parses = (raw: unknown) => ProvidersFileSchema.safeParse(raw).success;
const withSonar = (sonarqube: Record<string, unknown>) => file({ sonarqube });

async function write(text: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'hub-providers-'));
  const path = join(dir, 'providers.yaml');
  await writeFile(path, text);
  return path;
}

describe('providers.yaml', () => {
  it('missing file → source none, all disabled', async () => {
    const loaded = await loadProviders(join(tmpdir(), 'hub-no-such-dir', 'providers.yaml'));
    expect(loaded.source).toBe('none');
    expect(loaded.file).toEqual(PROVIDERS_OFF);
    expect(Object.values(loaded.file).every((p) => typeof p !== 'object' || !p.enabled)).toBe(true);
  });

  it('a fixture or config file is parsed and reports its source', async () => {
    const path = await write(
      "schemaVersion: '1.0'\nharbor:\n  enabled: true\n  baseUrl: https://harbor.example.com\n",
    );
    const loaded = await loadProviders(path, { fixture: true });
    expect(loaded.source).toBe('fixture');
    expect(loaded.file.harbor.enabled).toBe(true);
    expect(loaded.file.sonarqube.enabled).toBe(false);
    expect((await loadProviders(path)).source).toBe('config');
  });

  it('an invalid file is a structural ConfigError', async () => {
    const path = await write("schemaVersion: '1.0'\nargocd:\n  enabled: true\n");
    await expect(loadProviders(path)).rejects.toBeInstanceOf(ConfigError);
  });

  it('defaults: everything off, timeout 20, maxItems 200', () => {
    const parsed = ProvidersFileSchema.parse({ schemaVersion: '1.0' });
    for (const id of ['sonarqube', 'harbor', 'argocd'] as const) {
      expect(parsed[id]).toMatchObject({ enabled: false, timeoutSeconds: 20, maxItems: 200 });
    }
  });

  it('enabled without baseUrl is rejected', () => {
    expect(parses(withSonar({ enabled: true }))).toBe(false);
    expect(parses(withSonar({ enabled: false }))).toBe(true);
  });

  it('baseUrl: https only, no credentials, query or dot segments', () => {
    const url = (baseUrl: string) => parses(withSonar({ enabled: true, baseUrl }));
    expect(url('http://sonar.example.com')).toBe(false);
    expect(url('https://user:pw@sonar.example.com')).toBe(false);
    expect(url('https://sonar.example.com/?q')).toBe(false);
    expect(url('https://sonar.example.com/#frag')).toBe(false);
    expect(url('https://sonar.example.com/sonar')).toBe(true);
    expect(url('https://sonar.example.com/a/../b')).toBe(false);
    expect(url('https://sonar.example.com/a b')).toBe(false);
    expect(url('not a url')).toBe(false);
  });

  it('timeoutSeconds 0 and 61 rejected; maxItems 1001 rejected', () => {
    const base = { enabled: true, baseUrl: 'https://sonar.example.com' };
    expect(parses(withSonar({ ...base, timeoutSeconds: 0 }))).toBe(false);
    expect(parses(withSonar({ ...base, timeoutSeconds: 61 }))).toBe(false);
    expect(parses(withSonar({ ...base, timeoutSeconds: 60 }))).toBe(true);
    expect(parses(withSonar({ ...base, maxItems: 1001 }))).toBe(false);
    expect(parses(withSonar({ ...base, maxItems: 1000 }))).toBe(true);
  });

  it('rejects unknown keys', () => {
    expect(parses(file({ jenkins: { enabled: false } }))).toBe(false);
  });
});

describe('run providers block', () => {
  const entry = { enabled: false, state: 'off', items: 0, errors: 0 };
  it('requires all three providers and is strict', () => {
    const all = { sonarqube: entry, harbor: entry, argocd: entry };
    expect(RunProvidersSchema.safeParse(all).success).toBe(true);
    expect(RunProvidersSchema.safeParse({ sonarqube: entry, harbor: entry }).success).toBe(false);
    expect(
      RunProvidersSchema.safeParse({ ...all, harbor: { ...entry, baseUrl: 'https://h' } }).success,
    ).toBe(false);
  });
});
