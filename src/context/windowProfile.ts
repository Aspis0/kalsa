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
 * 82 MB, so on the S23 the wider window was inert.
 *
 * NOT "on every 8 GB phone" — and that difference is the whole point. The
 * gate is TOTAL RAM (`CTX_UPGRADE_MIN_TOTAL_BYTES` in contextProfile.ts,
 * 7.5 GB, compared with `>=`) and the Jelly Star reports MORE of it than the
 * S23. Both figures are recorded in `results/moe-stream-2026-08-22/README.md`:
 * S23 MemTotal 7,243,748 kB = 7,417,597,952 B, which is 82.4 MB (78.6 MiB)
 * BELOW the gate; Jelly 7,968,548 kB = 8,159,793,152 B, above it. expo-device
 * reports exactly that quantity (`totalMem`). So on a hybrid whose catalog ctx
 * is 8192 the Jelly resolves to 16384 and the S23 stays at 8192 — the device
 * that clears the gate is the SLOWER of the two (same file, decode on one
 * binary: Jelly 2.962 tok/s against S23 5.792), and it is the one left
 * carrying the wider window and paying to prefill it. Confirmed on both
 * handsets 2026-09-17 with `kalsa.bench.nctx` absent; the run artifacts live
 * with the lab plan, so this comment rests on the committed pair above.
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
 * Reserve the CHAR BUDGET may subtract from a loaded context, relative to it.
 *
 * `WINDOW_RESERVE_TOKENS` equals the app's context floor (CTX_FLOOR in
 * engine/deviceTuning), so at the smallest context the app can load the
 * subtraction cancels the whole context: `(2048 - 2048) * share = 0` and the
 * anchored history is empty on the one device the floor exists for. Halving
 * the reserve there leaves half the context for the window.
 *
 * Only the char budget uses this. The ceiling slide
 * (`windowCeilingTokens`) keeps the constant: overrunning n_ctx is the failure
 * its reserve protects against, and that does not get cheaper on a small
 * phone. From 4096 up the min selects the constant, so every window a shipped
 * 4k/6k/8k context resolves is unchanged.
 */
export function charBudgetReserveTokens(nCtx: number | null | undefined): number {
  if (typeof nCtx !== "number" || !Number.isFinite(nCtx) || nCtx <= 0) {
    return WINDOW_RESERVE_TOKENS;
  }
  return Math.min(WINDOW_RESERVE_TOKENS, Math.floor(nCtx * 0.5));
}

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

/**
 * Tokens the verbatim window may spend before a deliberate slide is forced:
 * `n_ctx - WINDOW_RESERVE_TOKENS` (6144 at the loaded 8192). The reserve
 * already covers system prompt, digest and generation room, so this is where
 * the window — not the whole prompt — has to stop.
 *
 * `reservedPromptTokens` prices prompt tokens the caller's `windowChars` does
 * NOT already carry — on the S23 the system prompt alone measured 1832 tokens
 * per cold prefill, invisible to a guard that only projects the window. Pass
 * the caller's real non-window tokens; a caller whose char count already
 * covers the whole message list (the tool loop) passes nothing. The result is
 * clamped at 0, never negative: when the reserve eats the ceiling the window
 * falls back to the explicit minimum (WINDOW_MIN_MESSAGES in windowStartIndex),
 * not to an underflowed budget.
 */
export function windowCeilingTokens(
  nCtx: number | null | undefined,
  reservedPromptTokens = 0,
): number {
  if (typeof nCtx !== "number" || !Number.isFinite(nCtx) || nCtx <= 0) return 0;
  const reserved =
    typeof reservedPromptTokens === "number" &&
    Number.isFinite(reservedPromptTokens) &&
    reservedPromptTokens > 0
      ? Math.floor(reservedPromptTokens)
      : 0;
  return Math.max(0, Math.floor(nCtx) - WINDOW_RESERVE_TOKENS - reserved);
}

/** Charged chars → tokens, the same ceil ratio the KALSA_WINDOW `textEst` uses. */
export function projectedWindowTokens(windowChars: number): number {
  if (
    typeof windowChars !== "number" ||
    !Number.isFinite(windowChars) ||
    windowChars <= 0
  ) {
    return 0;
  }
  return Math.ceil(windowChars / WINDOW_CHARS_PER_TOKEN);
}

/**
 * Whether the send about to be assembled would cross the ceiling while the
 * live KV still pins the assemble start.
 *
 * `kvHeld` is the whole point: while the KV holds the chat the start cannot
 * move (see windowKvInvariant), so the window grows every turn. Crossing the
 * ceiling there is unrecoverable on a hybrid (attn+recurrent) model — the
 * recurrent half cannot evict a prefix — and must be handled deliberately in
 * JS instead. Not held → the normal budget slide already applies, so this
 * predicate stays out of the way.
 */
export function shouldSlideWindowAtCeiling(args: {
  nCtx: number | null | undefined;
  windowChars: number;
  kvHeld: boolean;
  /** Non-window prompt tokens (the system prompt) the ceiling must also pay. */
  reservedPromptTokens?: number;
}): boolean {
  if (!args.kvHeld) return false;
  // Inert ONLY without an engine: no nCtx, nothing to protect. A VALID n_ctx
  // whose ceiling is fully consumed by reserve + prefix means every prompt
  // crosses — slide (the legacy walker clamps to WINDOW_MIN_MESSAGES; the
  // anchored path can drop to an empty window) instead of standing down at
  // exactly the worst case.
  if (
    typeof args.nCtx !== "number" ||
    !Number.isFinite(args.nCtx) ||
    args.nCtx <= 0
  ) {
    return false;
  }
  const ceiling = windowCeilingTokens(args.nCtx, args.reservedPromptTokens);
  return projectedWindowTokens(args.windowChars) > ceiling;
}

/**
 * Whether a fully assembled prompt — system + history + tool results — would
 * cross the same `n_ctx` ceiling AppShell slides on.
 *
 * The tool loop appends a tool call and its results and calls completion()
 * again without re-running the send guard, so `promptChars` must cover the
 * ENTIRE message list (system included). The reserve then only pays for
 * generation room, which is conservative and errs toward stopping early.
 * Because the system rides inside `promptChars` here, `reservedPromptTokens`
 * stays 0 — the AppShell window guard, whose chars exclude the system, is the
 * caller that passes it.
 */
export function promptTokensExceedNCtx(args: {
  nCtx: number | null | undefined;
  promptChars: number;
  reservedPromptTokens?: number;
}): boolean {
  // Same semantics as shouldSlideWindowAtCeiling: inert only without an
  // engine; a valid n_ctx with a fully-consumed ceiling means every prompt
  // exceeds, so the tool loop stops instead of running through it.
  if (
    typeof args.nCtx !== "number" ||
    !Number.isFinite(args.nCtx) ||
    args.nCtx <= 0
  ) {
    return false;
  }
  const ceiling = windowCeilingTokens(args.nCtx, args.reservedPromptTokens);
  return projectedWindowTokens(args.promptChars) > ceiling;
}

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
  const budgetTokens =
    Math.max(0, nCtx - charBudgetReserveTokens(nCtx)) * share;
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
