import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { ProviderConfig } from '@council/config/schema.js';
import type { TurnInput, TurnRunner } from '@council/core/ports.js';
import {
  failure,
  success,
  type Failure,
  type Result,
} from '@council/core/result.js';
import {
  APICallError,
  generateText,
  isStepCount,
  type LanguageModel,
  type ToolSet,
} from 'ai';

/** Resolves a configured provider name and model id to an AI SDK model. */
export type ModelFactory = (provider: string, model: string) => LanguageModel;

export interface TurnRunnerOptions {
  readonly models: ModelFactory;
  /** Resolve tools for each turn. Returns no tools by default. */
  readonly toolsFor?: (input: TurnInput) => ToolSet | undefined;
}

/**
 * Builds one OpenAI-compatible provider per config entry. Every key is read
 * from the environment variable the config names; the value never appears in
 * a result.
 */
export function createProviderModels(
  providers: Readonly<Record<string, ProviderConfig>>,
  env: Readonly<Record<string, string | undefined>>,
): Result<ModelFactory> {
  const built = new Map<string, ReturnType<typeof createOpenAICompatible>>();
  for (const [name, { baseURL, apiKeyEnv }] of Object.entries(providers)) {
    const apiKey = env[apiKeyEnv];
    if (apiKey === undefined || apiKey === '') {
      return failure(
        'E_MISSING_ENV',
        `Provider ${name} needs the environment variable ${apiKeyEnv}`,
        `Set ${apiKeyEnv} before starting the app.`,
      );
    }
    built.set(name, createOpenAICompatible({ name, baseURL, apiKey }));
  }
  return success((provider, model) => {
    const create = built.get(provider);
    if (!create) throw new Error(`Unknown provider: ${provider}`);
    return create(model);
  });
}

function abortFailure(signal: AbortSignal): Failure {
  return signal.reason === 'E_TURN_TIMEOUT'
    ? failure('E_TURN_TIMEOUT', 'Turn timed out')
    : failure('E_TURN_ABORTED', 'Turn was cancelled');
}

function modelFailure(error: unknown): Failure {
  // Provider messages can echo request content, so only the status is kept.
  if (APICallError.isInstance(error) && error.statusCode !== undefined) {
    return failure(
      'E_TURN_FAILED',
      `Model call failed with HTTP ${error.statusCode}`,
    );
  }
  return failure('E_TURN_FAILED', 'Model call failed');
}

export function createTurnRunner({
  models,
  toolsFor,
}: TurnRunnerOptions): TurnRunner {
  return {
    async runTurn(input) {
      const { member, prompt, maxSteps, signal } = input;
      if (signal.aborted) return abortFailure(signal);
      // A provider that ignores the signal must not hold the turn open.
      const aborted = Promise.withResolvers<Failure>();
      const onAbort = () => aborted.resolve(abortFailure(signal));
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        const tools = toolsFor?.(input);
        const generation = generateText({
          model: models(member.provider, member.model),
          system: prompt.system,
          // The role brief travels in the user message: some routes ignore `system`.
          prompt: prompt.user,
          stopWhen: isStepCount(maxSteps),
          abortSignal: signal,
          // The turn contract: nothing is retried.
          maxRetries: 0,
          ...(tools === undefined ? {} : { tools }),
          ...(member.effort === undefined
            ? {}
            : {
                // The provider-agnostic key: a provider-name key is cut at
                // its first dot, so `proxy.prod` would drop the effort.
                providerOptions: {
                  openaiCompatible: { reasoningEffort: member.effort },
                },
              }),
        }).then(({ text }) => success(text));
        const result = await Promise.race([aborted.promise, generation]);
        if (signal.aborted) {
          generation.catch(() => undefined);
          return abortFailure(signal);
        }
        return result;
      } catch (error) {
        return signal.aborted ? abortFailure(signal) : modelFailure(error);
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
    },
  };
}
