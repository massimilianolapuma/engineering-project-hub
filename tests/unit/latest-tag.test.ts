import { describe, expect, it } from 'vitest';
import { orderTagCandidates } from '../../collector/src/util/latest-tag';

describe('orderTagCandidates', () => {
  it('puts semver tags first, highest first, then the others in GitHub order', () => {
    const names = ['nightly', 'v0.9.0', 'v0.12.2', '0.11.8', 'v0.12.2-rc.1', 'latest'];
    expect(orderTagCandidates(names.map((name) => ({ name }))).map((t) => t.name)).toEqual([
      'v0.12.2',
      'v0.12.2-rc.1',
      '0.11.8',
      'v0.9.0',
      'nightly',
      'latest',
    ]);
  });
});
