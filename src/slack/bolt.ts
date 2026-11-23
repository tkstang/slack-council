import type { ApprovalClick, ApprovalReply } from '@council/tools/approval.js';
import type {
  App,
  BlockAction,
  ButtonAction,
  MessageShortcut,
} from '@slack/bolt';

import type { LogEntry } from './inbound.js';
import { PICKER_CALLBACK, shortcutSource, type Picker } from './picker.js';
import { APPROVE_ACTION, DENY_ACTION } from './port.js';

export const START_SHORTCUT = 'council_start';

/** Register the app's listeners. Events go to `onEvent`; nothing here throws. */
export function registerCouncilHandlers(
  app: Pick<App, 'event' | 'command' | 'shortcut' | 'action' | 'view'>,
  {
    onEvent,
    onApproval,
    picker,
    log,
  }: {
    readonly onEvent: (event: unknown) => Promise<void>;
    /** Roster modal behind `/council` and the message shortcut. */
    readonly picker: Pick<Picker, 'plan' | 'open' | 'submit'>;
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

  app.command('/council', async ({ ack, command, respond }) => {
    await ack();
    const source = {
      kind: 'command',
      channel: command.channel_id,
      user: command.user_id,
      responseUrl: command.response_url,
    } as const;
    const plan = picker.plan(source, command.text);
    if (plan.kind === 'open') {
      await picker.open(command.trigger_id, source, plan.view);
      return;
    }
    try {
      await respond({ response_type: 'ephemeral', text: plan.text });
    } catch {
      log({
        level: 'warn',
        event: 'command_reply_failed',
        command: '/council',
      });
    }
  });

  app.shortcut<MessageShortcut>(
    START_SHORTCUT,
    async ({ ack, shortcut, respond }) => {
      await ack();
      const source = shortcutSource(shortcut);
      const plan = picker.plan(source);
      if (plan.kind === 'open') {
        await picker.open(shortcut.trigger_id, source, plan.view);
        return;
      }
      try {
        await respond({ response_type: 'ephemeral', text: plan.text });
      } catch {
        log({
          level: 'warn',
          event: 'shortcut_reply_failed',
          shortcut: START_SHORTCUT,
        });
      }
    },
  );

  app.view(PICKER_CALLBACK, async ({ ack, body, view }) => {
    const { response, run } = picker.submit(body.user.id, view);
    await ack(response);
    await run?.();
  });
}
