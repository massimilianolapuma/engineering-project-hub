import type { APIRoute } from 'astro';
import { toCsv } from '../../lib/csv';
import { loadHistory, loadSiteData } from '../../lib/data';
import { PORTFOLIO_HEADERS, portfolioRows } from '../../lib/exports';

/** One row per project, with the previous collection's status and score when known. */
export const GET: APIRoute = () => {
  const site = loadSiteData();
  const history = loadHistory();
  const rows = site.ok ? portfolioRows(site.data, history.ok ? history.data : null) : [];
  return new Response(toCsv(PORTFOLIO_HEADERS, rows), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8' },
  });
};
