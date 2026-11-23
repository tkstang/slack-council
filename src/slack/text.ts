/** Slack's documented `markdown_text` limit for one message. */
export const MARKDOWN_TEXT_LIMIT = 12_000;

const WORD_JOINER = '⁠';

function neutraliseProse(text: string): string {
  return text
    .replace(
      /<!(here|channel|everyone)(?:\|[^<>]*)?>/giu,
      (_, name: string) => `@${WORD_JOINER}${name}`,
    )
    .replace(
      /<!subteam\^[A-Za-z0-9]+(?:\|@?([^<>]*))?>/gu,
      (_, label: string | undefined) => `@${WORD_JOINER}${label ?? 'group'}`,
    )
    .replace(
      /<@([UW][A-Z0-9]+)(?:\|@?([^<>]*))?>/gu,
      (_, id: string, label: string | undefined) =>
        `@${WORD_JOINER}${label || id}`,
    )
    .replace(
      /(?<![\p{L}\p{N}_])@(here|channel|everyone)(?![\p{L}\p{N}_-])/giu,
      (_, name: string) => `@${WORD_JOINER}${name}`,
    );
}

/**
 * Break every form that would notify someone: Slack's `<!here>` markup,
 * user-group mentions, plain `@here`, `@channel` and `@everyone`, and `<@U…>`
 * user mentions, so model output cannot ping people. Code is not exempt: an
 * unclosed fence or an escaped backtick would otherwise smuggle a mention out.
 */
export function neutraliseBroadcasts(text: string): string {
  return neutraliseProse(text);
}

const RESERVED_NAMES = new Set(['council', 'here', 'channel', 'everyone']);

/**
 * Turn `@Name` into `<@U…>` for the given people. Run it on text whose own
 * mentions are already neutralised, so a mention exists only where a name
 * matched. A name is matched whole, ignoring case, longest first ("Ann Lee"
 * before "Ann"), at the start of a word and never inside `<…>` markup or
 * before a hyphen (`@ann-lee` is one token). A name is skipped when it is not
 * unique among the people given, or when it or its first word is a reserved
 * word such as a member handle: those already mean something else.
 */
export function linkPeopleMentions(
  text: string,
  people: ReadonlyMap<string, string>,
  reserved: ReadonlySet<string> = new Set(),
): string {
  const named = [...people].map(([id, name]) => ({ id, name: name.trim() }));
  const uses = new Map<string, number>();
  for (const { name } of named) {
    const lower = name.toLowerCase();
    uses.set(lower, (uses.get(lower) ?? 0) + 1);
  }
  const taken = (word: string) =>
    RESERVED_NAMES.has(word) || reserved.has(word);
  const known = named
    .filter(({ name }) => {
      const lower = name.toLowerCase();
      return (
        name.length > 1 &&
        uses.get(lower) === 1 &&
        !taken(lower) &&
        !taken(lower.split(/[\s-]/u)[0] ?? '')
      );
    })
    .toSorted((a, b) => b.name.length - a.name.length);
  if (known.length === 0) return text;
  const link = (plain: string) => {
    let out = plain;
    for (const { id, name } of known) {
      const escaped = name.replace(/[\\^$.*+?()[\]{}|]/gu, String.raw`\$&`);
      out = out.replace(
        new RegExp(
          String.raw`(?<=^|[\s(\[{"'*_~>])@${escaped}(?![\p{L}\p{N}_-])`,
          'giu',
        ),
        `<@${id}>`,
      );
    }
    return out;
  };
  // Odd pieces are `<…>` markup (links, channels); leave them as written.
  return text
    .split(/(<[^<>\n]*>)/u)
    .map((piece, index) => (index % 2 === 1 ? piece : link(piece)))
    .join('');
}

/** User ids referenced by `<@U…>` markup. */
export function mentionedUserIds(text: string): string[] {
  return [...text.matchAll(/<@([UW][A-Z0-9]+)(?:\|[^<>]*)?>/gu)].map(
    ([, id]) => id ?? '',
  );
}

/** Slack's own tokens: mentions, channels, special commands and links. */
const SLACK_TOKEN =
  /<(@[UW][A-Z0-9]+|#[A-Z0-9]+|![^<>|\s]+|(?:https?:\/\/|mailto:)[^<>|\s]+)(?:\|([^<>\r\n]*))?>/gu;

/**
 * Render Slack markup as plain text for a model transcript: user mentions
 * become `@name` (the app itself is `@council`), channels `#name`, links their
 * label and URL, and Slack's HTML entities are decoded. Other angle-bracket
 * text is left as written.
 */
export function renderSlackText(
  text: string,
  names: { readonly botUserId: string; name(userId: string): string },
): string {
  return text
    .replace(
      SLACK_TOKEN,
      (whole, target: string, label: string | undefined) => {
        if (target.startsWith('@')) {
          const id = target.slice(1);
          if (id === names.botUserId) return '@council';
          return `@${label?.replace(/^@/u, '') || names.name(id)}`;
        }
        if (target.startsWith('#')) return `#${label || target.slice(1)}`;
        if (target.startsWith('!')) {
          const command = target.slice(1);
          if (/^(?:here|channel|everyone)$/u.test(command))
            return `@${command}`;
          return label || whole;
        }
        if (target.startsWith('mailto:')) return label || target.slice(7);
        return label && label !== target ? `${label} (${target})` : target;
      },
    )
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

const TRUNCATED = '\n… (truncated)';

/**
 * Fit text into one message of at most `limit` UTF-16 units. Longer text is cut
 * on a code-point boundary and ends with a truncation line.
 */
export function truncateMarkdown(
  text: string,
  limit = MARKDOWN_TEXT_LIMIT,
): string {
  if (text.length <= limit) return text;
  if (limit <= TRUNCATED.length) return text.slice(0, Math.max(0, limit));
  let end = limit - TRUNCATED.length;
  // Cut at whitespace when one is near, so a word such as a member handle is
  // never shortened into a different one.
  if (!/\s/u.test(text[end] ?? ' ')) {
    const space = text.slice(0, end).search(/\s\S*$/u);
    if (space !== -1 && end - space <= 80) end = space;
  }
  const unit = text.charCodeAt(end - 1);
  if (unit >= 0xd800 && unit <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}${TRUNCATED}`;
}
