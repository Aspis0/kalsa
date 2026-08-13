/**
 * Memory-fact injection for chat turns (P1-1 / format B).
 *
 * Facts are untrusted user data. They ride the last user message so a new fact
 * does not rewrite the system prompt (which would invalidate the entire KV
 * prefix). Callers still gate on MemoryStore opt-in — this module only formats.
 *
 * i18n: imports en/it catalogs directly so Node harnesses do not pull React.
 */

import { en } from "../i18n/en";
import { it } from "../i18n/it";
import type { Locale } from "../i18n/types";

/** Max user-memory facts injected into the turn (newest last). */
export const MAX_PROMPT_FACTS = 10;
/** Hard cap per fact line injected into the turn. */
export const MAX_PROMPT_FACT_CHARS = 120;

const PROMPT_SECTION: Record<Locale, string> = {
  en: en.memory.promptSection,
  it: it.memory.promptSection,
};

/**
 * Normalize a fact for prompt injection: strip control chars / newlines,
 * collapse whitespace, cap length. Treats facts as untrusted data only.
 */
export function sanitizeFactForPrompt(fact: string): string {
  return fact
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PROMPT_FACT_CHARS);
}

/** Newest-first budget: sanitize, drop empties, keep last MAX_PROMPT_FACTS. */
export function selectPromptFacts(facts?: string[] | null): string[] {
  return (facts ?? [])
    .map((fact) => sanitizeFactForPrompt(fact))
    .filter((fact) => fact.length > 0)
    .slice(-MAX_PROMPT_FACTS);
}

/**
 * Localized untrusted-data fact block, or "" when nothing to inject.
 * Does not log or persist — formatting only.
 */
export function buildMemoryFactsBlock(
  locale: Locale,
  facts?: string[] | null,
): string {
  const cleaned = selectPromptFacts(facts);
  if (cleaned.length === 0) return "";
  const factBlock = cleaned.map((fact) => `- ${fact}`).join("\n");
  const template = PROMPT_SECTION[locale] ?? PROMPT_SECTION.en;
  return template.replace("{facts}", factBlock);
}

export type TailMessage = {
  role: string;
  content?: unknown;
};

/** One completed user turn's format-B content (bare UI text vs engine text). */
export type BakedUserTail = {
  bare: unknown;
  prefixed: unknown;
};

/** Safety cap on persisted / in-memory baked tails (engine window is smaller). */
export const MAX_BAKED_USER_TAILS = 64;

export function sameMessageContent(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "string" || typeof b === "string") return a === b;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export function lastUserContent<T extends TailMessage>(
  messages: T[],
): unknown | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return messages[i]!.content;
  }
  return undefined;
}

/**
 * Re-apply previously baked format-B prefixes onto earlier user messages.
 *
 * llama.rn prefix-matches the tokenized prompt against KV. The last-user prefix
 * is ephemeral unless later turns send that same prefixed content as history —
 * otherwise match dies at the previous user every turn (stable facts worse than
 * facts-in-system). Aligns baked tails to the previous-user suffix so a
 * compaction window still matches. Stops at the first bare-content mismatch
 * (edit / chat switch). Does not mutate `messages`. Last user is left bare
 * for this turn's format-B apply.
 */
export function applyBakedUserTails<T extends TailMessage>(
  messages: T[],
  baked: readonly BakedUserTail[],
): { messages: T[]; matched: BakedUserTail[] } {
  if (!baked.length || messages.length === 0) {
    return { messages, matched: [] };
  }
  const userIdxs: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === "user") userIdxs.push(i);
  }
  if (userIdxs.length <= 1) {
    return { messages, matched: [] };
  }
  const prevIdxs = userIdxs.slice(0, -1);
  const offset = baked.length - prevIdxs.length;
  const bakedStart = offset >= 0 ? offset : 0;
  const prevStart = offset >= 0 ? 0 : -offset;
  const matched: BakedUserTail[] = [];
  const replacements: { idx: number; tail: BakedUserTail }[] = [];
  for (
    let i = 0;
    bakedStart + i < baked.length && prevStart + i < prevIdxs.length;
    i++
  ) {
    const msg = messages[prevIdxs[prevStart + i]!];
    const tail = baked[bakedStart + i]!;
    if (!sameMessageContent(msg?.content, tail.bare)) break;
    replacements.push({ idx: prevIdxs[prevStart + i]!, tail });
    matched.push(tail);
  }
  if (replacements.length === 0) return { messages, matched: [] };
  const next = messages.slice();
  for (const { idx, tail } of replacements) {
    next[idx] = { ...next[idx]!, content: tail.prefixed };
  }
  return { messages: next, matched };
}

/** Append this turn's last-user bake; keep at most MAX_BAKED_USER_TAILS. */
export function commitBakedLastUser(
  matched: readonly BakedUserTail[],
  lastBare: unknown,
  lastPrefixed: unknown,
): BakedUserTail[] {
  const next = matched.concat({ bare: lastBare, prefixed: lastPrefixed });
  return next.length > MAX_BAKED_USER_TAILS
    ? next.slice(-MAX_BAKED_USER_TAILS)
    : next;
}

/** Fail-closed parse of session-meta baked tails. */
export function parseBakedUserTails(raw: unknown): BakedUserTail[] {
  if (!Array.isArray(raw)) return [];
  const out: BakedUserTail[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    if (!("bare" in item) || !("prefixed" in item)) continue;
    out.push({
      bare: (item as BakedUserTail).bare,
      prefixed: (item as BakedUserTail).prefixed,
    });
    if (out.length >= MAX_BAKED_USER_TAILS) break;
  }
  return out;
}

/**
 * Prefix `factsBlock` onto the last user message (format B / user-prefix).
 * Same placement as the operative digest: only the last-user tail changes.
 * Does not mutate `messages`. No-op when the block is empty or no user exists.
 * Callers must re-apply prior turns via applyBakedUserTails so KV prefix-match
 * can continue past the previous user.
 */
export function applyMemoryFactsToLastUser<T extends TailMessage>(
  messages: T[],
  factsBlock: string,
): T[] {
  if (!factsBlock || messages.length === 0) return messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg && msg.role === "user") {
      const next = messages.slice();
      next[i] = { ...msg, content: prefixMessageContent(msg.content, factsBlock) };
      return next;
    }
  }
  return messages;
}

function prefixMessageContent(content: unknown, prefix: string): unknown {
  if (typeof content === "string") {
    return `${prefix}\n\n${content}`;
  }
  if (Array.isArray(content)) {
    let prefixed = false;
    const parts = content.map((part) => {
      if (
        !prefixed &&
        part &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "text"
      ) {
        prefixed = true;
        const text =
          typeof (part as { text?: unknown }).text === "string"
            ? (part as { text: string }).text
            : "";
        return { ...(part as object), text: `${prefix}\n\n${text}` };
      }
      return part;
    });
    if (!prefixed) {
      parts.unshift({ type: "text", text: prefix });
    }
    return parts;
  }
  return `${prefix}\n\n`;
}
