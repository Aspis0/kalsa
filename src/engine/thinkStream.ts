/**
 * Pure think-tag stream cleaner + round-end arbitrator.
 *
 * Qwen3.5 may emit a leading <think>...</think> block (empty when thinking is
 * forced off, populated when budget modes are on). After a tool round it has
 * also been observed to degenerate into a stream of repeated bare <think>
 * tokens with no close — those must not leak into the UI.
 *
 * Split across two phases so stream and final can diverge by design:
 *
 * 1. STREAM (`cleanDelta`) — conservative: after a mid-text `<think>`, hold
 *    content (do not paint the bubble with raw control tokens). Partial tags
 *    split across deltas are carried until resolved.
 *
 * 2. FINAL (`finalize`) — full-round arbitration on the accumulated raw text:
 *    - Closed `<think>…</think>` pairs anywhere → stripped.
 *    - Leading think block (optional leading whitespace + `<think>`) → stripped
 *      whether closed or truncated, including the leading whitespace.
 *    - ≥2 unclosed mid-text opens → degenerate loop → strip from first open to end.
 *    - Exactly ONE unclosed mid-text open → keep VERBATIM (literal mention /
 *      code sample). The final full-text replace repaints the bubble (pop-in).
 *    - Pending partial tag carry at round end → trimmed from final (no `<thi`
 *      / `</thi` pop-in).
 *
 * Dependency-free of llama.rn / RN so it can be unit-tested with a plain
 * tsc + node harness (scripts/thinkStripperHarness.mjs).
 */

import { partialTagSuffixLength } from "./toolCallParser";

export const THINK_OPEN = "<think>";
export const THINK_CLOSE = "</think>";

export type ThinkStreamCleaner = {
  /** Stream-phase: conservative strip; holds partial tags / mid-text think tails. */
  cleanDelta(text: string): string;
  /**
   * Round-end arbitration on the full raw completion text. Uses stream state
   * only for the pending-carry partial-tag tail trim (F4).
   */
  finalize(rawFullText: string): string;
};

/**
 * Full-round think-tag arbitration (pure, no stream state).
 * Exported for direct unit tests of the policy without driving cleanDelta.
 */
export function arbitrateThinkTags(raw: string): string {
  let text = raw;

  // Leading think block: round starts with optional whitespace then <think>.
  // Strip the block (closed or truncated) INCLUDING the leading whitespace.
  const leadingOpen = text.match(/^[ \t\r\n]*<think>/);
  if (leadingOpen) {
    const afterOpen = text.slice(leadingOpen[0].length);
    const closeIdx = afterOpen.indexOf(THINK_CLOSE);
    if (closeIdx === -1) {
      // Truncated leading think → empty final (not whitespace-only).
      return "";
    }
    text = afterOpen.slice(closeIdx + THINK_CLOSE.length);
  }

  // Closed pairs anywhere.
  text = text.replace(/<think>[\s\S]*?<\/think>/g, "");

  // Unclosed opens remaining after closed-pair strip.
  const openIndexes: number[] = [];
  let searchFrom = 0;
  for (;;) {
    const idx = text.indexOf(THINK_OPEN, searchFrom);
    if (idx === -1) break;
    openIndexes.push(idx);
    searchFrom = idx + THINK_OPEN.length;
  }

  if (openIndexes.length >= 2) {
    // Degenerate loop: strip from first unclosed open to end.
    text = text.slice(0, openIndexes[0]);
  } else if (openIndexes.length === 1) {
    // Exactly one mid-text unclosed open → keep VERBATIM (literal mention).
    // Do not strip residual content after the open.
  } else {
    // No unclosed opens: drop residual orphan closes.
    text = text.replace(/<\/think>/g, "");
  }

  return text;
}

/**
 * Factory: one cleaner instance per completion round (reset by creating fresh).
 */
export function createThinkStreamCleaner(): ThinkStreamCleaner {
  let insideThink = false;
  let thinkCarry = "";
  let thinkDecided = false;

  const cleanDelta = (raw: string): string => {
    let text = thinkCarry + raw;
    thinkCarry = "";
    let out = "";

    // Leading decision: still possible the round opens with a real <think>
    // (only whitespace seen so far).
    if (!insideThink && !thinkDecided) {
      const trimmed = text.replace(/^[ \t\r\n]+/, "");
      if (trimmed.startsWith(THINK_OPEN)) {
        // Real leading block: drop leading whitespace + open tag, enter strip.
        insideThink = true;
        thinkDecided = true;
        text = trimmed.slice(THINK_OPEN.length);
      } else if (trimmed.length === 0 || THINK_OPEN.startsWith(trimmed)) {
        // Still undecided: whitespace only, or a partial "<think>" prefix —
        // hold and wait for more tokens.
        thinkCarry = text;
        return "";
      } else {
        // Diverges from "<think>": no leading think block; text is content.
        thinkDecided = true;
      }
    }

    let i = 0;
    while (i < text.length) {
      if (insideThink) {
        // Nested/repeated opens inside a think region are already stripped
        // (we only hunt for the next close). Partial close at end → carry.
        const closeIdx = text.indexOf(THINK_CLOSE, i);
        if (closeIdx === -1) {
          // Also hold a partial OPEN suffix so a split "<thi" mid-think does
          // not need special handling (it is invisible while insideThink).
          const tail = Math.max(
            partialTagSuffixLength(text.slice(i), THINK_CLOSE),
            partialTagSuffixLength(text.slice(i), THINK_OPEN),
          );
          if (tail > 0) thinkCarry = text.slice(text.length - tail);
          i = text.length;
          break;
        }
        insideThink = false;
        i = closeIdx + THINK_CLOSE.length;
        continue;
      }

      // Outside think: re-enter strip on ANY <think> (stream is conservative —
      // final arbitration decides whether a single unclosed open is kept).
      // Drop orphan </think>, hold partial tags of either kind.
      const openIdx = text.indexOf(THINK_OPEN, i);
      const closeIdx = text.indexOf(THINK_CLOSE, i);
      const nextOpen = openIdx === -1 ? Infinity : openIdx;
      const nextClose = closeIdx === -1 ? Infinity : closeIdx;

      if (nextOpen === Infinity && nextClose === Infinity) {
        const tail = Math.max(
          partialTagSuffixLength(text.slice(i), THINK_OPEN),
          partialTagSuffixLength(text.slice(i), THINK_CLOSE),
        );
        out += text.slice(i, text.length - tail);
        if (tail > 0) thinkCarry = text.slice(text.length - tail);
        i = text.length;
        break;
      }

      if (nextOpen <= nextClose) {
        // Emit prefix before the open. F6: if a pending partial close sits
        // immediately before the open (e.g. "</th" + "<think>"), discard it
        // instead of leaking "</th" into the stream.
        let prefix = text.slice(i, openIdx);
        const partialClose = partialTagSuffixLength(prefix, THINK_CLOSE);
        if (partialClose > 0) {
          prefix = prefix.slice(0, prefix.length - partialClose);
        }
        out += prefix;
        insideThink = true;
        i = openIdx + THINK_OPEN.length;
        continue;
      }

      // Orphan close before any open.
      out += text.slice(i, closeIdx);
      i = closeIdx + THINK_CLOSE.length;
    }
    return out;
  };

  const finalize = (rawFullText: string): string => {
    let text = arbitrateThinkTags(rawFullText);
    // F4: any pending thinkCarry at round end → trim partial open/close
    // fragments so they never pop into persisted text.
    if (thinkCarry.length > 0) {
      const tail = Math.max(
        partialTagSuffixLength(text, THINK_OPEN),
        partialTagSuffixLength(text, THINK_CLOSE),
      );
      if (tail > 0) text = text.slice(0, text.length - tail);
    }
    return text;
  };

  return { cleanDelta, finalize };
}
