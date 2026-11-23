import { describe, expect, it, vi } from 'vitest';

import { callSlack } from './api.js';

const limited = { code: 'slack_webapi_rate_limited_error', retryAfter: 0 };

describe('callSlack', () => {
  it('resends a rate-limited call once only when asked to', async () => {
    const apiCall = vi
      .fn()
      .mockRejectedValueOnce(limited)
      .mockResolvedValueOnce({ ok: true, ts: '1.000001' });
    await expect(
      callSlack(
        { apiCall },
        'chat.postMessage',
        {},
        { retryRateLimited: true },
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(apiCall).toHaveBeenCalledTimes(2);

    const refused = vi.fn().mockRejectedValue(limited);
    await expect(
      callSlack({ apiCall: refused }, 'conversations.replies', {}),
    ).resolves.toEqual({
      ok: false,
      error: 'slack_webapi_rate_limited_error',
    });
    expect(refused).toHaveBeenCalledTimes(1);
  });
});
