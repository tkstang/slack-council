import { describe, expect, it } from 'vitest';

import { createSlackClients } from './api.js';
import { classifyAuthor, createSlackPort } from './port.js';

const context = {
  botId: 'BAPP',
  membersByName: new Map([['Ada', 'ada']]),
  humanName: (id: string) => `name-${id}`,
};
const memberMeta = {
  event_type: 'council_member_post',
  event_payload: { member: 'bo' },
};

describe('classifyAuthor', () => {
  it.each([
    [
      'human',
      { user: 'U1' },
      { kind: 'human', userId: 'U1', displayName: 'name-U1' },
    ],
    [
      'member by metadata',
      { bot_id: 'BAPP', username: 'Ada', metadata: memberMeta },
      { kind: 'member', memberId: 'bo' },
    ],
    [
      'app post as itself',
      { bot_id: 'BAPP', user: 'UAPP' },
      { kind: 'notice' },
    ],
    [
      'notice metadata wins over a member name',
      {
        bot_id: 'BAPP',
        username: 'Ada',
        metadata: { event_type: 'council_notice' },
      },
      { kind: 'notice' },
    ],
    [
      'other bot posing as a member',
      { bot_id: 'BOTHER', username: 'Ada' },
      { kind: 'otherBot', displayName: 'Ada' },
    ],
    ['nobody', {}, undefined],
  ])('%s', (_, fields, author) => {
    expect(classifyAuthor({ ts: '1.0', ...fields }, context)).toEqual(author);
  });
});

describe('fetchMessages', () => {
  it('reads a thread in ts order through the bound and renders mentions', async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const api = {
      async apiCall(method: string, args: Record<string, unknown> = {}) {
        calls.push([method, args]);
        if (method === 'users.info') {
          return {
            ok: true,
            user: { real_name: 'Jane', profile: { display_name: '' } },
          };
        }
        return args['cursor'] === undefined
          ? {
              ok: true,
              messages: [
                {
                  ts: '10.000001',
                  user: 'U1',
                  text: '<@UAPP> question for <@U1>',
                },
                {
                  ts: '10.000002',
                  subtype: 'channel_join',
                  user: 'U2',
                  text: 'joined',
                },
              ],
              response_metadata: { next_cursor: 'next' },
            }
          : {
              ok: true,
              // The in-range reply sits on page two, so dropping that page fails.
              messages: [
                { ts: '10.000004', user: 'U1', text: 'too late' },
                {
                  ts: '10.000003',
                  bot_id: 'BAPP',
                  username: 'Ada',
                  text: 'answer',
                },
              ],
            };
      },
    };
    const options = {
      api,
      writeApi: api,
      botId: 'BAPP',
      botUserId: 'UAPP',
      members: [{ id: 'ada', name: 'Ada' }],
    };
    const scope = { channel: 'C1', threadTs: '10.000001' };

    expect(
      await createSlackPort(options).fetchMessages(scope, '10.000003'),
    ).toEqual({
      ok: true,
      value: [
        {
          ts: '10.000001',
          author: { kind: 'human', userId: 'U1', displayName: 'Jane' },
          text: '@council question for @Jane',
        },
        {
          ts: '10.000003',
          author: { kind: 'member', memberId: 'ada' },
          text: 'answer',
        },
      ],
    });
    expect(calls[0]).toEqual([
      'conversations.replies',
      expect.objectContaining({
        ts: '10.000001',
        latest: '10.000003',
        inclusive: true,
      }),
    ]);
    expect(calls.filter(([m]) => m === 'users.info')).toHaveLength(1);

    // A thread longer than the page cap fails instead of dropping its newest messages.
    expect(
      await createSlackPort({ ...options, maxPages: 1 }).fetchMessages(
        scope,
        '10.000003',
      ),
    ).toMatchObject({ ok: false, code: 'E_SLACK' });
  });
});

describe('writes', () => {
  it('a write that times out releases the next write after one attempt', async () => {
    let attempts = 0;
    const { writer } = createSlackClients('xoxb-test', {
      logger: undefined,
      writeTimeoutMs: 20,
      fetch: async (_url, init) => {
        attempts += 1;
        if (attempts === 1) {
          // Stalls until the client's timeout aborts it.
          return new Promise((_, reject) =>
            init?.signal?.addEventListener('abort', () =>
              reject(new Error('aborted')),
            ),
          );
        }
        return new Response(JSON.stringify({ ok: true, ts: '2.0' }), {
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    const port = createSlackPort({
      api: writer,
      writeApi: writer,
      botId: 'BAPP',
      botUserId: 'UAPP',
      members: [],
      intervalMs: 0,
    });
    const scope = { channel: 'C1' };

    const [first, second] = await Promise.all([
      port.postNotice(scope, 'one'),
      port.postNotice(scope, 'two'),
    ]);
    expect(first).toMatchObject({ ok: false, code: 'E_SLACK' });
    expect(second).toEqual({ ok: true, value: { ts: '2.0' } });
    expect(attempts).toBe(2);
  });
});

// The arguments sit alone in their own section so they are shown in full.
const plain = (text: unknown) => ({
  type: 'section',
  text: { type: 'plain_text', text },
});

it('posts plain-text approval buttons in scope and clears them on the outcome update', async () => {
  const calls: [string, Record<string, unknown>][] = [];
  const api = {
    async apiCall(method: string, args: Record<string, unknown> = {}) {
      if (method === 'users.info')
        return { ok: true, user: { real_name: 'Thomas <S>' } };
      calls.push([method, args]);
      return { ok: true, ts: '2.000000' };
    },
  };
  const slack = createSlackPort({
    api,
    writeApi: api,
    botId: 'BAPP',
    botUserId: 'UAPP',
    members: [],
    intervalMs: 0,
  });
  const scope = { channel: 'C1', threadTs: '1.000000' };
  const request = {
    id: 'opaque',
    memberName: 'Ada',
    tool: 'read_file',
    preview: '{"path":"<!here>"}',
  };
  expect(await slack.postApproval(scope, request)).toEqual({
    ok: true,
    value: { ts: '2.000000' },
  });
  expect(
    await slack.updateApproval(scope, '2.000000', request, {
      kind: 'denied',
      userId: 'U1',
    }),
  ).toMatchObject({ ok: true });
  const section = plain(request.preview);
  expect(calls).toMatchObject([
    [
      'chat.postMessage',
      {
        channel: 'C1',
        thread_ts: '1.000000',
        mrkdwn: false,
        text: expect.stringContaining('&lt;!here&gt;'),
        blocks: [
          plain(expect.stringContaining('read_file')),
          section,
          {
            type: 'actions',
            elements: [
              { action_id: 'council_approve_tool', value: 'opaque' },
              { action_id: 'council_deny_tool', value: 'opaque' },
            ],
          },
        ],
      },
    ],
    [
      'chat.update',
      {
        channel: 'C1',
        ts: '2.000000',
        text: expect.stringContaining('Request denied by Thomas &lt;S&gt;.'),
        blocks: [
          plain(expect.stringContaining('read_file')),
          section,
          plain('Request denied by Thomas <S>.'),
        ],
      },
    ],
  ]);
});
