import { createHash } from 'node:crypto';

import type { Config } from '@council/config/schema.js';
import { isCliError } from '@council/core/errors.js';
import type { Scope } from '@council/core/types.js';
import type { CouncilService } from '@council/runner/service.js';
import type { types } from '@slack/bolt';
import { z } from 'zod';

import { callSlack, type SlackApi } from './api.js';
import type { LogEntry } from './inbound.js';
import type { SlackAdapterPort } from './port.js';
import { neutraliseBroadcasts, truncateMarkdown } from './text.js';

export const PICKER_CALLBACK = 'council_picker';
export const PRESET_BLOCK = 'council_preset';
export const MEMBERS_BLOCK = 'council_members';
export const QUESTION_BLOCK = 'council_question';
export const WHERE_BLOCK = 'council_where';
const PRESET_ACTION = 'preset';
const MEMBERS_ACTION = 'members';
const QUESTION_ACTION = 'question';
const WHERE_ACTION = 'where';

/** Slack's limit for `private_metadata`. */
export const METADATA_LIMIT = 3_000;
export const QUESTION_LIMIT = 3_000;
const OPTION_LIMIT = 100;
const OPTION_TEXT_LIMIT = 75;
/** How much of a selected message a blank shortcut quotes in its notice. */
export const EXCERPT_LIMIT = 1_000;

export const REFUSED = 'You are not allowed to start a council.';

const SlackId = z.string().regex(/^[A-Z0-9]{2,40}$/u);
const UserId = z.string().regex(/^[UW][A-Z0-9]{1,40}$/u);
const SlackTs = z.string().regex(/^\d{1,12}\.\d{1,9}$/u);
const ResponseUrl = z
  .string()
  .max(500)
  .refine((value) => {
    const url = URL.parse(value);
    return (
      url?.protocol === 'https:' &&
      url.host === 'hooks.slack.com' &&
      url.username === '' &&
      url.password === ''
    );
  });

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

/** The modal carries the source and the roster fingerprint it was built from. */
const Metadata = z.strictObject({
  source: Source,
  fingerprint: z.string().regex(/^[0-9a-f]{16}$/u),
});
export type PickerMetadata = z.infer<typeof Metadata>;

export type PickerWhere = 'thread' | 'channel';

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
export function decodeMetadata(raw: unknown): PickerMetadata | undefined {
  if (typeof raw !== 'string' || raw.length > METADATA_LIMIT) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const parsed = Metadata.safeParse(json);
  return parsed.success ? parsed.data : undefined;
}

/**
 * User-supplied text as plain text in an app post: mentions and broadcasts
 * neutralised, then Markdown that could link, format or quote escaped.
 */
export function plainMarkdown(text: string): string {
  return neutraliseBroadcasts(text)
    .replace(/[\\`*_~[\]<>#|!]/gu, '\\$&')
    .replace(/^(\s*(?:\d+)?)([-+=.)])/gmu, '$1\\$2');
}

/** A bounded, escaped blockquote of a selected message for the convening notice. */
export function quoteExcerpt(text: string): string {
  return plainMarkdown(truncateMarkdown(text.trim(), EXCERPT_LIMIT))
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
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

// Options carry short index ids, so a long configured key cannot break `views.open`.
const presetKeys = (config: PickerConfig) =>
  Object.keys(config.presets).slice(0, OPTION_LIMIT);
const memberKeys = (config: PickerConfig) =>
  Object.keys(config.members).slice(0, OPTION_LIMIT);

/**
 * Option ids are indexes, so a form must map back through the same keys in the
 * same order it was built from.
 */
export function rosterFingerprint(config: PickerConfig): string {
  return createHash('sha256')
    .update(JSON.stringify([presetKeys(config), memberKeys(config)]))
    .digest('hex')
    .slice(0, 16);
}

/** The configured key behind an option id, or undefined for an unknown id. */
function fromOption(
  keys: readonly string[],
  prefix: string,
  value: string,
): string | undefined {
  const index = value.slice(prefix.length);
  return value.startsWith(prefix) && /^(?:0|[1-9]\d{0,2})$/u.test(index)
    ? keys[Number(index)]
    : undefined;
}

function buildPickerView(
  config: PickerConfig,
  source: PickerSource,
  question: string,
): types.ModalView {
  const presets = presetKeys(config).map((name, index) =>
    option(name, `p${index}`),
  );
  const initial = presets[presetKeys(config).indexOf(config.defaultPreset)];
  const members = memberKeys(config).map((id, index) =>
    option(config.members[id]?.name ?? id, `m${index}`),
  );
  const initialQuestion = question.trim().slice(0, QUESTION_LIMIT);
  return {
    type: 'modal',
    callback_id: PICKER_CALLBACK,
    private_metadata: JSON.stringify({
      source,
      fingerprint: rosterFingerprint(config),
    }),
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
      // The shortcut always convenes in the message's thread.
      ...(source.kind === 'command' ? [whereBlock()] : []),
    ],
  };
}

const WHERE_OPTIONS = [
  option('New thread', 'thread'),
  option('This whole channel', 'channel'),
];

function whereBlock() {
  return {
    type: 'input' as const,
    block_id: WHERE_BLOCK,
    label: { type: 'plain_text' as const, text: 'Where' },
    element: {
      type: 'radio_buttons' as const,
      action_id: WHERE_ACTION,
      options: WHERE_OPTIONS,
      initial_option: WHERE_OPTIONS[0],
    },
  };
}

function exists(where: PickerWhere): string {
  return where === 'channel'
    ? 'This channel already has a council.'
    : 'This thread already has a council.';
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
  [WHERE_BLOCK]: z
    .looseObject({
      [WHERE_ACTION]: z.looseObject({
        selected_option: z.looseObject({ value: z.string() }).nullish(),
      }),
    })
    .optional(),
});

export type PickerSubmission =
  | {
      readonly ok: true;
      readonly source: PickerSource;
      readonly roster: readonly string[];
      /** A new thread, or the whole channel (the command only). */
      readonly where: PickerWhere;
      /** Trimmed, or undefined when empty. */
      readonly question?: string;
    }
  | { readonly ok: false; readonly errors: Readonly<Record<string, string>> };

/** Chosen members win; otherwise the chosen (or default) preset's members. */
export function parsePickerSubmission(
  config: PickerConfig,
  view: { readonly private_metadata: unknown; readonly state: unknown },
): PickerSubmission {
  const metadata = decodeMetadata(view.private_metadata);
  if (!metadata) {
    return {
      ok: false,
      errors: { [QUESTION_BLOCK]: 'This form expired. Start again.' },
    };
  }
  if (metadata.fingerprint !== rosterFingerprint(config)) {
    return {
      ok: false,
      errors: {
        [QUESTION_BLOCK]:
          'The council configuration changed since this form opened. Close it and start again.',
      },
    };
  }
  const { source } = metadata;
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

  const chosen = (
    state[MEMBERS_BLOCK]?.[MEMBERS_ACTION].selected_options ?? []
  ).map(({ value }) => fromOption(memberKeys(config), 'm', value));
  let roster: readonly string[] = [...new Set(chosen)].filter(
    (id) => id !== undefined,
  );
  if (chosen.includes(undefined)) {
    errors[MEMBERS_BLOCK] = 'Choose configured members only.';
  } else if (roster.length === 0) {
    const selected = state[PRESET_BLOCK]?.[PRESET_ACTION].selected_option;
    const preset = selected
      ? fromOption(presetKeys(config), 'p', selected.value)
      : config.defaultPreset;
    const members =
      preset !== undefined && Object.hasOwn(config.presets, preset)
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

  const whereValue =
    source.kind === 'command'
      ? (state[WHERE_BLOCK]?.[WHERE_ACTION].selected_option?.value ?? 'thread')
      : 'thread';
  const where =
    whereValue === 'thread' || whereValue === 'channel'
      ? whereValue
      : undefined;
  if (!where) errors[WHERE_BLOCK] = 'Choose where the council meets.';

  if (Object.keys(errors).length > 0 || !where) return { ok: false, errors };
  return question === ''
    ? { ok: true, source, roster, where }
    : { ok: true, source, roster, where, question };
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

/** Enough to outlast Slack's redelivery of one submission. */
const CLAIM_LIMIT = 1_024;

export interface PickerOptions {
  readonly config: PickerConfig;
  readonly service: Pick<
    CouncilService,
    'getCouncil' | 'convene' | 'handleHumanMessage'
  >;
  /** Posts and deletes through the port's per-channel write queue. */
  readonly slack: Pick<
    SlackAdapterPort,
    'fetchMessages' | 'postNotice' | 'deleteMessage'
  >;
  readonly reader: SlackApi;
  /** Opens views. Must not retry: a trigger id is one-shot. */
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
  slack,
  reader,
  writer,
  appUserId,
  log,
  fetch = globalThis.fetch,
}: PickerOptions) {
  const claimed = new Set<string>();

  /** True the first time a view id is seen; the oldest claims age out. */
  function claim(viewId: string): boolean {
    if (claimed.has(viewId)) return false;
    claimed.add(viewId);
    if (claimed.size > CLAIM_LIMIT) {
      const [oldest] = claimed;
      if (oldest !== undefined) claimed.delete(oldest);
    }
    return true;
  }

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
        redirect: 'error',
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

  /** The selected message as an escaped quote, or undefined when it cannot be read. */
  async function selectedExcerpt(
    source: Extract<PickerSource, { kind: 'shortcut' }>,
  ): Promise<string | undefined> {
    const read = await slack.fetchMessages(
      { channel: source.channel, threadTs: source.threadTs },
      source.messageTs,
    );
    const text = read.ok
      ? read.value.find(({ ts }) => ts === source.messageTs)?.text.trim()
      : undefined;
    if (!read.ok) fail('excerpt', read.code, source.channel);
    return text ? quoteExcerpt(text) : undefined;
  }

  /**
   * Post first, then convene, then open the round from the post. The post is
   * the app's own, so its ts is a fresh dedupe key even when the selected
   * message was accepted before. The round's trigger is the post, so a blank
   * shortcut quotes the selected message in it.
   */
  async function start(
    source: PickerSource,
    roster: readonly string[],
    where: PickerWhere,
    question: string | undefined,
  ): Promise<void> {
    const name = await displayName(source.user);
    const by = plainMarkdown(name.replace(/\s+/gu, ' ').slice(0, 100));
    let text: string;
    if (question !== undefined) {
      text = `Council convened by ${by}: ${plainMarkdown(question)}`;
    } else if (source.kind === 'shortcut') {
      const excerpt = await selectedExcerpt(source);
      text = excerpt
        ? `Council convened by ${by} on this message:\n${excerpt}`
        : `Council convened by ${by} on the message above.`;
    } else {
      text = `Council convened by ${by}.`;
    }
    // postNotice bounds the post to the markdown_text limit.
    const posted = await slack.postNotice(
      source.kind === 'command'
        ? { channel: source.channel }
        : { channel: source.channel, threadTs: source.threadTs },
      text,
    );
    if (!posted.ok) {
      fail('post', posted.code, source.channel);
      return tell(
        source,
        posted.hint ?? 'The council could not post in this channel.',
      );
    }
    const { ts } = posted.value;
    const scope: Scope =
      where === 'channel'
        ? { channel: source.channel }
        : {
            channel: source.channel,
            threadTs: source.kind === 'command' ? ts : source.threadTs,
          };

    try {
      await service.convene({ scope, owner: source.user, roster });
    } catch (error) {
      const code = isCliError(error) ? error.code : 'E_UNEXPECTED';
      fail('convene', code, source.channel);
      const removed = await slack.deleteMessage(source.channel, ts);
      if (!removed.ok) fail('delete', removed.code, source.channel);
      const reason =
        code === 'E_COUNCIL_EXISTS'
          ? exists(where)
          : code === 'E_FORBIDDEN'
            ? REFUSED
            : 'The council could not be convened.';
      return tell(
        source,
        removed.ok
          ? reason
          : `${reason} Its "Council convened" message could not be removed; delete it by hand.`,
      );
    }

    // The text only addresses the council; the prompt is read from thread history up to `ts`.
    let opened: string;
    try {
      opened = await service.handleHumanMessage({
        scope,
        message: {
          ts,
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
        `The council was convened, but its first round did not start. Mention @council in the ${where === 'channel' ? 'channel' : 'thread'}.`,
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
      const { source, roster, where, question } = parsed;
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
      const taken =
        where === 'channel'
          ? service.getCouncil({ channel: source.channel })
          : source.kind === 'shortcut' &&
            service.getCouncil({
              channel: source.channel,
              threadTs: source.threadTs,
            });
      if (taken) {
        return {
          response: {
            response_action: 'errors',
            errors: {
              [where === 'channel' ? WHERE_BLOCK : QUESTION_BLOCK]:
                exists(where),
            },
          },
        };
      }
      const viewId = (view as { id?: unknown }).id;
      if (typeof viewId !== 'string') {
        return {
          response: {
            response_action: 'errors',
            errors: { [QUESTION_BLOCK]: 'This form could not be read.' },
          },
        };
      }
      return {
        // Claimed only after a successful ack, so a failed ack's redelivery
        // still runs; a redelivery after a successful one is dropped.
        run: async () => {
          if (!claim(viewId)) return;
          try {
            await start(source, roster, where, question);
          } catch {
            fail('start', 'E_UNEXPECTED', source.channel);
          }
        },
      };
    },
  };
}

export type Picker = ReturnType<typeof createPicker>;
