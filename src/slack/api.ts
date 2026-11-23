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

/** Call once. Never retries and never throws. */
export async function callSlack(
  api: SlackApi,
  method: string,
  options: Record<string, unknown>,
): Promise<SlackCall> {
  let response: unknown;
  try {
    response = await api.apiCall(method, options);
  } catch (error) {
    return { ok: false, error: slackErrorCode(error) };
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
