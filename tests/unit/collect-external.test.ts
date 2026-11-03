import { describe, expect, it } from 'vitest';
import { ProvidersFileSchema } from '@model/index';
import { collectExternal } from '../../collector/src/collectors/collect-external';
import type { RawProjectData } from '../../collector/src/collectors/collect';
import type {
  ExternalProviders,
  SonarProjectDTO,
} from '../../collector/src/providers/external/types';
import { ok } from '../../collector/src/providers/types';

const raw = (id: string, sonarProjectKey: string, sonarBranch?: string) =>
  ({
    config: {
      id,
      coordinator: { sonarProjectKey, ...(sonarBranch ? { sonarBranch } : {}) },
      components: [],
      environments: [],
    },
  }) as unknown as RawProjectData;

describe('collectExternal: SonarQube', () => {
  it('M-7: the same project key on two branches is read once per branch, never reused', async () => {
    const calls: string[] = [];
    const external = {
      sonarqube: {
        getProject: async (key: string, branch?: string) => {
          calls.push(`${key}@${branch ?? ''}`);
          return ok({ branch: branch ?? null } as unknown as SonarProjectDTO);
        },
      },
    } as unknown as ExternalProviders;
    const raws = [raw('one', 'shared-key', 'main'), raw('two', 'shared-key', 'release')];
    await collectExternal(
      external,
      ProvidersFileSchema.parse({ schemaVersion: '1.0' }),
      raws,
      new Map(),
      new Map(),
    );
    expect(calls.sort()).toEqual(['shared-key@main', 'shared-key@release']);
    const branchOf = (r: RawProjectData) =>
      (r.sonar?.get('shared-key') as unknown as { ok: true; data: { branch: string } }).data.branch;
    expect(branchOf(raws[0]!)).toBe('main');
    expect(branchOf(raws[1]!)).toBe('release');
  });
});
