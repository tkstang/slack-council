import { randomUUID } from 'node:crypto';

import type { Config } from '@council/config/schema.js';
import { CliError } from '@council/core/errors.js';
import type {
  Clock,
  IdSource,
  SlackPort,
  Store,
  TurnRunner,
} from '@council/core/ports.js';
import type { Result } from '@council/core/result.js';
import type {
  Council,
  HumanMessage,
  Member,
  Scope,
} from '@council/core/types.js';
import { parseHumanAddress } from '@council/engine/addressing.js';
import {
  createJsonStore,
  MAX_ACCEPTED_MESSAGES,
} from '@council/store/json-store.js';

import { createChainRunner, type EffectFailure } from './chain-runner.js';
import { createSerialQueue } from './serial-queue.js';

export interface CouncilServiceOptions {
  readonly slack: SlackPort;
  readonly turns: TurnRunner;
  readonly appUserId: string;
  readonly store?: Store;
  readonly clock?: Clock;
  readonly ids?: IdSource;
  readonly onEffectFailure?: (failure: EffectFailure) => void;
  /** Reports each stored council left dormant because a member was removed from config. */
  readonly onSkippedCouncil?: (
    council: Council,
    missingMembers: readonly string[],
  ) => void;
}

export type ConveneInput = {
  readonly scope: Scope;
  readonly owner: string;
} & (
  | { readonly roster: readonly string[]; readonly preset?: never }
  | { readonly preset?: string; readonly roster?: never }
);

export interface HumanMessageInput {
  readonly scope: Scope;
  /** Raw Slack event text is used only for addressing. Prompt history is fetched separately. */
  readonly message: HumanMessage;
  /** Allow an explicit council address to convene the supplied thread scope. */
  readonly kickoff?: boolean;
}

export type HumanMessageResult = 'accepted' | 'duplicate' | 'ignored';

export interface CouncilService {
  getCouncil(scope: Scope): Council | undefined;
  /** True when a stored council holds the scope but cannot run under the current config. */
  isDormant(scope: Scope): boolean;
  convene(input: ConveneInput): Promise<Council>;
  handleHumanMessage(input: HumanMessageInput): Promise<HumanMessageResult>;
  end(scope: Scope, userId: string): Promise<boolean>;
  shutdown(): Promise<void>;
}

interface Entry {
  readonly council: Council;
  readonly runner: ReturnType<typeof createChainRunner>;
}

const SYSTEM_CLOCK: Clock = {
  setTimeout(callback, ms) {
    const timeout = setTimeout(callback, ms);
    return () => clearTimeout(timeout);
  },
};

const SYSTEM_IDS: IdSource = { next: randomUUID };

function scopeKey({ channel, threadTs }: Scope): string {
  return JSON.stringify([channel, threadTs]);
}

function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.value;
  throw new CliError(result.code, result.message, { hint: result.hint });
}

export async function openCouncilService(
  config: Config,
  {
    slack,
    turns,
    appUserId,
    store = createJsonStore(config.stateDir),
    clock = SYSTEM_CLOCK,
    ids = SYSTEM_IDS,
    onEffectFailure,
    onSkippedCouncil,
  }: CouncilServiceOptions,
): Promise<CouncilService> {
  const allowedUsers = new Set(config.slack.allowedUsers);
  const members = new Map<string, Member>(
    Object.entries(config.members).map(([id, member]) => [
      id,
      { id, ...member },
    ]),
  );
  const entries = new Map<string, Entry>();
  const retiring = new Set<Promise<void>>();
  const pendingKeys = new Set<string>();
  const writes = createSerialQueue();
  let shutdownTask: Promise<void> | undefined;
  const saved = unwrap(await store.load());
  let privateNotes = saved.privateNotes;
  let accepted = new Set(
    saved.acceptedMessageKeys.slice(-MAX_ACCEPTED_MESSAGES),
  );

  // Every accepted message gets a visible answer. A reaction is best effort:
  // failing to add one must not fail the message it acknowledges.
  function acknowledge(scope: Scope, ts: string, reaction: string): void {
    void slack
      .setReaction(scope.channel, ts, reaction, true)
      .catch(() => undefined);
  }

  function makeEntry(
    council: Council,
    invalidCode: 'E_INVALID_STATE' | 'E_INVALID_INPUT',
  ): Entry {
    if (
      council.roster.length === 0 ||
      new Set(council.roster).size !== council.roster.length
    ) {
      throw new CliError(
        invalidCode,
        'A council roster must contain unique members',
      );
    }
    const roster = council.roster.map((id) => {
      const member = members.get(id);
      if (!member) {
        throw new CliError('E_UNKNOWN_MEMBER', `Unknown council member: ${id}`);
      }
      return member;
    });
    return {
      council,
      runner: createChainRunner(council, roster, {
        slack,
        turns,
        clock,
        onEffectFailure,
        notes: {
          read: () =>
            privateNotes.filter(({ councilId }) => councilId === council.id),
          update: (change, signal) =>
            writes.run(() => {
              if (
                signal?.aborted ||
                entries.get(scopeKey(council.scope))?.council !== council
              )
                return Promise.resolve(false);
              const next = change(
                privateNotes.filter(
                  ({ councilId }) => councilId === council.id,
                ),
              );
              return save(
                councils(),
                undefined,
                undefined,
                [
                  ...privateNotes.filter(
                    ({ councilId }) => councilId !== council.id,
                  ),
                  ...next,
                ],
                signal,
              );
            }),
        },
      }),
    };
  }

  // Councils that cannot run under the current config stay in the saved state,
  // so restoring a removed member restores its councils.
  const dormant = new Map<string, Council>();
  const seenIds = new Set<string>();
  for (const council of saved.councils) {
    const key = scopeKey(council.scope);
    if (entries.has(key) || dormant.has(key) || seenIds.has(council.id)) {
      throw new CliError(
        'E_INVALID_STATE',
        'Persisted councils contain duplicate ids or scopes',
      );
    }
    seenIds.add(council.id);
    const missing = council.roster.filter((id) => !members.has(id));
    if (missing.length > 0) {
      onSkippedCouncil?.(council, missing);
      dormant.set(key, council);
      continue;
    }
    entries.set(
      key,
      makeEntry(
        {
          ...council,
          settings: { ...council.settings, listen: config.council.listen },
        },
        'E_INVALID_STATE',
      ),
    );
  }

  function makeCouncil(input: ConveneInput): Entry {
    const preset = input.preset ?? config.defaultPreset;
    const roster =
      input.roster ??
      (Object.hasOwn(config.presets, preset)
        ? config.presets[preset]
        : undefined);
    if (!roster)
      throw new CliError(
        'E_UNKNOWN_PRESET',
        `Unknown council preset: ${preset}`,
      );
    return makeEntry(
      {
        id: ids.next(),
        scope: { ...input.scope },
        owner: input.owner,
        roster: [...roster],
        settings: { ...config.council },
      },
      'E_INVALID_INPUT',
    );
  }

  function requireOpen(): void {
    if (shutdownTask)
      throw new CliError(
        'E_SERVICE_CLOSED',
        'Council service is shutting down',
      );
  }

  function requireAllowed(userId: string): void {
    if (!allowedUsers.has(userId))
      throw new CliError('E_FORBIDDEN', 'User cannot drive councils');
  }

  function councils(except?: string): Council[] {
    return [...entries]
      .filter(([key]) => key !== except)
      .map(([, { council }]) => council);
  }

  async function save(
    records: readonly Council[],
    acceptedMessageKeys = [...accepted],
    endedDormant?: string,
    notes = privateNotes,
    signal?: AbortSignal,
  ): Promise<boolean> {
    // A council convened in a dormant council's scope replaces it. The dormant
    // record leaves memory only once the save has succeeded.
    const replaced = new Set(records.map(({ scope }) => scopeKey(scope)));
    if (endedDormant !== undefined) replaced.add(endedDormant);
    const kept = [...dormant].filter(([key]) => !replaced.has(key));
    const retained = [...records, ...kept.map(([, council]) => council)];
    const retainedIds = new Set(retained.map(({ id }) => id));
    const retainedNotes = notes.filter(({ councilId }) =>
      retainedIds.has(councilId),
    );
    const state = {
      councils: retained,
      acceptedMessageKeys,
      privateNotes: retainedNotes,
    };
    if (signal?.aborted) return false;
    unwrap(await store.save(state));
    if (signal?.aborted) {
      // Restore the previous notes before any queued state write can start.
      unwrap(await store.save({ ...state, privateNotes }));
      return false;
    }
    privateNotes = retainedNotes;
    for (const key of replaced) dormant.delete(key);
    return true;
  }

  function retire(key: string, entry: Entry): void {
    entry.runner.dispatch({ type: 'end' });
    entries.delete(key);
    const settled = entry.runner.drain();
    retiring.add(settled);
    void settled.then(() => retiring.delete(settled));
  }

  return {
    getCouncil(scope) {
      return entries.get(scopeKey(scope))?.council;
    },

    isDormant(scope) {
      return dormant.has(scopeKey(scope));
    },

    async convene(input) {
      requireOpen();
      requireAllowed(input.owner);
      return writes.run(async () => {
        const key = scopeKey(input.scope);
        if (entries.has(key))
          throw new CliError(
            'E_COUNCIL_EXISTS',
            'This scope already has a council',
          );
        const entry = makeCouncil(input);
        await save([...councils(), entry.council]);
        entries.set(key, entry);
        return entry.council;
      });
    },

    async handleHumanMessage({ scope, message, kickoff }) {
      requireOpen();
      const owner = message.author.userId;
      if (!allowedUsers.has(owner)) return 'ignored';

      const messageKey = `${scope.channel}:${message.ts}`;
      if (accepted.has(messageKey) || pendingKeys.has(messageKey))
        return 'duplicate';
      // Reserve synchronously so concurrent deliveries cannot both enter the write queue.
      pendingKeys.add(messageKey);
      try {
        const key = scopeKey(scope);
        const received = entries.get(key);
        const receivedAddress = parseHumanAddress(
          message.text,
          appUserId,
          received?.council.roster ?? [],
        );
        if (receivedAddress.kind === 'stop' || receivedAddress.kind === 'end')
          received?.runner.dispatch({ type: 'stop' });
        else if (
          receivedAddress.kind !== 'unaddressed' ||
          received?.council.settings.unaddressed === 'council'
        )
          received?.runner.cancelListening();

        return await writes.run(async () => {
          const current = entries.get(key);
          const address =
            current === received
              ? receivedAddress
              : parseHumanAddress(
                  message.text,
                  appUserId,
                  current?.council.roster ?? [],
                );
          const opening =
            !current &&
            kickoff &&
            scope.threadTs !== undefined &&
            address.kind === 'council'
              ? makeCouncil({ scope, owner })
              : undefined;
          const entry = current ?? opening;
          if (!entry) {
            if (address.kind !== 'end' || !dormant.has(key)) return 'ignored';
            const keys = [...accepted, messageKey].slice(
              -MAX_ACCEPTED_MESSAGES,
            );
            await save(councils(), keys, key);
            accepted = new Set(keys);
            acknowledge(scope, message.ts, 'wave');
            return 'accepted';
          }

          // Earlier queued messages may have started another chain while cancellation waited.
          if (address.kind === 'stop' || address.kind === 'end')
            entry.runner.dispatch({ type: 'stop' });
          const event =
            address.kind === 'end' || address.kind === 'stop'
              ? undefined
              : {
                  type: 'human' as const,
                  chainId: ids.next(),
                  ts: message.ts,
                  address,
                };
          const nextKeys = [...accepted, messageKey].slice(
            -MAX_ACCEPTED_MESSAGES,
          );
          const nextCouncils =
            address.kind === 'end'
              ? councils(key)
              : opening
                ? [...councils(), opening.council]
                : councils();
          await save(nextCouncils, nextKeys);
          accepted = new Set(nextKeys);
          if (opening) entries.set(key, opening);

          if (address.kind === 'end') retire(key, entry);
          else if (event) entry.runner.dispatch(event);
          // An addressed message gets the progress reaction from its chain.
          if (address.kind === 'end') acknowledge(scope, message.ts, 'wave');
          else if (address.kind === 'stop')
            acknowledge(scope, message.ts, 'octagonal_sign');
          else if (
            address.kind === 'unaddressed' &&
            entry.council.settings.unaddressed === 'silent'
          )
            acknowledge(scope, message.ts, 'eyes');
          return 'accepted';
        });
      } finally {
        pendingKeys.delete(messageKey);
      }
    },

    async end(scope, userId) {
      requireOpen();
      requireAllowed(userId);
      const key = scopeKey(scope);
      entries.get(key)?.runner.dispatch({ type: 'stop' });
      return writes.run(async () => {
        const entry = entries.get(key);
        if (!entry) {
          if (!dormant.has(key)) return false;
          await save(councils(), undefined, key);
          return true;
        }
        entry.runner.dispatch({ type: 'stop' });
        await save(councils(key));
        retire(key, entry);
        return true;
      });
    },

    shutdown() {
      for (const { runner } of entries.values()) runner.cancelListening();
      shutdownTask ??= (async () => {
        await writes.drain();
        const active = [...entries.values()];
        for (const { runner } of active) runner.dispatch({ type: 'stop' });
        await Promise.all([
          ...retiring,
          ...active.map(({ runner }) => runner.drain()),
        ]);
      })();
      return shutdownTask;
    },
  };
}
