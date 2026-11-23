import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it, vi } from 'vitest';

import { createMcpManager } from './mcp.js';

it('namespaces and restricts grants, round-trips notes over stdio, and isolates a failed server', async () => {
  const root = await mkdtemp(join(tmpdir(), 'slack-council-mcp-'));
  const diagnostic = vi.fn();
  const mcp = createMcpManager(
    {
      notes: {
        transport: 'stdio',
        command: process.execPath,
        args: [
          fileURLToPath(
            new URL('../../examples/notes-mcp-server.mjs', import.meta.url),
          ),
        ],
        env: { COUNCIL_NOTES_FILE: 'TEST_NOTES' },
      },
      unavailable: {
        transport: 'stdio',
        command: join(root, 'missing-executable'),
        args: [],
        env: {},
      },
    },
    { TEST_NOTES: join(root, 'notes.txt') },
    diagnostic,
  );
  const options = {
    toolCallId: 'notes-test',
    messages: [],
    context: {},
  };
  try {
    await mcp.start();
    expect(diagnostic).toHaveBeenCalledExactlyOnceWith(
      'unavailable',
      'E_MCP_UNAVAILABLE',
    );
    expect(
      Object.keys(mcp.toolsFor(new Set(['notes__list_notes', 'unavailable']))),
    ).toEqual(['notes__list_notes']);
    const tools = mcp.toolsFor(new Set(['notes']));
    expect(Object.keys(tools).toSorted()).toEqual([
      'notes__append_note',
      'notes__list_notes',
    ]);
    expect(
      await tools.notes__append_note?.execute?.(
        { text: 'Round trip' } as never,
        options,
      ),
    ).toMatchObject({ isError: false });
    expect(
      await tools.notes__list_notes?.execute?.({} as never, options),
    ).toMatchObject({ content: [{ type: 'text', text: 'Round trip\n' }] });
  } finally {
    await mcp.close();
    await rm(root, { recursive: true, force: true });
  }
});
