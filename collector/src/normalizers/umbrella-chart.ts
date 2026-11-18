import { parse } from 'yaml';
import type { ProjectConfig } from '@model/index';
import { MAX_VALUE_FILE_BYTES } from '../../../shared/yaml-value';
import { normaliseVersion, parseVersion } from '../util/semver';

export interface ChartDependency {
  name: string;
  alias: string | null;
  /** Normalised semver, else the raw text (e.g. a range). */
  version: string | null;
}

export interface ParsedChart {
  version: string | null;
  dependencies: ChartDependency[];
}

export interface ChartMapping {
  byComponent: Map<string, { version: string | null; conflict: boolean }>;
  /** Dependencies matched by no component (alias ?? name). */
  unmapped: string[];
  /** Entries sharing a name with a dependency chosen through an alias (alias ?? name). */
  aliases: string[];
}

function versionText(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const text = String(raw).trim();
  if (!text) return null;
  const normalised = normaliseVersion(text);
  return normalised && parseVersion(normalised) ? normalised : text;
}

/** Version and dependencies of an umbrella Chart.yaml; null when invalid. */
export function parseUmbrellaChart(text: string): ParsedChart | null {
  if (text.length > MAX_VALUE_FILE_BYTES) return null;
  let doc: unknown;
  try {
    doc = parse(text, { maxAliasCount: 100, uniqueKeys: false, logLevel: 'error' });
  } catch {
    return null;
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return null;
  const root = doc as Record<string, unknown>;
  // Not a chart at all (e.g. stray punctuation parsed as a map).
  if (!('version' in root) && !('dependencies' in root)) return null;
  const rawDeps = root['dependencies'];
  if (rawDeps !== undefined && rawDeps !== null && !Array.isArray(rawDeps)) return null;
  const dependencies: ChartDependency[] = [];
  for (const entry of (rawDeps as unknown[] | undefined) ?? []) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
    const e = entry as Record<string, unknown>;
    if (typeof e['name'] !== 'string' || !e['name']) return null;
    dependencies.push({
      name: e['name'],
      alias: typeof e['alias'] === 'string' && e['alias'] ? e['alias'] : null,
      version: versionText(e['version']),
    });
  }
  return { version: versionText(root['version']), dependencies };
}

/** Maps chart dependencies to the project's components (spec 5.1). */
export function mapChartToComponents(config: ProjectConfig, chart: ParsedChart): ChartMapping {
  const byComponent: ChartMapping['byComponent'] = new Map();
  const used = new Set<ChartDependency>();
  const aliasEntries = new Set<ChartDependency>();
  const deps = chart.dependencies;
  const repoName = (c: { repository: string }): string => c.repository.split('/')[1] ?? '';
  const repoCount = new Map<string, number>();
  for (const c of config.components) {
    const key = c.repository.toLowerCase();
    repoCount.set(key, (repoCount.get(key) ?? 0) + 1);
  }

  for (const c of config.components) {
    let group: ChartDependency[] = [];
    if (c.chartDependency) {
      group = deps.filter((d) => d.alias === c.chartDependency);
      if (group.length > 0) {
        const name = group[0]!.name;
        for (const d of deps)
          if (d.name === name && d.alias !== c.chartDependency) aliasEntries.add(d);
      } else {
        group = deps.filter((d) => d.name === c.chartDependency);
      }
    }
    const rn = repoName(c);
    if (group.length === 0 && rn && repoCount.get(c.repository.toLowerCase()) === 1) {
      // Every entry with the repository name (aliased ones join the non-aliased one).
      group = deps.filter((d) => d.name === rn);
    }
    if (group.length === 0) group = deps.filter((d) => d.name === c.id);
    if (group.length === 0) continue;
    for (const d of group) used.add(d);
    const versions = new Set(group.map((d) => d.version));
    byComponent.set(
      c.id,
      versions.size > 1
        ? { version: null, conflict: true }
        : { version: group[0]!.version, conflict: false },
    );
  }

  const label = (d: ChartDependency): string => d.alias ?? d.name;
  const aliases = [...new Set([...aliasEntries].filter((d) => !used.has(d)).map(label))];
  const unmapped = [
    ...new Set(deps.filter((d) => !used.has(d) && !aliasEntries.has(d)).map(label)),
  ];
  return { byComponent, unmapped, aliases };
}
