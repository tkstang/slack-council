import { z } from 'zod';

const nonempty = z.string().trim().min(1);
const envName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const httpUrl = z.url({ protocol: /^https?$/ }).refine((value) => {
  const url = URL.parse(value);
  return url?.username === '' && url.password === '';
}, 'Use a URL without inline credentials');

export const MEMBER_HANDLE = /^[a-z][a-z0-9-]*$/;
export const FILES_GRANT = 'files';
export const SLACK_HISTORY_GRANT = 'slack_history';
export const MCP_TOOL_SEPARATOR = '__';
const mcpServerName = /^[a-zA-Z0-9-]+(?:_[a-zA-Z0-9-]+)*$/u;
const mcpServerKey = z
  .string()
  .regex(mcpServerName)
  .refine(
    (name) => name !== FILES_GRANT && name !== SLACK_HISTORY_GRANT,
    'MCP server name is reserved',
  );

const ProviderSchema = z.strictObject({
  baseURL: httpUrl,
  apiKeyEnv: envName,
});
export type ProviderConfig = z.infer<typeof ProviderSchema>;

const MemberSchema = z.strictObject({
  name: nonempty,
  avatar: z.union([
    z.strictObject({ emoji: z.string().regex(/^:[a-zA-Z0-9_+-]+:$/) }),
    z.strictObject({ url: httpUrl }),
  ]),
  provider: nonempty,
  model: nonempty,
  effort: z.string().min(1).optional(),
  persona: z.string().min(1),
  tools: z.array(nonempty).default([]),
});
export type MemberConfig = z.infer<typeof MemberSchema>;

const nonNegative = z.int().min(0);
const positive = z.int().min(1);
const DEFAULT_CONTEXT_CHARS = 24_000;

export const CouncilSettingsSchema = z.strictObject({
  rounds: positive.default(2),
  hopBudget: nonNegative.default(6),
  maxTurnsPerChain: positive.default(24),
  unaddressed: z.enum(['silent', 'council']).default('silent'),
  listen: z.enum(['settle', 'off']).default('settle'),
  contextChars: positive.default(DEFAULT_CONTEXT_CHARS),
  turnTimeoutMs: positive.max(2_147_483_647).default(60_000),
  approvalTimeoutMs: positive.max(2_147_483_647).default(300_000),
  maxSteps: positive.default(8),
});

const McpServerSchema = z.discriminatedUnion('transport', [
  z.strictObject({
    transport: z.literal('stdio'),
    command: nonempty,
    args: z.array(z.string()).default([]),
    env: z.record(envName, envName).default({}),
  }),
  z.strictObject({
    transport: z.literal('http'),
    url: httpUrl,
    headersEnv: z.record(nonempty, envName).default({}),
  }),
]);

const DEFAULT_DENY = [
  '**/.env',
  '**/.env.*',
  '**/.ssh/**',
  '**/.aws/**',
  '**/.config/gcloud/**',
  '**/.azure/**',
  '**/*.pem',
  '**/*.key',
  '**/*.p12',
  '**/*.keychain*',
];

const ToolsSchema = z.strictObject({
  files: z
    .strictObject({
      roots: z.array(nonempty).default([]),
      deny: z
        .array(
          nonempty.regex(
            /^[^[\]{}!\\]+$/u,
            'Deny globs support only *, ** and ?',
          ),
        )
        .default(DEFAULT_DENY),
    })
    .prefault({}),
  mcpServers: z.record(mcpServerKey, McpServerSchema).default({}),
  policy: z
    .array(
      z.strictObject({
        tool: nonempty.regex(
          /^[^*]+\*?$|^\*$/u,
          'Use a name or a prefix ending in *',
        ),
        action: z.enum(['auto', 'ask']),
      }),
    )
    .default([]),
});
export type ToolsConfig = z.infer<typeof ToolsSchema>;

function atLeastOneEntry(entries: Record<string, unknown>): boolean {
  return Object.keys(entries).length > 0;
}

export const ConfigSchema = z.strictObject({
  providers: z.record(nonempty, ProviderSchema).refine(atLeastOneEntry),
  members: z.record(z.string(), MemberSchema).refine(atLeastOneEntry),
  presets: z.record(nonempty, z.array(nonempty).min(1)),
  defaultPreset: nonempty,
  slack: z.strictObject({ allowedUsers: z.array(nonempty).min(1) }),
  // Persisted council settings can still contain older, smaller budgets.
  council: CouncilSettingsSchema.extend({
    contextChars: positive.min(1_000).default(DEFAULT_CONTEXT_CHARS),
  }).prefault({}),
  tools: ToolsSchema.prefault({}),
  stateDir: nonempty.default('.council'),
});
export type Config = z.infer<typeof ConfigSchema>;
