import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import { StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';
import {
  MCP_TOOL_SEPARATOR,
  type ToolsConfig,
} from '@council/config/schema.js';
import { MAX_GUIDANCE_CHARS } from '@council/core/types.js';
import type { ToolSet } from 'ai';

const START_TIMEOUT = 10_000;
const TRUNCATION_MARKER = '\n[Orientation truncated]';
type Env = Readonly<Record<string, string | undefined>>;
type Server = ToolsConfig['mcpServers'][string];

function boundOrientation(text: string): string {
  if (text.length <= MAX_GUIDANCE_CHARS) return text;
  const prefix = text
    .slice(0, MAX_GUIDANCE_CHARS - TRUNCATION_MARKER.length)
    .replace(/[\uD800-\uDBFF]$/u, '');
  return prefix + TRUNCATION_MARKER;
}

function isGranted(
  grants: ReadonlySet<string>,
  server: string,
  qualified: string,
): boolean {
  return grants.has(server) || grants.has(qualified);
}

function resolveEnv(
  mapping: Record<string, string>,
  env: Env,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(mapping).map(([name, from]) => {
      const value = env[from];
      if (typeof value !== 'string' || value === '')
        throw new Error('Missing MCP environment');
      return [name, value];
    }),
  );
}

function transport(config: Server, env: Env) {
  if (config.transport === 'stdio') {
    return new StdioMCPTransport({
      command: config.command,
      args: config.args,
      env: resolveEnv(config.env, env),
      stderr: 'ignore',
    });
  }
  return {
    type: 'http' as const,
    url: config.url,
    headers: resolveEnv(config.headersEnv, env),
  };
}

export function createMcpManager(
  servers: ToolsConfig['mcpServers'],
  env: Env,
  onUnavailable: (server: string, code: 'E_MCP_UNAVAILABLE') => void,
  onOrientationMissing: (server: string) => void,
) {
  const connected = new Map<
    string,
    { client: MCPClient; tools: ToolSet; orientation?: string }
  >();
  const startup = new AbortController();
  let connecting: Promise<void> | undefined;
  let closing: Promise<void> | undefined;

  async function connect(server: string, config: Server): Promise<void> {
    let client: MCPClient | undefined;
    const signal = AbortSignal.any([
      startup.signal,
      AbortSignal.timeout(START_TIMEOUT),
    ]);
    try {
      client = await createMCPClient({
        transport: transport(config, env),
        initializationOptions: { signal },
        clientName: 'slack-council',
        maxRetries: 0,
        // Transport errors can include arguments, headers or server stderr.
        onUncaughtError: () => undefined,
      });
      const instructions = config.orientation ? client.instructions : undefined;
      const orientation = instructions?.trim()
        ? boundOrientation(instructions)
        : undefined;

      const tools = [];
      const cursors = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await client.listTools({
          params: { cursor },
          options: { signal },
        });
        tools.push(
          ...page.tools.filter(({ name }) =>
            /^[a-zA-Z0-9_-]{1,64}$/u.test(name),
          ),
        );
        cursor = page.nextCursor;
        if (cursor !== undefined) {
          if (cursors.has(cursor)) throw new Error('Repeated MCP cursor');
          cursors.add(cursor);
        }
      } while (cursor !== undefined);

      connected.set(server, {
        client,
        tools: client.toolsFromDefinitions({ tools }),
        orientation,
      });
      if (config.orientation && orientation === undefined)
        onOrientationMissing(server);
    } catch {
      await client?.close().catch(() => undefined);
      if (!startup.signal.aborted) onUnavailable(server, 'E_MCP_UNAVAILABLE');
    }
  }

  return {
    start(): Promise<void> {
      if (closing) return closing;
      connecting ??= Promise.all(
        Object.entries(servers).map(([server, config]) =>
          connect(server, config),
        ),
      ).then(() => undefined);
      return connecting;
    },

    toolsFor(grants: ReadonlySet<string>): ToolSet {
      const granted: ToolSet = Object.create(null);
      for (const [server, { tools }] of connected) {
        for (const [name, definition] of Object.entries(tools)) {
          const qualified = `${server}${MCP_TOOL_SEPARATOR}${name}`;
          if (isGranted(grants, server, qualified))
            granted[qualified] = definition;
        }
      }
      return granted;
    },

    orientationFor(
      memberGrants: readonly string[],
    ): ReadonlyMap<string, string> {
      const grants = new Set(memberGrants);
      const orientations = new Map<string, string>();
      // Connections complete concurrently. Render blocks in config order.
      for (const server of Object.keys(servers)) {
        const entry = connected.get(server);
        if (
          entry?.orientation !== undefined &&
          Object.keys(entry.tools).some((name) =>
            isGranted(grants, server, `${server}${MCP_TOOL_SEPARATOR}${name}`),
          )
        )
          orientations.set(server, entry.orientation);
      }
      return orientations;
    },

    close(): Promise<void> {
      closing ??= (async () => {
        startup.abort();
        try {
          await connecting;
        } finally {
          await Promise.allSettled(
            [...connected.values()].map(({ client }) => client.close()),
          );
          connected.clear();
        }
      })();
      return closing;
    },
  };
}
