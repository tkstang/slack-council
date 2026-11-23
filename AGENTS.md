# AGENTS.md

Single-package TypeScript library + agent-first CLI. ESM-only, Node 26 for
development/CI, Node 24 minimum for consumers, pnpm 12, extra-strict TypeScript, Oxc (oxlint + oxfmt), Vitest, Zod at boundaries. The
domain layer returns a result-envelope (`Success | Failure` with closed `E_*`
codes); boundaries throw a typed `CliError` caught by one central handler.

## Headline defaults

Oxc toolchain, TypeScript 7, ESM-only, Node 26 development, Node 24 consumer
floor, pnpm 12.x (double-pinned), Vitest 4 with co-located `*.test.ts` siblings (globals off) - Zod 4 at
boundaries - Conventional Commits - custom git hooks in `tools/git-hooks/` (no
husky/lefthook) - `private: true` + MIT LICENSE.

## Non-Negotiables

- **Machine-readable error codes, never string matching** on messages.
- **Conventional Commits** on every commit, every branch.
- **Import policy:** only same-directory relative (`./...`). For anything outside
  the current dir use the named `@app/*` tsconfig alias (mirrored in
  `vitest.config.ts`). Never `../..` chains, never a catch-all `@/*`.
- **Never commit secrets** (`.mcp.json` is gitignored) or build output (`dist/`).
- **Lean dependencies** - stdlib + native `fetch` first; a dep must earn its place.
- **Agent-first CLI:** one JSON envelope on stdout, logs to stderr, `E_*` exit
  codes, no interactivity, NO_COLOR-safe.

## Definition of Done

Use focused checks while editing. Before handoff or marking ready, run one
final batch of required proof: `check:agents`, types, lint, format and relevant
behavior tests; build when entrypoints, exports, aliases or package boundaries
change. Broaden tests for shared config/dependencies or uncertain impact. Reuse
evidence while its source, dependencies, config, environment and relevant base
are unchanged; re-run affected checks after an input changes.

This scaffold adopts full clean CI for ready PRs and main pushes, including full
tests and build on Node 26. `pnpm run worktree:validate` runs that Node 26 gate;
CI adds a built-artifact smoke check on Node 24. The pre-push hook runs only `check:agents` + `typecheck`; it is feedback, not final
verification. See the README verification policy for commands and adoption.

Suitable private unpublished projects may explicitly choose local final
verification in this file and the README, with the reason and required checks.
Private visibility alone is insufficient; published, deployed or consequential
code requires clean trusted CI. Preserve any stronger repo requirements.
There is never a CI coverage gate.

## Agent setup

This scaffold ships only this `AGENTS.md` and a starter
`.claude/settings.json`. It does not pre-generate `.agents/`, provider mirrors
or `.oat/`. `AGENTS.md` is the house instruction source; add scoped files only
for distinct package or subtree rules. No `CLAUDE.md` is shipped.
`pnpm run check:agents` enforces that filename policy in pre-commit and CI.
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
