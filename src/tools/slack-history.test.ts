import type { TurnInput } from '@council/core/ports.js';
import { success } from '@council/core/result.js';
import type { Scope } from '@council/core/types.js';
import { expect, it, vi } from 'vitest';

import { createSlackHistoryTool } from './slack-history.js';

it.each([
  { name: 'thread before the prompt', threadTs: '1.000000' },
  { name: 'channel before the prompt', fromTs: '2.000000' },
  { name: 'channel at the floor', fromTs: '2.000000', before: '2.0' },
  { name: 'channel below the floor', fromTs: '2.000000', before: '1.999999' },
])(
  'reads the requested history window for $name',
  async ({ threadTs, fromTs, before }) => {
    const scope: Scope = { channel: 'C1', threadTs };
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
      historyFromTs: fromTs,
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
    const tool = createSlackHistoryTool({ fetchMessages }, input, [
      input.member,
    ]);
    const options = { toolCallId: 'history', messages: [], context: {} };
    const result = await tool.execute?.({ before, limit: 1 }, options);
    if (before !== undefined) {
      expect(result).toEqual(success({ transcript: '', oldestTs: undefined }));
      expect(fetchMessages).not.toHaveBeenCalled();
      return;
    }
    expect(result).toEqual(
      success({
        transcript:
          '[#1] [new] Reader (human): Earlier &lt;text&gt;\n  continued',
        oldestTs: '2.000000',
      }),
    );
    expect(fetchMessages).toHaveBeenCalledExactlyOnceWith(
      scope,
      '3.000000',
      fromTs,
    );
  },
);
