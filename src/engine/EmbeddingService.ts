/**
 * On-device embedding service (llama.rn second context, embedding:true).
 *
 * Lifecycle (design §5 / HYBRID_RETRIEVAL.md):
 * - Lazy load: no embedder at app start; first embed* call initLlama's
 *   once the EMBEDDING_MODEL bundle is on disk.
 * - Own FIFO mutex (same pattern as WhisperService) — NEVER shares the
 *   LlamaService lifecycle lock (that lock is private and chat-owned).
 * - Serialization rule (residency gate, both ends):
 *     chat init and embedder init are mutually exclusive.
 *     - Chat path: AppShell always calls releaseEmbedder() BEFORE initLlama
 *       of the chat model (not only on ≤6 GB).
 *     - Embedder path: ensureEmbedder refuses to init while the chat engine
 *       is ready (isEngineReady() === true) → returns without initing.
 * - AppShell must also bump embedJobGenerationRef / abort the job signal
 *   before chat load so in-flight embeds cannot race a later ensureEmbedder.
 * - Failures never throw to callers: embed* returns null → hybrid path
 *   degrades to bm25_only.
 * - Cancellation: embedText / embedDocumentChunk / embedQuery accept
 *   `opts.signal?: AbortSignal`. signal.aborted is checked immediately
 *   before EVERY await boundary and immediately before initLlama + the
 *   native embedding() call; on abort, return null (never throw).
 *
 * Pure helpers live in embeddingPure.ts (re-exported here) so the harness
 * can compile without llama.rn / RN. Native lifecycle uses dynamic import.
 */

import { EMBEDDING_MODEL } from "./ModelRegistry";
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
 * FIFO mutex — same pattern as WhisperService / LlamaService job chains.
 * Serializes ensureEmbedder / release / embed so they never interleave.
 */
let embedJobChain: Promise<unknown> = Promise.resolve();

function withEmbedJob<T>(fn: () => Promise<T>): Promise<T> {
  const run = embedJobChain.then(fn, fn);
  embedJobChain = run.catch(() => undefined);
  return run;
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
  return context !== null && phase === "ready";
}

/**
 * Cached chat-engine-ready predicate (LlamaService.isEngineReady).
 * Loaded via dynamic import so EmbeddingService has no static cycle with
 * LlamaService; once resolved, subsequent checks are sync.
 *
 * Serialization rule: chat init and embedder init are mutually exclusive.
 * AppShell always releaseEmbedder() before chat init; ensureEmbedder refuses
 * to init while this predicate is true.
 */
let cachedIsEngineReady: (() => boolean) | null = null;

async function resolveChatReadyCheck(): Promise<() => boolean> {
  if (cachedIsEngineReady) return cachedIsEngineReady;
  try {
    const mod = await import("./LlamaService");
    const fn = () => {
      try {
        return typeof mod.isEngineReady === "function" && mod.isEngineReady();
      } catch {
        return false;
      }
    };
    cachedIsEngineReady = fn;
    return fn;
  } catch {
    const fn = () => false;
    cachedIsEngineReady = fn;
    return fn;
  }
}

/**
 * Load the embedder context once for the given path.
 * Concurrent callers are serialized.
 *
 * Residency gate: if the chat engine is ready, refuse to init (return without
 * creating a second context). Chat init always releaseEmbedder()'s first, so
 * the two paths are mutually exclusive at both ends.
 *
 * Cancellation: checks signal before every await and before initLlama; on
 * abort, leaves state idle and returns (never throws).
 */
async function ensureEmbedder(
  path: string,
  signal?: AbortSignal,
): Promise<boolean> {
  return withEmbedJob(async () => {
    if (isAborted(signal)) return false;
    if (phase === "closing") return false;
    if (context && activePath === path && phase === "ready") return true;

    // Resolve (and cache) the chat-ready predicate before any init.
    if (isAborted(signal)) return false;
    const chatReady = await resolveChatReadyCheck();
    if (isAborted(signal)) return false;

    // Residency gate: chat engine resident → do not init a second context.
    if (chatReady()) return false;
    if (isAborted(signal)) return false;

    if (context) {
      try {
        await context.release();
      } catch {
        // ignore release errors on re-init
      }
      if (isAborted(signal)) {
        context = null;
        activePath = null;
        phase = "idle";
        return false;
      }
      context = null;
      activePath = null;
      phase = "idle";
    }

    if (isAborted(signal)) return false;
    // Re-check chat residency after the await above (chat may have loaded).
    if (chatReady()) return false;

    const initLlama = await loadInitLlama(signal);
    if (!initLlama || isAborted(signal)) return false;
    // Final residency + abort gate immediately before initLlama.
    if (chatReady()) return false;
    if (isAborted(signal)) return false;

    try {
      const next = await initLlama({
        model: path,
        embedding: true,
        n_ctx: EMBEDDING_MODEL.n_ctx,
        n_gpu_layers: 0,
        n_threads: 2,
      });
      if (isAborted(signal)) {
        // Job cancelled mid-init: release the just-created context so it
        // cannot outlive the abort (chat may be about to load).
        try {
          await next.release();
        } catch {
          /* ignore */
        }
        context = null;
        activePath = null;
        phase = "idle";
        return false;
      }
      // Chat may have become ready during initLlama — release if so.
      if (chatReady()) {
        try {
          await next.release();
        } catch {
          /* ignore */
        }
        context = null;
        activePath = null;
        phase = "idle";
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
      return false;
    }
  });
}

/**
 * Release the embedder context. Safe to call when idle.
 * AppShell ALWAYS calls this BEFORE loading the chat model (serialization
 * rule: chat init and embedder init are mutually exclusive). On 8 GB+ the
 * embedder may be re-warmed after chat is released; co-residence is still
 * refused by ensureEmbedder while chat is ready.
 */
export async function releaseEmbedder(): Promise<void> {
  return withEmbedJob(async () => {
    if (!context) {
      phase = "idle";
      activePath = null;
      return;
    }
    phase = "closing";
    try {
      await context.release();
    } catch {
      // ignore
    } finally {
      context = null;
      activePath = null;
      phase = "idle";
    }
  });
}

/**
 * Run `fn` while the embedder is held. Acquires the embed job lock for the
 * whole batch so release cannot interleave mid-batch.
 * Returns null when the embedder is not downloaded, chat is resident, aborted,
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
    if (isAborted(signal)) return null;
    if ((await getEmbeddingModelStatus(opts)) !== "downloaded") return null;
    if (isAborted(signal)) return null;
    const path = await embeddingModelPath(opts);
    if (!path || isAborted(signal)) return null;
    // ensure + work under a single job so release cannot sneak in between.
    return await withEmbedJob(async () => {
      if (isAborted(signal)) return null;
      if (phase === "closing") return null;
      const chatReady = await resolveChatReadyCheck();
      if (isAborted(signal)) return null;
      if (!(context && activePath === path && phase === "ready")) {
        if (chatReady()) return null;
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
        if (isAborted(signal)) return null;
        if (chatReady()) return null;
        const initLlama = await loadInitLlama(signal);
        if (!initLlama || isAborted(signal)) return null;
        if (chatReady()) return null;
        try {
          const next = await initLlama({
            model: path,
            embedding: true,
            n_ctx: EMBEDDING_MODEL.n_ctx,
            n_gpu_layers: 0,
            n_threads: 2,
          });
          if (isAborted(signal) || chatReady()) {
            try {
              await next.release();
            } catch {
              /* ignore */
            }
            context = null;
            activePath = null;
            phase = "idle";
            return null;
          }
          context = next;
          activePath = path;
          phase = "ready";
        } catch {
          context = null;
          activePath = null;
          phase = "idle";
          return null;
        }
      }
      if (!context || phase !== "ready") return null;
      if (isAborted(signal)) return null;
      const held = context;
      const embed = async (
        text: string,
        role: "query" | "doc",
      ): Promise<Float32Array | null> => {
        if (isAborted(signal)) return null;
        return embedWithContext(held, text, role, signal);
      };
      return fn(embed);
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
  if (isAborted(signal)) return null;
  const prefixed = applyEmbedPrefix(text, role);
  // Abort gate immediately before the native embedding() call.
  if (isAborted(signal)) return null;
  // embd_normalize: 2 = L2 normalize (matches SemanticVectorIndex defensive L2).
  try {
    const result = await ctx.embedding(prefixed, { embd_normalize: 2 });
    if (isAborted(signal)) return null;
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
 * Returns null when not downloaded, aborted, or on any error (never throws).
 */
export async function embedText(
  text: string,
  opts?: EmbedAbortOpts,
): Promise<Float32Array | null> {
  return embedDocumentChunk(text, opts);
}

/**
 * Embed a document chunk with the e5 passage prefix.
 * Lazy-loads the embedder. Returns null on miss/error/abort.
 * Checks signal before every await boundary and before initLlama / embedding().
 */
export async function embedDocumentChunk(
  text: string,
  opts?: EmbedAbortOpts,
): Promise<Float32Array | null> {
  const signal = opts?.signal;
  try {
    if (isAborted(signal)) return null;
    if (typeof text !== "string" || text.length === 0) return null;
    if (isAborted(signal)) return null;
    if ((await getEmbeddingModelStatus(opts)) !== "downloaded") return null;
    if (isAborted(signal)) return null;
    const path = await embeddingModelPath(opts);
    if (!path || isAborted(signal)) return null;
    const ok = await ensureEmbedder(path, signal);
    if (!ok || isAborted(signal)) return null;
    return await withEmbedJob(async () => {
      if (isAborted(signal)) return null;
      if (!context || phase !== "ready") return null;
      return embedWithContext(context, text, "doc", signal);
    });
  } catch {
    return null;
  }
}

/**
 * Embed a query with the e5 query prefix.
 * Lazy-loads the embedder. Returns null on miss/error/abort.
 */
export async function embedQuery(
  text: string,
  opts?: EmbedAbortOpts,
): Promise<Float32Array | null> {
  const signal = opts?.signal;
  try {
    if (isAborted(signal)) return null;
    if (typeof text !== "string" || text.length === 0) return null;
    if (isAborted(signal)) return null;
    if ((await getEmbeddingModelStatus(opts)) !== "downloaded") return null;
    if (isAborted(signal)) return null;
    const path = await embeddingModelPath(opts);
    if (!path || isAborted(signal)) return null;
    const ok = await ensureEmbedder(path, signal);
    if (!ok || isAborted(signal)) return null;
    return await withEmbedJob(async () => {
      if (isAborted(signal)) return null;
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
  embedJobChain = Promise.resolve();
  cachedIsEngineReady = null;
}
