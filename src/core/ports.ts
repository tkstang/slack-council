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
  /**
   * Post once, with turn metadata and broadcast mentions neutralised. `text` is
   * what was actually posted when the adapter changed it (for example by
   * truncating), so mentions are routed from what readers can see.
   */
  postMember(
    scope: Scope,
    post: TurnRef & { readonly member: Member; readonly text: string },
  ): Promise<Result<{ readonly ts: string; readonly text?: string }>>;
  postNotice(scope: Scope, text: string): Promise<Result<void>>;
  setReaction(
    channel: string,
    ts: string,
    reaction: string,
    present: boolean,
  ): Promise<Result<void>>;
}

export interface ApprovalRequest {
  readonly id: string;
  readonly memberName: string;
  readonly tool: string;
  readonly preview: string;
}

export type ApprovalOutcome =
  | { readonly kind: 'approved' | 'denied'; readonly userId: string }
  | { readonly kind: 'expired' | 'cancelled' };

export interface ApprovalPort {
  postApproval(
    scope: Scope,
    request: ApprovalRequest,
  ): Promise<Result<{ readonly ts: string }>>;
  updateApproval(
    scope: Scope,
    ts: string,
    request: ApprovalRequest,
    outcome: ApprovalOutcome,
  ): Promise<Result<void>>;
}

export interface TurnApproval {
  readonly owner: string;
  readonly timeoutMs: number;
  /** Pause the turn deadline until the returned function is called. */
  suspendTimeout(): () => void;
}

export interface TurnInput extends TurnRef {
  readonly councilId: string;
  readonly scope: Scope;
  readonly member: Member;
  readonly prompt: Prompt;
  readonly maxSteps: number;
  readonly signal: AbortSignal;
  readonly approval?: TurnApproval;
  /** Exclusive default cutoff for retrieving messages before the prompt. */
  readonly historyBeforeTs?: string;
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
  /** Monotonic milliseconds, defaulting to performance.now(). */
  now?(): number;
  /** Schedule a callback and return a function that cancels it. */
  setTimeout(callback: () => void, ms: number): () => void;
}

export interface IdSource {
  next(): string;
}
