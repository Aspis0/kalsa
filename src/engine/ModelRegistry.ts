/**
 * Catalogo modelli locali — Fase 1/4.
 * File GGUF + mmproj (vision) verificati su HuggingFace; sizeBytes = dimensione
 * ESATTA (dall'API HF, usata per validare i download completi); revision = SHA
 * del repo pinnato (URL immutabili: `resolve/{revision}/{file}`).
 */

export type ModelFileSpec = {
  file: string;
  sizeBytes: number;
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
  description: string;
  default?: boolean;
};

export const MODEL_REGISTRY: ModelInfo[] = [
  {
    id: "qwen3.5-4b",
    name: "Qwen 3.5 4B",
    vendor: "Alibaba",
    quant: "Q4_K_M",
    hfRepo: "unsloth/Qwen3.5-4B-GGUF",
    revision: "e87f176479d0855a907a41277aca2f8ee7a09523",
    file: "Qwen3.5-4B-Q4_K_M.gguf",
    sizeBytes: 2_740_937_888,
    mmproj: { file: "mmproj-F16.gguf", sizeBytes: 672_423_616 },
    contextLength: 262144,
    description: "Default. Function calling nativo, multimodale (vision — da validare su device).",
    default: true,
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
    description: "Edge-optimized (PLE): vision/audio CERTIFICATA nel binding, tool calling DSL, MTP.",
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
