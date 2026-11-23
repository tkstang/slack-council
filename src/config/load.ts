import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

import { failure, success, type Result } from '@council/core/result.js';
import { MAX_GUIDANCE_CHARS } from '@council/core/types.js';

import {
  ConfigSchema,
  FILES_GRANT,
  MCP_TOOL_SEPARATOR,
  MEMBER_HANDLE,
  SLACK_HISTORY_GRANT,
  type Config,
} from './schema.js';

export type LoadedConfig = Config & {
  /** Runtime text read from council.instructions. */
  readonly instructionsText?: string;
};

export function parseConfig(input: string): Result<Config> {
  if (!input.trim()) {
    return failure(
      'E_EMPTY_INPUT',
      'Config file is empty',
      'Provide a JSON config object.',
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(input);
  } catch {
    return failure('E_INVALID_INPUT', 'Config file is not valid JSON');
  }

  // Validate source keys before record parsing, which omits prototype keys.
  if (typeof raw === 'object' && raw !== null && 'members' in raw) {
    const { members } = raw;
    if (
      typeof members === 'object' &&
      members !== null &&
      !Array.isArray(members)
    ) {
      for (const id of Object.keys(members)) {
        if (!MEMBER_HANDLE.test(id) || id === 'council') {
          return failure('E_INVALID_MEMBER_ID', `Invalid member handle: ${id}`);
        }
      }
    }
  }

  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first?.path.join('.') || '<root>';
    return failure(
      'E_INVALID_INPUT',
      `Invalid config at ${path}: ${first?.message ?? 'invalid value'}`,
    );
  }

  const config = parsed.data;
  for (const [id, member] of Object.entries(config.members)) {
    if (!Object.hasOwn(config.providers, member.provider)) {
      return failure(
        'E_UNKNOWN_PROVIDER',
        `Member ${id} names an unknown provider: ${member.provider}`,
      );
    }
    for (const grant of member.tools) {
      if (grant === FILES_GRANT || grant === SLACK_HISTORY_GRANT) continue;
      const separator = grant.indexOf(MCP_TOOL_SEPARATOR);
      const server = separator === -1 ? grant : grant.slice(0, separator);
      const tool =
        separator === -1
          ? undefined
          : grant.slice(separator + MCP_TOOL_SEPARATOR.length);
      if (
        !Object.hasOwn(config.tools.mcpServers, server) ||
        (tool !== undefined && !/^[a-zA-Z0-9_-]+$/u.test(tool))
      ) {
        return failure(
          'E_UNKNOWN_TOOL_GRANT',
          `Member ${id} names an unknown tool grant: ${grant}`,
        );
      }
    }
  }
  for (const [preset, roster] of Object.entries(config.presets)) {
    for (const id of roster) {
      if (!Object.hasOwn(config.members, id)) {
        return failure(
          'E_UNKNOWN_MEMBER',
          `Preset ${preset} names an unknown member: ${id}`,
        );
      }
    }
    if (new Set(roster).size !== roster.length) {
      return failure(
        'E_INVALID_INPUT',
        `Preset ${preset} contains duplicate members`,
      );
    }
  }
  if (!Object.hasOwn(config.presets, config.defaultPreset)) {
    return failure(
      'E_UNKNOWN_PRESET',
      `Unknown default preset: ${config.defaultPreset}`,
    );
  }

  return success(config);
}

export async function loadConfig(path: string): Promise<Result<LoadedConfig>> {
  let input: string;
  try {
    input = await readFile(path, 'utf8');
  } catch {
    return failure(
      'E_CONFIG_READ',
      'Could not read the config file',
      'Check the --config path and its permissions.',
    );
  }
  const parsed = parseConfig(input);
  if (!parsed.ok) return parsed;
  const { instructions } = parsed.value.council;
  if (instructions === undefined) return parsed;

  const instructionsPath = isAbsolute(instructions)
    ? instructions
    : resolve(dirname(path), instructions);
  let instructionsText = '';
  try {
    const stream = createReadStream(instructionsPath, {
      encoding: 'utf8',
      highWaterMark: MAX_GUIDANCE_CHARS,
    });
    for await (const chunk of stream) {
      instructionsText += chunk;
      if (instructionsText.length > MAX_GUIDANCE_CHARS)
        return failure(
          'E_CONFIG_READ',
          `council.instructions file exceeds ${MAX_GUIDANCE_CHARS} characters`,
        );
    }
  } catch {
    return failure(
      'E_CONFIG_READ',
      'Could not read the council.instructions file',
      'Check the instructions path relative to the config file and its permissions.',
    );
  }
  if (!instructionsText.trim())
    return failure('E_CONFIG_READ', 'The council.instructions file is empty');
  return success({ ...parsed.value, instructionsText });
}
