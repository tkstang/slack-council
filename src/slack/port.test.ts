import type { ChartInput } from '@council/core/chart.js';
import { describe, expect, it, vi } from 'vitest';

import { createSlackClients, type SlackApi } from './api.js';
import { classifyAuthor, createSlackPort, NOTICE_EVENT } from './port.js';

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

describe('postMember', () => {
  it.each([
    'no charts',
    'charts',
    'rejected blocks',
    'unknown outcome',
  ] as const)('posts a reply with %s', async (scenario) => {
    const apiCall = vi.fn<SlackApi['apiCall']>(async () => ({
      ok: true,
      ts: '2.0',
    }));
    if (scenario === 'rejected blocks')
      apiCall.mockRejectedValueOnce({ data: { error: 'invalid_blocks' } });
    if (scenario === 'unknown outcome')
      apiCall.mockRejectedValueOnce({ code: 'slack_webapi_request_error' });
    const api = { apiCall };
    const member = {
      id: 'ada',
      name: 'Ada',
      avatar: { emoji: ':owl:' },
      provider: 'test',
      model: 'test',
      tools: ['show_chart'],
    };
    const slack = createSlackPort({
      api,
      writeApi: api,
      botId: 'BAPP',
      botUserId: 'UAPP',
      members: [member],
      intervalMs: 0,
    });
    const charts: ChartInput[] = [
      {
        title: 'Active & pending',
        chart: { type: 'pie', segments: [{ label: '<@U1>', value: 5 }] },
      },
      {
        title: 'Activity',
        chart: {
          type: 'line',
          categories: ['Jan', 'Feb'],
          series: [
            { name: 'Active', values: [3, 5] },
            { name: 'Pending', values: [2, 1] },
          ],
          xLabel: 'Month',
          yLabel: 'Users',
        },
      },
    ];
    const text = 'Activity rose, @here.';
    const posting = 'Activity rose, @\u2060here.';
    const result = await slack.postMember(
      { channel: 'C1', threadTs: '1.0' },
      {
        member,
        text,
        chainId: 'chain',
        turnId: 'turn',
        ...(scenario === 'no charts' ? {} : { charts }),
      },
    );
    const identity = {
      channel: 'C1',
      thread_ts: '1.0',
      username: 'Ada',
      icon_emoji: ':owl:',
    };
    const metadata = {
      event_type: 'council_member_post',
      event_payload: { member: 'ada', chain: 'chain', turn: 'turn' },
    };
    if (scenario === 'no charts') {
      expect(apiCall).toHaveBeenCalledExactlyOnceWith('chat.postMessage', {
        ...identity,
        markdown_text: posting,
        metadata,
      });
    } else {
      const plain = {
        ...identity,
        text: [
          posting,
          'Chart: Active &amp; pending\nLabel | Value\n@\u2060U1 | 5',
          'Chart: Activity (Users)\nMonth | Active | Pending\nJan | 3 | 2\nFeb | 5 | 1',
        ].join('\n\n'),
        metadata,
      };
      expect(apiCall).toHaveBeenNthCalledWith(1, 'chat.postMessage', {
        ...plain,
        blocks: [
          { type: 'markdown', text: posting },
          {
            type: 'data_visualization',
            title: 'Active & pending',
            chart: { type: 'pie', segments: [{ label: '<@U1>', value: 5 }] },
          },
          {
            type: 'data_visualization',
            title: 'Activity',
            chart: {
              type: 'line',
              axis_config: {
                categories: ['Jan', 'Feb'],
                x_label: 'Month',
                y_label: 'Users',
              },
              series: [
                {
                  name: 'Active',
                  data: [
                    { label: 'Jan', value: 3 },
                    { label: 'Feb', value: 5 },
                  ],
                },
                {
                  name: 'Pending',
                  data: [
                    { label: 'Jan', value: 2 },
                    { label: 'Feb', value: 1 },
                  ],
                },
              ],
            },
          },
        ],
      });
      if (scenario === 'rejected blocks') {
        expect(apiCall).toHaveBeenCalledTimes(2);
        expect(apiCall).toHaveBeenNthCalledWith(2, 'chat.postMessage', {
          ...identity,
          markdown_text: [
            posting,
            '```\nChart: Active & pending\nLabel | Value\n@\u2060U1 | 5\n```',
            '```\nChart: Activity (Users)\nMonth | Active | Pending\nJan | 3 | 2\nFeb | 5 | 1\n```',
          ].join('\n\n'),
          metadata,
        });
      } else {
        expect(apiCall).toHaveBeenCalledTimes(1);
      }
    }
    expect(result).toMatchObject(
      scenario === 'unknown outcome'
        ? { ok: false, code: 'E_SLACK' }
        : { ok: true, value: { ts: '2.0', text: posting } },
    );
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
                  ts: '10.0000019',
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
                  ts: '10.000002',
                  bot_id: 'BAPP',
                  metadata: { event_type: NOTICE_EVENT },
                  text: 'Council convened.\n@ada · Ada &lt;@U9&gt; · model',
                  blocks: [{ type: 'table', rows: [] }],
                },
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
      members: [{ id: 'ada', name: 'Ada', model: 'example' }],
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
          ts: '10.000002',
          author: { kind: 'notice' },
          text: 'Council convened.\n@ada · Ada <@U9> · model',
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

  it('applies an inclusive channel floor to returned messages without sending oldest', async () => {
    const api = {
      apiCall: vi.fn(async () => ({
        ok: true,
        messages: [
          { ts: '10.000001', bot_id: 'BAPP', text: 'Later' },
          { ts: '10.000000', bot_id: 'BAPP', text: 'Council convened' },
          { ts: '9.999999', bot_id: 'BAPP', text: 'Earlier' },
        ],
      })),
    };
    const port = createSlackPort({
      api,
      writeApi: api,
      botId: 'BAPP',
      botUserId: 'UAPP',
      members: [],
    });

    expect(
      await port.fetchMessages({ channel: 'C1' }, '10.000000', '10.000000'),
    ).toEqual({
      ok: true,
      value: [
        {
          ts: '10.000000',
          author: { kind: 'notice' },
          text: 'Council convened',
        },
      ],
    });
    expect(api.apiCall).toHaveBeenCalledExactlyOnceWith(
      'conversations.history',
      expect.objectContaining({
        channel: 'C1',
        latest: '10.000000',
        inclusive: true,
      }),
    );
    expect(api.apiCall).not.toHaveBeenCalledWith(
      'conversations.history',
      expect.objectContaining({ oldest: expect.anything() }),
    );
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

const codeCell = (text: string) => ({
  type: 'rich_text',
  elements: [
    {
      type: 'rich_text_section',
      elements: [{ type: 'text', text, style: { code: true } }],
    },
  ],
});
const rawCell = (text: string) => ({ type: 'raw_text', text });

it.each([
  {
    panel: {
      preset: 'review',
      roster: ['guide', 'critic'],
      quote: 'Ship *it* to <!here>',
    },
    label: 'Preset: review',
    rows: [
      ['Handle', 'Name', 'Model', 'Effort', 'Persona'].map(rawCell),
      [
        codeCell('@guide'),
        rawCell('Guide_1'),
        codeCell('family:one` v2'),
        rawCell('—'),
        rawCell('—'),
      ],
      [
        codeCell('@critic'),
        rawCell('Critic <!here>'),
        codeCell('gpt-6-luna'),
        rawCell('*medium* @here'),
        rawCell('Review <@U9>'),
      ],
    ],
    fallback: [
      '&gt; Ship *it* to &lt;!here&gt;',
      '',
      'Preset: review',
      '',
      'Handle · Name · Model · Effort · Persona',
      '@guide · Guide_1 · family:one` v2 · — · —',
      '@critic · Critic &lt;!here&gt; · gpt-6-luna · *medium* @here · Review &lt;@U9&gt;',
    ],
  },
  {
    panel: { roster: ['guide'] },
    label: 'custom panel',
    rows: [
      ['Handle', 'Name', 'Model'].map(rawCell),
      [codeCell('@guide'), rawCell('Guide_1'), codeCell('family:one` v2')],
    ],
    fallback: [
      '',
      'custom panel',
      '',
      'Handle · Name · Model',
      '@guide · Guide_1 · family:one` v2',
    ],
  },
])(
  'posts a convening notice with $label',
  async ({ panel, label, rows, fallback }) => {
    const api = {
      apiCall: vi.fn(
        async (_method: string, _args?: Record<string, unknown>) => ({
          ok: true,
          ts: '2.0',
        }),
      ),
    };
    const slack = createSlackPort({
      api,
      writeApi: api,
      botId: 'BAPP',
      botUserId: 'UAPP',
      members: [
        { id: 'guide', name: 'Guide_1', model: 'family:one`  v2', effort: ' ' },
        {
          id: 'critic',
          name: 'Critic <!here>',
          model: 'gpt-6-luna',
          effort: '*medium* @here',
          persona: {
            title: 'Review <@U9>',
            instructions: 'Check assumptions.',
          },
        },
      ],
      intervalMs: 0,
    });
    const intro = 'Council convened by Sam.';
    expect(
      await slack.postNotice({ channel: 'C1' }, intro, panel),
    ).toMatchObject({ ok: true });
    expect(api.apiCall).toHaveBeenCalledWith(
      'chat.postMessage',
      expect.objectContaining({
        text: [intro, ...fallback].join('\n'),
        mrkdwn: false,
        parse: 'none',
        blocks: [
          {
            type: 'rich_text',
            elements: [
              {
                type: 'rich_text_section',
                elements: [{ type: 'text', text: intro }],
              },
              ...(panel.quote
                ? [
                    {
                      type: 'rich_text_quote',
                      elements: [{ type: 'text', text: panel.quote }],
                    },
                  ]
                : []),
              {
                type: 'rich_text_section',
                elements: [{ type: 'text', text: `\n${label}` }],
              },
            ],
          },
          expect.objectContaining({ type: 'table', rows }),
        ],
        metadata: {
          event_type: NOTICE_EVENT,
          event_payload: { kind: 'notice' },
        },
      }),
    );
    expect(api.apiCall.mock.calls[0]?.[1]).not.toHaveProperty('markdown_text');
  },
);

it.each([
  ['row limit', 'Member', 102, 99],
  ['cell text limit', 'x'.repeat(2_000), 7, 4],
] as const)(
  'bounds a convening notice at the %s',
  async (_limit, name, count, shown) => {
    const api = {
      apiCall: vi.fn(
        async (_method: string, _args?: Record<string, unknown>) => ({
          ok: true,
          ts: '2.0',
        }),
      ),
    };
    const members = Array.from({ length: count }, (_, index) => ({
      id: `m${index}`,
      name,
      model: 'model',
    }));
    const slack = createSlackPort({
      api,
      writeApi: api,
      botId: 'BAPP',
      botUserId: 'UAPP',
      members,
      intervalMs: 0,
    });
    const scope = { channel: 'C1' };
    const roster = members.map(({ id }) => id);
    const quote = 'q'.repeat(1_100);
    expect(
      await slack.postNotice(scope, 'Council convened.', { roster, quote }),
    ).toMatchObject({ ok: true });
    const post = api.apiCall.mock.calls[0]?.[1];
    const blocks = post?.['blocks'] as { rows?: unknown[][] }[];
    const fallback = String(post?.['text']);
    expect(blocks[1]?.rows).toHaveLength(shown + 1);
    expect(fallback.match(/^@m/gmu)).toHaveLength(shown);
    const omitted = `… (${count - shown} panel members omitted)`;
    expect(fallback).toContain(omitted);
    expect(JSON.stringify(blocks[0])).toContain(omitted);
    expect(fallback).toContain('&gt; … (truncated)');
    expect(fallback).not.toContain(quote);
    expect(
      await slack.postNotice(scope, 'Council convened.', {
        roster: [...roster, 'missing'],
      }),
    ).toMatchObject({ ok: false, code: 'E_UNKNOWN_MEMBER' });
    expect(api.apiCall).toHaveBeenCalledTimes(1);
  },
);

// The arguments sit alone in their own section so they are shown in full.
const plain = (text: unknown) => ({
  type: 'section',
  text: { type: 'plain_text', text },
});

it.each([
  {
    tool: 'read_file',
    outcome: { kind: 'denied', userId: 'U1' },
    footer: 'Request denied',
    actions: ['Approve', 'Deny'],
  },
  {
    tool: 'handoff',
    outcome: { kind: 'changes_requested', userId: 'U1', text: 'Revise it' },
    footer: 'Changes requested',
    actions: ['Approve', 'Reject', 'Change'],
  },
] as const)(
  'posts the full $tool approval in scope and clears its buttons after a decision',
  async ({ tool, outcome, footer, actions }) => {
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
      memberName: 'Ada *Guide* <@U9> https://example.invalid',
      tool,
      preview: `{"path":"<!here>"}${tool === 'handoff' ? '📄'.repeat(3_500) : ''}`,
    };
    expect(await slack.postApproval(scope, request)).toEqual({
      ok: true,
      value: { ts: '2.000000' },
    });
    expect(
      await slack.updateApproval(scope, '2.000000', request, outcome),
    ).toMatchObject({ ok: true });
    const postedBlocks = calls[0]?.[1]['blocks'] as {
      text: { text: string };
    }[];
    const sections = postedBlocks.slice(1, -1);
    expect(sections.every((block) => block.text.text.length <= 3_000)).toBe(
      true,
    );
    expect(sections.map((block) => block.text.text).join('')).toBe(
      request.preview,
    );
    const literalSections = sections.map(({ text }) => plain(text.text));
    const heading = (verb: string) => ({
      type: 'rich_text',
      elements: [
        {
          type: 'rich_text_section',
          elements: [
            { type: 'text', text: `${request.memberName} ${verb} ` },
            { type: 'text', text: tool, style: { code: true } },
            { type: 'text', text: '.' },
          ],
        },
      ],
    });
    const preview = request.preview.replace('<!here>', '&lt;!here&gt;');
    const plainName = 'Ada *Guide* &lt;@U9&gt; https://example.invalid';
    expect(calls).toMatchObject([
      [
        'chat.postMessage',
        {
          channel: 'C1',
          thread_ts: '1.000000',
          mrkdwn: false,
          text: `${plainName} requests approval for ${tool}.\n${preview}`,
          blocks: [
            heading('requests approval for'),
            ...literalSections,
            {
              type: 'actions',
              elements: actions.map((text, index) => ({
                action_id: [
                  'council_approve_tool',
                  'council_deny_tool',
                  'council_change_handoff',
                ][index],
                text: { text },
                value: 'opaque',
              })),
            },
          ],
        },
      ],
      [
        'chat.update',
        {
          channel: 'C1',
          ts: '2.000000',
          mrkdwn: false,
          text: `${plainName} requested ${tool}.\n${preview}\n${footer} by Thomas &lt;S&gt;.`,
          blocks: [
            heading('requested'),
            ...literalSections,
            plain(`${footer} by Thomas <S>.`),
          ],
        },
      ],
    ]);
  },
);
