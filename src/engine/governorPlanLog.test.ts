jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null) },
}));

jest.mock("react-native", () => ({ NativeModules: {} }));

// The thermo feed now imports the platform thermal reader; without a linked
// native runtime expo's module import cannot parse, so fail open like the
// other governor tests do.
jest.mock("expo-modules-core", () => ({
  requireOptionalNativeModule: () => null,
}));

import type { DeviceProfile } from "./deviceProfile";
import { MODEL_REGISTRY } from "./ModelRegistry";
import { modelAtKvProfile } from "./kvQuantCost";
import {
  buildGovernorParams,
  buildGovernorPlanLog,
  type BenchNpuLanePref,
} from "./governorInputs";

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

    const plan = buildGovernorPlanLog(model, memory, governor, undefined);
    // The absent pref is "auto" now, so the printed required_mib are the
    // lane's own (+219 MiB HTP prefill copy); the lane-off prices stay pinned
    // below (4518.12 / 2998.06).
    expect(plan).toEqual({
      gpu_fit: "Fit",
      decode_repack: true,
      required_mib_with_repack: 4737.12,
      required_mib_without_repack: 3217.06,
      available_mib: 4519,
      bench_norepack_forced: null,
      npu_device: null,
      npu_fallback: null,
      npu_lane: "auto",
      npu_fit: "Fit",
      available_src: null,
    });
    // Instruments parse this line: the pre-npu_lane keys keep their order
    // and the later keys are appended.
    expect(Object.keys(plan)).toEqual([
      "gpu_fit",
      "decode_repack",
      "required_mib_with_repack",
      "required_mib_without_repack",
      "available_mib",
      "bench_norepack_forced",
      "npu_device",
      "npu_fallback",
      "npu_lane",
      "npu_fit",
      "available_src",
    ]);
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

  test("an eligible NPU lane carries its plan fields and its own repack decision", () => {
    const model = MODEL_REGISTRY.find((entry) => entry.id === "lfm2.5-2.6b")!;
    const memory = {
      availableMemoryBytes: 4519 * 1024 ** 2,
      totalMemoryBytes: 8 * 1024 ** 3,
      contextTokens: 8192,
      ubatch: 256,
      mmap: true,
      offloadedBytes: model.sizeBytes,
    };
    // S23, no vision: the lane fits only WITHOUT repack once the +219 MiB
    // HTP prefill copy is priced (4737.12 > 4519, 3217.06 <= 4519).
    const governor = buildGovernorParams(model, s23, memory, false, undefined, {
      android: true,
      hasMmproj: false,
      lanePref: "auto",
    });
    expect(governor).toMatchObject({
      npu_lane_enabled: true,
      npu_fit: "Fit",
      decode_repack: false,
    });
    // With the lane requested, the printed required_mib are the lane's own
    // compared values: entry-priced KV plus the +219 MiB HTP prefill copy.
    // Printing the GPU-lane prices here made the line disagree with the
    // NoFit/Fit verdict by exactly 219 MiB (the S23 thrash postmortem).
    expect(
      buildGovernorPlanLog(model, memory, governor, undefined, "auto", {
        availableSrc: "fresh",
      }),
    ).toMatchObject({
      required_mib_with_repack: 4737.12,
      required_mib_without_repack: 3217.06,
      available_mib: 4519,
      npu_fit: "Fit",
      available_src: "fresh",
      decode_repack: false,
      npu_lane: "auto",
    });
  });

  test("a requested lane prints the lane-model prices it actually compares", () => {
    const model = MODEL_REGISTRY.find((entry) => entry.id === "lfm2.5-2.6b")!;
    const memory = {
      availableMemoryBytes: 4519 * 1024 ** 2,
      totalMemoryBytes: 8 * 1024 ** 3,
      contextTokens: 8192,
      ubatch: 256,
      mmap: true,
      offloadedBytes: model.sizeBytes,
    };
    // The lane runs with the effective KV types (q8_0 V via the HTP upgrade),
    // so its fit prices a re-priced model entry — the printed required_mib
    // must price THAT entry, not the caller-profiled one.
    const laneModel = modelAtKvProfile(model, "q8_0", "q8_0");
    const plan = buildGovernorPlanLog(
      model,
      memory,
      buildGovernorParams(model, s23, memory, false, undefined, {
        android: true,
        hasMmproj: false,
        lanePref: "auto",
        laneModel,
      }),
      undefined,
      "auto",
      { laneModel, availableSrc: "cached" },
    );
    expect(plan.required_mib_with_repack).toBeGreaterThan(4737.12);
    expect(plan.required_mib_without_repack).toBeGreaterThan(3217.06);
    expect(plan.npu_fit).toBe("Fit");
    expect(plan.available_src).toBe("cached");
    // Lane off: the binding decision is the GPU lane's own — no extra.
    const laneOff = buildGovernorPlanLog(model, memory, buildGovernorParams(model, s23, memory), undefined, "off");
    expect(laneOff.required_mib_with_repack).toBe(4518.12);
    expect(laneOff.required_mib_without_repack).toBe(2998.06);
  });

  test("reports the effective lane pref, defaulting an absent one to auto", () => {
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
    const laneOf = (pref?: BenchNpuLanePref) =>
      buildGovernorPlanLog(model, memory, governor, undefined, pref).npu_lane;

    expect(laneOf("auto")).toBe("auto");
    expect(laneOf("on")).toBe("on");
    expect(laneOf("off")).toBe("off");
    // readBenchNpuLane maps absent/invalid storage to undefined, and the
    // plan reports the value the gate resolves that to: "auto" since the
    // owner's 2026-10-02 decision.
    expect(laneOf(undefined)).toBe("auto");
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
