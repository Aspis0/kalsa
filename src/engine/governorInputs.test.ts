jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null) },
}));

jest.mock("react-native", () => ({
  NativeModules: {
    GovernorBattery: {
      readThermo: jest.fn(async () => ({
        battTempTenthsC: 320,
        battLevelPct: 80,
        plugged: false,
        sensorValid: true,
      })),
      readSoc: jest.fn(async () => ({ socModel: null, socManufacturer: null })),
    },
  },
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import { NativeModules } from "react-native";
import type { DeviceProfile } from "./deviceProfile";
import { MODEL_REGISTRY } from "./ModelRegistry";
import {
  buildGovernorParams,
  readBenchGovernorForce,
  readGovernorThermo,
} from "./governorInputs";

const device = (
  modelName: string,
  totalMemoryBytes = 12 * 1024 ** 3,
  socModel: string | null = null,
) =>
  ({
    modelName,
    modelId: null,
    manufacturer: "Qualcomm",
    totalMemoryBytes,
    availableMemoryBytes: 8 * 1024 ** 3,
    socModel,
    socManufacturer: null,
  } as DeviceProfile);

const model = {
  sizeBytes: 100 * 1024 ** 2,
  kvBytesPerToken: 1024,
  hybrid: true,
};

const memory = {
  availableMemoryBytes: 8 * 1024 ** 3,
  totalMemoryBytes: 12 * 1024 ** 3,
  contextTokens: 4096,
  ubatch: 256,
};

describe("governor inputs", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockReset();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (NativeModules.GovernorBattery.readThermo as jest.Mock).mockReset();
    (NativeModules.GovernorBattery.readThermo as jest.Mock).mockResolvedValue({
      battTempTenthsC: 320,
      battLevelPct: 80,
      plugged: false,
      sensorValid: true,
    });
  });

  test("disables the incorrect V75 GPU-prefill route", () => {
    expect(buildGovernorParams(model, device("QRD8650"), memory)).toEqual({
      enabled: false,
      generation: "V75",
      model_kind: "Hybrid",
      gpu_fit: "Fit",
      gpu_prefill_measured: true,
      bench_force_gpu_prefill: false,
      npu_lane_enabled: false,
      reload_budget_available: false,
      forced: false,
      reason: "gpu-prefill-incorrect-V75",
    });
    expect(buildGovernorParams(model, device("unlisted"), memory).generation).toBe(
      "Unknown",
    );
    expect(buildGovernorParams(model, device("unlisted"), memory).gpu_prefill_measured).toBe(
      false,
    );
    expect(buildGovernorParams(model, device("unlisted"), memory).gpu_fit).toBe("NoFit");
    expect(
      buildGovernorParams(
        model,
        device("Pineapple for arm64", 12 * 1024 ** 3, "SM8650"),
        memory,
      ),
    ).toMatchObject({
      enabled: false,
      generation: "V75",
      gpu_fit: "Fit",
      gpu_prefill_measured: true,
      reason: "gpu-prefill-incorrect-V75",
    });
    expect(buildGovernorParams(model, device("SM8550"), memory)).toMatchObject({
      enabled: false,
      generation: "V73",
      gpu_prefill_measured: false,
      reason: "gpu-prefill-incorrect-V73",
    });
    expect(
      buildGovernorParams(
        { ...model, hybrid: false, canStreamExperts: true },
        device("SM8750"),
        memory,
      ).model_kind,
    ).toBe("MoE");
    expect(
      buildGovernorParams({ ...model, hybrid: false, kvUnified: false }, device("SM8750"), memory)
        .model_kind,
    ).toBe("Dense");
  });

  test("maps V73 variants and wires the bench GPU-prefill force", () => {
    expect(buildGovernorParams(model, device("SM7675"), memory)).toMatchObject({
      generation: "V73",
      bench_force_gpu_prefill: false,
      enabled: false,
      reason: "gpu-prefill-incorrect-V73",
    });
    expect(buildGovernorParams(model, device("SM8635"), memory).generation).toBe("V73");
    expect(buildGovernorParams(model, device("QRD7675"), memory).generation).toBe("V73");
    expect(
      buildGovernorParams(model, device("unlisted", 12 * 1024 ** 3, "SM9999"), memory).generation,
    ).toBe(
      "Unknown",
    );
    expect(buildGovernorParams(model, device("SM7675"), memory, true)).toMatchObject({
      generation: "V73",
      bench_force_gpu_prefill: true,
      enabled: true,
    });
    expect(buildGovernorParams(model, device("SM7675"), memory, false)).toMatchObject({
      generation: "V73",
      bench_force_gpu_prefill: false,
      enabled: false,
      reason: "gpu-prefill-incorrect-V73",
    });
  });

  test("keeps V79 enabled and permits an explicit V75 bench override", async () => {
    expect(buildGovernorParams(model, device("SM8750"), memory)).toMatchObject({
      enabled: true,
      generation: "V79",
      forced: false,
    });
    for (const value of [null, "garbage", "0"]) {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(value);
      await expect(readBenchGovernorForce()).resolves.toBe(false);
    }
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue("1");
    await expect(readBenchGovernorForce()).resolves.toBe(true);
    expect(buildGovernorParams(model, device("QRD8650"), memory, true)).toMatchObject({
      enabled: true,
      generation: "V75",
      forced: true,
    });
  });

  test("refuses unknown KV and 8 GiB devices", () => {
    expect(
      buildGovernorParams({ sizeBytes: model.sizeBytes }, device("SM8650"), memory).gpu_fit,
    ).toBe("NoFit");
    expect(
      buildGovernorParams(model, device("SM8650", 8 * 1024 ** 3), memory).gpu_fit,
    ).toBe("NoFit");
  });

  test("prices two contexts with the measured LFM KV", () => {
    const lfm = MODEL_REGISTRY.find((entry) => entry.id === "lfm2.5-2.6b");
    expect(lfm?.kvBytesPerToken).toBe(6656);
    expect(
      buildGovernorParams(
        lfm!,
        device("QRD8650", 12 * 1024 ** 3),
        { ...memory, contextTokens: 16384 },
      ).gpu_fit,
    ).toBe("Fit");
    expect(
      buildGovernorParams(lfm!, device("QRD8650", 8 * 1024 ** 3), memory).gpu_fit,
    ).toBe("NoFit");
  });

  test("bench thermo wins over BatteryManager", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify({
        batt_temp_tenths_c: 410,
        batt_level_pct: 55,
        plugged: true,
        sensor_valid: true,
        t_idle_valid: true,
        t_idle_c: 35,
      }),
    );
    await expect(readGovernorThermo()).resolves.toMatchObject({
      batt_temp_tenths_c: 410,
      sensor_valid: true,
      t_idle_valid: true,
      t_idle_c: 35,
      thermo_source: "bench-skin",
    });
    expect(NativeModules.GovernorBattery.readThermo).not.toHaveBeenCalled();
  });

  test("invalid battery temperature is not made up", async () => {
    (NativeModules.GovernorBattery.readThermo as jest.Mock).mockResolvedValue({
      battTempTenthsC: 0,
      battLevelPct: 90,
      plugged: false,
      sensorValid: false,
    });
    await expect(readGovernorThermo()).resolves.toMatchObject({
      sensor_valid: false,
      thermo_source: "battery",
    });
  });

  test("forwards plugged source validity without a JS idle gate", async () => {
    (NativeModules.GovernorBattery.readThermo as jest.Mock).mockResolvedValue({
      battTempTenthsC: 320,
      battLevelPct: 90,
      plugged: true,
      sensorValid: true,
    });
    await expect(readGovernorThermo()).resolves.toMatchObject({
      sensor_valid: true,
      thermo_source: "battery",
    });
  });
});
