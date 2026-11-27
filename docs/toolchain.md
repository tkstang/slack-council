---
title: Toolchain
description: Develop, build and verify Slack Council.
---

# Toolchain

## Source layout

The core implements the floor queue, prompts, per-council execution and
persistence.

Source modules live in `src/core`, `src/config`, `src/engine`, `src/context`,
`src/runner`, `src/store`, `src/model` (the AI SDK turn runner), `src/slack`
(the Bolt adapter), `src/tools` (member tools and approvals) and `src/app`
(startup wiring). Imports within a directory use relative paths and
cross-directory imports use `@council/*`.

## Adapter entry points

Open the service with `openCouncilService(config, { slack, turns, appUserId })`.
Pass human messages with raw Slack-encoded text to `handleHumanMessage`. For
mention-based kickoff, pass the resolved thread scope with `kickoff: true`.
`isDormant` reports a stored council that cannot run under the current config.
`end` and a `@council end` message in its scope remove it.
Convene a chosen roster or preset through `convene` and pass the Slack
timestamp of the convening post as `convenedAtTs`. `createPicker` builds
the roster modal that `registerCouncilHandlers` serves for `/council` and the
`council_start` shortcut. The service retains the newest 4,096
accepted message keys across restarts. It dispatches floor grants and removes
ended councils after saving. Both `stop` and `end` cancel active turns before
saving so cancellation stays responsive during a slow or failed save.

The model port provides `runTurn` for real turns and `runListen` for the
bounded, tool-free check at settle. Both receive an abort signal.

The Slack port reads oldest-to-newest history with inclusive time bounds, posts
members with chain and turn metadata, and neutralises broadcast mentions. Call
`shutdown()` while that port is still available so outstanding writes and
reactions can drain.

## Scripts

| Script                       | Does                                                         |
| ---------------------------- | ------------------------------------------------------------ |
| `pnpm run dev`               | `tsx watch src/cli.ts`                                       |
| `pnpm run build`             | emit to `dist/` via `tsc` + `tsc-alias`                      |
| `pnpm run typecheck`         | `tsc --noEmit`                                               |
| `pnpm run lint`              | `oxlint`                                                     |
| `pnpm run format`            | `oxfmt --write .` (rewrite)                                  |
| `pnpm run format:check`      | `oxfmt --check .`                                            |
| `pnpm run test`              | `vitest run`                                                 |
| `pnpm run prepare`           | wire this repo's Git hooks through `tools/install-hooks.mjs` |
| `pnpm run worktree:init`     | bootstrap a new git worktree with local-only state           |
| `pnpm run worktree:validate` | full local validation on a clean checkout                    |

After `git worktree add`, run `pnpm run worktree:init` inside the new worktree.
Use `pnpm run worktree:validate` for explicit full verification. If the repo has
adopted OAT, `worktree:init` also syncs OAT local paths, provider views and
archived project docs from S3 where configured.

For later provider updates, preview `oat sync --scope project --dry-run` before
applying `oat sync --scope project`. Change canonical sources, never generated
views. Track required installable/provider derivatives only with an explicit
source, generator and nonmutating freshness check.

## Verification policy

CI runs the same gate on GitHub-hosted runners for pushes to `main` and
non-draft pull requests targeting `main`. It then smoke-tests the built CLI
on Node 24. Development uses Node 26 and the app uses Node 24 type declarations.
See the [runtime floor](deployment.md#runtime-and-state) for deployments.

Run focused tests while editing. Before handoff, run `pnpm run worktree:validate`
from a clean checkout with dependencies installed using `pnpm install --frozen-lockfile`.
The script checks the agent-file policy, lint, format, types, the full test suite,
the build and worktree cleanliness. To smoke-test the built CLI locally, run
the [example config validation](../README.md#quick-start).

The tests use fakes at the external ports. After a change to the Slack
adapter, turn runner, tools or approvals, run the checklist in
[live checks](live-checks.md) and add a line to its log.

Record the tested revision, toolchain, commands, outcomes and exclusions in the
handoff. Reuse that evidence while the tested inputs remain unchanged.

## Toolchain choices

- **TypeScript 7 is primary.** `typescript-7@npm:typescript` supplies the stable
  `tsc` binary for typecheck and emit. `typescript@npm:@typescript/typescript6`
  remains beside it for compiler-API ecosystem compatibility and exposes `tsc6`.
  Use that binary only for differential diagnosis or a demonstrated TS7 blocker.
  A truly minimal repo with no compiler-API consumers may simplify to pure
  `typescript@^7`.
- **Module resolution is `NodeNext`** for native Node ESM execution. Bundler
  resolution belongs to projects with a bundler. `tsc-alias` rewrites the
  `@council/*` path alias and appends runtime `.js` extensions at build.
- **`@types/node` stays on `^24`** for the consumer support floor. Development
  uses Node 26. Node 26-only APIs need a deliberate support change.
- The repository uses oxfmt as its single formatter. The house decision
  removed `.editorconfig`.
