import { parseTurnOutput } from '@council/context/output.js';
import { buildPrompt } from '@council/context/prompt.js';
import type { Clock, SlackPort, TurnRunner } from '@council/core/ports.js';
import {
  failure,
  type ErrorCode,
  type Failure,
  type Result,
} from '@council/core/result.js';
import type { Council, Member, Message, Scope } from '@council/core/types.js';
import {
  createEngineState,
  reduce,
  type EngineEffect,
  type EngineEvent,
  type Grant,
  type TurnOutcome,
} from '@council/engine/reducer.js';

import { createSerialQueue } from './serial-queue.js';

export interface EffectFailure {
  readonly scope: Scope;
  readonly effect: 'progress' | 'limit-notice' | 'turn-notice';
  readonly chainId: string;
  readonly turnId: string | null;
  readonly code: ErrorCode;
}

interface RunnerOptions {
  readonly slack: SlackPort;
  readonly turns: TurnRunner;
  readonly clock: Clock;
  readonly onEffectFailure?: (failure: EffectFailure) => void;
}

const PROGRESS_REACTION = 'hourglass_flowing_sand';

function abortFailure(signal: AbortSignal): Failure {
  return signal.reason === 'E_TURN_TIMEOUT'
    ? failure('E_TURN_TIMEOUT', 'Turn timed out')
    : failure('E_TURN_ABORTED', 'Turn was cancelled');
}

function failed(code: ErrorCode): TurnOutcome {
  return { kind: 'failed', code };
}

async function protect<T>(
  operation: () => Promise<Result<T>>,
  code: ErrorCode,
): Promise<Result<T>> {
  try {
    return await operation();
  } catch {
    return failure(code, 'Port operation failed');
  }
}

export function createChainRunner(
  council: Council,
  roster: readonly Member[],
  { slack, turns, clock, onEffectFailure }: RunnerOptions,
) {
  const { scope, settings } = council;
  const byId = new Map(roster.map((member) => [member.id, member]));
  let state = createEngineState(council.roster, settings);
  let reducing = false;
  const events: EngineEvent[] = [];
  const controllers = new Map<string, AbortController>();
  const snapshots = new Map<string, Promise<Result<readonly Message[]>>>();
  const pending = new Set<Promise<void>>();
  const ancillary = createSerialQueue();

  function history(grant: Grant): Promise<Result<readonly Message[]>> {
    const snapshot =
      grant.throughTs === undefined ? undefined : snapshots.get(grant.chainId);
    if (snapshot) return snapshot;

    const read = (async () => {
      // A subsequent prompt should see any notices from the preceding turn.
      await ancillary.drain();
      return protect(
        () => slack.fetchMessages(scope, grant.throughTs),
        'E_SLACK',
      );
    })();
    if (grant.throughTs !== undefined) snapshots.set(grant.chainId, read);
    return read;
  }

  async function generate(
    grant: Grant,
    member: Member,
    signal: AbortSignal,
  ): Promise<Result<string>> {
    if (signal.aborted) return abortFailure(signal);
    const messages = await history(grant);
    if (signal.aborted) return abortFailure(signal);
    if (!messages.ok) return messages;

    const prompt = buildPrompt({
      member,
      roster,
      messages: messages.value,
      grant,
      contextChars: settings.contextChars,
    });
    return protect(
      () =>
        turns.runTurn({
          councilId: council.id,
          scope,
          member,
          prompt,
          maxSteps: settings.maxSteps,
          signal,
          chainId: grant.chainId,
          turnId: grant.turnId,
        }),
      'E_TURN_FAILED',
    );
  }

  async function executeTurn(
    grant: Grant,
    controller: AbortController,
  ): Promise<TurnOutcome> {
    const member = byId.get(grant.memberId);
    if (!member) return failed('E_UNKNOWN_MEMBER');
    const { signal } = controller;
    const aborted = Promise.withResolvers<Failure>();
    const onAbort = () => aborted.resolve(abortFailure(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    const cancelTimeout = clock.setTimeout(
      () => controller.abort('E_TURN_TIMEOUT'),
      settings.turnTimeoutMs,
    );
    let result: Result<string>;
    try {
      result = await Promise.race([
        aborted.promise,
        generate(grant, member, signal),
      ]);
    } finally {
      cancelTimeout();
      signal.removeEventListener('abort', onAbort);
    }
    if (signal.aborted) return failed(abortFailure(signal).code);
    if (!result.ok) return failed(result.code);
    if (!result.value.trim()) return failed('E_TURN_FAILED');
    const output = parseTurnOutput(result.value);
    if (output.kind === 'pass') return output;

    // An in-flight Slack write may still complete after the chain has moved on.
    const deadline = Promise.withResolvers<Failure>();
    const cancelPostTimeout = clock.setTimeout(
      () => deadline.resolve(failure('E_SLACK', 'Slack post timed out')),
      settings.turnTimeoutMs,
    );
    try {
      const posted = await Promise.race([
        deadline.promise,
        protect(
          () =>
            slack.postMember(scope, {
              member,
              text: output.text,
              chainId: grant.chainId,
              turnId: grant.turnId,
            }),
          'E_SLACK',
        ),
      ]);
      return posted.ok
        ? { kind: 'posted', ts: posted.value.ts, text: output.text }
        : failed(posted.code);
    } finally {
      cancelPostTimeout();
    }
  }

  function schedule(task: Promise<void>): void {
    pending.add(task);
    void task.then(() => pending.delete(task));
  }

  function launchTurn(grant: Grant): void {
    const controller = new AbortController();
    const { chainId, turnId } = grant;
    controllers.set(turnId, controller);
    schedule(
      (async () => {
        const outcome = await executeTurn(grant, controller).catch(() =>
          failed('E_TURN_FAILED'),
        );
        controllers.delete(turnId);
        dispatch({ type: 'turn-finished', chainId, turnId, outcome });
      })(),
    );
  }

  function notice(
    effect: Extract<EngineEffect, { type: 'turn-notice' }>,
  ): string {
    const member = (byId.get(effect.memberId)?.name ?? effect.memberId).replace(
      /\s+/gu,
      ' ',
    );
    switch (effect.code) {
      case 'E_TURN_TIMEOUT':
        return `${member}’s turn timed out.`;
      case 'E_TURN_ABORTED':
        return `${member}’s turn was cancelled.`;
      default:
        return `${member}’s turn failed (${effect.code}).`;
    }
  }

  function perform(effect: EngineEffect): void {
    switch (effect.type) {
      case 'abort-turn':
        controllers.get(effect.turnId)?.abort('E_TURN_ABORTED');
        return;
      case 'run-turn':
        launchTurn(effect);
        return;
      case 'progress':
      case 'limit-notice':
      case 'turn-notice':
        if (effect.type === 'progress' && !effect.present)
          snapshots.delete(effect.chainId);
        schedule(
          ancillary.run(async () => {
            const result = await protect(
              () =>
                effect.type === 'progress'
                  ? slack.setReaction(
                      scope.channel,
                      effect.ts,
                      PROGRESS_REACTION,
                      effect.present,
                    )
                  : slack.postNotice(
                      scope,
                      effect.type === 'limit-notice'
                        ? 'Council floor budget reached. Further grants were dropped.'
                        : notice(effect),
                    ),
              'E_SLACK',
            );
            if (!result.ok && onEffectFailure) {
              try {
                onEffectFailure({
                  scope,
                  effect: effect.type,
                  chainId: effect.chainId,
                  turnId: effect.turnId,
                  code: result.code,
                });
              } catch {
                // A diagnostic callback cannot interrupt the council lifecycle.
                return;
              }
            }
          }),
        );
        return;
    }
  }

  function dispatch(event: EngineEvent): void {
    events.push(event);
    if (reducing) return;
    reducing = true;
    try {
      for (let next = events.shift(); next; next = events.shift()) {
        const transition = reduce(state, next);
        state = transition.state;
        for (const effect of transition.effects) perform(effect);
      }
    } finally {
      reducing = false;
    }
  }

  async function drain(): Promise<void> {
    while (pending.size > 0) await Promise.all(pending);
  }

  return { dispatch, drain };
}
