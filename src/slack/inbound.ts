import { isCliError } from '@council/core/errors.js';
import type { Council, Scope } from '@council/core/types.js';
import type { CouncilService } from '@council/runner/service.js';
import { z } from 'zod';

export interface InboundMessage {
  readonly channel: string;
  readonly ts: string;
  readonly threadTs?: string;
  readonly userId: string;
  /** Raw Slack text, so `<@APPUSER>` stays recognisable for addressing. */
  readonly text: string;
}

const InboundEvent = z.looseObject({
  type: z.enum(['message', 'app_mention']),
  subtype: z.string().optional(),
  bot_id: z.string().optional(),
  user: z.string().optional(),
  channel: z.string(),
  ts: z.string(),
  thread_ts: z.string().optional(),
  text: z.string().optional(),
});

/**
 * Keep only human-authored new messages. Edits, deletes and other subtypes are
 * ignored, and anything a bot posted, including this app, is dropped.
 */
export function prefilterSlackEvent(
  event: unknown,
): InboundMessage | undefined {
  const parsed = InboundEvent.safeParse(event);
  if (!parsed.success) return undefined;
  const { subtype, bot_id: botId, user, channel, ts, text = '' } = parsed.data;
  if (subtype !== undefined && subtype !== 'file_share') return undefined;
  if (botId !== undefined || user === undefined) return undefined;
  const threadTs = parsed.data.thread_ts;
  return threadTs === undefined || threadTs === ts
    ? { channel, ts, userId: user, text }
    : { channel, ts, threadTs, userId: user, text };
}

/**
 * Choose the scope a message belongs to. A thread reply belongs to its thread.
 * A top-level message belongs to the channel council when there is one;
 * otherwise it may open a new council in its own thread.
 */
export function selectScope(
  message: InboundMessage,
  getCouncil: (scope: Scope) => Council | undefined,
): { readonly scope: Scope; readonly kickoff: boolean } {
  if (message.threadTs !== undefined) {
    const scope = { channel: message.channel, threadTs: message.threadTs };
    return { scope, kickoff: getCouncil(scope) === undefined };
  }
  const channel = { channel: message.channel };
  if (getCouncil(channel)) return { scope: channel, kickoff: false };
  return {
    scope: { channel: message.channel, threadTs: message.ts },
    kickoff: true,
  };
}

export type LogEntry = Readonly<Record<string, string | number | boolean>>;

export function createInboundHandler({
  service,
  log,
}: {
  readonly service: Pick<CouncilService, 'getCouncil' | 'handleHumanMessage'>;
  readonly log: (entry: LogEntry) => void;
}): (event: unknown) => Promise<void> {
  return async (event) => {
    const message = prefilterSlackEvent(event);
    if (!message) return;
    try {
      const { scope, kickoff } = selectScope(message, (candidate) =>
        service.getCouncil(candidate),
      );
      // Slack sends `message` and `app_mention` for one post; the service dedupes on channel:ts.
      await service.handleHumanMessage({
        scope,
        kickoff,
        message: {
          ts: message.ts,
          text: message.text,
          author: {
            kind: 'human',
            userId: message.userId,
            displayName: message.userId,
          },
        },
      });
    } catch (error) {
      log({
        level: 'error',
        event: 'inbound_failed',
        code: isCliError(error) ? error.code : 'E_UNEXPECTED',
        channel: message.channel,
        ts: message.ts,
      });
    }
  };
}
