import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { TurnInput } from '@council/core/ports.js';
import { APICallError, tool } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createProviderModels, createTurnRunner } from './turn-runner.js';

const finish = { unified: 'stop', raw: 'stop' } as const;
const usage = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

function textModel(text: string): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: 'text', text }],
      finishReason: finish,
      usage,
      warnings: [],
    },
  });
}

function input(overrides: Partial<TurnInput> = {}): TurnInput {
  return {
    councilId: 'c1',
    chainId: 'chain-1',
    turnId: 'turn-1',
    scope: { channel: 'C1', threadTs: '1.000001' },
    member: {
      id: 'ada',
      name: 'Ada',
      avatar: { emoji: ':owl:' },
      provider: 'proxy',
      model: 'model-a',
      effort: 'high',
      persona: 'p',
      tools: [],
    },
    prompt: {
      system: 'system brief',
      user: '<council_role>r</council_role>',
    },
    maxSteps: 3,
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('createTurnRunner', () => {
  it('returns the model text and sends the role in the user message', async () => {
    const model = textModel('Hello from Ada');
    const seen: string[] = [];
    const runner = createTurnRunner({
      models: (provider, id) => {
        seen.push(`${provider}/${id}`);
        return model;
      },
    });

    await expect(runner.runTurn(input())).resolves.toEqual({
      ok: true,
      value: 'Hello from Ada',
    });
    expect(seen).toEqual(['proxy/model-a']);
    const call = model.doGenerateCalls[0];
    expect(call?.prompt).toEqual([
      { role: 'system', content: 'system brief' },
      {
        role: 'user',
        content: [{ type: 'text', text: '<council_role>r</council_role>' }],
      },
    ]);
    expect(call?.tools ?? []).toEqual([]);
  });

  it('runs a capped listen at low effort without resolving turn tools', async () => {
    const model = textModel('PASS');
    const toolsFor = vi.fn(() => ({}));
    const runner = createTurnRunner({ models: () => model, toolsFor });
    const { member, prompt, signal } = input();
    await expect(runner.runListen({ member, prompt, signal })).resolves.toEqual(
      {
        ok: true,
        value: 'PASS',
      },
    );
    expect(toolsFor).not.toHaveBeenCalled();
    expect(model.doGenerateCalls).toHaveLength(1);
    const call = model.doGenerateCalls[0];
    expect(call?.tools ?? []).toEqual([]);
    expect(call?.maxOutputTokens).toBe(600);
    expect(call?.providerOptions).toEqual({
      openaiCompatible: { reasoningEffort: 'low' },
    });
  });

  it('blocks a tool call containing a private note before execution', async () => {
    const privateNote = 'Check the assumption.';
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [
          { type: 'text', text: 'Here is the answer.' },
          {
            type: 'tool-call',
            toolCallId: 'private',
            toolName: 'use_text',
            input: JSON.stringify({ text: privateNote }),
          },
          {
            type: 'tool-call',
            toolCallId: 'public',
            toolName: 'use_text',
            input: JSON.stringify({ text: 'Public follow-up.' }),
          },
        ],
        finishReason: finish,
        usage,
        warnings: [],
      },
    });
    const execute = vi.fn(async (_args: { text: string }) => 'Done');
    const runner = createTurnRunner({
      models: () => model,
      toolsFor: () => ({
        use_text: tool({
          inputSchema: z.object({ text: z.string() }),
          execute,
        }),
      }),
    });
    const result = await runner.runTurn(
      input({ maxSteps: 1, privateNoteText: [privateNote] }),
    );
    expect(result.ok).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]).toEqual({ text: 'Public follow-up.' });
  });

  it('sends effort in the request body for a dotted provider name, once', async () => {
    const bodies: unknown[] = [];
    let status = 200;
    const provider = createOpenAICompatible({
      name: 'proxy.prod',
      baseURL: 'https://models.example.com/v1',
      apiKey: 'test',
      fetch: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'ok' },
                finish_reason: 'stop',
              },
            ],
          }),
          { status, headers: { 'content-type': 'application/json' } },
        );
      },
    });
    const runner = createTurnRunner({ models: (_, id) => provider(id) });

    await expect(runner.runTurn(input())).resolves.toEqual({
      ok: true,
      value: 'ok',
    });
    expect(bodies[0]).toMatchObject({
      model: 'model-a',
      reasoning_effort: 'high',
    });

    const { effort: _effort, ...member } = input().member;
    await runner.runTurn(input({ member }));
    expect(bodies[1]).not.toHaveProperty('reasoning_effort');

    status = 400;
    await expect(runner.runTurn(input())).resolves.toMatchObject({
      ok: false,
      code: 'E_TURN_FAILED',
    });
    expect(bodies).toHaveLength(3);
  });

  it('honours the abort signal with the timeout or cancel code', async () => {
    // Never settles, like a provider that ignores the signal.
    const hanging = new MockLanguageModelV4({
      doGenerate: () => new Promise(() => undefined),
    });
    const runner = createTurnRunner({ models: () => hanging });

    for (const [reason, code] of [
      ['E_TURN_TIMEOUT', 'E_TURN_TIMEOUT'],
      ['E_TURN_ABORTED', 'E_TURN_ABORTED'],
    ] as const) {
      const controller = new AbortController();
      const turn = runner.runTurn(input({ signal: controller.signal }));
      controller.abort(reason);
      await expect(turn).resolves.toMatchObject({ ok: false, code });
    }

    const done = new AbortController();
    done.abort('E_TURN_ABORTED');
    await expect(
      runner.runTurn(input({ signal: done.signal })),
    ).resolves.toMatchObject({ ok: false, code: 'E_TURN_ABORTED' });
  });

  it('maps a provider error to E_TURN_FAILED without its message', async () => {
    const broken = new MockLanguageModelV4({
      doGenerate: () => {
        throw new APICallError({
          message: 'secret request echo',
          url: 'https://models.example.com/v1/chat/completions',
          requestBodyValues: {},
          statusCode: 401,
          isRetryable: false,
        });
      },
    });
    const result = await createTurnRunner({ models: () => broken }).runTurn(
      input(),
    );
    expect(result).toEqual({
      ok: false,
      code: 'E_TURN_FAILED',
      message: 'Model call failed with HTTP 401',
    });
  });

  it('retries a retryable provider error once and keeps its status', async () => {
    vi.useFakeTimers();
    try {
      const busy = new MockLanguageModelV4({
        doGenerate: () => {
          throw new APICallError({
            message: 'busy',
            url: 'https://models.example.com/v1/chat/completions',
            requestBodyValues: {},
            statusCode: 503,
            isRetryable: true,
          });
        },
      });
      const pending = createTurnRunner({ models: () => busy }).runTurn(input());
      await vi.runAllTimersAsync();
      await expect(pending).resolves.toEqual({
        ok: false,
        code: 'E_TURN_FAILED',
        message: 'Model call failed with HTTP 503',
      });
      expect(busy.doGenerateCalls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails a reply that was cut off at the output limit', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: 'text', text: 'Half a sent' }],
        finishReason: { unified: 'length', raw: 'length' },
        usage,
        warnings: [],
      },
    });
    const result = await createTurnRunner({ models: () => model }).runTurn(
      input(),
    );
    expect(result).toMatchObject({ ok: false, code: 'E_TURN_FAILED' });
  });

  it('forbids tool calls on the last step so the turn ends with a reply', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call',
            toolName: 'look',
            input: '{}',
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage,
        warnings: [],
      },
    });
    const runner = createTurnRunner({
      models: () => model,
      toolsFor: () => ({
        look: tool({ inputSchema: z.object({}), execute: async () => 'seen' }),
      }),
    });
    await runner.runTurn(input({ maxSteps: 2 }));
    expect(model.doGenerateCalls.map((call) => call.toolChoice?.type)).toEqual([
      'auto',
      'none',
    ]);
  });
});

describe('createProviderModels', () => {
  const providers = {
    proxy: { baseURL: 'https://models.example.com/v1', apiKeyEnv: 'KEY_A' },
  };

  it('names a missing key variable without a value', () => {
    expect(createProviderModels(providers, {})).toMatchObject({
      ok: false,
      code: 'E_MISSING_ENV',
      message: expect.stringContaining('KEY_A'),
    });
  });
});
