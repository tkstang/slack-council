export type TurnOutput =
  | { readonly kind: 'pass' }
  | { readonly kind: 'message'; readonly text: string };

export function parseTurnOutput(text: string): TurnOutput {
  let candidate = text.trim();
  for (;;) {
    candidate = candidate.replace(/(?:(?![*_])\p{P})+$/u, '').trimEnd();
    const emphasized = /^([*_]{1,3})(.+)\1$/su.exec(candidate);
    const inner = emphasized?.[2];
    if (inner === undefined) break;
    candidate = inner.trim();
  }
  return /^pass$/iu.test(candidate)
    ? { kind: 'pass' }
    : { kind: 'message', text };
}

export type ListenOutput =
  | { readonly kind: 'pass' }
  | { readonly kind: 'hand'; readonly targetTs: string; readonly note: string }
  | { readonly kind: 'invalid' };

export function parseListenOutput(
  text: string,
  targets: ReadonlyMap<number, string>,
): ListenOutput {
  if (parseTurnOutput(text).kind === 'pass') return { kind: 'pass' };
  const match =
    /^HAND[^\S\r\n]+(?:#\s*(\d+)|\[#\s*(\d+)\])\s*:\s*(.+)$/isu.exec(
      text.trim(),
    );
  const note = match?.[3]?.trim();
  const targetTs = targets.get(Number(match?.[1] ?? match?.[2]));
  return targetTs !== undefined && note
    ? { kind: 'hand', targetTs, note }
    : { kind: 'invalid' };
}
