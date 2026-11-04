import type { APIRoute } from 'astro';
import { toCsv } from '../../lib/csv';
import { controlMapAvailable } from '../../lib/control-map-view';
import { loadSiteData } from '../../lib/data';
import { CONTROL_MAP_HEADERS, controlMapRows } from '../../lib/exports';

/*
 * exports/control-map.csv: control map levels per project and check (spec 2026-11-04). Built only
 * when the published data carries the map (restricted audience or mock data). It is not a
 * compliance assessment.
 */
export const getStaticPaths = () => {
  const site = loadSiteData();
  return site.ok && controlMapAvailable(site.data.projects)
    ? [{ params: { map: 'control-map' } }]
    : [];
};

export const GET: APIRoute = () => {
  const site = loadSiteData();
  return new Response(site.ok ? toCsv(CONTROL_MAP_HEADERS, controlMapRows(site.data)) : '', {
    headers: { 'Content-Type': 'text/csv; charset=utf-8' },
  });
};
