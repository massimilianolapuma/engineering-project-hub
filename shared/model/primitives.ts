import { z } from 'zod';

/** Field primitives shared by the snapshot, history and changes models. */
export const isoDate = z.iso.datetime({ offset: true });
/**
 * UTC only ("Z"), as the collector writes it: history and changes order and compare instants,
 * and an offset would make a later string an earlier instant.
 */
export const utcDate = z.iso.datetime();
/** Links are sanitised before validation; this only re-checks the shape. */
export const httpsUrl = z.url({ protocol: /^https$/ }).max(500);
export const shortText = z.string().max(200);
/** null means "unknown" — never the same as 0. */
export const nullableCount = z.number().int().min(0).nullable();
