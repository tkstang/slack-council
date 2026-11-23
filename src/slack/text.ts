/** Slack's documented `markdown_text` limit for one message. */
export const MARKDOWN_TEXT_LIMIT = 12_000;

const WORD_JOINER = '⁠';

/**
 * Break every broadcast form so it cannot notify: Slack's `<!here>` markup,
 * user-group mentions and plain `@here`, `@channel` and `@everyone`.
 */
export function neutraliseBroadcasts(text: string): string {
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
      /(?<![\p{L}\p{N}_])@(here|channel|everyone)(?![\p{L}\p{N}_-])/giu,
      (_, name: string) => `@${WORD_JOINER}${name}`,
    );
}

/** User ids referenced by `<@U…>` markup. */
export function mentionedUserIds(text: string): string[] {
  return [...text.matchAll(/<@([UW][A-Z0-9]+)(?:\|[^<>]*)?>/gu)].map(
    ([, id]) => id ?? '',
  );
}

/**
 * Render Slack markup as plain text for a model transcript: user mentions
 * become `@name` (the app itself is `@council`), channels `#name`, links their
 * label and URL, and Slack's HTML entities are decoded.
 */
export function renderSlackText(
  text: string,
  names: { readonly botUserId: string; name(userId: string): string },
): string {
  return text
    .replace(/<([^<>\r\n]*)>/gu, (whole, inner: string) => {
      const bar = inner.indexOf('|');
      const target = bar === -1 ? inner : inner.slice(0, bar);
      const label = bar === -1 ? undefined : inner.slice(bar + 1);
      if (target.startsWith('@')) {
        const id = target.slice(1);
        if (id === names.botUserId) return '@council';
        return `@${label?.replace(/^@/u, '') || names.name(id)}`;
      }
      if (target.startsWith('#')) return `#${label || target.slice(1)}`;
      if (target.startsWith('!')) {
        const command = target.slice(1);
        if (/^(?:here|channel|everyone)$/u.test(command)) return `@${command}`;
        return label || whole;
      }
      if (target.startsWith('mailto:')) return label || target.slice(7);
      return label && label !== target ? `${label} (${target})` : target;
    })
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

interface Fence {
  readonly line: string;
  readonly marker: string;
}

const FENCE = /^[ \t]*(`{3,}|~{3,})/u;

function updateFence(open: Fence | undefined, line: string): Fence | undefined {
  const marker = FENCE.exec(line)?.[1];
  if (!marker) return open;
  if (!open) return { line, marker };
  const closes =
    marker[0] === open.marker[0] &&
    marker.length >= open.marker.length &&
    line.trim() === marker;
  return closes ? undefined : open;
}

function hardSplit(line: string, size: number): string[] {
  const pieces: string[] = [];
  let rest = line;
  while (rest.length > size) {
    let cut = size;
    // Never separate a surrogate pair.
    if (/[\uD800-\uDBFF]/u.test(rest[cut - 1] ?? '')) cut -= 1;
    pieces.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  pieces.push(rest);
  return pieces;
}

/**
 * Split text into chunks of at most `limit` characters on line boundaries. A
 * fenced code block cut by a boundary is closed at the end of one chunk and
 * reopened at the start of the next. All chunks are prepared before posting.
 */
export function chunkMarkdown(
  text: string,
  limit = MARKDOWN_TEXT_LIMIT,
): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let lines: string[] = [];
  let size = 0;
  let fresh = true;
  let fence: Fence | undefined;

  const push = (piece: string) => {
    size += (lines.length > 0 ? 1 : 0) + piece.length;
    lines.push(piece);
  };
  const flush = () => {
    const body = lines.join('\n');
    chunks.push(fence ? `${body}\n${fence.marker}` : body);
    lines = [];
    size = 0;
    fresh = true;
    if (fence) push(fence.line);
  };

  for (const line of text.split('\n')) {
    // A piece must fit in a fresh chunk beside a reopened fence and its close.
    const overhead = fence ? fence.line.length + fence.marker.length + 2 : 0;
    for (const piece of hardSplit(line, Math.max(1, limit - overhead))) {
      const next = updateFence(fence, piece);
      const cost =
        size +
        (lines.length > 0 ? 1 : 0) +
        piece.length +
        (next ? next.marker.length + 1 : 0);
      if (cost > limit && !fresh) flush();
      push(piece);
      fresh = false;
      fence = next;
    }
  }
  if (!fresh) chunks.push(lines.join('\n'));
  return chunks;
}
