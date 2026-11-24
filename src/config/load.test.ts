import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadConfig, parseConfig } from './load.js';

function config() {
  return {
    providers: {
      sample: {
        baseURL: 'https://models.example.com/v1',
        apiKeyEnv: 'MODEL_KEY',
      },
    },
    members: {
      reviewer: {
        name: 'Reviewer',
        avatar: { url: 'https://images.example.com/reviewer.png' },
        provider: 'sample',
        model: 'gpt-6-luna',
        persona: {
          title: 'Evidence reviewer',
          instructions: 'Review the evidence.',
        },
        effort: ' future-level ',
      },
    },
    presets: { review: ['reviewer'] },
    defaultPreset: 'review',
    slack: { allowedUsers: ['U1'] },
  };
}

describe('configuration', () => {
  it('applies defaults while preserving model effort and deferring credential lookup', () => {
    expect(parseConfig(JSON.stringify(config()))).toMatchObject({
      ok: true,
      value: {
        council: {
          unaddressed: 'silent',
          seenReaction: 'threads',
          listen: 'settle',
          memberMentions: 'none',
          rounds: 2,
          hopBudget: 6,
          approvalTimeoutMs: 300_000,
          replyWords: { default: 120, detailed: 250, max: 1_000 },
        },
        members: {
          reviewer: {
            effort: ' future-level ',
            persona: config().members.reviewer.persona,
            tools: [],
          },
        },
        tools: {
          files: { roots: [], deny: expect.arrayContaining(['**/.env']) },
        },
      },
    });
  });

  it.each([
    ['', 'E_EMPTY_INPUT'],
    ['{oops', 'E_INVALID_INPUT'],
    ['{}', 'E_INVALID_INPUT'],
  ])('reports a coded failure for JSON input %j', (input, code) => {
    expect(parseConfig(input)).toMatchObject({ ok: false, code });
  });

  it.each(['council', 'bad_handle', 'Uppercase', '__proto__'])(
    'rejects the member handle %s',
    (id) => {
      const input = config();
      expect(
        parseConfig(
          JSON.stringify({
            ...input,
            members: { [id]: input.members.reviewer },
          }),
        ),
      ).toMatchObject({ ok: false, code: 'E_INVALID_MEMBER_ID' });
    },
  );

  it('checks preset and provider references and the default preset', () => {
    const input = config();
    expect(
      parseConfig(
        JSON.stringify({ ...input, presets: { review: ['missing'] } }),
      ),
    ).toMatchObject({ ok: false, code: 'E_UNKNOWN_MEMBER' });
    expect(
      parseConfig(
        JSON.stringify({
          ...input,
          providers: { other: input.providers.sample },
        }),
      ),
    ).toMatchObject({ ok: false, code: 'E_UNKNOWN_PROVIDER' });
    expect(
      parseConfig(JSON.stringify({ ...input, defaultPreset: 'missing' })),
    ).toMatchObject({ ok: false, code: 'E_UNKNOWN_PRESET' });
  });

  it('requires an allowlist and validates URL, secret references, limits and tools', () => {
    const input = config();
    for (const invalid of [
      { slack: { allowedUsers: [] } },
      { providers: { sample: { baseURL: 'invalid', apiKeyEnv: 'MODEL_KEY' } } },
      {
        providers: {
          sample: {
            baseURL: 'https://a:b@models.example.com',
            apiKeyEnv: 'MODEL_KEY',
          },
        },
      },
      {
        providers: {
          sample: {
            baseURL: 'https://models.example.com',
            apiKeyEnv: 'literal key',
          },
        },
      },
      { council: { hopBudget: -1 } },
      { council: { listen: 'every-post' } },
      { council: { approvalTimeoutMs: 0 } },
      { council: { contextChars: 999 } },
      { council: { instructions: '   ' } },
      { council: { replyWords: { default: 0, detailed: 250, max: 1_000 } } },
      {
        council: { replyWords: { default: 120, detailed: 250.5, max: 1_000 } },
      },
      { council: { replyWords: { default: 251, detailed: 250, max: 1_000 } } },
      {
        council: { replyWords: { default: 120, detailed: 1_001, max: 1_000 } },
      },
      {
        members: {
          reviewer: {
            ...input.members.reviewer,
            persona: 'Review the evidence.',
          },
        },
      },
      { tools: { files: { roots: [false] } } },
      { tools: { files: { deny: 'glob' } } },
      {
        tools: {
          mcpServers: { remote: { transport: 'http', command: 'mcp' } },
        },
      },
      {
        tools: {
          mcpServers: {
            local: { transport: 'stdio', command: 'mcp', orientation: 'true' },
          },
        },
      },
      { tools: { policy: [{ tool: 'read_file', action: 'allow' }] } },
      { tools: { policy: [{ tool: 'read_*file', action: 'ask' }] } },
    ]) {
      expect(
        parseConfig(JSON.stringify({ ...input, ...invalid })),
      ).toMatchObject({ ok: false, code: 'E_INVALID_INPUT' });
    }
  });

  it('accepts ordered approval rules and both MCP transports', () => {
    const tools = {
      files: { roots: ['/reference'], deny: ['**/private/**'] },
      mcpServers: {
        local: {
          transport: 'stdio',
          command: 'mcp',
          env: { TOKEN: 'LOCAL_TOKEN' },
        },
        remote: {
          transport: 'http',
          orientation: true,
          url: 'https://mcp.example.com',
          headersEnv: { Authorization: 'REMOTE_TOKEN' },
        },
      },
      policy: [
        { tool: 'local__*', action: 'ask' },
        { tool: 'read_file', action: 'auto' },
      ],
    };
    expect(parseConfig(JSON.stringify({ ...config(), tools }))).toMatchObject({
      ok: true,
      value: {
        tools: {
          ...tools,
          mcpServers: {
            local: { ...tools.mcpServers.local, orientation: false },
            remote: tools.mcpServers.remote,
          },
        },
      },
    });
  });

  it.each([
    [['files', 'slack_history', 'notes', 'notes__append_note'], true],
    [['unknown'], false],
    [['other__append_note'], false],
    [['notes__'], false],
    [['notes__*'], false],
  ] as const)('validates member tool grants %j', (grants, ok) => {
    const input = config();
    const parsed = parseConfig(
      JSON.stringify({
        ...input,
        members: { reviewer: { ...input.members.reviewer, tools: grants } },
        tools: {
          mcpServers: { notes: { transport: 'stdio', command: 'mcp' } },
        },
      }),
    );
    expect(parsed).toMatchObject(
      ok ? { ok: true } : { ok: false, code: 'E_UNKNOWN_TOOL_GRANT' },
    );
  });

  it('reports a coded read failure from the filesystem boundary', async () => {
    expect(
      await loadConfig(join(tmpdir(), 'missing-parent\0', 'config.json')),
    ).toMatchObject({ ok: false, code: 'E_CONFIG_READ' });
  });

  it.each([
    ['relative', '# Brief\n', undefined],
    ['absolute', '# Brief\n', undefined],
    ['missing', undefined, 'E_CONFIG_READ'],
    ['directory', undefined, 'E_CONFIG_READ'],
    ['blank', ' \n', 'E_EMPTY_INPUT'],
    ['oversized', 'x'.repeat(8_001), 'E_FILE_TOO_LARGE'],
  ] as const)(
    'loads or rejects a %s instructions file',
    async (kind, contents, code) => {
      const directory = await mkdtemp(join(tmpdir(), 'council-guidance-'));
      const path = join(directory, 'config.json');
      const instructions = join(directory, 'instructions.md');
      try {
        if (kind === 'directory') await mkdir(instructions);
        if (contents !== undefined) await writeFile(instructions, contents);
        await writeFile(
          path,
          JSON.stringify({
            ...config(),
            council: {
              instructions:
                kind === 'absolute' ? instructions : 'instructions.md',
            },
          }),
        );
        expect(await loadConfig(path)).toMatchObject(
          code === undefined
            ? { ok: true, value: { instructionsText: contents } }
            : { ok: false, code },
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
