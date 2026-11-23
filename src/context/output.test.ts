import { expect, it } from 'vitest';

import { parseTurnOutput } from './output.js';

it.each(['PASS', '**PASS**', 'Pass.', ' _**pAsS!**_…  ', '*PASS*', 'pass?!'])(
  'treats a standalone %s as a pass',
  (text) => expect(parseTurnOutput(text)).toEqual({ kind: 'pass' }),
);

it.each(['Pass. Here is why.', '@critic PASS', 'PASS*', 'PASSAGE', '`PASS`'])(
  'preserves substantive output %s',
  (text) => expect(parseTurnOutput(text)).toEqual({ kind: 'message', text }),
);
