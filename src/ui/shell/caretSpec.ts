/**
 * The streaming caret's decision and its motion values (DESIGN.md §2.11).
 *
 * The decision is the controller's own predicate, lifted from
 * `AiChatPage.tsx:5484` (`showCursor = !!m.streaming && !!m.text`): a caret
 * exists only while a live answer already has text to sit after — a pre-token
 * think draws the cloud, never a cursor over nothing, and a settled turn
 * draws nothing.
 *
 * The motion is §2.11's row as data: opacity 1 → 0.35 → 1 over 1 s, linear,
 * frozen solid as text arrives (the component restarts the blink from solid
 * on every text change, so the blink never fights arriving glyphs). Values
 * live here so `caretSpec.test.ts` can pin them without a render harness —
 * this repo's proof regime — and so the component cannot quietly grow its own
 * numbers.
 *
 * Leaf rules, same as the band around it: no React, no storage, no engine.
 */

/**
 * The controller's thin caret glyph: a hair space and a light vertical bar
 * (`U+2502`). A full block glyph (`U+258B`) at body size read as a missing
 * font — the note `src/chat/StreamCaret.tsx` carries — so the bar is kept.
 */
export const CARET_GLYPH = "\u200A\u2502";

/** §2.11's streaming-caret motion, frozen data. */
export const CARET_BLINK = Object.freeze({
  /** One full 1 → 0.35 → 1 cycle in milliseconds. */
  durationMs: 1000,
  /** Solid — the state the caret returns to each time text arrives. */
  from: 1,
  /**
   * The blink's floor. Not 0: a caret that disappears reads as the turn having
   * ended, which is the claim §2.8 forbids the interface to make.
   */
  to: 0.35,
});

/**
 * Whether this message draws the caret — the controller's predicate verbatim.
 * `streaming` is the live flag the mapper reads from the message; `text` is
 * the message's current answer text.
 */
export function caretVisible(
  streaming: boolean | undefined,
  text: string,
): boolean {
  return streaming === true && text.length > 0;
}
