import type { App } from '@slack/bolt';

import type { LogEntry } from './inbound.js';

export const ROSTER_PICKER_PENDING =
  'The roster picker is not built yet; mention @council instead.';

export const START_SHORTCUT = 'council_start';

/** Register the app's listeners. Events go to `onEvent`; nothing here throws. */
export function registerCouncilHandlers(
  app: Pick<App, 'event' | 'command' | 'shortcut'>,
  {
    onEvent,
    log,
  }: {
    readonly onEvent: (event: unknown) => Promise<void>;
    readonly log: (entry: LogEntry) => void;
  },
): void {
  // Bolt acknowledges Events API envelopes itself before listeners run.
  app.event('message', async ({ event }) => onEvent(event));
  app.event('app_mention', async ({ event }) => onEvent(event));

  app.command('/council', async ({ ack, respond }) => {
    await ack();
    try {
      await respond({
        response_type: 'ephemeral',
        text: ROSTER_PICKER_PENDING,
      });
    } catch {
      log({
        level: 'warn',
        event: 'command_reply_failed',
        command: '/council',
      });
    }
  });

  app.shortcut(START_SHORTCUT, async ({ ack, respond }) => {
    await ack();
    try {
      await respond({
        response_type: 'ephemeral',
        text: ROSTER_PICKER_PENDING,
      });
    } catch {
      log({
        level: 'warn',
        event: 'shortcut_reply_failed',
        shortcut: START_SHORTCUT,
      });
    }
  });
}
