import type { SupplyChain } from './snapshot';

type ImageRow = SupplyChain['repositories'][number]['images'][number];

/**
 * Strongest signature answer first: an explicit verification failure beats mere presence.
 * Positive evidence (verified, present) outranks 'missing' on the same digest by design: a
 * signature is a property of the digest, so one source that finds it settles it.
 */
const RANK: ImageRow['signature'][] = [
  'failed',
  'not-verified',
  'verified',
  'present',
  'missing',
  'unknown',
];

/**
 * Distinct images of a list of image rows. The CI summary and Harbor often report the same image:
 * rows with the same digest are one image, whose signature is the strongest answer among them.
 * Rows without a digest cannot be matched and count on their own.
 */
export function tallyImages(rows: readonly ImageRow[]): {
  images: number;
  signed: number;
  unsigned: number;
} {
  const byKey = new Map<string, ImageRow['signature']>();
  rows.forEach((row, i) => {
    const key = row.digest ?? `#${i}`;
    const prev = byKey.get(key);
    if (!prev || RANK.indexOf(row.signature) < RANK.indexOf(prev)) byKey.set(key, row.signature);
  });
  const states = [...byKey.values()];
  return {
    images: states.length,
    signed: states.filter((s) => s === 'verified' || s === 'present').length,
    unsigned: states.filter((s) => s === 'missing' || s === 'not-verified' || s === 'failed')
      .length,
  };
}
