/**
 * Assemble-window vs live chat KV: one invariant.
 *
 * Sliding the anchored boundary changes the first prompt message while
 * llama.rn still holds the full transcript → n_common ≈ system (~1833).
 * Ciswire uses a tighter digest-share window, so it hits the same family
 * earlier: live KV ~7840 vs JS prompt ~4205, n_common=0, heads disjoint
 * (S23 96d3d06 T20C t10 / T20B t13; f441b3d T20C t10 embd=7189
 * text_tokens=4173). Char-budget pressure must not drop the prefix the KV
 * still has. Hold flag / nPast can be false while native still has tokens —
 * last save usedTokens counts as live, bound to engine + conversation, and
 * cleared on known-empty native paths (not on a flag-only drop). A real
 * slide (context_full) deletes the .kvs first, then clearCache, then flags.
 * Ciswire never discards chat KV.
 */

export function shouldSlideAssembleBoundary(args: {
  budgetRebuild: boolean;
  forceRebuild: boolean;
  kvHoldsChatSession: boolean;
  /**
   * The send about to be assembled would cross `n_ctx - WINDOW_RESERVE_TOKENS`
   * (windowProfile.shouldSlideWindowAtCeiling) while the live KV still pins
   * the assemble start. On LFM2 (hybrid attn+recurrent) the recurrent half
   * cannot evict a prefix — `seq_rm` is rm_all or a tail rollback bounded by
   * `n_rs_seq`, which is 0 with no draft model — so ctx_shift at the ceiling
   * is irreparable. The only correct move is to clear the live KV and advance
   * the start on purpose. This is why it slides even with KV held.
   */
  ceilingCrossed?: boolean;
}): boolean {
  if (args.forceRebuild) return true;
  if (args.ceilingCrossed) return true;
  if (args.budgetRebuild && !args.kvHoldsChatSession) return true;
  return false;
}

/** Empty id → LlamaService.discardChatKvForWindowSlide returns false. */
export function windowSlideDiscardModelId(modelId: string): string | null {
  return typeof modelId === "string" && modelId.length > 0 ? modelId : null;
}

/**
 * Production policy AppShell calls. Ciswire never discards chat KV, and
 * must not advance its digest/assemble start while that KV is live (same
 * prefix-drop as a char-budget window slide). Anchored discards only when
 * sliding a live chat KV (not a cold budget slide that would wipe a kept
 * .kvs).
 */
export function decideAssembleWindowAction(args: {
  budgetRebuild: boolean;
  forceRebuild: boolean;
  kvHoldsChatSession: boolean;
  anchored: boolean;
  ceilingCrossed?: boolean;
}): { slide: boolean; discard: boolean } {
  if (!args.anchored) {
    const wantSlide = args.budgetRebuild || args.forceRebuild;
    return {
      slide: wantSlide && !args.kvHoldsChatSession,
      discard: false,
    };
  }
  const slide = shouldSlideAssembleBoundary({
    budgetRebuild: args.budgetRebuild,
    forceRebuild: args.forceRebuild,
    kvHoldsChatSession: args.kvHoldsChatSession,
    ceilingCrossed: args.ceilingCrossed,
  });
  return { slide, discard: slide && args.kvHoldsChatSession };
}

/**
 * Gate the destructive half of a window slide. Deleting the .kvs and dropping
 * the live RAM cache is only worth it if the boundary it exists to serve
 * actually moves.
 *
 * With an infinite charBudget — attachment turns (windowProfile's `images`
 * branch) and bench overrides — the anchored rebuild is a no-op. Discarding
 * then destroys the live KV and leaves the prompt at exactly the size it
 * already was, above the ceiling: strictly worse than doing nothing.
 */
export function shouldDiscardKvForSlide(args: {
  discard: boolean;
  previousBoundaryIndex: number;
  nextBoundaryIndex: number;
}): boolean {
  return args.discard && args.nextBoundaryIndex > args.previousBoundaryIndex;
}

/**
 * Whether a planned window slide may persist its advance. A requested clear
 * that failed must leave the boundary untouched: the whole point of the clear
 * is to let the assemble start move while the native KV no longer pins it, so
 * advancing without a successful clear would recreate exactly the live-KV bump
 * the clear exists to prevent. A cold slide (no clear requested) always
 * advances.
 */
export function shouldApplySlideAdvance(args: {
  clearRequested: boolean;
  clearSucceeded: boolean;
}): boolean {
  return !args.clearRequested || args.clearSucceeded;
}

function positiveTokenCount(n: number | null | undefined): boolean {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/**
 * Hold flag and lastChatNPast can both drop while native chat KV still
 * has tokens (extract restore miss, translate/completeOnce flag clear).
 * Last successful save usedTokens is the remaining hint (same engine +
 * conversation only): do not shrink the verbatim window for digest while
 * that count is still live. Native-empty paths invalidate it.
 */
export function kvHeldForAssembleWindow(args: {
  kvHoldsChatSession: boolean;
  nPast?: number | null;
  lastSaveTokens?: number | null;
}): boolean {
  if (args.kvHoldsChatSession) return true;
  if (positiveTokenCount(args.nPast)) return true;
  return positiveTokenCount(args.lastSaveTokens);
}

/** Digest-share (60%) only when retrieval is on and live chat KV is not. */
export function windowHasDigest(args: {
  retrievalOn: boolean;
  kvHeld: boolean;
}): boolean {
  return args.retrievalOn && !args.kvHeld;
}

/** Align only the live conversation's KV; mismatch / no hold → null. */
export function assembleBoundaryForAlign(args: {
  kvHeld: boolean;
  storedConv: string;
  activeConv: string;
  boundary: number | undefined;
}): number | null {
  if (!args.kvHeld) return null;
  if (args.storedConv !== args.activeConv) return null;
  return args.boundary ?? 0;
}

/**
 * Clamp assemble start to this chat's live KV.
 * While KV is held, always start=0 (full JS history vs full native KV).
 * A leftover loadedB from a cold/digest send (S23 91d7b73 t1 B=20 then
 * t2–5 clamp to 20, t5 n_common=0 vs 7779) is poison.
 * Mismatch / not held: keep computedStart. Anchored: leave computedStart.
 */
export function assembleStartForLiveKv(args: {
  mode: "off" | "anchored" | "ciswire";
  loadedB: number | null;
  computedStart: number;
  kvHeld: boolean;
}): number {
  if (args.mode === "anchored") return args.computedStart;
  if (args.kvHeld) return 0;
  if (args.loadedB !== null) return args.loadedB;
  return args.computedStart;
}

/**
 * Query-time digest/summary ride the last user. While live KV still holds
 * the verbatim chat (start=0, hasDigest=false), injecting a new block is a
 * prefix rewrite on the next rematch. Skip until the window is allowed to
 * slide (KV no longer held).
 */
export function operativeContextForLiveKv(args: {
  kvHeld: boolean;
  digest?: string;
  summary?: string;
}): { digest?: string; summary?: string } | null {
  if (args.kvHeld) return null;
  const digest = typeof args.digest === "string" && args.digest.trim() ? args.digest : undefined;
  const summary =
    typeof args.summary === "string" && args.summary.trim() ? args.summary : undefined;
  if (!digest && !summary) return null;
  return { digest, summary };
}
