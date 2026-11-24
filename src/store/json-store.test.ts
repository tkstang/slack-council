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
    value: { councils: [], acceptedMessageKeys: [], privateNotes: [] },
  });
  const state: StoredState = {
    councils: [
      {
        id: 'council',
        scope: { channel: 'C1', threadTs: '10.001' },
        convenedAtTs: '10.002',
        owner: 'U1',
        roster: ['guide', 'critic'],
        settings: {
          rounds: 3,
          hopBudget: 2,
          maxTurnsPerChain: 9,
          unaddressed: 'silent',
          seenReaction: 'threads',
          listen: 'settle',
          memberMentions: 'none',
          contextChars: 400,
          replyWords: { default: 100, detailed: 200, max: 300 },
          turnTimeoutMs: 200,
          approvalTimeoutMs: 300_000,
          maxSteps: 5,
        },
      },
    ],
    acceptedMessageKeys: ['C1:10.002', 'C1:10.003'],
    privateNotes: [
      {
        councilId: 'council',
        memberId: 'guide',
        targetTs: '10.002',
        note: 'Check the assumption.',
        createdAtTs: '10.003',
      },
    ],
  };
  expect(await store.save(state)).toMatchObject({ ok: true });
  expect(await createJsonStore(stateDir).load()).toEqual({
    ok: true,
    value: state,
  });

  const next = {
    councils: [],
    acceptedMessageKeys: state.acceptedMessageKeys,
    privateNotes: [],
  };
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
      privateNotes: [],
    }),
  ).toMatchObject({ ok: false, code: 'E_STORE_WRITE' });
});

it('loads pre-listen state with default settings and no private notes', async () => {
  await writeFile(
    join(root, 'councils.json'),
    JSON.stringify({
      councils: [
        {
          id: 'legacy',
          scope: { channel: 'C1' },
          owner: 'U1',
          roster: ['guide'],
          settings: { rounds: 3 },
        },
      ],
      acceptedMessageKeys: ['C1:10.002'],
    }),
  );
  expect(await createJsonStore(root).load()).toMatchObject({
    ok: true,
    value: {
      councils: [
        {
          id: 'legacy',
          settings: {
            rounds: 3,
            listen: 'settle',
            replyWords: { default: 120, detailed: 250, max: 1_000 },
          },
        },
      ],
      acceptedMessageKeys: ['C1:10.002'],
      privateNotes: [],
    },
  });
});
