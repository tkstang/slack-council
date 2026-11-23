import type { Config } from '@council/config/schema.js';
import { isCliError } from '@council/core/errors.js';
import type { Scope } from '@council/core/types.js';
import type { CouncilService } from '@council/runner/service.js';
import type { types } from '@slack/bolt';
import { z } from 'zod';

import { callSlack, type SlackApi } from './api.js';
import type { LogEntry } from './inbound.js';
import { NOTICE_EVENT } from './port.js';
import { neutraliseBroadcasts } from './text.js';

export const PICKER_CALLBACK = 'council_picker';
export const PRESET_BLOCK = 'council_preset';
export const MEMBERS_BLOCK = 'council_members';
export const QUESTION_BLOCK = 'council_question';
const PRESET_ACTION = 'preset';
const MEMBERS_ACTION = 'members';
const QUESTION_ACTION = 'question';

/** Slack's limit for `private_metadata`. */
export const METADATA_LIMIT = 3_000;
export const QUESTION_LIMIT = 3_000;
const OPTION_LIMIT = 100;
const OPTION_TEXT_LIMIT = 75;

export const REFUSED = 'You are not allowed to start a council.';
export const INVITE_APP =
  'The app is not in this channel. Invite it with `/invite @council`, then try again.';

const SlackId = z.string().regex(/^[A-Z0-9]{2,40}$/u);
const UserId = z.string().regex(/^[UW][A-Z0-9]{1,40}$/u);
const SlackTs = z.string().regex(/^\d{1,12}\.\d{1,9}$/u);
const ResponseUrl = z
  .string()
  .max(500)
  .refine((value) => URL.parse(value)?.origin === 'https://hooks.slack.com');

const Source = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('command'),
    channel: SlackId,
    user: UserId,
    responseUrl: ResponseUrl,
  }),
  z.strictObject({
    kind: z.literal('shortcut'),
    channel: SlackId,
    user: UserId,
    responseUrl: ResponseUrl,
    /** The council's thread: the message's parent, or the message itself. */
    threadTs: SlackTs,
    messageTs: SlackTs,
  }),
]);
export type PickerSource = z.infer<typeof Source>;

export type PickerConfig = Pick<
  Config,
  'members' | 'presets' | 'defaultPreset'
> & { readonly slack: Pick<Config['slack'], 'allowedUsers'> };

/** A message shortcut convenes on the message's thread, or starts one on a root message. */
export function shortcutSource(payload: {
  readonly channel: { readonly id: string };
  readonly user: { readonly id: string };
  readonly response_url: string;
  readonly message: { readonly ts: string; readonly thread_ts?: unknown };
}): PickerSource {
  const { ts, thread_ts: parent } = payload.message;
  return {
    kind: 'shortcut',
    channel: payload.channel.id,
    user: payload.user.id,
    responseUrl: payload.response_url,
    threadTs: typeof parent === 'string' && parent !== '' ? parent : ts,
    messageTs: ts,
  };
}

/** Untrusted on the way back: bounded, parsed and shape-checked. */
export function decodeMetadata(raw: unknown): PickerSource | undefined {
  if (typeof raw !== 'string' || raw.length > METADATA_LIMIT) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const parsed = Source.safeParse(json);
  return parsed.success ? parsed.data : undefined;
}

function option(text: string, value: string) {
  return {
    text: {
      type: 'plain_text' as const,
      text: text.slice(0, OPTION_TEXT_LIMIT),
      emoji: false,
    },
    value,
  };
}

function buildPickerView(
  config: PickerConfig,
  source: PickerSource,
  question: string,
): types.ModalView {
  const presets = Object.keys(config.presets)
    .slice(0, OPTION_LIMIT)
    .map((name) => option(name, name));
  const initial = presets.find(({ value }) => value === config.defaultPreset);
  const members = Object.entries(config.members)
    .slice(0, OPTION_LIMIT)
    .map(([id, member]) => option(member.name, id));
  const initialQuestion = question.trim().slice(0, QUESTION_LIMIT);
  return {
    type: 'modal',
    callback_id: PICKER_CALLBACK,
    private_metadata: JSON.stringify(source),
    title: { type: 'plain_text', text: 'Start a council' },
    submit: { type: 'plain_text', text: 'Convene' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: PRESET_BLOCK,
        label: { type: 'plain_text', text: 'Preset' },
        element: {
          type: 'static_select',
          action_id: PRESET_ACTION,
          options: presets,
          ...(initial ? { initial_option: initial } : {}),
        },
      },
      {
        type: 'input',
        block_id: MEMBERS_BLOCK,
        optional: true,
        label: { type: 'plain_text', text: 'Members' },
        hint: {
          type: 'plain_text',
          text: 'Choosing members overrides the preset.',
        },
        element: {
          type: 'multi_static_select',
          action_id: MEMBERS_ACTION,
          options: members,
        },
      },
      {
        type: 'input',
        block_id: QUESTION_BLOCK,
        optional: source.kind === 'shortcut',
        label: { type: 'plain_text', text: 'Question' },
        ...(source.kind === 'shortcut'
          ? {
              hint: {
                type: 'plain_text' as const,
                text: 'Leave empty to use the selected message as the question.',
              },
            }
          : {}),
        element: {
          type: 'plain_text_input',
          action_id: QUESTION_ACTION,
          multiline: true,
          max_length: QUESTION_LIMIT,
          ...(initialQuestion === '' ? {} : { initial_value: initialQuestion }),
        },
      },
    ],
  };
}

export type PickerOpen =
  | { readonly kind: 'refuse'; readonly text: string }
  | { readonly kind: 'open'; readonly view: types.ModalView };

/** Only allowed users get the modal; the service checks again on convene. */
export function planPickerOpen(
  config: PickerConfig,
  source: PickerSource,
  question = '',
): PickerOpen {
  return config.slack.allowedUsers.includes(source.user)
    ? { kind: 'open', view: buildPickerView(config, source, question) }
    : { kind: 'refuse', text: REFUSED };
}

const State = z.looseObject({
  [PRESET_BLOCK]: z
    .looseObject({
      [PRESET_ACTION]: z.looseObject({
        selected_option: z.looseObject({ value: z.string() }).nullish(),
      }),
    })
    .optional(),
  [MEMBERS_BLOCK]: z
    .looseObject({
      [MEMBERS_ACTION]: z.looseObject({
        selected_options: z
          .array(z.looseObject({ value: z.string() }))
          .nullish(),
      }),
    })
    .optional(),
  [QUESTION_BLOCK]: z
    .looseObject({
      [QUESTION_ACTION]: z.looseObject({
        value: z.string().nullish(),
      }),
    })
    .optional(),
});

export type PickerSubmission =
  | {
      readonly ok: true;
      readonly source: PickerSource;
      readonly roster: readonly string[];
      /** Trimmed, or undefined when empty. */
      readonly question?: string;
    }
  | { readonly ok: false; readonly errors: Readonly<Record<string, string>> };

/** Chosen members win; otherwise the chosen (or default) preset's members. */
export function parsePickerSubmission(
  config: PickerConfig,
  view: { readonly private_metadata: unknown; readonly state: unknown },
): PickerSubmission {
  const source = decodeMetadata(view.private_metadata);
  if (!source) {
    return {
      ok: false,
      errors: { [QUESTION_BLOCK]: 'This form expired. Start again.' },
    };
  }
  const values = State.safeParse(
    (view.state as { values?: unknown } | null)?.values,
  );
  if (!values.success) {
    return {
      ok: false,
      errors: { [QUESTION_BLOCK]: 'This form could not be read.' },
    };
  }
  const state = values.data;
  const errors: Record<string, string> = {};

  const chosen = [
    ...new Set(
      (state[MEMBERS_BLOCK]?.[MEMBERS_ACTION].selected_options ?? []).map(
        ({ value }) => value,
      ),
    ),
  ];
  let roster: readonly string[] = chosen;
  if (chosen.some((id) => !Object.hasOwn(config.members, id))) {
    errors[MEMBERS_BLOCK] = 'Choose configured members only.';
  } else if (chosen.length === 0) {
    const preset =
      state[PRESET_BLOCK]?.[PRESET_ACTION].selected_option?.value ??
      config.defaultPreset;
    const members = Object.hasOwn(config.presets, preset)
      ? config.presets[preset]
      : undefined;
    if (members) roster = members;
    else errors[PRESET_BLOCK] = 'Choose a configured preset.';
  }

  const question = (
    state[QUESTION_BLOCK]?.[QUESTION_ACTION].value ?? ''
  ).trim();
  if (question.length > QUESTION_LIMIT) {
    errors[QUESTION_BLOCK] =
      `Keep the question under ${QUESTION_LIMIT} characters.`;
  } else if (question === '' && source.kind === 'command') {
    errors[QUESTION_BLOCK] = 'Enter a question.';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return question === ''
    ? { ok: true, source, roster }
    : { ok: true, source, roster, question };
}

const UserInfo = z.looseObject({
  user: z.looseObject({
    real_name: z.string().optional(),
    profile: z
      .looseObject({
        display_name: z.string().optional(),
        real_name: z.string().optional(),
      })
      .optional(),
  }),
});

const Posted = z.looseObject({ ts: SlackTs });

export interface PickerOptions {
  readonly config: PickerConfig;
  readonly service: Pick<
    CouncilService,
    'getCouncil' | 'convene' | 'end' | 'handleHumanMessage'
  >;
  readonly reader: SlackApi;
  /** Opens views and posts. Must not retry: a trigger id and a post are one-shot. */
  readonly writer: SlackApi;
  readonly appUserId: string;
  readonly log: (entry: LogEntry) => void;
  readonly fetch?: typeof globalThis.fetch;
}

export interface PickerSubmit {
  /** Pass to `ack()`; undefined closes the modal. */
  readonly response?: {
    readonly response_action: 'errors';
    readonly errors: Readonly<Record<string, string>>;
  };
  /** Work to run after acknowledging. Never throws. */
  readonly run?: () => Promise<void>;
}

export function createPicker({
  config,
  service,
  reader,
  writer,
  appUserId,
  log,
  fetch = globalThis.fetch,
}: PickerOptions) {
  function fail(stage: string, code: string, channel: string): void {
    log({ level: 'warn', event: 'picker_failed', stage, code, channel });
  }

  async function tell(source: PickerSource, text: string): Promise<void> {
    try {
      const response = await fetch(source.responseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          response_type: 'ephemeral',
          replace_original: false,
          text,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok)
        fail('reply', `http_${response.status}`, source.channel);
    } catch {
      fail('reply', 'E_SLACK', source.channel);
    }
  }

  async function displayName(userId: string): Promise<string> {
    const call = await callSlack(reader, 'users.info', { user: userId });
    const parsed = call.ok ? UserInfo.safeParse(call.value) : undefined;
    if (!parsed?.success) return userId;
    const { user } = parsed.data;
    return (
      user.profile?.display_name ||
      user.real_name ||
      user.profile?.real_name ||
      userId
    );
  }

  async function post(
    channel: string,
    threadTs: string | undefined,
    text: string,
  ): Promise<{ ok: true; ts: string } | { ok: false; error: string }> {
    const call = await callSlack(writer, 'chat.postMessage', {
      channel,
      ...(threadTs === undefined ? {} : { thread_ts: threadTs }),
      markdown_text: neutraliseBroadcasts(text),
      unfurl_links: false,
      unfurl_media: false,
      metadata: {
        event_type: NOTICE_EVENT,
        event_payload: { kind: 'notice' },
      },
    });
    if (!call.ok) return call;
    const posted = Posted.safeParse(call.value);
    return posted.success
      ? { ok: true, ts: posted.data.ts }
      : { ok: false, error: 'invalid_response' };
  }

  function postFailure(source: PickerSource, error: string): Promise<void> {
    fail('post', error, source.channel);
    return tell(
      source,
      error === 'not_in_channel'
        ? INVITE_APP
        : 'The council could not post in this channel.',
    );
  }

  async function convene(
    source: PickerSource,
    scope: Scope,
    roster: readonly string[],
  ): Promise<boolean> {
    try {
      await service.convene({ scope, owner: source.user, roster });
      return true;
    } catch (error) {
      const code = isCliError(error) ? error.code : 'E_UNEXPECTED';
      fail('convene', code, source.channel);
      await tell(
        source,
        code === 'E_COUNCIL_EXISTS'
          ? 'This thread already has a council.'
          : code === 'E_FORBIDDEN'
            ? REFUSED
            : 'The council could not be convened.',
      );
      return false;
    }
  }

  async function start(
    source: PickerSource,
    roster: readonly string[],
    question: string | undefined,
  ): Promise<void> {
    const name = await displayName(source.user);
    let scope: Scope;
    let promptTs: string;
    if (source.kind === 'command') {
      const root = await post(
        source.channel,
        undefined,
        `Council convened by ${name}: ${question ?? ''}`,
      );
      if (!root.ok) return postFailure(source, root.error);
      scope = { channel: source.channel, threadTs: root.ts };
      promptTs = root.ts;
      if (!(await convene(source, scope, roster))) return;
    } else {
      scope = { channel: source.channel, threadTs: source.threadTs };
      if (!(await convene(source, scope, roster))) return;
      // The line attributes the council in the thread, and fails early when the app is not a member.
      const line = await post(
        source.channel,
        source.threadTs,
        question === undefined
          ? `Council convened by ${name}.`
          : `${name} asks the council: ${question}`,
      );
      if (!line.ok) {
        try {
          await service.end(scope, source.user);
        } catch {
          fail('end', 'E_UNEXPECTED', source.channel);
        }
        return postFailure(source, line.error);
      }
      promptTs = question === undefined ? source.messageTs : line.ts;
    }

    // The text only addresses the council; the prompt is read from thread history through `promptTs`.
    let opened: string;
    try {
      opened = await service.handleHumanMessage({
        scope,
        message: {
          ts: promptTs,
          text: `<@${appUserId}>`,
          author: { kind: 'human', userId: source.user, displayName: name },
        },
      });
    } catch (error) {
      opened = isCliError(error) ? error.code : 'E_UNEXPECTED';
    }
    if (opened !== 'accepted') {
      fail('round', opened, source.channel);
      await tell(
        source,
        'The council was convened, but its first round did not start. Mention @council in the thread.',
      );
    }
  }

  return {
    plan(source: PickerSource, question?: string): PickerOpen {
      return planPickerOpen(config, source, question);
    },

    /** Call straight after `ack()`: a trigger id expires in three seconds. */
    async open(triggerId: string, source: PickerSource, view: types.ModalView) {
      const call = await callSlack(writer, 'views.open', {
        trigger_id: triggerId,
        view,
      });
      if (!call.ok) fail('open', call.error, source.channel);
    },

    submit(userId: string, view: unknown): PickerSubmit {
      const parsed = parsePickerSubmission(
        config,
        typeof view === 'object' && view !== null
          ? (view as { private_metadata: unknown; state: unknown })
          : { private_metadata: undefined, state: undefined },
      );
      if (!parsed.ok)
        return {
          response: { response_action: 'errors', errors: parsed.errors },
        };
      const { source, roster, question } = parsed;
      if (
        source.user !== userId ||
        !config.slack.allowedUsers.includes(userId)
      ) {
        return {
          response: {
            response_action: 'errors',
            errors: { [QUESTION_BLOCK]: REFUSED },
          },
        };
      }
      if (
        source.kind === 'shortcut' &&
        service.getCouncil({
          channel: source.channel,
          threadTs: source.threadTs,
        })
      ) {
        return {
          response: {
            response_action: 'errors',
            errors: { [QUESTION_BLOCK]: 'This thread already has a council.' },
          },
        };
      }
      return {
        run: async () => {
          try {
            await start(source, roster, question);
          } catch {
            fail('start', 'E_UNEXPECTED', source.channel);
          }
        },
      };
    },
  };
}

export type Picker = ReturnType<typeof createPicker>;
