# Slack Council

Slack Council is a self-hosted Slack app for teams that want several AI
members to weigh in on one question. Members answer under their own names
in a thread or channel and can respond to each other's points. Choose the
models, roles and tools that fit your discussion.

## Quick start

Use Node 26 and pnpm 12 to build the app.

```sh
pnpm install --frozen-lockfile
pnpm build
node dist/cli.js validate --config council.config.example.json
```

Follow [getting started](docs/getting-started.md) to create the Slack app and
prepare a private config and environment file. Validate your config and start
the app from the repo root.

```sh
node dist/cli.js validate --config .council/council.config.json
node --env-file=.env dist/cli.js start --config .council/council.config.json
```

See the [documentation](docs/index.md) for configuration, member tools, Slack
commands, deployment and contributor guides.
