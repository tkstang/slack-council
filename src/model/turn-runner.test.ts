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
    const { councilId, member, prompt, signal } = input();
    await expect(
      runner.runListen({ councilId, member, prompt, signal }),
    ).resolves.toEqual({
      ok: true,
      value: 'PASS',
    });
    expect(toolsFor).not.toHaveBeenCalled();
    expect(model.doGenerateCalls).toHaveLength(1);
    const call = model.doGenerateCalls[0];
    expect(call?.tools ?? []).toEqual([]);
    expect(call?.maxOutputTokens).toBe(600);
    expect(call?.providerOptions).toMatchObject({
      openaiCompatible: { reasoningEffort: 'low' },
    });
  });

  it('blocks a tool call containing a private note before execution', async () => {
    const privateNote = 'Check the assumption.';
    const model = new MockLanguageModelV4({
      doGenerate: [
        {
          content: [
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
          finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
          usage,
          warnings: [],
        },
        {
          content: [{ type: 'text', text: 'Here is the answer.' }],
          finishReason: finish,
          usage,
          warnings: [],
        },
      ],
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
      input({ maxSteps: 2, privateNoteText: [privateNote] }),
    );
    expect(result).toEqual({ ok: true, value: 'Here is the answer.' });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]).toEqual({ text: 'Public follow-up.' });

    // A one-step turn could not reply after a tool call, so it gets no tools.
    const single = textModel('Only a reply');
    await createTurnRunner({
      models: () => single,
      toolsFor: () => ({
        use_text: tool({
          inputSchema: z.object({ text: z.string() }),
          execute,
        }),
      }),
    }).runTurn(input({ maxSteps: 1 }));
    expect(single.doGenerateCalls[0]?.tools ?? []).toEqual([]);
  });

  it('sends effort and council caching options through a dotted provider name', async () => {
    const bodies: unknown[] = [];
    const onCacheRead = vi.fn();
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
            usage: {
              prompt_tokens: 1200,
              completion_tokens: 1,
              prompt_tokens_details: {
                cached_tokens: bodies.length === 3 ? 1024 : 0,
              },
            },
          }),
          { status, headers: { 'content-type': 'application/json' } },
        );
      },
    });
    const runner = createTurnRunner({
      models: (_, id) => provider(id),
      onCacheRead,
    });
    const {
      member: baseMember,
      prompt: { system, user: prefix },
    } = input();
    const transcript = '\n<transcript>Later turn</transcript>';
    const turn = input({
      member: {
        ...baseMember,
        provider: 'proxy.prod',
        model: 'gpt-6-luna',
      },
      prompt: {
        system,
        user: prefix + transcript,
        cachePrefixLength: prefix.length,
      },
    });
    const key =
      'd0f631ca1ddba8db3bcfcb9e057cdc98d0379f1bee00e75a545147a27dadd982'; // SHA-256 of c1.

    await expect(runner.runTurn(turn)).resolves.toEqual({
      ok: true,
      value: 'ok',
    });
    expect(bodies[0]).toMatchObject({
      model: 'gpt-6-luna',
      reasoning_effort: 'high',
      prompt_cache_key: key,
      messages: [
        { role: 'system', content: turn.prompt.system },
        { role: 'user', content: turn.prompt.user },
      ],
    });

    const { effort: _effort, ...member } = turn.member;
    await runner.runTurn({ ...turn, member, councilId: 'c2' });
    expect(bodies[1]).not.toHaveProperty('reasoning_effort');
    expect(bodies[1]).toHaveProperty(
      'prompt_cache_key',
      '9c0abe51c6e6655d81de2d044d4fb194931f058c0426c67c7285d8f5657ed64a',
    );
    expect(onCacheRead).not.toHaveBeenCalled();

    await expect(
      runner.runListen({
        councilId: turn.councilId,
        member: { ...member, model: 'claude-haiku-5-5' },
        prompt: turn.prompt,
        signal: turn.signal,
      }),
    ).resolves.toEqual({ ok: true, value: 'ok' });
    expect(bodies[2]).toMatchObject({
      model: 'claude-haiku-5-5',
      reasoning_effort: 'low',
      prompt_cache_key: key,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: prefix,
              cache_control: { type: 'ephemeral' },
            },
            { type: 'text', text: transcript },
          ],
        },
      ],
    });
    expect(onCacheRead).toHaveBeenCalledExactlyOnceWith({
      cacheKey: key,
      memberId: member.id,
      model: 'claude-haiku-5-5',
      turnId: undefined,
      cachedInputTokens: 1024,
    });

    status = 400;
    await expect(runner.runTurn(turn)).resolves.toMatchObject({
      ok: false,
      code: 'E_TURN_FAILED',
    });
    expect(bodies).toHaveLength(4);
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
    expect(JSON.stringify(model.doGenerateCalls[1]?.prompt.at(-1))).toContain(
      'no tool calls left',
    );
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
