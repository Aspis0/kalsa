import type { ContentFilterReason } from "./contentFilter";

export type AskAssistantRole = "assistant" | "user";

export type AskAssistantMessage = {
  id: string;
  miniapp?: AskAssistantMiniapp;
  role: AskAssistantRole;
  sources?: AskAssistantSource[];
  status?: "done" | "streaming" | "thinking";
  text: string;
};

export type AskAssistantSource = {
  host?: string;
  id: string;
  sourceType?: string;
  title?: string;
  url?: string;
};

export type AskAssistantMiniapp = {
  actions?: Array<Record<string, unknown>>;
  blocks: Array<Record<string, unknown>>;
  computed?: Record<string, unknown>;
  interaction?: Record<string, unknown>;
  kind: string;
  navigation?: Record<string, unknown>;
  schema: "miniapp_v1" | "aspis_miniapp_v1";
  size?: "large";
  state?: Record<string, unknown>;
  theme?: string;
  title: string;
};

export type AskAssistantQuickAction = {
  id: string;
  label: string;
  response: string;
};

export type AskAssistantContext = {
  subtitle: string;
  title: string;
  quickActions: AskAssistantQuickAction[];
};

/**
 * Stato generico (non più bio). I futuri tool (websearch, file, engine)
 * potranno estenderlo senza cambiare questa interfaccia.
 */
export type AskAssistantStateInput = Record<string, unknown>;

export function appendAskAssistantDraft(
  messages: AskAssistantMessage[],
  text: string,
): AskAssistantMessage[];
export function appendAskAssistantQuickAction(
  messages: AskAssistantMessage[],
  action?: AskAssistantQuickAction,
): AskAssistantMessage[];
export function createAskAssistantDraftStream(
  messages: AskAssistantMessage[],
  text: string,
  now?: number,
): {
  assistantMessageId: string;
  finalText: string;
  messages: AskAssistantMessage[];
};
export function createAskAssistantBlockedDraft(
  messages: AskAssistantMessage[],
  text: string,
  filterResult?: { reason?: ContentFilterReason | null },
  now?: number,
): AskAssistantMessage[];
export function createAskAssistantOpeningMessage(context: AskAssistantContext): AskAssistantMessage;
export function createAskAssistantStreamingFrames(text: string, frameSize?: number): string[];
export function getAskAssistantContext(state?: AskAssistantStateInput): AskAssistantContext;
export function getAskAssistantScreenPath(state?: AskAssistantStateInput): string;
export function toggleAskAssistantOpen(state: {
  messages: AskAssistantMessage[];
  open: boolean;
}): {
  messages: AskAssistantMessage[];
  open: boolean;
};
export function updateAskAssistantStreamingMessage(
  messages: AskAssistantMessage[],
  assistantMessageId: string,
  text: string,
  status?: "done" | "streaming" | "thinking",
  extras?: { miniapp?: AskAssistantMiniapp | null; sources?: AskAssistantSource[] },
): AskAssistantMessage[];

/** Soft-normalize a miniapp envelope; returns null if unusable. */
export function normalizeMiniapp(raw: unknown): AskAssistantMiniapp | null;

/** Soft-normalize one block (quiz gets safe defaults; oversized → unknown). */
export function normalizeMiniappBlock(block: unknown): Record<string, unknown>;

/**
 * Normalize a quiz block: 4 options.
 * answerIndex is an explicit integer 0-3, or null when missing/invalid
 * (grading disabled — never defaults to 0).
 */
export function normalizeQuizBlock(block: Record<string, unknown>): {
  type: "quiz";
  question: string;
  options: string[];
  answerIndex: number | null;
  explanation?: string;
  title?: string;
};

/** Extract first miniapp JSON from assistant text; strips the JSON from text when found. */
export function parseMiniappFromText(text: string): {
  miniapp: AskAssistantMiniapp | null;
  text: string;
};
