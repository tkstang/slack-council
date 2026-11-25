import type { ChartInput } from '@council/core/chart.js';
import type {
  Clock,
  ListenInput,
  SlackPort,
  TurnInput,
} from '@council/core/ports.js';
import { failure, success, type Result } from '@council/core/result.js';
import type {
  Council,
  Member,
  Message,
  PrivateNote,
} from '@council/core/types.js';
import { expect, it, vi } from 'vitest';

import { createChainRunner } from './chain-runner.js';

const GUIDE: Member = {
  id: 'guide',
  name: 'Guide',
  avatar: { emoji: ':compass:' },
  provider: 'sample',
  model: 'example',
  tools: [],
};
const CRITIC: Member = { ...GUIDE, id: 'critic', name: 'Critic' };
const COUNCIL: Council = {
  id: 'council-1',
  owner: 'U1',
  scope: { channel: 'C1', threadTs: '1.000' },
  roster: ['guide', 'critic'],
  settings: {
    rounds: 2,
    hopBudget: 2,
    maxTurnsPerChain: 10,
    unaddressed: 'silent',
    seenReaction: 'threads',
    listen: 'off',
    memberMentions: 'none',
    contextChars: 2_000,
    replyWords: { default: 120, detailed: 250, max: 1_000 },
    turnTimeoutMs: 500,
    approvalTimeoutMs: 300_000,
    maxSteps: 4,
  },
};

function harness(
  settings: Partial<Council['settings']> = {},
  roster = [GUIDE, CRITIC],
) {
  const calls: {
    input: TurnInput;
    finish: (result: Result<string>) => void;
  }[] = [];
  const listens: {
    input: ListenInput;
    finish: (result: Result<string>) => void;
  }[] = [];
  const handReactions: string[] = [];
  let privateNotes: readonly PrivateNote[] = [];
  const reactions: [string, string, boolean][] = [];
  const writes: string[] = [];
  const notices: string[] = [];
  const history: Message[] = [
    {
      ts: '1.000',
      author: { kind: 'human', userId: 'U1', displayName: 'Reader' },
      text: '@council Initial question',
    },
  ];
  const cutoffs: (string | undefined)[] = [];
  const timers = new Map<() => void, number>();
  let writeGate: Promise<Result<void>> | undefined;
  let postNumber = 3;
  let monotonicMs = 0;

  const slack: SlackPort = {
    async fetchMessages(_scope, cutoff) {
      cutoffs.push(cutoff);
      return success(
        history.filter(({ ts }) => cutoff === undefined || ts <= cutoff),
      );
    },
    postMember: vi.fn<SlackPort['postMember']>(
      async (_scope, { text, member }) => {
        writes.push(text);
        const result = await writeGate;
        if (result && !result.ok) return result;
        const ts = `${postNumber++}.000`;
        history.push({
          ts,
          text,
          author: { kind: 'member', memberId: member.id },
        });
        return success({ ts });
      },
    ),
    async postNotice(_scope, text) {
      notices.push(text);
      const ts = `${postNumber++}.000`;
      history.push({ ts, text, author: { kind: 'notice' } });
      return success({ ts });
    },
    async setReaction(channel, ts, reaction, present) {
      if (reaction === 'raised_hand' && present) handReactions.push(ts);
      else {
        expect(reaction).toBe('hourglass_flowing_sand');
        reactions.push([channel, ts, present]);
      }
      return success(undefined);
    },
  };

  const clock: Clock = {
    now: () => monotonicMs,
    setTimeout(callback, ms) {
      timers.set(callback, ms);
      return () => timers.delete(callback);
    },
  };

  const runner = createChainRunner(
    {
      ...COUNCIL,
      roster: roster.map(({ id }) => id),
      settings: { ...COUNCIL.settings, ...settings },
    },
    roster,
    {
      slack,
      clock,
      notes: {
        read: () => privateNotes,
        async update(change, signal) {
          if (signal?.aborted) return false;
          privateNotes = change(privateNotes);
          return true;
        },
      },
      turns: {
        runListen(input) {
          const task = Promise.withResolvers<Result<string>>();
          listens.push({ input, finish: task.resolve });
          return task.promise;
        },
        runTurn(input) {
          const task = Promise.withResolvers<Result<string>>();
          calls.push({ input, finish: task.resolve });
          return task.promise;
        },
      },
    },
  );

  function call(index: number) {
    const started = calls[index];
    if (!started) throw new Error(`Turn ${index} has not started`);
    return started;
  }

  return {
    ...runner,
    calls,
    call,
    listens,
    handReactions,
    privateNotes: () => privateNotes,
    history,
    cutoffs,
    notices,
    reactions,
    writes,
    postMember: slack.postMember,
    timers,
    elapse(ms: number) {
      monotonicMs += ms;
    },
    open() {
      runner.dispatch({
        type: 'human',
        chainId: 'first',
        ts: '1.000',
        address: { kind: 'council' },
      });
    },
    gateWrite() {
      const task = Promise.withResolvers<Result<void>>();
      writeGate = task.promise;
      return task.resolve;
    },
    async waitForCalls(count: number) {
      await vi.waitFor(() => expect(calls).toHaveLength(count), {
        interval: 1,
      });
    },
  };
}

it('uses one frozen round-one snapshot and waits for writes before reading fresh react context', async () => {
  const h = harness();
  h.history.push({
    ts: '2.000',
    author: { kind: 'notice' },
    text: 'Later context',
  });
  h.open();
  await h.waitForCalls(2);

  expect(h.cutoffs).toEqual(['1.000']);
  expect(h.reactions).toEqual([['C1', '1.000', true]]);
  for (const { input } of h.calls) {
    expect(input.prompt.user).toContain('Initial question');
    expect(input.prompt.user).not.toContain('Later context');
    expect(input).toMatchObject({
      chainId: 'first',
      councilId: COUNCIL.id,
      maxSteps: 4,
    });
  }
  expect(h.call(0).input.turnId).not.toBe(h.call(1).input.turnId);
  const release = h.gateWrite();
  h.call(0).finish(success('Opening from Guide'));
  h.call(1).finish(success('Opening from Critic'));
  await vi.waitFor(() => expect(h.writes).toHaveLength(2), { interval: 1 });
  expect(h.calls).toHaveLength(2);
  expect(h.reactions).toHaveLength(1);

  release(success(undefined));
  await h.waitForCalls(3);
  expect(h.call(2).input.member.id).toBe('guide');
  expect(h.call(2).input.prompt.user).toContain('Opening from Critic');
  expect(h.call(2).input.prompt.user).toContain('Later context');
  h.call(2).finish(success('**PASS**'));
  await h.waitForCalls(4);
  h.call(3).finish(success('Pass.'));
  await h.drain();
  expect(h.cutoffs).toEqual(['1.000', undefined, undefined]);
  expect(h.writes).toEqual(['Opening from Guide', 'Opening from Critic']);
  expect(h.reactions).toEqual([
    ['C1', '1.000', true],
    ['C1', '1.000', false],
  ]);
  expect(h.timers.size).toBe(0);
});

it('lets superseded turns post and freezes the new chain at its trigger while discarding old mentions', async () => {
  const h = harness();
  h.open();
  await h.waitForCalls(2);
  h.history.push({
    ts: '2.000',
    author: { kind: 'human', userId: 'U1', displayName: 'Reader' },
    text: '@guide New question',
  });
  h.dispatch({
    type: 'human',
    chainId: 'second',
    ts: '2.000',
    address: { kind: 'members', handles: ['guide'] },
  });

  const release = h.gateWrite();
  h.call(0).finish(success('Late answer for @critic'));
  h.call(1).finish(success('PASS'));
  await vi.waitFor(
    () => expect(h.writes).toEqual(['Late answer for @critic']),
    { interval: 1 },
  );
  expect(h.calls).toHaveLength(2);
  expect(h.call(0).input.signal.aborted).toBe(false);

  release(success(undefined));
  await h.waitForCalls(3);
  expect(h.call(2).input).toMatchObject({
    chainId: 'second',
    member: { id: 'guide' },
  });
  expect(h.call(2).input.prompt.user).toContain('New question');
  expect(h.call(2).input.prompt.user).not.toContain('Late answer');
  h.call(2).finish(success('New answer'));
  await h.drain();
  expect(h.calls).toHaveLength(3);
  expect(h.reactions).toEqual([
    ['C1', '1.000', true],
    ['C1', '2.000', true],
    ['C1', '1.000', false],
    ['C1', '2.000', false],
  ]);
});

it('aborts running turns on stop, reports cancellation and ignores late model responses', async () => {
  const h = harness();
  h.open();
  await h.waitForCalls(2);
  h.dispatch({ type: 'stop' });
  await h.drain();
  expect(h.calls.map(({ input }) => input.signal.aborted)).toEqual([
    true,
    true,
  ]);
  expect(h.notices).toEqual([
    'Guide’s turn was cancelled.',
    'Critic’s turn was cancelled.',
  ]);
  h.call(0).finish(success('Too late'));
  h.call(1).finish(success('@guide Too late'));
  expect(h.writes).toEqual([]);
  expect(h.reactions.at(-1)).toEqual(['C1', '1.000', false]);
});

it('reports a coded turn failure, keeps other turns running and never reruns the turn', async () => {
  const h = harness({ rounds: 1 });
  h.open();
  await h.waitForCalls(2);
  h.call(0).finish(failure('E_TURN_FAILED', 'Provider information'));
  h.call(1).finish(success('Useful answer'));
  await h.drain();
  expect(h.notices).toEqual(['Guide’s turn failed (`E_TURN_FAILED`).']);
  expect(h.writes).toEqual(['Useful answer']);
  expect(h.calls).toHaveLength(2);
});

it.each([success('PASS'), failure('E_TURN_FAILED', 'Model failed')])(
  'keeps a chart with its own reply when another turn does not post (%j)',
  async (outcome) => {
    const guide = { ...GUIDE, tools: ['show_chart'] };
    const critic = { ...CRITIC, tools: ['show_chart'] };
    const h = harness({ rounds: 1 }, [guide, critic]);
    h.open();
    await h.waitForCalls(2);
    const chart: ChartInput = {
      title: 'Work split',
      chart: { type: 'pie', segments: [{ label: 'Support', value: 12 }] },
    };
    h.call(0).input.charts?.push({ ...chart, title: 'Discarded' });
    h.call(1).input.charts?.push(chart);
    h.call(0).finish(outcome);
    h.call(1).finish(success('Useful answer'));
    await h.drain();
    expect(h.postMember).toHaveBeenCalledExactlyOnceWith(
      COUNCIL.scope,
      expect.objectContaining({
        member: critic,
        text: 'Useful answer',
        charts: [chart],
      }),
    );
  },
);

it('times out an unresponsive turn even when the provider has not returned and drains cleanly', async () => {
  const h = harness({ rounds: 1 });
  h.dispatch({
    type: 'human',
    chainId: 'first',
    ts: '1.000',
    address: { kind: 'members', handles: ['guide'] },
  });
  await h.waitForCalls(1);
  expect([...h.timers.values()]).toEqual([500]);
  h.timers.keys().next().value?.();
  await h.drain();
  expect(h.call(0).input.signal.aborted).toBe(true);
  expect(h.notices).toEqual(['Guide’s turn timed out.']);
  expect(h.reactions.at(-1)).toEqual(['C1', '1.000', false]);
  expect(h.timers.size).toBe(0);
});

it('settles a hung Slack post with a notice and ignores its late completion', async () => {
  const h = harness({ rounds: 1, listen: 'settle' });
  const release = h.gateWrite();
  h.dispatch({
    type: 'human',
    chainId: 'first',
    ts: '1.000',
    address: { kind: 'members', handles: ['guide'] },
  });
  await h.waitForCalls(1);
  h.call(0).finish(success('For @critic'));
  await vi.waitFor(() => expect(h.writes).toEqual(['For @critic']), {
    interval: 1,
  });
  expect([...h.timers.values()]).toEqual([500]);
  h.timers.keys().next().value?.();
  await h.drain();
  expect(h.notices).toEqual(['Guide’s turn failed (`E_SLACK`).']);
  expect(h.reactions.at(-1)).toEqual(['C1', '1.000', false]);
  expect(h.listens).toEqual([]);

  release(success(undefined));
  await vi.waitFor(() => expect(h.history.at(-1)?.text).toBe('For @critic'), {
    interval: 1,
  });
  await h.drain();
  expect(h.calls).toHaveLength(1);
});

it('pauses the turn budget during approval and resumes with its remaining time', async () => {
  const h = harness({ rounds: 1 });
  h.dispatch({
    type: 'human',
    chainId: 'first',
    ts: '1.000',
    address: { kind: 'members', handles: ['guide'] },
  });
  await h.waitForCalls(1);
  const { approval, signal } = h.call(0).input;
  if (!approval) throw new Error('Missing approval context');
  h.elapse(120);
  const resume = approval.suspendTimeout();
  expect(h.timers.size).toBe(0);
  h.elapse(10_000);
  expect(signal.aborted).toBe(false);
  resume();
  expect([...h.timers.values()]).toEqual([380]);
  h.timers.keys().next().value?.();
  await h.drain();
  expect(signal.reason).toBe('E_TURN_TIMEOUT');
});

it.each([
  {
    scenario: 'unseen posts and spoke last',
    listen: 'settle',
    answer: 'Answer',
    stop: false,
    expected: ['guide'],
  },
  {
    scenario: 'both saw everything',
    listen: 'settle',
    answer: 'PASS',
    stop: false,
    expected: [],
  },
  {
    scenario: 'listen off',
    listen: 'off',
    answer: 'Answer',
    stop: false,
    expected: [],
  },
  {
    scenario: 'stopped before settle',
    listen: 'settle',
    answer: 'Answer',
    stop: true,
    expected: [],
  },
] as const)(
  'chooses listeners at settle for $scenario',
  async ({ listen, answer, stop, expected }) => {
    const h = harness({ listen, rounds: 1 });
    h.open();
    await h.waitForCalls(2);
    h.call(0).finish(success('PASS'));
    h.call(1).finish(success(answer));
    if (stop) h.dispatch({ type: 'stop' });
    if (expected.length > 0) {
      await vi.waitFor(() => expect(h.listens).toHaveLength(1), {
        interval: 1,
      });
      expect(h.reactions.at(-1)).toEqual(['C1', '1.000', false]);
      h.listens[0]?.finish(success('PASS'));
    }
    await h.drain();
    expect(h.listens.map(({ input }) => input.member.id)).toEqual(expected);
    expect(h.notices.some((note) => note.startsWith('✋'))).toBe(false);
  },
);

// The trigger is an app notice when a round is opened from the roster picker.
it.each([
  [{ kind: 'human', userId: 'U1', displayName: 'Reader' }, 2],
  [{ kind: 'notice' }, 1],
] as const)(
  'asks the last parallel poster to listen to the other member’s unseen answer after a %o trigger',
  async (author, firstRow) => {
    const h = harness({ listen: 'settle' });
    h.history[0] = { ts: '1.000', author, text: '@guide @critic Explain.' };
    h.dispatch({
      type: 'human',
      chainId: 'parallel',
      ts: '1.000',
      address: { kind: 'members', handles: ['guide', 'critic'] },
    });
    await h.waitForCalls(2);
    h.call(0).finish(success('Guide’s answer.'));
    await vi.waitFor(() => expect(h.history).toHaveLength(2), { interval: 1 });
    h.call(1).finish(success('Critic’s answer.'));

    await vi.waitFor(() => expect(h.listens).toHaveLength(2), { interval: 1 });
    const critic = h.listens.find(({ input }) => input.member.id === 'critic');
    expect(critic?.input.prompt.user).toContain(
      `[#${firstRow}] [new] Guide (member): Guide’s answer.\n[#${firstRow + 1}] You (Critic): Critic’s answer.`,
    );
    for (const listen of h.listens) listen.finish(success('PASS'));
    await h.drain();
  },
);

it('never asks a member who has not spoken to listen to posts from before the chain', async () => {
  const h = harness({ listen: 'settle' });
  const reader = {
    kind: 'human',
    userId: 'U1',
    displayName: 'Reader',
  } as const;
  h.history[0] = { ts: '0.500', author: reader, text: 'Old chatter.' };
  h.history.push({ ts: '1.000', author: reader, text: '@guide Explain.' });
  h.dispatch({
    type: 'human',
    chainId: 'solo',
    ts: '1.000',
    address: { kind: 'members', handles: ['guide'] },
  });
  await h.waitForCalls(1);
  h.call(0).finish(success('Guide’s answer.'));

  await vi.waitFor(() => expect(h.listens).toHaveLength(1), { interval: 1 });
  expect(h.listens[0]?.input.prompt.user).toContain(
    '[#1] Reader (human): Old chatter.\n[#2] [new] Reader (human): @guide Explain.',
  );
  h.listens[0]?.finish(success('PASS'));
  await h.drain();
});

const OBSERVER: Member = { ...GUIDE, id: 'observer', name: 'Observer' };

it.each([
  { second: 3, reacted: ['3.000'] },
  { second: 2, reacted: ['3.000', '2.000'] },
])(
  'posts one notice and reacts once per target when the second hand points to #$second',
  async ({ second, reacted }) => {
    const h = harness({ listen: 'settle', rounds: 1 }, [
      GUIDE,
      CRITIC,
      OBSERVER,
    ]);
    h.history.push({
      ts: '2.000',
      author: { kind: 'otherBot', displayName: 'Helper' },
      text: 'Source data',
    });
    h.open();
    await h.waitForCalls(3);
    h.call(0).finish(success('PASS'));
    h.call(1).finish(success('PASS'));
    h.call(2).finish(success('Answer'));
    await vi.waitFor(() => expect(h.listens).toHaveLength(3), { interval: 1 });
    expect(h.cutoffs).toEqual(['1.000', undefined]);
    expect(h.listens[0]?.input.prompt.user).toContain(
      '[#3] [new] Observer (member): Answer',
    );
    expect(h.listens[1]?.input.prompt.user).toContain(
      '[#2] [new] Helper (bot): Source data',
    );
    expect(h.listens[2]?.input.member.id).toBe('observer');
    expect(h.listens[2]?.input.prompt.user).toContain(
      '[#2] [new] Helper (bot): Source data\n[#3] You (Observer): Answer',
    );
    h.listens[0]?.finish(success('HAND #99: Outside the snapshot.'));
    h.listens[1]?.finish(success(`HAND #${second}: Check the scope.`));
    h.listens[2]?.finish(success('PASS'));
    await vi.waitFor(() => expect(h.listens).toHaveLength(4), { interval: 1 });
    expect(h.listens[3]?.input.prompt).toEqual(h.listens[0]?.input.prompt);
    h.listens[3]?.finish(success('HAND [#3]: The assumption needs evidence.'));
    await h.drain();
    expect(h.notices).toEqual([
      '✋ Guide and Critic have something to add. Mention them to hear it.',
    ]);
    expect(h.handReactions).toEqual(reacted);
    expect(
      h.privateNotes().map(({ memberId, targetTs }) => [memberId, targetTs]),
    ).toEqual([
      ['guide', '3.000'],
      ['critic', second === 3 ? '3.000' : '2.000'],
    ]);

    // A notice is in history but has neither started a chain nor made an old
    // batch eligible again when the observer passes on the next grant.
    h.dispatch({
      type: 'human',
      chainId: 'check-notice',
      ts: '4.000',
      address: { kind: 'members', handles: ['observer'] },
    });
    await h.waitForCalls(4);
    expect(h.call(3).input.prompt.user).toContain('Guide and Critic');
    expect(h.call(3).input.prompt.user).not.toContain('<private_notes>');
    h.call(3).finish(success('PASS'));
    await h.drain();
    expect(h.listens).toHaveLength(4);
    expect(h.notices).toHaveLength(1);
  },
);

it.each(['malformed', 'model failure', 'timeout'])(
  'passes silently on a listen %s',
  async (scenario) => {
    const h = harness({ listen: 'settle', rounds: 1, turnTimeoutMs: 60_000 });
    h.open();
    await h.waitForCalls(2);
    h.call(0).finish(success('PASS'));
    h.call(1).finish(success('Answer'));
    await vi.waitFor(() => expect(h.listens).toHaveLength(1), { interval: 1 });
    expect([...h.timers.values()]).toEqual([10_000]);
    if (scenario === 'timeout') h.timers.keys().next().value?.();
    else if (scenario === 'model failure')
      h.listens[0]?.finish(failure('E_TURN_FAILED', 'Provider information'));
    else {
      h.listens[0]?.finish(success('Not the protocol'));
      await vi.waitFor(() => expect(h.listens).toHaveLength(2), {
        interval: 1,
      });
      h.listens[1]?.finish(success('HAND #0: Still invalid.'));
    }
    await h.drain();
    expect(h.notices).toEqual([]);
    expect(h.privateNotes()).toEqual([]);
    expect(h.listens).toHaveLength(scenario === 'malformed' ? 2 : 1);
  },
);
