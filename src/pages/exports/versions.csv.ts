import type { APIRoute } from 'astro';
import { toCsv } from '../../lib/csv';
import { loadSiteData } from '../../lib/data';
import { VERSIONS_HEADERS, versionsRows } from '../../lib/exports';

/** Versions of every coordinator, component and environment. */
export const GET: APIRoute = () => {
  const site = loadSiteData();
  return new Response(toCsv(VERSIONS_HEADERS, site.ok ? versionsRows(site.data) : []), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8' },
  });
};
