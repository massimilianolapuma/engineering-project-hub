export interface GitmoduleEntry {
  name: string;
  path: string;
  url: string | null;
  branch: string | null;
}

/** Parses a .gitmodules file (git-config INI subset). Entries without a path are ignored. */
export function parseGitmodules(text: string): GitmoduleEntry[] {
  const entries: GitmoduleEntry[] = [];
  let current: { name: string; values: Record<string, string> } | null = null;
  const flush = () => {
    if (current?.values.path) {
      entries.push({
        name: current.name,
        path: current.values.path.replace(/^\.\//, '').replace(/\/+$/, ''),
        url: current.values.url ?? null,
        branch: current.values.branch ?? null,
      });
    }
  };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const section = /^\[submodule\s+"([^"]+)"\]$/.exec(line);
    if (section) {
      flush();
      current = { name: section[1] ?? '', values: {} };
      continue;
    }
    if (line.startsWith('[')) {
      flush();
      current = null;
      continue;
    }
    const kv = /^([A-Za-z][A-Za-z0-9-]*)\s*=\s*(.*)$/.exec(line);
    if (kv && current)
      current.values[kv[1]!.toLowerCase()] = kv[2]!.replace(/^"(.*)"$/, '$1').trim();
  }
  flush();
  return entries;
}

/**
 * Reduces a GitHub remote URL to "owner/name" (lower-case), or null for any other host.
 * Supports https, ssh (git@github.com:owner/name.git) and relative URLs (../name.git).
 */
export function githubRepositoryFromUrl(
  url: string | null,
  coordinatorRepository: string,
): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  const relative = /^\.\.\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(trimmed);
  if (relative) {
    const owner = coordinatorRepository.split('/')[0];
    return `${owner}/${relative[1]}`.toLowerCase();
  }
  const m =
    /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(
      trimmed,
    );
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}
