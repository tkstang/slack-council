import {
  FILES_GRANT,
  SLACK_HISTORY_GRANT,
  type ToolsConfig,
} from '@council/config/schema.js';
import type { SlackPort, TurnInput } from '@council/core/ports.js';
import { failure } from '@council/core/result.js';
import type { Member } from '@council/core/types.js';
import type { ToolSet } from 'ai';

import type { createApprovalGate } from './approval.js';
import { createFileTools } from './files.js';
import type { createMcpManager } from './mcp.js';
import { resolveToolPolicy } from './policy.js';
import { createSlackHistoryTool } from './slack-history.js';

export function createMemberTools({
  config,
  slack,
  members,
  mcp,
  approvals,
}: {
  readonly config: ToolsConfig;
  readonly slack: Pick<SlackPort, 'fetchMessages'>;
  readonly members: readonly Member[];
  readonly mcp: Pick<ReturnType<typeof createMcpManager>, 'toolsFor'>;
  readonly approvals: Pick<ReturnType<typeof createApprovalGate>, 'forTurn'>;
}) {
  const files = createFileTools(config.files);
  return (input: TurnInput): ToolSet | undefined => {
    const grants = new Set(input.member.tools);
    const builtins: ToolSet = {
      ...(grants.has(FILES_GRANT) ? files : {}),
      ...(grants.has(SLACK_HISTORY_GRANT)
        ? {
            [SLACK_HISTORY_GRANT]: createSlackHistoryTool(
              slack,
              input,
              members,
            ),
          }
        : {}),
    };
    const delegated = mcp.toolsFor(grants);
    const ask = approvals.forTurn(input);
    const tools: ToolSet = Object.create(null);
    for (const [name, definition] of Object.entries({
      ...builtins,
      ...delegated,
    })) {
      const execute = definition.execute;
      if (!execute) continue;
      const requiresApproval =
        resolveToolPolicy(
          config.policy,
          name,
          Object.hasOwn(builtins, name) ? 'builtin' : 'mcp',
        ) === 'ask';
      tools[name] = {
        ...definition,
        async execute(args: unknown, options) {
          try {
            const exactArgs = requiresApproval ? structuredClone(args) : args;
            if (requiresApproval) {
              const decision = await ask(name, exactArgs);
              if (!decision.ok) return decision;
            }
            if (input.signal.aborted)
              return failure('E_TURN_ABORTED', 'Turn was cancelled');
            // The SDK already parsed the arguments with this tool’s input schema.
            return await execute(exactArgs as never, {
              ...options,
              abortSignal: input.signal,
            });
          } catch {
            return input.signal.aborted
              ? failure('E_TURN_ABORTED', 'Turn was cancelled')
              : failure('E_TOOL_FAILED', 'Tool execution failed');
          }
        },
      };
    }
    return Object.keys(tools).length > 0 ? tools : undefined;
  };
}
