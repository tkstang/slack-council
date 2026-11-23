#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '@council/config/load.js';
import { CliError, isCliError } from '@council/core/errors.js';
import type { ErrorCode } from '@council/core/result.js';

type Envelope =
  | { readonly ok: true; readonly command: string; readonly data: unknown }
  | {
      readonly ok: false;
      readonly command: string;
      readonly code: ErrorCode;
      readonly message: string;
      readonly hint?: string;
    };

const USAGE = 'Usage: slack-council validate --config <path>';

export async function run(
  argv: readonly string[],
): Promise<{ envelope: Envelope; exitCode: number }> {
  const [subcommand, flag, path] = argv;
  const command = subcommand === 'validate' ? subcommand : 'slack-council';
  try {
    if (
      (argv.length === 1 && (subcommand === '--help' || subcommand === '-h')) ||
      (subcommand === 'validate' &&
        argv.length === 2 &&
        (flag === '--help' || flag === '-h'))
    ) {
      return {
        envelope: { ok: true, command, data: { usage: USAGE } },
        exitCode: 0,
      };
    }
    if (
      subcommand !== 'validate' ||
      flag !== '--config' ||
      !path ||
      argv.length !== 3 ||
      path.startsWith('--')
    ) {
      throw new CliError(
        'E_INVALID_INPUT',
        'Expected validate with a config file path',
        { hint: USAGE },
      );
    }
    const result = await loadConfig(path);
    if (!result.ok) {
      throw new CliError(result.code, result.message, { hint: result.hint });
    }
    return {
      envelope: { ok: true, command, data: { valid: true } },
      exitCode: 0,
    };
  } catch (err) {
    const error = isCliError(err)
      ? err
      : new CliError('E_UNEXPECTED', 'Unexpected validation failure');
    return {
      envelope: {
        ok: false,
        command,
        code: error.code,
        message: error.message,
        ...(error.hint === undefined ? {} : { hint: error.hint }),
      },
      exitCode: error.exitCode,
    };
  }
}

async function main(): Promise<void> {
  const { envelope, exitCode } = await run(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
  process.exitCode = exitCode;
}

function isEntrypoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntrypoint()) void main();
