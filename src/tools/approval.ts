import { randomUUID } from 'node:crypto';

import type {
  ApprovalOutcome,
  ApprovalPort,
  ApprovalRequest,
  TurnInput,
} from '@council/core/ports.js';
import { failure, success, type Result } from '@council/core/result.js';

export type ApprovalClick = 'approve' | 'deny';
export type ApprovalReply = 'accepted' | 'ignored' | 'forbidden' | 'expired';

const denied = failure('E_APPROVAL_DENIED', 'Tool approval was denied');
const expired = failure('E_APPROVAL_EXPIRED', 'Tool approval expired');
const cancelled = failure('E_TURN_ABORTED', 'Turn was cancelled');
const postFailed = failure('E_SLACK', 'Could not post tool approval');
const MAX_PREVIEW = 500;

interface Pending {
  readonly owner: string;
  readonly input: TurnInput;
  readonly deadline: number;
  finish(outcome: ApprovalOutcome | undefined): void;
}

function preview(args: unknown): string {
  const text = (JSON.stringify(args) ?? '{}').replace(
    /[\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/gu,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  if (text.length <= MAX_PREVIEW) return text;
  return `${text.slice(0, MAX_PREVIEW - 1).replace(/[\uD800-\uDBFF]$/u, '')}…`;
}

export function createApprovalGate(
  port: ApprovalPort,
  allowedUsers: readonly string[],
  onWriteFailure: () => void = () => undefined,
) {
  const allowed = new Set(allowedUsers);
  const pending = new Map<string, Pending>();
  const consumed = new Set<string>();
  const writes = new Set<Promise<void>>();

  function request(
    input: TurnInput,
    owner: string,
    timeoutMs: number,
    tool: string,
    args: unknown,
  ): Promise<Result<void>> {
    if (input.signal.aborted) return Promise.resolve(cancelled);
    const id = randomUUID();
    const post: ApprovalRequest = {
      id,
      memberName: input.member.name,
      tool,
      preview: preview(args),
    };
    const outcome = Promise.withResolvers<ApprovalOutcome | undefined>();
    const deadline = performance.now() + timeoutMs;

    function finish(decision: ApprovalOutcome | undefined) {
      if (!pending.delete(id)) return;
      clearTimeout(timer);
      input.signal.removeEventListener('abort', abort);
      if (decision?.kind === 'approved' || decision?.kind === 'denied')
        consumed.add(id);
      outcome.resolve(decision);
    }

    const abort = () => finish({ kind: 'cancelled' });
    const timer = setTimeout(() => finish({ kind: 'expired' }), timeoutMs);
    pending.set(id, { owner, input, deadline, finish });
    input.signal.addEventListener('abort', abort, { once: true });

    // A click or cancellation may arrive before Slack returns the message ts.
    const delivery = (async () => {
      try {
        const posted = await port.postApproval(input.scope, post);
        if (!posted.ok) throw new Error('Approval post failed');
        const decision = await outcome.promise;
        if (decision) {
          const updated = await port.updateApproval(
            input.scope,
            posted.value.ts,
            post,
            decision,
          );
          if (!updated.ok) throw new Error('Approval update failed');
        }
      } catch {
        finish(undefined);
        onWriteFailure();
      }
    })();
    writes.add(delivery);
    void delivery.then(
      () => writes.delete(delivery),
      () => writes.delete(delivery),
    );

    return outcome.promise.then((decision) => {
      switch (decision?.kind) {
        case 'approved':
          return success(undefined);
        case 'denied':
          return denied;
        case 'expired':
          return expired;
        case 'cancelled':
          return cancelled;
        default:
          return postFailed;
      }
    });
  }

  return {
    forTurn(input: TurnInput) {
      let denials = 0;
      let queue = Promise.resolve();
      return (tool: string, args: unknown): Promise<Result<void>> => {
        // AI SDK can issue several tool calls together. Apply the denial budget
        // before posting the next request from this turn.
        const approval = queue.then(async () => {
          if (input.signal.aborted) return cancelled;
          if (denials >= 2) return denied;
          if (!input.approval)
            return failure('E_TOOL_FAILED', 'Turn cannot request approval');
          const { owner, timeoutMs, suspendTimeout } = input.approval;
          const resume = suspendTimeout();
          try {
            const decision = await request(input, owner, timeoutMs, tool, args);
            if (!decision.ok && decision.code === 'E_APPROVAL_DENIED')
              denials += 1;
            return decision;
          } finally {
            resume();
          }
        });
        queue = approval.then(
          () => undefined,
          () => undefined,
        );
        return approval;
      };
    },

    decide(id: string, userId: string, vote: ApprovalClick): ApprovalReply {
      if (consumed.has(id)) return 'ignored';
      const ticket = pending.get(id);
      if (!ticket) return 'expired';
      if (ticket.input.signal.aborted) {
        ticket.finish({ kind: 'cancelled' });
        return 'expired';
      }
      if (performance.now() >= ticket.deadline) {
        ticket.finish({ kind: 'expired' });
        return 'expired';
      }
      if (userId !== ticket.owner && !allowed.has(userId)) return 'forbidden';
      ticket.finish({
        kind: vote === 'approve' ? 'approved' : 'denied',
        userId,
      });
      return 'accepted';
    },

    async drain(): Promise<void> {
      await Promise.allSettled(writes);
    },
  };
}
