export type FloorAddress =
  | { readonly kind: 'council' | 'unaddressed' }
  | { readonly kind: 'members'; readonly handles: readonly string[] };

export type HumanAddress =
  | FloorAddress
  | { readonly kind: 'stop' }
  | { readonly kind: 'end' };

function addressableText(text: string, appMention?: string): string {
  const angle =
    appMention === undefined
      ? /<(?:[@#!]|https?:\/\/|mailto:)[^<>\r\n]*>/u
      : /<[^<>\r\n]*>/u;
  const reserved =
    /^[ \t]*(?:(?:>|&gt;)|(~{3,}))[^\r\n]*|`+|\\[@`]|https?:\/\/[^\s<>`]+/u;
  const syntax = new RegExp(`${reserved.source}|${angle.source}`, 'gimu');
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
    /(?<appWrap>[_*])?(?<app><@[^<>]+>)\k<appWrap>|(?<![\p{L}\p{N}_@-])(?<wrap>[_*])?@(?<handle>[a-zA-Z][a-zA-Z0-9-]*)\k<wrap>(?![\p{L}\p{N}_-])/gu,
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
    const id = match.groups?.['handle']?.toLowerCase();
    if (id === 'council' || match.groups?.['app'] === appMention) {
      council = true;
      const after = visible.slice(match.index + match[0].length);
      // A control word counts only when it ends the line, so prose such as
      // "@council, end users are complaining" stays an ordinary address.
      const command =
        /^(?:[ \t]*[:,][ \t]*|[ \t]+)(end|stop)[.!]*[ \t]*(?=\r?\n|$)/iu
          .exec(after)?.[1]
          ?.toLowerCase();
      if (command === 'end') return { kind: 'end' };
      if (command === 'stop') stop = true;
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
  for (const match of handles(addressableText(text))) {
    const id = match.groups?.['handle']?.toLowerCase();
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
