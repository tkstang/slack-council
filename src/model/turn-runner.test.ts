import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { TurnInput } from '@council/core/ports.js';
import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';

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

    status = 500;
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
