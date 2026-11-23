# Slack Council

Slack Council hosts a roster of AI members in a Slack conversation. The core
implements the floor queue, prompts, per-council execution and persistence.
See [the design](docs/design.md) for the turn-taking contract.

## Validate a configuration

```sh
pnpm install --frozen-lockfile
pnpm build
node dist/cli.js validate --config council.config.example.json
```

The CLI emits one JSON envelope and exits nonzero for invalid configuration.
Validation checks the file and its references without contacting Slack or model
providers. Provider keys are named by environment variable. A relative
`stateDir` resolves from the process working directory.

Source modules live in `src/core`, `src/config`, `src/engine`, `src/context`,
`src/runner`, and `src/store`. Imports within a directory use relative paths and
cross-directory imports use `@council/*`.

## Adapter entry points

Open the service with `openCouncilService(config, { slack, turns, appUserId })`.
Pass normalised human messages to `handleHumanMessage`. For mention-based
kickoff, pass the resolved thread scope with `kickoff: true`. Convene a chosen
roster or preset through `convene`. The service persists accepted messages before
dispatching them and retains the newest 4,096 message keys across restarts.

The Slack port reads oldest-to-newest history with an inclusive cutoff, posts
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
| `pnpm run worktree:validate` | explicit full clean-checkout gate, also used by CI           |

After `git worktree add`, run `pnpm run worktree:init` inside the new worktree.
Use `pnpm run worktree:validate` for explicit full verification. If the repo has
adopted OAT, `worktree:init` also syncs OAT local paths, provider views and
archived project docs from S3 where configured.

For later provider updates, preview `oat sync --scope project --dry-run` before
applying `oat sync --scope project`. Change canonical sources, never generated
views. Track required installable/provider derivatives only with an explicit
source, generator and nonmutating freshness check. Product skills may have a
separate source such as `src/skills/`.

## Verification policy

Development and primary CI use Node 26. The published library/CLI contract
keeps `engines.node >=24` and Node 24 type declarations. CI also runs the built
artifact smoke check on Node 24. Before publishing, verify the packed package
on the supported minimum; development on Node 26 alone does not prove it.

This scaffold adopts full clean CI by default, even with `private: true`.
During editing, run owning tests such as `pnpm run test src/cli.test.ts`.
Before handoff or marking a PR ready, run one final batch of the required local
checks: `check:agents`, `typecheck`, `lint`, `format:check`, relevant tests, and
`build` when wiring changes. Shared config, dependencies, package contracts or
uncertain impact require broader checks. Keep stronger repo-specific checks.

The pre-push hook runs `pnpm run check:agents` and `pnpm run typecheck`. It runs no
tests. `pnpm run build` emits the library and CLI to `dist/` with alias rewriting.
The hook clears Git-local environment variables before subprocesses and accepts
`GIT_HOOKS=0` as an escape hatch; bypassing it does not waive final verification.

`pnpm run worktree:validate` is the explicit full gate: clean tree, agent-file
guard, lint, format, types, full tests, build, then clean tree again. Use a clean
checkout with `pnpm install --frozen-lockfile`. CI uses this same command with
the pinned pnpm and Node versions, read-only permissions and a 20-minute timeout.
It runs on main pushes and the listed PR events targeting main. Draft updates
skip the job; marking ready starts it without a new commit, and later pushes rerun it. Title or
body edits do not rerun it. There is no changed-path selector, so workflow,
lockfile and unknown changes receive the full gate too. Superseded validation
runs are canceled; publication needs a separate serialized release group.

A draft skip is not verification, even though GitHub reports skipped jobs as
successful. Require an actual successful ready-candidate run before merge, and
keep main push validation for the integrated revision. PR runs validate GitHub's
merge ref and therefore already depend on the base. Retargeting to main emits
`edited`, which is not subscribed here; push or reopen to start the gate, or
explicitly add a base-change-filtered `edited` route. A real merge queue needs
`merge_group`. These examples do not configure branch protection or publishing.

Record the tested revision or exact uncommitted inputs, relevant base,
environment/toolchain, commands and scope, outcomes and exclusions in the PR or
handoff. Reuse the final local batch while those inputs remain unchanged. Source,
dependency, config, base or environment changes invalidate affected proof.
Local proof does not waive clean CI or prove another OS/merge tree. Before
publishing, add packed-consumer proof for shipped files/exports and the supported
runtime; before deploying, add required service/platform proof. Required tests
must execute, with disposable services where needed. A skipped test is not proof.

A suitable private unpublished project may deliberately choose local final
verification instead. Update this README and `AGENTS.md` with the risk rationale
and required owning checks, then adapt the workflow in that same adoption change.
The local batch remains narrowest-sufficient; it need not become full tests/build
on every change. Keep remote clean/security/package checks where they add value
and the explicit full command where useful. Revisit before publication, deployment
or a change in risk. Private credential routers and durable stores can be
consequential and require clean trusted CI. For docs/config-only projects, replace
application steps with owning conformance/syntax/render checks. This adoption
option does not relax another repo's requirements. There is no coverage gate.

## NOTES / Deviations

- **TypeScript 7 is primary.** `typescript-7@npm:typescript` supplies the stable
  `tsc` binary for typecheck and emit. `typescript@npm:@typescript/typescript6`
  remains beside it for compiler-API ecosystem compatibility and exposes `tsc6`;
  use that binary only for differential diagnosis or a demonstrated TS7 blocker.
  A truly minimal repo with no compiler-API consumers may simplify to pure
  `typescript@^7`.
- **Module resolution is `NodeNext`** for native Node ESM execution. Bundler
  resolution belongs to projects with a bundler. `tsc-alias` rewrites the
  `@council/*` path alias and appends runtime `.js` extensions at build.
- **`@types/node` stays on `^24`** for the consumer support floor. Development
  and primary CI use Node 26; Node 26-only APIs need a deliberate support change.
- No `.editorconfig` (dropped by house decision; oxfmt is the single formatter).
