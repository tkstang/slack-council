import { describe, expect, it } from 'vitest';

import {
  linkPeopleMentions,
  neutraliseBroadcasts,
  renderSlackText,
  truncateMarkdown,
} from './text.js';

describe('neutraliseBroadcasts', () => {
  it.each([
    ['@here look', false],
    ['ping @channel now', false],
    ['@everyone', false],
    ['<!here> and <!channel|channel>', false],
    ['<!subteam^S123|@team>', false],
    ['ping <@U123ABC> and <@W9|pat>', false],
    ['email me at a@here.com', true],
    ['@hereafter is a word', true],
  ])('%s', (text, unchanged) => {
    const out = neutraliseBroadcasts(text);
    expect(out === text).toBe(unchanged);
    expect(out).not.toMatch(
      /<[!@]|(?<![\w])@(?:here|channel|everyone)\b(?!after)/u,
    );
  });

  it('neutralises inside code too, so an unclosed fence cannot smuggle a mention', () => {
    expect(neutraliseBroadcasts('```\n<!channel> `<@U1>`')).toBe(
      '```\n@\u2060channel `@\u2060U1`',
    );
  });
});

describe('linkPeopleMentions', () => {
  const handles = new Set(['bo', 'ann-lee']);
  const post = (text: string, names: string[]) =>
    linkPeopleMentions(
      text,
      new Map(names.map((name, index) => [`U${index + 1}`, name])),
      handles,
    );

  it('links whole names, longest first, and nothing a handle could claim', () => {
    const names = ['Ann', 'Ann Lee', 'bo', 'Bo Diaz', 'Ann-Lee Smith'];
    expect(
      post('Ask @ann lee, then (@Ann). Not @Annabel or @Zed. a@ann.io', names),
    ).toBe('Ask <@U2>, then (<@U1>). Not @Annabel or @Zed. a@ann.io');
    const untouched = '@bo @ann-lee @Bo Diaz @Ann-Lee Smith';
    expect(post(untouched, names)).toBe(untouched);
  });

  it('leaves a name two people share, without falling back to a shorter one', () => {
    const names = ['Ann', 'Ann Lee', 'ann lee', 'Sam', '\u017Fam'];
    const untouched = 'Ask @Ann Lee or @Sam';
    expect(post(untouched, names)).toBe(untouched);
    expect(post('Ask @Ann', names)).toBe('Ask <@U1>');
  });

  it('never keeps or builds a mention from markup the model wrote', () => {
    const names = ['Ann', 'Zoe', '\u2060U9'];
    const posted = post(
      '<@U1> <@U9> <@U8|x @Zoe> <!here> @here <https://x.io/@Ann|see @Ann> @Ann',
      names,
    );
    expect(posted.match(/<[@!][^>]*>/gu)).toEqual(['<@U1>']);
    expect(posted.endsWith('<https://x.io/@Ann|see @Ann> <@U1>')).toBe(true);
    expect(posted).not.toMatch(/(?<!\w)@here/u);
  });
});

describe('renderSlackText', () => {
  it('renders Slack markup as readable text', () => {
    expect(
      renderSlackText(
        '<@UAPP> ask <@U1> in <#C9|general> about <https://x.test|the doc> &lt;a&gt; &amp; <!here> <div>',
        { botUserId: 'UAPP', name: (id) => (id === 'U1' ? 'Jane' : id) },
      ),
    ).toBe(
      '@council ask @Jane in #general about the doc (https://x.test) <a> & @here <div>',
    );
  });
});

describe('truncateMarkdown', () => {
  it.each([
    ['short text', 'hello', 'hello'],
    ['plain text', 'x'.repeat(50), `${'x'.repeat(26)}\n… (truncated)`],
    ['only backticks', '`'.repeat(50), `${'`'.repeat(26)}\n… (truncated)`],
    [
      'inside a handle',
      `${'x'.repeat(20)} @ada-2 and more text here`,
      `${'x'.repeat(20)}\n… (truncated)`,
    ],
    [
      'before an emoji',
      `${'z'.repeat(25)}${'😀'.repeat(10)}`,
      `${'z'.repeat(25)}\n… (truncated)`,
    ],
  ])('%s', (_, text, expected) => {
    const out = truncateMarkdown(text, 40);
    expect(out).toBe(expected);
    expect(out.length).toBeLessThanOrEqual(40);
  });
});
