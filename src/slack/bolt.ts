import type { ApprovalClick, ApprovalReply } from '@council/tools/approval.js';
import type { App, BlockAction, ButtonAction } from '@slack/bolt';

import type { LogEntry } from './inbound.js';
import { APPROVE_ACTION, DENY_ACTION } from './port.js';

export const ROSTER_PICKER_PENDING =
  'The roster picker is not built yet; mention @council instead.';

export const START_SHORTCUT = 'council_start';

/** Register the app's listeners. Events go to `onEvent`; nothing here throws. */
export function registerCouncilHandlers(
  app: Pick<App, 'event' | 'command' | 'shortcut' | 'action'>,
  {
    onEvent,
    onApproval,
    log,
  }: {
    readonly onEvent: (event: unknown) => Promise<void>;
    readonly onApproval?: (
      id: string,
      userId: string,
      vote: ApprovalClick,
    ) => ApprovalReply;
    readonly log: (entry: LogEntry) => void;
  },
): void {
  // Bolt acknowledges Events API envelopes itself before listeners run.
  app.event('message', async ({ event }) => onEvent(event));
  app.event('app_mention', async ({ event }) => onEvent(event));

  if (onApproval) {
    const actions = [
      { id: APPROVE_ACTION, vote: 'approve' },
      { id: DENY_ACTION, vote: 'deny' },
    ] as const;
    for (const { id, vote } of actions) {
      app.action<BlockAction<ButtonAction>>(
        id,
        async ({ ack, action, body, respond }) => {
          await ack();
          const result = onApproval(action.value ?? '', body.user.id, vote);
          if (result === 'accepted') return;
          try {
            await respond({
              response_type: 'ephemeral',
              text:
                result === 'forbidden'
                  ? 'You are not allowed to decide this request.'
                  : 'This request expired.',
            });
          } catch {
            log({
              level: 'warn',
              event: 'approval_reply_failed',
              code: 'E_SLACK',
            });
          }
        },
      );
    }
  }

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
