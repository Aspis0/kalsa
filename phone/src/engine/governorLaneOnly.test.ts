jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null) },
}));

jest.mock("react-native", () => ({
  NativeModules: {
    GovernorBattery: {
      readThermo: jest.fn(async () => null),
      readSoc: jest.fn(async () => ({ socModel: null, socManufacturer: null })),
    },
  },
}));

jest.mock("../../modules/kalsa-thermal/src", () => ({
  addPlatformThermalListener: jest.fn(),
  getCurrentPlatformThermalState: jest.fn(async () => null),
  isPlatformThermalModuleAvailable: jest.fn(() => false),
}));

import type { DeviceProfile } from "./deviceProfile";
import { modelAtKvProfile } from "./kvQuantCost";
import { MODEL_REGISTRY } from "./ModelRegistry";
import { buildGovernorParams, buildGovernorPlanLog } from "./governorInputs";

const MIB = 1024 * 1024;
const lfm = MODEL_REGISTRY.find((entry) => entry.id === "lfm2.5-2.6b")!;
const laneModel = modelAtKvProfile(lfm, "q8_0", "q8_0");

const xiaomi = {
  modelName: "23127PN0CG",
  modelId: null,
  manufacturer: "Xiaomi",
  totalMemoryBytes: 12 * 1024 ** 3,
  availableMemoryBytes: null,
  socModel: "SM8650",
  socManufacturer: null,
  osName: "Android",
} as DeviceProfile;

// Same SoC name, no generation: only the lane can make this load enabled.
const unknownPhone = { ...xiaomi, modelName: "unlisted", socModel: null } as DeviceProfile;

const memoryAt = (availableMiB: number, contextTokens = 16384) => ({
  availableMemoryBytes: availableMiB * MIB,
  totalMemoryBytes: 12 * 1024 ** 3,
  contextTokens,
  ubatch: 256,
  mmap: true,
  offloadedBytes: lfm.sizeBytes,
});

const lanes = {
  android: true,
  hasMmproj: false,
  lanePref: "auto" as const,
  laneModel,
  htpArch: 73,
};

describe("lane-only governor: the GPU leg does not fit, the NPU lane does", () => {
  test("the Xiaomi 14 at 3004.93 MiB loads lane-only instead of dropping to CPU", () => {
    // ctx 16384: the GPU leg needs 3049.06 MiB (249 + 104 + 800 + 1596.06 + 300).
    // The lane-only price is 249 + 136 + 1596.06 + 219 + 300 = 2500.06 MiB.
    const out = buildGovernorParams(lfm, xiaomi, memoryAt(3004.93), false, undefined, lanes);
    expect(out).toMatchObject({
      enabled: true,
      gpu_fit: "NoFit",
      gpu_leg: false,
      npu_fit: "Fit",
      npu_lane_enabled: true,
      npu_device: "HTP0",
      gpu_prefill_measured: false,
      decode_repack: false,
    });
    expect(out).not.toHaveProperty("reason");
  });

  test("the lane-only fit boundary is its requirement plus the margin, to the MiB", () => {
    const npuAt = (availableMiB: number) =>
      buildGovernorParams(lfm, xiaomi, memoryAt(availableMiB), false, undefined, lanes).npu_fit;
    expect(npuAt(2500.06)).toBe("Fit");
    expect(npuAt(2500.05)).toBe("NoFit");
    expect(npuAt(2501)).toBe("Fit");
    expect(npuAt(2500)).toBe("NoFit");
  });

  test("with the GPU fitting, the GPU leg stays while the GPU-inclusive lane fits", () => {
    // ctx 8192: the GPU fits (2997.06 MiB). The GPU-inclusive lane prices
    // 249 + 68 + 800 + 1596.06 + 219 + 300 = 3232.06 MiB; lane-only it is 2432.06.
    const at = (availableMiB: number) =>
      buildGovernorParams(lfm, xiaomi, memoryAt(availableMiB, 8192), false, undefined, lanes);
    expect(at(3233)).toMatchObject({
      gpu_fit: "Fit",
      gpu_leg: true,
      npu_fit: "Fit",
      npu_lane_enabled: true,
      gpu_prefill_measured: true,
    });
    // The GPU-inclusive lane no longer fits, but the lane alone does: the load
    // goes lane-only rather than GPU without the lane.
    expect(at(3232)).toMatchObject({
      gpu_fit: "Fit",
      gpu_leg: false,
      npu_fit: "Fit",
      npu_lane_enabled: true,
      gpu_prefill_measured: false,
    });
  });

  test("the lane stays off on a MoE model, a vision load or an arch below v73", () => {
    const at = (overrides: Partial<typeof lanes>, model = lfm) =>
      buildGovernorParams(model, unknownPhone, memoryAt(3004.93), false, undefined, {
        ...lanes,
        ...overrides,
      });
    // Control: the same load with every gate open is enabled on the lane alone.
    expect(at({})).toMatchObject({ enabled: true, gpu_fit: "NoFit", npu_lane_enabled: true });
    expect(at({ hasMmproj: true })).toMatchObject({ enabled: false, npu_lane_enabled: false });
    expect(at({ htpArch: 69 })).toMatchObject({ enabled: false, npu_lane_enabled: false });
    expect(at({}, { ...lfm, hybrid: false, canStreamExperts: true })).toMatchObject({
      enabled: false,
      npu_lane_enabled: false,
    });
  });

  test("pref off never runs lane-only", () => {
    const off = { ...lanes, lanePref: "off" as const };
    expect(buildGovernorParams(lfm, unknownPhone, memoryAt(3004.93), false, undefined, off))
      .toMatchObject({ enabled: false, gpu_fit: "NoFit", gpu_leg: false, npu_lane_enabled: false });
    // SM8650 is GPU-qualified, so `enabled` stays on as before; the LlamaService
    // gate then refuses the load (gpu_fit NoFit, no lane) and it runs on CPU.
    expect(buildGovernorParams(lfm, xiaomi, memoryAt(3004.93), false, undefined, off))
      .toMatchObject({
        enabled: true,
        gpu_fit: "NoFit",
        gpu_leg: false,
        npu_lane_enabled: false,
        gpu_prefill_measured: false,
      });
  });

  test("a GPU that fits with the lane off keeps the GPU leg, whatever the lane could do alone", () => {
    // Lane off: the lane-only price is never considered, so the GPU leg stays
    // even at 3232 MiB where the lane alone would fit.
    const off = { ...lanes, lanePref: "off" as const };
    expect(buildGovernorParams(lfm, xiaomi, memoryAt(3232, 8192), false, undefined, off))
      .toMatchObject({ gpu_fit: "Fit", gpu_leg: true, npu_lane_enabled: false });
  });

  test("a forced load without the GPU leg does not claim a forced GPU prefill", () => {
    // Forced lane-only: the GPU leg is out, so there is no GPU prefill to force.
    const lanOnly = buildGovernorParams(lfm, xiaomi, memoryAt(3004.93), true, undefined, lanes);
    expect(lanOnly).toMatchObject({
      forced: true,
      gpu_leg: false,
      npu_lane_enabled: true,
      bench_force_gpu_prefill: false,
    });
    // Forced with the GPU leg: the bench flag stays on as before.
    const withLeg = buildGovernorParams(lfm, xiaomi, memoryAt(3300.06), true, undefined, lanes);
    expect(withLeg).toMatchObject({ gpu_leg: true, bench_force_gpu_prefill: true });
    // Forced with the lane off and the GPU NoFit: no leg, no forced prefill.
    const off = { ...lanes, lanePref: "off" as const };
    expect(buildGovernorParams(lfm, xiaomi, memoryAt(3004.93), true, undefined, off)).toMatchObject({
      gpu_leg: false,
      bench_force_gpu_prefill: false,
    });
  });

  test("a refused lane keeps the GPU leg when the GPU fits: arch, vision and MoE", () => {
    // 3300 MiB: the GPU fits (3049.06 MiB), so each refused lane keeps the GPU
    // leg it always had. MoE is a model that is not hybrid, as in the gate test.
    const memory = memoryAt(3300);
    const moe = { ...lfm, hybrid: false, canStreamExperts: true };
    const refused = [
      { model: lfm, npu: { ...lanes, htpArch: 69 } },
      { model: lfm, npu: { ...lanes, hasMmproj: true } },
      { model: moe, npu: lanes },
    ];
    for (const { model, npu } of refused) {
      expect(buildGovernorParams(model, xiaomi, memory, false, undefined, npu)).toMatchObject({
        gpu_fit: "Fit",
        gpu_leg: true,
        npu_lane_enabled: false,
        npu_price: "with_gpu",
      });
    }
  });

  // The five-row table of npuLaneLoad, at the buildGovernorParams boundary.
  // Xiaomi 14 at ctx 16384: the GPU leg needs 3049.06 MiB, the GPU-inclusive
  // lane 3300.06 MiB, the lane alone 2500.06 MiB (all with the 300 MiB margin).
  test("row GPU Fit, GPU-inclusive lane fits: both legs at 3300.06, lane alone 0.01 MiB below", () => {
    expect(buildGovernorParams(lfm, xiaomi, memoryAt(3300.06), false, undefined, lanes))
      .toMatchObject({ gpu_fit: "Fit", gpu_leg: true, npu_fit: "Fit", npu_lane_enabled: true });
    expect(buildGovernorParams(lfm, xiaomi, memoryAt(3300.05), false, undefined, lanes))
      .toMatchObject({ gpu_fit: "Fit", gpu_leg: false, npu_fit: "Fit", npu_lane_enabled: true });
  });

  test("row GPU Fit, GPU-inclusive lane does not fit, lane alone does: lane only", () => {
    // The Xiaomi 14 case the owner approved: GPU Fit, the GPU-inclusive lane at
    // 3300.06 does not fit 3182.16, the lane alone at 2500.06 does.
    const out = buildGovernorParams(lfm, xiaomi, memoryAt(3182.16), false, undefined, lanes);
    expect(out).toMatchObject({
      gpu_fit: "Fit",
      gpu_leg: false,
      npu_fit: "Fit",
      npu_lane_enabled: true,
      npu_device: "HTP0",
      gpu_prefill_measured: false,
    });
    expect(out).not.toHaveProperty("reason");
  });

  test("row GPU Fit, neither lane price fits: GPU without the lane", () => {
    // A lane model whose KV is 16x the entry's: its lane alone no longer fits
    // 3300 MiB, so the GPU fit alone decides and the lane stays off.
    const bigKv = { ...laneModel, kvBytesPerToken: laneModel.kvBytesPerToken! * 16 };
    const out = buildGovernorParams(lfm, xiaomi, memoryAt(3300), false, undefined, {
      ...lanes,
      laneModel: bigKv,
    });
    expect(out).toMatchObject({
      gpu_fit: "Fit",
      gpu_leg: true,
      npu_fit: "NoFit",
      npu_lane_enabled: false,
      gpu_prefill_measured: true,
    });
  });

  test("row GPU NoFit, lane alone does not fit: its NoFit is the lane-only price", () => {
    // Not a load: the lane is off and the verdict was reached at the lane-only
    // price, so the plan prints that price, not the GPU-inclusive one.
    const memory = memoryAt(2400);
    const governor = buildGovernorParams(lfm, xiaomi, memory, false, undefined, lanes);
    expect(governor).toMatchObject({ npu_fit: "NoFit", npu_price: "lane_only" });
    expect(buildGovernorPlanLog(lfm, memory, governor, undefined, "auto", { laneModel })).toMatchObject({
      npu_fit: "NoFit",
      npu_price: "lane_only",
      required_mib_without_repack: 2500.06,
    });
  });

  test("row GPU NoFit, lane alone does not fit: no GPU leg and no lane", () => {
    const out = buildGovernorParams(lfm, xiaomi, memoryAt(2400), false, undefined, lanes);
    expect(out).toMatchObject({
      gpu_fit: "NoFit",
      gpu_leg: false,
      npu_fit: "NoFit",
      npu_lane_enabled: false,
      gpu_prefill_measured: false,
    });
  });

  test("the plan log prints the lane-only price and says it decided", () => {
    const memory = memoryAt(3004.93);
    const governor = buildGovernorParams(lfm, xiaomi, memory, false, undefined, lanes);
    expect(
      buildGovernorPlanLog(lfm, memory, governor, undefined, "auto", {
        laneModel,
        availableSrc: "fresh",
      }),
    ).toMatchObject({
      gpu_fit: "NoFit",
      gpu_leg: false,
      npu_fit: "Fit",
      npu_price: "lane_only",
      required_mib_with_repack: 4020.12,
      required_mib_without_repack: 2500.06,
      available_mib: 3004.93,
    });
  });

  test("the plan log prints the GPU-inclusive price when the GPU leg runs", () => {
    const memory = memoryAt(3233, 8192);
    const governor = buildGovernorParams(lfm, xiaomi, memory, false, undefined, lanes);
    expect(buildGovernorPlanLog(lfm, memory, governor, undefined, "auto", { laneModel })).toMatchObject({
      gpu_fit: "Fit",
      gpu_leg: true,
      npu_fit: "Fit",
      npu_price: "with_gpu",
      required_mib_without_repack: 3232.06,
    });
  });

  test("the plan log prints the lane-only price on a GPU Fit that loads lane-only", () => {
    const memory = memoryAt(3232, 8192);
    const governor = buildGovernorParams(lfm, xiaomi, memory, false, undefined, lanes);
    expect(buildGovernorPlanLog(lfm, memory, governor, undefined, "auto", { laneModel })).toMatchObject({
      gpu_fit: "Fit",
      gpu_leg: false,
      npu_fit: "Fit",
      npu_price: "lane_only",
      required_mib_without_repack: 2432.06,
    });
  });

  test("the plan log agrees with the params on gpu_leg and npu_price, row by row", () => {
    const cases = [
      { available: 3300.06, ctx: 16384, lanes, gpuLeg: true, price: "with_gpu" },
      { available: 3182.16, ctx: 16384, lanes, gpuLeg: false, price: "lane_only" },
      { available: 3004.93, ctx: 16384, lanes, gpuLeg: false, price: "lane_only" },
      { available: 3004.93, ctx: 16384, lanes: { ...lanes, htpArch: 69 }, gpuLeg: false, price: "with_gpu" },
    ];
    for (const { available, ctx, lanes: lanePref, gpuLeg, price } of cases) {
      const memory = memoryAt(available, ctx);
      const governor = buildGovernorParams(lfm, xiaomi, memory, false, undefined, lanePref);
      const plan = buildGovernorPlanLog(lfm, memory, governor, undefined, "auto", { laneModel });
      expect(governor.gpu_leg).toBe(gpuLeg);
      expect(plan.gpu_leg).toBe(governor.gpu_leg);
      expect(plan.npu_price).toBe(price);
    }
  });

  test("a plan log called with another pref keeps the price the params decided", () => {
    // The caller passes pref "off" (and no lane model) for a load whose params
    // were priced lane-only: the printed price must come from the params.
    const memory = memoryAt(3182.16);
    const governor = buildGovernorParams(lfm, xiaomi, memory, false, undefined, lanes);
    expect(governor).toMatchObject({ gpu_leg: false, npu_lane_enabled: true });
    expect(buildGovernorPlanLog(lfm, memory, governor, undefined, "off")).toMatchObject({
      gpu_leg: false,
      npu_price: "lane_only",
    });
  });

  test("a refused lane prints the GPU-inclusive price, not a lane-only one", () => {
    // Same load as the Xiaomi case, but the lane is refused (arch 69 below v73,
    // or vision). The plan must print what buildGovernorParams priced: the
    // GPU-inclusive lane, 249 + 136 + 800 + 1596.06 + 219 + 300 = 3300.06 MiB
    // (with repack: + 1520.06 = 4820.12 MiB).
    const memory = memoryAt(3004.93);
    for (const refused of [{ htpArch: 69 }, { hasMmproj: true }]) {
      const npu = { ...lanes, ...refused };
      const governor = buildGovernorParams(lfm, xiaomi, memory, false, undefined, npu);
      // A refused lane keeps gpu_leg = the GPU's own fit (NoFit here).
      expect(governor).toMatchObject({ gpu_leg: false, npu_lane_enabled: false, npu_fit: "NoFit" });
      expect(
        buildGovernorPlanLog(lfm, memory, governor, undefined, "auto", { laneModel }),
      ).toMatchObject({
        gpu_leg: false,
        npu_price: "with_gpu",
        required_mib_with_repack: 4820.12,
        required_mib_without_repack: 3300.06,
      });
    }
  });
});
