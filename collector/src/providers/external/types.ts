import type { ProviderResult } from '../types';

/*
 * DTOs of the optional external providers. Each provider projects the API response onto these
 * minimal shapes (allowlist): raw payloads, hosts and credentials never leave the provider.
 */

export interface SonarProjectDTO {
  linesToCover: number | null;
  uncoveredLines: number | null;
  /** Coverage on new code, percentage 0–100. */
  newCoverage: number | null;
  qualityGate: 'OK' | 'ERROR' | null;
  /** ISO date of the last analysis (offset normalised to "+hh:mm"). */
  analysedAt: string | null;
  /** 40-hex commit of the last analysis. */
  revision: string | null;
}

export interface HarborArtifactDTO {
  /** sha256 digest or null. */
  digest: string | null;
  scan: {
    status: 'success' | 'error' | 'running' | 'pending' | 'not-scanned';
    endTime: string | null;
    critical: number | null;
    high: number | null;
    medium: number | null;
    low: number | null;
    unknown: number | null;
    fixable: number | null;
    total: number | null;
  } | null;
  signatures: { cosign: boolean; notation: boolean };
}

export interface ArgoApplicationDTO {
  sync: 'synced' | 'out-of-sync' | 'unknown' | null;
  health: 'healthy' | 'progressing' | 'degraded' | 'suspended' | 'missing' | 'unknown' | null;
  revision: string | null;
  targetRevision: string | null;
  images: string[];
  deployedAt: string | null;
}

/** Second Quality source: SonarQube measures of one project key (and optional branch). */
export interface QualityProvider {
  readonly id: 'sonarqube';
  getProject(key: string, branch?: string): Promise<ProviderResult<SonarProjectDTO>>;
}

/** Image scans and signatures: Harbor, one image reference at a time. */
export interface RegistryProvider {
  readonly id: 'harbor';
  getArtifact(
    project: string,
    repository: string,
    reference: string,
  ): Promise<ProviderResult<HarborArtifactDTO>>;
}

/** Deployed versions: Argo CD, one application at a time. Read-only: never refreshes or syncs. */
export interface DeploymentProvider {
  readonly id: 'argocd';
  getApplication(app: {
    name: string;
    namespace?: string;
    project?: string;
  }): Promise<ProviderResult<ArgoApplicationDTO>>;
}

/** null = the provider is off: nothing is contacted and nothing is shown as "0". */
export interface ExternalProviders {
  sonarqube: QualityProvider | null;
  harbor: RegistryProvider | null;
  argocd: DeploymentProvider | null;
}
