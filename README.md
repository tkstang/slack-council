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
(the Bolt adapter), `src/tools` (member tools and approvals) and `src/app`
(startup wiring). Imports within a directory use relative paths and
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

Only users in `slack.allowedUsers` can start a council; anyone else gets an
ephemeral refusal. The app must have joined the channel. There are three ways
to start one:

- **Mention.** Write `@council <question>`. On a top-level message the default
  preset convenes in that message's thread; inside a thread it convenes for
  that thread.
- **Slash command.** `/council [question]` in a channel opens the roster modal,
  with any typed text as the question. On submit the app posts
  "Council convened by <name>: <question>" in the channel and convenes in that
  message's thread, or, if you choose **This whole channel** under **Where**,
  in the channel itself. Slack does not run slash commands inside threads.
- **Message shortcut.** Choose **Start a council** from a message's menu. The
  council convenes in that message's thread, or the thread it replies in. The
  app posts "Council convened by <name>" in the thread, with any question typed
  in the modal; left empty, the post quotes up to 1,000 characters of the
  selected message and members answer that.

The modal offers a preset (the default preset is preselected) and a member
list. Choosing members overrides the preset. A thread or channel that already
has a council is refused. A form left open while the configured presets or
members changed is refused; reopen it. Failures after the modal closes, such
as the app not being in the channel, are reported to you ephemerally.

A **channel council** lives in the channel: members read recent top-level
messages and post top-level, and top-level `@<handle>`, `@council stop` and
`@council end` drive it. A channel has at most one; thread councils can still
start in its threads, and thread replies never reach the channel council.
Messages from people outside `slack.allowedUsers` are context only, and the
app ignores posts from bots, itself included.

### Commands

Everything you can do in Slack once the app is running:

| You write or click                          | Where                            | What happens                                                                                          | Acknowledgement               |
| ------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------- |
| `@council <question>`                       | Channel, top level               | Convenes the default preset in that message's thread. Every member answers, then a react round runs.  | ⏳ while members work         |
| `@council <question>`                       | A council's thread or channel    | Opens a new round for the whole roster.                                                               | ⏳                            |
| `/council [question]`                       | Channel composer                 | Opens the roster picker (preset, members, question, thread or whole channel).                         | "Council convened by …" post  |
| **Start a council** message shortcut        | A message's menu                 | Opens the picker; the council convenes in that message's thread.                                      | "Council convened by …" post  |
| `@<handle>` (one or several)                | A council's thread or channel    | Only those members answer.                                                                            | ⏳                            |
| A message with no `@council` or `@<handle>` | A council's thread or channel    | Nobody answers; members read it as context on their next turn. `council.unaddressed` can change this. | 👀                            |
| `@council stop`                             | A council's thread or channel    | Cancels running and queued turns. The council stays.                                                  | 🛑                            |
| `@council end`                              | A council's thread or channel    | Cancels turns and ends the council.                                                                   | 👋                            |
| **Approve** or **Deny**                     | A tool request posted by the app | Runs or refuses that one tool call. Allow-listed users only.                                          | The request shows who decided |

A member handle is plain text that the app reads; Slack does not autocomplete
it. `@council` works as the real app mention or as plain text. `stop` and
`end` must directly follow `@council` and end the line.

From the shell: `slack-council validate --config <path>` checks a config file,
and `slack-council start --config <path>` runs the app.

After the hourglass clears, members with unseen posts can raise a hand. Look
for a ✋ reaction on the post and a notice naming the members. Mention one of
them to hear their point. The council saves their private notes until their
next turn posts or passes. Set `council.listen` to `"off"` to disable this
behavior. The default is `"settle"`.

Members cannot notify people by default: every mention in a member's post is
written so that Slack does not deliver it. Set `council.memberMentions` to
`"people"` to let a member write `@Name` for someone who has posted or been
mentioned in that channel's councils; it becomes a real mention. The name must be
unique among those people and must not be, or begin with, a member handle. `@here`,
`@channel`, `@everyone` and user groups never notify, whatever the setting.

## Member tools

Set `members.<handle>.tools` to the grants that member can use. An empty list
gives the member no tools.

| Grant              | Tools it exposes                                                                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `files`            | `read_file`, `list_dir`, `search_files`                                                                                                                  |
| `slack_history`    | Earlier messages from this council's thread or channel. It starts before the prompt transcript and accepts the returned `oldestTs` as a `before` cursor. |
| `<server>`         | Every compatible tool from the named MCP server.                                                                                                         |
| `<server>__<tool>` | One tool from the named MCP server.                                                                                                                      |

MCP tool names use ASCII letters, digits, underscores and hyphens. Server
names use the same characters with single underscores between segments.
Config validation checks grants against declared server names. The server
supplies the available tool names at startup.

**A readable file is a quotable file.** Anything the tools can read may appear
in Slack. Choose roots whose contents the council's Slack audience can see.
`tools.files.roots` has no default. Relative paths resolve from the app's
working directory. The tools check real paths, filter directory entries and
search hits through the same policy, and refuse symlinks that escape a root.
The default deny globs cover env files, common credential directories, keys
and keychains. Supplying `tools.files.deny` replaces that list. The denylist
helps prevent accidental disclosure. Use the roots to limit access.

Reads accept UTF-8 files up to 64 KiB and support inclusive, one-based line
ranges. Listings return up to 100 entries. Literal searches return up to 50
hits with 300 characters per line. Listings and searches inspect up to 2,000
directory entries per call.

Declare stdio and HTTP servers in `tools.mcpServers`. For stdio, `env` maps
child variable names to variable names in the app's environment. For HTTP,
`headersEnv` maps header names to environment variable names. Each server
connects at startup. A failed connection disables that server's tools and
logs `E_MCP_UNAVAILABLE`. The CLI's `validate` command checks config without
opening MCP connections.

The example config uses [the notes MCP server](examples/notes-mcp-server.mjs).
Set `COUNCIL_NOTES_FILE` in the app's environment to a file intended for the
council. The server exposes `notes__list_notes` and `notes__append_note`.
The example allows automatic reads and asks for approval before appending.

Rules in `tools.policy` match the exposed tool name, in order. Use an exact
name or a prefix ending in `*`. The prefix is literal, so write `notes__*`
for one server. The first match wins. Built-in reads default
to `auto` and MCP tools default to `ask`. Approval rules apply only to
tools already granted to the member.

An `ask` call posts the member, tool and the full arguments in the council
conversation. Arguments too long to show in full are refused, never cut. Any user in `slack.allowedUsers` can click
**Approve** or **Deny**. Each request can be decided once. A denial, expiry
or cancellation returns a tool error. Two denials or expiries suppress
further requests during that turn. Tool results over 64 KiB are refused. `council.approvalTimeoutMs` defaults to 300,000 ms.
The turn timer pauses while waiting for approval. `stop` and `end` cancel
the wait immediately. Pending requests expire on restart.

## Adapter entry points

Open the service with `openCouncilService(config, { slack, turns, appUserId })`.
Pass human messages with raw Slack-encoded text to `handleHumanMessage`. For
mention-based kickoff, pass the resolved thread scope with `kickoff: true`.
`isDormant` reports a stored council that cannot run under the current config;
`end` and a `@council end` message in its scope remove it.
Convene a chosen roster or preset through `convene`. `createPicker` builds
the roster modal that `registerCouncilHandlers` serves for `/council` and the
`council_start` shortcut. The service retains the newest 4,096
accepted message keys across restarts. It dispatches floor grants and removes
ended councils after saving. Both `stop` and `end` cancel active turns before
saving so cancellation stays responsive during a slow or failed save.

The model port provides `runTurn` for real turns and `runListen` for the
bounded, tool-free check at settle. Both receive an abort signal.

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
source, generator and nonmutating freshness check.

## Verification policy

This MVP is verified locally and has no CI. Development uses Node 26.
The app runs on Node 24 and later and uses Node 24 type declarations.

Run focused tests while editing. Before handoff, run `pnpm run worktree:validate`
from a clean checkout with dependencies installed using `pnpm install --frozen-lockfile`.
The script checks the agent-file policy, lint, format, types, the full test suite,
the build and worktree cleanliness. To smoke-test the built CLI locally, run
`node dist/cli.js validate --config council.config.example.json`.

The tests stop at the ports. After a change to the Slack adapter, the turn
runner, tools or approvals, run the checklist in
[docs/live-checks.md](docs/live-checks.md) and add a line to its log.

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
