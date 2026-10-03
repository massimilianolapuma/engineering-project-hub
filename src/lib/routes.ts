import type { Locale } from '../i18n';

export type PageKey = 'portfolio' | 'workflows' | 'versions' | 'security' | 'dataQuality';

const PATHS: Record<PageKey, string> = {
  portfolio: '',
  workflows: 'workflows/',
  versions: 'versions/',
  security: 'security/',
  dataQuality: 'data-quality/',
};

const base = () => {
  const b = import.meta.env.BASE_URL ?? '/';
  return b.endsWith('/') ? b : `${b}/`;
};

/** Site-relative URL honouring the GitHub Pages base path and the locale prefix. */
export function href(locale: Locale, page: PageKey | `projects/${string}`): string {
  const path = page.startsWith('projects/') ? `${page}/` : PATHS[page as PageKey];
  return `${base()}${locale === 'en' ? '' : `${locale}/`}${path}`;
}

/** getStaticPaths helper for the optional [...lang] segment: "/" (en) and "/it/". */
export const localeParams = () => [
  { params: { lang: undefined }, props: { locale: 'en' as Locale } },
  { params: { lang: 'it' }, props: { locale: 'it' as Locale } },
];
