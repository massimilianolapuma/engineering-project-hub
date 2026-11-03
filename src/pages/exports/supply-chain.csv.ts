import type { APIRoute } from 'astro';
import { toCsv } from '../../lib/csv';
import { loadSiteData } from '../../lib/data';
import { SUPPLY_CHAIN_HEADERS, supplyChainRows, unavailableCsv } from '../../lib/exports';

/** Supply chain evidence per project and repository (counts and states, never package names). */
export const GET: APIRoute = () => {
  const site = loadSiteData();
  return new Response(
    site.ok
      ? toCsv(SUPPLY_CHAIN_HEADERS, supplyChainRows(site.data))
      : unavailableCsv(SUPPLY_CHAIN_HEADERS),
    { headers: { 'Content-Type': 'text/csv; charset=utf-8' } },
  );
};
