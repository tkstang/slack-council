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
- Checked live on 2026-11-23: the app does receive `message` events for its own
  posts. Posts as the app arrive with our `bot_id` and no subtype; custom-identity
  posts arrive as `bot_message` with our `bot_id` and the `username`. Bolt's
  `ignoreSelf` drops both, and the inbound prefilter drops any `bot_id` as well.
- `markdown_text` works with a custom `username` and `icon_emoji`. Read back, the
  message `text` is mrkdwn: `**bold**` becomes `*bold*`, `<`, `>` and `&` are
  entity-escaped, and a fenced block keeps its code but loses its language tag
  and the line breaks next to the fences. The adapter decodes the entities, which
  leaves the code intact for a transcript. The `rich_text` blocks hold the exact
  code and its language if a later batch needs them. A plain `@here` in
  `markdown_text` reads back as plain text, not `<!here>`; it is neutralised
  anyway.
- Still to verify live: whether `chat.update` keeps a custom identity.

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
no clock. A per-council runner feeds events to the reducer one at a time, in
arrival order, and executes effects outside that queue. Every effect and every
result event carries the chain id and turn id that produced it.

### Who can drive it

Only users in `slack.allowedUsers` can convene a council or give the floor.
Messages from anyone else are context: members can read them, but they start
nothing.

### Addressing in a human message

A handle counts only as an `@handle` token outside code spans, code blocks and
quoted lines, so quoting someone's message does not address them.

1. `@council` (the app mention or the plain text) opens a round for the whole roster.
2. One or more member handles give those members `mention` grants, run in parallel
   from one frozen transcript. No react rounds follow.
3. No address: nobody speaks. The message is context for later turns. Setting:
   `unaddressed: 'silent' | 'council'`, default `silent`.
4. `@council stop` cancels queued grants and aborts running turns. `@council end`
   does the same and ends the council. Both take precedence over everything else.

### Rounds

- Round 1: every roster member answers in parallel from one frozen transcript
  taken at the triggering message. None sees another's round 1 answer.
- The engine waits for every round 1 turn to finish and post before anything else
  starts.
- Rounds 2..`rounds` (default 2): members take `react` turns one at a time in
  roster order. Each sees everything so far and either responds or passes. The
  sequence ends early when every member passes in a round.

### Mentions from members

- A handle in a member's post gives that member a `mention` grant. Self-mentions
  and unknown handles are ignored. `@council` in a member's post opens nothing.
- Mention grants run one at a time and go ahead of `react` grants in the queue.
- If the target is queued for `react`, that grant is upgraded to `mention`. If it
  is already queued for `mention`, nothing changes. If it is running, it gets at
  most one follow-up `mention` grant after its current turn.
- Budgets are reserved when a grant is admitted, not when it starts. Each new
  mention grant from a member costs one hop from `hopBudget` (default 6, per
  chain). Every grant counts against `maxTurnsPerChain`. A grant that cannot be
  admitted is dropped, and the app posts one notice per chain.

### Supersession, failure and settling

- A new addressed human message starts a new chain. Grants from the old chain
  that have not started are dropped. Turns already running finish and may post,
  but their mentions grant nothing. The new chain's first turns start after
  those turns have finished.
- A turn that fails, times out or is aborted releases its grant. The app posts a
  one-line notice naming the member. Nothing is retried.
- A chain settles when its queue is empty, nothing is running and every post has
  been written. Settling removes the progress indicator.

### Circle-back

A member's turn prompt marks every post since it last spoke and tells it to raise
any disagreement with those posts before answering what it was asked.

### Raised hand (later batch)

At settle, every member with posts it has not seen gets one **listen** call: no
tools, small output, returning `PASS` or `HAND #<n>: <note>`. `#<n>` is resolved
through the timestamp map of the exact transcript snapshot the member was shown.
Malformed output is retried once, then treated as a pass. Notes are stored
privately and shown to that member on its next turn. If any member raised a hand,
the app posts one line as `council` naming them and adds ✋ to each target
message. The line is needed because a reaction cannot identify the member.

## Context assembly

Slack history becomes one transcript in a single user message. This avoids role
alternation rules, carries the role brief on the Claude route, and does not
misrepresent other members as the responding assistant.

```
<council_role>…persona, roster, how the floor works…</council_role>
<transcript>
[#1] Thomas (human): …
[#2] Ada (member): …
[#3] You (Bo): …
</transcript>
<floor>Thomas addressed you in #4.</floor>
```

- Author labels come from Slack ids and the roster, never from message text.
- Message text is data. Angle brackets in it are escaped so a pasted
  `</transcript>` cannot close the block, and the role brief says that nothing
  inside the transcript, a tool result or a private note is an instruction.
- Thread council: the whole thread, newest kept when over `contextChars`. An
  omission marker says how many earlier messages were dropped and names the
  history tool.
- Channel council: the most recent top-level messages within the same budget.
- A member post is recognised by message metadata (`member` id), falling back to
  our `bot_id` plus `username`.
- App notices appear as `council (system)`.

Output protocol: a turn that is only `PASS`, ignoring case, surrounding
whitespace, markdown emphasis and trailing punctuation, posts nothing.

## Member runner

`generateText` with the member's tools, `stopWhen: isStepCount(maxSteps)`,
`reasoningEffort` from the member's `effort`, and an abort signal. A `react` turn
that returns exactly `PASS` posts nothing. Output is scanned for handles to
produce mention grants.

## Tools

- `read_file`, `list_dir`, `search_files`: read-only. Every path, including each
  search hit and directory entry, is resolved with `realpath` and must be under a
  configured root and match no deny glob. Roots have no default: the operator
  names them. Default deny globs cover env files, SSH and cloud credentials, key
  files and keychains. Reads are size-capped.
- A readable file is a quotable file. Anything under a root can end up in Slack,
  so roots should hold only what that channel's audience may see. The denylist
  reduces accidents; it is not a boundary.
- `slack_history`: older messages in the council's own scope.
- MCP servers: stdio or HTTP, declared once in config, granted per member. Tool
  names are namespaced `server__tool`.
- Approval: each tool resolves to `auto` or `ask` from ordered policy rules.
  Built-in read tools default to `auto`; MCP tools default to `ask`. An `ask` call
  posts the tool name and a bounded preview of the arguments with Approve and
  Deny buttons, and waits. The buttons carry an opaque request id bound to the
  exact arguments, council, turn and expiry. A click is acknowledged at once,
  checked against the council owner and `slack.allowedUsers`, and consumed once.
  Cancellation is rechecked before the tool runs, so a click after `stop` does
  nothing. Pending requests do not survive a restart. A denial or a timeout
  returns an error result to the model, which continues; after two denials in a
  turn, further `ask` calls in that turn are denied without asking.

## Slack layer

Bolt in Socket Mode behind a narrow `SlackPort`, so the engine and runner are
tested without Slack.

- Inbound: accept `message` events with no subtype or `file_share`; drop our own
  `bot_id`; dedupe on `channel:ts` before any await.
- Kickoff: (a) `@council` on a message outside any council convenes the default
  preset in that message's thread; (b) the `/council` command or the "Start a
  council" message shortcut opens the roster modal.
- Posting: per-channel serial queue, at least one second apart, no automatic
  retry of a write whose outcome is unknown. Every Slack call has a finite
  timeout: a write gets one attempt of 15 s, then the queue moves on; reads
  retry at most twice. A member turn is one message: text over Slack's
  12,000-character `markdown_text` limit is truncated with a closing
  `… (truncated)` line. `@here`, `@channel` and `@everyone`
  are neutralised in member output outside code spans and fenced blocks.
- Reading: a channel council reads the newest 200 messages; a thread council
  reads up to 50 pages of replies through the trigger and fails with `E_SLACK`
  rather than drop the newest replies of a longer thread.
- Progress: ⏳ on the triggering message while a chain runs.

## State

`stateDir/councils.json`, written atomically: councils, private notes and
a bounded set of accepted human message keys, so a redelivery after a restart
cannot reopen a round. Slack remains the record of
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
