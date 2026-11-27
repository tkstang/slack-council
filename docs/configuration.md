---
title: Configuration
description: JSON settings for providers, members, councils, Slack access and tools.
---

# Configuration

Start with the [example config](../council.config.example.json). The CLI
rejects unknown fields. Keep secret values in the
[environment](deployment.md#environment-variables).

## Providers

`providers` is a map of names to provider settings. Define at least one
provider.

| Field       | Value                                                     |
| ----------- | --------------------------------------------------------- |
| `baseURL`   | HTTP or HTTPS base URL. Leave credentials out of the URL. |
| `apiKeyEnv` | Name of the environment variable that holds the API key.  |

See [provider compatibility](deployment.md#model-providers) for the API
and request options the app uses.

## Members

`members` is a map keyed by handle. Define at least one member. Start each
handle with a lowercase ASCII letter. Use lowercase letters, digits and
hyphens for the rest. The handle `council` is reserved.

| Field      | Value                                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------------------------- |
| `name`     | Display name for the member's posts.                                                                           |
| `avatar`   | An object with either an `emoji` such as `:compass:` or a `url` with an HTTP or HTTPS URL without credentials. |
| `provider` | Name of a configured provider.                                                                                 |
| `model`    | Model ID accepted by that provider.                                                                            |
| `effort`   | Optional nonempty string. Use a value your provider understands.                                               |
| `persona`  | Optional object with a display `title` and model `instructions`. Leave it out for a neutral role.              |
| `tools`    | List of [tool grants](member-tools.md#grants). Defaults to an empty list.                                      |

## Presets

`presets` maps names to ordered lists of member handles. Each list must be
nonempty, and every handle must exist and appear only once in that list.
`defaultPreset` must name a configured preset. See
[convening a council](using-the-council.md#convene-a-council) to choose a
preset in Slack.

## Slack

`slack.allowedUsers` is a required, nonempty list of Slack user IDs. These
users can convene and drive councils and decide tool requests. The Slack
schema accepts only `allowedUsers`. Control channel access by inviting or
removing the app in Slack.

## Council

The `council` object is optional. Durations are positive integers in
milliseconds and are capped at 2,147,483,647.

| Field               | Default     | Value                                                                                                            |
| ------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------- |
| `instructions`      | Unset       | Path to a [shared instructions file](#instructions).                                                             |
| `rounds`            | `2`         | Positive integer. Total rounds, counting the opening round.                                                      |
| `hopBudget`         | `6`         | Nonnegative integer. Member-to-member mention grants per chain.                                                  |
| `maxTurnsPerChain`  | `24`        | Positive integer. Turn grants per chain.                                                                         |
| `unaddressed`       | `"silent"`  | `silent` keeps a message as context. `council` opens a round for it.                                             |
| `seenReaction`      | `"threads"` | `threads` adds 👀 to messages kept as context in threads. `always` includes channel councils. `off` disables it. |
| `listen`            | `"settle"`  | `settle` lets members [raise a hand](using-the-council.md#rounds-and-settling) after a chain. `off` disables it. |
| `memberMentions`    | `"none"`    | `none` or `people`. See [member mentions](#member-mentions).                                                     |
| `contextChars`      | `24000`     | Transcript character budget. Must be an integer of at least 1,000.                                               |
| `replyWords`        | See below   | [Reply length limits](#reply-length).                                                                            |
| `turnTimeoutMs`     | `60000`     | Time allowed for a turn.                                                                                         |
| `approvalTimeoutMs` | `300000`    | Time allowed for a [tool approval](member-tools.md#policy-and-approvals).                                        |
| `maxSteps`          | `8`         | Positive integer. Model steps allowed per turn. The last step is reserved for the reply.                         |

### Instructions

Set `council.instructions` to a UTF-8 Markdown file with guidance for every
member's public replies and private listening. Relative paths resolve from
the config file's directory. Absolute paths are used as written.

Both `validate` and `start` read the file once. A missing or unreadable file
produces `E_CONFIG_READ`, a blank one `E_EMPTY_INPUT`, and one over 8,000
UTF-16 code units `E_FILE_TOO_LARGE`. Restart the app to apply edits.

### Reply length

`council.replyWords` contains three positive integers ordered as
`default <= detailed <= max`. Members aim for `default` words (120) on an
ordinary turn, `detailed` (250) when asked for more detail, explanation or
examples, and `max` (1,000) when asked to go in depth. If a member has more
to say, it should end with a short sentence saying it stopped at the limit
and can go further.

### Member mentions

With `memberMentions: "none"`, the app renders mentions in members' posts
so Slack will suppress notifications. With `"people"`, a member can write
`@Name` to notify someone who has posted or been mentioned in that channel's
councils. The name must be unique among those people and must not be, or begin
with, a member handle. `@here`, `@channel`, `@everyone` and user groups never
notify.

## State directory

`stateDir` defaults to `.council`. Relative paths resolve from the process
working directory. See [deployment](deployment.md#runtime-and-state) for
storage requirements.

## Tools

The `tools` object is optional.

| Field        | Purpose                                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| `files`      | Configure [readable roots and deny globs](member-tools.md#files).                                                |
| `mcpServers` | Declare named [stdio and HTTP servers](member-tools.md#mcp-servers). Defaults to an empty object.                |
| `handoff`    | Configure the folder and the write and launch tools for [handoffs](member-tools.md#handoff-to-a-coding-session). |
| `policy`     | Set ordered [approval rules](member-tools.md#policy-and-approvals). Defaults to an empty list.                   |
