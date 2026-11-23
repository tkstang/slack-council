import type { TurnRef } from '@council/core/ports.js';
import type { ErrorCode } from '@council/core/result.js';
import type { CouncilSettings, FloorKind } from '@council/core/types.js';

import { parseMemberMentions, type FloorAddress } from './addressing.js';

export interface Grant extends TurnRef {
  readonly memberId: string;
  readonly kind: FloorKind;
  readonly round?: number;
  readonly sourceTs: string;
  /** All grants in a parallel batch share this inclusive cutoff. */
  readonly throughTs?: string;
}

interface Chain {
  readonly id: string;
  readonly triggerTs: string;
  readonly queued: readonly Grant[];
  readonly running: readonly Grant[];
  readonly admitted: number;
  readonly hops: number;
  readonly limitNoticed: boolean;
  readonly cancelled: boolean;
  readonly nextReactRound?: number;
  readonly reactPasses: number;
}

export interface EngineState {
  readonly roster: readonly string[];
  readonly settings: Pick<
    CouncilSettings,
    'rounds' | 'hopBudget' | 'maxTurnsPerChain' | 'unaddressed' | 'listen'
  >;
  readonly ended: boolean;
  readonly active?: Chain;
  readonly draining: readonly Chain[];
}

export type TurnOutcome =
  | { readonly kind: 'pass' }
  | { readonly kind: 'posted'; readonly ts: string; readonly text: string }
  | { readonly kind: 'failed'; readonly code: ErrorCode };

export type EngineEvent =
  | {
      readonly type: 'human';
      readonly chainId: string;
      readonly ts: string;
      readonly address: FloorAddress;
    }
  | { readonly type: 'stop' | 'end' }
  | (TurnRef & {
      readonly type: 'turn-finished';
      readonly outcome: TurnOutcome;
    });

type ChainRef = { readonly chainId: string; readonly turnId: null };

export type EngineEffect =
  | (Grant & { readonly type: 'run-turn' })
  | (TurnRef & { readonly type: 'abort-turn' })
  | (ChainRef & {
      readonly type: 'progress';
      readonly ts: string;
      readonly present: boolean;
    })
  | (ChainRef & { readonly type: 'settled' })
  | ((TurnRef | ChainRef) & { readonly type: 'limit-notice' })
  | (TurnRef & {
      readonly type: 'turn-notice';
      readonly memberId: string;
      readonly code: ErrorCode;
    });

interface Transition {
  readonly state: EngineState;
  readonly effects: readonly EngineEffect[];
}

export function createEngineState(
  roster: readonly string[],
  settings: EngineState['settings'],
): EngineState {
  return { roster, settings, ended: false, draining: [] };
}

function progress(chain: Chain, present: boolean): EngineEffect {
  return {
    type: 'progress',
    chainId: chain.id,
    turnId: null,
    ts: chain.triggerTs,
    present,
  };
}

function noticeLimit(
  chain: Chain,
  effects: EngineEffect[],
  source?: TurnRef,
): Chain {
  if (chain.limitNoticed) return chain;
  effects.push({
    type: 'limit-notice',
    chainId: chain.id,
    turnId: source?.turnId ?? null,
  });
  return { ...chain, limitNoticed: true };
}

function admit(
  chain: Chain,
  memberIds: readonly string[],
  grant: Omit<Grant, keyof TurnRef | 'memberId'>,
  maxTurns: number,
  effects: EngineEffect[],
): Chain {
  const queued = [...chain.queued];
  let admitted = chain.admitted;
  for (const memberId of memberIds) {
    if (admitted >= maxTurns) {
      return noticeLimit({ ...chain, admitted, queued }, effects);
    }
    admitted += 1;
    queued.push({
      ...grant,
      memberId,
      chainId: chain.id,
      turnId: `${chain.id}/${admitted}`,
    });
  }
  return { ...chain, admitted, queued };
}

function admitMentions(
  state: EngineState,
  chain: Chain,
  speaker: Grant,
  post: Extract<TurnOutcome, { kind: 'posted' }>,
  effects: EngineEffect[],
): Chain {
  const { settings, roster } = state;
  const mentions = chain.queued.filter((grant) => grant.kind === 'mention');
  let reacts = chain.queued.filter((grant) => grant.kind === 'react');
  let admitted = chain.admitted;
  let hops = chain.hops;
  for (const id of parseMemberMentions(post.text, speaker.memberId, roster)) {
    if (mentions.some((grant) => grant.memberId === id)) continue;
    const queued = reacts.find((grant) => grant.memberId === id);
    if (
      hops >= settings.hopBudget ||
      (!queued && admitted >= settings.maxTurnsPerChain)
    ) {
      if (!queued) chain = noticeLimit(chain, effects, speaker);
      continue;
    }
    hops += 1;
    if (queued) {
      reacts = reacts.filter((grant) => grant !== queued);
      mentions.push({ ...queued, kind: 'mention', sourceTs: post.ts });
    } else {
      admitted += 1;
      mentions.push({
        chainId: chain.id,
        turnId: `${chain.id}/${admitted}`,
        memberId: id,
        kind: 'mention',
        sourceTs: post.ts,
      });
    }
  }
  return { ...chain, queued: [...mentions, ...reacts], admitted, hops };
}

function advance(state: EngineState, effects: EngineEffect[]): EngineState {
  let chain = state.active;
  if (!chain || chain.running.length > 0 || state.draining.length > 0)
    return state;

  if (chain.queued.length === 0) {
    const round = chain.nextReactRound;
    if (
      round !== undefined &&
      round <= state.settings.rounds &&
      chain.reactPasses < state.roster.length
    ) {
      chain = admit(
        { ...chain, nextReactRound: round + 1, reactPasses: 0 },
        state.roster,
        { kind: 'react', round, sourceTs: chain.triggerTs },
        state.settings.maxTurnsPerChain,
        effects,
      );
    }
  }

  const first = chain.queued[0];
  if (!first) {
    effects.push(progress(chain, false));
    if (state.settings.listen === 'settle') {
      effects.push({ type: 'settled', chainId: chain.id, turnId: null });
    }
    return { ...state, active: undefined };
  }

  const running = first.throughTs === undefined ? [first] : chain.queued;
  effects.push(
    ...running.map((grant): EngineEffect => ({ ...grant, type: 'run-turn' })),
  );
  return {
    ...state,
    active: { ...chain, running, queued: chain.queued.slice(running.length) },
  };
}

function cancelOrSupersede(
  state: EngineState,
  abort: boolean,
  effects: EngineEffect[],
): EngineState {
  const draining = [...state.draining];
  const chain = state.active;
  if (chain) {
    if (chain.running.length > 0) {
      draining.push({ ...chain, queued: [] });
    } else {
      effects.push(progress(chain, false));
    }
  }
  const remaining = abort
    ? draining.map((pending) => {
        if (pending.cancelled) return pending;
        for (const { chainId, turnId } of pending.running) {
          effects.push({ type: 'abort-turn', chainId, turnId });
        }
        return { ...pending, cancelled: true };
      })
    : draining;
  return { ...state, active: undefined, draining: remaining };
}

function onHuman(
  state: EngineState,
  event: Extract<EngineEvent, { type: 'human' }>,
  effects: EngineEffect[],
): EngineState {
  const { address, ts, chainId } = event;
  if (state.ended) return state;
  if (address.kind === 'unaddressed' && state.settings.unaddressed === 'silent')
    return state;
  if (
    state.active?.id === chainId ||
    state.draining.some((chain) => chain.id === chainId)
  )
    return state;

  const roster =
    address.kind === 'members'
      ? state.roster.filter((id) => address.handles.includes(id))
      : state.roster;
  if (roster.length === 0) return state;

  const round = address.kind !== 'members';
  const next = cancelOrSupersede(state, false, effects);
  const chain: Chain = {
    id: chainId,
    triggerTs: ts,
    queued: [],
    running: [],
    admitted: 0,
    hops: 0,
    limitNoticed: false,
    cancelled: false,
    nextReactRound: round ? 2 : undefined,
    reactPasses: 0,
  };
  effects.push(progress(chain, true));
  return {
    ...next,
    active: admit(
      chain,
      roster,
      {
        kind: round ? 'round' : 'mention',
        round: round ? 1 : undefined,
        sourceTs: ts,
        throughTs: ts,
      },
      state.settings.maxTurnsPerChain,
      effects,
    ),
  };
}

function onFinished(
  state: EngineState,
  event: Extract<EngineEvent, { type: 'turn-finished' }>,
  effects: EngineEffect[],
): EngineState {
  const { chainId, turnId, outcome } = event;
  const current = state.active;
  const active = current?.id === chainId;
  const chain = active
    ? current
    : state.draining.find((old) => old.id === chainId);
  const grant = chain?.running.find((pending) => pending.turnId === turnId);
  if (!chain || !grant) return state;

  if (outcome.kind === 'failed') {
    effects.push({
      type: 'turn-notice',
      chainId,
      turnId,
      memberId: grant.memberId,
      code: outcome.code,
    });
  }
  const running = chain.running.filter((pending) => pending !== grant);
  const next = {
    ...chain,
    running,
    reactPasses:
      chain.reactPasses +
      Number(grant.kind === 'react' && outcome.kind === 'pass'),
  };
  if (active) {
    return {
      ...state,
      active:
        outcome.kind === 'posted'
          ? admitMentions(state, next, grant, outcome, effects)
          : next,
    };
  }
  if (running.length === 0) effects.push(progress(chain, false));
  return {
    ...state,
    draining: state.draining.flatMap((old) =>
      old !== chain ? [old] : running.length > 0 ? [next] : [],
    ),
  };
}

export function reduce(state: EngineState, event: EngineEvent): Transition {
  const effects: EngineEffect[] = [];
  let next: EngineState;

  switch (event.type) {
    case 'human':
      next = onHuman(state, event, effects);
      break;
    case 'stop':
    case 'end':
      next = {
        ...cancelOrSupersede(state, true, effects),
        ended: state.ended || event.type === 'end',
      };
      break;
    case 'turn-finished':
      next = onFinished(state, event, effects);
      break;
  }

  return { state: advance(next, effects), effects };
}
