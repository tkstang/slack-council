# Slack Council

Slack Council hosts a roster of AI members in a Slack conversation. The core
implements the floor queue, prompts, per-council execution and persistence.
See [the design](docs/design.md) for the turn-taking contract.

## Validate a configuration

```sh
pnpm install --frozen-lockfile
pnpm build
node dist/cli.js validate --config council.config.example.json
```

The CLI emits one JSON envelope and exits nonzero for invalid configuration.
Validation checks the file and its references without contacting Slack or model
providers. Provider keys are named by environment variable. A relative
`stateDir` resolves from the process working directory.

Source modules live in `src/core`, `src/config`, `src/engine`, `src/context`,
`src/runner`, `src/store`, `src/model` (the AI SDK turn runner), `src/slack`
(the Bolt adapter) and `src/app` (startup wiring). Imports within a directory use relative paths and
cross-directory imports use `@council/*`.

## Run it in Slack

### 1. Create the Slack app

Create an app from a manifest at <https://api.slack.com/apps> and install it to
your workspace. Socket Mode means no public URL is needed.

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
      - channels:read
      - groups:history
      - groups:read
      - chat:write
      - chat:write.customize
      - commands
      - reactions:read
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
`connections:write` scope. Invite the app to each channel it should serve.

### 2. Configure

Copy `council.config.example.json` to a private path, for example
`.council/council.config.json` (gitignored). Set `slack.allowedUsers` to the
Slack user ids that may convene councils, and point each provider at an
OpenAI-compatible endpoint.

Create `.env` in the repo root (gitignored):

```sh
SLACK_BOT_TOKEN=   # Bot User OAuth Token, xoxb-…
SLACK_APP_TOKEN=   # App-Level Token with connections:write, xapp-…
COUNCIL_MODEL_API_KEY=   # one variable per provider, named by its apiKeyEnv
```

### 3. Start

```sh
pnpm build
node --env-file=.env dist/cli.js start --config .council/council.config.json
```

`start` prints one JSON line when connected, logs JSON lines to stderr and
shuts down cleanly on Ctrl-C or SIGTERM. A missing variable fails with
`E_MISSING_ENV` and names the variable.

In a channel the app has joined, an allowed user writes `@council <question>`.
On a top-level message the default preset convenes in that message's thread;
inside a thread it convenes for that thread. Address a member with `@<handle>`,
and use `@council stop` or `@council end`. `/council` and the message shortcut
reply that the roster picker is not built yet.

## Adapter entry points

Open the service with `openCouncilService(config, { slack, turns, appUserId })`.
Pass human messages with raw Slack-encoded text to `handleHumanMessage`. For
mention-based kickoff, pass the resolved thread scope with `kickoff: true`.
Convene a chosen roster or preset through `convene`. The service retains the newest 4,096
accepted message keys across restarts. It dispatches floor grants and `end`
after saving, and dispatches `stop` before saving so a slow or failed save does
not delay cancellation of the active turn.

The Slack port reads oldest-to-newest history with an inclusive cutoff, posts
members with chain and turn metadata, and neutralises broadcast mentions. Call
`shutdown()` while that port is still available so outstanding writes and
reactions can drain.

## Scripts

| Script                       | Does                                                         |
| ---------------------------- | ------------------------------------------------------------ |
| `pnpm run dev`               | `tsx watch src/cli.ts`                                       |
| `pnpm run build`             | emit to `dist/` via `tsc` + `tsc-alias`                      |
| `pnpm run typecheck`         | `tsc --noEmit`                                               |
| `pnpm run lint`              | `oxlint`                                                     |
| `pnpm run format`            | `oxfmt --write .` (rewrite)                                  |
| `pnpm run format:check`      | `oxfmt --check .`                                            |
| `pnpm run test`              | `vitest run`                                                 |
| `pnpm run prepare`           | wire this repo's Git hooks through `tools/install-hooks.mjs` |
| `pnpm run worktree:init`     | bootstrap a new git worktree with local-only state           |
| `pnpm run worktree:validate` | full local validation on a clean checkout                    |

After `git worktree add`, run `pnpm run worktree:init` inside the new worktree.
Use `pnpm run worktree:validate` for explicit full verification. If the repo has
adopted OAT, `worktree:init` also syncs OAT local paths, provider views and
archived project docs from S3 where configured.

For later provider updates, preview `oat sync --scope project --dry-run` before
applying `oat sync --scope project`. Change canonical sources, never generated
views. Track required installable/provider derivatives only with an explicit
source, generator and nonmutating freshness check. Product skills may have a
separate source such as `src/skills/`.

## Verification policy

This MVP is verified locally and has no remote. Development uses Node 26.
The library and CLI support Node 24 and use Node 24 type declarations. Before
publishing, verify the packed package on Node 24.

Run focused tests while editing. Before handoff, run `pnpm run worktree:validate`
from a clean checkout with dependencies installed using `pnpm install --frozen-lockfile`.
The script checks the agent-file policy, lint, format, types, the full test suite,
the build and worktree cleanliness. To smoke-test the built CLI locally, run
`node dist/cli.js validate --config council.config.example.json`.

Record the tested revision, toolchain, commands, outcomes and exclusions in the
handoff. Reuse that evidence while the tested inputs remain unchanged.
Any future CI must run exclusively on the owner's self-hosted runner.

## NOTES / Deviations

- **TypeScript 7 is primary.** `typescript-7@npm:typescript` supplies the stable
  `tsc` binary for typecheck and emit. `typescript@npm:@typescript/typescript6`
  remains beside it for compiler-API ecosystem compatibility and exposes `tsc6`;
  use that binary only for differential diagnosis or a demonstrated TS7 blocker.
  A truly minimal repo with no compiler-API consumers may simplify to pure
  `typescript@^7`.
- **Module resolution is `NodeNext`** for native Node ESM execution. Bundler
  resolution belongs to projects with a bundler. `tsc-alias` rewrites the
  `@council/*` path alias and appends runtime `.js` extensions at build.
- **`@types/node` stays on `^24`** for the consumer support floor. Development
  uses Node 26. Node 26-only APIs need a deliberate support change.
- No `.editorconfig` (dropped by house decision; oxfmt is the single formatter).
