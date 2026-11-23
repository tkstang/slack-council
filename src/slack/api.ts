import { webApi } from '@slack/bolt';

/**
 * The slice of a Slack `WebClient` the adapter uses. A real client satisfies it
 * directly; tests pass a fake.
 */
export interface SlackApi {
  apiCall(method: string, options?: Record<string, unknown>): Promise<unknown>;
}

export type SlackCall =
  | { readonly ok: true; readonly value: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly error: string };

const SAFE_CODE = /^[a-z0-9_]{1,80}$/u;

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function safeCode(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_CODE.test(value) ? value : undefined;
}

/**
 * Reduce a thrown Slack client error to a fixed code. Client errors can carry
 * the original request, including the token header, so nothing else is kept.
 */
export function slackErrorCode(error: unknown): string {
  return (
    safeCode(field(field(error, 'data'), 'error')) ??
    safeCode(field(error, 'code')) ??
    'unknown_error'
  );
}

/** The longest Retry-After a write waits out before giving up. */
export const MAX_RATE_LIMIT_WAIT_MS = 30_000;

function rateLimitWaitMs(error: unknown): number | undefined {
  if (field(error, 'code') !== webApi.ErrorCode.RateLimitedError) return;
  const seconds = field(error, 'retryAfter');
  if (typeof seconds !== 'number' || !(seconds >= 0)) return;
  const wait = seconds * 1_000;
  return wait <= MAX_RATE_LIMIT_WAIT_MS ? wait : undefined;
}

/**
 * Call once and never throw. With `retryRateLimited`, a call Slack refused as
 * rate limited is sent once more after the wait Slack asked for: a refusal is
 * a definite "not done", unlike a timeout, so resending cannot duplicate it.
 */
export async function callSlack(
  api: SlackApi,
  method: string,
  options: Record<string, unknown>,
  { retryRateLimited = false }: { readonly retryRateLimited?: boolean } = {},
): Promise<SlackCall> {
  let response: unknown;
  try {
    response = await api.apiCall(method, options);
  } catch (error) {
    const wait = retryRateLimited ? rateLimitWaitMs(error) : undefined;
    if (wait === undefined) return { ok: false, error: slackErrorCode(error) };
    await new Promise((resolve) => setTimeout(resolve, wait));
    return callSlack(api, method, options);
  }
  if (typeof response !== 'object' || response === null) {
    return { ok: false, error: 'invalid_response' };
  }
  if (field(response, 'ok') !== true) {
    return {
      ok: false,
      error: safeCode(field(response, 'error')) ?? 'unknown_error',
    };
  }
  return { ok: true, value: response as Record<string, unknown> };
}

/** A write gets one attempt: its outcome is unknown after a timeout. */
export const WRITE_TIMEOUT_MS = 15_000;
export const READ_TIMEOUT_MS = 10_000;

export interface SlackClientOptions {
  readonly logger: webApi.WebClientOptions['logger'];
  readonly fetch?: webApi.WebClientOptions['fetch'];
  readonly readTimeoutMs?: number;
  readonly writeTimeoutMs?: number;
}

/**
 * Build the read and write clients. Both time out; reads retry twice with a
 * short backoff. Writes are never resent by the client; `callSlack` resends
 * one that Slack refused as rate limited.
 */
export function createSlackClients(
  token: string,
  {
    logger,
    fetch,
    readTimeoutMs = READ_TIMEOUT_MS,
    writeTimeoutMs = WRITE_TIMEOUT_MS,
  }: SlackClientOptions,
): { readonly reader: SlackApi; readonly writer: SlackApi } {
  const shared = { logger, ...(fetch === undefined ? {} : { fetch }) };
  return {
    reader: new webApi.WebClient(token, {
      ...shared,
      timeout: readTimeoutMs,
      retryConfig: {
        retries: 2,
        factor: 2,
        minTimeout: 500,
        maxTimeout: 2_000,
      },
      // A Retry-After wait can outlast the timeout and stall every reader.
      rejectRateLimitedCalls: true,
    }),
    writer: new webApi.WebClient(token, {
      ...shared,
      timeout: writeTimeoutMs,
      retryConfig: { retries: 0 },
      rejectRateLimitedCalls: true,
    }),
  };
}
