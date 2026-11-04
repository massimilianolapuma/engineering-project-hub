import type { APIRoute } from 'astro';
import { toCsv } from '../../lib/csv';
import { loadSiteData } from '../../lib/data';
import { CONTROL_MAP_HEADERS, controlMapRows, unavailableCsv } from '../../lib/exports';

/** Control map levels per project and check (spec 2026-11-04). Not a compliance assessment. */
export const GET: APIRoute = () => {
  const site = loadSiteData();
  return new Response(
    site.ok
      ? toCsv(CONTROL_MAP_HEADERS, controlMapRows(site.data))
      : unavailableCsv(CONTROL_MAP_HEADERS),
    { headers: { 'Content-Type': 'text/csv; charset=utf-8' } },
  );
};
