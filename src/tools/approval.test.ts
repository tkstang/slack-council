import { ConfigSchema } from '@council/config/schema.js';
import type {
  ApprovalPort,
  ApprovalRequest,
  TurnInput,
} from '@council/core/ports.js';
import { success, type Result } from '@council/core/result.js';
import { tool } from 'ai';
import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createApprovalGate } from './approval.js';
import { createMemberTools } from './member-tools.js';

function fixture(allowedUsers = ['U1', 'U2']) {
  const postApproval = vi.fn<ApprovalPort['postApproval']>(async () =>
    success({ ts: '2.000' }),
  );
  const updateApproval = vi.fn<ApprovalPort['updateApproval']>(async () =>
    success(undefined),
  );
  const gate = createApprovalGate(
    { postApproval, updateApproval },
    allowedUsers,
  );
  const controller = new AbortController();
  const input: TurnInput = {
    councilId: 'council',
    chainId: 'chain',
    turnId: 'turn',
    scope: { channel: 'C1', threadTs: '1.000' },
    member: {
      id: 'ada',
      name: 'Ada',
      avatar: { emoji: ':owl:' },
      provider: 'test',
      model: 'test',
      persona: 'Explain',
      tools: ['notes__write'],
    },
    maxSteps: 4,
    signal: controller.signal,
    prompt: { system: '', user: '' },
    approval: {
      owner: 'U1',
      timeoutMs: 20,
      suspendTimeout: () => () => undefined,
    },
  };
  const perform = vi.fn((args: { text: string }) => success(args.text));
  const write = tool({
    description: 'Write a note',
    inputSchema: z.object({ text: z.string() }),
    execute: perform,
  });
  const toolsFor = createMemberTools({
    config: ConfigSchema.shape.tools.parse({}),
    slack: { fetchMessages: async () => success([]) },
    members: [input.member],
    mcp: { toolsFor: () => ({ notes__write: write }) },
    approvals: gate,
  });
  const options = { toolCallId: 'approval-test', messages: [], context: {} };
  const execute = toolsFor(input)?.notes__write?.execute;
  if (!execute) throw new Error('Missing test tool');
  return {
    ...gate,
    controller,
    input,
    postApproval,
    updateApproval,
    perform,
    call(args = { text: 'a note' }) {
      return execute(args as never, options);
    },
    async posted(index = 0): Promise<ApprovalRequest> {
      await vi.advanceTimersByTimeAsync(0);
      const post = postApproval.mock.calls[index];
      if (!post) throw new Error('Expected approval post');
      expect(post[0]).toEqual(input.scope);
      return post[1];
    },
  };
}

afterEach(() => vi.useRealTimers());

it('refuses a council owner who is no longer on the allow-list', async () => {
  vi.useFakeTimers();
  const f = fixture(['U2']);
  const call = f.call({ text: 'x' });
  const post = await f.posted();
  expect(f.decide(post.id, 'U1', 'approve')).toBe('forbidden');
  expect(f.decide(post.id, 'U2', 'deny')).toBe('accepted');
  expect(await call).toMatchObject({ ok: false, code: 'E_APPROVAL_DENIED' });
});

it('shows a plain one-line argument as a readable line', async () => {
  vi.useFakeTimers();
  const f = fixture();
  const call = f.call({ text: 'desktop test one' });
  const post = await f.posted();
  expect(post.preview).toBe('text: desktop test one');
  f.decide(post.id, 'U1', 'deny');
  await call;
});

it('rejects an unpermitted click, then a single owner approval runs the exact approved arguments', async () => {
  vi.useFakeTimers();
  const f = fixture();
  const args = { text: `<!here>\n${'x'.repeat(700)}` };
  const original = args.text;
  const call = f.call(args);
  const post = await f.posted();
  expect(post).toMatchObject({ memberName: 'Ada', tool: 'notes__write' });
  // A multi-line value stays JSON-quoted, so it cannot pass for extra fields.
  expect(post.preview).toBe(`text: ${JSON.stringify(original)}`);
  args.text = 'changed after the request';
  expect(f.decide(post.id, 'U3', 'deny')).toBe('forbidden');
  expect(f.perform).not.toHaveBeenCalled();
  expect(f.decide(post.id, 'U1', 'approve')).toBe('accepted');
  expect(f.decide(post.id, 'U2', 'approve')).toBe('expired');
  expect(await call).toEqual(success(original));
  expect(f.perform).toHaveBeenCalledExactlyOnceWith(
    { text: original },
    expect.anything(),
  );
  await f.drain();
  expect(f.updateApproval).toHaveBeenCalledExactlyOnceWith(
    f.input.scope,
    '2.000',
    post,
    { kind: 'approved', userId: 'U1' },
  );
});

it('returns denial errors and suppresses a third ask from parallel calls in the same turn', async () => {
  vi.useFakeTimers();
  const f = fixture();
  const calls = [f.call(), f.call(), f.call()];
  const first = await f.posted();
  expect(f.decide(first.id, 'U2', 'deny')).toBe('accepted');
  const second = await f.posted(1);
  expect(f.decide(second.id, 'U2', 'deny')).toBe('accepted');
  for (const outcome of await Promise.all(calls)) {
    expect(outcome).toMatchObject({ ok: false, code: 'E_APPROVAL_DENIED' });
  }
  expect(f.postApproval).toHaveBeenCalledTimes(2);
  expect(f.perform).not.toHaveBeenCalled();
  await f.drain();
  expect(f.updateApproval).toHaveBeenLastCalledWith(
    f.input.scope,
    '2.000',
    second,
    { kind: 'denied', userId: 'U2' },
  );
});

it('expires a request and recognizes a stale click after restart', async () => {
  vi.useFakeTimers();
  const f = fixture();
  const call = f.call();
  const post = await f.posted();
  expect(fixture().decide(post.id, 'U1', 'approve')).toBe('expired');
  await vi.advanceTimersByTimeAsync(20);
  expect(await call).toMatchObject({ ok: false, code: 'E_APPROVAL_EXPIRED' });
  expect(f.decide(post.id, 'U1', 'approve')).toBe('expired');
  expect(f.perform).not.toHaveBeenCalled();
  await f.drain();
  expect(f.updateApproval).toHaveBeenCalledExactlyOnceWith(
    f.input.scope,
    '2.000',
    post,
    { kind: 'expired' },
  );
});

it.each([false, true])(
  'cancels without running the tool when approval arrived first: %s',
  async (approveFirst) => {
    vi.useFakeTimers();
    const f = fixture();
    const inFlight = Promise.withResolvers<Result<{ ts: string }>>();
    f.postApproval.mockReturnValueOnce(inFlight.promise);
    const call = f.call();
    const post = await f.posted();
    if (approveFirst)
      expect(f.decide(post.id, 'U1', 'approve')).toBe('accepted');
    f.controller.abort('E_TURN_ABORTED');
    expect(await call).toMatchObject({ ok: false, code: 'E_TURN_ABORTED' });
    expect(f.perform).not.toHaveBeenCalled();
    inFlight.resolve(success({ ts: '2.000' }));
    await f.drain();
    expect(f.updateApproval).toHaveBeenCalledExactlyOnceWith(
      f.input.scope,
      '2.000',
      post,
      approveFirst ? { kind: 'approved', userId: 'U1' } : { kind: 'cancelled' },
    );
  },
);
