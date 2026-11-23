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
