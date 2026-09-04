/**
 * Unit tests for the bench engine override, and above all for the Android GPU
 * gate: production must never come out of here with n_gpu_layers > 0.
 *
 * Pure module — no AsyncStorage, no llama.rn, loadable under plain node jest.
 */

import {
  applyEngineOverride,
  applyPrefillThreadOverride,
} from "./engineParams";
import type { EngineParamsSlice } from "./engineParams";

/** Production-shaped params: what LlamaService builds before the override. */
function productionParams(): EngineParamsSlice {
  return {
    n_gpu_layers: 0,
    n_threads: 5,
    n_ubatch: 256,
    n_batch: 512,
    flash_attn_type: "auto",
  };
}

describe("applyEngineOverride — Android GPU gate", () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it("leaves production untouched when there is no override", () => {
    expect(applyEngineOverride(productionParams(), undefined, "android")).toEqual(
      productionParams(),
    );
    expect(applyEngineOverride(productionParams(), null, "android")).toEqual(
      productionParams(),
    );
  });

  it("still refuses nGpuLayers on Android while Flash Attention is auto", () => {
    const p = applyEngineOverride(
      productionParams(),
      { nGpuLayers: 99 },
      "android",
    );
    expect(p.n_gpu_layers).toBe(0);
    expect(warn).toHaveBeenCalled();
  });

  it("refuses it just as firmly when FA is explicitly on", () => {
    const p = applyEngineOverride(
      productionParams(),
      { nGpuLayers: 99, flashAttn: "on" },
      "android",
    );
    expect(p.n_gpu_layers).toBe(0);
    expect(p.flash_attn_type).toBe("on");
    expect(warn).toHaveBeenCalled();
  });

  it("allows the one untested cell: offload with FA off", () => {
    const p = applyEngineOverride(
      productionParams(),
      { nGpuLayers: 99, flashAttn: "off" },
      "android",
    );
    expect(p.n_gpu_layers).toBe(99);
    expect(p.flash_attn_type).toBe("off");
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not need the FA escort on other platforms", () => {
    const p = applyEngineOverride(productionParams(), { nGpuLayers: 99 }, "ios");
    expect(p.n_gpu_layers).toBe(99);
    expect(p.flash_attn_type).toBe("auto");
    expect(warn).not.toHaveBeenCalled();
  });

  // Regression: the first offload arm on real hardware failed on EVERY turn and
  // was read as "GPU offload does not initialise". It was not the GPU — llama
  // refuses a quantized V cache when flash attention is off
  // (llama-context.cpp:3566), and every LLM we ship has v: "q4_0".
  it("forces an f16 V cache whenever it turns flash attention off", () => {
    const p = applyEngineOverride(
      { ...productionParams(), cache_type_v: "q4_0" },
      { nGpuLayers: 99, flashAttn: "off" },
      "android",
    );
    expect(p.cache_type_v).toBe("f16");
    expect(p.n_gpu_layers).toBe(99);
  });

  it("leaves the catalogue V cache alone for auto and on", () => {
    for (const flashAttn of ["auto", "on"] as const) {
      const p = applyEngineOverride(
        { ...productionParams(), cache_type_v: "q4_0" },
        { flashAttn },
        "android",
      );
      expect(p.cache_type_v).toBe("q4_0");
    }
  });

  it("sets flash_attn_type on its own, with no GPU field in sight", () => {
    const p = applyEngineOverride(
      productionParams(),
      { flashAttn: "off" },
      "android",
    );
    expect(p.flash_attn_type).toBe("off");
    expect(p.n_gpu_layers).toBe(0);
  });
});

describe("applyEngineOverride — threads and ubatch", () => {
  it("passes threads through and clamps ubatch to n_batch", () => {
    const p = applyEngineOverride(
      productionParams(),
      { nThreads: 8, nUbatch: 4096 },
      "android",
    );
    expect(p.n_threads).toBe(8);
    expect(p.n_ubatch).toBe(512);
  });

  it("clamps against the 512 default when n_batch is absent", () => {
    const p = applyEngineOverride({ n_ubatch: 256 }, { nUbatch: 1024 }, "ios");
    expect(p.n_ubatch).toBe(512);
  });

  it("sets prefill threads after decode override", () => {
    const p = applyEngineOverride(
      productionParams(),
      { nThreads: 2, nThreadsPrefill: 4 },
      "android",
    );
    applyPrefillThreadOverride(p, 4);
    expect(p.n_threads).toBe(2);
    expect(p.n_threads_batch).toBe(4);
  });

  it("omits n_threads_batch when final decode equals prefill", () => {
    const p = applyEngineOverride(
      productionParams(),
      { nThreads: 2, nThreadsPrefill: 2 },
      "android",
    );
    applyPrefillThreadOverride(p, 2);
    expect(p).not.toHaveProperty("n_threads_batch");
  });

  it("leaves params byte-identical when prefill override is absent", () => {
    const p = productionParams();
    const before = JSON.stringify(p);
    applyPrefillThreadOverride(p, undefined);
    expect(JSON.stringify(p)).toBe(before);
  });
});
