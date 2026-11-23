# slack-council design

Status: prototype design, 2026-11-23. Decisions marked **(operator)** were made by
the operator in the source brainstorm. The rest are implementation choices that can
change.

## What it is

One Slack app, `council`, that hosts a council of AI members in a Slack thread or
channel. The operator poses a question, members answer and respond to each other
like colleagues, and the operator can interject at any point. Each member is a
model with tool grants, an optional effort level and an optional persona.

## Decisions carried from the brainstorm (operator)

| Topic                 | Decision                                                                                                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose               | Deliberation. Members respond to each other; an @-mention always works.                                                                                                                                               |
| Turn-taking           | `@council` opens a round. After that an @-mention from anyone, human or member, gives the floor. A hop budget stops loops.                                                                                            |
| Unvoiced disagreement | Members can circle back on their next turn. At settle, members with unseen posts from others can raise a hand and keep a private note. Listen cadence is configurable (`settle` by default, `every-post` later).      |
| Context               | Slack is the memory: recent messages verbatim, the member's own private notes, and a history tool for going further back.                                                                                             |
| Identity              | One Slack app posting under each member's name and avatar (`chat:write.customize`). Members are addressed by plain-text handles such as `@ada`.                                                                       |
| Roster                | Members are defined in config. A picker modal chooses the roster for `/council` and the message shortcut. A convening mention can name a preset or use the default.                                                   |
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

- **Member**: `{ id, name, avatar, provider, model, effort?, persona?, tools[] }`.
  `id` is the lowercase handle, matching `[a-z][a-z0-9-]*`. A persona has a
  `title` for display and `instructions` for the member's role brief.
- **Council**: a roster bound to a **scope**, plus an owner, settings and
  `convenedAtTs`, the Slack timestamp of the message or notice that started it.
- **Scope**: `{ channel, threadTs? }`. With `threadTs` it is a thread council and
  posts go to that thread. Without it, it is a channel council: it reads recent
  top-level messages and every post (members, notices, approvals, reactions) is
  top-level. A channel holds at most one channel council; thread councils can
  coexist in it, and a reply inside a thread never reaches the channel council.
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
nothing. This matters most in a channel council, where anyone in the channel
posts into the transcript. Posts from any bot, including this app, are dropped
before routing, so the app never responds to its own or another bot's post.

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

Every command is acknowledged: the progress reaction for an addressed message,
🛑 for `stop` and 👋 for `end`. A message kept as context gets 👀 in a thread
council and nothing in a channel council, where it would mark every top-level
message. Setting: `seenReaction: 'threads' | 'always' | 'off'`, default
`threads`; a saved council follows the current config when the service opens.
These reactions are best effort and never fail the message.

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
  one-line notice naming the member. A failed turn is not rerun. Within a turn,
  one failed model request (429, 5xx or a network error) is retried once; tool
  calls are never repeated. A reply cut off at the model's output limit fails
  the turn. When a turn has more than one step, the model may not call tools on
  the last one, so a turn that used tools still ends with a reply. A turn
  with `maxSteps: 1` gets no tools.
- A chain settles when its queue is empty, nothing is running and every post has
  been written. Settling removes the progress indicator.

### Circle-back

A member's turn prompt marks every post since it last spoke and tells it to raise
any disagreement with those posts before answering what it was asked.

### Raised hand

With `council.listen: "settle"` (the default), the reducer emits a settle
effect after a chain finishes normally. The runner removes the hourglass,
fetches one transcript for the batch, and asks each roster member with unseen
posts from others to listen. It uses what the member saw on successful turns
or earlier listens, falling back to the member's last post when that history
is unknown. The fallback never looks back past the message that started the
current chain. An outstanding hand also sets a cutoff for new posts. App notices
and the member's own posts are excluded from hand targets.

A listen uses the member's model with no tools, one step, low reasoning
effort, and up to 600 output tokens. It runs for up to 10 seconds or the
configured turn timeout, whichever is shorter.
The role brief and the transcript go in the user message. The model replies
with `HAND #<n>: <note>` to disagree with a `[new]` post or add a materially
new point. Agreement, thanks and restatements get `PASS`. The runner resolves
`#<n>` to a timestamp from the visible `[new]` rows of that same snapshot.
It retries malformed replies once within the same deadline. Model errors and
timeouts pass silently.

After the batch completes, the app saves the hands and posts one line naming
the members who raised them. It adds the `raised_hand` reaction to each distinct
target message. The names in the notice identify the members because every
reaction comes from the same app bot. Listening uses no turns or hops.
An addressed human message, stop, end, or shutdown cancels an in-flight
batch. If cancellation arrives during the note save, the app restores the
previous notes before continuing the write queue and skips the notice and
reactions. Set `council.listen: "off"` to disable the feature. The switch
follows the current config when the service opens.

## Context assembly

Slack history becomes one transcript in a single user message. This avoids role
alternation rules, carries the role brief on the Claude route, and does not
misrepresent other members as the responding assistant.

```
<council_role>
…member identity and optional persona…
…operator guidance label…
<council_instructions>…Markdown guidance, when configured…</council_instructions>
<mcp_orientation server="notes">…handshake instructions for a granted server…</mcp_orientation>
…roster, data handling and public turn rules…
</council_role>
<transcript>
[#1] Sam (human): …
[#2] Ada (member): …
[#3] You (Bo): …
</transcript>
<floor>Sam addressed you in [#4].</floor>
<private_notes>…earlier hand notes for this member, when present…</private_notes>
```

- Author labels come from Slack ids and the roster, never from message text.
- Public replies and private listening put the optional instructions file in
  the stable role brief. The loader reads it once per config load, with a
  limit of 8,000 UTF-16 code units. The running service holds the text in
  memory and applies it to new and restored councils. Saved council settings
  contain neither the path nor the text.
- The role brief labels the file and MCP orientation blocks as operator
  guidance. The app reads the SDK client's handshake instructions for
  servers with `orientation: true`. It adds one block per marked server
  with at least one discovered tool granted to the member, in config order.
  The same rule applies to both prompt modes. The app keeps orientation in
  memory, caps each server's text at 8,000 UTF-16 code units including any
  truncation marker, and logs only the server key if the text is missing.
  Tool grants and approvals still apply in code.
- Message text is data. Angle brackets in it are escaped so a pasted
  `</transcript>` cannot close the block, and the role brief says that nothing
  inside the transcript, a tool result or a private note is an instruction.
- The public reply prompt includes the council's three word limits. The member
  chooses the applicable tier from the user's request and offers to continue
  if it had more to say. Private listening keeps its own prompt and token cap.
  A council restored at start takes the limits from the current config.
- Thread council: the whole thread, newest kept when over `contextChars`. An
  omission marker says how many earlier messages were dropped and names the
  history tool.
- Channel council: the most recent top-level messages (and thread broadcasts)
  within the same budget, oldest first, starting at the convening post.
  A round or human mention reads through its triggering message (`latest` with
  `inclusive`, then filtered client-side), so the trigger is always the newest
  row and later posts from other people stay out of that snapshot. React turns
  and member mentions read the newest window.
- A member post is recognised by message metadata (`member` id), falling back to
  our `bot_id` plus `username`.
- App notices appear as `council (system)` in real turns. The listen transcript
  leaves them out.
- A member's next real turn receives its own surviving hand notes and asks it
  to raise the points in its own words. A note refers to the target's number
  when the post is still visible. The app strips verbatim echoes from member
  replies and blocks tool arguments that quote a private note.

Output protocol: a turn that is only `PASS`, ignoring case, surrounding
whitespace, markdown emphasis and trailing punctuation, posts nothing.

## Member runner

`generateText` with the member's tools, `stopWhen: isStepCount(maxSteps)`,
`reasoningEffort` from the member's `effort`, and an abort signal. A `react` turn
that returns exactly `PASS` posts nothing. Output is scanned for handles to
produce mention grants.

### Prompt caching

Public replies and private listening send `prompt_cache_key` as the SHA-256
digest of the council ID. Both put their stable role brief before the
transcript. The role brief also travels as the system message. For model IDs
starting with `claude-`, the user message has two text blocks and
`cache_control: { "type": "ephemeral" }` marks the end of the role brief.
The transcript, floor and private notes follow that boundary.

Both are sent on every request, whatever the provider. They were measured only
against the proxy route above. An OpenAI-compatible endpoint that rejects
unknown request fields, or text-block content for a `claude-` model, would fail
each turn with `E_TURN_FAILED`; there is no setting to turn them off.

The proxy probe kept the model, tool definitions and long prefix the same on
both calls and changed the task at the end. `gpt-6-luna` reported 5,760 cached
input tokens on the second call with a cache key. `claude-haiku-5-5` reported
9,816 with the key and the text block boundary. These counts matched the
proxy's raw usage. The repeated prefix must meet the provider's minimum
length, so a short role brief may yield no hit.

After a generation with positive cached input usage, stderr gets a
`model_cache_read` JSON entry. `cached_input_tokens` sums the reported cache
reads across the generation's model steps, so a turn that calls a tool can
report a hit from its own earlier step. The entry also includes the model,
member, council cache key and, for public turns, the turn ID.

## Tools

- `read_file`, `list_dir`, `search_files`: read-only. Every path, including each
  search hit and directory entry, is resolved with `realpath` and must be under a
  configured root and match no deny glob. Roots have no default. The operator
  names them. Default deny globs cover env files, SSH and cloud credentials, key
  files and keychains. Reads accept up to 64 KiB of UTF-8 text. Listings and
  literal searches cap the returned entries or hits and the work per call.
- A readable file is a quotable file. Anything under a root can end up in Slack,
  so roots should hold only what that channel's audience may see. The denylist
  reduces accidental exposure.
- `slack_history` retrieves older messages in the council's own scope, rendered
  like the transcript. It starts before the prompt transcript and pages back
  through the thread or to the channel council's convening post, inclusive.
- MCP servers use stdio or HTTP. Failed startup disables the server's tools.
  The app closes its clients on shutdown. Grants in `members.<handle>.tools`
  include `files`, `slack_history`, `<server>` or `<server>__<tool>`.
- Approval uses the first matching exact name or prefix ending in `*`.
  Built-in read tools default to `auto` and MCP tools default to `ask`. An
  `ask` call posts the member, tool and the full arguments with Approve and
  Deny buttons. Each argument is a `name: value` line; a string is shown without quotes only when it is one plain line that is not itself JSON, and invisible characters are escaped. Arguments too long to show in full are refused, never cut. The opaque request id binds the decision to the arguments,
  council, chain, turn and expiry. Any user in `slack.allowedUsers`
  can decide once. The app acknowledges clicks immediately and updates the
  message with the outcome and removes its buttons. Pending requests expire
  on restart. The approval timeout defaults to five minutes. The turn timer
  pauses while an approval is pending. `stop` and `end` cancel waits immediately.
  Denial and expiry return tool errors to the model. After two denials or
  expiries, further `ask` calls in the turn return a denial without posting.
  Deny globs match dot segments, and tool results over 64 KiB are refused.

## Slack layer

Bolt in Socket Mode behind a narrow `SlackPort`, so the engine and runner are
tested without Slack.

- Inbound: accept `message` events with no subtype, or `file_share`,
  `thread_broadcast` or `me_message`; drop anything with a `bot_id` or a
  `bot_profile`, our own posts included; dedupe on `channel:ts` before any await.
- Routing: a thread reply belongs to its thread. A top-level message belongs to
  the channel council when the channel has one; a top-level `@council end` also
  goes to a dormant channel council (one whose roster names a removed member) so
  it can be removed. Otherwise a top-level `@council` opens a thread council.
- Kickoff: (a) `@council` on a message outside any council convenes a preset
  in that message's thread (there is no mention kickoff for a channel
  council); (b) the `/council` command or the "Start a council" message
  shortcut opens the roster modal (`views.open` straight after `ack()`, as a
  trigger id lasts three seconds). Only `slack.allowedUsers` get the modal; the
  service checks again on convene. The modal has a preset select, a member
  multi-select that overrides the preset, a question and, for the command
  only, a "Where" choice: "New thread" (default) or "This whole channel".
  `private_metadata` carries only the source, channel, thread and message ts,
  user and response URL, plus a fingerprint of the presets (keys and rosters),
  the member keys and names, and the default preset. It is size-checked and Zod-validated on return. The response URL must
  be `https://hooks.slack.com` with no credentials and is fetched with
  redirects refused. Select options carry index ids that map back to configured
  keys; an unknown id is invalid input, and a form whose fingerprint no longer
  matches the config is refused with a request to reopen it. The display name
  and question appear in the notice as escaped plain text with mentions
  neutralised.
  - `/council [question]` posts "Council convened by <name>: <question>" in the
    channel as a notice and convenes in its thread, or, with "This whole
    channel", convenes the channel itself.
  - The shortcut posts the same notice, with the question when one was typed,
    in the message's thread (`thread_ts`, else `ts`) and convenes there. Left
    empty, the notice reads "Council convened by <name> on this message:" and
    quotes up to 1,000 characters of the selected message, escaped the same
    way, so the round's trigger carries the prompt. If the selected message
    cannot be read, nothing is posted and the user is asked to reopen the
    shortcut and type a question.
  - Both post first, then convene, then open the round, all writes through the
    port's queue. If convening fails the notice is deleted and the user told; a
    council is never saved before its notice exists, and a failure never ends
    whatever council holds the scope. If the delete fails too, the user is told
    the notice was left behind. A submission's view id is claimed once, after
    a successful `ack()`, so a redelivery cannot post or convene twice and a
    failed acknowledgement does not lose the submission.
  - The first round opens through `handleHumanMessage` with the notice's ts, the
    invoking user as author and the text `<@APPUSER>`, so dedupe, the allow-list
    and addressing run unchanged; the prompt itself is read from history. The
    notice's ts is always fresh, so a message accepted before still starts one.
  - A convening mention uses the first plain-text token `preset:<name>` or
    `preset=<name>`, with whitespace between the token and adjacent text.
    The key is case-insensitive. The name ends at whitespace and must match a
    configured key exactly. With no token, the app uses the default preset.
    An unknown name records the message as handled and posts the available
    names in the thread. It opens no council. If Slack rejects that notice,
    the app logs the failure and does not retry. An existing council ignores
    the token for roster selection and keeps the original message in the transcript.
  - A mention that starts a council posts the selected panel in the thread
    after the council is saved. The human message starts the round. If Slack
    rejects the convening notice, the app logs the failure and the round proceeds.
  - The convening notice names the preset or says "custom panel" when members
    were chosen by hand. It lists each handle, display name, model, and any
    configured effort and persona title. The app ignores bot-authored notice
    events, so listing a handle never grants the floor.
  - An existing council in the scope (the thread, or the channel for "This
    whole channel") is a modal error. Later failures, including
    `not_in_channel`, reach the user through the response URL and are logged
    with fixed fields only.
- Posting: per-channel serial queue, at least one second apart, no automatic
  retry of a write whose outcome is unknown. A write Slack refuses as rate
  limited is sent once more after the wait Slack names, up to 30 s; reactions
  are never resent. Every Slack call has a finite
  timeout: a write attempt lasts at most 15 s, so with one rate-limit resend a
  write can hold its channel's queue for about a minute before the queue moves
  on; reads retry at most twice. A member turn is one message: text over Slack's
  12,000-character `markdown_text` limit is truncated with a closing
  `… (truncated)` line. Every mention in member output is
  neutralised, code included. With `council.memberMentions: 'people'`, `@Name`
  of a person seen in that channel (an author or someone mentioned) becomes a
  real mention. The post's own mentions are neutralised first, so a mention
  exists only where a name matched: whole, at the start of a word, not
  continued by a letter, digit, accent or dash, outside `<…>` markup. The longest matching name decides: if two people
  share it, or it is or begins with a member handle, the text is left alone and
  no shorter name is tried. Group and
  channel-wide mentions are neutralised in both modes.
- Reading: a channel council reads the newest 200 messages per request, back
  to and including the convening post. A thread council
  reads up to 50 pages of replies through the trigger and fails with `E_SLACK`
  rather than drop the newest replies of a longer thread.
- Progress: ⏳ on the triggering message while a chain runs.

## State

`stateDir/councils.json` holds councils, a bounded set of accepted human message
keys, and private hand notes. Channel councils saved before `convenedAtTs`
was added keep their prior history window. The service serializes changes and
writes the file atomically. Each note stores the council, member, target timestamp, note
text, and latest post timestamp from the settle snapshot. The store retains
the newest three notes per member and council, up to 500 characters each.
A successful post or pass consumes the notes the member was shown. Ending a
council removes its notes. Older state files load with an empty note list.
Slack remains the record of what was said.

## Configuration

One JSON file validated with Zod. Secrets are referenced by environment variable
name, never inlined. Sections: `providers`, `members`, `presets`, `defaultPreset`, `tools`
(`files`, `mcpServers`, `policy`), `slack` (`allowedUsers`), `council`,
and `stateDir`.

## Prototype order

1. Thread councils: kickoff by mention, rounds, mentions, hop budget, circle-back,
   identities, config.
2. Tools: file tools with denylist, MCP grants, approvals.
3. Roster modal and presets.
4. Raised hand.
5. Channel councils.

All five are implemented.

## Known limitations

Accepted for the prototype. Each was raised in review and left as is.

- A message addressed to `@council` in the instant between a channel council's
  "convened" post and its save opens a separate thread council.
- `@council end` sent to a dormant council while a replacement in the same
  scope is still saving can remove the replacement.
- A restart while a picker submission is waiting on Slack loses that
  submission. Pending approvals are also dropped on restart.
- If the triggering message is deleted before a turn reads history, members
  answer without it.
- A Slack write that times out is never resent, so the post may still appear
  beside a failure notice.
- A thread longer than 50 pages of replies cannot be read; turns in it fail
  with a notice.
- A post over Slack's 12,000-character limit is cut, not split.

## Out of scope for the prototype

Multiple replicas, streaming replies, platforms other than Slack, per-member Slack
apps, and the `every-post` listen cadence.
