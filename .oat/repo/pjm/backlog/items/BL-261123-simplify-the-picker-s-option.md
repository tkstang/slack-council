---
id: BL-261123-simplify-the-picker-s-option
title: Simplify the picker's option ids and roster fingerprint
status: open
priority: low
scope: task
scope_estimate: S
labels:
  - picker
assignee: null
created: 2026-11-23T22:20:40.849Z
updated: 2026-11-23T22:20:40.849Z
associated_issues: []
external_plans: []
---

## Description

The convening modal maps options through index ids and carries a roster fingerprint so a stale form is refused. A reviewer of the MVP thought this could be simpler. Decide whether the indirection earns its place and remove it if not.

## Acceptance Criteria

- The picker either drops the index ids and fingerprint or a comment states the failure they prevent.
- A stale or tampered form is still refused.
