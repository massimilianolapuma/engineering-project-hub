import type { SeverityCounts } from '@model/index';

const SEV = ['critical', 'high', 'medium', 'low'] as const;

/**
 * Text of an image scan: the non-zero severities, "clean" when every count is 0, and "unknown"
 * when the counts (or any severity) could not be read. Unknown is never shown as clean.
 */
export function scanLine(
  counts: SeverityCounts | null,
  name: (severity: (typeof SEV)[number], n: number) => string,
): { kind: 'counts' | 'clean' | 'unknown'; text: string } {
  if (!counts || [...SEV, 'unknown' as const].some((k) => counts[k] === null))
    return { kind: 'unknown', text: '' };
  const parts = SEV.filter((k) => (counts[k] ?? 0) > 0).map((k) => name(k, counts[k] ?? 0));
  return parts.length ? { kind: 'counts', text: parts.join(' · ') } : { kind: 'clean', text: '' };
}

/**
 * Counts line of an enabled provider on the Providers card. Zero items means nothing in the
 * catalog is mapped to it: said in words, so "working" and "nothing to do" read differently.
 */
export function providerCounts(
  p: { items: number; errors: number },
  t: { counts: string; countsClean: string; nothingMapped: string },
  num: (n: number) => string,
): string {
  if (p.items === 0) return t.nothingMapped;
  return p.errors > 0
    ? t.counts.replace('{items}', () => num(p.items)).replace('{errors}', () => num(p.errors))
    : t.countsClean.replace('{items}', () => num(p.items));
}
