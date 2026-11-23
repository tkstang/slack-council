import { parseConfig } from '@council/config/load.js';
import type {
  ListenInput,
  Store,
  StoredState,
  TurnInput,
} from '@council/core/ports.js';
import { failure, success, type Result } from '@council/core/result.js';
import type { HumanMessage, Message, Scope } from '@council/core/types.js';
import { MAX_ACCEPTED_MESSAGES } from '@council/store/json-store.js';
import { expect, it, vi } from 'vitest';

import {
  openCouncilService,
  type CouncilServiceOptions,
  type HumanMessageInput,
} from './service.js';

const SCOPE: Scope = { channel: 'C1', threadTs: '1.000' };
const CONFIG = parseConfig(
  JSON.stringify({
    providers: {
      sample: { baseURL: 'https://models.example.com', apiKeyEnv: 'KEY' },
    },
    members: {
      guide: {
        name: 'Guide',
        avatar: { emoji: ':compass:' },
        model: 'example',
        provider: 'sample',
        persona: 'Guide the discussion.',
      },
      critic: {
        name: 'Critic',
        avatar: { emoji: ':mag:' },
        model: 'example',
        provider: 'sample',
        persona: 'Find gaps.',
      },
    },
    presets: { default: ['guide'] },
    defaultPreset: 'default',
    slack: { allowedUsers: ['U1'] },
    council: { rounds: 1 },
  }),
);
if (!CONFIG.ok) throw new Error(CONFIG.message);

function human(ts: string, text: string, userId = 'U1'): HumanMessageInput {
  const message: HumanMessage = {
    ts,
    text,
    author: { kind: 'human', userId, displayName: userId },
  };
  return { scope: SCOPE, message };
}

function fixtures(
  initial: StoredState = {
    councils: [],
    acceptedMessageKeys: [],
    privateNotes: [],
  },
) {
  let record = initial;
  let nextSave: Promise<Result<void>> | undefined;
  let nextId = 0;
  let result: Promise<Result<string>> = Promise.resolve(success('PASS'));
  let listenResult: Promise<Result<string>> = Promise.resolve(success('PASS'));
  const calls: TurnInput[] = [];
  const listens: ListenInput[] = [];
  const notices: string[] = [];
  let postTs = 8;
  const history: Message[] = [];
  const reactions: [string, boolean][] = [];
  const save: Store['save'] = async (state) => {
    const gate = nextSave;
    nextSave = undefined;
    const outcome = await gate;
    if (outcome && !outcome.ok) return outcome;
    record = structuredClone(state);
    return success(undefined);
  };
  const store = { load: async () => success(record), save: vi.fn(save) };

  return {
    calls,
    listens,
    notices,
    history,
    reactions,
    store,
    record: () => record,
    gateSave() {
      const gate = Promise.withResolvers<Result<void>>();
      nextSave = gate.promise;
      return gate.resolve;
    },
    gateListen() {
      const gate = Promise.withResolvers<Result<string>>();
      listenResult = gate.promise;
      return gate.resolve;
    },
    gateModel() {
      const gate = Promise.withResolvers<Result<string>>();
      result = gate.promise;
      return gate.resolve;
    },
    open(onSkippedCouncil?: CouncilServiceOptions['onSkippedCouncil']) {
      if (!CONFIG.ok) throw new Error(CONFIG.message);
      return openCouncilService(CONFIG.value, {
        appUserId: 'UAPP',
        onSkippedCouncil,
        store,
        ids: { next: () => `id-${++nextId}` },
        slack: {
          async fetchMessages(_scope, cutoff) {
            return success(
              history.filter(({ ts }) => cutoff === undefined || ts <= cutoff),
            );
          },
          async postMember(_scope, { member, text }) {
            const ts = `${++postTs}.000`;
            history.push({
              ts,
              text,
              author: { kind: 'member', memberId: member.id },
            });
            return success({ ts });
          },
          async postNotice(_scope, text) {
            notices.push(text);
            return success({ ts: `${notices.length}.000` });
          },
          async setReaction(_channel, ts, _reaction, present) {
            reactions.push([ts, present]);
            return success(undefined);
          },
        },
        turns: {
          runListen(input) {
            listens.push(input);
            return listenResult;
          },
          runTurn(input) {
            calls.push(input);
            return result;
          },
        },
      });
    },
  };
}

it('authorises convening and floor control while allowing other users’ messages into context', async () => {
  const f = fixtures();
  const service = await f.open();
  await expect(
    service.convene({ scope: SCOPE, owner: 'U2' }),
  ).rejects.toMatchObject({ code: 'E_FORBIDDEN' });
  await expect(
    service.convene({ scope: SCOPE, owner: 'U1', roster: ['unknown'] }),
  ).rejects.toMatchObject({ code: 'E_UNKNOWN_MEMBER' });
  await expect(
    service.convene({ scope: SCOPE, owner: 'U1', preset: 'unknown' }),
  ).rejects.toMatchObject({ code: 'E_UNKNOWN_PRESET' });
  const council = await service.convene({
    scope: SCOPE,
    owner: 'U1',
    roster: ['guide'],
  });
  expect(council).toMatchObject({
    scope: SCOPE,
    roster: ['guide'],
    owner: 'U1',
  });
  await expect(
    service.convene({ scope: SCOPE, owner: 'U1' }),
  ).rejects.toMatchObject({ code: 'E_COUNCIL_EXISTS' });

  const outsider = human('2.000', '@council A fact from an observer', 'U2');
  const operator = human('3.000', '@guide Explain the fact');
  f.history.push(outsider.message, operator.message);
  expect(await service.handleHumanMessage(outsider)).toBe('ignored');
  await expect(service.end(SCOPE, 'U2')).rejects.toMatchObject({
    code: 'E_FORBIDDEN',
  });
  expect(await service.handleHumanMessage(operator)).toBe('accepted');
  await vi.waitFor(() => expect(f.calls).toHaveLength(1), { interval: 1 });
  expect(f.calls[0]?.prompt.user).toContain('A fact from an observer');
  expect(f.record().acceptedMessageKeys).toEqual(['C1:3.000']);
  await service.shutdown();
});

it('deduplicates in-flight deliveries across scopes and retains accepted keys after restart', async () => {
  const f = fixtures();
  const service = await f.open();
  const message = {
    ...human('1.000', '<@UAPP> Open a council'),
    kickoff: true,
  };
  const release = f.gateSave();
  const first = service.handleHumanMessage(message);
  expect(
    await service.handleHumanMessage({ ...message, scope: { channel: 'C1' } }),
  ).toBe('duplicate');
  expect(service.getCouncil(SCOPE)).toBeUndefined();
  expect(f.calls).toHaveLength(0);

  release(success(undefined));
  expect(await first).toBe('accepted');
  expect(service.getCouncil(SCOPE)?.roster).toEqual(['guide']);
  await vi.waitFor(() => expect(f.calls).toHaveLength(1), { interval: 1 });
  await service.shutdown();

  const reopened = await f.open();
  expect(reopened.getCouncil(SCOPE)?.id).toBe(service.getCouncil(SCOPE)?.id);
  expect(await reopened.handleHumanMessage(message)).toBe('duplicate');
  await reopened.shutdown();
  expect(f.calls).toHaveLength(1);
});

it('permits a retry after a failed acceptance write without launching the original attempt', async () => {
  const f = fixtures();
  const service = await f.open();
  const input = { ...human('1.000', '@council Open a council'), kickoff: true };
  const release = f.gateSave();
  const first = service.handleHumanMessage(input);
  release(failure('E_STORE_WRITE', 'Disk full'));
  await expect(first).rejects.toMatchObject({ code: 'E_STORE_WRITE' });
  expect(f.record().acceptedMessageKeys).toEqual([]);
  expect(service.getCouncil(SCOPE)).toBeUndefined();
  expect(f.calls).toEqual([]);
  expect(await service.handleHumanMessage(input)).toBe('accepted');
  await vi.waitFor(() => expect(f.calls).toHaveLength(1), { interval: 1 });
  await service.shutdown();
});

it('bounds dedupe retention and serialises concurrent state writes', async () => {
  const keys = Array.from(
    { length: MAX_ACCEPTED_MESSAGES },
    (_, index) => `C1:${index}.000`,
  );
  const f = fixtures({
    councils: [],
    acceptedMessageKeys: keys,
    privateNotes: [],
  });
  const service = await f.open();
  const council = service.convene({ scope: SCOPE, owner: 'U1' });
  const other = service.convene({
    scope: { channel: 'C2', threadTs: '1.000' },
    owner: 'U1',
  });
  const latest = service.handleHumanMessage(human('10001.000', 'Context only'));
  expect(await latest).toBe('accepted');

  expect(f.record().councils).toEqual([await council, await other]);
  expect(f.record().acceptedMessageKeys).toHaveLength(MAX_ACCEPTED_MESSAGES);
  expect(f.record().acceptedMessageKeys[0]).toBe('C1:1.000');
  expect(f.record().acceptedMessageKeys.at(-1)).toBe('C1:10001.000');
  expect(f.calls).toEqual([]);
  await service.shutdown();
});

it('reports a council with a missing member and keeps it in the saved state', async () => {
  const retained = {
    id: 'retained',
    scope: SCOPE,
    owner: 'U1',
    roster: ['guide'],
    settings: CONFIG.value.council,
  };
  const stale = {
    ...retained,
    id: 'stale',
    scope: { channel: 'C2' },
    roster: ['guide', 'removed'],
  };
  const f = fixtures({
    councils: [stale, retained],
    acceptedMessageKeys: [],
    privateNotes: [],
  });
  const report = vi.fn();
  const service = await f.open(report);
  expect(report).toHaveBeenCalledExactlyOnceWith(stale, ['removed']);
  expect(service.getCouncil(stale.scope)).toBeUndefined();
  expect(service.getCouncil(SCOPE)).toEqual(retained);
  expect(f.record().councils).toEqual([stale, retained]);
  await service.handleHumanMessage(human('2.000', 'Context only'));
  expect(f.record().councils).toEqual([retained, stale]);
  expect(await service.end(stale.scope, 'U1')).toBe(true);
  expect(f.record().councils).toEqual([retained]);
  await service.shutdown();
});

it('stops the active turn even when saving the stop message fails', async () => {
  const f = fixtures();
  const service = await f.open();
  await service.convene({ scope: SCOPE, owner: 'U1' });
  const finish = f.gateModel();
  await service.handleHumanMessage(human('2.000', '@guide Explain'));
  await vi.waitFor(() => expect(f.calls).toHaveLength(1), { interval: 1 });

  const release = f.gateSave();
  const input = human('3.000', '@council stop');
  const stopping = service.handleHumanMessage(input);
  const abortedBeforeSave = f.calls[0]?.signal.aborted;
  release(failure('E_STORE_WRITE', 'Disk full'));
  await expect(stopping).rejects.toMatchObject({ code: 'E_STORE_WRITE' });
  expect(abortedBeforeSave).toBe(true);
  expect(f.record().acceptedMessageKeys).toEqual(['C1:2.000']);
  expect(await service.handleHumanMessage(input)).toBe('accepted');
  finish(success('Too late'));
  await service.shutdown();
});

it('persists end, aborts the old chain and prevents its kickoff message from reopening the scope', async () => {
  const f = fixtures();
  const service = await f.open();
  const opening = {
    ...human('1.000', '@council Open the floor'),
    kickoff: true,
  };
  const release = f.gateModel();
  expect(await service.handleHumanMessage(opening)).toBe('accepted');
  await vi.waitFor(() => expect(f.calls).toHaveLength(1), { interval: 1 });

  const saveEnd = f.gateSave();
  const ending = service.handleHumanMessage(human('2.000', '<@UAPP> end'));
  const abortedBeforeSave = f.calls[0]?.signal.aborted;
  saveEnd(success(undefined));
  expect(await ending).toBe('accepted');
  expect(abortedBeforeSave).toBe(true);
  expect(service.getCouncil(SCOPE)).toBeUndefined();
  expect(f.calls[0]?.signal.aborted).toBe(true);
  expect(f.record().councils).toEqual([]);
  expect(await service.end(SCOPE, 'U1')).toBe(false);
  release(success('Too late'));
  await service.shutdown();
  expect(f.reactions).toEqual([
    ['1.000', true],
    ['1.000', false],
  ]);

  const reopened = await f.open();
  expect(await reopened.handleHumanMessage(opening)).toBe('duplicate');
  await reopened.shutdown();
});

it('stops accepting work on shutdown, drains reactions and preserves the council for restart', async () => {
  const f = fixtures();
  const service = await f.open();
  await service.convene({ scope: SCOPE, owner: 'U1' });
  const release = f.gateModel();
  await service.handleHumanMessage(human('2.000', '@guide Explain'));
  await vi.waitFor(() => expect(f.calls).toHaveLength(1), { interval: 1 });

  const shutdown = service.shutdown();
  await expect(
    service.handleHumanMessage(human('3.000', '@council Restart')),
  ).rejects.toMatchObject({ code: 'E_SERVICE_CLOSED' });
  await shutdown;
  release(success('Too late'));
  expect(f.calls[0]?.signal.aborted).toBe(true);
  expect(f.reactions).toEqual([
    ['2.000', true],
    ['2.000', false],
  ]);
  expect(f.record().councils).toHaveLength(1);
});

async function startListening(f: ReturnType<typeof fixtures>) {
  const service = await f.open();
  await service.convene({
    scope: SCOPE,
    owner: 'U1',
    roster: ['guide', 'critic'],
  });
  const input = human('1.000', '@guide Address the evidence.');
  f.history.push(input.message);
  const finishTurn = f.gateModel();
  const finishListen = f.gateListen();
  await service.handleHumanMessage(input);
  await vi.waitFor(() => expect(f.calls).toHaveLength(1), { interval: 1 });
  finishTurn(success('Public answer.'));
  await vi.waitFor(() => expect(f.listens).toHaveLength(1), { interval: 1 });
  expect(f.listens[0]?.member.id).toBe('critic');
  return { service, finishListen };
}

it.each(['pass', 'post'])(
  'carries a saved hand across restart and consumes it after a %s',
  async (outcome) => {
    const f = fixtures();
    const { service, finishListen } = await startListening(f);
    const note = 'Check whether <the assumption> transfers.';
    finishListen(success(`HAND #2: ${note}`));
    await vi.waitFor(() => expect(f.notices).toHaveLength(1), { interval: 1 });
    expect(f.record().privateNotes).toEqual([
      {
        councilId: 'id-1',
        memberId: 'critic',
        targetTs: '9.000',
        note,
        createdAtTs: '9.000',
      },
    ]);
    await service.shutdown();

    const reopened = await f.open();
    const input = human('9.001', '@critic Follow up.');
    f.history.push(input.message);
    const finishTurn = f.gateModel();
    const finishNextListen = f.gateListen();
    await reopened.handleHumanMessage(input);
    await vi.waitFor(() => expect(f.calls).toHaveLength(2), { interval: 1 });
    expect(f.calls[1]?.prompt.user).toContain(
      `<private_notes>
- [#2] Check whether &lt;the assumption&gt; transfers.
</private_notes>`,
    );
    expect(f.record().privateNotes).toHaveLength(1);
    finishTurn(
      success(outcome === 'pass' ? 'PASS' : `I need more evidence. ${note}`),
    );
    await vi.waitFor(() => expect(f.record().privateNotes).toEqual([]), {
      interval: 1,
    });
    if (outcome === 'post')
      expect(f.history.at(-1)?.text).toContain('I need more evidence.');
    expect(f.history.some(({ text }) => text.includes(note))).toBe(false);
    expect(f.notices.some((text) => text.includes(note))).toBe(false);
    finishNextListen(success('PASS'));
    await reopened.shutdown();
  },
);

it('aborts an in-flight listen at addressed arrival even while acceptance save is blocked', async () => {
  const f = fixtures();
  const { service, finishListen } = await startListening(f);

  const input = human('9.001', '@critic New human question.');
  f.history.push(input.message);
  const finishSave = f.gateSave();
  const finishTurn = f.gateModel();
  const acceptance = service.handleHumanMessage(input);
  expect(f.listens[0]?.signal.aborted).toBe(true);
  finishListen(success('HAND #2: The late note must be discarded.'));
  finishSave(success(undefined));
  await expect(acceptance).resolves.toBe('accepted');
  await vi.waitFor(() => expect(f.calls).toHaveLength(2), { interval: 1 });
  expect(f.calls[1]?.prompt.user).not.toContain('<private_notes>');
  finishTurn(success('PASS'));
  await vi.waitFor(() => expect(f.reactions.at(-1)).toEqual(['9.001', false]), {
    interval: 1,
  });
  await service.shutdown();
  expect(f.record().privateNotes).toEqual([]);
  expect(f.notices).toEqual([]);
});
