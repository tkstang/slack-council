# AGENTS.md

A Slack app that hosts a council of AI members, with an agent-first CLI
(`validate`, `start`). ESM-only, Node 26 for development, Node 24 minimum to
run, pnpm 12, extra-strict TypeScript,
Oxc (oxlint + oxfmt), Vitest, and Zod at boundaries. The domain layer returns a
result envelope (`Success | Failure` with closed `E_*` codes). Boundaries throw
a typed `CliError` caught by one central handler.

## Headline defaults

Oxc toolchain, TypeScript 7, ESM-only, Node 26 development, Node 24 runtime
floor, pnpm 12.x (double-pinned), Vitest 4 with co-located `*.test.ts` siblings (globals off) - Zod 4 at
boundaries - Conventional Commits - custom git hooks in `tools/git-hooks/` (no
husky/lefthook) - `private: true` + MIT LICENSE.

## Non-Negotiables

- **Machine-readable error codes, never string matching** on messages.
- **Conventional Commits** on every commit, every branch.
- **Import policy:** only same-directory relative (`./...`). For anything outside
  the current dir use the named `@council/*` tsconfig alias (mirrored in
  `vitest.config.ts`). Never `../..` chains, never a catch-all `@/*`.
- **Never commit secrets** (`.mcp.json` is gitignored) or build output (`dist/`).
- **Lean dependencies** - stdlib + native `fetch` first; a dep must earn its place.
- **Agent-first CLI:** one JSON envelope on stdout, logs to stderr, `E_*` exit
  codes, no interactivity, NO_COLOR-safe.
- **Proportionate tests** - prefer a table-driven case over a new suite. Skip
  bespoke harnesses and snapshot padding. Live end-to-end checks carry the
  integration proof.

## Definition of Done

This local MVP has no remote. Use focused checks while editing and run
`pnpm run worktree:validate` on a clean checkout with Node 26 before handoff.
It runs the agent-file guard, types, lint, format, full tests and build. Reuse
evidence while its source, dependencies, config, environment and relevant base
are unchanged. Re-run affected checks after an input changes.

The pre-push hook runs `check:agents` and `typecheck` for early feedback. See the
README verification policy for the full local checks.

## Agent setup

This repo ships only this `AGENTS.md` and a starter
`.claude/settings.json`. It does not pre-generate `.agents/`, provider mirrors
or `.oat/`. `AGENTS.md` is the house instruction source; add scoped files only
for distinct package or subtree rules. No `CLAUDE.md` is shipped.
`pnpm run check:agents` enforces that filename policy in pre-commit and local
validation.
Provider loading behavior should be checked against the installed provider.

With the latest compatible OAT installed, run `oat init --scope project`, then
`oat status --scope project`. For explicit guided setup, use
`oat init --scope project --setup`. Project guidance and provider sync depend
on the options selected. Bare `oat init` defaults to `all` and can write under
home. Keep project setup scoped to the project.

After adoption, author internal tooling in `.agents/`; some providers read it
natively and others need generated views. Preview changes with
`oat sync --scope project --dry-run` before applying `oat sync --scope project`.
Never hand-edit derivatives. Follow the repo's declared generated-file ownership.
Choose a proportional OAT lane rather than a full lifecycle for every fix.

## Worktrees

- After `git worktree add`, run `pnpm run worktree:init` in the new worktree to
  copy local-only files, install dependencies, configure hooks, and refresh OAT
  local/provider state when present.
- Use `pnpm run worktree:validate` for explicit full clean-checkout verification
  and record that evidence for handoff. It checks cleanliness before and after.
  Do not repeat unchanged proof solely because you are pushing.
