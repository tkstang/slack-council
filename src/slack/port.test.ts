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
      'member by username fallback',
      { bot_id: 'BAPP', username: 'Ada' },
      { kind: 'member', memberId: 'ada' },
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
  it('reads a thread oldest first through the bound and renders mentions', async () => {
    const calls: string[] = [];
    const api = {
      async apiCall(method: string, args: Record<string, unknown> = {}) {
        calls.push(method);
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
              messages: [
                {
                  ts: '10.000003',
                  bot_id: 'BAPP',
                  username: 'Ada',
                  text: 'answer',
                },
                { ts: '10.000004', user: 'U1', text: 'too late' },
              ],
            };
      },
    };
    const port = createSlackPort({
      api,
      writeApi: api,
      botId: 'BAPP',
      botUserId: 'UAPP',
      members: [{ id: 'ada', name: 'Ada' }],
    });

    expect(
      await port.fetchMessages(
        { channel: 'C1', threadTs: '10.000001' },
        '10.000003',
      ),
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
    expect(calls.filter((m) => m === 'users.info')).toHaveLength(1);
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
    expect(second).toEqual({ ok: true, value: undefined });
    expect(attempts).toBe(2);
  });
});
