import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ChangesFileSchema, NotificationsConfigSchema, PortfolioIndexSchema } from '@model/index';
import { en } from '../../src/i18n/en';
import { it as itDict } from '../../src/i18n/it';
import { buildDigest } from '../../notifier/src/digest';
import type { Digest } from '../../notifier/src/model';
import { escapeTeamsMarkdown, renderTeams } from '../../notifier/src/render/teams';

/*
 * Teams Workflows webhook body (spec §5.5.4): a "message" with one Adaptive Card 1.5. Status words
 * always written, project names escaped, links only to the hub, body under the size cap.
 */
const read = (f: string) => JSON.parse(readFileSync(`fixtures/snapshots/${f}`, 'utf8')) as unknown;
const digestWith = (extra: Record<string, unknown> = {}): Digest =>
  buildDigest(
    ChangesFileSchema.parse(read('changes.json')),
    PortfolioIndexSchema.parse(read('index.json')),
    NotificationsConfigSchema.parse({ schemaVersion: '1.0', ...extra }),
  )!;
type Block = { type: string; text?: string; items?: Block[]; url?: string };
type Card = {
  type: string;
  attachments: {
    contentType: string;
    contentUrl: null;
    content: { type: string; version: string; body: Block[]; actions?: Block[] };
  }[];
};
const texts = (blocks: Block[]): string[] =>
  blocks.flatMap((b) => [...(b.text ? [b.text] : []), ...texts(b.items ?? [])]);

describe('renderTeams', () => {
  const { body, bytes, omitted } = renderTeams(digestWith(), en);
  const card = body as Card;
  const content = card.attachments[0]!.content;

  it('is a message with one Adaptive Card 1.5', () => {
    expect(card.type).toBe('message');
    expect(card.attachments).toHaveLength(1);
    expect(card.attachments[0]!.contentType).toBe('application/vnd.microsoft.card.adaptive');
    expect(content.type).toBe('AdaptiveCard');
    expect(content.version).toBe('1.5');
    expect(bytes).toBe(Buffer.byteLength(JSON.stringify(body), 'utf8'));
    expect(omitted).toBe(0);
  });

  it('says what happened in words', () => {
    const t = texts(content.body);
    expect(t[0]).toBe('Engineering hub: 2 projects need attention');
    expect(t[1]).toBe('Compared with the collection of 14 Jan 2026, 12:00 UTC');
    expect(t).toContain('Project Beta: Critical (was Attention)');
    expect(t).toContain('1 new critical alert');
    expect(t).toContain('1 high alert past the remediation deadline');
    expect(t).toContain('1 security exception expired');
    expect(t).toContain('Score 58 → 40');
  });

  it('has no link without siteUrl and only hub links with it', () => {
    // The card's $schema is the only URL allowed besides the hub link.
    expect(
      JSON.stringify(body).replace('http://adaptivecards.io/schemas/adaptive-card.json', ''),
    ).not.toContain('http');
    expect(content.actions).toBeUndefined();
    const linked = renderTeams(digestWith({ siteUrl: 'https://hub.example.com/' }), en)
      .body as Card;
    const json = JSON.stringify(linked);
    expect(linked.attachments[0]!.content.actions?.[0]).toMatchObject({
      type: 'Action.OpenUrl',
      url: 'https://hub.example.com/changes/',
    });
    expect(
      json.match(/https?:\/\/[^"\\]+/g)?.filter((u) => !u.includes('adaptivecards.io')),
    ).toEqual(['https://hub.example.com/changes/']);
    const it = renderTeams(
      digestWith({ siteUrl: 'https://hub.example.com/', locale: 'it' }),
      itDict,
    ).body as Card;
    expect(it.attachments[0]!.content.actions?.[0]?.url).toBe(
      'https://hub.example.com/it/changes/',
    );
  });

  it('never turns a project name into a link or a list', () => {
    const name = 'Pay see https://github.com/example-org/x\n- item\r\n1. two';
    const out = escapeTeamsMarkdown(name);
    expect(out).not.toMatch(/https?:\/\//);
    expect(out).not.toMatch(/[\r\n]/);
    expect(out.replace(/\u200b/g, '')).toContain('https://github.com');
  });

  it('escapes markdown and HTML in project names', () => {
    const d = digestWith();
    d.projects[0]!.name = '[x](http://evil) **b** <i>';
    const t = texts((renderTeams(d, en).body as Card).attachments[0]!.content.body);
    expect(
      t.some((s) => s.startsWith('\\[x\\]\\(http:/\u200b/evil\\) \\*\\*b\\*\\* &lt;i&gt;')),
    ).toBe(true);
    expect(escapeTeamsMarkdown('a_b~c#d>e`f\\g')).toBe('a\\_b\\~c\\#d\\>e\\`f\\\\g');
  });

  it('drops projects from the end to stay under the size cap', () => {
    const d = digestWith();
    const base = d.projects[0]!;
    d.projects = Array.from({ length: 50 }, (_, i) => ({
      ...base,
      id: `p-${i}`,
      name: 'N'.repeat(100),
    }));
    const r = renderTeams(d, en, 4000);
    expect(r.bytes).toBeLessThanOrEqual(4000);
    expect(r.omitted).toBeGreaterThan(0);
    const t = texts((r.body as Card).attachments[0]!.content.body);
    expect(t.at(-1)).toMatch(/^\d+ more projects$/);
  });
});
