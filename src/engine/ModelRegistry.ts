/**
 * Catalogo modelli locali — Fase 1.
 * File GGUF verificati su HuggingFace (agosto 2026).
 * Un solo runtime (llama.rn / llama.cpp) li esegue tutti.
 */

export type ModelInfo = {
  id: string;
  name: string;
  vendor: string;
  quant: string;
  hfRepo: string;
  file: string;
  approxBytes: number;
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
    file: "Qwen3.5-4B-Q4_K_M.gguf",
    approxBytes: 2_600_000_000,
    contextLength: 262144,
    description: "Default. Function calling nativo, multimodale (vision), agente nativo.",
    default: true,
  },
  {
    id: "gemma-4-e2b",
    name: "Gemma 4 E2B",
    vendor: "Google",
    quant: "Q4_K_M",
    hfRepo: "unsloth/gemma-4-E2B-it-GGUF",
    file: "gemma-4-E2B-it-Q4_K_M.gguf",
    approxBytes: 2_500_000_000,
    contextLength: 131072,
    description: "Edge-optimized (PLE): vision/audio, tool calling DSL, MTP speculative decoding.",
  },
  {
    id: "qwen3.5-2b",
    name: "Qwen 3.5 2B",
    vendor: "Alibaba",
    quant: "Q4_K_M",
    hfRepo: "unsloth/Qwen3.5-2B-GGUF",
    file: "Qwen3.5-2B-Q4_K_M.gguf",
    approxBytes: 1_500_000_000,
    contextLength: 262144,
    description: "Fallback veloce per device mid-range.",
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
