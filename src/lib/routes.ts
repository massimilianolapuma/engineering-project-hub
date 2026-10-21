import type { Locale } from '../i18n';

export type PageKey =
  'portfolio' | 'workflows' | 'versions' | 'security' | 'dataQuality' | 'catalog' | 'howToRead';

const PATHS: Record<PageKey, string> = {
  portfolio: '',
  workflows: 'workflows/',
  versions: 'versions/',
  security: 'security/',
  dataQuality: 'data-quality/',
  catalog: 'catalog/',
  howToRead: 'how-to-read/',
};

/** Main navigation in reading order. "How to read" is a header utility link, not a section. */
export const NAV: readonly PageKey[] = [
  'portfolio',
  'security',
  'versions',
  'workflows',
  'dataQuality',
  'catalog',
];

const base = () => {
  const b = import.meta.env.BASE_URL ?? '/';
  return b.endsWith('/') ? b : `${b}/`;
};

/** Site-relative URL honouring the GitHub Pages base path and the locale prefix. */
export function href(locale: Locale, page: PageKey | `projects/${string}`): string {
  const path = page.startsWith('projects/') ? `${page}/` : PATHS[page as PageKey];
  return `${base()}${locale === 'en' ? '' : `${locale}/`}${path}`;
}

/** Static CSV export (shared by both locales), honouring the base path. */
export function exportHref(
  name: 'portfolio.csv' | 'findings-summary.csv' | 'versions.csv',
): string {
  return `${base()}exports/${name}`;
}

/** getStaticPaths helper for the optional [...lang] segment: "/" (en) and "/it/". */
export const localeParams = () => [
  { params: { lang: undefined }, props: { locale: 'en' as Locale } },
  { params: { lang: 'it' }, props: { locale: 'it' as Locale } },
];
