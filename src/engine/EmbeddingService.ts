/**
 * On-device embedding service (llama.rn second context, embedding:true).
 *
 * Lifecycle (design §5 / HYBRID_RETRIEVAL.md):
 * - Lazy load: no embedder at app start; first embed* call initLlama's
 *   once the EMBEDDING_MODEL bundle is on disk.
 * - Shared native-op barrier (runNativeOp in llamaContextGate): serializes
 *   EVERY llama.rn native call (initLlama / embedding() / release) with chat
 *   initEngine. Concurrent context init is not guaranteed safe by llama.rn.
 * - Serialization rule (shared llamaContextGate):
 *     chat_loading / chat_ready block embed init, EXCEPT §5 co-residency:
 *     totalMemoryBytes > 6e9 AND 2B-class chat model → tryAcquireEmbed ok
 *     while chat_ready. Gate is a leaf module (no LlamaService import).
 * - AppShell must also bump embedJobGenerationRef / abort the job signal
 *   before chat load so in-flight embeds cannot race a later ensureEmbedder.
 * - Failures never throw to callers: embed* returns null → hybrid path
 *   degrades to bm25_only.
 * - Hung policy (hostile review round 6): if release times out at chat init
 *   while a native op still holds the shared mutex, markEmbedderHung() drops
 *   the JS context reference (native leak — only release() destroys it; the
 *   leaked context is isolated and never reused). Future embed* return null
 *   with isEmbedderHung() === true ("hung" reason). Recovery = process restart.
 * - Cancellation: embedText / embedDocumentChunk / embedQuery accept
 *   `opts.signal?: AbortSignal`. signal.aborted is checked immediately
 *   before EVERY await boundary and immediately before initLlama + the
 *   native embedding() call; on abort, return null (never throw).
 *
 * Pure helpers live in embeddingPure.ts (re-exported here) so the harness
 * can compile without llama.rn / RN.
 */

import { EMBEDDING_MODEL } from "./ModelRegistry";
import {
  tryAcquireEmbed,
  releaseEmbed,
  getState as getLlamaContextState,
  runNativeOp,
} from "./llamaContextGate";
import {
  applyEmbedPrefix,
  type EmbeddableChunk,
  embedChunkKey,
  hashChunkContent,
  listDocumentChunksForEmbed,
  planChunksToEmbed,
  shouldDegradeToBm25Only,
} from "./embeddingPure";

// Re-export pure surface so app callers can import from EmbeddingService alone.
export {
  applyEmbedPrefix,
  embedChunkKey,
  hashChunkContent,
  listDocumentChunksForEmbed,
  planChunksToEmbed,
  shouldDegradeToBm25Only,
};
export type { EmbeddableChunk };

// ── Status ──────────────────────────────────────────────────────────────────

export type EmbeddingModelStatus = "not_downloaded" | "downloaded";

export type EmbedAbortOpts = { signal?: AbortSignal };

function isAborted(signal?: AbortSignal): boolean {
  return !!signal && signal.aborted === true;
}

export async function getEmbeddingModelStatus(
  opts?: EmbedAbortOpts,
): Promise<EmbeddingModelStatus> {
  if (isAborted(opts?.signal)) return "not_downloaded";
  try {
    const { isModelBundleDownloaded } = await import("./ModelDownloader");
    if (isAborted(opts?.signal)) return "not_downloaded";
    const ok = await isModelBundleDownloaded(EMBEDDING_MODEL);
    if (isAborted(opts?.signal)) return "not_downloaded";
    return ok ? "downloaded" : "not_downloaded";
  } catch {
    return "not_downloaded";
  }
}

export async function embeddingModelPath(
  opts?: EmbedAbortOpts,
): Promise<string | null> {
  if (isAborted(opts?.signal)) return null;
  try {
    const { modelLocalPath } = await import("./ModelDownloader");
    if (isAborted(opts?.signal)) return null;
    return modelLocalPath(EMBEDDING_MODEL, EMBEDDING_MODEL.file);
  } catch {
    return null;
  }
}

// ── Context lifecycle (dynamic llama.rn) ────────────────────────────────────

type EmbedPhase = "idle" | "ready" | "closing";

// LlamaContext is loaded dynamically; keep a structural handle only.
type EmbedContext = {
  embedding: (
    text: string,
    params?: { embd_normalize?: number },
  ) => Promise<{ embedding: number[] }>;
  release: () => Promise<void>;
};

let context: EmbedContext | null = null;
let activePath: string | null = null;
let phase: EmbedPhase = "idle";

/**
 * When true, a prior native embed op was abandoned after the chat-init
 * release timeout. The JS context reference has been dropped; the native
 * context (if still alive) is leaked and never reused. All embed* paths
 * return null immediately. Recovery = process restart.
 *
 * Invariant (shared with runNativeOp): never two overlapping llama.rn ops;
 * a hung op is abandoned, isolated, and never reused.
 */
let embedderHung = false;

/**
 * Bounded wait for releaseEmbedder during chat init (AppShell).
 *
 * Policy (FIX 2 / hostile review round 4 + round 6 native barrier):
 *   - Chat init races releaseEmbedder() against this timeout.
 *   - On timeout: if the shared native-op mutex is still held, the embedder
 *     is marked hung (markEmbedderHung), the mutex chain is abandoned, and
 *     chat init proceeds alone. Native embedding()/release() is not
 *     cancellable; a hung release leaves a leaked native context.
 *   - Gate force handoff (forceChatAcquireAfterEmbedTimeout) is UI-only;
 *     native serialization is runNativeOp.
 */
export const EMBEDDER_RELEASE_TIMEOUT_MS = 15_000;

/** True after markEmbedderHung — embed paths return null immediately. */
export function isEmbedderHung(): boolean {
  return embedderHung === true;
}

/**
 * Declare the embedder hung after a timed-out release during chat init.
 * Drops the JS context reference (best-effort; native context is only
 * destroyed by release() — a hung release leaves a leaked native context,
 * isolated and never reused). Future embed* return null. Pair with
 * abandonNativeOpChain() so chat init can run on a fresh mutex chain.
 */
export function markEmbedderHung(): void {
  embedderHung = true;
  // Drop JS reference; do NOT call native release (it is the hung op).
  context = null;
  activePath = null;
  phase = "idle";
  releaseEmbed();
}

async function loadInitLlama(
  signal?: AbortSignal,
): Promise<
  | ((params: {
      model: string;
      embedding?: boolean;
      n_ctx?: number;
      n_gpu_layers?: number;
      n_threads?: number;
    }) => Promise<EmbedContext>)
  | null
> {
  if (isAborted(signal)) return null;
  const mod = await import("llama.rn");
  if (isAborted(signal)) return null;
  // Cast via unknown: EmbedContext is a structural subset of LlamaContext.
  return mod.initLlama as unknown as (
    params: {
      model: string;
      embedding?: boolean;
      n_ctx?: number;
      n_gpu_layers?: number;
      n_threads?: number;
    },
  ) => Promise<EmbedContext>;
}

/**
 * True when the embedder LlamaContext is currently held (phase ready).
 * Used by AppShell residency checks / telemetry.
 */
export function isEmbedderActive(): boolean {
  return context !== null && phase === "ready" && !embedderHung;
}

/**
 * Load the embedder context once for the given path.
 * Concurrent callers are serialized via the shared runNativeOp barrier.
 *
 * Residency gate (llamaContextGate): tryAcquireEmbed refuses while chat is
 * loading, and while chat is ready unless §5 co-residency applies.
 *
 * Cancellation: checks signal before every await and before initLlama; on
 * abort, leaves state idle and returns (never throws).
 */
async function ensureEmbedder(
  path: string,
  signal?: AbortSignal,
): Promise<boolean> {
  if (embedderHung) return false;
  return runNativeOp(async () => {
    if (embedderHung) return false;
    if (isAborted(signal)) return false;
    if (phase === "closing") return false;
    if (context && activePath === path && phase === "ready") {
      // Already ready — still claim the gate so releaseEmbed pairs correctly.
      if (!tryAcquireEmbed()) return false;
      return true;
    }

    // Shared lifecycle gate: refuse while chat_loading, or chat_ready without
    // co-residency. Synchronous — no race with tryAcquireChat.
    if (!tryAcquireEmbed()) return false;
    if (isAborted(signal)) {
      releaseEmbed();
      return false;
    }

    if (context) {
      try {
        // Native release — already inside runNativeOp.
        await context.release();
      } catch {
        // ignore release errors on re-init
      }
      if (isAborted(signal)) {
        context = null;
        activePath = null;
        phase = "idle";
        releaseEmbed();
        return false;
      }
      context = null;
      activePath = null;
      phase = "idle";
    }

    if (isAborted(signal)) {
      releaseEmbed();
      return false;
    }
    // Re-check gate after the await above (chat may have taken the slot).
    // If we already hold embed, tryAcquireEmbed is re-entrant; if chat took
    // chat_loading without co-res, it will fail.
    if (!tryAcquireEmbed()) {
      releaseEmbed();
      return false;
    }

    const initLlama = await loadInitLlama(signal);
    if (!initLlama || isAborted(signal)) {
      releaseEmbed();
      return false;
    }
    // Final gate + abort check immediately before initLlama.
    if (!tryAcquireEmbed()) {
      releaseEmbed();
      return false;
    }
    if (isAborted(signal)) {
      releaseEmbed();
      return false;
    }
    if (embedderHung) {
      releaseEmbed();
      return false;
    }

    try {
      // Native initLlama — already inside runNativeOp.
      const next = await initLlama({
        model: path,
        embedding: true,
        n_ctx: EMBEDDING_MODEL.n_ctx,
        n_gpu_layers: 0,
        n_threads: 2,
      });
      if (embedderHung || isAborted(signal)) {
        // Job cancelled mid-init / hung: release the just-created context so it
        // cannot outlive the abort (chat may be about to load).
        try {
          await next.release();
        } catch {
          /* ignore */
        }
        context = null;
        activePath = null;
        phase = "idle";
        releaseEmbed();
        return false;
      }
      // Chat may have become loading during initLlama — release if gate refuses.
      if (!tryAcquireEmbed()) {
        try {
          await next.release();
        } catch {
          /* ignore */
        }
        context = null;
        activePath = null;
        phase = "idle";
        releaseEmbed();
        return false;
      }
      context = next;
      activePath = path;
      phase = "ready";
      return true;
    } catch {
      context = null;
      activePath = null;
      phase = "idle";
      releaseEmbed();
      return false;
    }
  });
}

/**
 * Release the embedder context. Safe to call when idle. Never throws.
 * AppShell calls this BEFORE loading the chat model when co-residency is NOT
 * allowed (§5: ≤6 GB or 4B chat). On 8 GB+ with 2B chat, co-residency is
 * permitted and release may be skipped by AppShell.
 *
 * Chat-init callers MUST race this against EMBEDDER_RELEASE_TIMEOUT_MS so a
 * stuck native release cannot deadlock chat load. On timeout + still-busy
 * mutex, AppShell calls markEmbedderHung + abandonNativeOpChain.
 */
export async function releaseEmbedder(): Promise<void> {
  if (embedderHung) {
    // Already abandoned — JS state is idle; gate may still need clearing.
    releaseEmbed();
    return;
  }
  return runNativeOp(async () => {
    if (embedderHung) {
      releaseEmbed();
      return;
    }
    if (!context) {
      phase = "idle";
      activePath = null;
      releaseEmbed();
      return;
    }
    phase = "closing";
    try {
      // Native release — already inside runNativeOp.
      await context.release();
    } catch {
      // ignore — never throw to callers
    } finally {
      context = null;
      activePath = null;
      phase = "idle";
      releaseEmbed();
    }
  });
}

/**
 * Run `fn` while the embedder is held. Acquires the shared native-op lock for
 * the whole batch so release cannot interleave mid-batch.
 * Returns null when hung, not downloaded, chat blocks embed, aborted,
 * or fails to load.
 */
export async function withEmbedder<T>(
  fn: (
    embed: (text: string, role: "query" | "doc") => Promise<Float32Array | null>,
  ) => Promise<T>,
  opts?: EmbedAbortOpts,
): Promise<T | null> {
  const signal = opts?.signal;
  try {
    if (embedderHung) return null;
    if (isAborted(signal)) return null;
    if ((await getEmbeddingModelStatus(opts)) !== "downloaded") return null;
    if (isAborted(signal)) return null;
    const path = await embeddingModelPath(opts);
    if (!path || isAborted(signal)) return null;
    // ensure + work under a single native-op so release cannot sneak in between.
    return await runNativeOp(async () => {
      if (embedderHung) return null;
      if (isAborted(signal)) return null;
      if (phase === "closing") return null;
      if (!(context && activePath === path && phase === "ready")) {
        if (!tryAcquireEmbed()) return null;
        if (context) {
          try {
            await context.release();
          } catch {
            /* ignore */
          }
          context = null;
          activePath = null;
          phase = "idle";
        }
        if (isAborted(signal) || embedderHung) {
          releaseEmbed();
          return null;
        }
        if (!tryAcquireEmbed()) {
          releaseEmbed();
          return null;
        }
        const initLlama = await loadInitLlama(signal);
        if (!initLlama || isAborted(signal) || embedderHung) {
          releaseEmbed();
          return null;
        }
        if (!tryAcquireEmbed()) {
          releaseEmbed();
          return null;
        }
        try {
          const next = await initLlama({
            model: path,
            embedding: true,
            n_ctx: EMBEDDING_MODEL.n_ctx,
            n_gpu_layers: 0,
            n_threads: 2,
          });
          if (isAborted(signal) || embedderHung || !tryAcquireEmbed()) {
            try {
              await next.release();
            } catch {
              /* ignore */
            }
            context = null;
            activePath = null;
            phase = "idle";
            releaseEmbed();
            return null;
          }
          context = next;
          activePath = path;
          phase = "ready";
        } catch {
          context = null;
          activePath = null;
          phase = "idle";
          releaseEmbed();
          return null;
        }
      } else {
        // Already ready — claim gate for the batch.
        if (!tryAcquireEmbed()) return null;
      }
      if (!context || phase !== "ready" || embedderHung) {
        releaseEmbed();
        return null;
      }
      if (isAborted(signal)) {
        releaseEmbed();
        return null;
      }
      const held = context;
      const embed = async (
        text: string,
        role: "query" | "doc",
      ): Promise<Float32Array | null> => {
        if (embedderHung || isAborted(signal)) return null;
        return embedWithContext(held, text, role, signal);
      };
      try {
        return await fn(embed);
      } finally {
        // Keep embed held while context is still ready (session-scoped).
        // releaseEmbedder is the only path that drops the gate permanently.
        // If phase is not ready, drop the gate claim.
        if (phase !== "ready" || !context || embedderHung) {
          releaseEmbed();
        }
      }
    });
  } catch {
    return null;
  }
}

async function embedWithContext(
  ctx: EmbedContext,
  text: string,
  role: "query" | "doc",
  signal?: AbortSignal,
): Promise<Float32Array | null> {
  if (embedderHung || isAborted(signal)) return null;
  const prefixed = applyEmbedPrefix(text, role);
  // Abort gate immediately before the native embedding() call (longest-pole await).
  if (embedderHung || isAborted(signal)) return null;
  // embd_normalize: 2 = L2 normalize (matches SemanticVectorIndex defensive L2).
  try {
    // Native embedding() — caller must already be inside runNativeOp
    // (ensureEmbedder / withEmbedder / embedDocumentChunk / embedQuery job).
    const result = await ctx.embedding(prefixed, { embd_normalize: 2 });
    if (embedderHung || isAborted(signal)) return null;
    const arr = result?.embedding;
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const out = new Float32Array(arr.length);
    for (let i = 0; i < arr.length; i++) {
      const x = arr[i];
      out[i] = typeof x === "number" && Number.isFinite(x) ? x : 0;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Embed free text with the document (passage) prefix.
 * Returns null when hung, not downloaded, aborted, or on any error (never throws).
 */
export async function embedText(
  text: string,
  opts?: EmbedAbortOpts,
): Promise<Float32Array | null> {
  return embedDocumentChunk(text, opts);
}

/**
 * Embed a document chunk with the e5 passage prefix.
 * Lazy-loads the embedder. Returns null on miss/error/abort/hung.
 * Checks signal before every await boundary and before initLlama / embedding().
 */
export async function embedDocumentChunk(
  text: string,
  opts?: EmbedAbortOpts,
): Promise<Float32Array | null> {
  const signal = opts?.signal;
  try {
    if (embedderHung) return null;
    if (isAborted(signal)) return null;
    if (typeof text !== "string" || text.length === 0) return null;
    if (isAborted(signal)) return null;
    if ((await getEmbeddingModelStatus(opts)) !== "downloaded") return null;
    if (isAborted(signal)) return null;
    const path = await embeddingModelPath(opts);
    if (!path || isAborted(signal)) return null;
    const ok = await ensureEmbedder(path, signal);
    if (!ok || isAborted(signal) || embedderHung) return null;
    return await runNativeOp(async () => {
      if (embedderHung || isAborted(signal)) return null;
      if (!context || phase !== "ready") return null;
      return embedWithContext(context, text, "doc", signal);
    });
  } catch {
    return null;
  }
}

/**
 * Embed a query with the e5 query prefix.
 * Lazy-loads the embedder. Returns null on miss/error/abort/hung.
 * Accepts AbortSignal so a cancelled doc query can bail before the native call.
 */
export async function embedQuery(
  text: string,
  opts?: EmbedAbortOpts,
): Promise<Float32Array | null> {
  const signal = opts?.signal;
  try {
    if (embedderHung) return null;
    if (isAborted(signal)) return null;
    if (typeof text !== "string" || text.length === 0) return null;
    if (isAborted(signal)) return null;
    if ((await getEmbeddingModelStatus(opts)) !== "downloaded") return null;
    if (isAborted(signal)) return null;
    const path = await embeddingModelPath(opts);
    if (!path || isAborted(signal)) return null;
    const ok = await ensureEmbedder(path, signal);
    if (!ok || isAborted(signal) || embedderHung) return null;
    return await runNativeOp(async () => {
      if (embedderHung || isAborted(signal)) return null;
      if (!context || phase !== "ready") return null;
      return embedWithContext(context, text, "query", signal);
    });
  } catch {
    return null;
  }
}

/** Test-only: force-clear embedder state without native release. */
export function __resetEmbedderForTests(): void {
  context = null;
  activePath = null;
  phase = "idle";
  embedderHung = false;
  releaseEmbed();
  // Expose gate state for harness diagnostics.
  void getLlamaContextState;
}
