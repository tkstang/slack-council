import { expect, it } from 'vitest';

import { parseHumanAddress, parseMemberMentions } from './addressing.js';

const ROSTER = ['first', 'second', 'deep-review'];
const APP = 'UAPP';

it.each(['@council', '<@UAPP>', 'Please<@UAPP>', '@first @council'])(
  'opens the whole roster for %s',
  (text) =>
    expect(parseHumanAddress(text, APP, ROSTER)).toEqual({ kind: 'council' }),
);

it('identifies unique member tokens and ignores other Slack mentions, links and partial handles', () => {
  expect(
    parseHumanAddress(
      'ask (@deep-review), @first @first @firstish @second_extra @secondÉ a@second.com @@second <@UOTHER> <https://example.com|@second> https://example.com/@second',
      APP,
      ROSTER,
    ),
  ).toEqual({ kind: 'members', handles: ['deep-review', 'first'] });
});

it('ignores fenced code, code spans, escaped handles and quoted lines', () => {
  const text = [
    '> @council stop',
    '  &gt; @first',
    '`@first` and ``literal ` @first``',
    '```js',
    '@first @council',
    '```',
    '\\@first and ```@first``` but @second',
    '>>> quoted until the end',
    '@council end',
  ].join('\n');
  expect(parseHumanAddress(text, APP, ROSTER)).toEqual({
    kind: 'members',
    handles: ['second'],
  });
});

it.each([
  ['@first <@UAPP> STOP!', 'stop'],
  ['@council stop @council end.', 'end'],
  ['@council `hidden` stop', 'council'],
  ['@council stopper', 'council'],
  ['@council, end users are complaining', 'council'],
  ['@council stop me if I am wrong', 'council'],
  ['@council stop\nthanks', 'stop'],
  ['@council end\u00a0', 'end'],
  ['@council: stop', 'stop'],
  ['@council, end', 'end'],
  ['<@UAPP>:stop', 'stop'],
])('recognises %s as %s', (text, kind) => {
  expect(parseHumanAddress(text, APP, ROSTER)).toEqual({ kind });
});

it('accepts case-insensitive handles in Slack emphasis', () => {
  expect(parseHumanAddress('_@First_ *@SECOND*', APP, ROSTER)).toEqual({
    kind: 'members',
    handles: ['first', 'second'],
  });
});

it.each([
  [
    '@council <@UAPP> @first @second @second `@deep-review` <mailto:team@example.com|@deep-review> @missing',
    ['second'],
  ],
  ['if a < b ask @second, c > d', ['second']],
  ['_@Second_ *@DEEP-REVIEW*', ['second', 'deep-review']],
])('finds other roster handles in %s', (text, expected) => {
  expect(parseMemberMentions(text, 'first', ROSTER)).toEqual(expected);
});

it('ignores handles in Markdown tilde fences until a matching closing fence', () => {
  const text = '~~~~md\n@council end\n~~~\n@first\n~~~~\n@second';
  expect(parseHumanAddress(text, APP, ROSTER)).toEqual({
    kind: 'members',
    handles: ['second'],
  });
});
