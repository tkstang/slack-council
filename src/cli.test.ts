import { expect, it } from 'vitest';

import { run } from './cli.js';

it('validates the shipped example without dumping config to stdout', async () => {
  expect(
    await run(['validate', '--config', 'council.config.example.json']),
  ).toEqual({
    exitCode: 0,
    envelope: { ok: true, command: 'validate', data: { valid: true } },
  });
});

it.each([[], ['validate', '--config'], ['validate', '--typo', 'a.json']])(
  'rejects incomplete or unknown arguments %j',
  async (...args) => {
    expect(await run(args)).toMatchObject({
      exitCode: 1,
      envelope: {
        ok: false,
        code: 'E_INVALID_INPUT',
        hint: expect.any(String),
      },
    });
  },
);

it('provides machine-readable help', async () => {
  expect(await run(['--help'])).toMatchObject({
    exitCode: 0,
    envelope: {
      ok: true,
      data: { usage: expect.stringContaining('validate --config') },
    },
  });
});
