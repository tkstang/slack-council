---
id: BL-261123-decide-whether-src-index-ts
title: Decide whether src/index.ts keeps library-style exports
status: open
priority: low
scope: task
scope_estimate: XS
labels:
  - packaging
assignee: null
created: 2026-11-23T22:20:41.344Z
updated: 2026-11-23T22:20:41.344Z
associated_issues: []
external_plans: []
---

## Description

The package is private and run as an app, but src/index.ts still exports its internals as a library would, from the original generic-packaging idea. Either drop the exports or state who they are for.

## Acceptance Criteria

- `src/index.ts` exports only what a named consumer uses, or the README says who the exports are for.
