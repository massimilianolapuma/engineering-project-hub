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
