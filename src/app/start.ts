import { loadConfig } from '@council/config/load.js';
import { CliError } from '@council/core/errors.js';
import type { Result } from '@council/core/result.js';
import {
  createProviderModels,
  createTurnRunner,
} from '@council/model/turn-runner.js';
import { openCouncilService } from '@council/runner/service.js';
import { callSlack, createSlackClients } from '@council/slack/api.js';
import { registerCouncilHandlers } from '@council/slack/bolt.js';
import { createInboundHandler } from '@council/slack/inbound.js';
import { createPicker } from '@council/slack/picker.js';
import { createSlackPort } from '@council/slack/port.js';
import { createApprovalGate } from '@council/tools/approval.js';
import { createMcpManager } from '@council/tools/mcp.js';
import { createMemberTools } from '@council/tools/member-tools.js';
import { App } from '@slack/bolt';
import { z } from 'zod';

import { createBoltLogger, createStderrLog, type Log } from './log.js';

export interface StartOptions {
  readonly configPath: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly log?: Log;
  /** Bolt drops the app's own events by default; the prefilter drops them as well. */
  readonly ignoreSelf?: boolean;
}

export interface RunningCouncil {
  readonly botUserId: string;
  readonly botId: string;
  stop(): Promise<void>;
}

const AuthTest = z.looseObject({ user_id: z.string(), bot_id: z.string() });

function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.value;
  throw new CliError(result.code, result.message, { hint: result.hint });
}

function requireEnv(
  env: StartOptions['env'],
  name: 'SLACK_BOT_TOKEN' | 'SLACK_APP_TOKEN',
): string {
  const value = env[name];
  if (value === undefined || value === '') {
    throw new CliError('E_MISSING_ENV', `${name} is not set`, {
      hint: `Set ${name} in the environment, for example with node --env-file=.env.`,
    });
  }
  return value;
}

/** Load config, connect to Slack in Socket Mode and serve councils until stopped. */
export async function startCouncilApp({
  configPath,
  env,
  log = createStderrLog(),
  ignoreSelf = true,
}: StartOptions): Promise<RunningCouncil> {
  const config = unwrap(await loadConfig(configPath));
  const botToken = requireEnv(env, 'SLACK_BOT_TOKEN');
  const appToken = requireEnv(env, 'SLACK_APP_TOKEN');
  const models = unwrap(createProviderModels(config.providers, env));
  const logger = createBoltLogger(log);

  const { reader, writer } = createSlackClients(botToken, { logger });

  const auth = await callSlack(reader, 'auth.test', {});
  const identity = auth.ok ? AuthTest.safeParse(auth.value) : undefined;
  if (!identity?.success) {
    throw new CliError(
      'E_SLACK',
      `Slack auth.test failed: ${auth.ok ? 'unexpected_response' : auth.error}`,
      { hint: 'Check SLACK_BOT_TOKEN.' },
    );
  }
  const { user_id: botUserId, bot_id: botId } = identity.data;

  const members = Object.entries(config.members).map(([id, member]) => ({
    id,
    ...member,
  }));
  const slack = createSlackPort({
    api: reader,
    writeApi: writer,
    botId,
    botUserId,
    members,
  });
  const approvals = createApprovalGate(slack, config.slack.allowedUsers, () =>
    log({ level: 'warn', event: 'approval_write_failed', code: 'E_SLACK' }),
  );
  const mcp = createMcpManager(config.tools.mcpServers, env, (server, code) =>
    log({ level: 'warn', event: 'mcp_unavailable', code, server }),
  );
  const toolsFor = createMemberTools({
    config: config.tools,
    slack,
    members,
    mcp,
    approvals,
  });
  const service = await openCouncilService(config, {
    slack,
    turns: createTurnRunner({ models, toolsFor }),
    appUserId: botUserId,
    onSkippedCouncil: (council, missingMembers) =>
      log({
        level: 'warn',
        event: 'council_skipped',
        council: council.id,
        channel: council.scope.channel,
        missing_members: missingMembers.join(','),
      }),
    onEffectFailure: ({ effect, code, scope }) =>
      log({
        level: 'warn',
        event: 'effect_failed',
        effect,
        code,
        channel: scope.channel,
      }),
  });

  const app = new App({
    token: botToken,
    appToken,
    socketMode: true,
    logger,
    ignoreSelf,
    botId,
    botUserId,
  });
  registerCouncilHandlers(app, {
    onEvent: createInboundHandler({ service, appUserId: botUserId, log }),
    onApproval: approvals.decide,
    picker: createPicker({
      config,
      service,
      slack,
      reader,
      writer,
      appUserId: botUserId,
      log,
    }),
    log,
  });
  try {
    await mcp.start();
    await app.start();
  } catch {
    await shutdown();
    throw new CliError('E_SLACK', 'Could not connect to Slack in Socket Mode', {
      hint: 'Check SLACK_APP_TOKEN and that Socket Mode is enabled.',
    });
  }

  async function shutdown() {
    try {
      await service.shutdown();
    } finally {
      await Promise.all([mcp.close(), approvals.drain()]);
    }
  }

  let stopping: Promise<void> | undefined;
  return {
    botUserId,
    botId,
    stop() {
      stopping ??= (async () => {
        try {
          await shutdown();
        } finally {
          await app.stop();
        }
      })();
      return stopping;
    },
  };
}
