/**
 * Assemble-window vs live chat KV: one invariant.
 *
 * Sliding the anchored boundary changes the first prompt message while
 * llama.rn still holds the full transcript → n_common ≈ system (~1833).
 * Char-budget pressure must not slide while that KV is live. A real slide
 * (context_full) deletes the .kvs first, then clearCache, then flags.
 * Ciswire assembly uses legacyWindowStart — never discard chat KV for it.
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
 * Production policy AppShell calls. Ciswire may rebuild its digest boundary
 * but never discards chat KV. Anchored discards only when sliding a live
 * chat KV (not a cold budget slide that would wipe a kept .kvs).
 */
export function decideAssembleWindowAction(args: {
  budgetRebuild: boolean;
  forceRebuild: boolean;
  kvHoldsChatSession: boolean;
  anchored: boolean;
}): { slide: boolean; discard: boolean } {
  if (!args.anchored) {
    return {
      slide: args.budgetRebuild || args.forceRebuild,
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
