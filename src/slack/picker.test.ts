import { CliError } from '@council/core/errors.js';
import { failure, success, type Result } from '@council/core/result.js';
import { describe, expect, it, vi } from 'vitest';

import {
  createPicker,
  decodeMetadata,
  MEMBERS_BLOCK,
  type PickerConfig,
  type PickerSource,
  parsePickerSubmission,
  planPickerOpen,
  PRESET_BLOCK,
  QUESTION_BLOCK,
  REFUSED,
  rosterFingerprint,
  shortcutSource,
  WHERE_BLOCK,
} from './picker.js';

const member = { name: 'M' } as PickerConfig['members'][string];
const config: PickerConfig = {
  members: { guide: member, critic: member, scout: member },
  presets: { review: ['guide', 'critic'], solo: ['scout'] },
  defaultPreset: 'review',
  slack: { allowedUsers: ['U1'] },
};
const responseUrl = 'https://hooks.slack.com/commands/T1/1/abc';
const command: PickerSource = {
  kind: 'command',
  channel: 'C1',
  user: 'U1',
  responseUrl,
};
const shortcut: PickerSource = {
  kind: 'shortcut',
  channel: 'C1',
  user: 'U1',
  responseUrl,
  threadTs: '1.000001',
  messageTs: '1.000001',
};

const metadata = (
  source: PickerSource,
  fingerprint = rosterFingerprint(config),
) => JSON.stringify({ source, fingerprint });

function values({
  preset,
  members = [],
  question = null,
  where,
}: {
  preset?: string;
  members?: string[];
  question?: string | null;
  where?: string;
}) {
  return {
    [PRESET_BLOCK]: {
      preset: { selected_option: preset ? { value: preset } : null },
    },
    [MEMBERS_BLOCK]: {
      members: { selected_options: members.map((value) => ({ value })) },
    },
    [QUESTION_BLOCK]: { question: { value: question } },
    ...(where
      ? { [WHERE_BLOCK]: { where: { selected_option: { value: where } } } }
      : {}),
  };
}

function submit(
  source: PickerSource,
  state: Parameters<typeof values>[0],
  fingerprint?: string,
) {
  return parsePickerSubmission(config, {
    private_metadata: metadata(source, fingerprint),
    state: { values: values(state) },
  });
}

describe('parsePickerSubmission', () => {
  it.each([
    [
      'members override the preset',
      submit(command, { preset: 'p1', members: ['m1'], question: 'Q' }),
      { roster: ['critic'], where: 'thread', question: 'Q' },
    ],
    [
      'the chosen preset fills an empty member list',
      submit(command, { preset: 'p1', question: ' Q ' }),
      { preset: 'solo', roster: ['scout'], where: 'thread', question: 'Q' },
    ],
    [
      'the command can convene the whole channel',
      submit(command, { question: 'Q', where: 'channel' }),
      {
        preset: 'review',
        roster: ['guide', 'critic'],
        where: 'channel',
        question: 'Q',
      },
    ],
    [
      'the default preset applies when none is chosen',
      submit(shortcut, {}),
      { preset: 'review', roster: ['guide', 'critic'], where: 'thread' },
    ],
    [
      'a blank shortcut question means the message is the prompt',
      submit(shortcut, { question: '  \n ' }),
      { preset: 'review', roster: ['guide', 'critic'], where: 'thread' },
    ],
  ])('%s', (_, result, expected) => {
    expect(result).toEqual({
      ok: true,
      source: expect.anything(),
      ...expected,
    });
  });

  it.each([
    [
      'a blank command question',
      submit(command, { question: ' ' }),
      QUESTION_BLOCK,
    ],
    [
      'an unknown member',
      submit(command, { members: ['ghost'], question: 'Q' }),
      MEMBERS_BLOCK,
    ],
    [
      'an unknown preset',
      submit(shortcut, { preset: 'toString' }),
      PRESET_BLOCK,
    ],
    [
      'a form opened before a preset changed its members',
      submit(
        command,
        { question: 'Q' },
        rosterFingerprint({
          ...config,
          presets: { ...config.presets, review: ['guide'] },
        }),
      ),
      QUESTION_BLOCK,
    ],
  ])('rejects %s', (_, result, block) => {
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors)).toEqual([block]);
  });
});

describe('decodeMetadata', () => {
  it('round-trips what the view carries', () => {
    expect(decodeMetadata(metadata(shortcut))).toEqual({
      source: shortcut,
      fingerprint: rosterFingerprint(config),
    });
  });

  it.each([
    ['not JSON', '{'],
    ['not a string', 42],
    ['oversized', metadata(command).padEnd(3_001)],
    ['an extra field', metadata({ ...command, roster: ['guide'] } as never)],
    [
      'a foreign response url',
      metadata({ ...command, responseUrl: 'https://evil.example/x' }),
    ],
    ['a malformed ts', metadata({ ...shortcut, threadTs: '../1' })],
    [
      'a missing message ts',
      metadata({ ...shortcut, messageTs: undefined } as never),
    ],
    ['no fingerprint', JSON.stringify({ source: command })],
  ])('rejects %s', (_, raw) => {
    expect(decodeMetadata(raw)).toBeUndefined();
  });
});

describe('shortcutSource', () => {
  const payload = {
    channel: { id: 'C1' },
    user: { id: 'U1' },
    response_url: responseUrl,
  };

  it.each([
    ['a root message starts its own thread', { ts: '5.000001' }, '5.000001'],
    [
      'a reply belongs to its parent thread',
      { ts: '5.000009', thread_ts: '5.000001' },
      '5.000001',
    ],
  ])('%s', (_, message, threadTs) => {
    expect(shortcutSource({ ...payload, message })).toMatchObject({
      threadTs,
      messageTs: message.ts,
    });
  });
});

describe('planPickerOpen', () => {
  it('refuses users outside slack.allowedUsers', () => {
    expect(planPickerOpen(config, { ...command, user: 'U2' })).toEqual({
      kind: 'refuse',
      text: REFUSED,
    });
    expect(planPickerOpen(config, command).kind).toBe('open');
  });

  it('offers the whole-channel choice on the slash command only', () => {
    const view = (source: PickerSource) =>
      JSON.stringify(planPickerOpen(config, source));
    expect(view(command)).toContain('This whole channel');
    expect(view(shortcut)).not.toContain('This whole channel');
  });
});

describe('createPicker', () => {
  function setup(
    convene: () => Promise<unknown>,
    {
      source = shortcut,
      state = {},
      deleted = success(undefined),
    }: {
      source?: PickerSource;
      state?: Parameters<typeof values>[0];
      deleted?: Result<void>;
    } = {},
  ) {
    const accepted = new Set(['C1:1.000001']);
    const slack = {
      fetchMessages: vi.fn(async () =>
        success([
          {
            ts: '1.000001',
            author: { kind: 'notice' as const },
            text: `Ship *it* to <@U9> @here\n> quoted${'x'.repeat(2_000)}`,
          },
        ]),
      ),
      postNotice: vi.fn(
        async (_scope: unknown, _text: string, _panel: unknown) =>
          success({ ts: '9.000001' }),
      ),
      deleteMessage: vi.fn(async () => deleted),
    };
    const service = {
      getCouncil: () => undefined,
      convene: vi.fn(convene),
      handleHumanMessage: vi.fn(
        async ({
          scope,
          message,
        }: {
          scope: { channel: string };
          message: { ts: string };
        }) => {
          const key = `${scope.channel}:${message.ts}`;
          if (accepted.has(key)) return 'duplicate' as const;
          accepted.add(key);
          return 'accepted' as const;
        },
      ),
    };
    const fetch = vi.fn(
      async (_url: unknown, _init?: RequestInit) => new Response('ok'),
    );
    const picker = createPicker({
      config,
      service: service as never,
      slack,
      reader: { apiCall: async () => ({ ok: false, error: 'x' }) },
      writer: { apiCall: async () => ({ ok: true }) },
      appUserId: 'UAPP',
      log: () => {},
      fetch,
    });
    const run = picker.submit('U1', {
      id: 'V1',
      private_metadata: metadata(source),
      state: { values: values(state) },
    }).run;
    return { run, slack, service, fetch };
  }

  it("opens a round from its own post, which quotes a blank shortcut's message", async () => {
    const { run, slack, service, fetch } = setup(async () => ({}));
    await run?.();
    expect(service.handleHumanMessage).toHaveBeenCalledWith({
      scope: { channel: 'C1', threadTs: '1.000001' },
      message: expect.objectContaining({ ts: '9.000001' }),
    });
    await expect(
      service.handleHumanMessage.mock.results[0]?.value,
    ).resolves.toBe('accepted');
    expect(fetch).not.toHaveBeenCalled();
    expect(slack.postNotice).toHaveBeenCalledWith(
      { channel: 'C1', threadTs: '1.000001' },
      'Council convened by U1 on this message:',
      {
        preset: 'review',
        roster: ['guide', 'critic'],
        quote: `Ship *it* to <@U9> @here\n> quoted${'x'.repeat(2_000)}`,
      },
    );
  });

  it('convenes the whole channel from a top-level post', async () => {
    const { run, slack, service } = setup(async () => ({}), {
      source: command,
      state: { members: ['m1'], question: 'Q', where: 'channel' },
    });
    await run?.();
    expect(slack.postNotice).toHaveBeenCalledWith(
      { channel: 'C1' },
      'Council convened by U1: Q',
      { roster: ['critic'] },
    );
    expect(service.convene).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { channel: 'C1' },
        convenedAtTs: '9.000001',
      }),
    );
    expect(service.handleHumanMessage).toHaveBeenCalledWith(
      expect.objectContaining({ scope: { channel: 'C1' } }),
    );
  });

  it.each([
    ['deleted', success(undefined), false],
    ['left behind', failure('E_SLACK', 'x'), true],
  ])(
    'deletes its post and tells the user when convening fails (post %s)',
    async (_, deleted, leftBehind) => {
      const { run, slack, fetch } = setup(
        async () => {
          throw new CliError('E_COUNCIL_EXISTS', 'exists');
        },
        { deleted },
      );
      await run?.();
      expect(slack.deleteMessage).toHaveBeenCalledWith('C1', '9.000001');
      const body = String(fetch.mock.calls[0]?.[1]?.body);
      expect(body).toContain('This thread already has a council.');
      expect(body.includes('could not be removed')).toBe(leftBehind);
    },
  );
});
