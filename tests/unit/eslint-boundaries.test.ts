import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

/*
 * D7: the collector (source credentials) and the notifier (target credentials) never share code
 * paths. ESLint refuses imports across the boundary.
 */
const eslint = new ESLint();
const restricted = async (filePath: string, code: string) => {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-imports');
};

describe('import boundaries', () => {
  it('the notifier cannot import the collector', async () => {
    expect(
      await restricted(
        'notifier/src/x.ts',
        "import { runCollection } from '../../collector/src/run';\nvoid runCollection;\n",
      ),
    ).toHaveLength(1);
  });

  it('the collector, the site and shared code cannot import the notifier', async () => {
    for (const file of ['collector/src/x.ts', 'src/lib/x.ts', 'shared/http/x.ts'])
      expect(
        await restricted(
          file,
          "import { postOnce } from '../../notifier/src/http';\nvoid postOnce;\n",
        ),
        file,
      ).toHaveLength(1);
  });

  it('the notifier may use the shared HTTP core', async () => {
    expect(
      await restricted(
        'notifier/src/x.ts',
        "import { hostAllowed } from '../../shared/http/bounded-read';\nvoid hostAllowed;\n",
      ),
    ).toHaveLength(0);
  });
});
