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

it('recognises control words after the actual app mention and gives end precedence', () => {
  expect(parseHumanAddress('@first <@UAPP> STOP!', APP, ROSTER)).toEqual({
    kind: 'stop',
  });
  expect(parseHumanAddress('@council stop @council end.', APP, ROSTER)).toEqual(
    { kind: 'end' },
  );
  expect(parseHumanAddress('@council `hidden` stop', APP, ROSTER)).toEqual({
    kind: 'council',
  });
  expect(parseHumanAddress('@council stopper', APP, ROSTER)).toEqual({
    kind: 'council',
  });
});

it('keeps only other roster handles in member output', () => {
  expect(
    parseMemberMentions(
      '@council <@UAPP> @first @second @second `@deep-review` @missing',
      'first',
      ROSTER,
    ),
  ).toEqual(['second']);
});

it('ignores handles in Markdown tilde fences until a matching closing fence', () => {
  const text = '~~~~md\n@council end\n~~~\n@first\n~~~~\n@second';
  expect(parseHumanAddress(text, APP, ROSTER)).toEqual({
    kind: 'members',
    handles: ['second'],
  });
});
