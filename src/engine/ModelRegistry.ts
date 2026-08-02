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
  /** n_ctx usato dall'engine (più piccolo del contextLength nativo). */
  engineCtx: number;
  /** Cache KV quantizzata (K/V). */
  kvCache: KvCacheProfile;
  /** Modelli ibridi/ricorrenti (Qwen3.5): stato unificato. */
  kvUnified?: boolean;
  /** MTP (NextN speculative) embedded nel GGUF. */
  mtp?: { nMax: number };
  description: string;
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
    engineCtx: 8192, // prudente: 16K solo dopo test su device 8GB+
    kvCache: { k: "q8_0", v: "q4_0" },
    kvUnified: true,
    mtp: { nMax: 3 },
    description:
      "Default. Function calling nativo, multimodale, MTP embedded (~1.5-2x, text-only), ibrido DeltaNet (context lungo a costo contenuto).",
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
    kvCache: { k: "q4_0", v: "q4_0" },
    kvUnified: true,
    // MTP non impostato: GGUF Q3 non validato con tensori NextN (da device test).
    description: "Low-RAM: stesso modello, quant Q3_K_M + KV compatta (device <6GB).",
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
    description:
      "Edge-optimized (PLE): vision/audio CERTIFICATA nel binding, tool calling DSL. MTP: richiede GGUF con tensori iniettati (leftover).",
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
    engineCtx: 16384,
    kvCache: { k: "q8_0", v: "q4_0" },
    kvUnified: true,
    description: "Fallback veloce text-only per device mid-range.",
  },
];

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
