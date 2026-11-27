import { expect, it } from 'vitest';

import { parseListenOutput, parseTurnOutput } from './output.js';

it.each(['PASS', '**PASS**', 'Pass.', ' _**pAsS!**_…  ', '*PASS*', 'pass?!'])(
  'treats a standalone %s as a pass',
  (text) => {
    expect(parseTurnOutput(text)).toEqual({ kind: 'pass' });
    expect(parseTurnOutput(text, 'react')).toEqual({ kind: 'pass' });
    expect(parseListenOutput(text, new Map())).toEqual({ kind: 'pass' });
  },
);

it.each([
  { text: 'Pass. Here is why.', reactPass: true },
  {
    text: "PASS. I agree with Bo's figures: a rise of 6, or 60%, from 10 to 16.",
    reactPass: true,
  },
  { text: '**PASS** — nothing to add', reactPass: true },
  { text: 'PASS\nNothing to add', reactPass: true },
  { text: '_**PASS!**_ Nothing to add', reactPass: true },
  { text: 'PASS - nothing to add', reactPass: true },
  { text: 'PASS -- nothing to add', reactPass: true },
  { text: '**PASS. Nothing to add.**', reactPass: true },
  { text: 'I agree with Bo. PASS.', reactPass: true },
  { text: 'I agree with Bo! **Pass.**', reactPass: true },
  { text: 'PASS on the cost point: continue the work.', reactPass: false },
  { text: 'PASS: Bo is wrong about churn.', reactPass: false },
  { text: 'Pass–fail thresholds should be 80%, not 70%.', reactPass: false },
  { text: 'Consider using PASS', reactPass: false },
  { text: '@critic PASS', reactPass: false },
  { text: 'PASS*', reactPass: false },
  { text: 'PASSAGE', reactPass: false },
  { text: '`PASS`', reactPass: false },
])('parses "$text" according to the turn kind', ({ text, reactPass }) => {
  const message = { kind: 'message', text };
  expect(parseTurnOutput(text, 'round')).toEqual(message);
  expect(parseTurnOutput(text, 'mention')).toEqual(message);
  expect(parseListenOutput(text, new Map())).toEqual({ kind: 'invalid' });
  expect(parseTurnOutput(text, 'react')).toEqual(
    reactPass ? { kind: 'pass' } : message,
  );
});

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
