export type HumanAddress =
  | { readonly kind: 'stop' | 'end' | 'council' | 'unaddressed' }
  | { readonly kind: 'members'; readonly handles: readonly string[] };

function addressableText(text: string, appMention?: string): string {
  const syntax =
    /^[ \t]*(?:(?:>|&gt;)|(~{3,}))[^\r\n]*|`+|\\[@`]|<[^<>\r\n]*>|https?:\/\/[^\s<>`]+/gimu;
  const backticks = /`+/gu;
  const tildes = /^[ \t]*(~{3,})[ \t]*\r?$/gmu;
  const parts: string[] = [];
  let from = 0;

  for (let match = syntax.exec(text); match; match = syntax.exec(text)) {
    const token = match[0];
    parts.push(text.slice(from, match.index));
    if (/^[ \t]*(?:>>>|(?:&gt;){3})/iu.test(token)) {
      from = text.length;
      break;
    }
    const tildeFence = match[1];
    if (tildeFence) {
      tildes.lastIndex = syntax.lastIndex;
      let close = tildes.exec(text);
      while (close?.[1] && close[1].length < tildeFence.length)
        close = tildes.exec(text);
      if (!close) {
        from = text.length;
        break;
      }
      syntax.lastIndex = tildes.lastIndex;
    } else if (token.startsWith('`')) {
      backticks.lastIndex = syntax.lastIndex;
      const fenced = token.length >= 3;
      let close = backticks.exec(text);
      while (
        close &&
        (fenced
          ? close[0].length < token.length
          : close[0].length !== token.length)
      ) {
        close = backticks.exec(text);
      }
      if (close) {
        syntax.lastIndex = backticks.lastIndex;
      } else if (fenced) {
        from = text.length;
        break;
      }
    }
    // A sentinel keeps stripped syntax from joining adjacent words into commands.
    parts.push(token === appMention ? token : '\0');
    from = syntax.lastIndex;
  }
  parts.push(text.slice(from));
  return parts.join('');
}

function handles(text: string): IterableIterator<RegExpExecArray> {
  return text.matchAll(
    /<@[^<>]+>|(?<![\p{L}\p{N}_@-])@([a-z][a-z0-9-]*)(?![\p{L}\p{N}_-])/gu,
  );
}

export function parseHumanAddress(
  text: string,
  appUserId: string,
  roster: readonly string[],
): HumanAddress {
  const appMention = `<@${appUserId}>`;
  const visible = addressableText(text, appMention);
  const members = new Set<string>();
  let council = false;
  let stop = false;

  for (const match of handles(visible)) {
    const id = match[1];
    if (id === 'council' || match[0] === appMention) {
      council = true;
      const after = visible.slice(match.index + match[0].length);
      if (/^[ \t]+end(?![\p{L}\p{N}_-])/iu.test(after)) return { kind: 'end' };
      if (/^[ \t]+stop(?![\p{L}\p{N}_-])/iu.test(after)) stop = true;
    } else if (id !== undefined && roster.includes(id)) {
      members.add(id);
    }
  }

  if (stop) return { kind: 'stop' };
  if (council) return { kind: 'council' };
  if (members.size > 0) return { kind: 'members', handles: [...members] };
  return { kind: 'unaddressed' };
}

export function parseMemberMentions(
  text: string,
  speaker: string,
  roster: readonly string[],
): readonly string[] {
  const members = new Set<string>();
  for (const [, id] of handles(addressableText(text))) {
    if (
      id !== undefined &&
      id !== 'council' &&
      id !== speaker &&
      roster.includes(id)
    ) {
      members.add(id);
    }
  }
  return [...members];
}
