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
    ...partial,
  };
}
