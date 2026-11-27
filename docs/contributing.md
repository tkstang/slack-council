---
title: Contributing to documentation
description: Authoring conventions, context, and Markdown navigation rules.
---

# Contributing to documentation

Maintain documentation for **Slack Council** as authored Markdown pages. Start
from the [documentation index](index.md) to understand the intended audience and
where each topic belongs. See the [toolchain guide](toolchain.md) to contribute
code.

## Structure and context

- Give every Markdown-bearing directory an authored `index.md` with useful
  context: purpose, audience, ownership, and how its pages relate.
- Maintain a populated `## Contents` map. Link sibling pages as `page.md` and
  immediate child directories as `section/index.md`. Link only existing files.
- Asset-only directories do not need an index.
- Add `title` and `description` metadata to authored pages. Use relative `.md`
  links so navigation works when reading the repository directly.
- Preserve existing local instructions and repository-specific guidance.

## Review and verification

Check relative links, Contents maps, metadata, and context after edits.
`oat docs check --target-dir docs` checks links, Contents maps and metadata.
oxfmt formats Markdown at an 80-column print width: the pre-commit hook
rewrites staged pages, and `pnpm run format:check` and
`pnpm run worktree:validate` check them. There is no docs linter or site build.

The authored index is not a generated manifest. If an optional inventory is
needed, run `oat docs generate-index` with an explicit output outside the
configured content tree and keep the authored entrypoint unchanged.
