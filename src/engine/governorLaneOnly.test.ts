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

  test("with the GPU fitting, the NPU fit keeps the 800 MiB GPU leg", () => {
    // ctx 8192: the GPU fits (2997.06 MiB), so the lane prices
    // 249 + 68 + 800 + 1596.06 + 219 + 300 = 3232.06 MiB. Lane-only it would
    // be 2432.06 MiB and fit at 3232.
    const at = (availableMiB: number) =>
      buildGovernorParams(lfm, xiaomi, memoryAt(availableMiB, 8192), false, undefined, lanes);
    expect(at(3232)).toMatchObject({ gpu_fit: "Fit", npu_fit: "NoFit", npu_lane_enabled: false });
    expect(at(3233)).toMatchObject({ gpu_fit: "Fit", npu_fit: "Fit", npu_lane_enabled: true });
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
      .toMatchObject({ enabled: false, gpu_fit: "NoFit", npu_lane_enabled: false });
    // SM8650 is GPU-qualified, so `enabled` stays on as before; the LlamaService
    // gate then refuses the load (gpu_fit NoFit, no lane) and it runs on CPU.
    expect(buildGovernorParams(lfm, xiaomi, memoryAt(3004.93), false, undefined, off))
      .toMatchObject({
        enabled: true,
        gpu_fit: "NoFit",
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
        npu: lanes,
        availableSrc: "fresh",
      }),
    ).toMatchObject({
      gpu_fit: "NoFit",
      npu_fit: "Fit",
      npu_price: "lane_only",
      required_mib_with_repack: 4020.12,
      required_mib_without_repack: 2500.06,
      available_mib: 3004.93,
    });
  });

  test("the plan log prints the GPU-inclusive price when the GPU fits", () => {
    const memory = memoryAt(3232, 8192);
    const governor = buildGovernorParams(lfm, xiaomi, memory, false, undefined, lanes);
    expect(
      buildGovernorPlanLog(lfm, memory, governor, undefined, "auto", { laneModel, npu: lanes }),
    ).toMatchObject({
      gpu_fit: "Fit",
      npu_fit: "NoFit",
      npu_price: "with_gpu",
      required_mib_without_repack: 3232.06,
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
      expect(governor).toMatchObject({ npu_lane_enabled: false, npu_fit: "NoFit" });
      expect(
        buildGovernorPlanLog(lfm, memory, governor, undefined, "auto", { laneModel, npu }),
      ).toMatchObject({
        npu_price: "with_gpu",
        required_mib_with_repack: 4820.12,
        required_mib_without_repack: 3300.06,
      });
    }
  });
});
