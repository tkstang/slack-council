# Lanes: mvp-followups

The lane ledger. Written only by `oat project lane set` in the orchestrator's
checkout; never edit it by hand, and lanes never write it. Active holds one
block per open lane, rewritten in place; Closed one line per merged or
superseded lane; History one line per update, append-only, each with its
update ID. Filed lane reports are in `lane-reports/`.

## Active

### l01

- state: blocked
- dispatch: d01 reported
- next: Run the live pass for rows 11, 12 and 15 once the screen is unlocked, then merge PR 3
- owner: orchestrator
- waiting_on: owner
- blocker: Live Slack pass needs the development machine's screen unlocked
- task: node:delegated-task:command%3Amcp%3A82b19f9f-0e96-4837-b6d3-685a582e58bd%3Adelegate-task%3Amvp-followups-l01-d01
- thread: thread:delegated-task:command%3Amcp%3A82b19f9f-0e96-4837-b6d3-685a582e58bd%3Adelegate-task%3Amvp-followups-l01-d01
- worktree: /Users/tstang/.t3/worktrees/slack-council/t3-08a7ca70-19d94c1cac4c0b5e
- placement: own-worktree
- branch: feat/small-followups
- base: ce9afc1fbb525d5361c490443409e1e9ef32f591
- head: fe9ef10c4ef19de2987a01e717f8ea5244a73000
- review_round: 1
- report: lane-reports/l01-d01.md
- wake: T3 task completion
- provider: codex_codex_proxy
- model: gpt-6.2-sol
- effort: high
- last_observed: 2026-11-23T22:07:42Z

### l02

- state: work-settled
- dispatch: d01 reported
- next: Rebase onto main after PR 3 merges, live pass for the notice and reply tiers, then merge PR 4
- owner: orchestrator
- task: node:delegated-task:command%3Amcp%3Aa1c1519b-25ea-4f74-89aa-e3fe79fa2118%3Adelegate-task%3A472456a6-5097-46e4-93de-7544d8d64cac
- worktree: /Users/tstang/.t3/worktrees/slack-council/t3-c6109907-cadc116708165185
- placement: own-worktree
- branch: feat/panel
- base: fe9ef10c4ef19de2987a01e717f8ea5244a73000
- head: ad13543647450426d83184349181af0a83ec05bc
- review_round: 1
- report: lane-reports/l02-d01.md
- wake: T3 task completion
- provider: codex_codex_proxy
- model: gpt-6.2-sol
- effort: high
- last_observed: 2026-11-23T22:20:02Z

### l03

- state: dispatched
- dispatch: d01 open
- next: Wait for the l03-d01 report, then rebase once PRs 3 and 4 merge, open the PR and arrange the Opus review
- owner: orchestrator
- task: node:delegated-task:command%3Amcp%3Aa1c1519b-25ea-4f74-89aa-e3fe79fa2118%3Adelegate-task%3Ace739897-ad25-4a34-9c9c-58bb103a0d41
- branch: feat/guidance
- base: ad177ae98168397e967a0006d761b09e0a09f5aa
- wake: T3 task completion
- provider: codex_codex_proxy
- model: gpt-6.2-sol
- effort: high
- last_observed: 2026-11-23T22:16:05Z

## Closed

_None._

## History

- u001 · 2026-11-23T21:21:46Z · l01 d01 · created; d01 opened; next: Wait for the l01-d01 report, then file it and arrange the Opus review; owner: orchestrator; task: node:delegated-task:command%3Amcp%3A82b19f9f-0e96-4837-b6d3-685a582e58bd%3Adelegate-task%3Amvp-followups-l01-d01; thread: thread:delegated-task:command%3Amcp%3A82b19f9f-0e96-4837-b6d3-685a582e58bd%3Adelegate-task%3Amvp-followups-l01-d01; worktree: /Users/tstang/.t3/worktrees/slack-council/t3-08a7ca70-19d94c1cac4c0b5e; branch: feat/small-followups; base: ce9afc1fbb525d5361c490443409e1e9ef32f591; wake: T3 task completion; provider: codex_codex_proxy; model: gpt-6.2-sol; effort: high; placement: own-worktree; state running
- u002 · 2026-11-23T21:30:19Z · l01 d01 · d01 reported (lane-reports/l01-d01.md); next: Rebase onto main after the adoption PR merges, open the PR, arrange the Opus review and the live Slack pass; head: be8c958dcecd05ef79665a781d7093b2267ad48a; state running → turn-finished
- u003 · 2026-11-23T21:31:03Z · l01 d01 · next: Opus review of the PR, then the live Slack pass for the floor and row 15; head: 3942acab5e7040d3692933c6dc77d48b6c001794
- u004 · 2026-11-23T21:35:42Z · l01 d01 · next: Opus confirmation round on the fix commit, then the live Slack pass; head: fe9ef10c4ef19de2987a01e717f8ea5244a73000; review_round: 1
- u005 · 2026-11-23T22:07:41Z · l02 d01 · created; d01 opened; next: Wait for the l02-d01 report, then rebase onto main once PR 3 merges, open the PR and arrange the Opus review; owner: orchestrator; task: node:delegated-task:command%3Amcp%3Aa1c1519b-25ea-4f74-89aa-e3fe79fa2118%3Adelegate-task%3A472456a6-5097-46e4-93de-7544d8d64cac; branch: feat/panel; base: fe9ef10c4ef19de2987a01e717f8ea5244a73000; wake: T3 task completion; provider: codex_codex_proxy; model: gpt-6.2-sol; effort: high; state dispatched
- u006 · 2026-11-23T22:07:42Z · l01 d01 · next: Run the live pass for rows 11, 12 and 15 once the screen is unlocked, then merge PR 3; blocker: Live Slack pass needs the development machine's screen unlocked; waiting_on: owner; state turn-finished → blocked
- u007 · 2026-11-23T22:10:05Z · l02 d01 · steer: Advisor findings for p02: carry the preset name or custom panel through the picker; post the default preset's notice once on mention kickoff with the user's message as trigger; one shared formatter; tiers apply to public replies only; report any output-token cap on public replies
- u008 · 2026-11-23T22:14:56Z · l02 d01 · d01 reported (lane-reports/l02-d01.md); next: Open the PR stacked on PR 3, Opus review, then rebase onto main after PR 3 merges and run the live pass; worktree: /Users/tstang/.t3/worktrees/slack-council/t3-c6109907-cadc116708165185; head: ad177ae98168397e967a0006d761b09e0a09f5aa; placement: own-worktree; state dispatched → turn-finished
- u009 · 2026-11-23T22:16:05Z · l03 d01 · created; d01 opened; next: Wait for the l03-d01 report, then rebase once PRs 3 and 4 merge, open the PR and arrange the Opus review; owner: orchestrator; task: node:delegated-task:command%3Amcp%3Aa1c1519b-25ea-4f74-89aa-e3fe79fa2118%3Adelegate-task%3Ace739897-ad25-4a34-9c9c-58bb103a0d41; branch: feat/guidance; base: ad177ae98168397e967a0006d761b09e0a09f5aa; wake: T3 task completion; provider: codex_codex_proxy; model: gpt-6.2-sol; effort: high; state dispatched
- u010 · 2026-11-23T22:16:05Z · l02 d01 · next: Opus review of PR 4 running; then fixes, rebase after PR 3 merges, live pass; review_round: 1
- u011 · 2026-11-23T22:19:34Z · l02 d01 · next: Opus confirmation of the follow-up commit; then rebase after PR 3 merges and run the live pass; head: a5eab4857f504a72c3203cfa7820b8f28e117579
- u012 · 2026-11-23T22:20:02Z · l02 d01 · next: Rebase onto main after PR 3 merges, live pass for the notice and reply tiers, then merge PR 4; head: ad13543647450426d83184349181af0a83ec05bc; state turn-finished → work-settled
