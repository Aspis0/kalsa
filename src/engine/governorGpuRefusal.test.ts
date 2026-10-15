/**
 * The one slow-load reason the person can act on. The governor's latch is
 * private to `LlamaService.ts` (it needs the native engine to set), so the rule
 * itself lives beside the governor's inputs and is tested here, phase by phase.
 */
import { gpuRefusedForMemory } from "./governorGpuRefusal";

const ANDROID = { platformOs: "android", attempted: true, fit: "NoFit" } as const;

describe("was the GPU refused for memory", () => {
  test("a governor that wanted the GPU and could not fit it", () => {
    expect(gpuRefusedForMemory(ANDROID)).toBe(true);
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