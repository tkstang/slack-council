import type { TurnInput } from '@council/core/ports.js';
import { success } from '@council/core/result.js';
import { expect, it, vi } from 'vitest';

import { createSlackHistoryTool } from './slack-history.js';

it('reads only the bound council scope before the transcript and renders the requested window', async () => {
  const scope = { channel: 'C1', threadTs: '1.000000' };
  const input: TurnInput = {
    councilId: 'council',
    chainId: 'chain',
    turnId: 'turn',
    scope,
    member: {
      id: 'ada',
      name: 'Ada',
      avatar: { emoji: ':owl:' },
      provider: 'test',
      model: 'test',
      persona: 'Explain',
      tools: ['slack_history'],
    },
    maxSteps: 4,
    signal: new AbortController().signal,
    prompt: { system: '', user: '' },
    historyBeforeTs: '3.000000',
  };
  const author = {
    kind: 'human',
    userId: 'U1',
    displayName: 'Reader',
  } as const;
  const fetchMessages = vi.fn(async () =>
    success([
      { ts: '1.000000', author, text: 'First' },
      { ts: '2.000000', author, text: 'Earlier <text>\ncontinued' },
      { ts: '3.000000', author, text: 'Already visible' },
    ]),
  );
  const tool = createSlackHistoryTool({ fetchMessages }, input, [input.member]);
  const options = { toolCallId: 'history', messages: [], context: {} };
  expect(await tool.execute?.({ limit: 1 }, options)).toEqual(
    success({
      transcript:
        '[#1] [new] Reader (human): Earlier &lt;text&gt;\n  continued',
      oldestTs: '2.000000',
    }),
  );
  expect(fetchMessages).toHaveBeenCalledExactlyOnceWith(scope, '3.000000');
});
