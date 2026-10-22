import { deflateRawSync } from 'node:zlib';
import {
  PoliciesSchema,
  type HistoryEntry,
  type HistoryFile,
  type HistoryProjectPoint,
  type Policies,
  type ProjectSummary,
  type RemediationSummary,
  type WorkflowStatus,
} from '@model/index';
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

/** A measured, empty remediation summary (SLAs on, nothing overdue). */
export function remediationSummary(partial: Partial<RemediationSummary> = {}): RemediationSummary {
  return {
    enabled: true,
    slaDays: { critical: 7, high: 30, medium: 90, low: 180, secret: 7 },
    overdue: { critical: 0, high: 0, medium: 0, low: 0, secret: 0 },
    oldestOverdueSince: null,
    slaUnknown: 0,
    ...partial,
  };
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
    controls: null,
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

/** A green, fully measured project summary; override what a test cares about. */
export function projectSummary(partial: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: 'project-alpha',
    name: 'Project Alpha',
    businessUnit: 'Example Unit',
    lifecycle: 'production',
    overall: 'green',
    score: { value: 100, measured: 6, required: 6 },
    delivery: 'green',
    version: 'green',
    security: 'green',
    coverage: { status: 'green', percentage: 100, required: 4, available: 4 },
    governance: 'green',
    quality: { status: 'green', percentage: 90, measured: 4, applicable: 4 },
    repositoryControls: { passed: 6, failed: 0, unknown: 0, notApplicable: 0, ratio: 100 },
    freshness: 'green',
    openCounts: {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      informational: 0,
      unknown: 0,
    },
    risk: { overdue: 0, overdueCriticalHigh: 0, accepted: 0, exceptionIssues: 0 },
    countsComplete: true,
    openSecretAlerts: 0,
    secretScanning: 'enabled',
    failedCriticalWorkflows: 0,
    collectedAt: NOW.toISOString(),
    collectionErrorCount: 0,
    unresolvedSubmodules: 0,
    ...partial,
  };
}

export function historyPoint(partial: Partial<HistoryProjectPoint> = {}): HistoryProjectPoint {
  return {
    id: 'project-alpha',
    overall: 'green',
    score: 100,
    scoreMeasured: 6,
    scoreRequired: 6,
    dimensions: {
      delivery: 'green',
      version: 'green',
      security: 'green',
      coverage: 'green',
      governance: 'green',
      quality: 'green',
    },
    open: { critical: 0, high: 0, medium: 0, low: 0 },
    countsComplete: true,
    collectionErrors: 0,
    ...partial,
  };
}

export function historyEntry(
  collectedAt: string,
  partial: Partial<HistoryEntry> = {},
): HistoryEntry {
  return {
    collectedAt,
    dataSource: 'github',
    authenticationMode: 'github-token',
    collectorVersion: '0.7.0',
    projects: [historyPoint()],
    ...partial,
  };
}

/** A valid history file whose baseline (empty, for the listed projects) matches the last entry. */
export function historyFile(
  entries: HistoryEntry[] = [historyEntry(daysAgo(1))],
  partial: Partial<HistoryFile> = {},
): HistoryFile {
  const last = entries.at(-1)!;
  return {
    kind: 'hub-history',
    schemaVersion: '1.0',
    generatedAt: last.collectedAt,
    retention: { maxEntries: 120, maxAgeDays: 90 },
    restore: { state: 'none', previousEntries: 0 },
    entries,
    baseline: {
      collectedAt: last.collectedAt,
      projects: last.projects.map((p) => ({
        id: p.id,
        repositories: [],
        findings: [],
        unreadable: [],
        versions: [],
        errors: [],
      })),
    },
    ...partial,
  };
}
