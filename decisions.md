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

## Superseded

_None yet._
