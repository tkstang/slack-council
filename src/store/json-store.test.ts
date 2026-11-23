import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { StoredState } from '@council/core/ports.js';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { createJsonStore } from './json-store.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'slack-council-store-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it('round-trips councils and dedupe order across store instances and replaces the prior file', async () => {
  const stateDir = join(root, 'state');
  const store = createJsonStore(stateDir);
  expect(await store.load()).toEqual({
    ok: true,
    value: { councils: [], acceptedMessageKeys: [] },
  });
  const state: StoredState = {
    councils: [
      {
        id: 'council',
        scope: { channel: 'C1', threadTs: '10.001' },
        owner: 'U1',
        roster: ['guide', 'critic'],
        settings: {
          rounds: 3,
          hopBudget: 2,
          maxTurnsPerChain: 9,
          unaddressed: 'silent',
          contextChars: 400,
          turnTimeoutMs: 200,
          maxSteps: 5,
        },
      },
    ],
    acceptedMessageKeys: ['C1:10.002', 'C1:10.003'],
  };
  expect(await store.save(state)).toMatchObject({ ok: true });
  expect(await createJsonStore(stateDir).load()).toEqual({
    ok: true,
    value: state,
  });

  const next = { councils: [], acceptedMessageKeys: state.acceptedMessageKeys };
  expect(await store.save(next)).toMatchObject({ ok: true });
  expect(await createJsonStore(stateDir).load()).toEqual({
    ok: true,
    value: next,
  });
  expect(await readdir(stateDir)).toEqual(['councils.json']);
});

it('returns a coded failure for structurally invalid persisted state', async () => {
  await writeFile(
    join(root, 'councils.json'),
    '{"councils":[{}],"acceptedMessageKeys":[]}',
  );
  expect(await createJsonStore(root).load()).toMatchObject({
    ok: false,
    code: 'E_INVALID_STATE',
  });
});

it('returns a coded failure when the state directory is blocked by a file', async () => {
  const blocked = join(root, 'file');
  await writeFile(blocked, 'existing content');
  expect(
    await createJsonStore(blocked).save({
      councils: [],
      acceptedMessageKeys: [],
    }),
  ).toMatchObject({ ok: false, code: 'E_STORE_WRITE' });
});
