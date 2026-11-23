import type {
  ApprovalOutcome,
  ApprovalPort,
  ApprovalRequest,
  SlackPort,
} from '@council/core/ports.js';
import { failure, success, type Result } from '@council/core/result.js';
import type { Author, Member, Message, Scope } from '@council/core/types.js';
import { z } from 'zod';

import { callSlack, type SlackApi, type SlackCall } from './api.js';
import {
  mentionedUserIds,
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
const APPROVAL_EVENT = 'council_tool_approval';

export interface SlackPortOptions extends WriteQueueOptions {
  /** Client for reads. */
  readonly api: SlackApi;
  /** Client for writes. It must time out and must not retry automatically. */
  readonly writeApi: SlackApi;
  /** The app's own bot id and bot user id, from `auth.test`. */
  readonly botId: string;
  readonly botUserId: string;
  readonly members: readonly Pick<Member, 'id' | 'name'>[];
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

function compareTs(a: string, b: string): number {
  const [aSec = '0', aFrac = ''] = a.split('.');
  const [bSec = '0', bFrac = ''] = b.split('.');
  const seconds = BigInt(aSec) - BigInt(bSec);
  if (seconds !== 0n) return seconds < 0n ? -1 : 1;
  return aFrac.padEnd(6, '0').localeCompare(bFrac.padEnd(6, '0'));
}

function slackFailure(method: string, call: SlackCall & { ok: false }) {
  return failure('E_SLACK', `Slack ${method} failed: ${call.error}`);
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

function approvalMessage(request: ApprovalRequest, outcome?: ApprovalOutcome) {
  const member = request.memberName.replace(/\s+/gu, ' ').slice(0, 100);
  const text = [
    outcome === undefined
      ? `${member} requests approval for ${request.tool}.`
      : `${member} requested ${request.tool}.`,
    request.preview,
    outcome &&
      ('userId' in outcome
        ? `Request ${outcome.kind} by ${outcome.userId}.`
        : `Request ${outcome.kind}.`),
  ]
    .filter(Boolean)
    .join('\n');

  return {
    text: text
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;'),
    mrkdwn: false,
    blocks: [
      { type: 'section', text: { type: 'plain_text', text, emoji: false } },
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
                  text: { type: 'plain_text', text: 'Deny' },
                  action_id: DENY_ACTION,
                  style: 'danger',
                  value: request.id,
                },
              ],
            },
          ]
        : []),
    ],
  };
}

export function createSlackPort(
  options: SlackPortOptions,
): SlackPort & ApprovalPort {
  const { api, writeApi, botId, botUserId, maxPages = 50 } = options;
  const queue = createChannelWriteQueue(options);
  const membersByName = new Map(
    options.members.map(({ id, name }) => [name, id]),
  );
  const names = new Map<string, string>();

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
      if (cursor === undefined) return success(out);
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
    return queue.run(channel, () => callSlack(writeApi, method, args));
  }

  return {
    async fetchMessages(scope, throughTs) {
      const bound =
        throughTs === undefined ? {} : { latest: throughTs, inclusive: true };
      const read =
        scope.threadTs === undefined
          ? await readPages(
              'conversations.history',
              {
                channel: scope.channel,
                limit: 200,
                include_all_metadata: true,
                ...bound,
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
                ...bound,
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
            (throughTs === undefined || compareTs(raw.ts, throughTs) <= 0) &&
            // A channel council reads top-level posts and thread broadcasts only.
            (scope.threadTs !== undefined ||
              raw.thread_ts === undefined ||
              raw.thread_ts === raw.ts ||
              raw.subtype === 'thread_broadcast'),
        )
        .toSorted((a, b) => compareTs(a.ts, b.ts));

      const ids = new Set<string>();
      for (const raw of raws) {
        if (raw.bot_id === undefined && raw.user !== undefined)
          ids.add(raw.user);
        for (const id of mentionedUserIds(raw.text ?? '')) ids.add(id);
      }
      ids.delete(botUserId);
      await Promise.all([...ids].map(resolveName));

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

    async postMember(scope, { member, text, chainId, turnId }) {
      // One message per turn: text over the limit is truncated, never split.
      const call = await write(scope.channel, 'chat.postMessage', {
        ...target(scope),
        username: member.name,
        ...('emoji' in member.avatar
          ? { icon_emoji: member.avatar.emoji }
          : { icon_url: member.avatar.url }),
        markdown_text: truncateMarkdown(neutraliseBroadcasts(text)),
        metadata: {
          event_type: MEMBER_POST_EVENT,
          event_payload: { member: member.id, chain: chainId, turn: turnId },
        },
      });
      if (!call.ok) return slackFailure('chat.postMessage', call);
      const posted = Posted.safeParse(call.value);
      return posted.success
        ? success({ ts: posted.data.ts })
        : failure('E_SLACK', 'Slack chat.postMessage returned no ts');
    },

    async postNotice(scope, text) {
      const call = await write(scope.channel, 'chat.postMessage', {
        ...target(scope),
        markdown_text: neutraliseBroadcasts(text),
        metadata: {
          event_type: NOTICE_EVENT,
          event_payload: { kind: 'notice' },
        },
      });
      return call.ok
        ? success(undefined)
        : slackFailure('chat.postMessage', call);
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
      const call = await write(scope.channel, 'chat.update', {
        channel: scope.channel,
        ts,
        ...approvalMessage(request, outcome),
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
