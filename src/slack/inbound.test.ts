import type { Council, Scope } from '@council/core/types.js';
import { describe, expect, it, vi } from 'vitest';

import {
  createInboundHandler,
  prefilterSlackEvent,
  selectScope,
} from './inbound.js';

const base = { type: 'message', channel: 'C1', ts: '2.000000', user: 'U1' };

describe('prefilterSlackEvent', () => {
  it.each([
    ['plain human message', base, true],
    ['file share', { ...base, subtype: 'file_share' }, true],
    [
      'thread reply also sent to the channel',
      { ...base, subtype: 'thread_broadcast', thread_ts: '1.000000' },
      true,
    ],
    ['post carrying a bot profile', { ...base, bot_profile: {} }, false],
    ['app mention', { ...base, type: 'app_mention', text: '<@UAPP> hi' }, true],
    [
      'own custom-identity post',
      { ...base, subtype: 'bot_message', bot_id: 'BAPP' },
      false,
    ],
    [
      'own panel notice without subtype',
      {
        ...base,
        bot_id: 'BAPP',
        text: 'Preset: review\n- `@guide` · Guide · example',
      },
      false,
    ],
    ['another bot', { ...base, bot_id: 'BOTHER' }, false],
    ['edit', { ...base, subtype: 'message_changed' }, false],
    ['delete', { ...base, subtype: 'message_deleted' }, false],
    ['join', { ...base, subtype: 'channel_join' }, false],
    ['no user', { type: 'message', channel: 'C1', ts: '2.000000' }, false],
    ['other event type', { ...base, type: 'reaction_added' }, false],
  ])('%s', (_, event, kept) => {
    expect(prefilterSlackEvent(event) !== undefined).toBe(kept);
  });

  it('keeps the raw text and the thread parent', () => {
    expect(
      prefilterSlackEvent({
        ...base,
        thread_ts: '1.000000',
        text: '<@UAPP> go',
      }),
    ).toEqual({
      channel: 'C1',
      ts: '2.000000',
      threadTs: '1.000000',
      userId: 'U1',
      text: '<@UAPP> go',
    });
  });
});

describe('selectScope', () => {
  const council = { id: 'c' } as Council;
  const has =
    (...scopes: Scope[]) =>
    (scope: Scope) =>
      scopes.some(
        (s) => s.channel === scope.channel && s.threadTs === scope.threadTs,
      )
        ? council
        : undefined;
  const top = { channel: 'C1', ts: '2.0', userId: 'U1', text: '' };
  const reply = { ...top, threadTs: '1.0' };

  it.each([
    [
      'reply in a council thread',
      reply,
      has({ channel: 'C1', threadTs: '1.0' }),
      { channel: 'C1', threadTs: '1.0' },
      false,
    ],
    [
      'reply in a plain thread',
      reply,
      has(),
      { channel: 'C1', threadTs: '1.0' },
      true,
    ],
    [
      'top-level in a council channel',
      top,
      has({ channel: 'C1' }),
      { channel: 'C1' },
      false,
    ],
    [
      'reply in a plain thread of a council channel',
      reply,
      has({ channel: 'C1' }),
      { channel: 'C1', threadTs: '1.0' },
      true,
    ],
    [
      'top-level elsewhere opens its own thread',
      top,
      has(),
      { channel: 'C1', threadTs: '2.0' },
      true,
    ],
  ])('%s', (_, message, getCouncil, scope, kickoff) => {
    expect(selectScope(message, getCouncil)).toEqual({ scope, kickoff });
  });
});

describe('createInboundHandler', () => {
  it.each([
    ['ends a dormant channel council', '<@UAPP> end', { channel: 'C1' }, false],
    [
      'opens a thread beside a dormant channel council',
      '<@UAPP> go',
      { channel: 'C1', threadTs: '2.0' },
      true,
    ],
  ])('a top-level message %s', async (_, text, scope, kickoff) => {
    const handleHumanMessage = vi.fn(async () => 'accepted' as const);
    const handle = createInboundHandler({
      service: {
        getCouncil: () => undefined,
        isDormant: (s) => s.channel === 'C1' && s.threadTs === undefined,
        handleHumanMessage,
      },
      appUserId: 'UAPP',
      log: () => {},
    });
    await handle({ ...base, ts: '2.0', text });
    expect(handleHumanMessage).toHaveBeenCalledWith(
      expect.objectContaining({ scope, kickoff }),
    );
  });
});
