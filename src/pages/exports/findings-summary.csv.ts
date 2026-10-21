import type { APIRoute } from 'astro';
import { toCsv } from '../../lib/csv';
import { loadSiteData } from '../../lib/data';
import { FINDINGS_HEADERS, findingsRows } from '../../lib/exports';

/** Open alert counts per project and repository. No titles, rule ids or paths. */
export const GET: APIRoute = () => {
  const site = loadSiteData();
  return new Response(toCsv(FINDINGS_HEADERS, site.ok ? findingsRows(site.data) : []), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8' },
  });
};
