---
title: Using the council
description: Convene a panel, address members and manage the conversation in Slack.
---

# Using the council

## Convene a council

The app must have joined the channel. Only users in `slack.allowedUsers`
can convene a council. The slash command and shortcut show an ephemeral
refusal to other users. A mention from another user starts nothing.

- **Mention.** Write `@council <question>` to convene the default preset. On
  a top-level message, the council starts in that message's thread. In a
  reply, it starts in the existing thread. To pick a preset, add a separate
  `preset:<name>` or `preset=<name>` token anywhere in the message. The first
  token wins. Match the configured name exactly and leave a space after it
  if more text follows. Only a one-word name without `&`, `<`, `>` or a
  backtick can be chosen this way. The app posts "Council convened." with the
  selected panel. If the name is unknown, the app lists the available presets and
  waits for a new mention. An existing council keeps its panel.
- **Slash command.** `/council [question]` in a channel opens the roster modal,
  with any typed text as the question. On submit the app posts
  "Council convened by <name>: <question>" in the channel and convenes in that
  message's thread, or, if you choose **This whole channel** under **Where**,
  in the channel itself. A channel council reads from the convening post
  onward. Slack does not run slash commands inside threads.
- **Message shortcut.** Choose **Start a council** from a message's **More
  actions** menu, under **Connect to apps**. The council convenes in that
  message's thread, or the thread it replies in. The
  app posts "Council convened by <name>" in the thread with your question.
  Leave the question empty to quote up to 1,000 characters of the selected
  message and have members answer that.

The modal offers a preset (the default preset is preselected) and a member
list. Choosing members overrides the preset. The convening notice names the
preset or says "custom panel". Its Slack table shows each member's handle,
display name, model, and any configured effort and persona title. A thread or
channel that already has a council is refused. A form left open while the
configured presets or members changed is refused. Reopen it to load the
current roster. The app reports failures after the modal closes in an
ephemeral message. This can happen if the app has not joined the channel.

A channel council reads and posts at the top level. Address members and send
stop or end commands at the top level to drive it. A channel has at most one
channel council. Thread councils can still run in its threads, and thread
replies never reach the channel council.
Messages from people outside `slack.allowedUsers` are context only. The app
ignores bot posts, including its own.

## Commands

| You write or click                          | Where                                       | What happens                                                                                                | Acknowledgement               |
| ------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `@council <question>`                       | Channel, top level                          | Convenes a [panel](#convene-a-council) in that message's thread and [opens a round](#rounds-and-settling).  | ⏳ while members work         |
| `@council <question>`                       | A council's thread or channel               | Opens a new round for the whole roster.                                                                     | ⏳                            |
| `/council [question]`                       | Channel composer                            | Opens the [roster picker](#convene-a-council).                                                              | "Council convened by …" post  |
| **Start a council** message shortcut        | A message's menu, under **Connect to apps** | Opens the [roster picker](#convene-a-council) for that message's thread.                                    | "Council convened by …" post  |
| `@<handle>` (one or several)                | A council's thread or channel               | Only those members answer.                                                                                  | ⏳                            |
| A message with no `@council` or `@<handle>` | A council's thread or channel               | Members read it as context on their next turn by default. See [council settings](configuration.md#council). | 👀 in a thread council        |
| `@council stop`                             | A council's thread or channel               | Cancels running and queued turns. The council stays.                                                        | 🛑                            |
| `@council end`                              | A council's thread or channel               | Cancels turns and ends the council.                                                                         | 👋                            |
| **Approve** or **Deny**                     | A tool request posted by the app            | Decides a [tool request](member-tools.md#policy-and-approvals).                                             | The request shows who decided |

## Addressing members

Type a member's plain-text handle. Slack does not autocomplete it. The
app recognizes `@council` as a real app mention or as plain text. Write
`stop` or `end` directly after `@council` and at the end of the line. See
[how the engine parses addresses](design.md#addressing-in-a-human-message).

The default 👀 acknowledgement applies to thread councils. See
[`council.seenReaction`](configuration.md#council) to change where it appears.

To let members notify people by name, see
[`council.memberMentions`](configuration.md#member-mentions).

## Rounds and settling

Every member answers an opening question. With two or more members, a
react round follows by default. See [rounds](design.md#rounds) for the
order of replies and how members pass.

After the hourglass clears, members with unseen posts can raise a hand.
Look for a ✋ reaction on the post and a notice naming the members.
Mention one of them to hear their point. See [how raised hands
work](design.md#raised-hand) and [how to turn them off](configuration.md#council).

Ask for more detail or an in-depth answer to move to a longer
[reply tier](configuration.md#reply-length).
