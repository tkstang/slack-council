#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { startCouncilApp, type RunningCouncil } from '@council/app/start.js';
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

const USAGE =
  'Usage: slack-council validate --config <path> | start --config <path>';

const COMMANDS = new Set(['validate', 'start']);

export interface CliDeps {
  readonly start?: (configPath: string) => Promise<RunningCouncil>;
}

export async function run(
  argv: readonly string[],
  {
    start = (configPath) => startCouncilApp({ configPath, env: process.env }),
  }: CliDeps = {},
): Promise<{
  envelope: Envelope;
  exitCode: number;
  session?: RunningCouncil;
}> {
  const [subcommand, flag, path] = argv;
  const command =
    subcommand !== undefined && COMMANDS.has(subcommand)
      ? subcommand
      : 'slack-council';
  try {
    if (
      (argv.length === 1 && (subcommand === '--help' || subcommand === '-h')) ||
      (command !== 'slack-council' &&
        argv.length === 2 &&
        (flag === '--help' || flag === '-h'))
    ) {
      return {
        envelope: { ok: true, command, data: { usage: USAGE } },
        exitCode: 0,
      };
    }
    if (
      command === 'slack-council' ||
      flag !== '--config' ||
      !path ||
      argv.length !== 3 ||
      path.startsWith('--')
    ) {
      throw new CliError(
        'E_INVALID_INPUT',
        'Expected validate or start with a config file path',
        { hint: USAGE },
      );
    }
    if (command === 'start') {
      const session = await start(path);
      return {
        envelope: {
          ok: true,
          command,
          data: {
            ready: true,
            botUserId: session.botUserId,
            botId: session.botId,
          },
        },
        exitCode: 0,
        session,
      };
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
      : new CliError('E_UNEXPECTED', `Unexpected ${command} failure`);
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

const SHUTDOWN_GRACE_MS = 10_000;

async function main(): Promise<void> {
  const { envelope, exitCode, session } = await run(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
  process.exitCode = exitCode;
  if (!session) return;

  const stop = (signal: NodeJS.Signals) => {
    process.stderr.write(
      `${JSON.stringify({ level: 'info', event: 'shutdown', signal })}\n`,
    );
    // Exit even if a connection refuses to close.
    setTimeout(() => process.exit(2), SHUTDOWN_GRACE_MS).unref();
    session.stop().then(
      () => process.exit(0),
      () => process.exit(2),
    );
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
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
