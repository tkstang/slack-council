---
title: Getting started
description: Create the Slack app and run your first council.
---

# Getting started

## 1. Create the Slack app

Create an app from a manifest at <https://api.slack.com/apps> and install it to
your workspace. The manifest enables [Socket Mode](deployment.md#runtime-and-state).

```yaml
display_information:
  name: council
features:
  bot_user:
    display_name: council
    always_online: true
  slash_commands:
    - command: /council
      description: Start a council
      should_escape: false
  shortcuts:
    - name: Start a council
      type: message
      callback_id: council_start
      description: Convene a council on this message
oauth_config:
  scopes:
    bot:
      - app_mentions:read
      - channels:history
      - groups:history
      - chat:write
      - chat:write.customize
      - commands
      - reactions:write
      - users:read
settings:
  event_subscriptions:
    bot_events:
      - app_mention
      - message.channels
      - message.groups
  interactivity:
    is_enabled: true
  socket_mode_enabled: true
```

Under **Basic Information → App-Level Tokens**, create a token with the
`connections:write` scope. Copy the bot token from **OAuth & Permissions**.
Use the app-level and bot tokens in the next step. Invite the app to each
channel it should serve.

## 2. Configure a council

Copy [the example config](../council.config.example.json) to a private path such
as `.council/council.config.json`, which Git ignores. Set `slack.allowedUsers`
to the Slack user IDs that may start councils. Point each provider at an
OpenAI-compatible Chat Completions endpoint (see
[model providers](deployment.md#model-providers)) and set each member's model and tool grants. See the
[configuration reference](configuration.md) for the available settings.

The example includes optional instructions and handoff settings. If you copy
it into `.council/`, use `../examples/council-instructions.md` for
`council.instructions`, replace it with your own file, or remove the field.
See [handoff setup](member-tools.md#handoff-to-a-coding-session) if you want to
keep those settings.

Create a `.env` file in the repo root. Git ignores it.

```dotenv
SLACK_BOT_TOKEN=
SLACK_APP_TOKEN=
COUNCIL_MODEL_API_KEY=
```

Fill in the bot token (`xoxb-` prefix) and app token (`xapp-` prefix).
`COUNCIL_MODEL_API_KEY` is the name used by the example provider. See the
[deployment environment variables](deployment.md#environment-variables)
for the full list. The example's MCP servers (`notes`, `vault`, `sessions`)
and its `files` root are placeholders: fill them in or remove them. `start`
logs unconfigured MCP servers as unavailable, and a missing `files` root
silently grants nothing.

## 3. Run locally

From the repo root, [build the CLI](../README.md#quick-start) and run these
commands for your private config.

```sh
node dist/cli.js validate --config .council/council.config.json
node --env-file=.env dist/cli.js start --config .council/council.config.json
```

The CLI emits one JSON envelope on stdout. A validation error exits nonzero.
`validate` checks the file and its references without contacting Slack,
model providers or MCP servers. The package's `slack-council` bin runs the
same commands: `slack-council validate --config <path>` and
`slack-council start --config <path>`.

When `start` reports `ready: true`, mention the app in a channel it joined.
For example, write `@council What should we review first?` and open the
thread to see the panel and its answers. Press Ctrl-C to stop the local
process. See [using the council](using-the-council.md) for ways to convene
a panel and take part in the discussion.
