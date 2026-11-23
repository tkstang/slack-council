import { expect, it } from 'vitest';

import { parseListenOutput, parseTurnOutput } from './output.js';

it.each(['PASS', '**PASS**', 'Pass.', ' _**pAsS!**_…  ', '*PASS*', 'pass?!'])(
  'treats a standalone %s as a pass',
  (text) => {
    expect(parseTurnOutput(text)).toEqual({ kind: 'pass' });
    expect(parseListenOutput(text, new Map())).toEqual({ kind: 'pass' });
  },
);

it.each(['Pass. Here is why.', '@critic PASS', 'PASS*', 'PASSAGE', '`PASS`'])(
  'preserves substantive output %s',
  (text) => expect(parseTurnOutput(text)).toEqual({ kind: 'message', text }),
);

const targets = new Map([[3, '10.006']]);
it.each(['HAND #3:', 'hand # 3:', 'Hand [#3]:'])(
  'accepts a hand with %s and resolves the shown number',
  (header) => {
    expect(
      parseListenOutput(` ${header} Revisit the scope.\n`, targets),
    ).toEqual({
      kind: 'hand',
      targetTs: '10.006',
      note: 'Revisit the scope.',
    });
  },
);

it.each([
  'PASS with caveats',
  'HAND #3:',
  'HAND [#3: Imbalanced',
  'HAND #4: Missing',
])('rejects %s', (text) =>
  expect(parseListenOutput(text, targets)).toEqual({ kind: 'invalid' }),
);
