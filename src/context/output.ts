import type { FloorKind } from '@council/core/types.js';

export type TurnOutput =
  | { readonly kind: 'pass' }
  | { readonly kind: 'message'; readonly text: string };

function isStandalonePass(text: string): boolean {
  let candidate = text.trim();
  for (;;) {
    candidate = candidate.replace(/(?:(?![*_])\p{P})+$/u, '').trimEnd();
    const emphasized = /^([*_]{1,3})(.+)\1$/su.exec(candidate);
    const inner = emphasized?.[2];
    if (inner === undefined) break;
    candidate = inner.trim();
  }
  return /^pass$/iu.test(candidate);
}

function isReactPass(text: string): boolean {
  const reply = text.trim();
  const [first] = reply.split(/(?<=[.!?…:;][*_]*)\s+|[\r\n\u2028\u2029–—]/u, 1);
  const last = /[.!?…][*_]*\s+(\S+)$/u.exec(reply)?.[1];
  return [first, last].some(
    (part) => part !== undefined && isStandalonePass(part),
  );
}

export function parseTurnOutput(
  text: string,
  floorKind?: FloorKind,
): TurnOutput {
  return isStandalonePass(text) || (floorKind === 'react' && isReactPass(text))
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
  if (isStandalonePass(text)) return { kind: 'pass' };
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
