import type { APIRoute } from 'astro';
import { toCsv } from '../../lib/csv';
import { loadSiteData } from '../../lib/data';
import { VERSIONS_HEADERS, unavailableCsv, versionsRows } from '../../lib/exports';

/** Versions of every coordinator, component and environment. */
export const GET: APIRoute = () => {
  const site = loadSiteData();
  return new Response(
    site.ok ? toCsv(VERSIONS_HEADERS, versionsRows(site.data)) : unavailableCsv(VERSIONS_HEADERS),
    {
      headers: { 'Content-Type': 'text/csv; charset=utf-8' },
    },
  );
};
