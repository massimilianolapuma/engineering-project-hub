import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  DeploymentsBridgeMapSchema,
  LedgerPayloadSchema,
  LedgerRecordSchema,
  ProjectConfigSchema,
  ledgerKey,
} from '@model/index';

/*
 * Deployments ledger contracts (spec 2026-11-04-deployments-ledger §5.1, §5.3, §5.5).
 */
const payload = {
  ledger: 1,
  source: 'azure-devops',
  runId: '12345',
  runUrl: 'https://dev.azure.com/example-org/example-project/_build/results?buildId=12345',
  attempt: 1,
  version: '0.5.2',
  startedAt: '2026-11-04T09:12:00Z',
  finishedAt: '2026-11-04T09:20:31Z',
  declared: false,
  kind: 'deploy',
};
const record = {
  repository: 'example-org/example-service',
  environment: 'prod',
  sha: 'a'.repeat(40),
  production: true,
  state: 'success',
  description: 'ADO run 12345',
  payload,
};

describe('ledger payload and record', () => {
  it('parses the spec example', () => {
    expect(LedgerPayloadSchema.parse(payload)).toMatchObject({
      source: 'azure-devops',
      attempt: 1,
    });
    expect(LedgerRecordSchema.parse(record).payload.kind).toBe('deploy');
  });

  it('requires finishedAt on a record (the real deploy time, D10)', () => {
    const { finishedAt: _, ...noFinish } = payload;
    expect(LedgerRecordSchema.safeParse({ ...record, payload: noFinish }).success).toBe(false);
  });

  it('keys a deploy by source, run, attempt and environment', () => {
    expect(
      ledgerKey({
        environment: 'prod',
        payload: { source: 'azure-devops', runId: '12345', attempt: 1 },
      }),
    ).toBe('azure-devops:12345:1:prod');
  });
});

describe('bridge map', () => {
  const map = {
    schemaVersion: '1.0',
    sources: [
      {
        type: 'azure-devops',
        organization: 'example-org',
        project: 'example-project',
        environments: [
          {
            ado: 'prod',
            repository: 'example-org/example-service',
            github: 'prod',
            versionFrom: { file: 'environments/prod.yaml', key: 'umbrella' },
          },
        ],
      },
    ],
  };

  it('parses the spec example with defaults', () => {
    const m = DeploymentsBridgeMapSchema.parse(map);
    expect(m.sources[0]!.environments[0]).toMatchObject({ production: false, commitFrom: 'self' });
  });

  it.each([
    ['a repository without owner', { repository: 'nope' }],
    ['an absolute versionFrom file', { versionFrom: { file: '/etc/x', key: 'k' } }],
  ])('rejects %s', (_, extra) => {
    const bad = structuredClone(map);
    Object.assign(bad.sources[0]!.environments[0]!, extra);
    expect(DeploymentsBridgeMapSchema.safeParse(bad).success).toBe(false);
  });
});

describe('catalog github-deployments signal', () => {
  const base = () =>
    parse(readFileSync('config/projects/project-alpha.yaml', 'utf8')) as Record<string, unknown>;
  const env = (deploySignal: unknown) => ({
    environments: [{ id: 'prod', name: 'PROD', deploySignal }],
  });

  it('accepts a signal with sources and defaults the tag prefix', () => {
    const p = ProjectConfigSchema.parse({
      ...base(),
      ...env({ type: 'github-deployments', repository: 'coordinator', sources: ['azure-devops'] }),
    });
    expect(p.environments[0]!.deploySignal).toEqual({
      type: 'github-deployments',
      repository: 'coordinator',
      sources: ['azure-devops'],
      tagPrefix: 'v',
    });
  });

  it('rejects an unknown component as repository', () => {
    const r = ProjectConfigSchema.safeParse({
      ...base(),
      ...env({ type: 'github-deployments', repository: 'nope' }),
    });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain('unknown component');
  });
});
