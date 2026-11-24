import { randomUUID } from 'node:crypto';

import { HANDOFF_GRANT } from '@council/config/schema.js';
import type {
  ApprovalOutcome,
  ApprovalPort,
  ApprovalRequest,
  TurnInput,
} from '@council/core/ports.js';
import { failure, success, type Result } from '@council/core/result.js';

type ApprovalDecision =
  | 'approve'
  | 'deny'
  | { readonly changesRequested: string };
type ApprovalRefusal = 'forbidden' | 'expired';
type ApprovalResult = Result<void | { readonly changes_requested: string }>;

const denied = failure('E_APPROVAL_DENIED', 'Tool approval was denied');
const expired = failure('E_APPROVAL_EXPIRED', 'Tool approval expired');
const cancelled = failure('E_TURN_ABORTED', 'Turn was cancelled');
const postFailed = failure('E_SLACK', 'Could not post tool approval');
const MAX_PREVIEW = 2_500;
const MAX_HANDOFF_PREVIEW = 8_000;

interface Pending {
  readonly input: TurnInput;
  readonly deadline: number;
  readonly handoff: boolean;
  finish(outcome: ApprovalOutcome | undefined): void;
}

// Characters that do not show as themselves: controls, format characters,
// anything Unicode marks as ignorable, and every blank other than a space.
const HIDDEN = String.raw`\u007f-\u009f\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u2800\u3000\p{Cf}\p{Default_Ignorable_Code_Point}`;

const escapeHidden = (text: string) =>
  text.replace(
    new RegExp(`[${HIDDEN}]`, 'gu'),
    // Standard JSON escapes, one per UTF-16 unit.
    (char) =>
      char
        .split('')
        .map((unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`)
        .join(''),
  );

const BARE_KEY = /^[\w.-]+$/u;
// One line, no edge spaces, no backslash and nothing invisible.
const PLAIN_LINE = new RegExp(
  String.raw`^[^\s\p{C}\\${HIDDEN}](?:[^\p{C}\\${HIDDEN}]*[^\s\p{C}\\${HIDDEN}])?$`,
  'u',
);

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * A string is shown without quotes only when it cannot be misread: a plain
 * line that is not itself JSON. So `[]` the string is quoted and `[]` the
 * empty list is not, and the two never look alike.
 */
const NEGATIVE_ZERO = `-0:${randomUUID()}`;

// JSON writes -0 as 0; the approver must see the value the tool will get.
const toJson = (value: unknown) =>
  (
    JSON.stringify(value, (_, item: unknown) =>
      Object.is(item, -0) ? NEGATIVE_ZERO : item,
    ) ?? 'null'
  ).replaceAll(`"${NEGATIVE_ZERO}"`, '-0');

const showValue = (value: unknown) =>
  typeof value === 'string' && PLAIN_LINE.test(value) && !isJson(value)
    ? value
    : toJson(value);

/**
 * The exact arguments as the approver will see them: one `name: value` line
 * per top-level field, with invisible characters escaped.
 */
function preview(args: unknown): string {
  const fields =
    typeof args === 'object' && args !== null && !Array.isArray(args)
      ? Object.entries(args)
      : undefined;
  const text =
    fields === undefined
      ? toJson(args)
      : fields.length === 0
        ? '(no arguments)'
        : fields
            .map(
              ([key, value]) =>
                `${BARE_KEY.test(key) ? key : JSON.stringify(key)}: ${showValue(value)}`,
            )
            .join('\n');
  return escapeHidden(text);
}

export function createApprovalGate(
  port: ApprovalPort,
  allowedUsers: readonly string[],
  onWriteFailure: () => void = () => undefined,
) {
  const allowed = new Set(allowedUsers);
  const pending = new Map<string, Pending>();
  const writes = new Set<Promise<void>>();

  function request(
    input: TurnInput,
    timeoutMs: number,
    tool: string,
    args: unknown,
  ): Promise<ApprovalResult> {
    if (input.signal.aborted) return Promise.resolve(cancelled);
    const handoff = tool === HANDOFF_GRANT;
    const shown = preview(args);
    if (shown.length > (handoff ? MAX_HANDOFF_PREVIEW : MAX_PREVIEW))
      return Promise.resolve(
        failure(
          'E_TOOL_FAILED',
          handoff
            ? 'The handoff is too long to show in full. Submit a shorter note.'
            : 'Arguments are too large to approve',
        ),
      );
    const id = randomUUID();
    const post: ApprovalRequest = {
      id,
      memberName: input.member.name,
      tool,
      preview: shown,
    };
    const outcome = Promise.withResolvers<ApprovalOutcome | undefined>();
    const deadline = performance.now() + timeoutMs;

    function finish(decision: ApprovalOutcome | undefined) {
      if (!pending.delete(id)) return;
      clearTimeout(timer);
      input.signal.removeEventListener('abort', abort);
      outcome.resolve(decision);
    }

    const abort = () => finish({ kind: 'cancelled' });
    const timer = setTimeout(() => finish({ kind: 'expired' }), timeoutMs);
    pending.set(id, { input, deadline, handoff, finish });
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
        case 'changes_requested':
          return success({ changes_requested: decision.text });
        case 'expired':
          return expired;
        case 'cancelled':
          return cancelled;
        default:
          return postFailed;
      }
    });
  }

  function eligible(
    id: string,
    userId: string,
    change: boolean,
  ): Pending | ApprovalRefusal {
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
    // The allow-list alone decides: an owner removed from it loses approval too.
    if (!allowed.has(userId) || (change && !ticket.handoff)) return 'forbidden';
    return ticket;
  }

  return {
    forTurn(input: TurnInput) {
      let denials = 0;
      let queue = Promise.resolve();
      return (tool: string, args: unknown): Promise<ApprovalResult> => {
        // AI SDK can issue several tool calls together. Apply the denial budget
        // before posting the next request from this turn.
        const approval = queue.then(async () => {
          if (input.signal.aborted) return cancelled;
          if (denials >= 2) return denied;
          if (!input.approval)
            return failure('E_TOOL_FAILED', 'Turn cannot request approval');
          const { timeoutMs, suspendTimeout } = input.approval;
          const resume = suspendTimeout();
          try {
            const decision = await request(input, timeoutMs, tool, args);
            // An unanswered or unpostable request counts like a denial, so a
            // member cannot hold a turn open by asking again and again.
            if (
              !decision.ok &&
              (decision.code === 'E_APPROVAL_DENIED' ||
                decision.code === 'E_APPROVAL_EXPIRED' ||
                decision.code === 'E_SLACK')
            )
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

    checkChange(id: string, userId: string) {
      const ticket = eligible(id, userId, true);
      return typeof ticket === 'string' ? ticket : 'accepted';
    },

    decide(id: string, userId: string, vote: ApprovalDecision) {
      const ticket = eligible(id, userId, typeof vote === 'object');
      if (typeof ticket === 'string') return ticket;
      ticket.finish(
        typeof vote === 'object'
          ? { kind: 'changes_requested', userId, text: vote.changesRequested }
          : { kind: vote === 'approve' ? 'approved' : 'denied', userId },
      );
      return 'accepted';
    },

    async drain(): Promise<void> {
      await Promise.allSettled(writes);
    },
  };
}
