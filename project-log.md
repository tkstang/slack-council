---
oat_generated: false
purpose: project-observations
oat_last_updated: 2026-11-23
---

# Project Log: mvp-followups

Append-only evidence of what broke, surprised, or worked: write entries only with `oat project log append` (see its `--help`), never edit a prior entry, and never record secret values.
Contract, entry grammar and roll-up: https://voxmedia.github.io/open-agent-toolkit/workflows/projects/execution/project-log

## Entries

### 2026-11-23 · project · feedback · Reshape: reviews and merges

**Category:** decision
**Source:** reshape-20261123T212537Z-merges-8833c974
**Recorded:** 2026-11-23T21:25:37Z

Every PR gets an independent review before merge, with no waiver for small PRs, and the orchestrator merges once the review is clean and checks are green instead of waiting for the user. The user asked for this so work inside the agreed high-level plan does not wait on them. In effect at once, including the open adoption PR.

### 2026-11-23 · structural · orchestrator · l01-d01

l01-d01 delivered the channel history floor, the internal transcript-label instruction and the approval-stop live check on feat/small-followups at be8c958; its clean-checkout gate passed (246 tests, build). key:log-b2b67cd30359

### 2026-11-23 · project · feedback · Reshape: user involvement

**Category:** decision
**Source:** reshape-20261123T213804Z-involvement-5ba0bfca
**Recorded:** 2026-11-23T21:38:04Z

The user approved in advance all desktop control of the Slack client by the live-testing agent for this project, so live passes no longer wait for a per-pass approval. In effect at once.

### 2026-11-23 · project · feedback · Reshape: goal and brainstorm

**Category:** decision
**Source:** reshape-20261123T220411Z-goal-ec07d5a7
**Recorded:** 2026-11-23T22:04:11Z

The goal gains the panel work (presets described at convening, optional personas, tiered reply length) and a single-approval handoff, and the planned brainstorm is dropped because the user answered the open design questions directly; decisions dr03 to dr09 record them. In effect at once. reshape-20261123T220411Z-goal-ec07d5a7

### 2026-11-23 · structural · orchestrator · brief

The advisor (Astra, xhigh) reviewed brief.md: ready with changes. Six findings, all accepted and folded into the brief: handoff approval covers exactly what runs, partial success is defined, Change returns a distinct field, cache evidence is a positive cached-token count per family, no prompt logging, and the panel notice keeps how the panel was chosen. key:log-2c294ddc919a

### 2026-11-23 · structural · orchestrator · l02-d01

l02-d01 delivered optional structured personas, the panel block in convening notices (picker and mention kickoff) and tiered reply-length guidance on feat/panel at ad177ae; its clean-checkout gate passed (249 tests, build). key:log-ff8af92fb953

### 2026-11-23 · structural · orchestrator · PR 4

PR 4 (panel) opened on feat/panel, stacked on PR 3. The Opus review was clean with four nits; the orchestrator fixed three in a5eab48 (model id as inline code, blank effort skipped, restored councils take reply limits from config, docs and live-check rows) and left two as they were. Skills PR 173 (seshtk backward paging) merged by the orchestrator under decision R2. key:log-5c8a133e69b7

### 2026-11-23 · structural · orchestrator · PR 5

PR 5 merged: five deferred follow-ups recorded in the repository backlog (picker simplification, library exports, dedicated proxy key, preset by mention, splitting a long reply). Opus review found four items that misdescribed current behaviour; corrected and confirmed clean before merge. key:log-daf8cf395156

### 2026-11-23 · structural · orchestrator · l03-d01

l03-d01 delivered council.instructions and MCP orientation on feat/guidance; rebased by the orchestrator onto the panel branch (live-check rows renumbered to 17 and 18) at f120225, gate passed (255 tests, build). PR 6 opened, stacked on PR 4. key:log-fad84fdd26e3

### 2026-11-23 · structural · orchestrator · PR 6

PR 6 (guidance) Opus review was clean with four nits; the orchestrator fixed three in a378909 (distinct error codes for blank and oversized instructions files, unit named in the message, missing-orientation warning after tool listing) and the confirmation round was clean. key:log-8dbe5fa12728

### 2026-11-23 · structural · orchestrator · l04-d01

l04-d01 delivered prompt caching on feat/prompt-cache: a hashed per-council cache key on every request and a text-block cache boundary for Claude models. Through the live proxy the second request reported cached input tokens for both families (Luna 5,760 with the key; Haiku 9,812 with the boundary; zero without). Rebased onto the guidance branch at b4fea11, gate passed (255 tests). PR 7 opened, stacked on PR 6. key:log-1d9cf2037745

### 2026-11-23 · structural · orchestrator · PR 7

PR 7 (prompt caching) Opus review found no blocking issues; the orchestrator applied two documentation fixes in 021105c (what is always sent and the failure to expect from other endpoints; live-check row 19 uses turns without tools) and the confirmation round was clean. A per-provider opt-out was not built and is left to the user. key:log-f9da521fc1e2

### 2026-11-23 · structural · orchestrator · l05-d01

l05-d01 delivered the single-approval handoff tool on feat/handoff (always asks; one card with Approve, Reject and Change; note written and confirmed before launch). Rebased onto the caching branch at 463858c, gate passed (273 tests). PR 8 opened, stacked on PR 7. All five phases now have an open or merged PR; PRs 3, 4, 6 and 7 are reviewed and wait on live Slack passes. key:log-9bb94e2898ad

## End-of-run synthesis (pending — do not skip at project completion)

Summarize the overall verdict, adopted adjustments, and entries graduated to the repo ledger or backlog. Roll up durable observations into tracked surfaces before archiving this project log.
