/**
 * The one slow-load reason the person can act on. The governor's latch is
 * private to `LlamaService.ts` (it needs the native engine to set), so the rule
 * itself lives beside the governor's inputs and is tested here, case by case.
 */
import { gpuRefusedForMemory, npuLaneResolved } from "./governorGpuRefusal";

const ANDROID = {
  platformOs: "android",
  attempted: true,
  measured: true,
  fit: "NoFit",
  laneOnly: false,
} as const;

describe("was the GPU refused for memory", () => {
  test("a measured free memory that did not fit", () => {
    expect(gpuRefusedForMemory(ANDROID)).toBe(true);
  });

  test("a lane-only load is not refused: prefill runs on the NPU, not slow", () => {
    expect(gpuRefusedForMemory({ ...ANDROID, laneOnly: true })).toBe(false);
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

describe("was the NPU lane resolved, by the native load's own stats", () => {
  test("HTP0 with no fallback is a resolved lane", () => {
    expect(npuLaneResolved({ npu_device: "HTP0", npu_fallback: null })).toBe(true);
  });

  test("a GPU device or any fallback is not", () => {
    expect(npuLaneResolved({ npu_device: "GPU", npu_fallback: null })).toBe(false);
    expect(npuLaneResolved({ npu_device: "HTP0", npu_fallback: "htp runtime failed" })).toBe(false);
    expect(npuLaneResolved({ npu_device: null, npu_fallback: null })).toBe(false);
  });

  test("an unread or failed stats call keeps the memory line", () => {
    // No stats at all: the app cannot prove the lane ran, so the line shows.
    expect(npuLaneResolved(null)).toBe(false);
    const line = (stats: Parameters<typeof npuLaneResolved>[0]) =>
      gpuRefusedForMemory({ ...ANDROID, laneOnly: npuLaneResolved(stats) });
    expect(line(null)).toBe(true);
    // The HTP runtime failed after the lane was claimed: prefill is on the CPU,
    // so the line is not hidden.
    expect(line({ npu_device: "GPU", npu_fallback: "htp runtime failed" })).toBe(true);
    expect(line({ npu_device: "HTP0", npu_fallback: null })).toBe(false);
  });
});