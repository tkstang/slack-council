---
title: Deployment
description: Run Slack Council as a managed service with persistent state and environment secrets.
---

# Deployment

## Runtime and state

Run the built app on Node 24 or later. See the
[quick start](../README.md#quick-start) for build commands. The app opens an
outbound WebSocket to Slack in Socket Mode and makes outbound calls to Slack's
web API, model providers and any configured HTTP MCP servers. It needs no
public URL or inbound port.

Run exactly one instance per Slack app. Slack can split events between
connections, so two instances can each see only part of a conversation. Stop
the old instance before starting its replacement. Give the process a
persistent, writable [`stateDir`](configuration.md#state-directory) so it can
restore councils across restarts.

## Environment variables

Set these in the app process's environment.

| Variable                                  | Value                                                  |
| ----------------------------------------- | ------------------------------------------------------ |
| `SLACK_BOT_TOKEN`                         | Bot User OAuth Token from the Slack app installation.  |
| `SLACK_APP_TOKEN`                         | App-level token with `connections:write`.              |
| Each provider's `apiKeyEnv`               | API key for that provider.                             |
| Each HTTP MCP server's `headersEnv` value | Full value for the named header.                       |
| Each stdio MCP server's `env` value       | Value to pass to the subprocess under the mapped name. |

Use the platform's secret store to inject these variables, or keep a private
environment file and pass it with Node's `--env-file` option before the script
path. `start` reports a missing Slack token or provider key with
`E_MISSING_ENV` and names the variable.

## Start and observe the service

Set the working directory before starting the service so relative paths
resolve as intended. Run `validate` against the same config before `start`.
See [what validation checks](getting-started.md#3-run-locally).

`start` emits a one-line JSON readiness or error envelope on stdout. App logs
are JSON lines on stderr. Capture both streams. Use SIGTERM or Ctrl-C to shut
down cleanly.

## Model providers

The app uses `@ai-sdk/openai-compatible` and sends requests to
`POST {baseURL}/chat/completions`. Configure each provider with its
`baseURL` and `apiKeyEnv`. A member's optional `effort` goes to the SDK as
`reasoningEffort`, which the adapter sends as `reasoning_effort`. Private
listening always sends `low`, even for members with no `effort` set.

Public replies and private listening send `prompt_cache_key` with the SHA-256
digest of the council ID. When a model ID starts with `claude-` and the prompt
has a cache boundary, the app splits the user message into two text blocks.
It marks the first block, the stable role brief, with
`cache_control: { "type": "ephemeral" }`. The transcript and task go in the
second block. Other model IDs receive the user prompt as a single string.
These fields are always sent and cannot be turned off. A provider that
rejects unknown fields, or text-block content for a `claude-` model, fails
every turn with `E_TURN_FAILED`; listening failures are silent. When a provider reports a positive
cached input token count, the app logs `model_cache_read` to stderr. See
[prompt caching in the design](design.md#prompt-caching) for the measurement
and compatibility limits.

### Amazon Bedrock

Slack Council has not been tested with Amazon Bedrock. Bedrock offers
OpenAI-compatible Chat Completions for some models. Its Claude models use
Anthropic's Messages API for native chat, so this app cannot call them
directly. To reach Claude on Bedrock, point the app at an OpenAI-compatible
gateway that translates Chat Completions requests. See the
[Bedrock model compatibility table](https://docs.aws.amazon.com/bedrock/latest/userguide/models-api-compatibility.html).

## systemd

Replace the placeholder account and paths. Keep the environment file
readable by the service account and configure a writable state directory.

```ini
[Unit]
Description=Slack Council
After=network-online.target
Wants=network-online.target

[Service]
User=SERVICE_USER
WorkingDirectory=/path/to/app
ExecStartPre=/path/to/node /path/to/app/dist/cli.js validate --config /path/to/config.json
ExecStart=/path/to/node --env-file=/path/to/service.env /path/to/app/dist/cli.js start --config /path/to/config.json
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Use the journal to read stdout and stderr.

## macOS LaunchAgent

Replace the placeholder paths and create the log directory before loading
the LaunchAgent. Run `validate` against the same config first. The agent
uses `/usr/bin/env -i` to start with a clean environment and Node's
`--env-file` to load its variables. If you run stdio MCP servers, use absolute
command paths or set `PATH` in the service's environment file.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>example.slack-council</string>
    <key>ProgramArguments</key>
    <array>
      <string>/usr/bin/env</string>
      <string>-i</string>
      <string>/path/to/node</string>
      <string>--env-file=/path/to/service.env</string>
      <string>/path/to/app/dist/cli.js</string>
      <string>start</string>
      <string>--config</string>
      <string>/path/to/config.json</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/path/to/app</string>
    <key>RunAtLoad</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>30</integer>
    <key>KeepAlive</key>
    <dict>
      <key>SuccessfulExit</key>
      <false/>
    </dict>
    <key>StandardOutPath</key>
    <string>/path/to/logs/slack-council.out.log</string>
    <key>StandardErrorPath</key>
    <string>/path/to/logs/slack-council.err.log</string>
  </dict>
</plist>
```

## Containers

Build the app into the image and include its production dependencies. Mount
the config and its optional instructions file, plus a writable volume at
`stateDir`. Also mount any stdio MCP server scripts and `files` roots the
config names; relative paths resolve from the working directory. Inject
secrets through the platform. Validate the mounted config before starting the
app. Run one replica and use a replacement strategy that stops the old replica
before the new one starts.

Run `node` directly as the exec-form entrypoint so SIGTERM reaches the app.
The app allows itself 10 seconds to close its connections and then exits with
code 2, so set the stop grace period above 10 seconds. Collect stdout and
stderr through the platform.
