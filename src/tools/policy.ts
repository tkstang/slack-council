import type { ToolsConfig } from '@council/config/schema.js';

/**
 * First matching rule wins. A rule ending in `*` is a raw name prefix, so write
 * `notes__*` for one server: `notes*` would also match a server named
 * `notes_archive`.
 */
export function resolveToolPolicy(
  rules: ToolsConfig['policy'],
  name: string,
  kind: 'builtin' | 'mcp',
): 'auto' | 'ask' {
  const rule = rules.find(({ tool }) =>
    tool.endsWith('*') ? name.startsWith(tool.slice(0, -1)) : name === tool,
  );
  return rule?.action ?? (kind === 'builtin' ? 'auto' : 'ask');
}
