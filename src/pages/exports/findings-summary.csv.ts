import type { APIRoute } from 'astro';
import { toCsv } from '../../lib/csv';
import { loadSiteData } from '../../lib/data';
import { FINDINGS_HEADERS, findingsRows, unavailableCsv } from '../../lib/exports';

/** Open alert counts per project and repository. No titles, rule ids or paths. */
export const GET: APIRoute = () => {
  const site = loadSiteData();
  return new Response(
    site.ok ? toCsv(FINDINGS_HEADERS, findingsRows(site.data)) : unavailableCsv(FINDINGS_HEADERS),
    {
      headers: { 'Content-Type': 'text/csv; charset=utf-8' },
    },
  );
};
