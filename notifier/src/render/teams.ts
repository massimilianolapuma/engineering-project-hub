import type { Dict } from '../../../src/i18n/en';
import type { Digest, DigestProject } from '../model';

/*
 * Microsoft Teams Workflows webhook body (spec §5.5.4): a "message" with one Adaptive Card 1.5.
 * Every visible string comes from the i18n catalogue; status words are always written; project
 * names (catalog text) are escaped; the only link is the hub's own "What changed" page.
 */

/** Below the ~28 KB Teams message limit. */
export const TEAMS_MAX_BYTES = 24_576;

/** Backslash-escapes Teams markdown and neutralises HTML in text from the catalog. */
export function escapeTeamsMarkdown(text: string): string {
  return text
    .replace(/</g, '&lt;')
    .replace(/(&lt;[^&>]*)>/g, '$1&gt;')
    .replace(/[\\*_[\]()#>~`]/g, (c) => `\\${c}`);
}

const fill = (template: string, params: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? '—'));
const pick = (n: number, one: string, many: string) => fill(n === 1 ? one : many, { n });

type Block = Record<string, unknown>;
const text = (t: string, extra: Block = {}): Block => ({
  type: 'TextBlock',
  text: t,
  wrap: true,
  ...extra,
});

function projectBlock(p: DigestProject, d: Dict): Block {
  const n = d.notify;
  const status = (s: keyof Dict['status']) => d.status[s];
  const head =
    p.overall.from === null || p.overall.from === p.overall.to
      ? status(p.overall.to)
      : fill(n.statusWas, { to: status(p.overall.to), from: status(p.overall.from) });
  const facts: string[] = [];
  for (const x of p.dimensions)
    facts.push(
      `${d.dimensions[x.dimension]}: ${fill(n.statusWas, { to: status(x.to), from: status(x.from) })}`,
    );
  if (p.newFindings.critical)
    facts.push(pick(p.newFindings.critical, n.newCriticalOne, n.newCritical));
  if (p.newFindings.high) facts.push(pick(p.newFindings.high, n.newHighOne, n.newHigh));
  if (p.newlyOverdue.critical)
    facts.push(pick(p.newlyOverdue.critical, n.overdueCriticalOne, n.overdueCritical));
  if (p.newlyOverdue.high) facts.push(pick(p.newlyOverdue.high, n.overdueHighOne, n.overdueHigh));
  if (p.expiredExceptions)
    facts.push(pick(p.expiredExceptions, n.expiredExceptionsOne, n.expiredExceptions));
  if (p.newErrors) facts.push(pick(p.newErrors, n.newErrorsOne, n.newErrors));
  if (p.score.from !== null && p.score.to !== null && p.score.from !== p.score.to)
    facts.push(fill(n.score, { from: p.score.from, to: p.score.to }));
  return {
    type: 'Container',
    separator: true,
    items: [
      text(`${escapeTeamsMarkdown(p.name)}: ${head}`, { weight: 'Bolder' }),
      ...facts.map((f) => text(f, { spacing: 'None' })),
    ],
  };
}

function card(digest: Digest, d: Dict, projects: DigestProject[], more: number): Block {
  const n = d.notify;
  const date = new Intl.DateTimeFormat(digest.locale === 'it' ? 'it-IT' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(digest.previousCollectedAt));
  const body: Block[] = [
    text(pick(digest.totals.projects, n.titleOne, n.title), { weight: 'Bolder', size: 'Medium' }),
    text(fill(n.compared, { date: `${date} UTC` }), { isSubtle: true }),
    ...projects.map((p) => projectBlock(p, d)),
  ];
  if (more > 0) body.push(text(pick(more, n.moreOne, n.more), { isSubtle: true }));
  const content: Block = {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.5',
    body,
  };
  if (digest.siteUrl)
    content.actions = [
      {
        type: 'Action.OpenUrl',
        title: n.openChanges,
        url: `${digest.siteUrl}${digest.locale === 'it' ? 'it/' : ''}changes/`,
      },
    ];
  return {
    type: 'message',
    attachments: [
      { contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content },
    ],
  };
}

export function renderTeams(
  digest: Digest,
  d: Dict,
  maxBytes = TEAMS_MAX_BYTES,
): { body: unknown; bytes: number; omitted: number } {
  const size = (b: unknown) => Buffer.byteLength(JSON.stringify(b), 'utf8');
  let shown = digest.projects.length;
  for (;;) {
    const dropped = digest.projects.length - shown;
    const body = card(digest, d, digest.projects.slice(0, shown), digest.omittedProjects + dropped);
    const bytes = size(body);
    if (bytes <= maxBytes || shown === 0) return { body, bytes, omitted: dropped };
    shown--;
  }
}
