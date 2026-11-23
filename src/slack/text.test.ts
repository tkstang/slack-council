import { describe, expect, it } from 'vitest';

import {
  chunkMarkdown,
  neutraliseBroadcasts,
  renderSlackText,
} from './text.js';

describe('neutraliseBroadcasts', () => {
  it.each([
    ['@here look', false],
    ['ping @channel now', false],
    ['@everyone', false],
    ['<!here> and <!channel|channel>', false],
    ['<!subteam^S123|@team>', false],
    ['email me at a@here.com', true],
    ['@hereafter is a word', true],
  ])('%s', (text, unchanged) => {
    const out = neutraliseBroadcasts(text);
    expect(out === text).toBe(unchanged);
    expect(out).not.toMatch(
      /<!|(?<![\w])@(?:here|channel|everyone)\b(?!after)/u,
    );
  });
});

describe('renderSlackText', () => {
  it('renders Slack markup as readable text', () => {
    expect(
      renderSlackText(
        '<@UAPP> ask <@U1> in <#C9|general> about <https://x.test|the doc> &lt;a&gt; &amp; <!here>',
        { botUserId: 'UAPP', name: (id) => (id === 'U1' ? 'Jane' : id) },
      ),
    ).toBe(
      '@council ask @Jane in #general about the doc (https://x.test) <a> & @here',
    );
  });
});

const fences = (chunk: string) =>
  chunk.split('\n').filter((line) => line.startsWith('```')).length;
const strip = (chunk: string) =>
  chunk.replaceAll(/^```.*$/gmu, '').replaceAll('\n', '');

describe('chunkMarkdown', () => {
  it.each([
    ['short text', 'hello', 20, false],
    [
      'plain lines',
      Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n'),
      20,
      true,
    ],
    ['one long line', 'x'.repeat(95), 40, true],
    [
      'code block across a boundary',
      [
        'intro',
        '```ts',
        ...Array.from({ length: 8 }, (_, i) => `const v${i} = ${i};`),
        '```',
        'outro',
      ].join('\n'),
      60,
      true,
    ],
  ])('%s', (_, text, limit, split) => {
    const chunks = chunkMarkdown(text, limit);
    expect(chunks.length > 1).toBe(split);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(limit);
      expect(fences(chunk) % 2).toBe(0);
    }
    expect(chunks.map(strip).join('')).toBe(strip(text));
  });
});
