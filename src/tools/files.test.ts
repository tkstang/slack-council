import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConfigSchema } from '@council/config/schema.js';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { createFileTools } from './files.js';

let tmp: string;
let root: string;
const options = { toolCallId: 'test', messages: [], context: {} };
const deny = ConfigSchema.shape.tools.parse({}).files.deny;
const unavailable = {
  ok: false,
  code: 'E_PATH_UNAVAILABLE',
  message: 'Path is unavailable',
};

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'slack-council-paths-'));
  root = join(tmp, 'root');
  await mkdir(join(root, '.cfg'), { recursive: true });
  await Promise.all([
    writeFile(join(root, '.cfg', '.env'), 'first\nneedle\n'),
    writeFile(join(root, '.cfg', 'server.key'), 'first\nneedle\n'),
    writeFile(join(root, 'public.txt'), 'first\nneedle\n'),
    writeFile(join(root, '.env'), 'needle'),
    writeFile(join(tmp, 'outside.txt'), 'needle'),
    symlink(join(tmp, 'outside.txt'), join(root, 'escape.txt')),
    symlink(join(root, '.env'), join(root, 'alias.txt')),
    symlink(join(root, 'public.txt'), join(root, '.env.alias')),
  ]);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

it.each([
  ['inside a root', 'root/public.txt', true, true],
  ['outside a root', 'outside.txt', true, false],
  ['parent traversal', 'root/../outside.txt', true, false],
  ['a symlink escaping the root', 'root/escape.txt', true, false],
  ['a denied file', 'root/.env', true, false],
  ['a denied file in a dot-directory', 'root/.cfg/.env', true, false],
  ['a key in a dot-directory', 'root/.cfg/server.key', true, false],
  ['a denied name in another case', 'root/.ENV', true, false],
  ['an alias of a denied file', 'root/alias.txt', true, false],
  ['a denied alias', 'root/.env.alias', true, false],
  ['an absent file', 'root/missing.txt', true, false],
  ['no configured roots', 'root/public.txt', false, false],
] as const)(
  'enforces the read policy for %s',
  async (_case, path, useRoot, readable) => {
    const { read_file } = createFileTools({
      roots: useRoot ? [root] : [],
      deny,
    });
    expect(
      await read_file.execute?.(
        { path: `${tmp}/${path}`, startLine: 2, endLine: 2 },
        options,
      ),
    ).toEqual(readable ? { ok: true, value: 'needle' } : unavailable);
  },
);

it.each([
  ['public.txt', true],
  ['../outside.txt', false],
  ['.env', false],
  ['escape.txt', false],
] as const)(
  'resolves the relative path %s against the root',
  async (path, readable) => {
    const { read_file } = createFileTools({ roots: [root], deny });
    expect(
      await read_file.execute?.({ path, startLine: 2, endLine: 2 }, options),
    ).toEqual(readable ? { ok: true, value: 'needle' } : unavailable);
  },
);

it.each(['search', 'listing'] as const)(
  'filters denied and escaping entries from %s',
  async (mode) => {
    const { list_dir, search_files } = createFileTools({ roots: [root], deny });
    if (mode === 'listing') {
      const listed = await list_dir.execute?.({ path: root }, options);
      expect(listed).toMatchObject({ ok: true, value: { capped: false } });
      // Directory order is not stable; the denied and escaping names must be absent.
      expect(
        (listed as { value: { entries: { name: string }[] } }).value.entries
          .map(({ name }) => name)
          .toSorted(),
      ).toEqual(['.cfg', 'public.txt']);
    } else {
      expect(
        await search_files.execute?.({ path: root, query: 'needle' }, options),
      ).toEqual({
        ok: true,
        value: {
          hits: [{ path: join(root, 'public.txt'), line: 2, text: 'needle' }],
          capped: false,
        },
      });
    }
  },
);

it.each([
  ['binary', Buffer.from([0, 1, 2]), 'E_BINARY_FILE'],
  ['oversized', Buffer.alloc(64 * 1024 + 1, 'x'), 'E_FILE_TOO_LARGE'],
] as const)('refuses an allowed %s file', async (_kind, bytes, code) => {
  const path = join(root, 'unsupported.txt');
  await writeFile(path, bytes);
  const { read_file } = createFileTools({ roots: [root], deny });
  expect(
    await read_file.execute?.({ path, startLine: 1, endLine: 1 }, options),
  ).toMatchObject({ ok: false, code });
});
