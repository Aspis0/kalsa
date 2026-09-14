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
}): boolean {
  if (args.forceRebuild) return true;
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
  });
  return { slide, discard: slide && args.kvHoldsChatSession };
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
 * loadedB is getLoadedAssembleBoundary: non-null only on hold+match
 * (unknown start → 0). Null is mismatch or not held — keep computedStart.
 * Do not treat null as 0. kvHeldForAssembleWindow (flag || nPast || last
 * save tokens) feeds that hold; it is not itself the clamp signal.
 * Anchored: caller already aligned boundaryIndex — leave computedStart.
 */
export function assembleStartForLiveKv(args: {
  mode: "off" | "anchored" | "ciswire";
  loadedB: number | null;
  computedStart: number;
}): number {
  if (args.mode === "anchored") return args.computedStart;
  if (args.loadedB !== null) return args.loadedB;
  return args.computedStart;
}
