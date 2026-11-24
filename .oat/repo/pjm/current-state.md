# OAT Current State

This file is the active operating picture and lives under `pjm/` (the
operational layer), not `reference/`. To reduce cross-worktree conflicts, keep
edits append-mostly and scoped to the section you own; avoid rewriting whole
sections another branch may also touch.

## Canonical References

<!-- List durable repo references, source-of-truth docs, dashboards, or processes here.
Decisions live in reference/decisions/ (one file per record); link them rather than
copying their content here. -->

- `docs/design.md`: how the app behaves and why.
- `docs/live-checks.md`: the live checklist and the log of each run.
- `README.md`: setup, configuration and the verification policy.

## What's Implemented

<!-- Summarize shipped capabilities and important repo conventions here. -->

- The MVP (#1): a council convened by mention, slash command or message
  shortcut, in a thread or a whole channel, with member tools behind an
  `auto` or `ask` policy.
- The follow-ups (#3, #4, #6 to #9), 2026-11-23:
  - a channel council reads nothing older than its convening message;
  - the convening notice names the preset and lists the panel, and reply
    length is tiered;
  - operator guidance from an instructions file and from an MCP server's
    initialize instructions;
  - the stable part of each prompt is set up for provider prompt caching;
  - a mention can pick a preset with `preset:<name>`;
  - a member can hand work off to a coding session through one approval.

## What's Next

<!-- Track near-term follow-up work, known gaps, and active handoff context here.
Track concrete items in pjm/backlog/ and sequencing in pjm/roadmap.md; keep this
section to a short narrative pointer. -->

- No project is active. Open work is in `backlog/index.md`.
- The app still runs from a developer's session. Running it as a managed
  service is the operator's to set up and is not tracked here.
