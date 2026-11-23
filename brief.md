# Project Brief: mvp-followups

Started from the `plan-brief` template and cut down for a freestyle project.
One phase per PR. How the project runs is in `shape.md`; the user's decisions
are in `decisions.md` (dr01 to dr09) and are not repeated here. Lanes and their
reviews are tracked in `lanes.md`. The advisor reviewed this design on
2026-11-23 (ready with changes); all six findings are folded in below.

## Goal

Ship the follow-ups agreed after the MVP merged, so the user can run their own
panel day to day: bounded channel history, a panel that says who is on it,
operator guidance, cheaper repeated turns, and a handoff to a coding session.

## Outcomes

1. A channel council reads nothing older than its convening message. Evidence:
   live-check rows 11 and 12 with older messages above the convening post.
2. Convening a council posts which preset was used and each member's handle,
   model, effort and persona title. Evidence: a live check of the notice.
3. A member's default reply is about 120 words and grows only when the user
   asks, and a member that stopped at a limit says so. Evidence: a live check
   with a follow-up asking for more detail.
4. Text from the operator's instructions file, and from an MCP server marked for
   orientation, reaches every relevant member's prompt. Evidence: a live check
   where a member follows an instruction that exists only in the file.
5. A second turn in the same council reads its stable prompt prefix from the
   provider's cache. Evidence: cached-token counts in the usage log, per model
   family, or a recorded statement that a family cannot be shown to cache.
6. A member can hand work off: one approval card, then a note in the vault and
   a launched session that points at it. Evidence: a live check ending in a
   real launched session, and one pass through Change.

## Approach

Sequential lanes, one per phase, each on a branch from `main` once the previous
PR has merged. A phase's live pass uses the test channel and cheap models only.

### Design

**Panel (p02).**

- `members.<id>.persona` becomes optional and structured:
  `{ "title": "Sceptical reviewer", "instructions": "..." }`. The title is shown
  in Slack; the instructions go into that member's prompt. No persona means no
  `Persona:` line at all. The plain-string form is removed, with no
  compatibility shim: the app has no other users yet.
- The convening notice gains a panel block: the preset name (or "custom panel"
  when members were picked by hand), then one line per member with handle,
  model, effort when set, and persona title when set. It is posted however the
  council is convened: slash command, message shortcut or mention.
- `council.replyWords` holds three limits, defaulting to
  `{ "default": 120, "detailed": 250, "max": 1000 }`. One prompt instruction
  explains them: default length normally; the detailed length when the user
  asks for more detail, explanation or examples; the maximum when the user asks
  for depth. A member that had more to say ends with one short line saying it
  stopped at the limit. The member chooses the tier from the request; no code
  classifies messages. The tiers apply to public replies only; private
  listening keeps its own short cap.
- The picker carries the chosen preset name, or "custom panel", through to its
  notice. A mention that starts a council posts the default preset's notice
  once, and the user's message stays the round's trigger. Both paths share one
  formatter.

**Guidance (p03).**

- `council.instructions` is a path to a Markdown file, resolved against the
  config file's directory. It is read once at start; a missing or oversized
  file fails `validate` and `start`. Its text goes in every member's prompt in
  its own labelled block, ahead of the transcript.
- An MCP server entry accepts `"orientation": true`. At connect, the app keeps
  the `instructions` string from that server's initialize response and adds it,
  labelled with the server name, to the prompt of each member granted at least
  one tool from that server. Size is bounded. A marked server that returns no
  instructions logs a warning and contributes nothing.
- The file and the orientation text are operator configuration, so they sit in
  the trusted part of the prompt: marking a server for orientation is the
  operator entrusting it to give guidance. Permissions stay in code.
  Transcript text, private notes and ordinary tool results stay data.

**Caching (p04).**

- The prompt is laid out with everything stable for a council first (role
  brief, persona, instructions, orientation, roster) and everything that
  changes last (transcript, task).
- Each request carries a per-council cache key. The model adapter forwards
  extra fields only under the provider's own name in provider options, not
  under the generic namespace used for effort. Private listening needs the
  council id to carry the key too.
- A key alone guarantees no hit. A hit needs the same member, model and tool
  definitions with an identical prefix above the model's minimum, and Claude
  routes may need an explicit cache boundary. The adapter reports an absent
  cached-token count as zero, so only a positive count on a second turn is
  evidence. The role brief stays in both the system and user message, because
  one tested route ignores `system`; both copies are stable.

**Handoff (p05).**

- A built-in `handoff` tool, granted per member like the others. Its input is a
  note (title and Markdown body), a target (machine and project) and a short
  launch prompt.
- It always asks, even under a wildcard `auto` policy rule. The underlying
  write and launch tools are called only by the composite and are not granted
  to members. The app generates the note's filename under the configured
  folder. One card shows exactly what will run: the resolved note path, the
  full note, the machine, the project and the launch prompt. A handoff too
  long for the card is refused with a request for a shorter one.
- Approve writes the note, confirms the write succeeded (an MCP call can
  resolve with an error flag), checks for cancellation, then launches. A
  failed write launches nothing. If the note exists and the launch fails or
  its outcome is unknown, the member is told the note path and the launch
  status, and nothing is replayed automatically.
- The card has Approve, Reject and Change, on this card only. Change collects
  the user's text in a modal, rechecked against the ticket, its deadline and
  the user, and returns it in a distinct `changes_requested` field. The
  member's prompt says that field, unlike other tool results, is the user's
  instruction to revise and ask again. Reject, expiry, stop and a stale modal
  run nothing. The existing per-turn approval and step budgets bound repeats.
- Config names the vault server and write tool, the Switchboard server and
  launch tool, and the notes folder, so no private path is in the repository.
- Switchboard reads run without approval through ordinary MCP grants and
  policy; this phase adds no code for them.

## Constraints and Out of Scope

- **Constraint:** public repository. No private paths, ids or tokens in code,
  docs, commits or these records.
- **Constraint:** proportionate tests (root `AGENTS.md`): extend an existing
  table before adding a suite.
- **Constraint:** no Slack manifest or scope change without the user.
- **Out of scope:** choosing a preset by mention (the slash command and the
  shortcut already offer presets); a council MCP server of the project's own;
  the picker simplification; library exports; a dedicated proxy key.

## Known Unknowns

- Whether `@ai-sdk/mcp` exposes the initialize response's `instructions` at
  runtime. The advisor verified the getter with an in-memory handshake
  (2026-11-23); p03 confirms it against a live server.
- Whether the proxy forwards a cache key and reports cached tokens for both
  model families. Settled 2026-11-23 (l04-d01): yes for both. GPT models hit
  with the key alone; Claude models need a cache boundary on a text block and
  ignore the key.
- The exact vault write and Switchboard launch tool inputs. Settled by: p05.

## Delivery endpoint and authority

- **Endpoint:** merged. Each phase is delivered when its PR is squash-merged to
  `main` with CI green and its live-check line recorded.
- **Authority:** the user approved this plan through their decision answers.
  The orchestrator merges after a clean independent review and green checks
  (`shape.md`).

## Phase p01: Small follow-ups

**Intent:** The channel-council floor, the instruction that transcript numbers
are internal, and a live-check row for stop during an approval.
**Exit evidence:** PR #3 merged; live-check rows 11, 12 and 15 pass on its build.
**Provisional:** no

## Phase p02: Panel

**Intent:** Optional structured personas, the panel block in the convening
notice, and tiered reply length.
**Exit evidence:** PR merged; live check of the notice and of a follow-up that
asks for more detail.
**Provisional:** no

## Phase p03: Guidance

**Intent:** The instructions file and MCP orientation.
**Exit evidence:** PR merged; a member follows an instruction that exists only
in the file, and acts on a harmless marker that exists only in a marked test
server's orientation text. Prompts are not logged.
**Provisional:** no

## Phase p04: Prompt caching

**Intent:** A per-council cache key and a Claude cache boundary after the stable prompt prefix.
**Exit evidence:** PR merged; cached-token counts on a second turn, per family.
**Provisional:** no

## Phase p05: Switchboard handoff

**Intent:** The `handoff` tool with one approval and Approve, Reject, Change.
**Exit evidence:** PR merged; a live handoff that launches a real session, and
one pass through Change.
**Provisional:** yes
