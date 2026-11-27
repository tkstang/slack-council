# Slack Council

Ask one AI model a hard question and you get one confident answer. Slack
Council puts several models in the same Slack thread instead. Each member
answers under its own name, reads what the others said and pushes back. You
steer the discussion like any other thread.

It is a self-hosted Slack app. You choose the models, give each member a role
and decide which tools it may use.

## Why a council

- **Different models, different blind spots.** Put Claude, GPT or any other
  model behind an OpenAI-compatible endpoint on the same question. Where they
  agree, you can trust the answer more. Where they disagree, you find out
  before you commit.
- **They respond to each other, not just to you.** After everyone answers,
  a react round lets members challenge or build on each other's points. When a
  member still has something to add, it raises a hand ✋ rather than talking
  over the thread.
- **You stay in control of the floor.** `@council` asks everyone. `@<handle>`
  asks only the members you name. Anything else you write becomes context for
  their next turn by default. `@council stop` and `@council end` stop the discussion.
- **It works where your team already talks.** A council runs in a Slack thread
  or a whole channel. The thread is the record, so there is nothing new to
  open, search or share.

## What a council can do

- **Roles and presets.** Give members a persona and an effort level. Save
  rosters as presets, such as a fast pair for quick checks and a
  frontier-model panel for big decisions. Pick one with `preset:<name>` or the
  `/council` roster picker.
- **Tools, with your approval.** Grant members read-only file access, earlier
  Slack history, native Slack charts, or tools from any MCP server. Each grant
  is per member. Tools set to ask post an **Approve** / **Deny** card in the
  thread, tied to the exact arguments.
- **Hand off to a coding agent.** When the council settles on a plan, a
  member can draft a self-contained handoff note and start a coding session
  through MCP servers you configure, after a single approval.
- **Council-wide guidance.** One instructions file tells every member how to
  use your tools and what your house rules are.
- **Runs quietly.** Socket Mode needs no public URL or inbound port. Councils
  survive restarts. Stable prompt prefixes use provider prompt caching where
  supported.

## Example

```text
You:     @council Should we move the nightly batch jobs to a queue?
Ada:     Yes. Retries and backpressure come for free, and failures are
         visible per job instead of per run.
Grace:   Not yet. The batch finishes in 20 minutes; a queue adds a broker
         to operate. Fix the two flaky jobs first.
Ada:     Fair on the broker cost. If the flaky jobs are the real pain,
         per-job retries inside the batch get most of the benefit.
         (✋ on Ada's reply: Grace has more to say)
You:     @grace go ahead
```

The members and their replies above are illustrative.

## Quick start

You need a Slack workspace where you can install an app, an API key for an
OpenAI-compatible model provider, Node 26 and pnpm 12 to build, and Node 24 or
later to run.

```sh
pnpm install --frozen-lockfile
pnpm build
node dist/cli.js validate --config council.config.example.json
```

Follow [getting started](docs/getting-started.md) to create the Slack app and
prepare a private config and environment file. Then validate your config and
start the app from the repo root.

```sh
node dist/cli.js validate --config .council/council.config.json
node --env-file=.env dist/cli.js start --config .council/council.config.json
```

Mention `@council` with a question in a channel the app has joined.

## Documentation

| Read                                           | For                                             |
| ---------------------------------------------- | ----------------------------------------------- |
| [Getting started](docs/getting-started.md)     | Slack app setup, first config and first council |
| [Configuration](docs/configuration.md)         | Every config field and its default              |
| [Member tools](docs/member-tools.md)           | Grants, MCP servers, approvals and handoff      |
| [Using the council](docs/using-the-council.md) | Presets, mentions, commands and rounds          |
| [Deployment](docs/deployment.md)               | Running it as a service, providers and secrets  |
| [Maintainer docs](docs/index.md#maintain-it)   | Design, live checks, toolchain and contributing |

## License

[MIT](LICENSE)
