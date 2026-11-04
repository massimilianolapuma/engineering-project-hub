import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

/*
 * D11: which change sets were already sent, per target. Kept as the repository's own
 * hub-notify-ledger artifact (90 days). It holds no URL, issue key or payload.
 */
export const LEDGER_MAX_ENTRIES = 200;

export const LedgerSchema = z
  .object({
    kind: z.literal('hub-notify-ledger'),
    schemaVersion: z.literal('1.0'),
    entries: z
      .array(
        z
          .object({
            target: z.literal('teams'),
            key: z.string().regex(/^[0-9a-f]{16}$/),
            sentAt: z.string().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/),
          })
          .strict(),
      )
      .max(LEDGER_MAX_ENTRIES),
  })
  .strict();
export type Ledger = z.infer<typeof LedgerSchema>;
export type LedgerEntry = Ledger['entries'][number];

export const emptyLedger = (): Ledger => ({
  kind: 'hub-notify-ledger',
  schemaVersion: '1.0',
  entries: [],
});

/** A missing file is an empty ledger; an unreadable or invalid one throws. */
export function loadLedger(path: string): Ledger {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return emptyLedger();
    throw new Error('ledger not readable', { cause: e });
  }
  return LedgerSchema.parse(JSON.parse(text));
}

export function appendLedger(ledger: Ledger, entry: LedgerEntry): Ledger {
  return { ...ledger, entries: [...ledger.entries, entry].slice(-LEDGER_MAX_ENTRIES) };
}

export function saveLedger(path: string, ledger: Ledger): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(LedgerSchema.parse(ledger), null, 2)}\n`, 'utf8');
}
