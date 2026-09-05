/**
 * Catalogo modelli locali — Fase 1/4/5.
 * File GGUF + mmproj (vision) verificati su HuggingFace; sizeBytes = dimensione
 * ESATTA (dall'API HF, usata per validare i download completi); revision = SHA
 * del repo pinnato (URL immutabili: `resolve/{revision}/{file}`).
 *
 * Studio context/KV/MTP (2026-08-02):
 * - Qwen3.5-4B è ibrido Gated DeltaNet + Gated Attention (32 layer, 4 kv_heads,
 *   head_dim 256): i layer DeltaNet hanno stato ricorrente FISSO (non lineare),
 *   quindi il context lungo costa solo sui layer attention (~32KB/token q8_0).
 * - KV cache: q8_0 ≈98% qualità FP16 (metà RAM), q4_0 ≈92% (quarto; possibili
 *   "cliff" su NLP → V in q4 è la pratica comune, K resta q8).
 * - MTP (NextN speculative, embedded nei GGUF `*-MTP-GGUF`): ~1.5-2x più veloce,
 *   costo ~90MB extra sul Q4_K_M.
 */

import type { RamTier } from "./contextProfile";
import type { LoadPolicy } from "./loadPolicy";
import type { TranslationKey } from "../i18n";

export type ModelFileSpec = {
  file: string;
  sizeBytes: number;
  /** Repo/revision del file (default: quelli del modello). */
  hfRepo?: string;
  revision?: string;
};

export type ModelWeightBytesPerToken = {
  /** Decimal bytes of weights read for one generated token. */
  bytes: number;
  /** Provenance is part of the value so estimates cannot look measured. */
  source: "tensor-map" | "file-size-estimate";
};

export type KvCacheProfile = {
  k: "f16" | "f32" | "q8_0" | "q4_0" | "q4_1" | "iq4_nl" | "q5_0" | "q5_1";
  v: "f16" | "f32" | "q8_0" | "q4_0" | "q4_1" | "iq4_nl" | "q5_0" | "q5_1";
};

export type ModelInfo = {
  id: string;
  name: string;
  vendor: string;
  quant: string;
  hfRepo: string;
  revision: string;
  file: string;
  sizeBytes: number;
  /** Hugging Face repo name in KALSA_HF_ORG for artifacts we publish. */
  hfArtifactRepo?: string;
  /** Proiettore multimodale (vision) — assente = modello text-only. */
  mmproj?: ModelFileSpec;
  contextLength: number;
  /**
   * Catalog soft default for n_ctx. Runtime prefers resolveContextProfile
   * (hybrid + CTX_UPGRADE_MIN_TOTAL_BYTES → 16k; otherwise 8192). Catalog
   * values remain as documentation / non-hybrid fallback reference.
   */
  engineCtx: number;
  /** Cache KV quantizzata (K/V). */
  kvCache: KvCacheProfile;
  /**
   * Hybrid architecture (Gated DeltaNet + attention subset, e.g. Qwen3.5).
   * Drives adaptive n_ctx via resolveContextProfile (V4.2 §Fase 0.5).
   * KV types always come from `kvCache` (catalog is authoritative).
   */
  hybrid?: boolean;
  /** Modelli ibridi/ricorrenti (Qwen3.5): stato unificato. */
  kvUnified?: boolean;
  /**
   * Declarative model size used by runtime gates that need a coarse class.
   * This is metadata, not an inference from the model id.
   */
  sizeClass?: "2B" | "4B" | "8B" | "other";
  /**
   * MTP (NextN speculative) embedded nel GGUF. `nMax` is the capability;
   * `defaultEnabled` (default false) gates the PRODUCTION path — plain decode
   * beat MTP on open text on CI (3x) and on the Xiaomi 14 (2x, +53% decode,
   * acceptance 26-30%). `bench:speculative mtp` re-tests the arm anytime.
   */
  mtp?: { nMax: number; defaultEnabled?: boolean };
  /**
   * Per-model thinking budgets (tokens) for Settings "Short"/"Extended" modes,
   * plus an n_predict ceiling override when a budget mode is active (the think
   * block + answer must both fit under n_predict). Absent → 256/512/1024.
   */
  thinking?: { short: number; extended: number; nPredict?: number };
  /**
   * Template strips `<think>` when re-rendering assistant history
   * (`preserve_thinking` defaults false in the jinja). When set, completions
   * pass `chat_template_kwargs.preserve_thinking: true` so history matches KV.
   * Cost: every past think block stays in context for the rest of the
   * conversation (up to `thinking.short` tokens/turn). Cache reuse beats that.
   */
  preserveThinking?: boolean;
  /** i18n key for the user-facing description shown in Settings (en master + it). */
  descriptionKey: TranslationKey;
  /**
   * i18n key for a compact RAM badge (e.g. "8 GB+ RAM") shown in Settings.
   * Set for models that participate in the RAM-tier recommendation UI.
   */
  ramBadgeKey?: TranslationKey;
  /**
   * Minimum RAM tier for loading this model (advisory only — see
   * contextProfile.ts §RAM tiers).
   */
  minRamTier?: RamTier;
  /**
   * RAM tiers for which this is the advisory recommendation. The first
   * matching listed entry in MODEL_REGISTRY wins; tests enforce one primary
   * recommendation per tier.
   */
  recommendForTiers?: RamTier[];
  /** Hidden catalog entries remain available to code but are not listed or
   * eligible for recommendations. Omitted means listed (the default).
   */
  listed?: boolean;
  /**
   * Measured (or honestly derived) KV cache cost in bytes per token at the
   * catalog `kvCache` quant. Used by `memoryEstimate.ts`. Prefer phone
   * measurements over naive n_layer×n_embd formulae — hybrid models filter
   * layers out of KV and the naive product overestimates.
   *
   * Absent → estimator callers must pass 0 / treat KV as unknown rather than
   * fabricating a value.
   */
  kvBytesPerToken?: number;
  /**
   * Weight bytes read for one generated token at batch 1. Omit when the value
   * is not known from a tensor map; a GGUF file size is not this quantity.
   */
  weightsBytesPerToken?: ModelWeightBytesPerToken;
  /**
   * Measured peak RssAnon when this model runs with expert streaming at
   * `measuredAtContextTokens`. Covers weights + KV + compute buffers. The
   * gate and load path refuse to stream unless the load context equals that
   * n_ctx — there is nothing honest to scale by. Absent → never stream.
   */
  streamingResident?: {
    bytes: number;
    measuredAtContextTokens: number;
  };
  /**
   * True only for mixture-of-experts models, whose routed experts can be read
   * from the file per token instead of held resident. This flag is capability,
   * not permission: streaming still requires `streamingResident` at the load
   * context. Streaming forces `no_extra_bufts`, so it removes exactly the
   * repack term the gate refuses on — which is why the GATE owns the decision
   * and there is no setting: HARNESS_FINDINGS §7.48 measured a remedy of this
   * shape at 6.6x on a phone without headroom and 1.006x on one with it. A
   * dense model has no routed experts and must never carry this.
   */
  canStreamExperts?: boolean;
  /**
   * Weight-load policy for THIS model: mmap and repack, resolved by
   * loadPolicy.resolveLoadPolicy. Precedence: bench levers (kalsa.bench.norepack,
   * bench:engine useMmap) > expert streaming > this entry > DEFAULT_LOAD_POLICY.
   *
   * The default ({mmap:true, repack:true}) is llama.cpp's own normal behaviour
   * (common/common.h:574): weights stay mapped on the GGUF file — page-cache
   * backed, reclaimable by the kernel under pressure. It is the correct
   * configuration, not a trade-off; entries below deviate only on a measure.
   *
   * Adding the policy CHANGES THE LOAD BEHAVIOUR OF EVERY MODEL: measured device
   * logs until now show `load_tensors ... (mmap = false)` — anonymous,
   * unreclaimable weights — for every entry. This is deliberate; re-measure on
   * device after rebuilding before drawing conclusions from older runs.
   */
  loadPolicy?: LoadPolicy;
  default?: boolean;
};

export const MODEL_REGISTRY: ModelInfo[] = [
  {
    id: "qwen3.5-4b",
    name: "Qwen 3.5 4B",
    vendor: "Alibaba",
    quant: "Q4_K_M",
    hfRepo: "unsloth/Qwen3.5-4B-MTP-GGUF",
    revision: "86835bf9949e4d14d6860f7910b1340ad4f271a9",
    file: "Qwen3.5-4B-Q4_K_M.gguf",
    sizeBytes: 2_834_975_040,
    weightsBytesPerToken: {
      bytes: 2_810_038_272,
      source: "tensor-map",
    },
    // Il repo MTP-GGUF non contiene il mmproj: punta al repo base.
    mmproj: {
      file: "mmproj-F16.gguf",
      sizeBytes: 672_423_616,
      hfRepo: "unsloth/Qwen3.5-4B-GGUF",
      revision: "e87f176479d0855a907a41277aca2f8ee7a09523",
    },
    contextLength: 262144,
    engineCtx: 8192, // soft catalog; runtime may UPGRADE via resolveContextProfile on high-RAM hybrids
    // V-cache quant: q4_0 baseline; revisit after Fase 4 quality bench.
    kvCache: { k: "q8_0", v: "q4_0" },
    hybrid: true,
    kvUnified: true,
    sizeClass: "4B",
    // kvBytesPerToken intentionally omitted: no on-device measurement for the 4B
    // at q8_0/q4_0, and the registry lacks attention-layer count / n_embd_k_gqa
    // fields needed to derive it honestly from the hybrid layout (header comment
    // "~32KB/token q8_0" is a pre-measurement sketch, not a fit). Estimator
    // callers pass 0 → KV term degrades to zero rather than a fabricated value.
    mtp: { nMax: 3 },
    thinking: { short: 256, extended: 512 },
    descriptionKey: "models.qwen4b.description",
    ramBadgeKey: "models.qwen4b.ramBadge",
    minRamTier: "high",
    recommendForTiers: ["high"],
    default: true,
  },
  {
    id: "lfm2.5-2.6b",
    name: "LFM2.5 2.6B",
    vendor: "Liquid AI",
    quant: "QAD-Q4_0",
    hfRepo: "LiquidAI/LFM2.5-2.6B-GGUF",
    revision: "f4a289c8a200a5ca71005ba7abc2dad33058a450",
    file: "LFM2.5-2.6B-QAD-Q4_0.gguf",
    sizeBytes: 1_593_894_944,
    weightsBytesPerToken: {
      bytes: 1_585_647_616,
      source: "tensor-map",
    },
    // text-only: no mmproj in the HF repo
    contextLength: 131072,
    engineCtx: 8192,
    kvCache: { k: "q8_0", v: "q4_0" },
    hybrid: true,
    sizeClass: "2B",
    // Budget caps the think block but cannot disable it (template has no off switch).
    thinking: { short: 256, extended: 512 },
    preserveThinking: true,
    descriptionKey: "models.lfm25.description",
    ramBadgeKey: "models.lfm25.ramBadge",
    minRamTier: "low",
    recommendForTiers: ["low", "mid"],
  },
];

/**
 * On-device ASR (whisper.cpp tiny, multilingual).
 * NOT listed in MODEL_REGISTRY (LLM list) — Settings → Voice downloads it
 * through the same ModelDownloader pipeline.
 *
 * sizeBytes verified 2026-08-02 via Hugging Face API:
 *   HEAD resolve/main/ggml-tiny.bin → X-Linked-Size: 77691713
 *   repo sha: 5359861c739e955e79d9a303bcbc70fb988958b1
 * LLM fields (contextLength/engineCtx/kvCache) are unused placeholders
 * so downloadModelBundle can reuse ModelInfo.
 */
export const WHISPER_MODEL: ModelInfo = {
  id: "whisper-tiny",
  name: "Whisper Tiny",
  vendor: "OpenAI / ggerganov",
  quant: "f16",
  hfRepo: "ggerganov/whisper.cpp",
  revision: "5359861c739e955e79d9a303bcbc70fb988958b1",
  file: "ggml-tiny.bin",
  sizeBytes: 77_691_713,
  contextLength: 0,
  engineCtx: 0,
  kvCache: { k: "f16", v: "f16" },
  descriptionKey: "models.whisperTiny.description",
};

/**
 * On-device multilingual embedder (intfloat e5-small, Q8_0).
 * NOT listed in MODEL_REGISTRY (chat LLM list) — Settings optional download
 * through the same ModelDownloader pipeline. Enables hybrid document search
 * (BM25 ∥ dense → RRF); absent → BM25-only (today's path).
 *
 * sizeBytes verified 2026-08-10 via Hugging Face API:
 *   multilingual-e5-small-Q8_0.gguf → 131_953_504
 *   repo sha: e1da94460f223e3204e75dfe51350e5491c879d4
 * LLM fields (contextLength/engineCtx/kvCache) are unused placeholders
 * so downloadModelBundle can reuse ModelInfo.
 */
export type EmbeddingModelInfo = ModelInfo & {
  isEmbedding: true;
  dims: number;
  langs: string;
  pooling: "mean" | "cls";
  prefixes: { query: string; doc: string };
  /** Embedder n_ctx (e5-small = 512). */
  n_ctx: number;
};

export const EMBEDDING_MODEL: EmbeddingModelInfo = {
  id: "multilingual-e5-small",
  name: "multilingual-e5-small",
  vendor: "intfloat / keisuke-miyako",
  quant: "Q8_0",
  hfRepo: "keisuke-miyako/multilingual-e5-small-gguf-q8_0",
  revision: "e1da94460f223e3204e75dfe51350e5491c879d4",
  file: "multilingual-e5-small-Q8_0.gguf",
  sizeBytes: 131_953_504,
  contextLength: 512,
  engineCtx: 512,
  kvCache: { k: "f16", v: "f16" },
  descriptionKey: "models.whisperTiny.description", // unused; Settings uses embedding.* keys
  isEmbedding: true,
  dims: 384,
  langs: "100+ (incl. IT)",
  pooling: "mean",
  prefixes: { query: "query: ", doc: "passage: " },
  n_ctx: 512,
};

export function getDefaultModel(): ModelInfo {
  return MODEL_REGISTRY.find((model) => model.default) ?? MODEL_REGISTRY[0];
}

export function getModelById(id: string): ModelInfo {
  return MODEL_REGISTRY.find((model) => model.id === id) ?? getDefaultModel();
}

/**
 * Catalog hybrid / kvUnified (Qwen3.5). Unknown ids are false — do not
 * inherit the default model's hybrid flag.
 */
export function isHybridOrKvUnifiedModel(id: string): boolean {
  const model = MODEL_REGISTRY.find((entry) => entry.id === id);
  return model?.hybrid === true || model?.kvUnified === true;
}

export function formatBytes(bytes: number): string {
  const gb = bytes / 1_000_000_000;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1_000_000)} MB`;
}
