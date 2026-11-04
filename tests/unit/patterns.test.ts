import { describe, expect, it } from 'vitest';
import { sensitiveEnvValues } from '../../shared/security/patterns';

describe('sensitiveEnvValues', () => {
  it('returns the external provider credentials (never logged, caught by the publication gate)', () => {
    const values = sensitiveEnvValues({
      SONARQUBE_TOKEN: 'sqa_123456789012',
      HARBOR_ROBOT_NAME: 'robot$hub+reader',
      HARBOR_ROBOT_SECRET: 'h4rb0r-s3cret-value',
      ARGOCD_TOKEN: 'eyJhbGciOiJIUzI1NiJ9.argo',
    });
    expect(values).toEqual(
      expect.arrayContaining([
        'sqa_123456789012',
        'robot$hub+reader',
        'h4rb0r-s3cret-value',
        'eyJhbGciOiJIUzI1NiJ9.argo',
      ]),
    );
  });

  it('returns the Teams webhook URL (its sig parameter is the credential)', () => {
    const url = 'https://a.environment.api.powerplatform.com/x?sig=abcdefgh';
    expect(sensitiveEnvValues({ TEAMS_WEBHOOK_URL: url })).toContain(url);
  });

  it('ignores short values and unrelated variables', () => {
    expect(
      sensitiveEnvValues({ SONARQUBE_TOKEN: 'short', PATH: '/usr/bin/some-long-path' }),
    ).toEqual([]);
  });
});
