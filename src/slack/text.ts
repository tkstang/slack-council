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

/** Fenced blocks (closed or running to the end) and inline code spans. */
const CODE = /(```[\s\S]*?(?:```|$)|`[^`\n]+`)/u;

/**
 * Break every form that would notify someone: Slack's `<!here>` markup,
 * user-group mentions, plain `@here`, `@channel` and `@everyone`, and `<@U…>`
 * user mentions, so model output cannot ping people. Code spans and fenced
 * blocks are left as written.
 */
export function neutraliseBroadcasts(text: string): string {
  return text
    .split(CODE)
    .map((part, index) => (index % 2 === 1 ? part : neutraliseProse(part)))
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
const FENCE = /^[ \t]*(`{3,}|~{3,})/u;

/** The marker of a fenced block still open at the end of `text`, if any. */
function openFence(text: string): string | undefined {
  let open: string | undefined;
  for (const line of text.split('\n')) {
    const marker = FENCE.exec(line)?.[1];
    if (!marker) continue;
    if (open === undefined) open = marker;
    else if (
      marker[0] === open[0] &&
      marker.length >= open.length &&
      line.trim() === marker
    ) {
      open = undefined;
    }
  }
  return open;
}

/**
 * Fit text into one message of at most `limit` UTF-16 units. Longer text is cut
 * on a code-point boundary and ends with a truncation line; a fenced block the
 * cut lands in is closed first.
 */
export function truncateMarkdown(
  text: string,
  limit = MARKDOWN_TEXT_LIMIT,
): string {
  if (text.length <= limit) return text;
  let end = limit - TRUNCATED.length;
  const marker = openFence(text.slice(0, end));
  const close = marker === undefined ? '' : `\n${marker}`;
  end = Math.max(0, end - close.length);
  const unit = text.charCodeAt(end - 1);
  if (unit >= 0xd800 && unit <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}${close}${TRUNCATED}`;
}
