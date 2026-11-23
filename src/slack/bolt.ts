import type { createApprovalGate } from '@council/tools/approval.js';
import type {
  App,
  BlockAction,
  ButtonAction,
  MessageShortcut,
} from '@slack/bolt';

import { callSlack, type SlackApi } from './api.js';
import type { LogEntry } from './inbound.js';
import { PICKER_CALLBACK, shortcutSource, type Picker } from './picker.js';
import { APPROVE_ACTION, CHANGE_ACTION, DENY_ACTION } from './port.js';

export const START_SHORTCUT = 'council_start';
const CHANGE_CALLBACK = 'council_handoff_changes';
const CHANGES = 'changes';

/** Register the app's listeners. Events go to `onEvent`; nothing here throws. */
export function registerCouncilHandlers(
  app: Pick<App, 'event' | 'command' | 'shortcut' | 'action' | 'view'>,
  {
    onEvent,
    approvals,
    writer,
    picker,
    log,
  }: {
    readonly onEvent: (event: unknown) => Promise<void>;
    /** Roster modal behind `/council` and the message shortcut. */
    readonly picker: Pick<Picker, 'plan' | 'open' | 'submit'>;
    readonly approvals: Pick<
      ReturnType<typeof createApprovalGate>,
      'checkChange' | 'decide'
    >;
    readonly writer: SlackApi;
    readonly log: (entry: LogEntry) => void;
  },
): void {
  // Bolt acknowledges Events API envelopes itself before listeners run.
  app.event('message', async ({ event }) => onEvent(event));
  app.event('app_mention', async ({ event }) => onEvent(event));

  const actions = [
    { id: APPROVE_ACTION, vote: 'approve' },
    { id: DENY_ACTION, vote: 'deny' },
    { id: CHANGE_ACTION, vote: 'change' },
  ] as const;
  for (const { id, vote } of actions) {
    app.action<BlockAction<ButtonAction>>(
      id,
      async ({ ack, action, body, respond }) => {
        await ack();
        const ticket = action.value ?? '';
        const user = body.user.id;
        const result =
          vote === 'change'
            ? approvals.checkChange(ticket, user)
            : approvals.decide(ticket, user, vote);
        if (result === 'accepted') {
          if (vote !== 'change') return;
          const opened = await callSlack(writer, 'views.open', {
            trigger_id: body.trigger_id,
            view: {
              type: 'modal',
              callback_id: CHANGE_CALLBACK,
              private_metadata: ticket,
              title: { type: 'plain_text', text: 'Change handoff' },
              submit: { type: 'plain_text', text: 'Request changes' },
              close: { type: 'plain_text', text: 'Cancel' },
              blocks: [
                {
                  type: 'input',
                  block_id: CHANGES,
                  label: { type: 'plain_text', text: 'What should change?' },
                  element: {
                    type: 'plain_text_input',
                    action_id: CHANGES,
                    multiline: true,
                    max_length: 3_000,
                  },
                },
              ],
            },
          });
          if (opened.ok) return;
          log({
            level: 'warn',
            event: 'handoff_modal_open_failed',
            code: opened.error,
          });
        }
        try {
          await respond({
            response_type: 'ephemeral',
            text:
              result === 'accepted'
                ? 'Could not open the Change form. Try the Change button again.'
                : result === 'forbidden'
                  ? 'You are not allowed to decide this request.'
                  : 'This request is no longer pending.',
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

  app.view(CHANGE_CALLBACK, async ({ ack, body, view }) => {
    const text = view.state.values[CHANGES]?.[CHANGES]?.value;
    const result = text?.trim()
      ? approvals.decide(view.private_metadata, body.user.id, {
          changesRequested: text,
        })
      : 'empty';
    if (result === 'accepted') {
      await ack();
      return;
    }
    const error =
      result === 'expired'
        ? 'This request is no longer pending. Close this form.'
        : result === 'forbidden'
          ? 'You are not allowed to change this request.'
          : 'Enter the changes you want.';
    await ack({ response_action: 'errors', errors: { [CHANGES]: error } });
  });

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
