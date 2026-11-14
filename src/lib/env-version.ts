import type { EnvironmentSnapshot } from '@model/index';

/**
 * The branch deployment of an environment with no known version: a GitHub deployment made from a
 * branch (LAB on main), shown as "main @ 1a2b3c4" instead of "Unknown". null otherwise.
 */
export function branchDeployment(e: EnvironmentSnapshot): { ref: string; sha: string } | null {
  const dep = e.deployment;
  if (e.version || !dep || dep.kind !== 'github-deployments' || dep.state !== 'available')
    return null;
  if (!dep.revision) return null;
  return { ref: dep.ref ?? '?', sha: dep.revision };
}
