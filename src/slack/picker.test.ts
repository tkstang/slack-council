import { CliError } from '@council/core/errors.js';
import { success } from '@council/core/result.js';
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
  shortcutSource,
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

function submit(
  source: PickerSource,
  {
    preset,
    members = [],
    question = null,
  }: { preset?: string; members?: string[]; question?: string | null },
) {
  return parsePickerSubmission(config, {
    private_metadata: JSON.stringify(source),
    state: {
      values: {
        [PRESET_BLOCK]: {
          preset: { selected_option: preset ? { value: preset } : null },
        },
        [MEMBERS_BLOCK]: {
          members: { selected_options: members.map((value) => ({ value })) },
        },
        [QUESTION_BLOCK]: { question: { value: question } },
      },
    },
  });
}

describe('parsePickerSubmission', () => {
  it.each([
    [
      'members override the preset',
      submit(command, { preset: 'solo', members: ['critic'], question: 'Q' }),
      { roster: ['critic'], question: 'Q' },
    ],
    [
      'the chosen preset fills an empty member list',
      submit(command, { preset: 'solo', question: ' Q ' }),
      { roster: ['scout'], question: 'Q' },
    ],
    [
      'the default preset applies when none is chosen',
      submit(shortcut, {}),
      { roster: ['guide', 'critic'] },
    ],
    [
      'a blank shortcut question means the message is the prompt',
      submit(shortcut, { question: '  \n ' }),
      { roster: ['guide', 'critic'] },
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
  ])('rejects %s', (_, result, block) => {
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors)).toEqual([block]);
  });
});

describe('decodeMetadata', () => {
  it('round-trips what the view carries', () => {
    expect(decodeMetadata(JSON.stringify(shortcut))).toEqual(shortcut);
  });

  it.each([
    ['not JSON', '{'],
    ['not a string', 42],
    ['oversized', JSON.stringify(command).padEnd(3_001)],
    ['an extra field', JSON.stringify({ ...command, roster: ['guide'] })],
    [
      'a foreign response url',
      JSON.stringify({ ...command, responseUrl: 'https://evil.example/x' }),
    ],
    ['a malformed ts', JSON.stringify({ ...shortcut, threadTs: '../1' })],
    [
      'a missing message ts',
      JSON.stringify({ ...shortcut, messageTs: undefined }),
    ],
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
});

describe('createPicker', () => {
  function setup(convene: () => Promise<unknown>) {
    const accepted = new Set(['C1:1.000001']);
    const slack = {
      postNotice: vi.fn(async () => success({ ts: '9.000001' })),
      deleteMessage: vi.fn(async () => success(undefined)),
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
      private_metadata: JSON.stringify(shortcut),
      state: { values: {} },
    }).run;
    return { run, slack, service, fetch };
  }

  it('opens a round from its own post when the selected message was accepted before', async () => {
    const { run, service, fetch } = setup(async () => ({}));
    await run?.();
    await expect(
      service.handleHumanMessage.mock.results[0]?.value,
    ).resolves.toBe('accepted');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('deletes its post and tells the user when convening fails', async () => {
    const { run, slack, fetch } = setup(async () => {
      throw new CliError('E_COUNCIL_EXISTS', 'exists');
    });
    await run?.();
    expect(slack.deleteMessage).toHaveBeenCalledWith('C1', '9.000001');
    expect(String(fetch.mock.calls[0]?.[1]?.body)).toContain(
      'This thread already has a council.',
    );
  });
});
