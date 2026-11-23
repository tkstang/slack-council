# Memories

What a returning agent should keep in mind: what is still true about this
project. Only the orchestrator writes this file, by hand; a lane proposes
learnings in its report. Correct or prune a bullet in place when it stops being
true, as `shape.md` is kept current. What happened goes in the project log, and
decisions about the work go in `decisions.md`.

One bullet per item, each with its date and source (a dispatch ID such as
`l07-d02`, a document, or the user):
`- <what to keep in mind> (<date>, <source>)`.

## User preferences

<!-- How the user wants things done: what they like, dislike or always ask for. -->

- This project doubles as a dogfooding run. Log friction with OAT setup, the
  freestyle workflow and the foundations scaffold in the gitignored
  `.council/dogfood-feedback.md` as it happens. Foundations fixes may be
  dispatched at once. Friction from user-level agent instructions belongs to
  the machine-config repository, where they are authored. OAT and freestyle feedback is discussed with the user
  before any issue is filed. Review the whole file with the user at wrap-up,
  then prune this bullet. (2026-11-23, user)
- Keep complexity scoped and tests proportionate: "We don't need to create
  forests of tests. We should have tests where they're useful, and they should
  be appropriately scoped." Extend an existing test before adding one. Put
  this in every implementer brief. (2026-11-23, user)
- When a decision has several options, show the choices and their trade-offs
  visually (inline HTML in the host app) when that conveys them more easily
  than prose. Front-load the decisions the user must make so a long run is not
  left waiting on them. (2026-11-23, user)
- Sol implements and Opus reviews for now because the user has Sol usage to
  spare; expect a swap later, and treat it as a reshape. (2026-11-23, user)

## Gotchas

<!-- Traps a later lane or session would otherwise fall into, and how to avoid them. -->

- A member reads Slack through three paths: the reply prompt, the private
  listening snapshot taken after a chain settles, and `slack_history`. A bound
  applied to only one leaves the others open. (2026-11-23, l01-d01)
- A lane dispatched with a T3 worktree starts from the orchestrator's commit,
  not `main`. Rebase it with `git rebase --onto origin/main <base>` before
  opening its PR. (2026-11-23, l01-d01)
- This repository does not ignore `.oat/analysis`, so lane notes go under
  `$TMPDIR`, not in the checkout. (2026-11-23, orchestrator)

## Context

<!-- Other facts that are still true and not obvious from the code or the documents. -->

- `lanes.md` records each lane's absolute worktree path and host thread ids,
  and these records are public. The user was told and chose to leave it.
  (2026-11-23, user)
- `@council stop` invalidates a pending approval at once; the approval card
  loses its buttons asynchronously, and a stale click cannot approve.
  (2026-11-23, l01-d01)
