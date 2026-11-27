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
  integration proof: see `docs/live-checks.md`.

## Definition of Done

Use focused checks while editing and run `pnpm run worktree:validate` on a
clean checkout with Node 26 before handoff. It runs the agent-file guard, types,
lint, format, full tests and build. CI runs the same gate on every non-draft pull request
to `main` and every push to `main`. Reuse
evidence while its source, dependencies, config, environment and relevant base
are unchanged. Re-run affected checks after an input changes.

The pre-push hook runs `check:agents` and `typecheck` for early feedback. See the
[verification policy](docs/toolchain.md#verification-policy) for the full local checks.

## Complexity

When a plan or implementation accumulates abstractions, schemas, branching
workflows, helper scripts or process that is becoming hard to justify or
explain, review it for complexity (with the `complexity-review` skill when it is
installed). Compare it with the smallest solution that meets the actual
contract; simplify or defer machinery that does not earn its maintenance cost.
Before adding material complexity for a speculative failure mode or unconfirmed
future need, explain the concrete problem, evidence that it matters, simpler
alternatives, and the implementation and maintenance cost, then get the user's
buy-in. This applies to production code, tests and fixtures, and operational
safeguards. Do not silently expand scope for theoretical robustness, flexibility
or scale. Ordinary regression tests and required checks do not trigger this
buy-in requirement. Keep required correctness, security and human gates.
A complexity review is not a mandatory extra pass for every small change.

## Agent setup

This repo has adopted OAT at project scope: `.oat/` holds its config, sync
manifest and projects, and `.oat/repo/` holds project management and durable
reference. It installs no project-level tool packs and has no `.agents/` or
generated provider views yet. `AGENTS.md` is the house instruction source; add
scoped files only for distinct package or subtree rules. No `CLAUDE.md` is
shipped. `pnpm run check:agents` enforces that filename policy in pre-commit
and local validation.
Provider loading behavior should be checked against the installed provider.

To re-run setup, use `oat init --scope project`, then
`oat status --scope project`. Bare `oat init` defaults to `all` and can write
under home. Keep project setup scoped to the project.

Author internal tooling in `.agents/`; some providers read it
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

## OAT

<!-- OAT project-management -->
### Project Management

- Installed project-management tools provide capability; they do not prove that this repository adopted PJM.
- Run `oat pjm doctor --json` and inspect `adoption.state` before any PJM write.
- Repository planning and durable context live under `.oat/repo/`.
- Consult it when prioritizing or planning work, checking the backlog, starting or closing tracked work, or looking for established repository context.
- Start with `.oat/repo/AGENTS.md`; it routes to `pjm/` for active state and `reference/` for durable records.
- If adoption is absent or partial, stop and initialize it with `oat pjm init`.
<!-- END OAT project-management -->

<!-- OAT decisions -->
### Decision Records

- Durable repository decisions live under `.oat/repo/reference/decisions/`; read `.oat/repo/reference/decisions/AGENTS.md` before working with them.
- Before finalizing a durable repository decision, review `.oat/repo/reference/decisions/index.md` and any relevant records.
- When the user asks to record a durable decision or confirms a proposed capture, use `oat-pjm-decision` when that skill is installed; otherwise use `oat decision new`.
- Do not hand-edit the generated decision index; run `oat decision regenerate-index` after record changes or to resolve index conflicts.
- Run `oat pjm doctor --json` and inspect `adoption.state` before any decision write.
- If the decision surface is missing, repository adoption is absent or partial; stop and initialize it with `oat pjm init`.
<!-- END OAT decisions -->

<!-- OAT docs -->
## Documentation

- **Docs root:** `docs`
- **Tooling:** Markdown
- **Authored index:** `docs/index.md`
- **Contributing:** `docs/contributing.md`

Keep authored context, title/description metadata, and Contents maps with relative Markdown links current. Preserve local instructions; asset-only directories are exempt from indexes.
Use `oat-docs-analyze` to audit gaps and `oat-docs-apply` for approved repairs. Optional generated inventories belong outside the content tree and do not replace the authored index.
<!-- END OAT docs -->
