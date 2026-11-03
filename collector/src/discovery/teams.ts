import {
  TEAM_REF,
  parseTeamName,
  projectTargets,
  teamSlug,
  type Catalog,
  type DiscoveryResult,
  type Policies,
  type ProjectConfig,
  type TeamsResult,
} from '@model/index';
import type { CollectContext } from '../collectors/collect';
import type { ProviderResult, TeamPermission, TeamRepositoryDTO } from '../providers/types';
import { scrubIdentifier } from '../sanitizers/sanitize';

/** Access that counts as working on a repository; read and triage do not. */
const WRITE: ReadonlySet<TeamPermission> = new Set(['write', 'maintain', 'admin']);

const ownerOf = (repo: string) => repo.slice(0, repo.indexOf('/'));
const lower = (s: string) => s.toLowerCase();

/** Distinct repositories of a project, lowercased. */
const reposOf = (p: ProjectConfig) => [
  ...new Set(projectTargets(p).map((t) => lower(t.repository))),
];

interface ReadTeam {
  ref: string;
  slug: string;
  /** null when the repository list could not be read. */
  repos: Map<string, TeamPermission | null> | null;
}

/**
 * Team discovery (Members: read): proposes GitHub teams for catalog projects, by write access to
 * their repositories or by a name that follows the naming rule. Only slugs, counts and access
 * levels are kept. Secret teams are skipped and counted. Never throws on missing permission.
 */
export async function discoverTeams(
  ctx: CollectContext,
  catalog: Catalog,
  policies: Policies,
  discovery: DiscoveryResult | null,
): Promise<{ teams: TeamsResult | null; discovery: DiscoveryResult | null }> {
  const cfg = catalog.teams;
  // Team names are internal: a public site never reads them, whatever the setting says.
  if (!cfg.discovery || policies.publication.audience === 'public') {
    return { teams: null, discovery };
  }

  const orgKeys = new Map<string, string>();
  const addOrg = (org: string) => {
    if (org && !orgKeys.has(lower(org))) orgKeys.set(lower(org), org);
  };
  for (const p of catalog.projects) for (const r of reposOf(p)) addOrg(ownerOf(r));
  if (catalog.discovery.enabled) catalog.discovery.owners.forEach(addOrg);
  const candidates = [...orgKeys.values()].sort((a, b) => lower(a).localeCompare(lower(b)));

  const errors: TeamsResult['errors'] = [];
  const err = (target: string, r: ProviderResult<unknown>) => {
    if (!r.ok)
      errors.push({
        target: scrubIdentifier(target, 200) ?? 'unknown',
        classification: r.error.classification,
      });
  };

  const orgs: string[] = [];
  /** Lowercased org → every listed slug (secret ones too), for orgs listed in full. */
  const listed = new Map<string, Set<string>>();
  const listingFailures: string[] = [];
  const found: { org: string; slug: string }[] = [];
  let limitReached = false;
  let secretSkipped = 0;
  let read = 0;

  for (const org of candidates) {
    const remaining = cfg.maxTeams - read;
    if (remaining <= 0) {
      limitReached = true;
      break;
    }
    const r = await ctx.limit(() => ctx.provider.listOrgTeams(org, { max: remaining }));
    if (!r.ok && r.error.classification === 'not-found') continue; // a user account
    orgs.push(org);
    if (!r.ok) {
      err(org, r);
      listingFailures.push(r.error.classification);
      continue;
    }
    const slugs = new Set<string>();
    for (const t of r.data.teams) {
      slugs.add(lower(t.slug));
      read += 1;
      if (t.privacy === 'secret') {
        secretSkipped += 1;
        continue;
      }
      if (!TEAM_REF.test(`${org}/${t.slug}`)) continue;
      found.push({ org, slug: t.slug });
    }
    if (r.data.limitReached) limitReached = true;
    else listed.set(lower(org), slugs);
  }

  const notAuthorised =
    listingFailures.length > 0 &&
    listingFailures.length === orgs.length &&
    listingFailures.every((c) => c === 'not-authorised');

  const teams: ReadTeam[] = await Promise.all(
    found.map(async ({ org, slug }) => {
      const r = await ctx.limit(() => ctx.provider.listTeamRepositories(org, slug));
      err(`${org}/${slug}`, r);
      return {
        ref: `${org}/${slug}`,
        slug,
        repos: r.ok
          ? new Map(r.data.map((x: TeamRepositoryDTO) => [lower(x.fullName), x.permission]))
          : null,
      };
    }),
  );

  /** Teams proposed for a project: write access first, then a matching name. */
  const proposeFor = (p: ProjectConfig): TeamsResult['suggestions'] => {
    const present = new Set(p.teams.map(lower));
    const repos = reposOf(p);
    const out: TeamsResult['suggestions'] = [];
    for (const t of teams) {
      if (present.has(lower(t.ref))) continue;
      const write = t.repos
        ? repos.filter((r) => {
            const perm = t.repos!.get(r);
            return perm != null && WRITE.has(perm);
          }).length
        : 0;
      const byName = parseTeamName(t.slug, cfg.naming)?.project === p.id;
      if (write > 0 || byName) {
        out.push({
          projectId: p.id,
          team: t.ref,
          reason: write > 0 ? 'access' : 'name',
          writeRepositories: write,
          totalRepositories: repos.length,
        });
      }
    }
    return out;
  };

  const suggestions = catalog.projects
    .flatMap(proposeFor)
    .sort((a, b) => a.projectId.localeCompare(b.projectId) || a.team.localeCompare(b.team));

  // A team is "not found" only where its org was listed in full; otherwise we cannot tell.
  const notFound: TeamsResult['notFound'] = limitReached
    ? []
    : catalog.projects.flatMap((p) =>
        p.teams
          .filter((ref) => {
            const slugs = listed.get(lower(ownerOf(ref)));
            return slugs !== undefined && !slugs.has(lower(teamSlug(ref)));
          })
          .map((team) => ({ projectId: p.id, team })),
      );

  const status: TeamsResult['status'] = notAuthorised
    ? 'not-authorised'
    : errors.length > 0 || limitReached
      ? 'partial'
      : 'ok';

  // New-project proposals start with the teams GitHub suggests, and the business unit of a
  // team named after them.
  const filled: DiscoveryResult | null = discovery && {
    ...discovery,
    proposals: discovery.proposals.map((proposal) => {
      if (proposal.projectId !== null) return proposal;
      const proposed = proposeFor(proposal.project);
      if (!proposed.length) return proposal;
      const named = proposed
        .map((s) => parseTeamName(teamSlug(s.team), cfg.naming))
        .find((n) => n?.project === proposal.project.id);
      return {
        ...proposal,
        project: {
          ...proposal.project,
          teams: proposed.map((s) => s.team).sort(),
          ...(named ? { businessUnit: named.businessUnit } : {}),
        },
      };
    }),
  };

  return {
    teams: {
      status,
      orgs,
      teamsRead: read,
      secretSkipped,
      limitReached,
      suggestions: notAuthorised ? [] : suggestions,
      notFound: notAuthorised ? [] : notFound,
      errors,
    },
    discovery: filled,
  };
}
