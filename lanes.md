# Lanes: mvp-followups

The lane ledger. Written only by `oat project lane set` in the orchestrator's
checkout; never edit it by hand, and lanes never write it. Active holds one
block per open lane, rewritten in place; Closed one line per merged or
superseded lane; History one line per update, append-only, each with its
update ID. Filed lane reports are in `lane-reports/`.

## Active

### l07

- state: turn-finished
- dispatch: d01 reported
- next: push branch, open PR, review, live pass
- owner: orchestrator
- task: node:delegated-task:command%3Amcp%3A905c1909-56c3-48c6-a798-fdd308d40b8d%3Adelegate-task%3A696edce4-026f-4f2e-80b7-fd522a68338b
- thread: thread:delegated-task:command%3Amcp%3A905c1909-56c3-48c6-a798-fdd308d40b8d%3Adelegate-task%3A696edce4-026f-4f2e-80b7-fd522a68338b
- worktree: /Users/tstang/.t3/worktrees/slack-council/t3-85b9feeb-7dc474124be6c698
- placement: own-worktree
- branch: feat/readable-slack-formatting
- base: 9afe973
- head: b1ff4d2f36f53ef3bfe0910a343c60765e9d9830
- report: lane-reports/l07-d01.md
- wake: delegate completion
- provider: codex
- model: gpt-6.2-sol
- effort: high
- last_observed: 2026-11-24T16:11:19Z

## Closed

- l01 · merged · 2026-11-24T01:26:10Z · branch feat/small-followups · head fe9ef10c4ef19de2987a01e717f8ea5244a73000 · report lane-reports/l01-d01.md
- l02 · merged · 2026-11-24T01:28:47Z · branch feat/panel · head c2c02f5e7201a3f3cf34fed074308605e9f1787e · report lane-reports/l02-d01.md
- l03 · merged · 2026-11-24T01:33:01Z · branch feat/guidance · head d10058e0aab1e776ae8ae03d3e5fde35d4458f31 · report lane-reports/l03-d01.md
- l04 · merged · 2026-11-24T01:33:01Z · branch feat/prompt-cache · head 252c5980fbc484dab90a4e8aa679e5db8f8cce52 · report lane-reports/l04-d01.md
- l06 · merged · 2026-11-24T01:35:56Z · branch feat/preset-mention · head 7d7e28c59ee1d8b155c75e86eafcdaa4bd5e5850 · report lane-reports/l06-d01.md
- l05 · merged · 2026-11-24T03:17:44Z · branch feat/handoff · head f975309e876f4c2082ed87e38e6af642c8d0d6a6 · report lane-reports/l05-d01.md

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
- u013 · 2026-11-23T22:25:01Z · l03 d01 · d01 reported (lane-reports/l03-d01.md); next: Rebase onto the panel branch head, open the PR stacked on PR 4, Opus review; worktree: /Users/tstang/.t3/worktrees/slack-council/t3-8d9bedcc-307c87066ab44d2e; head: 94b495e3d938bd78d2086519932b424f71ab0a9e; placement: own-worktree; state dispatched → turn-finished
- u014 · 2026-11-23T22:26:17Z · l03 d01 · next: Opus review of PR 6 running; then fixes, rebase after PRs 3 and 4 merge, live pass rows 17 and 18; base: ad13543647450426d83184349181af0a83ec05bc; head: f12022559506bb470f43838f9d39b0ffbcf37f6d; review_round: 1
- u015 · 2026-11-23T22:26:57Z · l04 d01 · created; d01 opened; next: Wait for the l04-d01 report; then review, rebase and open the PR; owner: orchestrator; task: node:delegated-task:command%3Amcp%3Aa1c1519b-25ea-4f74-89aa-e3fe79fa2118%3Adelegate-task%3A19cfdbb9-2d11-46dc-91da-2b5c98a8f7c3; branch: feat/prompt-cache; base: f12022559506bb470f43838f9d39b0ffbcf37f6d; wake: T3 task completion; provider: codex_codex_proxy; model: gpt-6.2-sol; effort: high; state dispatched
- u016 · 2026-11-23T22:29:02Z · l03 d01 · next: Rebase after PRs 3 and 4 merge, live pass rows 17 and 18, then merge PR 6; head: a3789096e58dfd849c422726b01605321d6d8fea; state turn-finished → work-settled
- u017 · 2026-11-23T22:34:52Z · l04 d01 · d01 reported (lane-reports/l04-d01.md); next: Rebase onto the guidance branch head, open the PR stacked on PR 6, Opus review; worktree: /Users/tstang/.t3/worktrees/slack-council/t3-a293358b-daa5d176621dbd48; head: b32990cd5de5872340eb6792e4df827656a2094e; placement: own-worktree; state dispatched → turn-finished
- u018 · 2026-11-23T22:35:50Z · l04 d01 · next: Opus review of PR 7 running; then fixes, rebase after earlier PRs merge, live-check row 19; base: a3789096e58dfd849c422726b01605321d6d8fea; head: b4fea1165a33a8e8c4bd147ca18323fbacb11334; review_round: 1
- u019 · 2026-11-23T22:36:44Z · l05 d01 · created; d01 opened; next: Wait for the l05-d01 report; then review, rebase and open the PR; owner: orchestrator; task: node:delegated-task:command%3Amcp%3Aa1c1519b-25ea-4f74-89aa-e3fe79fa2118%3Adelegate-task%3Ae99bc582-1710-4893-a7d8-59e904857c32; branch: feat/handoff; base: b4fea1165a33a8e8c4bd147ca18323fbacb11334; wake: T3 task completion; provider: codex_codex_proxy; model: gpt-6.2-sol; effort: high; state dispatched
- u020 · 2026-11-23T22:39:40Z · l04 d01 · next: Rebase after earlier PRs merge, live-check row 19, then merge PR 7; head: 021105c138c611ec8356b0414557972db3f02422; state turn-finished → work-settled
- u021 · 2026-11-23T22:49:09Z · l05 d01 · d01 reported (lane-reports/l05-d01.md); next: Rebase onto the caching branch head, open the PR stacked on PR 7, Opus review; worktree: /Users/tstang/.t3/worktrees/slack-council/t3-7841f706-8afa41d67ab95c30; head: 0371b4a51933dc2af04768024cb4b8325e4b185e; placement: own-worktree; state dispatched → turn-finished
- u022 · 2026-11-23T22:50:22Z · l05 d01 · next: Opus review of PR 8 running; then fixes, rebase after earlier PRs merge, live-check rows 20 to 22; base: 021105c138c611ec8356b0414557972db3f02422; head: 463858ccca4c1edef7f233cad85923c5e4c8c018; review_round: 1
- u023 · 2026-11-23T22:55:40Z · l05 d01 · next: Rebase after earlier PRs merge, live-check rows 20 to 22 (needs the Switchboard token), then merge PR 8; head: 1c7517c4151dcbc93932642e015429033fb9568f; state turn-finished → work-settled
- u024 · 2026-11-23T23:40:34Z · l06 d01 · created; d01 opened; next: Wait for the l06-d01 report; then review, open the PR stacked on PR 8, Opus review; owner: orchestrator; task: node:delegated-task:command%3Amcp%3Aa1c1519b-25ea-4f74-89aa-e3fe79fa2118%3Adelegate-task%3A5dd17709-b86f-4239-b5e3-00c87a825a75; branch: feat/preset-mention; base: 1c7517c4151dcbc93932642e015429033fb9568f; wake: T3 task completion; provider: codex_codex_proxy; model: gpt-6.2-sol; state dispatched
- u025 · 2026-11-23T23:46:47Z · l06 d01 · d01 reported (lane-reports/l06-d01.md); next: Opus review of PR 9 running; then fixes, rebase after earlier PRs merge, live-check rows 23 and 24; worktree: /Users/tstang/.t3/worktrees/slack-council/t3-42520028-62a93b2e2182b4ed; head: 1d6302fb47ff5fd3cb74570621118a2490163f50; review_round: 1; placement: own-worktree; state dispatched → turn-finished
- u026 · 2026-11-23T23:50:49Z · l06 d01 · next: Opus confirmation round on PR 9; then rebase after earlier PRs merge, live-check rows 23 and 24, merge; head: 0fa267eff3b689b0cb7007711d75babd50e21f8e; review_round: 2
- u027 · 2026-11-23T23:51:01Z · l06 d01 · next: Rebase after earlier PRs merge, live-check rows 23 and 24, then merge PR 9; state turn-finished → work-settled
- u028 · 2026-11-24T01:26:10Z · l01 d01 · next: None; PR 3 squash-merged after the combined live pass on 0fa267e; state blocked → merged; waiting_on cleared; blocker cleared; closed
- u029 · 2026-11-24T01:26:10Z · l02 d01 · next: CI on the rebased head, then merge PR 4; head: c2c02f5e7201a3f3cf34fed074308605e9f1787e
- u030 · 2026-11-24T01:28:47Z · l02 d01 · next: None; PR 4 squash-merged; state work-settled → merged; closed
- u031 · 2026-11-24T01:28:47Z · l03 d01 · next: CI on the rebased head, then merge PR 6; head: d10058e0aab1e776ae8ae03d3e5fde35d4458f31
- u032 · 2026-11-24T01:33:01Z · l03 d01 · next: None; PR 6 squash-merged; state work-settled → merged; closed
- u033 · 2026-11-24T01:33:01Z · l04 d01 · next: None; PR 7 squash-merged; head: 252c5980fbc484dab90a4e8aa679e5db8f8cce52; state work-settled → merged; closed
- u034 · 2026-11-24T01:33:02Z · l06 d01 · next: CI on the head rebased onto main (ahead of PR 8), then merge PR 9; head: 7d7e28c59ee1d8b155c75e86eafcdaa4bd5e5850
- u035 · 2026-11-24T01:35:56Z · l06 d01 · next: None; PR 9 squash-merged; state work-settled → merged; closed
- u036 · 2026-11-24T01:35:56Z · l05 d01 · next: When the token exists: configure handoff on the test config, live pass rows 22 to 24, merge PR 8; head: f975309e876f4c2082ed87e38e6af642c8d0d6a6; blocker: Live-check rows 22 to 24 need a Switchboard token minted by the owner; waiting_on: owner; state work-settled → blocked
- u037 · 2026-11-24T03:17:44Z · l05 d01 · next: None; PR 8 squash-merged as 63ce8c8 after live-check rows 22 to 24 passed on f975309; state blocked → merged; waiting_on cleared; blocker cleared; closed
- u038 · 2026-11-24T16:00:12Z · l07 d01 · created; d01 opened; next: Wait for the l07-d01 report, file it, open the PR, Opus review, then the live pass for the notice and approval card; owner: orchestrator; task: node:delegated-task:command%3Amcp%3A905c1909-56c3-48c6-a798-fdd308d40b8d%3Adelegate-task%3A696edce4-026f-4f2e-80b7-fd522a68338b; thread: thread:delegated-task:command%3Amcp%3A905c1909-56c3-48c6-a798-fdd308d40b8d%3Adelegate-task%3A696edce4-026f-4f2e-80b7-fd522a68338b; branch: feat/readable-slack-formatting; base: 9afe973; wake: delegate completion; provider: codex; model: gpt-6.2-sol; effort: high; state running
- u039 · 2026-11-24T16:11:19Z · l07 d01 · d01 reported (lane-reports/l07-d01.md); next: push branch, open PR, review, live pass; worktree: /Users/tstang/.t3/worktrees/slack-council/t3-85b9feeb-7dc474124be6c698; head: b1ff4d2f36f53ef3bfe0910a343c60765e9d9830; placement: own-worktree; state running → turn-finished
