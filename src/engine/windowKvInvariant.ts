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
 * slide (context_full or the n_ctx ceiling) deletes the .kvs first, then
 * clearCache, then flags. Ciswire discards chat KV only for the ceiling
 * slide; its char-budget slide must not.
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
 * Production policy AppShell calls. One slide gate for both regimes:
 * char-budget pressure never slides a live KV, `forceRebuild` and the
 * deliberate ceiling do. Ciswire may discard chat KV only for the ceiling
 * slide (its char-budget slide must not wipe a kept .kvs); anchored discards
 * only when sliding a live chat KV. Reuses shouldSlideAssembleBoundary so the
 * two regimes cannot drift apart.
 */
export function decideAssembleWindowAction(args: {
  budgetRebuild: boolean;
  forceRebuild: boolean;
  kvHoldsChatSession: boolean;
  anchored: boolean;
  ceilingCrossed?: boolean;
  /** A prior clear was followed by a non-completed turn; re-anchor first. */
  pendingWindowSlide?: boolean;
}): { slide: boolean; discard: boolean } {
  const slide = shouldSlideAssembleBoundary({
    budgetRebuild: args.budgetRebuild,
    forceRebuild: args.forceRebuild || args.pendingWindowSlide === true,
    kvHoldsChatSession: args.kvHoldsChatSession,
    ceilingCrossed: args.ceilingCrossed,
  });
  if (!args.anchored) {
    return {
      slide,
      discard:
        slide &&
        args.kvHoldsChatSession &&
        (args.ceilingCrossed === true || args.pendingWindowSlide === true),
    };
  }
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
  /** Clear even when the logical start did not advance: native KV is unknown. */
  reanchor?: boolean;
}): boolean {
  return (
    args.discard &&
    (args.nextBoundaryIndex > args.previousBoundaryIndex || args.reanchor === true)
  );
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
 *
 * While KV is held the start is the boundary saved with that KV. It travels
 * inside the .kvs metadata (meta.assembleBoundary, written at save and read
 * back at restore) and is validated by getLoadedAssembleBoundary (hold + same
 * conversation).
 *
 * Why trusting it while held is safe now, and what made it poison before:
 * `lastAssembleBoundary` used to be written at the top of streamAssistantTurn
 * (a promise, before the native ran); a21746e was a stale B=20 from a send
 * that never re-anchored the native KV while it still held the full chat, and
 * the held branch returned 20 against a start-0 native prefix (S23 91d7b73
 * t5 n_common=0 embd=7779 text_tokens=4524). streamAssistantTurn now clears
 * the boundary when the turn starts and commits it only through
 * assembleBoundaryAfterTurn("completed"); every abort/error/tool-ceiling/
 * context_full/early-return path leaves it undefined, so loadedB is non-null
 * only when the native really evaluated a prompt that starts there.
 *
 * A full-history held KV saves boundary 0, so a chat that never slid still
 * starts at 0. Off keeps the c7801f9 full-history clamp (never trusts
 * loadedB). Anchored leaves computedStart.
 */
export function assembleStartForLiveKv(args: {
  mode: "off" | "anchored" | "ciswire";
  loadedB: number | null;
  computedStart: number;
  kvHeld: boolean;
}): number {
  if (args.mode === "anchored") return args.computedStart;
  if (args.kvHeld) {
    if (args.mode === "ciswire") return args.loadedB ?? 0;
    return 0;
  }
  if (args.loadedB !== null) return args.loadedB;
  return args.computedStart;
}

/**
 * How a streamed turn ended, for the assemble-boundary identity.
 *
 * `lastAssembleBoundary` must describe the prompt the native actually
 * evaluated. It is a fact only after a completion adopted the prompt and the
 * turn did not abort. Every other outcome leaves the native KV unknown, so
 * the boundary is dropped (`undefined`). Without a separate successful-clear
 * marker, the next held send falls back to start 0 — a safe full re-prefill,
 * never a stale prefix match.
 */
export type AssembleBoundaryOutcome =
  | "completed"
  | "aborted"
  | "tool_ceiling"
  | "context_full"
  | "early_return"
  | "invalidated";

/**
 * Terminal outcomes: the turn did not leave a boundary the native provably
 * adopted. Once one is set it must never be overwritten by a later
 * `"completed"` — an abort during post-round telemetry (`emitGovernorTelemetry`
 * after the loop) would otherwise be laundered into a commit.
 */
function isTerminalAssembleOutcome(outcome: AssembleBoundaryOutcome): boolean {
  return (
    outcome === "aborted" ||
    outcome === "context_full" ||
    outcome === "tool_ceiling"
  );
}

/**
 * Monotonic outcome update. `"completed"` only promotes a non-terminal state;
 * a terminal outcome always wins over a later `"completed"`. Non-terminal
 * outcomes still overwrite each other (the last neutral default is fine).
 */
export function markAssembleOutcome(
  current: AssembleBoundaryOutcome,
  next: AssembleBoundaryOutcome,
): AssembleBoundaryOutcome {
  return isTerminalAssembleOutcome(current) ? current : next;
}

/**
 * Whether the post-tool-round closure left a prompt the native adopted.
 *
 * Tool rounds streamed visible text → yes. They exhausted with no text → the
 * text-only fallback decides: yes only if it actually produced text; a failed
 * or empty fallback (or the canned message) is not an adopted prompt. The
 * ceiling break means the next round never ran and the native is not known to
 * start at `pending`.
 */
export function toolRoundsAdoptedPrompt(args: {
  ceilingReached: boolean;
  fallbackNeeded: boolean;
  fallbackOk: boolean;
}): boolean {
  if (args.ceilingReached) return false;
  if (!args.fallbackNeeded) return true;
  return args.fallbackOk;
}

/**
 * The assemble boundary to persist after a turn: the pending value only on a
 * clean completion. `aborted` / `tool_ceiling` / `context_full` /
 * `early_return` / `invalidated` all mean the native KV no longer provably
 * starts at `pending`, so the boundary must be dropped.
 */
export function assembleBoundaryAfterTurn(args: {
  outcome: AssembleBoundaryOutcome;
  pending: number | undefined;
}): number | undefined {
  return args.outcome === "completed" ? args.pending : undefined;
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
