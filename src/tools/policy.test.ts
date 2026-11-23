import { expect, it } from 'vitest';

import { resolveToolPolicy } from './policy.js';

it.each([
  [
    [
      { tool: 'notes__*', action: 'ask' },
      { tool: 'notes__list', action: 'auto' },
    ],
    'notes__list',
    'mcp',
    'ask',
  ],
  [
    [
      { tool: 'notes__list', action: 'auto' },
      { tool: 'notes__*', action: 'ask' },
    ],
    'notes__list',
    'mcp',
    'auto',
  ],
  [[{ tool: '*', action: 'ask' }], 'read_file', 'builtin', 'ask'],
  [[{ tool: '*', action: 'auto' }], 'handoff', 'builtin', 'ask'],
  [[{ tool: 'handoff', action: 'auto' }], 'handoff', 'builtin', 'ask'],
  [[{ tool: 'list_dir', action: 'ask' }], 'read_file', 'builtin', 'auto'],
  [[], 'notes__list', 'mcp', 'ask'],
] as const)('resolves %j for %s (%s) to %s', (rules, name, kind, action) => {
  expect(resolveToolPolicy([...rules], name, kind)).toBe(action);
});
