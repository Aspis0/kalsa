export type ContentFilterDecision = "allow" | "warn" | "block" | "safety_block";

export type ContentFilterReason =
  | "abuse"
  | "child_exploitation"
  | "mild_profanity"
  | "non_violent_crime"
  | "privacy"
  | "prompt_injection"
  | "self_harm"
  | "sex_crimes"
  | "sexual_explicit"
  | "unsafe_bio"
  | "unsafe_chem"
  | "violent_crime";

export declare const CONTENT_FILTER_DECISIONS: Readonly<{
  allow: "allow";
  block: "block";
  safetyBlock: "safety_block";
  warn: "warn";
}>;

export declare function classifyChatContent(input: unknown): Readonly<{
  categories: readonly ContentFilterReason[];
  decision: ContentFilterDecision;
  reason: ContentFilterReason | null;
  shouldCallProvider: boolean;
}>;

export declare function formatChatContentFilterMessage(result?: { reason?: ContentFilterReason | null } | ContentFilterReason): string;
