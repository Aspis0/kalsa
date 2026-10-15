/**
 * The one slow-load reason the person can act on. The governor's latch is
 * private to `LlamaService.ts` (it needs the native engine to set), so the rule
 * itself lives beside the governor's inputs and is tested here, case by case.
 */
import { gpuRefusedForMemory } from "./governorGpuRefusal";

const ANDROID = { platformOs: "android", attempted: true, measured: true, fit: "NoFit" } as const;

describe("was the GPU refused for memory", () => {
  test("a measured free memory that did not fit", () => {
    expect(gpuRefusedForMemory(ANDROID)).toBe(true);
  });

  test("unknown memory is not low memory", () => {
    // `laneFit` returns the same NoFit when there was nothing to compare, so a
    // NoFit with no sample is "not proven to fit" and must not say otherwise.
    expect(gpuRefusedForMemory({ ...ANDROID, measured: false })).toBe(false);
    // A model whose KV could not be priced is refused for the same reason.
    expect(gpuRefusedForMemory({ ...ANDROID, measured: false, fit: null })).toBe(false);
  });

  test("a load that took the GPU is not refused", () => {
    expect(gpuRefusedForMemory({ ...ANDROID, fit: "Fit" })).toBe(false);
    expect(gpuRefusedForMemory({ ...ANDROID, fit: "Unknown" })).toBe(false);
  });

  test("no plan is not a refusal: the S23, iOS pricing and a CPU-only device", () => {
    // No governor at all means no fit was ever asked for, so nothing was
    // refused — `activeGovernorAttempted` is false for all three.
    expect(gpuRefusedForMemory({ ...ANDROID, attempted: false, fit: null })).toBe(false);
    expect(gpuRefusedForMemory({ ...ANDROID, attempted: false, fit: "NoFit" })).toBe(false);
  });

  test("iOS prices the same lanes and runs Metal: a NoFit there cost nothing", () => {
    expect(gpuRefusedForMemory({ ...ANDROID, platformOs: "ios" })).toBe(false);
  });

  test("a thermal refusal is not this line either", () => {
    // The sensor gate refuses the governor with the fit still good: Fit, so
    // there is no memory refusal to report.
    expect(gpuRefusedForMemory({ ...ANDROID, fit: "Fit" })).toBe(false);
  });
});