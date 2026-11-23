import type { ToolsConfig } from '@council/config/schema.js';

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
