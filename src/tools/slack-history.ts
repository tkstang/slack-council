import { renderTranscript } from '@council/context/prompt.js';
import type { SlackPort, TurnInput } from '@council/core/ports.js';
import { success, type Result } from '@council/core/result.js';
import type { Member } from '@council/core/types.js';
import { tool, type Tool } from 'ai';
import { z } from 'zod';

export function createSlackHistoryTool(
  slack: Pick<SlackPort, 'fetchMessages'>,
  input: TurnInput,
  members: readonly Member[],
): Tool<
  { before?: string; limit?: number },
  Result<ReturnType<typeof renderTranscript>>
> {
  return tool({
    description:
      'Read earlier messages in this council. Starts before the prompt transcript. Pass the returned oldestTs as before to continue.',
    inputSchema: z.strictObject({
      before: z
        .string()
        .regex(/^\d{1,16}\.\d{1,6}$/u)
        .optional(),
      limit: z.int().min(1).max(30).optional(),
    }),
    async execute({ before = input.historyBeforeTs, limit = 20 }) {
      const read = await slack.fetchMessages(input.scope, before);
      if (!read.ok) return read;
      const messages = read.value
        .filter(({ ts }) => before === undefined || ts !== before)
        .slice(-limit);
      return success(
        renderTranscript({
          messages,
          member: input.member,
          roster: members,
          contextChars: 12_000,
        }),
      );
    },
  });
}
