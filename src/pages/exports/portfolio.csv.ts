import type { APIRoute } from 'astro';
import { toCsv } from '../../lib/csv';
import { loadHistory, loadSiteData } from '../../lib/data';
import { PORTFOLIO_HEADERS, portfolioRows, unavailableCsv } from '../../lib/exports';

/** One row per project, with the previous collection's status and score when known. */
export const GET: APIRoute = () => {
  const site = loadSiteData();
  const history = loadHistory();
  const body = site.ok
    ? toCsv(PORTFOLIO_HEADERS, portfolioRows(site.data, history.ok ? history.data : null))
    : unavailableCsv(PORTFOLIO_HEADERS);
  return new Response(body, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8' },
  });
};
