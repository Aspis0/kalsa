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

/** One completed user turn's format-B text (persist/assemble bare vs engine text). */
export type BakedUserTail = {
  bare: string;
  prefixed: string;
};

/** Safety cap on persisted / in-memory baked tails (engine window is smaller). */
export const MAX_BAKED_USER_TAILS = 64;
/** Same cap assembleEngineHistory uses for text-only turns. */
export const BAKE_REMATCH_MAX_CHARS = 4000;

/**
 * Canonical rematch key: the string that must equal on commit and on the
 * next turn's previous-user history (persona'd content, trim, slice).
 */
export function bakeRematchKey(content: unknown): string {
  return bakeTextContent(content).trim().slice(0, BAKE_REMATCH_MAX_CHARS);
}

/**
 * Text used for bake rematch / persist. Strings pass through. Arrays keep
 * `type:"text"` parts only — never `image_url` (images stay on the current user).
 */
export function bakeTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let text = "";
  for (const part of content) {
    if (
      part &&
      typeof part === "object" &&
      (part as { type?: unknown }).type === "text" &&
      typeof (part as { text?: unknown }).text === "string"
    ) {
      text += (part as { text: string }).text;
    }
  }
  return text;
}

function coerceBakeText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return bakeTextContent(value);
  return undefined;
}

export function sameMessageContent(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "string" || typeof b === "string") {
    return bakeTextContent(a) === bakeTextContent(b);
  }
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
 * Longest consecutive baked.bare run against previous-user text.
 * Covers drop-prefix (compaction) and drop-suffix (regen / edit last).
 * Tie-break: earlier prev index (KV dies at the first unmatched user), then
 * later baked index (suffix — compaction of identical bares).
 */
function findLongestBareRun(
  prevContents: readonly string[],
  baked: readonly BakedUserTail[],
): { bakedStart: number; prevStart: number; length: number } | null {
  let best: { bakedStart: number; prevStart: number; length: number } | null =
    null;
  for (let bakedStart = 0; bakedStart < baked.length; bakedStart++) {
    for (let prevStart = 0; prevStart < prevContents.length; prevStart++) {
      let length = 0;
      while (
        bakedStart + length < baked.length &&
        prevStart + length < prevContents.length &&
        bakeRematchKey(prevContents[prevStart + length]) ===
          bakeRematchKey(baked[bakedStart + length]!.bare)
      ) {
        length++;
      }
      if (length === 0) continue;
      if (
        !best ||
        length > best.length ||
        (length === best.length && prevStart < best.prevStart) ||
        (length === best.length &&
          prevStart === best.prevStart &&
          bakedStart > best.bakedStart)
      ) {
        best = { bakedStart, prevStart, length };
      }
    }
  }
  return best;
}

/**
 * Keep baked tails whose bare still appears among remaining previous users
 * (multiset). Used when the consecutive run is empty so commit does not wipe
 * still-valid earlier tails and replace them with only the new last turn.
 */
export function keepStillValidBakedTails(
  baked: readonly BakedUserTail[],
  prevContents: readonly unknown[],
): BakedUserTail[] {
  const remaining = prevContents.map((c) => bakeRematchKey(c));
  const keepers: BakedUserTail[] = [];
  for (const tail of baked) {
    const idx = remaining.indexOf(bakeRematchKey(tail.bare));
    if (idx >= 0) {
      keepers.push({
        bare: bakeTextContent(tail.bare),
        prefixed: bakeTextContent(tail.prefixed),
      });
      remaining.splice(idx, 1);
    }
  }
  return keepers;
}

/**
 * Re-apply previously baked format-B prefixes onto earlier user messages.
 *
 * llama.rn prefix-matches the tokenized prompt against KV. The last-user prefix
 * is ephemeral unless later turns send that same prefixed content as history —
 * otherwise match dies at the previous user every turn (stable facts worse than
 * facts-in-system). Aligns the longest consecutive bare run so both a
 * compaction window (drop-prefix) and regen/edit of the last turn (drop-suffix)
 * still match. Stops applying at the first bare-content mismatch. Does not
 * mutate `messages`. Last user is left bare for this turn's format-B apply.
 * Applied content is always a string (never image_url).
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
  const prevContents = prevIdxs.map((idx) =>
    bakeRematchKey(messages[idx]?.content),
  );
  const run = findLongestBareRun(prevContents, baked);
  const replacements: { idx: number; tail: BakedUserTail }[] = [];
  const aligned: BakedUserTail[] = [];
  if (run) {
    for (let i = 0; i < run.length; i++) {
      const tail = baked[run.bakedStart + i]!;
      replacements.push({ idx: prevIdxs[run.prevStart + i]!, tail });
      aligned.push({
        bare: bakeTextContent(tail.bare),
        prefixed: bakeTextContent(tail.prefixed),
      });
    }
  }
  const matched =
    aligned.length > 0 ? aligned : keepStillValidBakedTails(baked, prevContents);
  if (replacements.length === 0) return { messages, matched };
  const next = messages.slice();
  for (const { idx, tail } of replacements) {
    next[idx] = { ...next[idx]!, content: bakeTextContent(tail.prefixed) };
  }
  return { messages: next, matched };
}

/** Append this turn's last-user bake as text; keep at most MAX_BAKED_USER_TAILS. */
export function commitBakedLastUser(
  matched: readonly BakedUserTail[],
  lastBare: unknown,
  lastPrefixed: unknown,
): BakedUserTail[] {
  const next = matched
    .map((tail) => ({
      bare: bakeTextContent(tail.bare),
      prefixed: bakeTextContent(tail.prefixed),
    }))
    .concat({
      bare: bakeRematchKey(lastBare),
      prefixed: bakeTextContent(lastPrefixed),
    });
  return next.length > MAX_BAKED_USER_TAILS
    ? next.slice(-MAX_BAKED_USER_TAILS)
    : next;
}

/** Fail-closed parse of session-meta baked tails (text only). */
export function parseBakedUserTails(raw: unknown): BakedUserTail[] {
  if (!Array.isArray(raw)) return [];
  const out: BakedUserTail[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    if (!("bare" in item) || !("prefixed" in item)) continue;
    const bare = coerceBakeText((item as { bare: unknown }).bare);
    const prefixed = coerceBakeText((item as { prefixed: unknown }).prefixed);
    if (bare === undefined || prefixed === undefined) continue;
    out.push({ bare, prefixed });
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

/** Prefix string or first text part. Image parts are unchanged (current user only). */
export function prefixMessageContent(content: unknown, prefix: string): unknown {
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
