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
import type { TranslationKey } from "../i18n";

export type ModelFileSpec = {
  file: string;
  sizeBytes: number;
  /** Repo/revision del file (default: quelli del modello). */
  hfRepo?: string;
  revision?: string;
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
  /** Proiettore multimodale (vision) — assente = modello text-only. */
  mmproj?: ModelFileSpec;
  contextLength: number;
  /**
   * Catalog soft default for n_ctx. Runtime prefers resolveContextProfile
   * (hybrid + RAM ≥6GB → 16k; otherwise 8192). Catalog values remain as
   * documentation / non-hybrid fallback reference.
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
  /** i18n key for the user-facing description shown in Settings (en master + it). */
  descriptionKey: TranslationKey;
  /**
   * i18n key for a compact RAM badge (e.g. "8 GB+ RAM") shown in Settings.
   * Only set for models that are part of the qwen3.5 RAM-tier fallback chain.
   */
  ramBadgeKey?: TranslationKey;
  /**
   * Minimum RAM tier this model is recommended for (advisory only — see
   * contextProfile.ts §RAM tiers). Only set for the qwen3.5 fallback chain;
   * other models (Gemma, Whisper) are not part of that tier scheme.
   */
  minRamTier?: RamTier;
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
    default: true,
  },
  {
    id: "qwen3.5-4b-q3",
    name: "Qwen 3.5 4B · Q3",
    vendor: "Alibaba",
    quant: "Q3_K_M",
    hfRepo: "unsloth/Qwen3.5-4B-MTP-GGUF",
    revision: "86835bf9949e4d14d6860f7910b1340ad4f271a9",
    file: "Qwen3.5-4B-Q3_K_M.gguf",
    sizeBytes: 2_374_564_160,
    mmproj: {
      file: "mmproj-F16.gguf",
      sizeBytes: 672_423_616,
      hfRepo: "unsloth/Qwen3.5-4B-GGUF",
      revision: "e87f176479d0855a907a41277aca2f8ee7a09523",
    },
    contextLength: 262144,
    engineCtx: 8192,
    // Low-RAM hybrid: q4/q4 KV (~half of q8) so Q3 weights + KV fit on ~4GB devices.
    kvCache: { k: "q4_0", v: "q4_0" },
    hybrid: true,
    kvUnified: true,
    // MTP non impostato: GGUF Q3 non validato con tensori NextN (da device test).
    thinking: { short: 256, extended: 512 },
    descriptionKey: "models.qwen4bQ3.description",
    ramBadgeKey: "models.qwen4bQ3.ramBadge",
    minRamTier: "mid",
  },
  {
    id: "gemma-4-e2b",
    name: "Gemma 4 E2B",
    vendor: "Google",
    quant: "Q4_K_M",
    hfRepo: "unsloth/gemma-4-E2B-it-GGUF",
    revision: "0314792d7f1f7e229411f620751375812bb9faf2",
    file: "gemma-4-E2B-it-Q4_K_M.gguf",
    sizeBytes: 3_106_738_272,
    mmproj: { file: "mmproj-F16.gguf", sizeBytes: 985_654_080 },
    contextLength: 131072,
    engineCtx: 8192,
    kvCache: { k: "q8_0", v: "q4_0" },
    descriptionKey: "models.gemmaE2b.description",
  },
  {
    id: "qwen3.5-2b",
    name: "Qwen 3.5 2B",
    vendor: "Alibaba",
    quant: "Q4_K_M",
    hfRepo: "unsloth/Qwen3.5-2B-GGUF",
    revision: "f6d5376be1edb4d416d56da11e5397a961aca8ae",
    file: "Qwen3.5-2B-Q4_K_M.gguf",
    sizeBytes: 1_280_835_840,
    contextLength: 262144,
    // Catalog-authoritative: resolveContextProfile never downgrades this (16k on all devices).
    engineCtx: 16384,
    // V-cache quant: q4_0 baseline; revisit after Fase 4 quality bench.
    kvCache: { k: "q8_0", v: "q4_0" },
    hybrid: true,
    kvUnified: true,
    // Measured on-device at q8_0/q4_0: 4.88 KiB/token (hybrid layers filter
    // most of the stack out of KV — naive n_layer×n_embd overestimates).
    kvBytesPerToken: Math.round(4.88 * 1024),
    // nPredict 2560 = extended 1536 + the 1024 answer floor (miniapp JSON blew
    // past 512; n_predict counts think + answer, so 2048 would leave only 512).
    thinking: { short: 512, extended: 1536, nPredict: 2560 },
    descriptionKey: "models.qwen2b.description",
    ramBadgeKey: "models.qwen2b.ramBadge",
    minRamTier: "low",
  },
  {
    id: "lfm2.5-2.6b",
    name: "LFM2.5 2.6B",
    vendor: "Liquid AI",
    quant: "Q4_K_M",
    hfRepo: "LiquidAI/LFM2.5-2.6B-GGUF",
    revision: "b421ad1d549afeda6a0fb2ad3a697cb5a7879adc",
    file: "LFM2.5-2.6B-Q4_K_M.gguf",
    sizeBytes: 1_674_454_848,
    // text-only: no mmproj in the HF repo
    contextLength: 131072,
    engineCtx: 8192,
    kvCache: { k: "q8_0", v: "q4_0" },
    hybrid: true,
    // Budget caps the think block but cannot disable it (template has no off switch).
    thinking: { short: 256, extended: 512 },
    descriptionKey: "models.lfm25.description",
  },
  {
    id: "lfm2.5-8b-a1b",
    name: "LFM2.5 8B-A1B",
    vendor: "Liquid AI",
    quant: "Q4_K_M",
    hfRepo: "LiquidAI/LFM2.5-8B-A1B-GGUF",
    revision: "dfd5fdcad7a1c0d31473fb4ca443b8befbacddf0",
    file: "LFM2.5-8B-A1B-Q4_K_M.gguf",
    sizeBytes: 5_155_564_768,
    // text-only: no mmproj in the HF repo
    contextLength: 131072,
    engineCtx: 8192, // consistent with lfm2.5-2.6b and other large models; 8B MoE needs all weights resident
    kvCache: { k: "q8_0", v: "q4_0" },
    hybrid: true,
    // Budget caps the think block but cannot disable it (template has no off switch).
    thinking: { short: 256, extended: 512 },
    descriptionKey: "models.lfm258b.description",
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

export function formatBytes(bytes: number): string {
  const gb = bytes / 1_000_000_000;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1_000_000)} MB`;
}
