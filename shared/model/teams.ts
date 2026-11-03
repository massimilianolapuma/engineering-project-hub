import { z } from 'zod';

/**
 * A GitHub team reference, "<org>/<team-slug>". Slugs are lowercase in GitHub's API, so the
 * slug part must be lowercase; the org follows GitHub's owner rules.
 */
export const TEAM_REF = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[a-z0-9][a-z0-9_-]{0,99}$/;

export const TeamRefSchema = z
  .string()
  .max(141)
  .regex(TEAM_REF, 'must be "org/team-slug" (the slug in lowercase)');

/** The part of a team reference after the org: the slug used in `?team=` links. */
export function teamSlug(ref: string): string {
  return ref.slice(ref.indexOf('/') + 1);
}

const PLACEHOLDERS = ['{line}', '{project}', '{role}'] as const;
const token = z.string().regex(/^[a-z0-9][a-z0-9-]{0,49}$/, 'must be a lowercase slug');

/**
 * How project teams are named, for example "{line}-{project}-{role}": a business line key, the
 * project id and a role, separated by "-". Used to group teams and to suggest teams by name.
 */
export const TeamNamingSchema = z
  .object({
    pattern: z.string().refine((p) => {
      const parts = p.split('-');
      return (
        parts.length === 3 && PLACEHOLDERS.every((ph) => parts.filter((x) => x === ph).length === 1)
      );
    }, 'must use {line}, {project} and {role} once each, separated by "-"'),
    /** Known role suffixes, for example dev, ops. */
    roles: z.array(token).min(1).max(50),
    /** Business line key → business unit shown in the hub. */
    lines: z.record(token, z.string().min(1).max(100)),
  })
  .strict();
export type TeamNaming = z.infer<typeof TeamNamingSchema>;

/** config/catalog.yaml `teams`: team discovery and the naming rule. */
export const TeamsConfigSchema = z
  .object({
    /** Read organisation teams (Members: read). Forced off when publication.audience is "public". */
    discovery: z.boolean().default(false),
    naming: TeamNamingSchema.optional(),
    /** Upper bound on teams read per run, across organisations (API budget). */
    maxTeams: z.number().int().min(1).max(1000).default(300),
  })
  .strict();
export type TeamsConfig = z.infer<typeof TeamsConfigSchema>;

export interface ParsedTeamName {
  line: string;
  project: string;
  role: string;
  businessUnit: string;
}

/**
 * Splits a team slug by the naming rule. Returns null unless the line and the role are known
 * values and a non-empty project is left over: a half-matching name is a cross team.
 */
export function parseTeamName(slug: string, naming: TeamNaming | undefined): ParsedTeamName | null {
  if (!naming) return null;
  const order = naming.pattern.split('-').map((p) => p.slice(1, -1)) as (
    'line' | 'project' | 'role'
  )[];
  const segs = slug.split('-');
  if (segs.some((s) => s === '')) return null;
  const candidates = (ph: 'line' | 'role') =>
    (ph === 'line' ? Object.keys(naming.lines) : naming.roles)
      .map((v) => v.split('-'))
      .sort((a, b) => b.length - a.length);
  const found: { line?: string; role?: string } = {};
  const p = order.indexOf('project');
  let start = 0;
  let end = segs.length;
  for (const ph of order.slice(0, p) as ('line' | 'role')[]) {
    const hit = candidates(ph).find(
      (v) => start + v.length <= end && v.every((x, i) => segs[start + i] === x),
    );
    if (!hit) return null;
    found[ph] = hit.join('-');
    start += hit.length;
  }
  for (const ph of (order.slice(p + 1) as ('line' | 'role')[]).reverse()) {
    const hit = candidates(ph).find(
      (v) => end - v.length >= start && v.every((x, i) => segs[end - v.length + i] === x),
    );
    if (!hit) return null;
    found[ph] = hit.join('-');
    end -= hit.length;
  }
  if (start >= end) return null;
  const line = found.line!;
  return {
    line,
    project: segs.slice(start, end).join('-'),
    role: found.role!,
    businessUnit: naming.lines[line]!,
  };
}
