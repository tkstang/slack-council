---
id: BL-261123-choose-a-preset-when-convening
title: Choose a preset when convening by mention
status: open
priority: medium
scope: task
scope_estimate: S
labels:
  - panel
assignee: null
created: 2026-11-23T22:20:42.581Z
updated: 2026-11-23T22:20:42.581Z
associated_issues: []
external_plans: []
---

## Description

A mention always convenes the default preset; only the slash command and the message shortcut offer a choice. Let a mention name a preset, for example '@council frontier: question', without making ordinary questions ambiguous.

## Acceptance Criteria

- A mention can name a configured preset, and the convening notice shows that preset.
- A question that merely starts with a preset's name is not misread.
