---
id: BL-261123-post-a-long-reply-as-more-than
title: Post a long reply as more than one message
status: open
priority: low
scope: task
scope_estimate: S
labels:
  - slack
assignee: null
created: 2026-11-23T22:20:43.129Z
updated: 2026-11-23T22:20:43.129Z
associated_issues: []
external_plans: []
---

## Description

A member post is one Slack message, truncated at 12,000 characters. A 1,000-word reply fits, but one with long code blocks or URLs is cut off and ends with a "(truncated)" line. Decide whether to split at a paragraph boundary instead.

## Acceptance Criteria

- A reply over the one-message limit is delivered in full across messages, or the item is closed with the reason truncation is enough.
