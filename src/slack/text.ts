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

/** Escape plain text for a Markdown post, with mentions neutralised. */
export function plainMarkdown(text: string): string {
  return neutraliseBroadcasts(text)
    .replace(/[\\`*_~[\]<>#|!]/gu, '\\$&')
    .replace(/^(\s*(?:\d+)?)([-+=.)])/gmu, '$1\\$2');
}

const RESERVED_NAMES = new Set(['council', 'here', 'channel', 'everyone']);
// Spans cross lines, as the neutraliser's patterns do, so nothing it rewrites
// is ever searched for names.
const MARKUP = /(<[^<>]*>)/u;
// A display name with markup or invisible characters could pass for the
// neutraliser's own output, so it is never linkable.
const UNSAFE_NAME = /[<>@\p{C}\p{Default_Ignorable_Code_Point}]/u;
const escapeRegExp = (text: string) =>
  text.replace(/[\\^$.*+?()[\]{}|]/gu, String.raw`\$&`);

/**
 * Member text with every mention neutralised, then `@Name` turned into
 * `<@U…>` for the given people. A mention exists in the result only where a
 * name matched in the member's own prose: `<…>` markup is neutralised as a
 * whole and never searched, so a mention's label cannot produce a link.
 *
 * A name is matched whole and longest first ("Ann Lee" before "Ann"), ignoring
 * case, at the start of a word and never before a letter, digit, accent or
 * dash that would continue it. The longest match
 * decides: when it fits two people, or is reserved (it is, or as a handle
 * would read as, a member handle or a word like `council`), nothing shorter is
 * tried and the text stays as written.
 */
export function linkPeopleMentions(
  text: string,
  people: ReadonlyMap<string, string>,
  reserved: ReadonlySet<string> = new Set(),
): string {
  const entries = [...people]
    .map(([id, name]) => ({ id, name: name.trim() }))
    .filter(({ name }) => name !== '' && !UNSAFE_NAME.test(name))
    .map((entry) => ({
      ...entry,
      // The same case rules as the search below, so two names it cannot tell
      // apart count as one name held by two people.
      exact: new RegExp(`^${escapeRegExp(entry.name)}$`, 'iu'),
    }))
    .toSorted((a, b) => b.name.length - a.name.length);
  if (entries.length === 0) return neutraliseProse(text);

  const taken = (word: string) =>
    RESERVED_NAMES.has(word) || reserved.has(word);
  // The name as written and as Unicode folds it: the addressing parser reads
  // the first, and a look-alike spelling must not slip past the second.
  const isReserved = (name: string) =>
    [name.toLowerCase(), name.normalize('NFKC').toLowerCase()].some(
      (folded) =>
        taken(folded) ||
        // What the addressing parser would read as a handle at the start.
        taken(/^[a-z][a-z0-9-]*(?![\p{L}\p{N}_-])/u.exec(folded)?.[0] ?? ''),
    );
  const search = new RegExp(
    String.raw`(?<=^|[\s\p{Ps}\p{Pi}"'*_~>])@(${entries
      .map(({ name }) => escapeRegExp(name))
      .join('|')})(?![\p{L}\p{N}\p{M}\p{Pd}_])`,
    'giu',
  );
  const link = (prose: string) =>
    prose.replace(search, (whole: string, matched: string) => {
      const [first, second] = entries.filter(({ exact }) =>
        exact.test(matched),
      );
      return first && !second && !isReserved(first.name)
        ? `<@${first.id}>`
        : whole;
    });
  // Odd pieces are `<…>` markup: neutralised, never searched for names.
  return text
    .split(MARKUP)
    .map((piece, index) =>
      index % 2 === 1 ? neutraliseProse(piece) : link(neutraliseProse(piece)),
    )
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
