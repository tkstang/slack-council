# Live checks

The unit tests stop at the ports. These checks are the proof that the app works
in Slack: `src/slack/bolt.ts`, `src/app/start.ts` and `src/tools/member-tools.ts`
have no other coverage. Run them in a private test channel after a change that
touches the Slack adapter, the turn runner, tools or approvals, and add a line
to the log.

## Setup

Start the app with a config that has two members on different model families,
the notes example server with `notes__append_note` set to `ask`, and yourself
in `slack.allowedUsers`. Leave `council.unaddressed` at its default, `silent`.
Use cheap models. Send every message as a real user in
the Slack client: messages injected below the adapter do not prove it.

## Checklist

| #   | Do                                                                  | Expect                                                                                          |
| --- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | Top-level `@council <question>`, picking the app from autocomplete  | ⏳, then each member answers in the thread under its own name, then a react round               |
| 2   | In the thread, plain-text `@<handle> <question>`                    | Only that member answers                                                                        |
| 3   | In the thread, a message with no `@council` or handle               | 👀 and no reply                                                                                 |
| 4   | `@<handle>`, asking whether they still hold their view              | The member addresses posts made since it last spoke                                             |
| 5   | Wait for the hourglass to clear after a round with unseen posts     | ✋ on a post and a notice naming a member; mentioning them brings their point                   |
| 6   | `@<a> @<b>` asking them to keep questioning each other              | Members hand each other the floor; it stops by itself or with the floor-budget notice           |
| 7   | `@<handle>` asking it to append a note; click **Approve**           | A request showing the tool and `name: value` arguments; then "approved by <name>"; note written |
| 8   | The same with another note; click **Deny**                          | "denied by <name>"; the member reports the denial; nothing written                              |
| 9   | `/council <question>`, leave the defaults, **Convene**              | "Council convened by <name>: <question>" and answers in its thread                              |
| 10  | A message's menu → **Start a council**, empty question, **Convene** | "Council convened by <name> on this message:" quoting it, and answers in its thread             |
| 11  | `/council <question>` with **Where** set to "This whole channel"    | Members answer at the top level of the channel                                                  |
| 12  | Top-level `@<handle>` while the channel council is live             | That member answers at the top level                                                            |
| 13  | `@council stop` while members are working                           | 🛑, turns stop, the council stays                                                               |
| 14  | Top-level `@council end`                                            | 👋; later top-level messages get no reaction or reply                                           |

With `council.memberMentions: "people"`, also ask a member to notify you by
name and expect a real mention.

## Log

Newest first. Record the commit the app was built from, how the messages were
sent, and each row that failed or was skipped.

| Date       | Build     | How                                                         | Result                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------- | --------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-23 | `a06c209` | Slack desktop app as a real user, read back through the API | Rows 1, 2, 4 to 9, 11, 12 and 14 passed (row 6 stopped by itself; rows 7 and 8 checked against the notes file). Row 3: no reply, before the 👀 reaction existed. Row 10 not run: the shortcut was not in the message menu. Row 13 not run. The 👀, 🛑 and 👋 reactions, `name: value` arguments, approver names and `memberMentions` were added after this build and have not been run live. |
