import type { CallToolResult } from '@ai-sdk/mcp';
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
import { createHandoff } from './handoff.js';
import { createMemberTools } from './member-tools.js';

const proposedHandoff = {
  title: '../Send/Review\\draft.md',
  content: '# Summary\n\nInspect the proposed patch.',
  machine: 'machine',
  project: 'project',
  prompt: 'Review the patch.',
};
const reply = (structuredContent: Record<string, unknown>): CallToolResult => ({
  content: [],
  structuredContent,
});
type McpCall = (
  args: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<CallToolResult>;

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
      tools: ['notes__write', 'handoff'],
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
  const writeHandoff = vi.fn<McpCall>(async () => reply({ ok: true }));
  const launch = vi.fn<McpCall>(async () =>
    reply({
      key: 't3code:machine/session',
      operation: { id: 'operation', status: 'confirmed' },
    }),
  );
  const config = ConfigSchema.shape.tools.parse({
    policy: [
      { tool: 'notes__write', action: 'ask' },
      { tool: '*', action: 'auto' },
    ],
    handoff: {
      folder: 'Handoffs/Drafts',
      write: { server: 'vault', tool: 'vault_write' },
      launch: { server: 'sessions', tool: 'launch' },
    },
  });
  if (!config.handoff) throw new Error('Missing handoff config');
  const handoff = createHandoff(config.handoff, {
    bindTool: ({ tool: name }) =>
      name === 'vault_write' ? writeHandoff : launch,
  });
  const toolsFor = createMemberTools({
    config,
    slack: { fetchMessages: async () => success([]) },
    members: [input.member],
    mcp: { toolsFor: () => ({ notes__write: write }) },
    approvals: gate,
    handoff,
  });
  const options = { toolCallId: 'approval-test', messages: [], context: {} };
  const tools = toolsFor(input);
  const execute = tools?.notes__write?.execute;
  const executeHandoff = tools?.handoff?.execute;
  if (!execute || !executeHandoff) throw new Error('Missing test tool');
  return {
    ...gate,
    controller,
    input,
    postApproval,
    updateApproval,
    perform,
    writeHandoff,
    launch,
    call(args = { text: 'a note' }) {
      return execute(args as never, options);
    },
    handoff(args = proposedHandoff) {
      return executeHandoff(args as never, options);
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
  // A string that reads as JSON, or holds a blank that is not a space, is
  // quoted, so it cannot pass for another value.
  for (const [text, shown] of [
    ['[]', 'text: "[]"'],
    ['foo\u00a0bar', String.raw`text: "foo\u00a0bar"`],
  ] as const) {
    const g = fixture();
    const second = g.call({ text });
    const quoted = await g.posted();
    expect(quoted.preview).toBe(shown);
    g.decide(quoted.id, 'U1', 'deny');
    await second;
  }
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

it('asks once under an auto policy, then writes under the folder and launches with the approved prompt', async () => {
  vi.useFakeTimers();
  const f = fixture();
  const content = `# Summary\n\n${'x'.repeat(5_000)}`;
  const call = f.handoff({ ...proposedHandoff, content });
  const post = await f.posted();
  const path = /^path: (.+)$/mu.exec(post.preview)?.[1];
  expect(path).toMatch(
    /^Handoffs\/Drafts\/\d{4}-\d{2}-\d{2}-send-review-draft-md-[0-9a-f-]{36}\.md$/u,
  );
  const prompt = `Review the patch.\n\nRead the handoff note at: ${path}`;
  expect(post.preview).toContain(`content: ${JSON.stringify(content)}`);
  expect(post.preview).toContain(`prompt: ${JSON.stringify(prompt)}`);
  expect(f.writeHandoff).not.toHaveBeenCalled();
  expect(f.launch).not.toHaveBeenCalled();
  expect(f.decide(post.id, 'U1', 'approve')).toBe('accepted');
  expect(await call).toMatchObject({
    ok: true,
    value: {
      note_path: path,
      launch_status: 'confirmed',
      session_key: 't3code:machine/session',
    },
  });
  expect(f.writeHandoff).toHaveBeenCalledExactlyOnceWith(
    { path, content },
    f.input.signal,
  );
  expect(f.launch).toHaveBeenCalledExactlyOnceWith(
    { machine: 'machine', project: 'project', prompt },
    f.input.signal,
  );
  expect(f.writeHandoff).toHaveBeenCalledBefore(f.launch);
  expect(f.postApproval).toHaveBeenCalledTimes(1);
});

it.each(['error result', 'unconfirmed write', 'transport failure'] as const)(
  'does not launch after a %s',
  async (kind) => {
    vi.useFakeTimers();
    const f = fixture();
    if (kind === 'error result')
      f.writeHandoff.mockResolvedValueOnce({
        ...reply({ ok: true }),
        isError: true,
      });
    else if (kind === 'unconfirmed write')
      f.writeHandoff.mockResolvedValueOnce(reply({}));
    else f.writeHandoff.mockRejectedValueOnce(new Error('connection lost'));
    const call = f.handoff();
    f.decide((await f.posted()).id, 'U1', 'approve');
    expect(await call).toMatchObject({
      ok: false,
      code: 'E_TOOL_FAILED',
      write_status: kind === 'error result' ? 'failed' : 'unknown',
      launch_status: 'not_started',
    });
    expect(f.launch).not.toHaveBeenCalled();
  },
);

it.each(['failed', 'unknown', 'cancelled'] as const)(
  'reports the written path when the launch is %s',
  async (launchStatus) => {
    vi.useFakeTimers();
    const f = fixture();
    if (launchStatus === 'failed')
      f.launch.mockResolvedValueOnce(
        reply({
          key: 't3code:machine/session',
          operation: { id: 'operation', status: 'failed' },
        }),
      );
    else if (launchStatus === 'unknown')
      f.launch.mockRejectedValueOnce(new Error('connection lost'));
    else
      f.writeHandoff.mockImplementationOnce(async () => {
        f.controller.abort();
        return reply({ ok: true });
      });
    const call = f.handoff();
    const post = await f.posted();
    f.decide(post.id, 'U1', 'approve');
    expect(await call).toMatchObject({
      ok: false,
      code: launchStatus === 'cancelled' ? 'E_TURN_ABORTED' : 'E_TOOL_FAILED',
      note_path: /^path: (.+)$/mu.exec(post.preview)?.[1],
      write_status: 'written',
      launch_status:
        launchStatus === 'cancelled' ? 'not_started' : launchStatus,
    });
    expect(f.writeHandoff).toHaveBeenCalledTimes(1);
    expect(f.launch).toHaveBeenCalledTimes(
      launchStatus === 'cancelled' ? 0 : 1,
    );
  },
);

it('returns only the allowed user’s changes and requires a new decision for the revised handoff', async () => {
  vi.useFakeTimers();
  const f = fixture();
  const original = f.handoff();
  const first = await f.posted();
  expect(f.checkChange(first.id, 'U1')).toBe('accepted');
  expect(f.decide(first.id, 'U3', { changesRequested: 'Not allowed' })).toBe(
    'forbidden',
  );
  expect(
    f.decide(first.id, 'U1', { changesRequested: 'Shorten the note.' }),
  ).toBe('accepted');
  expect(await original).toEqual({ changes_requested: 'Shorten the note.' });
  await f.drain();
  expect(f.updateApproval).toHaveBeenCalledWith(f.input.scope, '2.000', first, {
    kind: 'changes_requested',
    userId: 'U1',
    text: 'Shorten the note.',
  });

  const revised = f.handoff({ ...proposedHandoff, content: '# Shorter' });
  const second = await f.posted(1);
  expect(second.id).not.toEqual(first.id);
  expect(f.decide(first.id, 'U1', { changesRequested: 'Stale edit' })).toBe(
    'expired',
  );
  expect(f.writeHandoff).not.toHaveBeenCalled();
  expect(f.launch).not.toHaveBeenCalled();
  expect(f.decide(second.id, 'U1', 'approve')).toBe('accepted');
  expect(await revised).toMatchObject({ ok: true });
});

it.each([
  ['expired', 'E_APPROVAL_EXPIRED'],
  ['stopped', 'E_TURN_ABORTED'],
  ['rejected', 'E_APPROVAL_DENIED'],
] as const)(
  'refuses a Change submission after the card was %s',
  async (ended, code) => {
    vi.useFakeTimers();
    const f = fixture();
    const call = f.handoff();
    const post = await f.posted();
    expect(f.checkChange(post.id, 'U1')).toBe('accepted');
    if (ended === 'expired') await vi.advanceTimersByTimeAsync(20);
    else if (ended === 'stopped') f.controller.abort();
    else f.decide(post.id, 'U1', 'deny');
    expect(f.decide(post.id, 'U1', { changesRequested: 'Too late' })).toBe(
      'expired',
    );
    expect(await call).toMatchObject({ ok: false, code });
    expect(f.writeHandoff).not.toHaveBeenCalled();
    expect(f.launch).not.toHaveBeenCalled();
  },
);

it('refuses to post or run a handoff that cannot fit in full', async () => {
  const f = fixture();
  expect(
    await f.handoff({ ...proposedHandoff, content: 'x'.repeat(8_000) }),
  ).toMatchObject({
    ok: false,
    code: 'E_TOOL_FAILED',
    message: expect.stringContaining('shorter note'),
  });
  expect(f.postApproval).not.toHaveBeenCalled();
  expect(f.writeHandoff).not.toHaveBeenCalled();
  expect(f.launch).not.toHaveBeenCalled();
});
