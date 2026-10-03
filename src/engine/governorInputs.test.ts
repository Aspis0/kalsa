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

jest.mock("../../modules/kalsa-thermal/src", () => ({
  addPlatformThermalListener: jest.fn(),
  getCurrentPlatformThermalState: jest.fn(async () => null),
  isPlatformThermalModuleAvailable: jest.fn(() => false),
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import { NativeModules } from "react-native";
import { getCurrentPlatformThermalState } from "../../modules/kalsa-thermal/src";
import type { DeviceProfile } from "./deviceProfile";
import { MODEL_REGISTRY } from "./ModelRegistry";
import { modelAtKvProfile } from "./kvQuantCost";
import { effectiveCacheTypes } from "./engineParams";
import {
  buildGovernorParams,
  npuLaneCacheTypes,
  readBenchGovernorForce,
  readBenchNpuLane,
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

  test("enables the V75 GPU-prefill route", () => {
    expect(buildGovernorParams(model, device("QRD8650"), memory)).toEqual({
      enabled: true,
      generation: "V75",
      model_kind: "Hybrid",
      gpu_fit: "Fit",
      decode_repack: true,
      gpu_prefill_measured: true,
      bench_force_gpu_prefill: false,
      npu_lane_enabled: false,
      npu_fit: "Fit",
      htp_trunk_readable: false,
      htp_experts_readable: false,
      npu_device: null,
      npu_fallback: null,
      reload_budget_available: false,
      forced: false,
    });
    expect(buildGovernorParams(model, device("unlisted"), memory).generation).toBe(
      "Unknown",
    );
    expect(buildGovernorParams(model, device("unlisted"), memory).gpu_prefill_measured).toBe(
      false,
    );
    // laneFit prices memory only: an Unknown SoC with no lane inputs still
    // prices its GPU lane (Fit here) — the refusal lives in
    // GPU_PREFILL_CORRECT, so `enabled` stays false and Android lands on CPU.
    expect(buildGovernorParams(model, device("unlisted"), memory).gpu_fit).toBe("Fit");
    expect(
      buildGovernorParams(
        model,
        device("Pineapple for arm64", 12 * 1024 ** 3, "SM8650"),
        memory,
      ),
    ).toMatchObject({
      enabled: true,
      generation: "V75",
      gpu_fit: "Fit",
      gpu_prefill_measured: true,
    });
    expect(buildGovernorParams(model, device("SM8550"), memory)).toMatchObject({
      enabled: true,
      generation: "V73",
      gpu_prefill_measured: true,
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
      enabled: true,
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
      enabled: true,
    });
  });

  test("maps the Snapdragon 8 Elite Gen 5 (SM8850/Canoe) to V81, GPU prefill unmeasured", () => {
    expect(buildGovernorParams(model, device("unlisted", 12 * 1024 ** 3, "SM8850"), memory)).toMatchObject({
      generation: "V81",
      enabled: false,
      gpu_prefill_measured: false,
    });
    // QDC device logs: board.platform=canoe, product.model=Canoe.
    expect(buildGovernorParams(model, device("unlisted", 12 * 1024 ** 3, "canoe"), memory).generation).toBe("V81");
    expect(buildGovernorParams(model, device("QRD8850"), memory).generation).toBe("V81");
    expect(buildGovernorParams(model, device("SM8850 board"), memory).generation).toBe("V81");
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

  test("refuses unknown KV and no longer gates on total RAM", () => {
    expect(
      buildGovernorParams({ sizeBytes: model.sizeBytes }, device("SM8650"), memory).gpu_fit,
    ).toBe("NoFit");
    // Total RAM is not a gate; the memory estimate against availableMemoryBytes decides.
    expect(
      buildGovernorParams(model, device("SM8650", 8 * 1024 ** 3), memory).gpu_fit,
    ).toBe("Fit");
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
    ).toBe("Fit");
  });

  test("the lane fits at its repack-free requirement, not the repack-priced one", () => {
    const lfm = MODEL_REGISTRY.find((entry) => entry.id === "lfm2.5-2.6b");
    expect(lfm).not.toBeNull();
    const s23 = device("SM-S911U", 8 * 1024 ** 3, "SM8550");
    const laneAt = (availableBytes: number) => ({
      ...memory,
      contextTokens: 8192,
      mmap: true,
      availableMemoryBytes: availableBytes,
    });
    // The binding forces no_extra_bufts on the governor decode model
    // (llama.rn-kalsa cpp/rn-llama.cpp load_governor_models), so the lane
    // never allocates the CPU repack copy: its budget is
    // 800 + 1.05·W + 2×compute@256 + 2×KV = 2998.06 MiB for LFM 2.6B at
    // ctx 8192. Pricing the repack copy back in at 1.0×W (4518.12 MiB)
    // flips Fit to NoFit.
    expect(buildGovernorParams(lfm!, s23, laneAt(2999 * 1024 ** 2)).gpu_fit).toBe("Fit");
    // One MiB below the requirement flips — the pin is the exact number.
    expect(buildGovernorParams(lfm!, s23, laneAt(2997 * 1024 ** 2)).gpu_fit).toBe("NoFit");
  });

  test("prices the lane with repack first and drops repack only when that is what fits", () => {
    const lfm = MODEL_REGISTRY.find((entry) => entry.id === "lfm2.5-2.6b")!;
    const s23 = device("SM-S911U", 8 * 1024 ** 3, "SM8550");
    const laneAt = (availableMiB: number) => ({
      ...memory,
      contextTokens: 8192,
      mmap: true,
      availableMemoryBytes: availableMiB * 1024 ** 2,
    });
    // Repack-priced requirement 4518.12 MiB (2998.06 repack-free + 1520.06
    // for a conservative 1.0×W copy): at/above it the lane keeps the repack
    // copy (decode_repack true — upstream default, full decode speed and
    // KLD). One MiB below, repack is dropped only to keep the lane alive.
    expect(buildGovernorParams(lfm, s23, laneAt(4519))).toMatchObject({
      gpu_fit: "Fit",
      decode_repack: true,
    });
    expect(buildGovernorParams(lfm, s23, laneAt(4518))).toMatchObject({
      gpu_fit: "Fit",
      decode_repack: false,
    });
    expect(buildGovernorParams(lfm, s23, laneAt(2999))).toMatchObject({
      gpu_fit: "Fit",
      decode_repack: false,
    });
    // Repack-free requirement is 2998.06 MiB: one MiB below, neither price
    // fits — NoFit, the lane is refused rather than shrunk silently.
    expect(buildGovernorParams(lfm, s23, laneAt(2998)).gpu_fit).toBe("NoFit");
    expect(buildGovernorParams(lfm, s23, laneAt(2997)).gpu_fit).toBe("NoFit");
  });

  test("kalsa.bench.norepack outranks the fit decision", () => {
    const lfm = MODEL_REGISTRY.find((entry) => entry.id === "lfm2.5-2.6b")!;
    const s23 = device("SM-S911U", 8 * 1024 ** 3, "SM8550");
    const laneAt = (availableMiB: number) => ({
      ...memory,
      contextTokens: 8192,
      mmap: true,
      availableMemoryBytes: availableMiB * 1024 ** 2,
    });
    // "1" (no-repack arm): the with-repack attempt is skipped entirely —
    // the arm measures no-repack even where repack would fit.
    expect(
      buildGovernorParams(lfm, s23, laneAt(4519), false, true),
    ).toMatchObject({ gpu_fit: "Fit", decode_repack: false });
    // "0" (repack-on arm): no P1 fallback — where repack does not fit the
    // lane is refused instead of silently measuring the other configuration.
    expect(
      buildGovernorParams(lfm, s23, laneAt(4519), false, false),
    ).toMatchObject({ gpu_fit: "Fit", decode_repack: true });
    expect(
      buildGovernorParams(lfm, s23, laneAt(4359), false, false).gpu_fit,
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

  test("lifts the native plugged temperature from tenths to degrees", async () => {
    (NativeModules.GovernorBattery.readThermo as jest.Mock).mockResolvedValue({
      battTempTenthsC: 370,
      battLevelPct: 90,
      plugged: true,
      sensorValid: true,
      t_idle_valid: true,
      t_idle_tenths_c: 350,
    });
    // The engine reads t_idle_c in degrees C and offsets its plugged warm/cool
    // lines from it; a tenths value here would read 350 "degrees".
    await expect(readGovernorThermo()).resolves.toMatchObject({
      sensor_valid: true,
      plugged: true,
      t_idle_valid: true,
      t_idle_c: 35,
      thermo_source: "battery",
    });
  });

  // CHANGED DELIBERATELY: the app-side gate (idle > 0 && idle + 1 < 42) was
  // removed by the policy consolidation. This test used to assert the app
  // refused 350; the app now forwards raw and the engine's profile_is_valid
  // is the only refusal (llama-governor-policy.cpp).
  test("forwards an out-of-range plugged baseline unchanged", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify({
        batt_temp_tenths_c: 350,
        batt_level_pct: 80,
        plugged: true,
        sensor_valid: true,
        t_idle_valid: true,
        t_idle_c: 350,
      }),
    );
    await expect(readGovernorThermo()).resolves.toMatchObject({
      plugged: true,
      t_idle_valid: true,
      t_idle_c: 350,
      thermo_source: "bench-skin",
    });
  });

  // Exact disagreement case: the removed app rule refused idle = 0 through
  // `idle > 0`, the engine rule accepts it through `t_idle_c + 1 < 42`.
  // The engine decides; the app must forward 0 untouched.
  test("forwards a zero plugged baseline for the engine to judge", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify({
        batt_temp_tenths_c: 300,
        batt_level_pct: 80,
        plugged: true,
        sensor_valid: true,
        t_idle_valid: true,
        t_idle_c: 0,
      }),
    );
    await expect(readGovernorThermo()).resolves.toMatchObject({
      plugged: true,
      t_idle_valid: true,
      t_idle_c: 0,
      thermo_source: "bench-skin",
    });
  });

  test("NPU lane eligibility: the auto gates are android + runtime arch >= 73 + vision + kind + fit", () => {
    const inputs = { android: true, hasMmproj: false, lanePref: "auto" as const, htpArch: 73 };
    // S23 (SM8550 -> V73), hybrid, 8 GiB free, kalsa.bench.npu_lane=auto:
    // eligible, HTP0 claimed.
    expect(
      buildGovernorParams(model, device("SM8550"), memory, false, undefined, inputs),
    ).toMatchObject({
      npu_lane_enabled: true,
      npu_fit: "Fit",
      npu_device: "HTP0",
      htp_trunk_readable: true,
      htp_experts_readable: false,
    });
    // The owner's daily phone profile (Jelly, Helio G99): no HTP device
    // registered (no skel ships for its DSP), so the runtime arch is null
    // and auto stays off.
    expect(
      buildGovernorParams(model, device("Jelly Star"), memory, false, undefined, {
        ...inputs,
        htpArch: null,
      }).npu_lane_enabled,
    ).toBe(false);
    // Platform is hard: never on a non-Android host, not even forced on.
    expect(
      buildGovernorParams(model, device("SM8550"), memory, false, undefined, {
        ...inputs,
        android: false,
      }).npu_lane_enabled,
    ).toBe(false);
    // Vision restates the LlamaService governorLoad gate: mmproj never claims it.
    expect(
      buildGovernorParams(model, device("SM8550"), memory, false, undefined, {
        ...inputs,
        hasMmproj: true,
      }).npu_lane_enabled,
    ).toBe(false);
    // No runtime arch below v73 takes the lane.
    expect(
      buildGovernorParams(model, device("SM8550"), memory, false, undefined, {
        ...inputs,
        htpArch: 69,
      }).npu_lane_enabled,
    ).toBe(false);
    // MoE never claims it: no expert-readability signal in the app.
    expect(
      buildGovernorParams(
        { ...model, hybrid: false, canStreamExperts: true },
        device("SM8550"),
        memory,
        false,
        undefined,
        inputs,
      ).npu_lane_enabled,
    ).toBe(false);
    // Memory fit with the +219 MiB HTP copy: 100 MiB free fits neither
    // lane (the ship model's own boundary lives in governorPlanLog.test).
    const tight = { ...memory, availableMemoryBytes: 100 * 1024 ** 2 };
    expect(
      buildGovernorParams(model, device("SM8550"), tight, false, undefined, inputs),
    ).toMatchObject({ npu_lane_enabled: false, npu_fit: "NoFit" });
  });

  test("an absent lane pref is auto, the gated default since the owner's 2026-10-02 decision", () => {
    // No bench key at all, perfect hardware: the lane claims HTP0.
    expect(
      buildGovernorParams(model, device("SM8550"), memory, false, undefined, {
        android: true,
        hasMmproj: false,
        htpArch: 73,
      }),
    ).toMatchObject({
      npu_lane_enabled: true,
      npu_fit: "Fit",
      npu_device: "HTP0",
      htp_trunk_readable: true,
      htp_experts_readable: false,
    });
    const absent = { android: true, hasMmproj: false, htpArch: 73 as const };
    // Vision restates the LlamaService governorLoad gate: mmproj never claims it.
    expect(
      buildGovernorParams(model, device("SM8550"), memory, false, undefined, {
        ...absent,
        hasMmproj: true,
      }).npu_lane_enabled,
    ).toBe(false);
    // MoE never claims it: no expert-readability signal in the app.
    expect(
      buildGovernorParams(
        { ...model, hybrid: false, canStreamExperts: true },
        device("SM8550"),
        memory,
        false,
        undefined,
        absent,
      ).npu_lane_enabled,
    ).toBe(false);
    // No registered HTP device (htpArch null) keeps auto off.
    expect(
      buildGovernorParams(model, device("unlisted"), memory, false, undefined, {
        ...absent,
        htpArch: null,
      }).npu_lane_enabled,
    ).toBe(false);
    // Memory fit with the +219 MiB HTP copy: 100 MiB free fits neither lane.
    const tight = { ...memory, availableMemoryBytes: 100 * 1024 ** 2 };
    expect(
      buildGovernorParams(model, device("SM8550"), tight, false, undefined, absent),
    ).toMatchObject({ npu_lane_enabled: false, npu_fit: "NoFit" });
    // "off" stays the one pref that declines the lane outright.
    expect(
      buildGovernorParams(model, device("SM8550"), memory, false, undefined, {
        ...absent,
        lanePref: "off" as const,
      }).npu_lane_enabled,
    ).toBe(false);
  });

  test("bench pref kalsa.bench.npu_lane picks off, auto and on", () => {
    const inputs = { android: true, hasMmproj: false, htpArch: 73 as const };
    expect(
      buildGovernorParams(model, device("SM8550"), memory, false, undefined, {
        ...inputs,
        lanePref: "auto",
      }).npu_lane_enabled,
    ).toBe(true);
    expect(
      buildGovernorParams(model, device("SM8550"), memory, false, undefined, {
        ...inputs,
        lanePref: "off",
      }).npu_lane_enabled,
    ).toBe(false);
    // Forced on bypasses the auto gates only (arch/kind): fit, platform and
    // vision stay hard, and the engine still degrades to GPU when HTP0 is
    // absent. MoE is the visible bypass: auto refuses it, "on" takes it —
    // with no runtime arch read at all (htpArch null).
    expect(
      buildGovernorParams(
        { ...model, hybrid: false, canStreamExperts: true },
        device("SM8550"),
        memory,
        false,
        undefined,
        { ...inputs, htpArch: null, lanePref: "on" },
      ).npu_lane_enabled,
    ).toBe(true);
    // An unpriced SoC takes the lane when "on" asks for it: laneFit prices
    // memory only, and the engine policy turns the lane off when its HTP
    // device does not resolve at load.
    expect(
      buildGovernorParams(model, device("unlisted"), memory, false, undefined, {
        ...inputs,
        htpArch: null,
        lanePref: "on",
      }).npu_lane_enabled,
    ).toBe(true);
    expect(
      buildGovernorParams(model, device("SM8550"), memory, false, undefined, {
        ...inputs,
        android: false,
        lanePref: "on",
      }).npu_lane_enabled,
    ).toBe(false);
    expect(
      buildGovernorParams(model, device("SM8550"), memory, false, undefined, {
        ...inputs,
        hasMmproj: true,
        lanePref: "on",
      }).npu_lane_enabled,
    ).toBe(false);
  });

  test("V81 with a registered v81 HTP device runs the lane, and the governor with it", () => {
    const inputs = { android: true, hasMmproj: false, lanePref: "auto" as const, htpArch: 81 };
    expect(
      buildGovernorParams(model, device("unlisted", 12 * 1024 ** 3, "SM8850"), memory, false, undefined, inputs),
    ).toMatchObject({
      enabled: true,
      generation: "V81",
      npu_lane_enabled: true,
      npu_device: "HTP0",
      // The flip GPU_PREFILL_CORRECT.V81 awaits its oracle PASS: the lane
      // load carries prefill on HTP0, decode on CPU, GPU prefill unmeasured.
      gpu_prefill_measured: false,
    });
  });

  test("V81 with no runtime HTP arch stays off with its correctness reason", () => {
    const out = buildGovernorParams(model, device("unlisted", 12 * 1024 ** 3, "SM8850"), memory, false, undefined, {
      android: true,
      hasMmproj: false,
      lanePref: "auto",
      htpArch: null,
    });
    expect(out.enabled).toBe(false);
    expect(out.reason).toBe("gpu-prefill-incorrect-V81");
  });

  test("an Unknown generation with a registered v79 HTP device still takes the lane", () => {
    const out = buildGovernorParams(model, device("unlisted"), memory, false, undefined, {
      android: true,
      hasMmproj: false,
      lanePref: "auto",
      htpArch: 79,
    });
    expect(out).toMatchObject({
      enabled: true,
      generation: "Unknown",
      npu_lane_enabled: true,
      gpu_prefill_measured: false,
    });
  });

  test("readBenchNpuLane parses off/on and ignores anything else", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce("off");
    await expect(readBenchNpuLane()).resolves.toBe("off");
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce("on");
    await expect(readBenchNpuLane()).resolves.toBe("on");
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce("auto");
    await expect(readBenchNpuLane()).resolves.toBe("auto");
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce("1");
    await expect(readBenchNpuLane()).resolves.toBeUndefined();
  });

  test("npuLaneCacheTypes upgrades HTP-unwritable types to q8_0 unless flash attention is off", () => {
    // The catalog profile: V q4_0 is not HTP-writable, so the lane runs q8_0.
    expect(npuLaneCacheTypes("q8_0", "q4_0")).toEqual({ k: "q8_0", v: "q8_0" });
    // Already-writable types pass through on both sides.
    expect(npuLaneCacheTypes("f16", "q8_0")).toEqual({ k: "f16", v: "q8_0" });
    expect(npuLaneCacheTypes("f32", "f32")).toEqual({ k: "f32", v: "f32" });
    // Flash attention explicitly off: the binding leaves the caller types.
    expect(npuLaneCacheTypes("q8_0", "q4_0", true)).toEqual({ k: "q8_0", v: "q4_0" });
    // Unknown type names have no HTP writer either — they ride the same
    // upgrade (the shipped catalog only carries f16/q8_0/q4_0).
    expect(npuLaneCacheTypes("bf16", "bf16")).toEqual({ k: "q8_0", v: "q8_0" });
  });

  test("the lane fit prices LFM at the upgraded 8704 B/token, not the catalog 6656", () => {
    const lfm = MODEL_REGISTRY.find((entry) => entry.id === "lfm2.5-2.6b")!;
    const s23 = device("SM-S911U", 8 * 1024 ** 3, "SM8550");
    const laneKv = npuLaneCacheTypes("q8_0", "q4_0");
    const laneModel = modelAtKvProfile(lfm, laneKv.k, laneKv.v);
    expect(laneModel.kvBytesPerToken).toBe(8704);
    const laneAt = (availableMiB: number) => ({
      ...memory,
      contextTokens: 8192,
      mmap: true,
      availableMemoryBytes: availableMiB * 1024 ** 2,
    });
    const inputs = {
      android: true,
      hasMmproj: false,
      lanePref: "auto" as const,
      laneModel,
      htpArch: 73,
    };
    // Lane requirement with the upgraded KV: 3030.06 MiB repack-free + 219
    // HTP prefill copy = 3249.06 MiB (catalog KV would need 3217.06). One MiB
    // below the upgraded boundary the lane refuses where the caller-profile
    // price would still have passed; one above it claims HTP0.
    expect(
      buildGovernorParams(lfm, s23, laneAt(3249), false, undefined, inputs),
    ).toMatchObject({ npu_fit: "NoFit", npu_lane_enabled: false });
    expect(
      buildGovernorParams(lfm, s23, laneAt(3250), false, undefined, inputs),
    ).toMatchObject({ npu_fit: "Fit", npu_lane_enabled: true, npu_device: "HTP0" });
  });

  test("flash attention off prices the lane at the engine-forced f16 V", () => {
    const lfm = MODEL_REGISTRY.find((entry) => entry.id === "lfm2.5-2.6b")!;
    const s23 = device("SM-S911U", 8 * 1024 ** 3, "SM8550");
    // The LlamaService composition: effective types first (the override path
    // forces V to f16 when FA is off — a quantized V cannot init), then the
    // binding rule, which leaves the writable f16 alone. Catalog q4_0 V is
    // never what the context holds.
    const effective = effectiveCacheTypes("q8_0", "q4_0", { flashAttn: "off" });
    expect(effective).toEqual({ k: "q8_0", v: "f16" });
    const laneModel = modelAtKvProfile(lfm, effective.k, effective.v);
    expect(laneModel.kvBytesPerToken).toBe(12544);
    const laneAt = (availableMiB: number) => ({
      ...memory,
      contextTokens: 8192,
      mmap: true,
      availableMemoryBytes: availableMiB * 1024 ** 2,
    });
    const inputs = {
      android: true,
      hasMmproj: false,
      lanePref: "auto" as const,
      laneModel,
      htpArch: 73,
    };
    // 3249 MiB admitted the pre-fix caller-profile price (3217.06 MiB) — a
    // false Fit: the f16 V the engine really holds prices 3090.06 + 219 HTP
    // copy = 3309.06 MiB. Refused one MiB below, claimed one above.
    expect(
      buildGovernorParams(lfm, s23, laneAt(3309), false, undefined, inputs),
    ).toMatchObject({ npu_fit: "NoFit", npu_lane_enabled: false });
    expect(
      buildGovernorParams(lfm, s23, laneAt(3310), false, undefined, inputs),
    ).toMatchObject({ npu_fit: "Fit", npu_lane_enabled: true, npu_device: "HTP0" });
  });

  test("an \"off\" lane ignores the lane-priced model (7ddf39ad byte-identical)", () => {
    const lfm = MODEL_REGISTRY.find((entry) => entry.id === "lfm2.5-2.6b")!;
    const s23 = device("SM-S911U", 8 * 1024 ** 3, "SM8550");
    const laneModel = modelAtKvProfile(lfm, "q8_0", "q8_0");
    const laneAt = (availableMiB: number) => ({
      ...memory,
      contextTokens: 8192,
      mmap: true,
      availableMemoryBytes: availableMiB * 1024 ** 2,
    });
    // At 3249 MiB the two prices disagree: the entry's own caller profile
    // needs 3217.06 MiB (Fit), the upgraded KV 3249.06 (NoFit). An "off" lane
    // must report the pre-lane price, so the whole plan equals a load whose
    // inputs never carried a laneModel.
    const laneOff = { android: true, hasMmproj: false, lanePref: "off" as const, htpArch: null };
    const baseline = buildGovernorParams(lfm, s23, laneAt(3249), false, undefined, laneOff);
    expect(
      buildGovernorParams(lfm, s23, laneAt(3249), false, undefined, {
        ...laneOff,
        laneModel,
      }),
    ).toEqual(baseline);
    // The baseline itself is the discriminating Fit: had the re-price leaked
    // into a lane-off load, npu_fit would read NoFit here.
    expect(baseline.npu_fit).toBe("Fit");
    // The absent pref requests the lane, so the same lane model re-prices and
    // flips this verdict.
    expect(
      buildGovernorParams(lfm, s23, laneAt(3249), false, undefined, {
        android: true,
        hasMmproj: false,
        laneModel,
        htpArch: 73,
      }),
    ).toMatchObject({ npu_fit: "NoFit", npu_lane_enabled: false });
  });

  test("the lane-priced KV never moves the GPU lane estimate", () => {
    const lfm = MODEL_REGISTRY.find((entry) => entry.id === "lfm2.5-2.6b")!;
    const s23 = device("SM-S911U", 8 * 1024 ** 3, "SM8550");
    const laneKv = npuLaneCacheTypes("q8_0", "q4_0");
    const laneModel = modelAtKvProfile(lfm, laneKv.k, laneKv.v);
    const laneAt = (availableMiB: number) => ({
      ...memory,
      contextTokens: 8192,
      mmap: true,
      availableMemoryBytes: availableMiB * 1024 ** 2,
    });
    // The load's own estimate stays at the caller profile even with a
    // lane-priced model in the inputs: the repack-free boundaries
    // (2998.06 MiB) hold byte-identically.
    const inputs = { android: true, hasMmproj: false, laneModel, htpArch: null };
    expect(
      buildGovernorParams(lfm, s23, laneAt(2999), false, undefined, inputs).gpu_fit,
    ).toBe("Fit");
    expect(
      buildGovernorParams(lfm, s23, laneAt(2997), false, undefined, inputs).gpu_fit,
    ).toBe("NoFit");
  });

  test("keeps an unplugged poll without an idle reference valid", async () => {
    (NativeModules.GovernorBattery.readThermo as jest.Mock).mockResolvedValue({
      battTempTenthsC: 320,
      battLevelPct: 90,
      plugged: false,
      sensorValid: true,
    });
    await expect(readGovernorThermo()).resolves.toMatchObject({
      sensor_valid: true,
      plugged: false,
      thermo_source: "battery",
    });
  });
});

describe("platform_thermal_status in the thermo feed", () => {
  const batteryPoll = {
    battTempTenthsC: 320,
    battLevelPct: 80,
    plugged: false,
    sensorValid: true,
  };

  beforeEach(() => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (NativeModules.GovernorBattery.readThermo as jest.Mock).mockResolvedValue(batteryPoll);
    (getCurrentPlatformThermalState as jest.Mock).mockResolvedValue(null);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("an Android status rides the battery profile", async () => {
    (getCurrentPlatformThermalState as jest.Mock).mockResolvedValue({
      platform: "android",
      supported: true,
      androidStatus: 3,
    });
    await expect(readGovernorThermo()).resolves.toMatchObject({
      thermo_source: "battery",
      platform_thermal_status: 3,
    });
  });

  test("iOS and an absent reader omit the key", async () => {
    (getCurrentPlatformThermalState as jest.Mock).mockResolvedValue({
      platform: "ios",
      supported: true,
      iosState: "serious",
    });
    const onIos = await readGovernorThermo();
    expect(onIos).not.toHaveProperty("platform_thermal_status");

    (getCurrentPlatformThermalState as jest.Mock).mockResolvedValue(null);
    const absent = await readGovernorThermo();
    expect(absent).not.toHaveProperty("platform_thermal_status");
  });

  test("a throwing platform read is absent, not fatal", async () => {
    (getCurrentPlatformThermalState as jest.Mock).mockRejectedValue(new Error("thermal boom"));
    const snapshot = await readGovernorThermo();
    expect(snapshot).toMatchObject({ thermo_source: "battery", sensor_valid: true });
    expect(snapshot).not.toHaveProperty("platform_thermal_status");
  });

  test("the bench override wins the battery fields and keeps the live status", async () => {
    (NativeModules.GovernorBattery.readThermo as jest.Mock).mockClear();
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
    (getCurrentPlatformThermalState as jest.Mock).mockResolvedValue({
      platform: "android",
      supported: true,
      androidStatus: 6,
    });
    await expect(readGovernorThermo()).resolves.toMatchObject({
      batt_temp_tenths_c: 410,
      thermo_source: "bench-skin",
      platform_thermal_status: 6,
    });
    expect(NativeModules.GovernorBattery.readThermo).not.toHaveBeenCalled();
  });

  test("a never-resolving platform read is bounded: the profile builds without the field", async () => {
    jest.useFakeTimers();
    (getCurrentPlatformThermalState as jest.Mock).mockImplementation(
      () => new Promise(() => undefined),
    );
    const pending = readGovernorThermo();
    await jest.advanceTimersByTimeAsync(1_000);
    const snapshot = await pending;
    expect(snapshot).toMatchObject({ thermo_source: "battery", sensor_valid: true });
    expect(snapshot).not.toHaveProperty("platform_thermal_status");
  });
});
