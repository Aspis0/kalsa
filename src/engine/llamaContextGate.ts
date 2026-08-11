/**
 * Shared llama-context lifecycle gate (module-level, no React).
 *
 * Chat loading/ready and the embedder share one native-process budget on
 * low-RAM devices. This gate serializes the two owners:
 *
 *   idle ──tryAcquireChat──► chat_loading ──markChatReady──► chat_ready
 *     ▲                           │                              │
 *     └──── markChatReleased ─────┴──────────────────────────────┘
 *     │
 *     └──tryAcquireEmbed──► embed_active ──releaseEmbed──► idle
 *
 * Ownership tokens (chatGeneration):
 *   tryAcquireChat returns a monotonically increasing generation on success.
 *   markChatReady(gen) / markChatReleased(gen) are no-ops unless gen matches
 *   the current generation — a stale load's release cannot idle the gate while
 *   a newer load owns it.
 *
 * Co-residency policy (docs/HYBRID_RETRIEVAL.md §5):
 *   - On totalMemoryBytes > 6e9 AND a 2B-class chat model, tryAcquireEmbed
 *     is allowed while state is chat_ready (embed may co-reside with chat).
 *   - During chat_loading, embed is ALWAYS refused (closes the window between
 *     releaseEmbedder and isEngineReady()).
 *   - tryAcquireChat while embed_active succeeds only when co-residency is
 *     allowed (chat takes loading priority; native embed context may remain);
 *     otherwise null — caller must releaseEmbedder first.
 *   - tryAcquireChat while already chat_loading / chat_ready returns null
 *     (double-load backstop; caller must not re-enter).
 *
 * AppShell owns chat transitions; EmbeddingService owns embed transitions.
 * Leaf module: no imports from LlamaService / EmbeddingService (no cycles).
 */

export type LlamaContextState =
  | "idle"
  | "chat_loading"
  | "chat_ready"
  | "embed_active";

/** 6 GB threshold (bytes). Co-residency only above this. */
export const CO_RESIDENCY_MIN_MEMORY_BYTES = 6e9;

let state: LlamaContextState = "idle";
/** True while EmbeddingService holds (or is acquiring) a native embed context. */
let embedHeld = false;
/**
 * True while a chat engine job (stream / extract / translate / save) is running.
 * Embed INIT must refuse while this is set so co-residency cannot race a live
 * completion (FIX 2 dual-mutex). EmbeddingService.tryAcquireEmbed checks it.
 * Does NOT block runNativeOp itself — tool-time embed work still queues on the
 * native barrier after the chat job releases this flag.
 */
let chatCompleting = false;
let totalMemoryBytes = 0;
let chatModelIs2B = false;
/**
 * Monotonic ownership token for the chat slot. Incremented on every successful
 * tryAcquireChat. Stale markChatReady / markChatReleased calls with a older
 * gen are ignored so a cancelled load cannot corrupt a newer load.
 */
let currentChatGeneration = 0;

/**
 * Update co-residency inputs. AppShell calls this when the device profile
 * and/or the chat model being loaded are known.
 */
export function setCoResidencyContext(opts: {
  totalMemoryBytes?: number;
  chatModelIs2B?: boolean;
}): void {
  if (opts && typeof opts.totalMemoryBytes === "number" && Number.isFinite(opts.totalMemoryBytes)) {
    totalMemoryBytes = opts.totalMemoryBytes;
  }
  if (opts && typeof opts.chatModelIs2B === "boolean") {
    chatModelIs2B = opts.chatModelIs2B;
  }
}

/** §5: co-reside only on >6 GB with a 2B-class chat model. */
export function allowsCoResidency(): boolean {
  return totalMemoryBytes > CO_RESIDENCY_MIN_MEMORY_BYTES && chatModelIs2B === true;
}

/**
 * True when the model id looks 2B-class (qwen3.5-2b, gemma-4-e2b, …).
 * 4B ids win if both tokens appear.
 */
export function isChatModel2BClass(modelId: string | null | undefined): boolean {
  if (typeof modelId !== "string" || modelId.length === 0) return false;
  const id = modelId.toLowerCase();
  if (id.includes("4b")) return false;
  return id.includes("2b");
}

/** True when the model id looks 4B-class (qwen3.5-4b, qwen3.5-4b-q3, …). */
export function isChatModel4BClass(modelId: string | null | undefined): boolean {
  if (typeof modelId !== "string" || modelId.length === 0) return false;
  return modelId.toLowerCase().includes("4b");
}

/**
 * Acquire the chat-loading slot. Synchronous.
 * Returns a monotonic chatGeneration token on success, or null when refused.
 *
 * Allowed only from:
 *   - idle → chat_loading
 *   - embed_active + co-residency → chat_loading (embedHeld stays true)
 *
 * Refused (null) when:
 *   - already chat_loading or chat_ready (double-load backstop)
 *   - embed_active without co-residency (caller must releaseEmbedder first)
 */
export function tryAcquireChat(): number | null {
  if (state === "chat_loading" || state === "chat_ready") {
    return null;
  }
  if (state === "embed_active") {
    if (!allowsCoResidency()) return null;
    // Co-residency: chat takes loading priority; embedHeld stays true so
    // markChatReleased can return to embed_active if chat never becomes ready.
    state = "chat_loading";
    currentChatGeneration += 1;
    return currentChatGeneration;
  }
  // idle
  state = "chat_loading";
  currentChatGeneration += 1;
  return currentChatGeneration;
}

/**
 * After initEngine resolves successfully — chat context is resident.
 * No-op when `gen` is not the current ownership token (stale load).
 */
export function markChatReady(gen: number): void {
  if (gen !== currentChatGeneration) return;
  if (state === "chat_loading" || state === "chat_ready") {
    state = "chat_ready";
  }
}

/**
 * After dispose, or after initEngine failure / cancelled load.
 * Returns to embed_active when an embed context is still held under
 * co-residency; otherwise idle.
 * No-op when `gen` is not the current ownership token (stale load cannot
 * idle a newer owner's gate).
 */
export function markChatReleased(gen: number): void {
  if (gen !== currentChatGeneration) return;
  if (state === "chat_loading" || state === "chat_ready") {
    state = embedHeld ? "embed_active" : "idle";
  }
}

/**
 * Acquire the embedder slot. Synchronous.
 * - false while chat_loading
 * - false while chat_ready UNLESS co-residency is allowed (§5)
 * - true from idle → sets embed_active
 * - true when already embed_active (re-entrant under EmbeddingService mutex)
 * - true under chat_ready + co-residency (state stays chat_ready; embedHeld=true)
 */
export function tryAcquireEmbed(): boolean {
  // FIX 2: refuse embed INIT while a chat completion/job holds the engine.
  // Prevents co-resident initLlama racing a live completion (UAF risk).
  if (chatCompleting) return false;
  if (state === "chat_loading") return false;
  if (state === "chat_ready") {
    if (!allowsCoResidency()) return false;
    embedHeld = true;
    return true;
  }
  if (state === "embed_active") {
    embedHeld = true;
    return true;
  }
  // idle
  state = "embed_active";
  embedHeld = true;
  return true;
}

/**
 * Release the embedder slot. Safe when not held.
 * Under chat_ready co-residency, only clears embedHeld (state stays chat_ready).
 */
export function releaseEmbed(): void {
  embedHeld = false;
  if (state === "embed_active") {
    state = "idle";
  }
}

/**
 * Mark a chat engine job as in-flight (stream / extract / translate / save).
 * Called by LlamaService.withEngineJob. Embed init refuses while set.
 */
export function markChatCompleting(): void {
  chatCompleting = true;
}

/** Clear the chat-completing flag after the engine job settles. */
export function markChatCompletingDone(): void {
  chatCompleting = false;
}

/** Diagnostics / tests: true while a chat engine job holds the barrier. */
export function isChatCompleting(): boolean {
  return chatCompleting;
}

export function getState(): LlamaContextState {
  return state;
}

/** Current chat ownership generation (0 = never acquired). Test / diagnostics. */
export function getChatGeneration(): number {
  return currentChatGeneration;
}

/** True when EmbeddingService has claimed the embed slot (incl. co-residency). */
export function isEmbedHeld(): boolean {
  return embedHeld;
}

/** Test-only: reset to idle. */
export function __resetForTests(): void {
  state = "idle";
  embedHeld = false;
  chatCompleting = false;
  totalMemoryBytes = 0;
  chatModelIs2B = false;
  currentChatGeneration = 0;
  __resetNativeOpMutexForTests();
}

// ── Shared native-op barrier (llama.rn lifecycle) ────────────────────────────
//
// Concurrent context init/release is not guaranteed safe by llama.rn/llama.cpp.
// ALL native llama.rn work in the app (embed init/embedding/release AND chat
// initEngine / disposeEngine) serializes through this single async FIFO mutex.
//
// Invariant (round 7 BLOCK policy): never two overlapping llama.rn ops.
// A hung op HOLDS the chain — busy stays true and new ops queue behind it
// (no chain-clear / no proceed-after-abandon). Chat init on embed-hang is
// REFUSED with an explicit busy UI state; recovery = process restart.
// Native contexts are only destroyed by release(); a hung release leaves a
// leaked native context that is isolated and never reused.

let nativeOpChain: Promise<unknown> = Promise.resolve();
let nativeOpBusyFlag = false;
/**
 * Ops enqueued via runNativeOp that have not yet settled (executing or
 * waiting behind the head). Synchronous head/tail depth of the FIFO.
 * Zero ⇔ chain empty (safe to submit without queuing behind a foreign op).
 */
let nativeOpPendingCount = 0;
/** Bumped only by test reset so discarded test chains never run. */
let nativeOpGeneration = 0;

/**
 * Async FIFO mutex serializing ALL llama.rn native operations (embed +
 * chat init/release/dispose). Concurrent context init is not guaranteed safe
 * by llama.rn/llama.cpp, so every native call in the app goes through this.
 *
 * A failed `fn` does not break the queue (chain never rejects); the error is
 * rethrown only to the caller of this invocation.
 *
 * A hung op holds the chain forever (busy stays true, pending stays >0).
 * Callers must not clear the chain to "make progress" — that would allow
 * overlapping native work.
 */
export function runNativeOp<T>(fn: () => Promise<T>): Promise<T> {
  const gen = nativeOpGeneration;
  // Increment pending SYNCHRONOUSLY so isNativeOpChainEmpty() observes the
  // enqueue in the same turn (atomic check-and-submit with runNativeOpBounded).
  nativeOpPendingCount += 1;
  const run = nativeOpChain.then(
    () => executeNativeOp(gen, fn),
    () => executeNativeOp(gen, fn),
  );
  // Keep the chain alive regardless of success/failure.
  nativeOpChain = run.then(
    () => undefined,
    () => undefined,
  );
  void run.then(
    () => {
      if (gen === nativeOpGeneration) {
        nativeOpPendingCount = Math.max(0, nativeOpPendingCount - 1);
      }
    },
    () => {
      if (gen === nativeOpGeneration) {
        nativeOpPendingCount = Math.max(0, nativeOpPendingCount - 1);
      }
    },
  );
  return run;
}

async function executeNativeOp<T>(
  gen: number,
  fn: () => Promise<T>,
): Promise<T> {
  if (gen !== nativeOpGeneration) {
    // Only reachable after test reset discards a prior chain.
    throw new Error("native_op_abandoned");
  }
  nativeOpBusyFlag = true;
  try {
    return await fn();
  } finally {
    // Only clear busy if this generation still owns the chain (test reset
    // may have advanced generation mid-flight).
    if (gen === nativeOpGeneration) {
      nativeOpBusyFlag = false;
    }
  }
}

/** True while a runNativeOp critical section is executing (or hung). */
export function nativeOpBusy(): boolean {
  return nativeOpBusyFlag;
}

/**
 * Synchronous head/tail emptiness of the native-op FIFO.
 * True iff no op is executing or queued (pending count === 0).
 * Safe to call from a check-and-submit block: under the JS event loop no
 * other async work can interleave between this read and a subsequent
 * runNativeOp() in the same synchronous turn.
 */
export function isNativeOpChainEmpty(): boolean {
  return nativeOpPendingCount === 0;
}

export type NativeOpBoundedResult<T> =
  | { ok: true; value: T }
  | { ok: false; refused: "timeout" };

/**
 * Atomic check-and-submit for a native op with a hard wait deadline
 * (round 9 FIX: closes the observe-then-submit race of acquireNativeOpBounded).
 *
 * Invariant: the emptiness check and the enqueue run in ONE synchronous block
 * under the JS event loop — no other async op can interleave between them.
 * Loop:
 *   (a) if isNativeOpChainEmpty() at THIS instant → runNativeOp(fn) and await
 *       it (we become the head; if anything hangs now it is OUR op).
 *       Emptiness is accepted even past the deadline (no foreign op ahead →
 *       immediate execution is correct).
 *   (b) else if Date.now() >= deadline → return { ok:false, refused:"timeout" }
 *       WITHOUT enqueueing (never queue behind a possibly-hung op; chain
 *       length is unchanged).
 *   (c) else sleep pollIntervalMs and loop.
 *
 * Strict deadline (P2): never return ok after waiting past the deadline while
 * the chain is non-empty. No timer leaks: one pending sleep per iteration,
 * cleared in finally.
 */
export async function runNativeOpBounded<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  pollIntervalMs: number = 50,
): Promise<NativeOpBoundedResult<T>> {
  const ms =
    typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0
      ? timeoutMs
      : 0;
  const poll =
    typeof pollIntervalMs === "number" &&
    Number.isFinite(pollIntervalMs) &&
    pollIntervalMs > 0
      ? pollIntervalMs
      : 50;
  const deadline = Date.now() + ms;

  while (true) {
    // (a)/(b) in one synchronous block — atomic under the JS event loop.
    if (isNativeOpChainEmpty()) {
      // Empty now (even past deadline): submit immediately; we are the head.
      const run = runNativeOp(fn);
      return { ok: true, value: await run };
    }
    if (Date.now() >= deadline) {
      // Non-empty past deadline: refuse WITHOUT enqueueing.
      return { ok: false, refused: "timeout" };
    }
    // (c) sleep then re-check atomically. One timer; cleared on settle.
    const remaining = deadline - Date.now();
    const slice = remaining < poll ? Math.max(1, remaining) : poll;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await new Promise<void>((resolve) => {
        timer = setTimeout(resolve, slice);
      });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

/**
 * Test-only: force-reset the native-op mutex. Production code MUST NOT clear
 * the chain while an op is in flight — a hung op holds the barrier so new
 * native work cannot overlap it (round 7 never-overlap invariant).
 */
export function __resetNativeOpMutexForTests(): void {
  nativeOpGeneration += 1;
  nativeOpBusyFlag = false;
  nativeOpPendingCount = 0;
  nativeOpChain = Promise.resolve();
}
