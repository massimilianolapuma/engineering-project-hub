import type { ComponentEnvironmentVersion } from '@model/index';
import type { RawProjectData } from '../collectors/collect';
import { scrubIdentifier } from '../sanitizers/sanitize';
import { recordError, type BuildContext } from './model';

/*
 * Component versions per environment from the component's own GitHub Deployments (spec
 * 2026-11-20 5.3). A read that failed is unknown with its reason, never "not deployed"; "none"
 * only when the environment has no deployment at all.
 */

const FULL_SHA = /^[0-9a-f]{40}$/;

/** By component id: only the components whose deployments were read. */
export function componentEnvironmentVersions(
  ctx: BuildContext,
  raw: RawProjectData,
): Map<string, ComponentEnvironmentVersion[]> {
  const out = new Map<string, ComponentEnvironmentVersion[]>();
  for (const [componentId, reads] of raw.componentDeployments ?? []) {
    const repository = raw.config.components.find((c) => c.id === componentId)?.repository;
    if (!repository) continue;
    const entries = reads.map(({ environmentId, environment, result }) => {
      const entry: ComponentEnvironmentVersion = {
        environmentId,
        // A name the catalog chose, bounded like every published identifier.
        environment: scrubIdentifier(environment, 255) ?? environmentId,
        state: 'unknown',
        version: null,
        ref: null,
        revision: null,
        deployedAt: null,
        declared: false,
      };
      if (!result.ok) {
        const c = result.error.classification;
        // Once per repository and classification: every environment of a repository the App
        // cannot read fails the same way.
        const seen = ctx.errors.some(
          (e) =>
            e.repository === repository && e.source === 'deploy-signal' && e.classification === c,
        );
        if (!seen) recordError(ctx, repository, componentId, 'deploy-signal', result);
        entry.state =
          c === 'not-found' ? 'not-found' : c === 'not-authorised' ? 'not-authorised' : 'unknown';
        return entry;
      }
      const { current, candidates } = result.data;
      if (!current) {
        entry.state = candidates === 0 ? 'none' : 'no-success';
        return entry;
      }
      return {
        ...entry,
        state: 'ok' as const,
        version: current.version ? (scrubIdentifier(current.version, 100) ?? null) : null,
        ref: scrubIdentifier(current.ref, 100) ?? null,
        revision: FULL_SHA.test(current.sha) ? current.sha.slice(0, 7) : null,
        deployedAt: current.deployedAt,
        declared: current.declared,
      };
    });
    out.set(componentId, entries);
  }
  return out;
}
