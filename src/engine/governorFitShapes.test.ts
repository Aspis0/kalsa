jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null) },
}));

jest.mock("react-native", () => ({ NativeModules: {} }));

jest.mock("../../modules/kalsa-thermal/src", () => ({
  addPlatformThermalListener: jest.fn(),
  getCurrentPlatformThermalState: jest.fn(async () => null),
  isPlatformThermalModuleAvailable: jest.fn(() => false),
}));

import type { DeviceProfile } from "./deviceProfile";
import { MODEL_REGISTRY } from "./ModelRegistry";
import { buildGovernorParams } from "./governorInputs";

// The GPU fit's boundary moves with the shape: the old price counted compute
// and KV twice, the fixed price counts them once and adds the 300 MiB margin,
// so against the old price the threshold moves by 300 − (compute + KV). Each
// shape below pins the exact integer boundary on both sides of the new price.
const MIB = 1024 * 1024;
const lfm = MODEL_REGISTRY.find((entry) => entry.id === "lfm2.5-2.6b")!;
const phone = { modelName: "unlisted", modelId: null, manufacturer: "Qualcomm", totalMemoryBytes: 12 * 1024 ** 3, availableMemoryBytes: null, socModel: null, socManufacturer: null, osName: "Android" } as DeviceProfile;

// 1.05·W = 1.05 × 1593894944 / MIB = 1596.0595 (W = 1520.0567 MiB, the GGUF file).
const gpuFitAt = (availableMiB: number, contextTokens: number, ubatch: number) =>
  buildGovernorParams(lfm, phone, {
    availableMemoryBytes: availableMiB * MIB,
    totalMemoryBytes: 12 * 1024 ** 3,
    contextTokens,
    ubatch,
    mmap: true,
    offloadedBytes: lfm.sizeBytes,
  }).gpu_fit;

describe("GPU fit boundary at a second shape", () => {
  test("ctx 16384, ubatch 256: fits at 3050, not at 3049", () => {
    // compute 249 (ubatch 256) + KV 104 (6656 B × 16384 / MIB) + 800 + 1596.0595
    // + 300 margin = 3049.0595 MiB. 300 − (249 + 104) = −53 against the old price.
    expect(gpuFitAt(3049, 16384, 256)).toBe("NoFit");
    expect(gpuFitAt(3050, 16384, 256)).toBe("Fit");
  });

  test("ctx 8192, ubatch 512: fits at 3247, not at 3246", () => {
    // compute 498 (249 × 512 / 256) + KV 52 + 800 + 1596.0595 + 300 margin
    // = 3246.0595 MiB. 300 − (498 + 52) = −250 against the old price.
    expect(gpuFitAt(3246, 8192, 512)).toBe("NoFit");
    expect(gpuFitAt(3247, 8192, 512)).toBe("Fit");
  });
});
