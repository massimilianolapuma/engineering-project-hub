import type { PortfolioIndex } from '@model/index';
import { useI18n, type Locale } from '../i18n';
import { loadSiteData } from './data';
import { href, type PageKey } from './routes';

/** Common per-page setup: i18n, validated data and language alternates. */
export function pageContext(locale: Locale, page: PageKey | `projects/${string}`) {
  const i18n = useI18n(locale);
  const data = loadSiteData();
  const index: PortfolioIndex | null = data.ok ? data.data.index : null;
  const alternates = { en: href('en', page), it: href('it', page) };
  return { i18n, data, index, alternates };
}
