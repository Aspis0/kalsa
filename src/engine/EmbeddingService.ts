/**
 * On-device embedding service (llama.rn second context, embedding:true).
 *
 * Lifecycle (design §5 / HYBRID_RETRIEVAL.md):
 * - Lazy load: no embedder at app start; first embed* call initLlama's
 *   once the EMBEDDING_MODEL bundle is on disk.
 * - Own FIFO mutex (same pattern as WhisperService) — NEVER shares the
 *   LlamaService lifecycle lock (that lock is private and chat-owned).
 * - AppShell must call releaseEmbedder() BEFORE loading the chat model on
 *   ≤6 GB RAM devices so the two contexts never co-reside under memory pressure.
 * - Failures never throw to callers: embed* returns null → hybrid path
 *   degrades to bm25_only.
 *
 * Pure helpers live in embeddingPure.ts (re-exported here) so the harness
 * can compile without llama.rn / RN. Native lifecycle uses dynamic import.
 */

import { EMBEDDING_MODEL } from "./ModelRegistry";
import {
  applyEmbedPrefix,
  type EmbeddableChunk,
  hashChunkContent,
  listDocumentChunksForEmbed,
  planChunksToEmbed,
  shouldDegradeToBm25Only,
} from "./embeddingPure";

// Re-export pure surface so app callers can import from EmbeddingService alone.
export {
  applyEmbedPrefix,
  hashChunkContent,
  listDocumentChunksForEmbed,
  planChunksToEmbed,
  shouldDegradeToBm25Only,
};
export type { EmbeddableChunk };

// ── Status ──────────────────────────────────────────────────────────────────

export type EmbeddingModelStatus = "not_downloaded" | "downloaded";

export async function getEmbeddingModelStatus(): Promise<EmbeddingModelStatus> {
  try {
    const { isModelBundleDownloaded } = await import("./ModelDownloader");
    const ok = await isModelBundleDownloaded(EMBEDDING_MODEL);
    return ok ? "downloaded" : "not_downloaded";
  } catch {
    return "not_downloaded";
  }
}

export async function embeddingModelPath(): Promise<string> {
  const { modelLocalPath } = await import("./ModelDownloader");
  return modelLocalPath(EMBEDDING_MODEL, EMBEDDING_MODEL.file);
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

async function loadInitLlama(): Promise<
  (params: {
    model: string;
    embedding?: boolean;
    n_ctx?: number;
    n_gpu_layers?: number;
    n_threads?: number;
  }) => Promise<EmbedContext>
> {
  const mod = await import("llama.rn");
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
 * Load the embedder context once for the given path.
 * Concurrent callers are serialized.
 */
async function ensureEmbedder(path: string): Promise<void> {
  return withEmbedJob(async () => {
    if (phase === "closing") {
      throw new Error("embedder_closing");
    }
    if (context && activePath === path && phase === "ready") return;

    if (context) {
      try {
        await context.release();
      } catch {
        // ignore release errors on re-init
      }
      context = null;
      activePath = null;
      phase = "idle";
    }

    const initLlama = await loadInitLlama();
    const next = await initLlama({
      model: path,
      embedding: true,
      n_ctx: EMBEDDING_MODEL.n_ctx,
      n_gpu_layers: 0,
      n_threads: 2,
    });
    context = next;
    activePath = path;
    phase = "ready";
  });
}

/**
 * Release the embedder context. Safe to call when idle.
 * AppShell should call this BEFORE loading the chat model on ≤6 GB RAM
 * (design §5). On 8 GB+ co-residence with a 2B chat model is acceptable.
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
 * Returns null when the embedder is not downloaded or fails to load.
 */
export async function withEmbedder<T>(
  fn: (
    embed: (text: string, role: "query" | "doc") => Promise<Float32Array | null>,
  ) => Promise<T>,
): Promise<T | null> {
  try {
    if ((await getEmbeddingModelStatus()) !== "downloaded") return null;
    const path = await embeddingModelPath();
    // ensure + work under a single job so release cannot sneak in between.
    return await withEmbedJob(async () => {
      if (phase === "closing") return null;
      if (!(context && activePath === path && phase === "ready")) {
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
        const initLlama = await loadInitLlama();
        const next = await initLlama({
          model: path,
          embedding: true,
          n_ctx: EMBEDDING_MODEL.n_ctx,
          n_gpu_layers: 0,
          n_threads: 2,
        });
        context = next;
        activePath = path;
        phase = "ready";
      }
      if (!context || phase !== "ready") return null;
      const held = context;
      const embed = async (
        text: string,
        role: "query" | "doc",
      ): Promise<Float32Array | null> => {
        return embedWithContext(held, text, role);
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
): Promise<Float32Array | null> {
  const prefixed = applyEmbedPrefix(text, role);
  // embd_normalize: 2 = L2 normalize (matches SemanticVectorIndex defensive L2).
  const result = await ctx.embedding(prefixed, { embd_normalize: 2 });
  const arr = result?.embedding;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const x = arr[i];
    out[i] = typeof x === "number" && Number.isFinite(x) ? x : 0;
  }
  return out;
}

/**
 * Embed free text with the document (passage) prefix.
 * Returns null when not downloaded or on any error (never throws).
 */
export async function embedText(text: string): Promise<Float32Array | null> {
  return embedDocumentChunk(text);
}

/**
 * Embed a document chunk with the e5 passage prefix.
 * Lazy-loads the embedder. Returns null on miss/error.
 */
export async function embedDocumentChunk(
  text: string,
): Promise<Float32Array | null> {
  try {
    if (typeof text !== "string" || text.length === 0) return null;
    if ((await getEmbeddingModelStatus()) !== "downloaded") return null;
    const path = await embeddingModelPath();
    await ensureEmbedder(path);
    return await withEmbedJob(async () => {
      if (!context || phase !== "ready") return null;
      return embedWithContext(context, text, "doc");
    });
  } catch {
    return null;
  }
}

/**
 * Embed a query with the e5 query prefix.
 * Lazy-loads the embedder. Returns null on miss/error.
 */
export async function embedQuery(text: string): Promise<Float32Array | null> {
  try {
    if (typeof text !== "string" || text.length === 0) return null;
    if ((await getEmbeddingModelStatus()) !== "downloaded") return null;
    const path = await embeddingModelPath();
    await ensureEmbedder(path);
    return await withEmbedJob(async () => {
      if (!context || phase !== "ready") return null;
      return embedWithContext(context, text, "query");
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
}
