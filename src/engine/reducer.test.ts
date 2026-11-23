import { describe, expect, it } from 'vitest';

import type { FloorAddress } from './addressing.js';
import {
  createEngineState,
  reduce,
  type EngineEffect,
  type EngineEvent,
  type EngineState,
  type Grant,
  type TurnOutcome,
} from './reducer.js';

const ROSTER = ['a', 'b', 'c'];
const DEFAULTS = {
  rounds: 3,
  hopBudget: 6,
  maxTurnsPerChain: 24,
  unaddressed: 'silent',
} as const;
const PASS = { kind: 'pass' } as const;
type Started = Extract<EngineEffect, { type: 'run-turn' }>;

function human(
  chainId: string,
  address: FloorAddress = { kind: 'council' },
): EngineEvent {
  return { type: 'human', chainId, ts: `ts-${chainId}`, address };
}

function post(text: string): TurnOutcome {
  return { kind: 'posted', text, ts: 'ts-post' };
}

function scenario(settings: Partial<EngineState['settings']> = {}) {
  let state = createEngineState(ROSTER, { ...DEFAULTS, ...settings });
  function send(event: EngineEvent) {
    const next = reduce(state, event);
    state = next.state;
    return next.effects;
  }
  function finish(grant: Grant | undefined, outcome: TurnOutcome = PASS) {
    if (!grant) throw new Error('Expected a started turn');
    const { chainId, turnId } = grant;
    return send({ type: 'turn-finished', chainId, turnId, outcome });
  }
  function start(address?: FloorAddress) {
    return started(send(human('one', address)));
  }
  return { send, finish, start, state: () => state };
}

function started(effects: readonly EngineEffect[]): Started[] {
  return effects.filter((effect) => effect.type === 'run-turn');
}

function members(effects: readonly EngineEffect[]): string[] {
  return started(effects).map((effect) => effect.memberId);
}

function reactRound(s: ReturnType<typeof scenario>) {
  const [a, b, c] = s.start();
  s.finish(a);
  s.finish(b);
  return started(s.finish(c))[0];
}

describe('human grants and rounds', () => {
  it('makes unaddressed input silent unless configured to open the council', () => {
    expect(scenario().start({ kind: 'unaddressed' })).toEqual([]);
    expect(
      scenario({ unaddressed: 'council' })
        .start({ kind: 'unaddressed' })
        .map((t) => t.memberId),
    ).toEqual(ROSTER);
  });

  it('starts a direct mention batch with a shared cutoff and no react rounds', () => {
    const s = scenario();
    const [a, c] = s.start({ kind: 'members', handles: ['c', 'a', 'a'] });
    expect([a, c]).toMatchObject([
      { memberId: 'a', kind: 'mention', throughTs: 'ts-one' },
      { memberId: 'c', kind: 'mention', throughTs: 'ts-one' },
    ]);
    expect(s.finish(c)).toEqual([]);
    expect(s.finish(a)).toMatchObject([{ type: 'progress', present: false }]);
  });

  it('waits for every round-one turn, then gives sequential react grants in roster order', () => {
    const s = scenario();
    const round = s.start();
    expect(
      round.map(({ kind, throughTs, memberId }) => [kind, throughTs, memberId]),
    ).toEqual(ROSTER.map((id) => ['round', 'ts-one', id]));
    expect(s.finish(round[1], post('reply'))).toEqual([]);
    expect(s.finish(round[2])).toEqual([]);
    const [a] = started(s.finish(round[0]));
    expect(a).toMatchObject({ memberId: 'a', round: 2, kind: 'react' });
    expect(a?.throughTs).toBeUndefined();
    const [b] = started(s.finish(a));
    expect(b).toMatchObject({ memberId: 'b', round: 2 });
    expect(members(s.finish(b))).toEqual(['c']);
  });

  it('settles after an all-pass react round or the configured number of rounds', () => {
    const passing = scenario();
    const a = reactRound(passing);
    const [b] = started(passing.finish(a));
    const [c] = started(passing.finish(b));
    expect(passing.finish(c)).toMatchObject([
      { type: 'progress', present: false },
    ]);

    const speaking = scenario({ rounds: 2 });
    const first = reactRound(speaking);
    const [second] = started(speaking.finish(first, post('A response')));
    const [last] = started(speaking.finish(second));
    expect(speaking.finish(last)).toMatchObject([
      { type: 'progress', present: false },
    ]);
  });

  it('continues to the next react round after a response or a failure', () => {
    const s = scenario();
    const a = reactRound(s);
    const [b] = started(s.finish(a, { kind: 'failed', code: 'E_TURN_FAILED' }));
    const [c] = started(s.finish(b));
    expect(started(s.finish(c))).toMatchObject([{ memberId: 'a', round: 3 }]);
  });
});

describe('member mentions and budgets', () => {
  it('prioritises a mention and upgrades that target’s pending react grant in place', () => {
    const s = scenario();
    const a = reactRound(s);
    const effects = s.finish(a, post('@c'));
    expect(started(effects)).toMatchObject([
      { memberId: 'c', kind: 'mention', sourceTs: 'ts-post', turnId: 'one/6' },
    ]);
    expect(s.state().active).toMatchObject({ admitted: 6, hops: 1 });
    expect(members(s.finish(started(effects)[0]))).toEqual(['b']);
  });

  it('keeps the queued react turn without a limit notice when no hops remain', () => {
    const s = scenario({ hopBudget: 0 });
    const a = reactRound(s);
    expect(s.finish(a, post('@b'))).toMatchObject([
      { type: 'run-turn', memberId: 'b', kind: 'react' },
    ]);
  });

  it('reserves one follow-up for a running target and ignores duplicate queued grants', () => {
    const s = scenario({ rounds: 1 });
    const [a, b, c] = s.start();
    expect(s.finish(a, post('@b @b'))).toEqual([]);
    expect(s.finish(c, post('@b'))).toEqual([]);
    expect(s.state().active).toMatchObject({ admitted: 4, hops: 1 });
    const followUp = started(s.finish(b))[0];
    expect(followUp).toMatchObject({ memberId: 'b', kind: 'mention' });
    expect(s.finish(followUp)).toMatchObject([
      { type: 'progress', present: false },
    ]);
  });

  it('continues member-to-member mentions in a direct human mention chain', () => {
    const s = scenario();
    const [a] = s.start({ kind: 'members', handles: ['a'] });
    const [b] = started(s.finish(a, post('@a @b @council @unknown')));
    expect(b).toMatchObject({
      memberId: 'b',
      kind: 'mention',
    });
    expect(b?.throughTs).toBeUndefined();
    expect(s.finish(b, post('@b @unknown @council'))).toMatchObject([
      { type: 'progress', present: false },
    ]);
  });

  it('reserves the last hop at admission and posts only one limit notice', () => {
    const s = scenario({ hopBudget: 1, rounds: 1 });
    const [a, b, c] = s.start();
    expect(s.finish(a, post('@b @c'))).toMatchObject([
      { type: 'limit-notice', turnId: a?.turnId },
    ]);
    expect(s.finish(b, post('@a'))).toEqual([]);
    const [mention] = started(s.finish(c));
    expect(mention).toMatchObject({ memberId: 'b', kind: 'mention' });
    expect(s.finish(mention, post('@a'))).toMatchObject([
      { type: 'progress', present: false },
    ]);
  });

  it('caps a parallel batch and later admissions by the same turn budget', () => {
    const s = scenario({ maxTurnsPerChain: 2 });
    const effects = s.send(human('one'));
    expect(members(effects)).toEqual(['a', 'b']);
    expect(
      effects.filter((effect) => effect.type === 'limit-notice'),
    ).toHaveLength(1);
    const [a, b] = started(effects);
    expect(s.finish(a, post('@c'))).toEqual([]);
    expect(s.finish(b)).toMatchObject([{ type: 'progress', present: false }]);
  });
});

describe('supersession, cancellation and settling', () => {
  it('drops queued work, lets running turns report, and ignores their mentions', () => {
    const s = scenario();
    const old = reactRound(s);
    expect(
      s.send(human('two', { kind: 'members', handles: ['c'] })),
    ).toMatchObject([{ type: 'progress', chainId: 'two', present: true }]);
    const effects = s.finish(old, post('@b'));
    expect(effects).toMatchObject([
      { type: 'progress', chainId: 'one', present: false },
      { type: 'run-turn', chainId: 'two', memberId: 'c', throughTs: 'ts-two' },
    ]);
    expect(s.finish(old, post('@b'))).toEqual([]);
  });

  it('supersedes a waiting chain without affecting the original draining turn', () => {
    const s = scenario();
    const old = reactRound(s);
    s.send(human('two'));
    expect(s.send(human('three'))).toMatchObject([
      { type: 'progress', chainId: 'two', present: false },
      { type: 'progress', chainId: 'three', present: true },
    ]);
    expect(started(s.finish(old)).map(({ chainId }) => chainId)).toEqual([
      'three',
      'three',
      'three',
    ]);
  });

  it.each(['stop', 'end'] as const)(
    'aborts draining turns on %s and discards waiting grants',
    (kind) => {
      const s = scenario();
      const old = reactRound(s);
      s.send(human('two'));
      const effects = s.send({ type: kind });
      expect(effects).toMatchObject([
        { type: 'progress', chainId: 'two', present: false },
        { type: 'abort-turn', chainId: 'one', turnId: old?.turnId },
      ]);
      expect(
        s.finish(old, { kind: 'failed', code: 'E_TURN_ABORTED' }),
      ).toMatchObject([
        { type: 'turn-notice', memberId: 'a', code: 'E_TURN_ABORTED' },
        { type: 'progress', chainId: 'one', present: false },
      ]);
      expect(members(s.send(human('three')))).toEqual(
        kind === 'stop' ? ROSTER : [],
      );
    },
  );

  it('releases a failed turn once and waits for every other turn to report', () => {
    const s = scenario({ rounds: 1 });
    const [a, b, c] = s.start();
    expect(
      s.finish(a, { kind: 'failed', code: 'E_TURN_TIMEOUT' }),
    ).toMatchObject([{ type: 'turn-notice', code: 'E_TURN_TIMEOUT' }]);
    expect(s.finish(a)).toEqual([]);
    expect(s.finish(b)).toEqual([]);
    expect(s.finish(c)).toMatchObject([{ type: 'progress', present: false }]);
  });
});

it('preserves budgets and settles across seeded, interleaved event sequences', () => {
  let seed = 401;
  function random(max: number) {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return Math.floor((seed / 2 ** 32) * max);
  }

  for (let trial = 0; trial < 80; trial += 1) {
    const settings = {
      ...DEFAULTS,
      maxTurnsPerChain: random(10) + 1,
      hopBudget: random(5),
    };
    let state = createEngineState(ROSTER, settings);
    const outstanding = new Map<string, Started>();
    const starts = new Map<string, number>();
    let nextChain = 0;

    function step(event: EngineEvent) {
      const wasStale =
        event.type === 'turn-finished' && event.chainId !== state.active?.id;
      const previousActive = state.active;
      const result = reduce(state, event);
      state = result.state;
      for (const chain of [state.active, ...state.draining]) {
        if (!chain) continue;
        expect(chain.admitted).toBeLessThanOrEqual(settings.maxTurnsPerChain);
        expect(chain.hops).toBeLessThanOrEqual(settings.hopBudget);
      }
      if (wasStale && previousActive && state.active) {
        expect(state.active.admitted).toBe(previousActive.admitted);
        expect(state.active.hops).toBe(previousActive.hops);
      }
      for (const grant of started(result.effects)) {
        expect(outstanding.has(grant.turnId)).toBe(false);
        outstanding.set(grant.turnId, grant);
        const count = (starts.get(grant.chainId) ?? 0) + 1;
        starts.set(grant.chainId, count);
        expect(count).toBeLessThanOrEqual(settings.maxTurnsPerChain);
      }
    }

    function report(grant: Started, outcome: TurnOutcome) {
      outstanding.delete(grant.turnId);
      step({
        type: 'turn-finished',
        chainId: grant.chainId,
        turnId: grant.turnId,
        outcome,
      });
    }

    for (let count = 0; count < 50; count += 1) {
      const grant = [...outstanding.values()][random(outstanding.size)];
      switch (random(10)) {
        case 0:
          step({ type: 'stop' });
          break;
        case 1:
          step({
            type: 'turn-finished',
            chainId: 'unknown',
            turnId: 'unknown',
            outcome: post('@a @b @c'),
          });
          break;
        case 2:
          step(human(String(nextChain++)));
          break;
        case 3:
          step(
            human(String(nextChain++), {
              kind: 'members',
              handles: ['a', 'c'],
            }),
          );
          break;
        case 4:
          step(human(String(nextChain++), { kind: 'unaddressed' }));
          break;
        default:
          if (grant) report(grant, random(2) ? PASS : post('@a @b @c'));
      }
    }

    for (let count = 0; outstanding.size > 0 && count < 30; count += 1) {
      const grant = outstanding.values().next().value;
      if (grant) report(grant, post('@a @b @c'));
    }
    expect(outstanding.size).toBe(0);
    expect(state.active).toBeUndefined();
    expect(state.draining).toEqual([]);
  }
});
