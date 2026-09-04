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
    },
  },
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import { NativeModules } from "react-native";
import type { DeviceProfile } from "./deviceProfile";
import {
  buildGovernorParams,
  readGovernorThermo,
} from "./governorInputs";

const device = (modelName: string, totalMemoryBytes = 12 * 1024 ** 3) =>
  ({
    modelName,
    modelId: null,
    manufacturer: "Qualcomm",
    totalMemoryBytes,
    availableMemoryBytes: 8 * 1024 ** 3,
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
    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  });

  test("maps the documented board and registry metadata", () => {
    expect(buildGovernorParams(model, device("QRD8650"), memory)).toEqual({
      enabled: true,
      generation: "V75",
      model_kind: "Hybrid",
      gpu_fit: "Fit",
      npu_lane_enabled: false,
      reload_budget_available: false,
    });
    expect(buildGovernorParams(model, device("unlisted"), memory).generation).toBe(
      "Unknown",
    );
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

  test("refuses unknown KV and 8 GiB devices", () => {
    expect(
      buildGovernorParams({ sizeBytes: model.sizeBytes }, device("SM8650"), memory).gpu_fit,
    ).toBe("NoFit");
    expect(
      buildGovernorParams(model, device("SM8650", 8 * 1024 ** 3), memory).gpu_fit,
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

  test("plugged battery data without idle calibration is invalid", async () => {
    (NativeModules.GovernorBattery.readThermo as jest.Mock).mockResolvedValue({
      battTempTenthsC: 320,
      battLevelPct: 90,
      plugged: true,
      sensorValid: true,
    });
    await expect(readGovernorThermo()).resolves.toMatchObject({
      sensor_valid: false,
      thermo_source: "battery",
    });
  });
});
