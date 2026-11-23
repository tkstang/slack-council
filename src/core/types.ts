export interface Scope {
  readonly channel: string;
  readonly threadTs?: string;
}

export type Avatar = { readonly emoji: string } | { readonly url: string };

export interface Member {
  readonly id: string;
  readonly name: string;
  readonly avatar: Avatar;
  readonly provider: string;
  readonly model: string;
  readonly effort?: string;
  readonly persona: string;
  readonly tools: readonly string[];
}

export interface CouncilSettings {
  readonly rounds: number;
  readonly hopBudget: number;
  readonly maxTurnsPerChain: number;
  readonly unaddressed: 'silent' | 'council';
  readonly contextChars: number;
  readonly turnTimeoutMs: number;
  readonly maxSteps: number;
}

export interface Council {
  readonly id: string;
  readonly scope: Scope;
  readonly owner: string;
  readonly roster: readonly string[];
  readonly settings: CouncilSettings;
}

export type HumanAuthor = {
  readonly kind: 'human';
  readonly userId: string;
  readonly displayName: string;
};

export type Author =
  | HumanAuthor
  | { readonly kind: 'member'; readonly memberId: string }
  | { readonly kind: 'notice' }
  | { readonly kind: 'otherBot'; readonly displayName: string };

export interface Message {
  readonly ts: string;
  readonly author: Author;
  /** Plain, decoded text from Slack history. The context builder escapes it once for the prompt. */
  readonly text: string;
}

export interface HumanMessage {
  readonly ts: string;
  readonly author: HumanAuthor;
  /** Raw Slack-encoded event text, used only for addressing. */
  readonly text: string;
}

export type FloorKind = 'round' | 'react' | 'mention';

export interface Prompt {
  readonly system: string;
  readonly user: string;
}
