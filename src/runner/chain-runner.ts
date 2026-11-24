import { parseListenOutput, parseTurnOutput } from '@council/context/output.js';
import {
  buildListenContext,
  buildTurnContext,
} from '@council/context/prompt.js';
import type {
  Clock,
  SlackPort,
  TurnApproval,
  TurnRunner,
} from '@council/core/ports.js';
import {
  failure,
  success,
  type ErrorCode,
  type Failure,
  type Result,
} from '@council/core/result.js';
import {
  MAX_PRIVATE_NOTE_CHARS,
  MAX_PRIVATE_NOTES_PER_MEMBER,
  type Council,
  type Member,
  type Message,
  type PrivateNote,
  type Scope,
} from '@council/core/types.js';
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
  readonly effect:
    | 'progress'
    | 'convening-notice'
    | 'limit-notice'
    | 'turn-notice'
    | 'hand-notice'
    | 'hand-reaction'
    | 'private-notes';
  readonly chainId: string;
  readonly turnId: string | null;
  readonly code: ErrorCode;
}

interface NoteAccess {
  read(): readonly PrivateNote[];
  update(
    change: (notes: readonly PrivateNote[]) => readonly PrivateNote[],
    signal?: AbortSignal,
  ): Promise<boolean>;
}

interface RunnerOptions {
  readonly slack: SlackPort;
  readonly turns: TurnRunner;
  readonly clock: Clock;
  readonly notes: NoteAccess;
  readonly instructionsText?: string;
  readonly orientationFor?: (
    grants: readonly string[],
  ) => ReadonlyMap<string, string>;
  readonly onEffectFailure?: (failure: EffectFailure) => void;
}

const PROGRESS_REACTION = 'hourglass_flowing_sand';
const LISTEN_TIMEOUT_MS = 10_000;

function isAfter(ts: string, cutoff: string): boolean {
  // Slack timestamps have microsecond precision. Compare integer and
  // fractional parts separately to preserve the full timestamp.
  const [seconds = '', fraction = ''] = ts.split('.');
  const [cutoffSeconds = '', cutoffFraction = ''] = cutoff.split('.');
  return seconds === cutoffSeconds
    ? fraction.padEnd(6, '0') > cutoffFraction.padEnd(6, '0')
    : seconds.length > cutoffSeconds.length ||
        (seconds.length === cutoffSeconds.length && seconds > cutoffSeconds);
}

function addNotes(
  current: readonly PrivateNote[],
  additions: readonly PrivateNote[],
) {
  const byMember = Map.groupBy(
    [...current, ...additions],
    ({ memberId }) => memberId,
  );
  return [...byMember.values()].flatMap((notes) =>
    notes.slice(-MAX_PRIVATE_NOTES_PER_MEMBER),
  );
}

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
  {
    slack,
    turns,
    clock,
    notes,
    instructionsText,
    orientationFor,
    onEffectFailure,
  }: RunnerOptions,
) {
  const { scope, settings } = council;
  const historyFromTs =
    scope.threadTs === undefined ? council.convenedAtTs : undefined;
  const byId = new Map(roster.map((member) => [member.id, member]));
  let state = createEngineState(council.roster, settings);
  let reducing = false;
  const events: EngineEvent[] = [];
  const controllers = new Map<string, AbortController>();
  const snapshots = new Map<string, Promise<Result<readonly Message[]>>>();
  const pending = new Set<Promise<void>>();
  const ancillary = createSerialQueue();
  const seenThrough = new Map<string, string>();
  let listening: AbortController | undefined;
  let inFlightPosts = 0;

  function markSeen(memberId: string, ts: string | undefined): void {
    const previous = seenThrough.get(memberId);
    if (ts !== undefined && (previous === undefined || isAfter(ts, previous)))
      seenThrough.set(memberId, ts);
  }

  function report(
    effect: EffectFailure['effect'],
    { chainId, turnId }: Pick<EffectFailure, 'chainId' | 'turnId'>,
    result: Result<unknown>,
  ): void {
    if (result.ok || !onEffectFailure) return;
    try {
      onEffectFailure({ scope, effect, chainId, turnId, code: result.code });
    } catch {
      // A diagnostic callback cannot interrupt the council lifecycle.
    }
  }

  function history(grant: Grant): Promise<Result<readonly Message[]>> {
    const snapshot =
      grant.throughTs === undefined ? undefined : snapshots.get(grant.chainId);
    if (snapshot) return snapshot;

    const read = (async () => {
      // A subsequent prompt should see any notices from the preceding turn.
      await ancillary.drain();
      return protect(
        () => slack.fetchMessages(scope, grant.throughTs, historyFromTs),
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
    suspendTimeout: TurnApproval['suspendTimeout'],
  ): Promise<
    Result<{
      text: string;
      shownNotes: readonly PrivateNote[];
      latestSeenTs: string | undefined;
    }>
  > {
    if (signal.aborted) return abortFailure(signal);
    const messages = await history(grant);
    if (signal.aborted) return abortFailure(signal);
    if (!messages.ok) return messages;

    const shownNotes =
      settings.listen === 'off'
        ? []
        : notes.read().filter(({ memberId }) => memberId === member.id);
    const { prompt, oldestTs } = buildTurnContext({
      member,
      roster,
      messages: messages.value,
      grant,
      contextChars: settings.contextChars,
      instructionsText,
      orientations: orientationFor?.(member.tools),
      replyWords: settings.replyWords,
      privateNotes: shownNotes,
      mentionPeople: settings.memberMentions === 'people',
    });
    const firstVisible = messages.value.findIndex(({ ts }) => ts === oldestTs);
    // Everything shown counts as seen, app notices included: a round opened
    // from the picker has only a notice before the first member posts.
    const latestSeenTs =
      firstVisible < 0 ? undefined : messages.value.at(-1)?.ts;
    const result = await protect(
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
          historyBeforeTs: oldestTs,
          historyFromTs,
          ...(shownNotes.length
            ? { privateNoteText: shownNotes.map(({ note }) => note) }
            : {}),
          approval: {
            owner: council.owner,
            timeoutMs: settings.approvalTimeoutMs,
            suspendTimeout,
          },
        }),
      'E_TURN_FAILED',
    );
    return result.ok
      ? success({ text: result.value, shownNotes, latestSeenTs })
      : result;
  }

  async function withDeadline<T>(
    controller: AbortController,
    signal: AbortSignal,
    timeoutMs: number,
    operation: (
      suspendTimeout: TurnApproval['suspendTimeout'],
    ) => Promise<Result<T>>,
  ): Promise<Result<T>> {
    if (signal.aborted) return abortFailure(signal);
    const aborted = Promise.withResolvers<Failure>();
    const onAbort = () => aborted.resolve(abortFailure(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    const now = () => clock.now?.() ?? performance.now();
    let remaining = timeoutMs;
    let started = now();
    let waits = 0;
    let finished = false;
    const arm = () =>
      clock.setTimeout(() => controller.abort('E_TURN_TIMEOUT'), remaining);
    let cancelTimeout = arm();

    function suspendTimeout(): () => void {
      if (finished || signal.aborted) return () => undefined;
      waits += 1;
      if (waits === 1) {
        cancelTimeout();
        remaining = Math.max(0, remaining - (now() - started));
        if (remaining === 0) controller.abort('E_TURN_TIMEOUT');
      }
      return () => {
        waits -= 1;
        if (waits === 0 && !finished && !signal.aborted) {
          started = now();
          cancelTimeout = arm();
        }
      };
    }
    try {
      return await Promise.race([aborted.promise, operation(suspendTimeout)]);
    } finally {
      finished = true;
      cancelTimeout();
      signal.removeEventListener('abort', onAbort);
    }
  }

  async function completeTurn(
    grant: Grant,
    shownNotes: readonly PrivateNote[],
    latestSeenTs: string | undefined,
  ): Promise<void> {
    if (settings.listen === 'off') return;
    markSeen(grant.memberId, latestSeenTs);
    if (shownNotes.length === 0) return;
    const result = await protect(
      async () =>
        success(
          await notes.update((current) =>
            current.filter((note) => !shownNotes.includes(note)),
          ),
        ),
      'E_STORE_WRITE',
    );
    report('private-notes', grant, result);
  }

  async function executeTurn(
    grant: Grant,
    controller: AbortController,
  ): Promise<TurnOutcome> {
    const member = byId.get(grant.memberId);
    if (!member) return failed('E_UNKNOWN_MEMBER');
    const { signal } = controller;
    const result = await withDeadline(
      controller,
      signal,
      settings.turnTimeoutMs,
      (suspendTimeout) => generate(grant, member, signal, suspendTimeout),
    );
    if (signal.aborted) return failed(abortFailure(signal).code);
    if (!result.ok) return failed(result.code);
    const { text, shownNotes, latestSeenTs } = result.value;
    if (!text.trim()) return failed('E_TURN_FAILED');
    const output = parseTurnOutput(text);
    if (output.kind === 'pass') {
      await completeTurn(grant, shownNotes, latestSeenTs);
      return output;
    }
    const publicText = shownNotes.reduce(
      (body, { note }) => body.replaceAll(note, '…'),
      output.text,
    );
    // An in-flight Slack write may still complete after the chain has moved on.
    const deadline = Promise.withResolvers<Failure>();
    const cancelPostTimeout = clock.setTimeout(
      () => deadline.resolve(failure('E_SLACK', 'Slack post timed out')),
      settings.turnTimeoutMs,
    );
    inFlightPosts += 1;
    const write = protect(
      () =>
        slack.postMember(scope, {
          member,
          text: publicText,
          chainId: grant.chainId,
          turnId: grant.turnId,
          mentionPeople: settings.memberMentions === 'people',
        }),
      'E_SLACK',
    ).finally(() => {
      inFlightPosts -= 1;
    });
    const posted = await Promise.race([deadline.promise, write]).finally(
      cancelPostTimeout,
    );
    if (!posted.ok) return failed(posted.code);
    await completeTurn(grant, shownNotes, latestSeenTs);
    return {
      kind: 'posted',
      ts: posted.value.ts,
      text: posted.value.text ?? publicText,
    };
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

  async function runListen(
    member: Member,
    messages: readonly Message[],
    savedNotes: readonly PrivateNote[],
    createdAtTs: string,
    triggerTs: string,
    batchSignal: AbortSignal,
  ): Promise<{ member: Member; note?: PrivateNote } | undefined> {
    const seen = seenThrough.get(member.id);
    const lastSpoke =
      seen === undefined
        ? messages.findLastIndex(
            ({ author }) =>
              author.kind === 'member' && author.memberId === member.id,
          )
        : -1;
    const latestNote = savedNotes.findLast(
      ({ memberId }) => memberId === member.id,
    );
    const firstNew = messages.findIndex(
      ({ ts }, index) =>
        // With no record of what the member saw, never reach back before this
        // chain: older posts may predate the council.
        (seen === undefined
          ? index > lastSpoke && !isAfter(triggerTs, ts)
          : isAfter(ts, seen)) &&
        (latestNote === undefined || isAfter(ts, latestNote.createdAtTs)),
    );
    if (firstNew === -1) return;
    const { prompt, targets } = buildListenContext(
      {
        member,
        roster,
        messages,
        contextChars: settings.contextChars,
        instructionsText,
        orientations: orientationFor?.(member.tools),
      },
      firstNew,
    );
    if (targets.size === 0) return;

    const timeout = new AbortController();
    const signal = AbortSignal.any([batchSignal, timeout.signal]);
    const result = await withDeadline(
      timeout,
      signal,
      Math.min(settings.turnTimeoutMs, LISTEN_TIMEOUT_MS),
      async () => {
        for (const _ of [0, 1]) {
          const response = await protect(
            () => turns.runListen({ member, prompt, signal }),
            'E_TURN_FAILED',
          );
          if (signal.aborted) return abortFailure(signal);
          if (!response.ok) return response;
          const output = parseListenOutput(response.value, targets);
          if (output.kind !== 'invalid') return success(output);
        }
        return success(undefined);
      },
    );
    if (!result.ok || result.value?.kind !== 'hand') return { member };
    return {
      member,
      note: {
        councilId: council.id,
        memberId: member.id,
        targetTs: result.value.targetTs,
        note: result.value.note.slice(0, MAX_PRIVATE_NOTE_CHARS),
        createdAtTs,
      },
    };
  }

  async function listenAtSettle(
    effect: Extract<EngineEffect, { type: 'settled' }>,
    batchSignal: AbortSignal,
  ): Promise<void> {
    const timeout = new AbortController();
    const signal = AbortSignal.any([batchSignal, timeout.signal]);
    const snapshot = await withDeadline(
      timeout,
      signal,
      Math.min(settings.turnTimeoutMs, LISTEN_TIMEOUT_MS),
      async () => {
        await ancillary.drain();
        return signal.aborted
          ? abortFailure(signal)
          : protect(
              () => slack.fetchMessages(scope, undefined, historyFromTs),
              'E_SLACK',
            );
      },
    );
    if (signal.aborted || !snapshot.ok) return;
    const messages = snapshot.value.filter(
      ({ author }) => author.kind !== 'notice',
    );
    const createdAtTs = messages.at(-1)?.ts;
    if (createdAtTs === undefined) return;
    const savedNotes = notes.read();
    const results = await Promise.all(
      roster.map((member) =>
        runListen(
          member,
          messages,
          savedNotes,
          createdAtTs,
          effect.triggerTs,
          batchSignal,
        ),
      ),
    );
    if (batchSignal.aborted) return;

    const hands = results.flatMap((result) =>
      result?.note ? [result.note] : [],
    );
    if (hands.length > 0) {
      const saved = await protect(
        async () =>
          success(
            await notes.update(
              (current) => addNotes(current, hands),
              batchSignal,
            ),
          ),
        'E_STORE_WRITE',
      );
      report('private-notes', effect, saved);
      if (!saved.ok || !saved.value) return;
    }
    if (batchSignal.aborted) return;
    for (const result of results) {
      if (result) markSeen(result.member.id, createdAtTs);
    }

    if (hands.length === 0) return;
    const names = results.flatMap((result) =>
      result?.note ? [result.member.name.replace(/\s+/gu, ' ')] : [],
    );
    const who = new Intl.ListFormat('en', { type: 'conjunction' }).format(
      names,
    );
    await ancillary.run(async () => {
      if (batchSignal.aborted) return;
      const result = await protect(
        () =>
          slack.postNotice(
            scope,
            names.length === 1
              ? `✋ ${who} has something to add. Mention them to hear it.`
              : `✋ ${who} have something to add. Mention them to hear it.`,
          ),
        'E_SLACK',
      );
      report('hand-notice', effect, result);
      for (const targetTs of new Set(hands.map((hand) => hand.targetTs))) {
        if (batchSignal.aborted) return;
        const reaction = await protect(
          () => slack.setReaction(scope.channel, targetTs, 'raised_hand', true),
          'E_SLACK',
        );
        report('hand-reaction', effect, reaction);
      }
    });
  }

  function cancelListening(): void {
    listening?.abort('E_TURN_ABORTED');
    listening = undefined;
  }

  function postConveningNotice(preset: string, chainId: string): void {
    schedule(
      ancillary.run(async () => {
        const result = await protect(
          () =>
            slack.postNotice(scope, 'Council convened.', {
              preset,
              roster: council.roster,
            }),
          'E_SLACK',
        );
        report('convening-notice', { chainId, turnId: null }, result);
      }),
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
      case 'settled': {
        // A timed-out Slack write can still be on the wire.
        if (inFlightPosts > 0) return;
        const controller = new AbortController();
        listening = controller;
        schedule(
          listenAtSettle(effect, controller.signal).finally(() => {
            if (listening === controller) listening = undefined;
          }),
        );
        return;
      }
      case 'progress':
      case 'limit-notice':
      case 'turn-notice':
        if (effect.type === 'progress' && !effect.present)
          snapshots.delete(effect.chainId);
        schedule(
          ancillary.run(async () => {
            const result = await protect<unknown>(
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
            report(effect.type, effect, result);
          }),
        );
        return;
    }
  }

  function dispatch(event: EngineEvent): void {
    if (
      event.type === 'stop' ||
      event.type === 'end' ||
      (event.type === 'human' &&
        (event.address.kind !== 'unaddressed' ||
          settings.unaddressed === 'council'))
    )
      cancelListening();
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

  return { dispatch, drain, cancelListening, postConveningNotice };
}
