import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { ExceptionsFileSchema } from '@model/index';
import { SCHEMA_TARGETS, renderSchema } from '../../scripts/generate-json-schema';

describe('generated JSON Schemas', () => {
  it('every committed config/schema/*.json equals renderSchema(target)', () => {
    for (const [file, schema] of SCHEMA_TARGETS) {
      const committed = readFileSync(`config/schema/${file}`, 'utf8');
      expect(
        committed === renderSchema(schema),
        `config/schema/${file} is out of date: run npm run schema:generate`,
      ).toBe(true);
    }
  });

  it('config/exceptions.yaml parses with ExceptionsFileSchema and has 0 exceptions', () => {
    const parsed = ExceptionsFileSchema.parse(
      parse(readFileSync('config/exceptions.yaml', 'utf8')),
    );
    expect(parsed.exceptions).toHaveLength(0);
  });
});
