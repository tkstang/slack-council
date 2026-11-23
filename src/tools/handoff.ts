import { randomUUID } from 'node:crypto';

import { HANDOFF_GRANT, type ToolsConfig } from '@council/config/schema.js';
import { failure, success } from '@council/core/result.js';
import { tool, type Tool } from 'ai';
import { z } from 'zod';

import type { createApprovalGate } from './approval.js';
import type { createMcpManager } from './mcp.js';

type Ask = ReturnType<ReturnType<typeof createApprovalGate>['forTurn']>;

const nonblank = z.string().refine((text) => text.trim().length > 0);
const Input = z.strictObject({
  title: nonblank.describe('Title used to name the note'),
  content: nonblank.describe('Full Markdown note body'),
  machine: nonblank.describe('Target machine'),
  project: nonblank.describe('Target project'),
  prompt: nonblank.describe('Short launch prompt'),
});
const WriteReply = z.object({ ok: z.boolean() });
const LaunchReply = z.object({
  key: z.string().min(1).max(2_048),
  operation: z.object({
    id: z.string().min(1).max(2_048),
    status: z.enum([
      'queued',
      'accepted',
      'confirmed',
      'failed',
      'unknown',
      'cancelled',
    ]),
  }),
});

export function createHandoff(
  config: NonNullable<ToolsConfig['handoff']>,
  mcp: Pick<ReturnType<typeof createMcpManager>, 'bindTool'>,
):
  | ((signal: AbortSignal, ask: Ask) => Tool<z.infer<typeof Input>, unknown>)
  | undefined {
  const write = mcp.bindTool(config.write);
  const launch = mcp.bindTool(config.launch);
  if (!write || !launch) return undefined;

  return (signal: AbortSignal, ask: Ask) =>
    tool({
      description:
        'Propose a Markdown note and launch a coding session from it with one human approval. Include the background and work to do in the note.',
      inputSchema: Input,
      async execute({
        title,
        content,
        machine,
        project,
        prompt,
      }): Promise<unknown> {
        const slug = title
          .toLowerCase()
          .replace(/[^a-z0-9]+/gu, '-')
          .replace(/^-|-$/gu, '')
          .slice(0, 80);
        const date = new Date().toISOString().slice(0, 10);
        const path = `${config.folder}/${date}-${slug || 'handoff'}-${randomUUID()}.md`;
        const note = { path, content };
        const target = {
          machine,
          project,
          prompt: `${prompt}\n\nRead the handoff note at: ${path}`,
        };
        const decision = await ask(HANDOFF_GRANT, { ...note, ...target });
        if (!decision.ok) return decision;
        if (decision.value) return decision.value;
        if (signal.aborted)
          return failure('E_TURN_ABORTED', 'Turn was cancelled');

        const writeFailed = (status: 'failed' | 'unknown') => ({
          ...failure(
            'E_TOOL_FAILED',
            status === 'failed'
              ? 'The note write failed. No session was launched.'
              : 'The note write could not be confirmed. No session was launched.',
          ),
          note_path: path,
          write_status: status,
          launch_status: 'not_started',
        });
        try {
          const result = await write(note, signal);
          if (result.isError === true) return writeFailed('failed');
          const reply = WriteReply.safeParse(result.structuredContent);
          if (!reply.success) return writeFailed('unknown');
          if (!reply.data.ok) return writeFailed('failed');
        } catch {
          return writeFailed('unknown');
        }

        const written = { note_path: path, write_status: 'written' };
        if (signal.aborted)
          return {
            ...failure(
              'E_TURN_ABORTED',
              'The note was written. The launch was cancelled.',
            ),
            ...written,
            launch_status: 'not_started',
          };
        const launchUnknown = {
          ...failure(
            'E_TOOL_FAILED',
            'The note was written. The launch outcome is unknown.',
          ),
          ...written,
          launch_status: 'unknown',
        };
        try {
          const result = await launch(target, signal);
          if (result.isError === true)
            return {
              ...failure(
                'E_TOOL_FAILED',
                'The note was written. The launch failed.',
              ),
              ...written,
              launch_status: 'failed',
            };
          const reply = LaunchReply.safeParse(result.structuredContent);
          if (!reply.success) return launchUnknown;
          const { key, operation } = reply.data;
          const launched = {
            ...written,
            launch_status: operation.status,
            operation_id: operation.id,
            session_key: key,
          };
          if (operation.status === 'unknown')
            return { ...launchUnknown, ...launched };
          if (operation.status === 'failed' || operation.status === 'cancelled')
            return {
              ...failure(
                'E_TOOL_FAILED',
                `The note was written. The launch was reported as ${operation.status}.`,
              ),
              ...launched,
            };
          return success(launched);
        } catch {
          return launchUnknown;
        }
      },
    });
}
