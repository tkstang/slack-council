import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it, vi } from 'vitest';

import { createMcpManager } from './mcp.js';

it('scopes tools and orientation to grants, round-trips notes over stdio, and isolates a failed server', async () => {
  const root = await mkdtemp(join(tmpdir(), 'slack-council-mcp-'));
  const diagnostic = vi.fn();
  const missingOrientation = vi.fn();
  const notesServer = {
    transport: 'stdio' as const,
    command: process.execPath,
    args: [
      fileURLToPath(
        new URL('../../examples/notes-mcp-server.mjs', import.meta.url),
      ),
    ],
    env: { COUNCIL_NOTES_FILE: 'TEST_NOTES' },
  };
  const mcp = createMcpManager(
    {
      notes: { ...notesServer, orientation: true },
      unmarked: { ...notesServer, orientation: false },
      unavailable: {
        transport: 'stdio',
        orientation: true,
        command: join(root, 'missing-executable'),
        args: [],
        env: {},
      },
    },
    { TEST_NOTES: join(root, 'notes.txt') },
    diagnostic,
    missingOrientation,
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
    expect(missingOrientation).not.toHaveBeenCalled();
    const orientation = mcp.orientationFor(['notes']);
    expect(orientation.get('notes')).toContain('notes server check phrase');
    expect(mcp.orientationFor(['notes__list_notes'])).toEqual(orientation);
    expect(
      mcp.orientationFor(['notes__missing', 'unmarked', 'unavailable']).size,
    ).toBe(0);
    expect(
      Object.keys(mcp.toolsFor(new Set(['notes__list_notes', 'unavailable']))),
    ).toEqual(['notes__list_notes']);
    expect(Object.keys(mcp.toolsFor(new Set(['handoff'])))).toEqual([]);
    expect(mcp.bindTool({ server: 'notes', tool: 'missing' })).toBeUndefined();
    expect(
      mcp.bindTool({ server: 'unavailable', tool: 'append_note' }),
    ).toBeUndefined();
    const tools = mcp.toolsFor(new Set(['notes']));
    expect(Object.keys(tools).toSorted()).toEqual([
      'notes__append_note',
      'notes__list_notes',
    ]);
    const append = mcp.bindTool({ server: 'notes', tool: 'append_note' });
    expect(
      await append?.({ text: 'Round trip' }, new AbortController().signal),
    ).toMatchObject({ isError: false });
    expect(
      await tools.notes__list_notes?.execute?.({} as never, options),
    ).toMatchObject({ content: [{ type: 'text', text: 'Round trip\n' }] });
  } finally {
    await mcp.close();
    await rm(root, { recursive: true, force: true });
  }
});
