import { deflateRawSync } from 'node:zlib';
import { PoliciesSchema, type Policies, type WorkflowStatus } from '@model/index';
import { parse } from 'yaml';
import { readFileSync } from 'node:fs';
import type { RepoData } from '../../collector/src/collectors/collect';
import { fail, ok, type RepositoryDTO } from '../../collector/src/providers/types';

export const NOW = new Date('2026-01-15T12:00:00.000Z');
export const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
export const daysAgo = (d: number) => hoursAgo(d * 24);

export function loadPolicies(): Policies {
  return PoliciesSchema.parse(parse(readFileSync('config/policies.yaml', 'utf8')));
}

export function policies(overrides: (p: Policies) => void = () => {}): Policies {
  const p = loadPolicies();
  overrides(p);
  return p;
}

export function workflow(partial: Partial<WorkflowStatus> = {}): WorkflowStatus {
  return {
    workflowId: 'ci',
    name: 'CI',
    file: 'ci.yml',
    critical: true,
    componentId: 'backend',
    repository: 'example-org/backend',
    branch: 'main',
    state: 'success',
    stale: false,
    latestRun: null,
    lastCompletedRun: null,
    lastFailedRun: null,
    activeRun: null,
    lastError: null,
    ...partial,
  };
}

export function repoDto(
  name: string,
  visibility: RepositoryDTO['visibility'] = 'public',
): RepositoryDTO {
  return {
    owner: 'example-org',
    name,
    fullName: `example-org/${name}`,
    htmlUrl: `https://github.com/example-org/${name}`,
    visibility,
    defaultBranch: 'main',
    archived: false,
    updatedAt: hoursAgo(1),
    topics: [],
  };
}

export function repoData(name: string, partial: Partial<RepoData> = {}): RepoData {
  return {
    componentId: name,
    repository: `example-org/${name}`,
    configuredDefaultBranch: 'main',
    branch: 'main',
    repo: ok(repoDto(name)),
    head: ok({ sha: 'a'.repeat(40), htmlUrl: null, committedAt: hoursAgo(1) }),
    release: fail({ classification: 'not-found', httpStatus: 404 }),
    tag: null,
    securityStatusFile: fail({ classification: 'not-found', httpStatus: 404 }),
    codeScanning: ok([]),
    codeScanningAnalysis: ok({ createdAt: hoursAgo(2), toolName: 'CodeQL' }),
    dependabot: ok([]),
    secretScanning: ok([]),
    qualitySummary: fail({ classification: 'not-found', httpStatus: 404 }),
    codeQualityFindings: fail({ classification: 'not-found', httpStatus: 404 }),
    codeQualitySetup: fail({ classification: 'not-found', httpStatus: 404 }),
    ...partial,
  };
}

/** Builds a zip archive in memory (stored or deflated entries) for the zip reader tests. */
export function makeZip(entries: { name: string; data: string; method?: 0 | 8 }[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const method = e.method ?? 8;
    const raw = Buffer.from(e.data, 'utf8');
    const body = method === 8 ? deflateRawSync(raw) : raw;
    const name = Buffer.from(e.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, eocd]));
}
