# slack-council design

Status: prototype design, 2026-11-23. Decisions marked **(operator)** were made by
the operator in the source brainstorm. The rest are implementation choices that can
change.

## What it is

One Slack app, `council`, that hosts a council of AI members in a Slack thread or
channel. The operator poses a question, members answer and respond to each other
like colleagues, and the operator can interject at any point. Each member is a
model plus an effort level, a persona and a set of tool grants.

## Decisions carried from the brainstorm (operator)

| Topic                 | Decision                                                                                                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose               | Deliberation. Members respond to each other; an @-mention always works.                                                                                                                                               |
| Turn-taking           | `@council` opens a round. After that an @-mention from anyone, human or member, gives the floor. A hop budget stops loops.                                                                                            |
| Unvoiced disagreement | A member circles back to it when next given the floor. When a chain settles, silent members may raise a hand and keep a private note. Listen cadence is a council setting (`settle` by default, `every-post` later).  |
| Context               | Slack is the memory: recent messages verbatim, the member's own private notes, and a history tool for going further back.                                                                                             |
| Identity              | One Slack app posting under each member's name and avatar (`chat:write.customize`). Members are addressed by plain-text handles such as `@ada`.                                                                       |
| Roster                | Members are defined in config. A picker modal with presets chooses the roster at kickoff.                                                                                                                             |
| Tools                 | Read-only file tools are built in, with a path denylist. Everything else is an MCP server granted per member. Each tool is `auto` or `ask`; `ask` posts Approve and Deny buttons that only permitted users can press. |
| Packaging             | A generic core. Nothing in code names a personal service. The operator's setup is private config.                                                                                                                     |
| Scopes                | Both council threads and council channels.                                                                                                                                                                            |
| Model calls           | Vercel AI SDK tool loop against one OpenAI-compatible endpoint.                                                                                                                                                       |

## Verified facts the design depends on

- The model endpoint (`POST {baseURL}/chat/completions`) serves Claude and GPT ids,
  returns OpenAI-style `tool_calls`, and accepts `reasoning_effort`. Checked with
  curl on 2026-11-23.
- On the Claude route a `system` message does **not** set the persona: the model
  answers as its default identity. The same role text placed in the first user
  message does hold. So the role brief is always sent in the user message, and in
  `system` as well for routes that honor it.
- AI SDK 7: `generateText` with `stopWhen: isStepCount(n)`, `tool({ inputSchema, execute })`,
  `@ai-sdk/openai-compatible` for the endpoint, `@ai-sdk/mcp` for MCP clients,
  `MockLanguageModelV4` from `ai/test` for tests.
- Slack: custom-identity posts read back with `subtype: bot_message`, our `bot_id`
  and the `username`. A reaction belongs to the app's single bot user, so a ✋
  reaction cannot show which member raised it. Slash commands cannot be invoked in
  threads. `trigger_id` lasts three seconds. Internal apps keep Tier 3 history limits.
- Still to verify live: whether the app receives events for its own posts, whether
  `chat.update` keeps a custom identity, and whether `markdown_text` works with a
  custom `username`.

## Concepts

- **Member**: `{ id, name, avatar, model, effort, persona, tools[] }`. `id` is the
  handle: lowercase, `[a-z][a-z0-9-]*`.
- **Council**: a roster bound to a **scope**, plus an owner and settings.
- **Scope**: `{ channel, threadTs? }`. With `threadTs` it is a thread council and
  posts go to that thread. Without it, it is a channel council and posts are
  top-level.
- **Chain**: everything that follows one human message until the floor queue is
  empty. A new human message starts a new chain.
- **Floor grant**: permission for one member to take one turn. Kinds: `round`
  (independent answer), `react` (may pass), `mention` (must answer).

## Turn engine

A pure reducer: `reduce(state, event) -> { state, effects }`. No Slack, no models,
no clock. The runner executes effects and feeds results back as events.

Addressing in a human message:

1. `@council` (the app mention or the plain text) opens a round for the whole roster.
2. One or more member handles give those members `mention` grants.
3. No address: in a thread council this is treated as `@council`; in a channel
   council nobody speaks. Setting: `unaddressed: 'council' | 'silent'`.
4. `@council stop` cancels queued grants and aborts running turns. `@council end`
   ends the council.

Rounds:

- Round 1: every addressed member answers in parallel. None sees another's
  round 1 answer, so nobody anchors on the first reply.
- Rounds 2..`rounds` (default 2): members take `react` turns one at a time in
  roster order. Each sees everything so far and either responds or passes. The
  round sequence ends early when every member passes.

Mentions:

- A handle in a member's post gives that member a `mention` grant, appended to the
  queue. Self-mentions are ignored. A member already queued is not queued twice.
- `@council` in a member's post does not open a round. Only humans open rounds.
- Each mention grant from a member costs one hop. `hopBudget` (default 6) is per
  chain. When it is spent, further member mentions are not honored and the app
  posts one notice.
- `maxTurnsPerChain` caps total turns as a backstop.

Human interjection: a new human message drops grants that have not started. Turns
already running finish and post. The new chain starts after them.

Settle: when the queue is empty, every member with posts it has not seen since its
last turn gets one **listen** call. No tools, small output. It returns `PASS` or
`HAND #<n>: <note>`, where `#<n>` is a message number from the transcript. Notes
are stored privately. If any member raised a hand, the app posts one line as
`council` naming them, and adds ✋ to each target message. The line is needed
because a reaction cannot identify the member.

Circle-back: a member's turn prompt includes its private notes and every post
since it last spoke, and tells it to raise any disagreement with those posts
before answering what it was asked. Notes are cleared when the member posts.

## Context assembly

Slack history becomes one transcript in a single user message, which avoids role
alternation rules and carries the role brief on the Claude route:

```
<council_role>…persona, roster, how the floor works…</council_role>
<transcript>
[#1] Thomas: …
[#2] Ada: …
[#3] You (Bo): …
</transcript>
<your_private_notes>…</your_private_notes>
<floor>Thomas addressed you in #4.</floor>
```

- Thread council: the whole thread, newest kept when over `contextChars`. An
  omission marker says how many earlier messages were dropped and names the
  history tool.
- Channel council: the most recent top-level messages within the same budget.
- A member post is recognised by message metadata (`member` id), falling back to
  `bot_id` plus `username`.
- App notices appear as `council (system)`.

## Member runner

`generateText` with the member's tools, `stopWhen: isStepCount(maxSteps)`,
`reasoningEffort` from the member's `effort`, and an abort signal. A `react` turn
that returns exactly `PASS` posts nothing. Output is scanned for handles to
produce mention grants.

## Tools

- `read_file`, `list_dir`, `search_files`: read-only. Paths are resolved with
  `realpath` and must be under a configured root and match no deny glob. Default
  deny globs cover env files, SSH and cloud credentials, key files and keychains.
  Reads are size-capped.
- `slack_history`: older messages in the council's own scope.
- MCP servers: stdio or HTTP, declared once in config, granted per member. Tool
  names are namespaced `server__tool`.
- Approval: each tool resolves to `auto` or `ask` from ordered policy rules.
  Built-in read tools default to `auto`; MCP tools default to `ask`. An `ask` call
  posts the tool name and arguments with Approve and Deny buttons, and waits.
  Only the council owner or a configured allowed user can decide. A denial or a
  timeout returns an error result to the model, which continues.

## Slack layer

Bolt in Socket Mode behind a narrow `SlackPort`, so the engine and runner are
tested without Slack.

- Inbound: accept `message` events with no subtype or `file_share`; drop our own
  `bot_id`; dedupe on `channel:ts` before any await.
- Kickoff: (a) `@council` on a message outside any council convenes the default
  preset in that message's thread; (b) the `/council` command or the "Start a
  council" message shortcut opens the roster modal.
- Posting: per-channel serial queue, at least one second apart, no automatic
  retry of a write whose outcome is unknown. `@here`, `@channel` and `@everyone`
  are neutralised in member output.
- Progress: ⏳ on the triggering message while a chain runs.

## State

`stateDir/councils.json`, written atomically: councils, private notes and each
member's last-seen message. Event dedupe is in memory. Slack remains the record of
what was said.

## Configuration

One JSON file validated with Zod. Secrets are referenced by environment variable
name, never inlined. Sections: `providers`, `members`, `presets`, `tools`
(`files`, `mcpServers`, `policy`), `slack` (`allowedUsers`), `limits`.

## Prototype order

1. Thread councils: kickoff by mention, rounds, mentions, hop budget, circle-back,
   identities, config.
2. Tools: file tools with denylist, MCP grants, approvals.
3. Roster modal and presets.
4. Raised hand.
5. Channel councils.

## Out of scope for the prototype

Multiple replicas, streaming replies, platforms other than Slack, per-member Slack
apps, and the `every-post` listen cadence.
