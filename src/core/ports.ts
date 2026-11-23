import type { Result } from './result.js';
import type { Council, Member, Message, Prompt, Scope } from './types.js';

export interface TurnRef {
  readonly chainId: string;
  readonly turnId: string;
}

export interface SlackPort {
  /** Oldest first, with an inclusive upper bound when supplied. */
  fetchMessages(
    scope: Scope,
    throughTs?: string,
  ): Promise<Result<readonly Message[]>>;
  /** Post once, with turn metadata and broadcast mentions neutralised. */
  postMember(
    scope: Scope,
    post: TurnRef & { readonly member: Member; readonly text: string },
  ): Promise<Result<{ readonly ts: string }>>;
  postNotice(scope: Scope, text: string): Promise<Result<void>>;
  setReaction(
    channel: string,
    ts: string,
    reaction: string,
    present: boolean,
  ): Promise<Result<void>>;
}

export interface TurnInput extends TurnRef {
  readonly councilId: string;
  readonly scope: Scope;
  readonly member: Member;
  readonly prompt: Prompt;
  readonly maxSteps: number;
  readonly signal: AbortSignal;
}

export interface TurnRunner {
  runTurn(input: TurnInput): Promise<Result<string>>;
}

export interface StoredState {
  readonly councils: readonly Council[];
  /** Oldest accepted key first. */
  readonly acceptedMessageKeys: readonly string[];
}

export interface Store {
  load(): Promise<Result<StoredState>>;
  save(state: StoredState): Promise<Result<void>>;
}

export interface Clock {
  /** Schedule a callback and return a function that cancels it. */
  setTimeout(callback: () => void, ms: number): () => void;
}

export interface IdSource {
  next(): string;
}
