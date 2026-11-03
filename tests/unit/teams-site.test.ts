import { describe, expect, it } from 'vitest';
import type { TeamNaming } from '@model/index';
import { groupTeams } from '../../src/lib/teams';

const N: TeamNaming = {
  pattern: '{line}-{project}-{role}',
  roles: ['dev', 'ops'],
  lines: { pay: 'Payments', log: 'Logistics' },
};

describe('team grouping for the Portfolio filter', () => {
  it('groups named teams by business unit, cross teams last, slugs sorted, duplicates dropped', () => {
    const refs = [
      'example-org/security',
      'example-org/pay-project-beta-dev',
      'example-org/platform',
      'example-org/pay-project-alpha-dev',
      'example-org/log-project-x-ops',
      'example-org/platform',
    ];
    expect(groupTeams(refs, N)).toEqual([
      {
        businessUnit: 'Logistics',
        teams: [{ ref: 'example-org/log-project-x-ops', slug: 'log-project-x-ops' }],
      },
      {
        businessUnit: 'Payments',
        teams: [
          { ref: 'example-org/pay-project-alpha-dev', slug: 'pay-project-alpha-dev' },
          { ref: 'example-org/pay-project-beta-dev', slug: 'pay-project-beta-dev' },
        ],
      },
      {
        businessUnit: null,
        teams: [
          { ref: 'example-org/platform', slug: 'platform' },
          { ref: 'example-org/security', slug: 'security' },
        ],
      },
    ]);
  });

  it('without a naming rule every team is a cross team; no teams gives no groups', () => {
    expect(groupTeams(['example-org/pay-project-alpha-dev'], undefined)).toEqual([
      {
        businessUnit: null,
        teams: [{ ref: 'example-org/pay-project-alpha-dev', slug: 'pay-project-alpha-dev' }],
      },
    ]);
    expect(groupTeams([], N)).toEqual([]);
  });
});
