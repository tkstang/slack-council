---
title: Member tools
description: Grant built-in and MCP tools to members and configure approvals and handoffs.
---

# Member tools

Set `members.<handle>.tools` to the grants that member can use. An empty list
gives the member no tools.

## Grants

| Grant              | Tools it exposes                                                                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `files`            | `read_file`, `list_dir`, `search_files`                                                                                                                  |
| `slack_history`    | Earlier messages from this council's thread or channel. It starts before the prompt transcript and accepts the returned `oldestTs` as a `before` cursor. |
| `show_chart`       | Up to two native pie, bar, line or area charts in an opening or mention reply. Chart values are available in the conversation transcript.                |
| `handoff`          | Proposes a Markdown note and a coding session for one approval.                                                                                          |
| `<server>`         | Every compatible tool from the named MCP server.                                                                                                         |
| `<server>__<tool>` | One tool from the named MCP server.                                                                                                                      |

For channel councils, the convening post is the earliest message
`slack_history` can return.

Grant `show_chart` to members that should use charts. They still write the
takeaway in the reply and can use Markdown tables for tabular comparisons.
In react rounds, members can refer to charts already posted.

## Files

**A readable file is a quotable file.** Anything the tools can read may appear
in Slack. Choose roots whose contents the council's Slack audience can see.
`tools.files.roots` defaults to an empty list. Relative paths resolve from the app's
working directory. The tools check real paths, filter directory entries and
search hits through the same policy, and refuse symlinks that escape a root.
The default deny globs cover env files, common credential directories, keys
and keychains. Supplying `tools.files.deny` replaces that list. The denylist
helps prevent accidental disclosure. Use the roots to limit access.

Reads accept UTF-8 files up to 64 KiB and support inclusive, one-based line
ranges. Listings return up to 100 entries. Literal searches return up to 50
hits with 300 characters per line. Listings and searches inspect up to 2,000
directory entries per call.

## MCP servers

MCP tool names use 1 to 64 ASCII letters, digits, underscores or hyphens.
Server names use the same characters with single underscores between
segments. Built-in grant names are reserved. Config validation checks
grants against declared server names. The server supplies its available tool
names at startup.

Declare servers in `tools.mcpServers`. The `transport` field selects one of
two configurations.

- `stdio` requires a `command`. The optional `args` list defaults to empty.
  The optional `env` map names child variables and the variables to read
  them from in the app's environment.
- `http` requires an HTTP or HTTPS `url` without inline credentials. The
  optional `headersEnv` map names headers and the environment variables
  holding their values.

Each server connects at startup. A failed connection or missing mapped
variable disables that server's tools and logs `E_MCP_UNAVAILABLE`.

Set `orientation: true` on a stdio or HTTP server to trust its handshake
instructions as operator guidance. Only members granted at least one
compatible tool from that server receive its orientation. It appears in
public and private listening prompts and grants no tool access on its own.
The default is `false`. Text over 8,000 UTF-16 code units is shortened to
fit the limit with an `[Orientation truncated]` marker. A marked server
that supplies no text logs one `mcp_orientation_missing` warning with the
server key.

The example config uses [the notes MCP server](../examples/notes-mcp-server.mjs).
Set `COUNCIL_NOTES_FILE` in the app's environment to a file intended for the
council. The server exposes `notes__list_notes` and `notes__append_note`.
The example allows automatic reads and asks for approval before appending.

## Policy and approvals

Rules in `tools.policy` match the exposed tool name, in order. Use an exact
name, a literal prefix ending in `*` such as `notes__*` for one server, or
`*` to match every tool. The first match wins. Built-ins such as `show_chart`
default to `auto`, and MCP tools default to `ask`. Handoff always asks.
Approval rules apply only to tools already granted to the member.

An `ask` call posts the member, tool and the full arguments in the council
conversation. The heading shows the tool name in inline code. Each argument
is a `name: value` line. The card shows a string without quotes only when it
is one plain line that is not itself JSON, and escapes invisible characters.
The app refuses arguments too long to show in full. Any user in
`slack.allowedUsers` can click **Approve** or **Deny**. Each request can be
decided once. A denial, expiry or cancellation returns a tool error. Two
denials or expiries suppress further requests during that turn. Tool results
over 64 KiB are refused. See the [approval timeout setting](configuration.md#council).
The turn timer pauses while waiting for approval. `stop` and `end` cancel the
wait immediately. Pending requests expire on restart.

## Handoff to a coding session

In your private config, set `tools.handoff.folder` to a vault-relative folder.
Use forward slashes with no leading slash, empty segments or dot segments.
Set `tools.handoff.write` and `tools.handoff.launch` to objects with
`server` and `tool` keys. Declare both servers in `tools.mcpServers`. The
example uses placeholders for a Stoa `vault_write` and a Switchboard
`launch`. The Switchboard credential must allow launches without a source
thread ID. For a setup without handoff, remove the block, its member grants
and any unused placeholder servers.

Add `handoff` to each member that should propose handoffs. It requires
`tools.handoff`. If either tool is missing from the connected catalogs, the
app logs `handoff_unavailable` once at startup and skips the grant. Handoff
uses the two tools internally. Granting either tool directly, including via
a whole-server grant, bypasses the single-approval flow for direct calls.

Ask a member to hand off work and specify the target machine and project.
The card shows the target and the final prompt, then the resolved note path
and the whole note. The note appears as one JSON-quoted line, with line breaks
shown as `\n`, so nothing in it can pass for another field.
**Approve** writes the note and then launches the session with a pointer
to the note. **Reject** ends the request. **Change** opens a form for your
instructions and returns them to the member, who can propose a revised
handoff for approval. The preview fits up to 8,000 UTF-16 code units
including escaped characters and labels. Longer proposals return a request
for a shorter note.

The launch runs only after a confirmed write. If a written note is followed
by a failed or unconfirmed launch, the member receives the note path and
launch status. The app leaves the note in place and does not replay either
call.
