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
 * Forced chat acquire after an embed-release timeout (FIX 2 / round 6).
 *
 * UI-GATE ONLY: transitions JS state to `chat_loading` with a NEW generation
 * so the UI proceeds. Native serialization is `runNativeOp` — the caller must
 * also `markEmbedderHung()` + `abandonNativeOpChain()` when the shared mutex
 * is still held after EMBEDDER_RELEASE_TIMEOUT_MS, then wrap `initEngine` in
 * `runNativeOp` so chat init cannot overlap a live embed native op.
 *
 * Embed re-init is refused while `chat_loading` (`tryAcquireEmbed` returns
 * false). `embedHeld` is left as-is so a late `releaseEmbed` only clears the
 * flag (it does not flip state out of `chat_loading`).
 *
 * Returns the new generation, or null when the gate is already owned by
 * chat (`chat_loading` / `chat_ready` — double-load backstop).
 */
export function forceChatAcquireAfterEmbedTimeout(): number | null {
  if (state === "chat_loading" || state === "chat_ready") {
    return null;
  }
  // Force from embed_active (or idle if a partial release already flipped
  // state without clearing the caller's timeout path).
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
  totalMemoryBytes = 0;
  chatModelIs2B = false;
  currentChatGeneration = 0;
  __resetNativeOpMutexForTests();
}

// ── Shared native-op barrier (llama.rn lifecycle) ────────────────────────────
//
// Concurrent context init/release is not guaranteed safe by llama.rn/llama.cpp.
// ALL native llama.rn work in the app (embed init/embedding/release AND chat
// initEngine) serializes through this single async FIFO mutex.
//
// Invariant: never two overlapping llama.rn ops. A hung op is abandoned,
// isolated, and never reused; recovery = process restart (native contexts are
// only destroyed by release(); a hung release leaves a leaked native context).
//
// forceChatAcquireAfterEmbedTimeout is UI-gate only (chat_loading); native
// serialization is this mutex. On EMBEDDER_RELEASE_TIMEOUT_MS while the mutex
// is still held, the embedder is marked hung, the chain is abandoned/reset,
// and chat init proceeds on the fresh chain.

let nativeOpChain: Promise<unknown> = Promise.resolve();
let nativeOpBusyFlag = false;
/** Bumped on abandon/reset so queued ops on a discarded chain never run. */
let nativeOpGeneration = 0;

/**
 * Async FIFO mutex serializing ALL llama.rn native operations (embed +
 * chat init/release). Concurrent context init is not guaranteed safe by
 * llama.rn/llama.cpp, so every native call in the app goes through this.
 *
 * A failed `fn` does not break the queue (chain never rejects); the error is
 * rethrown only to the caller of this invocation.
 */
export function runNativeOp<T>(fn: () => Promise<T>): Promise<T> {
  const gen = nativeOpGeneration;
  const run = nativeOpChain.then(
    () => executeNativeOp(gen, fn),
    () => executeNativeOp(gen, fn),
  );
  // Keep the chain alive regardless of success/failure.
  nativeOpChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function executeNativeOp<T>(
  gen: number,
  fn: () => Promise<T>,
): Promise<T> {
  if (gen !== nativeOpGeneration) {
    throw new Error("native_op_abandoned");
  }
  nativeOpBusyFlag = true;
  try {
    return await fn();
  } finally {
    // Only clear busy if this generation still owns the chain. An abandon
    // mid-flight already reset busy on a new generation.
    if (gen === nativeOpGeneration) {
      nativeOpBusyFlag = false;
    }
  }
}

/** True while a runNativeOp critical section is executing. */
export function nativeOpBusy(): boolean {
  return nativeOpBusyFlag;
}

/**
 * Abandon any in-flight/queued native ops and reset the mutex chain so the
 * next runNativeOp can start immediately. Used when an embed op is declared
 * hung after EMBEDDER_RELEASE_TIMEOUT_MS — the hung native context is leaked
 * (JS reference already dropped by EmbeddingService.markEmbedderHung); it is
 * never reused. Recovery = process restart.
 */
export function abandonNativeOpChain(): void {
  nativeOpGeneration += 1;
  nativeOpBusyFlag = false;
  nativeOpChain = Promise.resolve();
}

/** Test-only: reset the native-op mutex. */
export function __resetNativeOpMutexForTests(): void {
  abandonNativeOpChain();
}
