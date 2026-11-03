import { z } from 'zod';
import { spdxLicenseExpression, type Ecosystem } from '@model/index';

/**
 * SPDX SBOM summary. Pure: takes the parsed document, returns counts and SPDX identifiers only.
 * Package names, versions, purls and licence texts never leave this function.
 */
export interface SbomSummary {
  format: 'spdx' | 'cyclonedx';
  specVersion: string | null;
  generatedAt: string | null;
  /** null when the document is too large to count (partial). */
  packages: number | null;
  withoutLicense: number | null;
  flagged: number | null;
  licenses: { id: string; count: number }[];
  otherLicenses: number;
  ecosystems: { id: Ecosystem; count: number }[];
  partial: boolean;
}

/** Beyond this many packages the counts are unknown (partial), never an approximation. */
export const MAX_SBOM_PACKAGES = 100_000;
const MAX_LICENSES = 10;
const KNOWN_ECOSYSTEMS: ReadonlySet<string> = new Set([
  'npm',
  'maven',
  'pypi',
  'nuget',
  'golang',
  'cargo',
  'gem',
  'composer',
  'githubactions',
  'docker',
  'pub',
  'swift',
  'hex',
]);

const isoDate = z.iso.datetime({ offset: true });

const record = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** A usable licence string, or null for missing / empty / NOASSERTION / NONE. */
function licenseText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text || /^(?:NOASSERTION|NONE)$/i.test(text)) return null;
  return text;
}

function ecosystemOf(pkg: Record<string, unknown>): Ecosystem {
  const refs = Array.isArray(pkg.externalRefs) ? pkg.externalRefs : [];
  for (const ref of refs) {
    const r = record(ref);
    if (r?.referenceType !== 'purl' || typeof r.referenceLocator !== 'string') continue;
    const type = /^pkg:([A-Za-z0-9.+-]+)\//.exec(r.referenceLocator)?.[1]?.toLowerCase();
    if (!type) return 'other';
    return KNOWN_ECOSYSTEMS.has(type) ? (type as Ecosystem) : 'other';
  }
  return 'unknown';
}

const byCountThenId = (a: { id: string; count: number }, b: { id: string; count: number }) =>
  b.count - a.count || a.id.localeCompare(b.id);

/** null = not a usable SPDX 2.x document. */
export function summariseSpdx(
  doc: unknown,
  flaggedLicenses: readonly string[],
): SbomSummary | null {
  let root = record(doc);
  // The legacy synchronous export wraps the document in { sbom: … }.
  if (root && root.spdxVersion === undefined && record(root.sbom)) root = record(root.sbom);
  if (!root) return null;
  if (typeof root.spdxVersion !== 'string' || !/^SPDX-2\.\d$/.test(root.spdxVersion)) return null;
  if (!Array.isArray(root.packages)) return null;

  const specVersion = root.spdxVersion.slice(5);
  const created = record(root.creationInfo)?.created;
  const parsedDate = isoDate.safeParse(created);
  const generatedAt = parsedDate.success ? parsedDate.data : null;

  // The package the document DESCRIBES is the repository itself: not a dependency.
  const described = new Set<string>();
  for (const rel of Array.isArray(root.relationships) ? root.relationships : []) {
    const r = record(rel);
    if (
      r?.relationshipType === 'DESCRIBES' &&
      r.spdxElementId === 'SPDXRef-DOCUMENT' &&
      typeof r.relatedSpdxElement === 'string'
    )
      described.add(r.relatedSpdxElement);
  }
  const packages = root.packages
    .map(record)
    .filter((p): p is Record<string, unknown> => p !== null)
    .filter((p) => !(typeof p.SPDXID === 'string' && described.has(p.SPDXID)));

  if (packages.length > MAX_SBOM_PACKAGES) {
    return {
      format: 'spdx',
      specVersion,
      generatedAt,
      packages: null,
      withoutLicense: null,
      flagged: null,
      licenses: [],
      otherLicenses: 0,
      ecosystems: [],
      partial: true,
    };
  }

  const flaggedIds = new Set(flaggedLicenses.map((l) => l.toLowerCase()));
  const licenseCounts = new Map<string, number>();
  const ecosystemCounts = new Map<Ecosystem, number>();
  let withoutLicense = 0;
  let unpublishable = 0;
  let flagged = 0;
  for (const pkg of packages) {
    const eco = ecosystemOf(pkg);
    ecosystemCounts.set(eco, (ecosystemCounts.get(eco) ?? 0) + 1);

    const raw = licenseText(pkg.licenseConcluded) ?? licenseText(pkg.licenseDeclared);
    if (raw === null) {
      withoutLicense++;
      continue;
    }
    if (flaggedIds.size && raw.split(/[\s()]+/).some((t) => flaggedIds.has(t.toLowerCase())))
      flagged++;
    const expression = spdxLicenseExpression(raw);
    if (expression === null) unpublishable++;
    else licenseCounts.set(expression, (licenseCounts.get(expression) ?? 0) + 1);
  }

  const ranked = [...licenseCounts].map(([id, count]) => ({ id, count })).sort(byCountThenId);
  const top = ranked.slice(0, MAX_LICENSES);
  const rest = ranked.slice(MAX_LICENSES).reduce((sum, l) => sum + l.count, 0);
  const ecosystems = [...ecosystemCounts].map(([id, count]) => ({ id, count })).sort(byCountThenId);

  return {
    format: 'spdx',
    specVersion,
    generatedAt,
    packages: packages.length,
    withoutLicense,
    flagged,
    licenses: top,
    otherLicenses: unpublishable + rest,
    ecosystems,
    partial: false,
  };
}
