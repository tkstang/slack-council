# Live checks

The unit tests stop at the ports. These checks are the proof that the app works
in Slack: `src/slack/bolt.ts`, `src/app/start.ts` and `src/tools/member-tools.ts`
have no other coverage. Run them in a private test channel after a change that
touches the Slack adapter, the turn runner, tools or approvals, and add a line
to the log.

## Setup

Start the app with a config that has two members on different model families,
the notes example server with `notes__append_note` set to `ask`, and yourself
in `slack.allowedUsers`. Leave `council.unaddressed` and `council.seenReaction` at their defaults,
`silent` and `threads`.
Use cheap models. Send every message as a real user in
the Slack client: messages injected below the adapter do not prove it.

## Checklist

| #   | Do                                                                                                                       | Expect                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Top-level `@council <question>`, picking the app from autocomplete                                                       | ⏳, a "Council convened." notice listing the default preset's panel, then each member answers in the thread under its own name, then a react round                                |
| 2   | In the thread, plain-text `@<handle> <question>`                                                                         | Only that member answers                                                                                                                                                          |
| 3   | In the thread, a message with no `@council` or handle                                                                    | 👀 and no reply (no 👀 for the same in a channel council)                                                                                                                         |
| 4   | `@<handle>`, asking whether they still hold their view                                                                   | The member addresses posts made since it last spoke                                                                                                                               |
| 5   | Wait for the hourglass to clear after a round with unseen posts                                                          | ✋ on a post and a notice naming a member; mentioning them brings their point                                                                                                     |
| 6   | `@<a> @<b>` asking them to keep questioning each other                                                                   | Members hand each other the floor; it stops by itself or with the floor-budget notice                                                                                             |
| 7   | `@<handle>` asking it to append a note; click **Approve**                                                                | A request showing the tool and `name: value` arguments; then "approved by <name>"; note written                                                                                   |
| 8   | The same with another note; click **Deny**                                                                               | "denied by <name>"; the member reports the denial; nothing written                                                                                                                |
| 9   | `/council <question>`, leave the defaults, **Convene**                                                                   | "Council convened by <name>: <question>" and answers in its thread                                                                                                                |
| 10  | A message's **More actions** menu → **Connect to apps** → **Start a council**, empty question, **Convene**               | "Council convened by <name> on this message:" quoting it, and answers in its thread                                                                                               |
| 11  | `/council <question>` with **Where** set to "This whole channel"                                                         | Members answer at the top level of the channel                                                                                                                                    |
| 12  | Top-level `@<handle>` while the channel council is live                                                                  | That member answers at the top level                                                                                                                                              |
| 13  | `@council stop` while members are working                                                                                | 🛑, turns stop, the council stays                                                                                                                                                 |
| 14  | Top-level `@council end`                                                                                                 | 👋; later top-level messages get no reaction or reply                                                                                                                             |
| 15  | Request a note append as in row 7. While approval is pending, send `@council stop` in the same scope.                    | The stop message gets 🛑 and ⏳ clears. The approval card says "Request cancelled." and loses its buttons. A turn cancellation notice appears and the notes file stays unchanged. |
| 16  | In a council, ask a short question, then ask the same member to go into more detail                                      | The first answer is about 120 words. The second is longer, up to about 250, and says so if it stopped at the limit                                                                |
| 17  | Load the example instructions file. In a new council, ask for the council instructions check phrase.                     | The member replies with the phrase from the file. Keep the phrase out of the Slack request.                                                                                       |
| 18  | Enable notes orientation. Ask a member with a notes grant for the notes server check phrase.                             | The member replies with the phrase from the server's orientation. Keep the phrase out of the Slack request.                                                                       |
| 19  | Ask the same member two questions that need no tool, in quick succession in one council. Repeat for both model families. | The first turn logs no `model_cache_read`. The second logs it with positive `cached_input_tokens`.                                                                                |
| 20  | In a new thread, mention `@council` with `preset:<non-default name>` and a question.                                     | The convening notice names the selected preset and lists its panel. Members from that panel answer in the thread.                                                                 |
| 21  | In a thread with no council, mention `@council` with `preset:<unknown name>` and a question.                             | One notice says the preset is unknown and lists the configured names as inline code. No council convenes and no member answers.                                                   |

For row 19, use `gpt-6-luna` and `claude-haiku-5-5`. Use stable guidance long
enough to reach each model's cache minimum and keep the tool definitions fixed.

With `council.memberMentions: "people"`, also ask a member to notify you by
name and expect a real mention.

## Log

Newest first. Record the commit the app was built from, how the messages were
sent, and each row that failed or was skipped.

| Date       | Build     | How                                                         | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------- | --------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-23 | `0fa267e` | Slack desktop app as a real user, read back through the API | Built from the stacked follow-up branches before they were rebased onto `main`. Rows 1, 11, 12 and 14 to 21 passed (row 15 checked against the notes file; row 19 for both model families, from `model_cache_read` in the log). Row 11 also asked for a message posted before the convening post: the history tool returned nothing earlier. Row 16: the second answer was longer (41 words, then 153) and stayed under its limit, so the stopped-at-the-limit sentence was not exercised. Rows 2 to 10 and 13 not run. Handoff not run: no launch credential was configured. |
| 2026-11-23 | `98526a4` | Slack desktop app as a real user, read back through the API | Rows 1 to 3, 7, 8, 10, 11, 13 and 14 passed (rows 7 and 8 checked against the notes file; row 10 found under **Connect to apps**; row 13 arrived after the first answers and cancelled the turn still running). Row 5: the ✋ and its notice appeared, the follow-up mention was not sent. Rows 4, 6, 9 and 12 not run. Also passed: the 👀, 🛑 and 👋 reactions, `name: value` arguments, approver names on both cards, a real mention with `memberMentions: "people"`, and a vault search through an MCP server with no approval request.                                   |
| 2026-11-23 | `a06c209` | Slack desktop app as a real user, read back through the API | Rows 1, 2, 4 to 9, 11, 12 and 14 passed (row 6 stopped by itself; rows 7 and 8 checked against the notes file). Row 3: no reply, before the 👀 reaction existed. Row 10 not run: the shortcut was not in the message menu. Row 13 not run. The 👀, 🛑 and 👋 reactions, `name: value` arguments, approver names and `memberMentions` were added after this build and have not been run live.                                                                                                                                                                                  |
