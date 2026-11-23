---
id: BL-261123-give-the-council-its-own-model
title: Give the council its own model proxy key
status: open
priority: medium
scope: task
scope_estimate: XS
labels:
  - operations
assignee: null
created: 2026-11-23T22:20:41.834Z
updated: 2026-11-23T22:20:41.834Z
associated_issues: []
external_plans: []
---

## Description

The app borrows a general proxy key. A dedicated key lets its usage be told apart and revoked without touching other clients. Operator task: mint the key, then point apiKeyEnv at it.

## Acceptance Criteria

- The app authenticates to the model proxy with a key used by nothing else.
