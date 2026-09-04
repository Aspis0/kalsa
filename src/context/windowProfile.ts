/**
 * How many verbatim messages the engine window may hold, derived instead of
 * hardcoded.
 *
 * Everything else the engine is tuned with — threads, ubatch, backend, n_ctx —
 * is already resolved from the device and the model with provenance. The
 * verbatim window was the last magic number: `LEGACY_MAX_HISTORY = 20`,
 * regardless of how much context the engine actually loaded. That produced a
 * decision that could not take effect: widening the window to 40 was gated on
 * `n_ctx >= 16384`, and the S23 misses the RAM threshold for that context by
 * 82 MB, so on every 8 GB phone the wider window was inert.
 *
 * The fix is not a bigger constant. The window's real currency is **context
 * tokens**, so it is sized as a share of the context the engine actually got.
 * The message count stays only as a secondary sanity cap.
 *
 * Pure module — no react-native, no AsyncStorage — so the harness can load it.
 */

/**
 * Context the window may NOT spend: system prompt, the digest when there is
 * one, and room to generate into. Anchors, all measured: system prompt ~500
 * tokens; the digest added ~350 prompt tokens by turn 13 on the 4B campaign;
 * the thinking budget alone is up to 512 and the answer follows it. 2048 is
 * those three plus a little, and it is deliberately not tight — overrunning
 * n_ctx does not error, it silently engages ctx_shift, which discards the
 * oldest KV and destroys exactly the prefix the window exists to preserve.
 */
export const WINDOW_RESERVE_TOKENS = 2048;

/**
 * Chars per token, deliberately LOW. The window budget is in characters
 * because that is what the history carries, and a low ratio converts a token
 * budget into fewer characters — i.e. it errs toward a smaller window. Italian
 * and multilingual text on this tokenizer runs ~3.2-3.5; 3 keeps the estimate
 * on the safe side of a boundary whose failure mode is silent truncation.
 */
export const WINDOW_CHARS_PER_TOKEN = 3;

/**
 * Share of the remaining context the verbatim window may take, by what else
 * remembers the conversation.
 *
 * With compaction OFF nothing else does: whatever falls out of the window is
 * forgotten, so the window takes the larger share. With a digest (`ciswire`)
 * the older turns are not lost, they are *represented differently* — so
 * a shorter verbatim window is a change of representation, not amnesia, and
 * the digest needs prompt room of its own.
 */
export const WINDOW_SHARE_NO_DIGEST = 0.75;
export const WINDOW_SHARE_WITH_DIGEST = 0.6;

/** Secondary cap. The budget binds first; this only bounds pathological cases. */
export const WINDOW_MAX_MESSAGES = 40;
export const WINDOW_MAX_MESSAGES_IMAGES = 8;

/** Never return a window that cannot hold the turn being sent. */
export const WINDOW_MIN_MESSAGES = 2;

export type WindowProfile = {
  maxMessages: number;
  charBudget: number;
  /** Provenance, in the shape the other tuning knobs report. */
  source: string;
};

/**
 * Resolve the window from the context the engine loaded and what else is
 * remembering.
 *
 * `nCtx` must be the POST-clamp value the engine actually initialised with,
 * not the catalogue's: the whole defect this replaces came from sizing the
 * window against a context the device never got.
 *
 * Not an input yet, and the reason is worth recording: whether the model's
 * architecture can roll back recurrent state. On LFM2.5 it cannot, so any
 * divergence clears the whole cache (§7.5, §7.15) and a window that slides
 * *rarely* is worth more than one that is large; on Qwen3.5 rollback makes
 * sliding cheap. That axis needs an arch signal the JS side does not currently
 * receive, and inventing a parameter nobody can fill would be worse than
 * naming the gap here.
 */
export function resolveWindowProfile(input: {
  nCtx: number | null | undefined;
  hasImages: boolean;
  hasDigest: boolean;
}): WindowProfile {
  const { hasImages, hasDigest } = input;

  if (hasImages) {
    // Image turns keep their own tight cap: an image turn's cost is dominated
    // by image tokens, which this budget cannot see.
    //
    // ⚠️ Callers pass `hasImages` as "the turn has attachments", and a
    // document-only attachment carries no image at all — so a document turn
    // takes this branch and gets the 8-message window. That mismatch predates
    // this file (the same flag already picked LEGACY_MAX_CHARS_IMAGES) and is
    // recorded in KALSA_DEPENDENCIES.md rather than quietly fixed here, where
    // changing it would alter attachment behaviour well outside the window.
    return {
      maxMessages: WINDOW_MAX_MESSAGES_IMAGES,
      charBudget: Number.POSITIVE_INFINITY,
      source: "images",
    };
  }

  const nCtx =
    typeof input.nCtx === "number" && Number.isFinite(input.nCtx) && input.nCtx > 0
      ? Math.floor(input.nCtx)
      : 0;

  if (nCtx === 0) {
    // No engine yet (lazy init): fall back to the count-only legacy behaviour
    // rather than guessing a budget from a context that does not exist.
    return {
      maxMessages: WINDOW_MAX_MESSAGES / 2,
      charBudget: Number.POSITIVE_INFINITY,
      source: "no-engine",
    };
  }

  // `hasDigest` is "retrieval is on", not "a digest will be in this prompt":
  // retrieval runs after this call, and an empty corpus yields no digest. So on
  // a retrieval turn that produces nothing we reserve room for an absent block.
  // Deliberate, and deliberately in this direction — the error costs window,
  // never overflow, and the opposite ordering would need the window sized after
  // retrieval, which is what the caller uses it to bound.
  const share = hasDigest ? WINDOW_SHARE_WITH_DIGEST : WINDOW_SHARE_NO_DIGEST;
  const budgetTokens = Math.max(0, nCtx - WINDOW_RESERVE_TOKENS) * share;
  const charBudget = Math.floor(budgetTokens * WINDOW_CHARS_PER_TOKEN);

  return {
    maxMessages: WINDOW_MAX_MESSAGES,
    charBudget,
    source: `nctx:${nCtx}/${hasDigest ? "digest" : "bare"}`,
  };
}

/**
 * One message's charge against the budget.
 *
 * Non-finite lengths are charged 0 rather than propagated: a single NaN would
 * make `used` NaN, every later `>` comparison false, and the budget would stop
 * being enforced for the whole walk — a silent, total loss of the bound rather
 * than one bad row.
 */
function messageCost(length: number | undefined, maxCharsPerMessage: number): number {
  const len = typeof length === "number" && Number.isFinite(length) ? length : 0;
  const cap = Number.isFinite(maxCharsPerMessage) ? maxCharsPerMessage : Infinity;
  return Math.min(Math.max(0, len), cap);
}

/**
 * Charged chars for an anchored window, including the current user turn when
 * supplied. The start is an explicit persisted anchor; it is never inferred
 * from the history tail.
 */
export function anchoredWindowChars(
  lengths: readonly number[],
  boundaryIndex: number,
  maxCharsPerMessage: number,
  currentTurnLength = 0,
): number {
  const n = lengths.length;
  const start =
    typeof boundaryIndex === "number" && Number.isFinite(boundaryIndex)
      ? Math.max(0, Math.min(Math.floor(boundaryIndex), n))
      : 0;
  let used = messageCost(currentTurnLength, maxCharsPerMessage);
  for (let i = start; i < n; i++) {
    used += messageCost(lengths[i], maxCharsPerMessage);
  }
  return used;
}

/**
 * Whether an anchored window is over its character budget.
 *
 * A current turn that is itself larger than the budget cannot be removed from
 * the prompt before it becomes part of history. It is therefore not a reason
 * to rebuild again when the anchored history is already empty; the next
 * rebuild can advance past that message once it is stored.
 */
export function anchoredWindowExceedsBudget(
  lengths: readonly number[],
  boundaryIndex: number,
  profile: WindowProfile,
  maxCharsPerMessage: number,
  currentTurnLength = 0,
): boolean {
  if (!Number.isFinite(profile.charBudget)) return false;
  const historyChars = anchoredWindowChars(
    lengths,
    boundaryIndex,
    maxCharsPerMessage,
  );
  const currentChars = messageCost(currentTurnLength, maxCharsPerMessage);
  if (historyChars === 0 && currentChars > profile.charBudget) return false;
  return historyChars + currentChars > profile.charBudget;
}

/**
 * Walk back from the newest message until either cap binds, and return the
 * slice start.
 *
 * Counts each message at the same per-message cap assembly will apply, so the
 * budget describes the string that actually reaches the prompt rather than the
 * one in storage. Always keeps WINDOW_MIN_MESSAGES: a window that cannot hold
 * the turn being sent is not a smaller window, it is a broken prompt.
 */
export function windowStartIndex(
  lengths: readonly number[],
  profile: WindowProfile,
  maxCharsPerMessage: number,
): number {
  const n = lengths.length;
  if (n === 0) return 0;

  const floorStart = Math.max(0, n - WINDOW_MIN_MESSAGES);
  const capStart = Math.max(
    0,
    n - (Number.isFinite(profile.maxMessages) ? profile.maxMessages : n),
  );

  let used = 0;
  let start = n;
  for (let i = n - 1; i >= capStart; i--) {
    // `taken` counts this message as included, so the first
    // WINDOW_MIN_MESSAGES are unconditional and the budget only governs the
    // ones after them.
    const taken = n - i;
    const cost = messageCost(lengths[i], maxCharsPerMessage);
    if (taken > WINDOW_MIN_MESSAGES && used + cost > profile.charBudget) break;
    used += cost;
    start = i;
  }
  // The floor guarantees a minimum, but a minimum must never override an
  // explicit maximum: with maxMessages below WINDOW_MIN_MESSAGES this used to
  // hand back MORE messages than the cap allowed. capStart wins when the two
  // disagree.
  return Math.min(start, Math.max(floorStart, capStart));
}
