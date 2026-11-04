import type { Locale } from '../i18n';
import type { OcticonName } from './octicon';

export type PageKey =
  | 'portfolio'
  | 'changes'
  | 'executive'
  | 'workflows'
  | 'versions'
  | 'security'
  | 'controls'
  | 'dataQuality'
  | 'catalog'
  | 'howToRead'
  | 'setupApp';

const PATHS: Record<PageKey, string> = {
  portfolio: '',
  changes: 'changes/',
  executive: 'executive/',
  workflows: 'workflows/',
  versions: 'versions/',
  security: 'security/',
  controls: 'controls/',
  dataQuality: 'data-quality/',
  catalog: 'catalog/',
  howToRead: 'how-to-read/',
  setupApp: 'setup/github-app/',
};

/** Main navigation in reading order. "How to read" is a header utility link, not a section. */
export const NAV: readonly PageKey[] = [
  'portfolio',
  'changes',
  'executive',
  'security',
  'controls',
  'versions',
  'workflows',
  'dataQuality',
  'catalog',
];

/** Octicon shown before each navigation label (Primer UnderlineNav). */
export const NAV_ICON: Record<PageKey, OcticonName> = {
  portfolio: 'apps',
  changes: 'history',
  executive: 'briefcase',
  security: 'shield',
  controls: 'checklist',
  versions: 'tag',
  workflows: 'workflow',
  dataQuality: 'database',
  catalog: 'book',
  howToRead: 'question',
  setupApp: 'key',
};

/**
 * Main navigation for this build: the executive summary only when outputs.executive is on, the
 * control map only when the published data carries it (restricted audience or mock data).
 */
export function navFor(executiveEnabled: boolean, controlMap = false): readonly PageKey[] {
  return NAV.filter(
    (k) => (k !== 'executive' || executiveEnabled) && (k !== 'controls' || controlMap),
  );
}

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
  name:
    | 'portfolio.csv'
    | 'findings-summary.csv'
    | 'versions.csv'
    | 'supply-chain.csv'
    | 'control-map.csv',
): string {
  return `${base()}exports/${name}`;
}

/** getStaticPaths helper for the optional [...lang] segment: "/" (en) and "/it/". */
export const localeParams = () => [
  { params: { lang: undefined }, props: { locale: 'en' as Locale } },
  { params: { lang: 'it' }, props: { locale: 'it' as Locale } },
];
