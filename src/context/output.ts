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

function unwrapEmphasis(text: string): string {
  let candidate = text.trim();
  for (;;) {
    const inner = /^([*_]{1,3})(.+)\1$/su.exec(candidate)?.[2];
    if (inner === undefined) return candidate;
    candidate = inner.trim();
  }
}

function isReactPass(text: string): boolean {
  const reply = unwrapEmphasis(text);
  // A leading PASS ends at a sentence stop, a line break, an em dash, or a
  // spaced hyphen or en dash, so compounds such as "pass–fail" still post.
  const [first] = reply.split(
    /(?<=[.!…][*_]*)\s+|[\r\n\u2028\u2029]|\s*—|\s+[-–]{1,2}\s+/u,
    1,
  );
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
