# Shape: mvp-followups

How this project runs, agreed with the user in the shaping conversation. The
orchestrator and the user own this file; OAT never parses it. Read `AGENTS.md`
for the fixed rules.

The eight sections from Goal to Reshape checkpoints are the shaping topics, in
order. `_Not yet shaped._` marks a topic still to discuss, and shaping resumes
at the first one. A topic is shaped when it holds the agreed answer or says it
is deferred to the Undecided section. Shaping is complete when every topic is
shaped. The Project log section is a default, not a question.

**Last shaped:** 2026-11-23

## Goal

<!-- The outcome, what done means, and how large the project is. The size sets how much of the rest is worth asking. -->

**Outcome.** Ship the follow-ups agreed after the MVP merged:

- the channel-council floor: a channel council never reads messages older than
  the one it was convened on (inclusive), in the prompt transcript and in
  `slack_history`;
- an instruction telling members that `[#N]` message numbers are internal;
- a live-check step for `@council stop` while a turn waits on a tool approval;
- prompt caching: the stable part of the prompt first, with a per-council
  cache key;
- pluggable guidance: an always-on instructions file and orientation from a
  designated "council MCP" server;
- Switchboard handoff by note.

**Done means.** Each item is merged to `main` with CI green and a live-check
log line for the behaviour it changed, or is recorded as dropped. The open
design questions are settled in `decisions.md`.

**Size.** A few PRs over several days.

**Out of scope.** The picker simplification, the library exports, renaming
members to model names, and the dedicated proxy key. They go to the PJM
backlog.

**Proportion.** This is public code. Keep complexity scoped to what each item
needs. Tests go where they protect something; no forests of tests (root
`AGENTS.md`, "Proportionate tests").

## Brainstorm or discovery

<!-- Whether to brainstorm (oat-brainstorm) or run an informal discovery pass before going on, and where the result lives. Offered only after the goal is written. -->

Brainstorm the guidance layers and the Switchboard handoff flow with
`oat-brainstorm` before the brief is written. Not started; its result will be a
reference file in this project's `brainstorming/` folder. Prompt caching and
the three small items (floor, message numbers, stop during approval) are
already decided and need no brainstorm.

## Documents

<!-- The documents this project keeps (a brief, a plan, a journal, its own pattern) and the template each started from. -->

- `brief.md`: one brief with a phase per PR, started from `plan-brief` and
  adapted. Written after the brainstorm.
- No separate journal. Decisions about the work go in `decisions.md`; lane
  reports record what each dispatch did.

## Execution

<!-- A single agent, or an orchestrator with lanes. Lane placement is left to the orchestrator. -->

An orchestrator dispatching lanes. Independent work runs in parallel, for
example the three small items while the brainstorm is under way.

Model routing, set by the user on 2026-11-23 (all through T3 delegation; the
user may swap implementer and reviewer later):

| Role | Model | Effort |
| --- | --- | --- |
| Implementer lanes | GPT-6.2 Sol | high |
| Reviewer | Claude Opus 5.5 | high |
| Live Slack testing by desktop control | GPT-6.1 Terra, with the `desktop-control` skill | high |
| Advisor: second opinions, design and plan reviews | GPT-6.2 Astra | xhigh |

Models used by the app under test stay on the cheap tier the repository's live
checks name.

## Reviews

<!-- When reviews happen, then who and how. Record each as intent (when, required independence, effort) and mechanism (tool or skill, host, source, date verified). When a review comes due, re-check its mechanism first; if it is unavailable, keep the intent, tell the user and log it. Freestyle adds no review gate; a review an adopted plan requires must still pass (its agreed mechanism or an equivalent check) before the work it guards moves on. -->

**Every PR, before merge. No PR is waived, however small** (in effect from
2026-11-23, including PRs already open).

- Intent: an independent correctness review by a different model family from
  the implementer, high effort, one round plus one confirmation round. The
  self-review lenses not covered by it (testing, complexity, docs) are filled
  by `pr-self-review`.
- Mechanism: Claude Opus 5.5 high through T3 `delegate_task`, read-only; the
  `pr-self-review` skill (user scope). Source: the user, and the user's
  instruction file. Models listed by T3 capabilities on 2026-11-23; the review
  route itself is unverified until first use.

**Design and plan documents, as they are drafted.**

- Intent: a second opinion on the brainstorm result, the brief and any
  architectural design, from a different model family, extra-high effort.
- Mechanism: GPT-6.2 Astra xhigh through T3 `delegate_task`, read-only.
  Source: the user. Listed by T3 capabilities on 2026-11-23; unverified until
  first use.

**Live Slack pass, for changes to the Slack adapter, turn runner, tools or
approvals.**

- Intent: the affected rows of `docs/live-checks.md` run against the real app
  in the test channel before merge.
- Mechanism: the orchestrator runs the app; when the pass needs someone to act
  in Slack, a GPT-6.1 Terra high agent drives the Slack desktop client with the
  `desktop-control` skill. Source: the user. Listed by T3 capabilities on
  2026-11-23; unverified until first use.

## Commits, PRs and merges

<!-- Who commits and when, when PRs open, who merges. Until this is shaped, nothing is committed or pushed. -->

- **Code.** Lanes commit on their own branches. The orchestrator commits,
  pushes code branches and opens PRs against `main` without asking.
- **Records.** The orchestrator publishes project records with
  `oat project push` after each change. They go to a public remote, so nothing
  private goes in them.
- **Merges.** The orchestrator merges, without waiting for the user, once a
  PR's review is clean (findings fixed or dispositioned) and its required
  checks are green. Squash merges. This holds for work inside the high-level
  plan the user has agreed, until the user says otherwise. In effect from
  2026-11-23, including PRs already open.

## User involvement

<!-- What the user approves, and what they are only told. -->

**Approves before it happens:** the high-level plan (the features to ship);
open design decisions; Slack app
manifest or scope changes; tokens and secrets; writes to the user's vault;
filing feedback against OAT.

**Approved in advance for this project (2026-11-23):** desktop control of the
Slack client on the development machine by the live-testing agent, for any
live pass the project needs. Other desktop control still needs approval, and
the standing limits on it (no permission, password or payment dialogs) hold.

**Is told:** commits, pushes, opened PRs, lane dispatches, review findings and
their dispositions, and merges.

## Reshape checkpoints

<!-- The moments to revisit this shape, for example after the first PR merges or when a lane is added. At each one, and when a plan written after shaping is accepted, ask two questions. Does the shape still fit? Is the plan and its process proportionate to its value? Test the second by process time against code time (above about 3x needs a stated reason), by what risk each safeguard covers and whether that risk exists now, and by the lightest process that keeps the real gates (the reviews and approvals the owner or the repository requires). A "no" goes to the owner as a recommendation, even in an unattended run. -->

- When the brief is accepted after the brainstorm.
- After the first PR merges.
- If a second machine or orchestrator thread joins.
- If the user swaps the implementer and reviewer models.

## Project log

The project log (`project-log.md`, when enabled) records what happened and
when: judgment entries (a reshape's decision with its reason, surprises,
lessons learned) and structural entries for events that matter to the
project's story, written only with `oat project log append`. Operational churn
stays out of it. Decisions about the work live only in `decisions.md`, and a
`decision` entry may cite one by its `drNN`; what is still true goes in
`memories.md`. Every reshape attempts a `decision` entry; this file stands
alone when an append is skipped.

## Undecided

<!-- One line per deferred item: the item, and the moment it becomes due (for example "before the first PR"). Check these on every resume. -->

_None yet._
