import { z } from 'zod';
import { fail, ok, type ProviderResult } from '../types';
import type { ExternalClient } from './http';
import type { HarborArtifactDTO, RegistryProvider } from './types';

const SHA256 = /^sha256:[0-9a-f]{64}$/;
const isoDate = z.iso.datetime({ offset: true });
const ACCEPT_VULNERABILITIES =
  'application/vnd.security.vulnerability.report; version=1.1, application/vnd.scanner.adapter.vuln.report.harbor+json; version=1.0';

/**
 * Only what the hub reads. The scanner, the vulnerability list, tags and labels are ignored.
 * Harbor (Go) serialises empty slices and maps as JSON null: every field is nullish.
 */
const ScanOverviewSchema = z.object({
  scan_status: z.string().nullish(),
  end_time: z.string().nullish(),
  summary: z
    .object({
      total: z.number().nullish(),
      fixable: z.number().nullish(),
      summary: z.record(z.string(), z.number().nullish()).nullish(),
    })
    .nullish(),
});
const ArtifactSchema = z.object({
  digest: z.string().nullish(),
  scan_overview: z.record(z.string(), ScanOverviewSchema).nullish(),
  accessories: z.array(z.object({ type: z.string().nullish() })).nullish(),
});

const SCAN_STATUS: Record<string, 'success' | 'error' | 'running' | 'pending'> = {
  Success: 'success',
  Error: 'error',
  Running: 'running',
  Pending: 'pending',
  Scheduled: 'pending',
};

const count = (n: number | null | undefined): number | null =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null;

function toScan(
  overview: z.infer<typeof ScanOverviewSchema> | null | undefined,
): NonNullable<HarborArtifactDTO['scan']> {
  const nulls = {
    critical: null,
    high: null,
    medium: null,
    low: null,
    unknown: null,
    fixable: null,
    total: null,
  };
  if (!overview) return { status: 'not-scanned', endTime: null, ...nulls };
  const status = SCAN_STATUS[overview.scan_status ?? ''] ?? 'pending';
  const endTime =
    overview.end_time && isoDate.safeParse(overview.end_time).success ? overview.end_time : null;
  const severities = overview.summary?.summary;
  // Counts exist only for a finished scan that carries a summary; Harbor omits zero severities.
  if (status !== 'success' || !severities) return { status, endTime, ...nulls };
  const at = (k: string) => count(severities[k]) ?? 0;
  return {
    status,
    endTime,
    critical: at('Critical'),
    high: at('High'),
    medium: at('Medium'),
    low: at('Low'),
    unknown: at('Negligible') + at('Unknown') + at('None'),
    fixable: count(overview.summary?.fixable),
    total: count(overview.summary?.total),
  };
}

/** Harbor API v2.0, read-only (robot account with artifact read). Never triggers a scan. */
export function createHarborProvider(client: ExternalClient): RegistryProvider {
  return {
    id: 'harbor',
    async getArtifact(project, repository, reference): Promise<ProviderResult<HarborArtifactDTO>> {
      const response = await client.getJson(
        '/api/v2.0/projects/{project}/repositories/{repository}/artifacts/{reference}',
        { project, repository, reference },
        { with_scan_overview: 'true', with_accessory: 'true', with_tag: 'false' },
        {
          doubleEncode: ['repository'],
          headers: { 'X-Accept-Vulnerabilities': ACCEPT_VULNERABILITIES },
        },
      );
      if (!response.ok) return response;
      const parsed = ArtifactSchema.safeParse(response.data);
      if (!parsed.success)
        return fail({ classification: 'invalid-data', message: 'invalid response' });
      const a = parsed.data;
      const types = new Set((a.accessories ?? []).map((x) => x.type));
      return ok({
        digest: a.digest && SHA256.test(a.digest) ? a.digest : null,
        scan: toScan(a.scan_overview ? Object.values(a.scan_overview)[0] : undefined),
        signatures: {
          cosign: types.has('signature.cosign'),
          notation: types.has('signature.notation'),
        },
      });
    },
  };
}
