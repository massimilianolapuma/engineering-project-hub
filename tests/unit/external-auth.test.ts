import { describe, expect, it } from 'vitest';
import { PROVIDERS_OFF, ProvidersFileSchema } from '@model/index';
import {
  ProviderAuthError,
  resolveProviderAuth,
} from '../../collector/src/providers/external/auth';

const enable = (...ids: ('sonarqube' | 'harbor' | 'argocd')[]) =>
  ProvidersFileSchema.parse({
    schemaVersion: '1.0',
    ...Object.fromEntries(
      ids.map((id) => [id, { enabled: true, baseUrl: `https://${id}.example.com` }]),
    ),
  });

describe('resolveProviderAuth', () => {
  it('sonarqube enabled + SONARQUBE_TOKEN → "Bearer <t>"', () => {
    const auth = resolveProviderAuth(enable('sonarqube'), { SONARQUBE_TOKEN: 'sqa_abc123' });
    expect(auth.sonarqube).toEqual({ enabled: true, authHeader: 'Bearer sqa_abc123' });
    expect(auth.harbor).toEqual({ enabled: false, authHeader: null });
    expect(auth.argocd).toEqual({ enabled: false, authHeader: null });
  });

  it('argocd enabled + ARGOCD_TOKEN → "Bearer <t>"', () => {
    expect(
      resolveProviderAuth(enable('argocd'), { ARGOCD_TOKEN: 'argo-1' }).argocd.authHeader,
    ).toBe('Bearer argo-1');
  });

  it('harbor name without secret throws ProviderAuthError (and the reverse)', () => {
    expect(() => resolveProviderAuth(enable('harbor'), { HARBOR_ROBOT_NAME: 'robot$x' })).toThrow(
      ProviderAuthError,
    );
    expect(() => resolveProviderAuth(enable('harbor'), { HARBOR_ROBOT_SECRET: 's' })).toThrow(
      ProviderAuthError,
    );
  });

  it('the half-credential error never contains a credential value', () => {
    try {
      resolveProviderAuth(enable('harbor'), { HARBOR_ROBOT_NAME: 'robot$hub+reader' });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain('HARBOR_ROBOT_SECRET');
      expect((e as Error).message).not.toContain('robot$hub+reader');
    }
  });

  it('harbor both → "Basic " + base64("robot$hub+reader:s3cret")', () => {
    const auth = resolveProviderAuth(enable('harbor'), {
      HARBOR_ROBOT_NAME: 'robot$hub+reader',
      HARBOR_ROBOT_SECRET: 's3cret',
    });
    expect(auth.harbor.authHeader).toBe(
      `Basic ${Buffer.from('robot$hub+reader:s3cret').toString('base64')}`,
    );
  });

  it('enabled without a token → authHeader null (items become not-authorised)', () => {
    const auth = resolveProviderAuth(enable('sonarqube', 'harbor', 'argocd'), {});
    expect(auth.sonarqube).toEqual({ enabled: true, authHeader: null });
    expect(auth.harbor).toEqual({ enabled: true, authHeader: null });
    expect(auth.argocd).toEqual({ enabled: true, authHeader: null });
  });

  it('blank values count as not set', () => {
    expect(
      resolveProviderAuth(enable('sonarqube'), { SONARQUBE_TOKEN: '  ' }).sonarqube.authHeader,
    ).toBeNull();
  });

  it('disabled provider ignores its variables (even half Harbor credentials)', () => {
    const auth = resolveProviderAuth(PROVIDERS_OFF, {
      SONARQUBE_TOKEN: 'x',
      HARBOR_ROBOT_NAME: 'half',
      ARGOCD_TOKEN: 'y',
    });
    for (const id of ['sonarqube', 'harbor', 'argocd'] as const)
      expect(auth[id]).toEqual({ enabled: false, authHeader: null });
  });

  it('mock source: enabled providers get a placeholder header that is never a credential', () => {
    const auth = resolveProviderAuth(enable('sonarqube', 'harbor'), {}, { mock: true });
    expect(auth.sonarqube).toEqual({ enabled: true, authHeader: 'mock' });
    expect(auth.harbor).toEqual({ enabled: true, authHeader: 'mock' });
    expect(auth.argocd).toEqual({ enabled: false, authHeader: null });
  });
});
