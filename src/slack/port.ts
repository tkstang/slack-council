import { HANDOFF_GRANT } from '@council/config/schema.js';
import type {
  ApprovalOutcome,
  ApprovalPort,
  ApprovalRequest,
  SlackPort,
} from '@council/core/ports.js';
import { failure, success, type Result } from '@council/core/result.js';
import { compareSlackTimestamps } from '@council/core/slack-timestamp.js';
import type { Author, Member, Message, Scope } from '@council/core/types.js';
import type { types } from '@slack/bolt';
import { z } from 'zod';

import { callSlack, type SlackApi, type SlackCall } from './api.js';
import {
  mentionedUserIds,
  linkPeopleMentions,
  neutraliseBroadcasts,
  renderSlackText,
  truncateMarkdown,
} from './text.js';
import {
  createChannelWriteQueue,
  type WriteQueueOptions,
} from './write-queue.js';

export const MEMBER_POST_EVENT = 'council_member_post';
export const NOTICE_EVENT = 'council_notice';
export const APPROVE_ACTION = 'council_approve_tool';
export const DENY_ACTION = 'council_deny_tool';
export const CHANGE_ACTION = 'council_change_handoff';
const APPROVAL_EVENT = 'council_tool_approval';

export interface SlackPortOptions extends WriteQueueOptions {
  /** Client for reads. */
  readonly api: SlackApi;
  /** Client for writes. It must time out and must not retry automatically. */
  readonly writeApi: SlackApi;
  /** The app's own bot id and bot user id, from `auth.test`. */
  readonly botId: string;
  readonly botUserId: string;
  readonly members: readonly Pick<
    Member,
    'id' | 'name' | 'model' | 'effort' | 'persona'
  >[];
  /** Upper bound on pages read for one thread; a longer thread fails to read. */
  readonly maxPages?: number;
}

const RawMessage = z.looseObject({
  ts: z.string(),
  type: z.string().optional(),
  subtype: z.string().optional(),
  user: z.string().optional(),
  bot_id: z.string().optional(),
  username: z.string().optional(),
  text: z.string().optional(),
  thread_ts: z.string().optional(),
  bot_profile: z.looseObject({ name: z.string().optional() }).optional(),
  files: z.array(z.looseObject({ name: z.string().optional() })).optional(),
  metadata: z
    .looseObject({
      event_type: z.string().optional(),
      event_payload: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});
type RawMessage = z.infer<typeof RawMessage>;

const Page = z.looseObject({
  messages: z.array(z.unknown()).default([]),
  has_more: z.boolean().optional(),
  response_metadata: z
    .looseObject({ next_cursor: z.string().optional() })
    .optional(),
});

const Posted = z.looseObject({ ts: z.string() });

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

/** Subtypes that carry conversation content; joins, topic changes and tombstones do not. */
const CONTENT_SUBTYPES = new Set([
  undefined,
  'bot_message',
  'file_share',
  'thread_broadcast',
  'me_message',
]);

const MEMBER_HANDLE = /^[a-z][a-z0-9-]*$/u;

function slackFailure(method: string, call: SlackCall & { ok: false }) {
  return failure(
    'E_SLACK',
    `Slack ${method} failed: ${call.error}`,
    call.error === 'not_in_channel'
      ? 'The app is not in this channel. Invite it with `/invite @council`, then try again.'
      : undefined,
  );
}

/** Decide who wrote a Slack message, from ids and metadata, never from its text. */
export function classifyAuthor(
  message: RawMessage,
  context: {
    readonly botId: string;
    readonly membersByName: ReadonlyMap<string, string>;
    readonly humanName: (userId: string) => string;
  },
): Author | undefined {
  const { bot_id: botId, user } = message;
  if (botId === undefined) {
    return user === undefined
      ? undefined
      : { kind: 'human', userId: user, displayName: context.humanName(user) };
  }
  if (botId !== context.botId) {
    return {
      kind: 'otherBot',
      displayName: message.username ?? message.bot_profile?.name ?? botId,
    };
  }
  const { event_type: eventType, event_payload: payload } =
    message.metadata ?? {};
  const member = payload?.['member'];
  if (
    eventType === MEMBER_POST_EVENT &&
    typeof member === 'string' &&
    MEMBER_HANDLE.test(member)
  ) {
    return { kind: 'member', memberId: member };
  }
  if (eventType !== NOTICE_EVENT && message.username !== undefined) {
    const byName = context.membersByName.get(message.username);
    if (byName !== undefined) return { kind: 'member', memberId: byName };
  }
  return { kind: 'notice' };
}

function target(scope: Scope): Record<string, string> {
  return scope.threadTs === undefined
    ? { channel: scope.channel }
    : { channel: scope.channel, thread_ts: scope.threadTs };
}

function escapeSlackText(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

const literalText = (text: string, code = false): types.RichTextText => ({
  type: 'text',
  text,
  ...(code ? { style: { code: true } } : {}),
});

const richSection = (
  ...elements: types.RichTextText[]
): types.RichTextSection => ({
  type: 'rich_text_section',
  elements,
});

const rawCell = (text: string): types.RawTextElement => ({
  type: 'raw_text',
  text,
});

type PanelMember = SlackPortOptions['members'][number];
const PANEL_COLUMNS = [
  {
    title: 'Handle',
    code: true,
    value: (member: PanelMember) => `@${member.id}`,
  },
  { title: 'Name', value: (member: PanelMember) => member.name },
  { title: 'Model', code: true, value: (member: PanelMember) => member.model },
  {
    title: 'Effort',
    optional: true,
    value: (member: PanelMember) => member.effort ?? '',
  },
  {
    title: 'Persona',
    optional: true,
    value: (member: PanelMember) => member.persona?.title ?? '',
  },
];

const TABLE_ROW_LIMIT = 100;
const TABLE_TEXT_LIMIT = 10_000;
const FALLBACK_TEXT_LIMIT = 40_000;

const panelOmission = (count: number) =>
  `… (${count} panel ${count === 1 ? 'member' : 'members'} omitted)`;

function panelMessage(
  notice: string,
  panel: { readonly preset?: string; readonly quote?: string },
  members: readonly PanelMember[],
) {
  // The picker accepts questions up to 3,000 units, plus the notice prefix.
  const intro = truncateMarkdown(notice, 3_200);
  const quote = panel.quote ? truncateMarkdown(panel.quote, 1_000) : undefined;
  const label =
    panel.preset === undefined
      ? 'custom panel'
      : `Preset: ${truncateMarkdown(panel.preset.trim().replace(/\s+/gu, ' '), 200)}`;
  const fallbackIntro = escapeSlackText(
    [intro, ...(quote ? [quote.replace(/^/gmu, '> ')] : []), '', label].join(
      '\n',
    ),
  );
  const columns = PANEL_COLUMNS.filter(
    ({ optional, value }) =>
      !optional || members.some((member) => value(member).trim() !== ''),
  );
  const headers = columns.map(({ title }) => title);
  const table: types.TableBlock = {
    type: 'table',
    column_settings: columns.map(() => ({ is_wrapped: true })),
    rows: [headers.map(rawCell)],
  };
  const headerLine = headers.join(' · ');
  const fallback = [headerLine];
  let tableChars = headers.join('').length;

  for (const member of members) {
    if (table.rows.length === TABLE_ROW_LIMIT) break;
    // One line per value, so a row stays one line in the fallback.
    const cells = columns.map(({ code, value }) => ({
      code,
      text: value(member).trim().replace(/\s+/gu, ' ') || '—',
    }));
    const chars = cells.reduce((sum, { text }) => sum + text.length, 0);
    // Stop at the first row that does not fit, so the omitted members are the last ones.
    if (tableChars + chars > TABLE_TEXT_LIMIT) break;
    tableChars += chars;
    table.rows.push(
      cells.map(({ code, text }) =>
        code
          ? {
              type: 'rich_text',
              elements: [richSection(literalText(text, true))],
            }
          : rawCell(text),
      ),
    );
    fallback.push(escapeSlackText(cells.map(({ text }) => text).join(' · ')));
  }
  const omitted = members.length - (table.rows.length - 1);
  const summary = omitted > 0 ? `\n${panelOmission(omitted)}` : '';
  const lead: types.RichTextBlock = {
    type: 'rich_text',
    elements: [
      richSection(literalText(intro)),
      ...(quote
        ? [{ type: 'rich_text_quote' as const, elements: [literalText(quote)] }]
        : []),
      richSection(literalText(`\n${label}${summary}`)),
    ],
  };
  return {
    // Escaping can lengthen the text; Slack rejects more than this.
    text: `${fallbackIntro}${summary}\n\n${fallback.join('\n')}`.slice(
      0,
      FALLBACK_TEXT_LIMIT,
    ),
    mrkdwn: false,
    parse: 'none',
    blocks: [lead, table],
  };
}

function approvalMessage(
  request: ApprovalRequest,
  outcome?: ApprovalOutcome,
  decidedBy?: string,
) {
  const member = request.memberName.replace(/\s+/gu, ' ').slice(0, 100);
  const handoff = request.tool === HANDOFF_GRANT;
  // Slack sections allow 3,000 UTF-16 units. Split the longer handoff preview
  // on code point boundaries so neither its content nor an emoji is cut off.
  const previews = handoff
    ? (request.preview.match(/[\s\S]{1,1500}/gu) ?? [])
    : [request.preview];
  const lead =
    outcome === undefined
      ? `${member} requests approval for `
      : `${member} requested `;
  const footer: string[] = [];
  if (outcome) {
    const state =
      outcome.kind === 'changes_requested'
        ? 'Changes requested'
        : `Request ${outcome.kind === 'denied' && handoff ? 'rejected' : outcome.kind}`;
    footer.push(
      'userId' in outcome
        ? `${state} by ${decidedBy ?? outcome.userId}.`
        : `${state}.`,
    );
  }
  const text = [`${lead}${request.tool}.`, request.preview, ...footer].join(
    '\n',
  );

  return {
    text: escapeSlackText(text),
    mrkdwn: false,
    // Each section holds at most 3,000 characters, so the arguments get their own.
    blocks: [
      {
        type: 'rich_text',
        elements: [
          richSection(
            literalText(lead),
            literalText(request.tool, true),
            literalText('.'),
          ),
        ],
      },
      ...[...previews, ...footer].map((part) => ({
        type: 'section',
        text: { type: 'plain_text', text: part.slice(0, 3_000), emoji: false },
      })),
      ...(outcome === undefined
        ? [
            {
              type: 'actions',
              elements: [
                {
                  type: 'button',
                  text: { type: 'plain_text', text: 'Approve' },
                  action_id: APPROVE_ACTION,
                  style: 'primary',
                  value: request.id,
                },
                {
                  type: 'button',
                  text: {
                    type: 'plain_text',
                    text: handoff ? 'Reject' : 'Deny',
                  },
                  action_id: DENY_ACTION,
                  style: 'danger',
                  value: request.id,
                },
                ...(handoff
                  ? [
                      {
                        type: 'button',
                        text: { type: 'plain_text', text: 'Change' },
                        action_id: CHANGE_ACTION,
                        value: request.id,
                      },
                    ]
                  : []),
              ],
            },
          ]
        : []),
    ],
  };
}

export interface SlackAdapterPort extends SlackPort, ApprovalPort {
  /** Delete one of the app's own messages, through the same write queue. */
  deleteMessage(channel: string, ts: string): Promise<Result<void>>;
}

export function createSlackPort(options: SlackPortOptions): SlackAdapterPort {
  const { api, writeApi, botId, botUserId, maxPages = 50 } = options;
  const queue = createChannelWriteQueue(options);
  const membersById = new Map(
    options.members.map((member) => [member.id, member]),
  );
  const membersByName = new Map(
    options.members.map(({ id, name }) => [name, id]),
  );
  const names = new Map<string, string>();
  // People seen in each channel: the only ones a member may notify there.
  const seen = new Map<string, Set<string>>();
  const handles = new Set(membersById.keys());

  async function resolveName(userId: string): Promise<void> {
    if (names.has(userId)) return;
    const call = await callSlack(api, 'users.info', { user: userId });
    const parsed = call.ok ? UserInfo.safeParse(call.value) : undefined;
    if (!parsed?.success) return;
    const { user } = parsed.data;
    names.set(
      userId,
      user.profile?.display_name ||
        user.real_name ||
        user.profile?.real_name ||
        userId,
    );
  }

  async function readPages(
    method: string,
    args: Record<string, unknown>,
    pages: number,
    { complete }: { readonly complete: boolean },
  ): Promise<Result<RawMessage[]>> {
    const out: RawMessage[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < pages; page += 1) {
      const call = await callSlack(api, method, {
        ...args,
        ...(cursor === undefined ? {} : { cursor }),
      });
      if (!call.ok) return slackFailure(method, call);
      const parsed = Page.safeParse(call.value);
      if (!parsed.success) {
        return failure(
          'E_SLACK',
          `Slack ${method} returned an unexpected shape`,
        );
      }
      for (const raw of parsed.data.messages) {
        const message = RawMessage.safeParse(raw);
        if (message.success) out.push(message.data);
      }
      cursor = parsed.data.response_metadata?.next_cursor || undefined;
      if (cursor === undefined) {
        return parsed.data.has_more === true && complete
          ? failure('E_SLACK', `Slack ${method} reported more without a cursor`)
          : success(out);
      }
    }
    // Replies page oldest first, so a capped read would drop the newest
    // messages, the trigger among them: fail rather than truncate.
    return complete
      ? failure('E_SLACK', `Slack ${method} read stopped at ${pages} pages`)
      : success(out);
  }

  function write(
    channel: string,
    method: string,
    args: Record<string, unknown>,
  ): Promise<SlackCall> {
    // A reaction is best effort: it never waits out a rate limit in the queue.
    const retryRateLimited = !method.startsWith('reactions.');
    return queue.run(channel, () =>
      callSlack(writeApi, method, args, { retryRateLimited }),
    );
  }

  return {
    async fetchMessages(scope, throughTs, fromTs) {
      if (
        fromTs !== undefined &&
        throughTs !== undefined &&
        compareSlackTimestamps(throughTs, fromTs) < 0
      )
        return success([]);
      // The floor is applied to the returned messages, never sent as `oldest`:
      // without `latest`, Slack may page forward from `oldest` and drop the newest window.
      const bounds =
        throughTs === undefined ? {} : { latest: throughTs, inclusive: true };
      const read =
        scope.threadTs === undefined
          ? await readPages(
              'conversations.history',
              {
                channel: scope.channel,
                limit: 200,
                include_all_metadata: true,
                ...bounds,
              },
              // History is newest first: one page is the newest window.
              1,
              { complete: false },
            )
          : await readPages(
              'conversations.replies',
              {
                channel: scope.channel,
                ts: scope.threadTs,
                limit: 200,
                include_all_metadata: true,
                ...bounds,
              },
              maxPages,
              { complete: true },
            );
      if (!read.ok) return read;

      const raws = read.value
        .filter(
          (raw) =>
            CONTENT_SUBTYPES.has(raw.subtype) &&
            !(
              raw.bot_id === botId &&
              raw.metadata?.event_type === APPROVAL_EVENT
            ) &&
            (throughTs === undefined ||
              compareSlackTimestamps(raw.ts, throughTs) <= 0) &&
            (fromTs === undefined ||
              compareSlackTimestamps(raw.ts, fromTs) >= 0) &&
            // A channel council reads top-level posts and thread broadcasts only.
            (scope.threadTs !== undefined ||
              raw.thread_ts === undefined ||
              raw.thread_ts === raw.ts ||
              raw.subtype === 'thread_broadcast'),
        )
        .toSorted((a, b) => compareSlackTimestamps(a.ts, b.ts));

      const ids = new Set<string>();
      for (const raw of raws) {
        if (raw.bot_id === undefined && raw.user !== undefined)
          ids.add(raw.user);
        for (const id of mentionedUserIds(raw.text ?? '')) ids.add(id);
      }
      ids.delete(botUserId);
      await Promise.all([...ids].map(resolveName));
      const here = seen.get(scope.channel) ?? new Set<string>();
      for (const id of ids) here.add(id);
      seen.set(scope.channel, here);

      const nameOf = (userId: string) => names.get(userId) ?? userId;
      const messages: Message[] = [];
      for (const raw of raws) {
        const author = classifyAuthor(raw, {
          botId,
          membersByName,
          humanName: nameOf,
        });
        if (!author) continue;
        const files = (raw.files ?? [])
          .map(({ name }) => `[file: ${name ?? 'unnamed'}]`)
          .join(' ');
        const body = renderSlackText(raw.text ?? '', {
          botUserId,
          name: nameOf,
        });
        messages.push({
          ts: raw.ts,
          author,
          text: [body, files].filter(Boolean).join('\n'),
        });
      }
      return success(messages);
    },

    async postMember(scope, { member, text, chainId, turnId, mentionPeople }) {
      const people = new Map<string, string>();
      if (mentionPeople) {
        for (const id of seen.get(scope.channel) ?? []) {
          const name = names.get(id);
          if (name !== undefined && name !== id) people.set(id, name);
        }
      }
      // One message per turn: text over the limit is truncated, never split.
      // Every mention the model wrote is broken; one is added back only
      // where a known person's name matched.
      const posting = truncateMarkdown(
        linkPeopleMentions(text, people, handles),
      );
      const call = await write(scope.channel, 'chat.postMessage', {
        ...target(scope),
        username: member.name,
        ...('emoji' in member.avatar
          ? { icon_emoji: member.avatar.emoji }
          : { icon_url: member.avatar.url }),
        markdown_text: posting,
        metadata: {
          event_type: MEMBER_POST_EVENT,
          event_payload: { member: member.id, chain: chainId, turn: turnId },
        },
      });
      if (!call.ok) return slackFailure('chat.postMessage', call);
      const posted = Posted.safeParse(call.value);
      return posted.success
        ? success({ ts: posted.data.ts, text: posting })
        : failure('E_SLACK', 'Slack chat.postMessage returned no ts');
    },

    async postNotice(scope, text, panel) {
      const members: PanelMember[] = [];
      for (const id of panel?.roster ?? []) {
        const member = membersById.get(id);
        if (!member)
          return failure('E_UNKNOWN_MEMBER', `Unknown council member: ${id}`);
        members.push(member);
      }
      const call = await write(scope.channel, 'chat.postMessage', {
        ...target(scope),
        ...(panel
          ? panelMessage(text, panel, members)
          : { markdown_text: truncateMarkdown(neutraliseBroadcasts(text)) }),
        unfurl_links: false,
        unfurl_media: false,
        metadata: {
          event_type: NOTICE_EVENT,
          event_payload: { kind: 'notice' },
        },
      });
      if (!call.ok) return slackFailure('chat.postMessage', call);
      const posted = Posted.safeParse(call.value);
      return posted.success
        ? success({ ts: posted.data.ts })
        : failure('E_SLACK', 'Slack chat.postMessage returned no ts');
    },

    async deleteMessage(channel, ts) {
      const call = await write(channel, 'chat.delete', { channel, ts });
      return call.ok ? success(undefined) : slackFailure('chat.delete', call);
    },

    async postApproval(scope, request) {
      const call = await write(scope.channel, 'chat.postMessage', {
        ...target(scope),
        ...approvalMessage(request),
        unfurl_links: false,
        unfurl_media: false,
        metadata: {
          event_type: APPROVAL_EVENT,
          event_payload: { kind: 'approval' },
        },
      });
      if (!call.ok) return slackFailure('chat.postMessage', call);
      const posted = Posted.safeParse(call.value);
      return posted.success
        ? success({ ts: posted.data.ts })
        : failure('E_SLACK', 'Slack chat.postMessage returned no ts');
    },

    async updateApproval(scope, ts, request, outcome) {
      // Show who decided by name; the id is the fallback when the lookup fails.
      let decidedBy: string | undefined;
      if ('userId' in outcome) {
        await resolveName(outcome.userId);
        decidedBy = names
          .get(outcome.userId)
          ?.replace(/\s+/gu, ' ')
          .slice(0, 100);
      }
      const call = await write(scope.channel, 'chat.update', {
        channel: scope.channel,
        ts,
        ...approvalMessage(request, outcome, decidedBy),
      });
      return call.ok ? success(undefined) : slackFailure('chat.update', call);
    },

    async setReaction(channel, ts, reaction, present) {
      const method = present ? 'reactions.add' : 'reactions.remove';
      const call = await write(channel, method, {
        channel,
        timestamp: ts,
        name: reaction,
      });
      if (
        call.ok ||
        call.error === (present ? 'already_reacted' : 'no_reaction')
      ) {
        return success(undefined);
      }
      return slackFailure(method, call);
    },
  };
}
