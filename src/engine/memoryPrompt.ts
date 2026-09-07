/**
 * Pure system-prompt builders for the chat turn.
 * Memory facts live in the system prompt (framed as untrusted data).
 */

import { getStrings, type Locale } from "../i18n";

/** Max user-memory facts injected into the system prompt. */
export const MAX_PROMPT_FACTS = 10;
/** Hard cap per fact line injected into the system prompt. */
export const MAX_PROMPT_FACT_CHARS = 120;

/**
 * Normalize a fact for prompt injection: strip control chars / newlines,
 * collapse whitespace, cap length. Treats facts as untrusted data only.
 */
function sanitizeFactForPrompt(fact: string): string {
  return fact
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PROMPT_FACT_CHARS);
}

/**
 * System prompt for the on-device model, localized via settings locale.
 * With no usable facts the result is byte-identical to the static string.
 */
export function buildSystemPrompt(
  locale: Locale,
  withTools: boolean,
  facts?: string[] | null,
): string {
  const strings = getStrings(locale);
  let prompt = withTools ? strings.systemPromptWithSearch : strings.systemPrompt;
  const cleaned = (facts ?? [])
    .map((fact) => sanitizeFactForPrompt(fact))
    .filter((fact) => fact.length > 0)
    .slice(-MAX_PROMPT_FACTS);
  if (cleaned.length > 0) {
    const factBlock = cleaned.map((fact) => `- ${fact}`).join("\n");
    prompt += `\n\n${strings.memory.promptSection.replace("{facts}", factBlock)}`;
  }
  return prompt;
}
