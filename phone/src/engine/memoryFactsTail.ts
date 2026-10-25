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
import { boundMemoryFacts } from "../memory/dnaBounding";
import type { MemoryFact } from "../memory/MemoryStore";

const PROMPT_SECTION: Record<Locale, string> = {
  en: en.memory.promptSection,
  it: it.memory.promptSection,
};

/**
 * Localized untrusted-data fact block, or "" when nothing to inject.
 * Dates + token bounding happen in boundMemoryFacts; this only wraps.
 */
export function buildMemoryFactsBlock(
  locale: Locale,
  facts?: readonly MemoryFact[] | null,
): string {
  const { bounded } = boundMemoryFacts(facts ?? []);
  if (!bounded) return "";
  const template = PROMPT_SECTION[locale] ?? PROMPT_SECTION.en;
  return template.replace("{facts}", bounded);
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

function isIdentityBakedTail(tail: BakedUserTail): boolean {
  const bareKey = bakeRematchKey(tail.bare);
  return (
    bakeRematchKey(tail.prefixed) === bareKey &&
    bakeTextContent(tail.prefixed) === bareKey
  );
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
 * Empty rematch keys never match. Length-1 prefers the latest prev (previous
 * last user). Longer runs still prefer earlier prev, then later baked index.
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
        prevStart + length < prevContents.length
      ) {
        const prevKey = bakeRematchKey(prevContents[prevStart + length]);
        const bakedKey = bakeRematchKey(baked[bakedStart + length]!.bare);
        if (!prevKey || !bakedKey || prevKey !== bakedKey) break;
        length++;
      }
      if (length === 0) continue;
      const cand = { bakedStart, prevStart, length };
      if (!best || length > best.length) {
        best = cand;
        continue;
      }
      if (length !== best.length) continue;
      if (length === 1 && prevStart !== best.prevStart) {
        if (prevStart > best.prevStart) best = cand;
        continue;
      }
      if (length > 1 && prevStart !== best.prevStart) {
        if (prevStart < best.prevStart) best = cand;
        continue;
      }
      if (bakedStart > best.bakedStart) best = cand;
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
    const key = bakeRematchKey(tail.bare);
    if (!key) continue;
    const idx = remaining.lastIndexOf(key);
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
 * still match. Keepers fill holes (and an empty run). Last user stays bare.
 * Unprefixed prev users get identity tails in `matched` (prefixed === bare)
 * so the next rematch covers them. `firstPrevUnprefixed` is true when baked
 * is non-empty and the first previous user got no real replacement.
 */
export function applyBakedUserTails<T extends TailMessage>(
  messages: T[],
  baked: readonly BakedUserTail[],
): {
  messages: T[];
  matched: BakedUserTail[];
  firstPrevUnprefixed: boolean;
} {
  if (!baked.length || messages.length === 0) {
    return { messages, matched: [], firstPrevUnprefixed: false };
  }
  const userIdxs: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === "user") userIdxs.push(i);
  }
  if (userIdxs.length <= 1) {
    return { messages, matched: [], firstPrevUnprefixed: false };
  }
  const prevIdxs = userIdxs.slice(0, -1);
  const prevContents = prevIdxs.map((idx) =>
    bakeRematchKey(messages[idx]?.content),
  );
  const run = findLongestBareRun(prevContents, baked);
  const applied: (BakedUserTail | undefined)[] = prevIdxs.map(() => undefined);
  const usedBaked = new Set<number>();
  if (run) {
    for (let i = 0; i < run.length; i++) {
      const bakedAt = run.bakedStart + i;
      const prevAt = run.prevStart + i;
      const tail = baked[bakedAt]!;
      usedBaked.add(bakedAt);
      applied[prevAt] = {
        bare: bakeTextContent(tail.bare),
        prefixed: bakeTextContent(tail.prefixed),
      };
    }
  }
  const remainingBaked = baked.filter((_, i) => !usedBaked.has(i));
  const remainingPrev = prevContents.filter((_, p) => applied[p] === undefined);
  const keepers = keepStillValidBakedTails(remainingBaked, remainingPrev);
  const keeperPool = keepers.slice();
  for (let p = prevIdxs.length - 1; p >= 0; p--) {
    if (applied[p]) continue;
    const key = prevContents[p]!;
    if (!key) continue;
    const k = keeperPool.findIndex(
      (tail) => bakeRematchKey(tail.bare) === key,
    );
    if (k < 0) continue;
    applied[p] = keeperPool[k]!;
    keeperPool.splice(k, 1);
  }
  const firstPrevUnprefixed = applied[0] === undefined;
  const matched: BakedUserTail[] = [];
  for (let p = 0; p < prevIdxs.length; p++) {
    const tail = applied[p];
    if (tail) {
      matched.push(tail);
      continue;
    }
    const key = prevContents[p]!;
    matched.push({ bare: key, prefixed: key });
  }
  if (applied.every((tail) => tail == null)) {
    return { messages, matched, firstPrevUnprefixed };
  }
  const next = messages.slice();
  for (let p = 0; p < prevIdxs.length; p++) {
    const tail = applied[p];
    if (!tail || isIdentityBakedTail(tail)) continue;
    const idx = prevIdxs[p]!;
    next[idx] = { ...next[idx]!, content: bakeTextContent(tail.prefixed) };
  }
  return { messages: next, matched, firstPrevUnprefixed };
}

/** Append this turn's last-user bake as text; keep at most MAX_BAKED_USER_TAILS. */
/** One unprefixed KV heal per engine hold — not every send. */
export function shouldDiscardUnprefixedHeal(args: {
  firstPrevUnprefixed: boolean;
  kvHoldsChatSession: boolean;
  alreadyHealed: boolean;
}): boolean {
  return (
    args.firstPrevUnprefixed &&
    args.kvHoldsChatSession &&
    !args.alreadyHealed
  );
}

export function commitBakedLastUser(
  matched: readonly BakedUserTail[],
  lastBare: unknown,
  lastPrefixed: unknown,
  keepers: readonly BakedUserTail[] = [],
): BakedUserTail[] {
  const heads = (matched.length > 0 ? matched : keepers).map((tail) => ({
    bare: bakeTextContent(tail.bare),
    prefixed: bakeTextContent(tail.prefixed),
  }));
  const next = heads.concat({
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
