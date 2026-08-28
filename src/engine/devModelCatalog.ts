import type { ModelInfo } from "./ModelRegistry";

const DEV_ARTIFACT_REPO = "Kalsa-DevModels";

type CatalogDefaults = Pick<
  ModelInfo,
  | "vendor"
  | "contextLength"
  | "engineCtx"
  | "kvCache"
  | "descriptionKey"
  | "minRamTier"
>;

const QWEN35_4B_DEFAULTS: CatalogDefaults & {
  hybrid: true;
  kvUnified: true;
  thinking: { short: number; extended: number };
} = {
  vendor: "Alibaba",
  contextLength: 262144,
  engineCtx: 8192,
  kvCache: { k: "q8_0", v: "q4_0" },
  hybrid: true,
  kvUnified: true,
  thinking: { short: 256, extended: 512 },
  descriptionKey: "models.dev.description",
  minRamTier: "low",
};

const LFM25_DEFAULTS: CatalogDefaults & {
  hybrid: true;
  thinking: { short: number; extended: number };
} = {
  vendor: "Liquid AI",
  contextLength: 131072,
  engineCtx: 8192,
  kvCache: { k: "q8_0", v: "q4_0" },
  hybrid: true,
  thinking: { short: 256, extended: 512 },
  descriptionKey: "models.dev.description",
  minRamTier: "low",
};

const QWEN3MOE_DEFAULTS: CatalogDefaults = {
  vendor: "Kalsa dev",
  contextLength: 8192,
  engineCtx: 8192,
  kvCache: { k: "q8_0", v: "q4_0" },
  descriptionKey: "models.dev.description",
  minRamTier: "low",
};

const OLMOE_DEFAULTS: CatalogDefaults = {
  ...QWEN3MOE_DEFAULTS,
  contextLength: 4096,
  engineCtx: 4096,
};

/** Sideload-only GGUFs; modelHost keeps their store route unpublished. */
export const DEV_MODEL_REGISTRY: readonly ModelInfo[] = [
  {
    ...QWEN35_4B_DEFAULTS,
    id: "dev-qwen4b-c1",
    name: "[DEV] Qwen 3.5 4B · C1",
    quant: "IQ4_NL-M",
    hfRepo: "unsloth/Qwen3.5-4B-MTP-GGUF",
    revision: "86835bf9949e4d14d6860f7910b1340ad4f271a9",
    file: "Qwen3.5-4B-IQ4_NL-M.gguf",
    sizeBytes: 3_098_664_160,
    hfArtifactRepo: DEV_ARTIFACT_REPO,
  },
  {
    ...QWEN3MOE_DEFAULTS,
    id: "dev-marco-kexp",
    name: "[DEV] Marco Mini Instruct KEXP",
    quant: "KEXP",
    hfRepo: "LiquidAI/LFM2.5-8B-A1B-GGUF",
    revision: "dfd5fdcad7a1c0d31473fb4ca443b8befbacddf0",
    file: "Marco-Mini-Instruct-KEXP.gguf",
    sizeBytes: 6_385_238_848,
    hfArtifactRepo: DEV_ARTIFACT_REPO,
  },
  {
    ...QWEN3MOE_DEFAULTS,
    id: "dev-marco-bprime",
    name: "[DEV][LAB] Marco Mini Instruct KEXP · trunk Q8_0",
    quant: "Q8_0",
    hfRepo: "LiquidAI/LFM2.5-8B-A1B-GGUF",
    revision: "dfd5fdcad7a1c0d31473fb4ca443b8befbacddf0",
    file: "Marco-Mini-Instruct-KEXP-fromsrc-trunk-q8_0.gguf",
    sizeBytes: 6_509_642_624,
    hfArtifactRepo: DEV_ARTIFACT_REPO,
  },
  {
    ...QWEN3MOE_DEFAULTS,
    id: "dev-marco-i1",
    name: "[DEV] Marco Mini Instruct · i1 Q4_K_M",
    quant: "Q4_K_M",
    hfRepo: "LiquidAI/LFM2.5-8B-A1B-GGUF",
    revision: "dfd5fdcad7a1c0d31473fb4ca443b8befbacddf0",
    file: "Marco-Mini-Instruct.i1-Q4_K_M.gguf",
    sizeBytes: 10_505_424_704,
    hfArtifactRepo: DEV_ARTIFACT_REPO,
  },
  {
    ...OLMOE_DEFAULTS,
    id: "dev-olmoe",
    name: "[DEV] OLMoE 1B-7B Instruct",
    quant: "Q4_K_M",
    hfRepo: "allenai/OLMoE-1B-7B-0924",
    revision: "main",
    file: "OLMoE-1B-7B-0924-Instruct-Q4_K_M.gguf",
    sizeBytes: 4_213_513_024,
    hfArtifactRepo: DEV_ARTIFACT_REPO,
  },
  {
    ...LFM25_DEFAULTS,
    id: "dev-lfm25-kexp",
    name: "[DEV] LFM2.5 8B-A1B KEXP",
    quant: "KEXP",
    hfRepo: "LiquidAI/LFM2.5-8B-A1B-GGUF",
    revision: "dfd5fdcad7a1c0d31473fb4ca443b8befbacddf0",
    file: "LFM2.5-8B-A1B-KEXP.gguf",
    sizeBytes: 3_326_160_384,
    hfArtifactRepo: DEV_ARTIFACT_REPO,
  },
];
