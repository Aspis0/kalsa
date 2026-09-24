jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null) },
}));

jest.mock("react-native", () => ({ NativeModules: {} }));

import type { DeviceProfile } from "./deviceProfile";
import { MODEL_REGISTRY } from "./ModelRegistry";
import { buildGovernorParams, buildGovernorPlanLog } from "./governorInputs";

const s23 = {
  modelName: "SM-S911U",
  modelId: null,
  manufacturer: "Qualcomm",
  totalMemoryBytes: 8 * 1024 ** 3,
  availableMemoryBytes: 4519 * 1024 ** 2,
  socModel: "SM8550",
  socManufacturer: null,
} as DeviceProfile;

describe("governor plan log", () => {
  test("records both lane prices and the selected repack decision", () => {
    const model = MODEL_REGISTRY.find((entry) => entry.id === "lfm2.5-2.6b")!;
    const memory = {
      availableMemoryBytes: 4519 * 1024 ** 2,
      totalMemoryBytes: 8 * 1024 ** 3,
      contextTokens: 8192,
      ubatch: 256,
      mmap: true,
      offloadedBytes: model.sizeBytes,
    };
    const governor = buildGovernorParams(model, s23, memory);

    expect(buildGovernorPlanLog(model, memory, governor, undefined)).toEqual({
      gpu_fit: "Fit",
      decode_repack: true,
      required_mib_with_repack: 4518.12,
      required_mib_without_repack: 2998.06,
      available_mib: 4519,
      bench_norepack_forced: null,
    });
    expect(
      buildGovernorPlanLog(
        model,
        memory,
        buildGovernorParams(model, s23, memory, false, true),
        true,
      ).bench_norepack_forced,
    ).toBe(true);
    expect(
      buildGovernorPlanLog(
        model,
        memory,
        buildGovernorParams(model, s23, memory, false, false),
        false,
      ).bench_norepack_forced,
    ).toBe(false);
  });

  test("records a computed NoFit plan even when GPU prefill is forced", () => {
    const model = MODEL_REGISTRY.find((entry) => entry.id === "lfm2.5-2.6b")!;
    const memory = {
      availableMemoryBytes: 2997 * 1024 ** 2,
      totalMemoryBytes: 8 * 1024 ** 3,
      contextTokens: 8192,
      ubatch: 256,
      mmap: true,
      offloadedBytes: model.sizeBytes,
    };
    const governor = buildGovernorParams(model, s23, memory, true);

    expect(governor).toMatchObject({ enabled: true, gpu_fit: "NoFit" });
    expect(buildGovernorPlanLog(model, memory, governor, undefined)).toMatchObject({
      gpu_fit: "NoFit",
      available_mib: 2997,
    });
  });
});
