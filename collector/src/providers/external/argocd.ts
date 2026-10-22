import { z } from 'zod';
import { scrubIdentifier } from '../../sanitizers/sanitize';
import { fail, ok, type ProviderResult } from '../types';
import type { ExternalClient } from './http';
import type { ArgoApplicationDTO, DeploymentProvider } from './types';

const isoDate = z.iso.datetime({ offset: true });
const MAX_IMAGES = 50;
const MAX_IMAGE_LENGTH = 300;

/** Only the fields the hub reads: repoURL, destination, resources are never touched. */
const ApplicationSchema = z.object({
  spec: z
    .object({
      source: z.object({ targetRevision: z.string().optional() }).optional(),
      sources: z.array(z.object({ targetRevision: z.string().optional() })).optional(),
    })
    .optional(),
  status: z
    .object({
      sync: z.object({ status: z.string().optional(), revision: z.string().optional() }).optional(),
      health: z.object({ status: z.string().optional() }).optional(),
      summary: z.object({ images: z.array(z.string()).optional() }).optional(),
      operationState: z.object({ finishedAt: z.string().optional() }).optional(),
      history: z.array(z.object({ deployedAt: z.string().optional() })).optional(),
    })
    .optional(),
});

const SYNC: Record<string, ArgoApplicationDTO['sync']> = {
  Synced: 'synced',
  OutOfSync: 'out-of-sync',
  Unknown: 'unknown',
};
const HEALTH: Record<string, ArgoApplicationDTO['health']> = {
  Healthy: 'healthy',
  Progressing: 'progressing',
  Degraded: 'degraded',
  Suspended: 'suspended',
  Missing: 'missing',
  Unknown: 'unknown',
};
const FULL_SHA = /^[0-9a-f]{40}$/;

const date = (raw: string | undefined): string | null =>
  raw && isoDate.safeParse(raw).success ? raw : null;

/**
 * Argo CD API, read-only (GET one application). It never sends `refresh`: that would ask Argo CD
 * to run a Git comparison, and the hub only reads what Argo CD already knows.
 */
export function createArgoCdProvider(client: ExternalClient): DeploymentProvider {
  return {
    id: 'argocd',
    async getApplication(app): Promise<ProviderResult<ArgoApplicationDTO>> {
      const query: Record<string, string> = {};
      if (app.namespace) query.appNamespace = app.namespace;
      if (app.project) query.project = app.project;
      const response = await client.getJson(
        '/api/v1/applications/{name}',
        { name: app.name },
        query,
      );
      if (!response.ok) return response;
      const parsed = ApplicationSchema.safeParse(response.data);
      if (!parsed.success)
        return fail({ classification: 'invalid-data', message: 'invalid response' });
      const { spec, status } = parsed.data;
      const target = spec?.source?.targetRevision ?? spec?.sources?.[0]?.targetRevision;
      const revision = status?.sync?.revision;
      const history = status?.history ?? [];
      return ok({
        sync: status?.sync?.status === undefined ? null : (SYNC[status.sync.status] ?? 'unknown'),
        health:
          status?.health?.status === undefined ? null : (HEALTH[status.health.status] ?? 'unknown'),
        revision: revision && FULL_SHA.test(revision) ? revision : null,
        targetRevision: scrubIdentifier(target, 100),
        images: (status?.summary?.images ?? [])
          .filter((i) => i.length <= MAX_IMAGE_LENGTH)
          .slice(0, MAX_IMAGES),
        deployedAt: date(status?.operationState?.finishedAt) ?? date(history.at(-1)?.deployedAt),
      });
    },
  };
}
