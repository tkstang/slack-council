# Decisions

What this project chose about its work, and why. Only the orchestrator writes
this file, by hand; a lane proposes decisions in its report. How the project
runs belongs in `shape.md`, what to keep in mind in `memories.md`, and what
happened and when in the project log.

The Live section holds every current decision: on resume, read all of it. The
Superseded section keeps replaced decisions, for their history only.

Each decision is one entry, numbered `dr01`, `dr02`, ... in order and never
reused: a `### drNN · <decision statement>` heading, then its date, two to
four lines of why, its source (a dispatch ID such as `l07-d02`, a document, or
the user) and, when it replaces an earlier decision, `Supersedes: drNN`. The
replaced entry moves intact to the Superseded section, with
`Superseded by drNN, <date>` added to it.

## Live

### dr01 · A channel council reads nothing older than the message it was convened on

2026-11-23. Every council stores `convenedAtTs`. A channel council applies it as
an inclusive lower bound to the reply prompt, the private listening snapshot and
`slack_history`; thread councils are already bounded by their thread. A council
saved before the field existed loads without it and keeps its old window,
because its real start time is unknown.
Source: the user (decision after the 2026-11-23 live pass); details l01-d01.

### dr02 · Message numbers are handled by instruction only

2026-11-23. Members are told the `[#N]` transcript labels are internal and to
refer to a post by author and content. Member output is not stripped or
rewritten.
Source: the user ("instruction only makes sense here").

### dr03 · Four more PRs, in the order panel, guidance, caching, handoff

2026-11-23. The user's answers to the front-loaded decisions replace the planned
brainstorm; the advisor reviews the brief instead. The panel PR goes first
because the user wants to use their own panel while the rest is built, and it
changes the same prompt and config code the guidance PR builds on. Caching
follows guidance because the stable prompt prefix depends on the final layout.
Source: the user (decisions P1, P2); the panel-first ordering is the
orchestrator's.

### dr04 · Guidance is an instructions file plus the MCP handshake's own instructions

2026-11-23. `council.instructions` is a path to a Markdown file added to every
member's prompt. An MCP server marked `orientation: true` contributes the
`instructions` string from its initialize response, a standard optional field of
the protocol, so no orientation tool is needed. The project ships no council MCP
of its own until a workflow needs one.
Source: the user (decisions G1 to G3).

### dr05 · A preset is a named panel, and the convening notice describes it

2026-11-23. Presets stay the config's name for a panel. The notice posted when a
council is convened names the preset and lists each member's handle, model,
effort and persona title. A persona is optional: a title shown in Slack and
instructions placed in the member's prompt. A member without one is neutral and
the notice lists no persona for it. Members are named after their model family.
Source: the user (decisions N1 to N4 and their note with the answers).

### dr06 · Reply length is tiered by instruction: 120, 250, 1,000 words

2026-11-23. A member answers in about 120 words by default, about 250 when the
user asks for more detail or examples, and up to 1,000 when the user asks for
depth. A member that had more to say tells the user it stopped at the limit.
The limits are settings; the choice of tier is the member's reading of the
request, not code.
Source: the user (decision N6 and their note).

### dr07 · Reads run automatically and anything that writes or starts work asks

2026-11-23. Every member gets Slack history and reads of the user's knowledge
and session tools without approval. Writes to the vault and launching or
delegating a Switchboard session always ask.
Source: the user (decision N5 and their note).

### dr08 · A handoff is one approval with Approve, Reject and Change

2026-11-23. The member writes a handoff note to the vault and launches a
Switchboard session pointing at it, behind a single approval card. Change asks
the user what to alter, the member revises, and the card is presented again.
The council uses its own Switchboard token, minted by the user. The notes folder
is set in the user's private config.
Source: the user (decisions H1 to H3 and their note). The single approval
replaces the "both ask" option they first picked.

### dr09 · One Slack app, with agents kept out of the user's own channel

2026-11-23. The user has a private channel of their own for the council. Agents
never post or test there; live passes stay in the test channel. The app runs as
a background process from the orchestrator's session for now.
Source: the user (decisions S1 to S5).

### dr10 · A mention can name a preset with `preset:<name>`

2026-11-23. A mention that convenes a council may carry one `preset:<name>`
token (`preset=<name>` is accepted too) to pick a configured preset; without
it the default preset is used. An unknown name convenes nothing and the app
replies with the configured names. The token is an explicit convention, not
natural-language parsing.
Source: the user asked for preset by mention and left the convention open; the
`key:value` form is the orchestrator's choice (it mirrors Slack's search
modifiers, and Slack's composer rewrites a leading `--`).

### dr11 · The app moves to a launchd agent on the user's server once it is stable

2026-11-23. The long-term home is a launchd agent on the user's server Mac,
set up through their machine configuration repository like their other
services. Until the app is stable, the orchestrator starts it from its session
when it is needed (dr09). The move is not part of this project. The user's own
council channel is named `councils`, because Slack reserves the app's name.
Source: the user.

## Superseded

_None yet._
