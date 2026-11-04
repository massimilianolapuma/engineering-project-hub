import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ChangesFileSchema, PortfolioIndexSchema } from '@model/index';
import { appendLedger, LedgerSchema, type Ledger } from '../../notifier/src/ledger';
import { resolveMode } from '../../notifier/src/mode';

/*
 * D8: send only when every opt-in holds and the data is real and compared; otherwise dry-run,
 * naming the first condition that failed. D11: the ledger keeps the newest 200 sends, no URL.
 */
const read = (f: string) => JSON.parse(readFileSync(`fixtures/snapshots/${f}`, 'utf8')) as unknown;
const real = () => {
  const index = PortfolioIndexSchema.parse(read('index.json'));
  index.run.dataSource = 'github';
  const changes = ChangesFileSchema.parse(read('changes.json'));
  changes.basis.synthetic = false;
  return { index, changes };
};
const base = () => ({
  configMode: 'send' as const,
  variable: 'send',
  envSource: 'github',
  ...real(),
});

describe('resolveMode', () => {
  it('sends when every condition holds', () => {
    expect(resolveMode(base())).toEqual({ mode: 'send' });
  });

  it.each([
    ['mode-config', (o: ReturnType<typeof base>) => ({ ...o, configMode: 'dry-run' as const })],
    ['mode-variable', (o: ReturnType<typeof base>) => ({ ...o, variable: 'dry-run' })],
    ['mode-variable', (o: ReturnType<typeof base>) => ({ ...o, variable: undefined })],
    ['mock-data', (o: ReturnType<typeof base>) => ({ ...o, envSource: 'mock' })],
    [
      'mock-data',
      (o: ReturnType<typeof base>) => {
        o.index.run.dataSource = 'mock';
        return o;
      },
    ],
    [
      'not-compared',
      (o: ReturnType<typeof base>) => {
        o.changes.basis.state = 'none';
        return o;
      },
    ],
    [
      'synthetic',
      (o: ReturnType<typeof base>) => {
        o.changes.basis.synthetic = true;
        return o;
      },
    ],
  ])('dry-run (%s)', (reason, change) => {
    expect(resolveMode(change(base()))).toEqual({ mode: 'dry-run', reason });
  });

  it('names the first failing condition', () => {
    expect(resolveMode({ ...base(), configMode: 'dry-run', envSource: 'mock' })).toEqual({
      mode: 'dry-run',
      reason: 'mode-config',
    });
  });
});

describe('ledger', () => {
  const empty: Ledger = { kind: 'hub-notify-ledger', schemaVersion: '1.0', entries: [] };

  it('keeps the newest 200 entries', () => {
    let l = empty;
    for (let i = 0; i < 205; i++)
      l = appendLedger(l, {
        target: 'teams',
        key: i.toString(16).padStart(16, '0'),
        sentAt: '2026-11-04T10:00:00.000Z',
      });
    expect(l.entries).toHaveLength(200);
    expect(l.entries.at(-1)!.key).toBe((204).toString(16).padStart(16, '0'));
    expect(LedgerSchema.safeParse(l).success).toBe(true);
  });

  it('refuses any extra field (no URL, no payload)', () => {
    expect(
      LedgerSchema.safeParse({
        ...empty,
        entries: [
          {
            target: 'teams',
            key: '0123456789abcdef',
            sentAt: '2026-11-04T10:00:00.000Z',
            url: 'x',
          },
        ],
      }).success,
    ).toBe(false);
  });
});
