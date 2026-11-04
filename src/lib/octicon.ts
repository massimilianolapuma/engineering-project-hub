import octicons from '@primer/octicons';

/**
 * Octicons the hub uses (@primer/octicons). Build-time only: never import this module from a
 * client script, it pulls in every icon path.
 */
export const OCTICON_NAMES = [
  // health and control symbols
  'check-circle-fill',
  'alert-fill',
  'x-circle-fill',
  'check-circle',
  'alert',
  'clock',
  'question',
  'dash',
  'x-circle',
  'check',
  'x',
  // shell
  'stack',
  'apps',
  'history',
  'shield',
  'tag',
  'workflow',
  'database',
  'book',
  'sun',
  'moon',
  'device-desktop',
  // content
  'arrow-right',
  'chevron-down',
  'chevron-right',
  'info',
  'link-external',
  'shield-check',
  'eye-closed',
  'plus',
  'trash',
  'download',
  'git-pull-request',
  'people',
  'triangle-down',
  // supply chain evidence and deployed environments
  'verified',
  'unverified',
  'heart',
  'sync',
  'briefcase',
  // control map
  'checklist',
] as const;
export type OcticonName = (typeof OCTICON_NAMES)[number];

const escapeAttr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * SVG markup of an Octicon, filled with currentColor. Decorative (`aria-hidden`) without a
 * label; with one, a labelled image (`role="img"`, `aria-label`). Throws on an unknown name.
 */
export function octiconSvg(
  name: OcticonName,
  opts: { size?: 12 | 16 | 24; label?: string; className?: string } = {},
): string {
  const icon = octicons[name];
  if (!icon) throw new Error(`unknown Octicon: ${name}`);
  const { size = 16, label, className } = opts;
  const options: Record<string, string | number> = {
    width: size,
    height: size,
    fill: 'currentColor',
  };
  if (className) options.class = escapeAttr(className);
  if (label) options['aria-label'] = escapeAttr(label);
  return icon.toSVG(options);
}
