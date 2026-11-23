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
- Sol implements and Opus reviews for now because the user has Sol usage to
  spare; expect a swap later, and treat it as a reshape. (2026-11-23, user)

## Gotchas

<!-- Traps a later lane or session would otherwise fall into, and how to avoid them. -->

_None yet._

## Context

<!-- Other facts that are still true and not obvious from the code or the documents. -->

_None yet._
