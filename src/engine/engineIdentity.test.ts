/**
 * Engine build identity: the saved KV must be invalidated by a real change of
 * the compiled engine (fork pin, bridge/native patches, native tree, source vs
 * prebuilt), and must never fall back to a static fabricated value.
 *
 * These tests encode the e2e09f5 audit finding: the old implementation returned
 * the constant "kalsa-native-patches:app:1" for every engine build because it
 * ignored the build inputs entirely.
 */

import path from "path";

import {
  ENGINE_PATCH_MARKER,
  engineBuildFingerprint,
  readEngineBuildId,
} from "./engineIdentity";

const PROJECT_ROOT = path.resolve(__dirname, "../..");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const engineBuildIdModule = require("../../scripts/engine-build-id.js") as {
  ENGINE_BUILD_ID_PREFIX: string;
  computeEngineBuildId: (root?: string) => string;
  collectEngineBuildInputs: (root?: string) => Record<string, unknown>;
  engineBuildIdFromInputs: (inputs: Record<string, unknown>) => string;
};

const SYSTEM_INFO = `system_info: n_threads = 4 | OpenCL : Adreno | ${ENGINE_PATCH_MARKER}`;
const BUILD_ID = "kalsa-eng-v1:source:0123456789abcdef";

describe("engineBuildFingerprint", () => {
  test("fails closed when the generated engine build id is unavailable", () => {
    expect(engineBuildFingerprint(SYSTEM_INFO, undefined)).toBeNull();
    expect(engineBuildFingerprint(SYSTEM_INFO, null)).toBeNull();
    expect(engineBuildFingerprint(SYSTEM_INFO, "")).toBeNull();
    expect(engineBuildFingerprint(SYSTEM_INFO, "   ")).toBeNull();
  });

  test("fails closed when systemInfo is unavailable", () => {
    expect(engineBuildFingerprint(undefined, BUILD_ID)).toBeNull();
    expect(engineBuildFingerprint("", BUILD_ID)).toBeNull();
    expect(engineBuildFingerprint("   ", BUILD_ID)).toBeNull();
  });

  test("fails closed when the binary lacks the native patch marker", () => {
    // Prebuilt jniLibs: the generated id would not describe what is running.
    expect(
      engineBuildFingerprint("system_info: n_threads = 4 | OpenCL : Adreno", BUILD_ID),
    ).toBeNull();
    expect(engineBuildFingerprint("kalsa-native-patch", BUILD_ID)).toBeNull();
  });

  test("is stable for the same inputs", () => {
    expect(engineBuildFingerprint(SYSTEM_INFO, BUILD_ID)).toBe(
      engineBuildFingerprint(SYSTEM_INFO, BUILD_ID),
    );
  });

  test("changes when the engine build id changes (pin/patch/variant)", () => {
    const a = engineBuildFingerprint(SYSTEM_INFO, BUILD_ID);
    const b = engineBuildFingerprint(
      SYSTEM_INFO,
      "kalsa-eng-v1:source:fedcba9876543210",
    );
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).not.toBe(b);
  });

  test("never fabricates the old static identity", () => {
    // The pre-fix code always returned this literal regardless of the build.
    expect(engineBuildFingerprint(SYSTEM_INFO, BUILD_ID)).not.toBe(
      "kalsa-native-patches:app:1",
    );
    expect(engineBuildFingerprint(SYSTEM_INFO, BUILD_ID)).toContain(BUILD_ID);
  });

  test("keeps the patch marker in the fingerprint", () => {
    expect(engineBuildFingerprint(SYSTEM_INFO, BUILD_ID)).toBe(
      `${BUILD_ID}:${ENGINE_PATCH_MARKER}`,
    );
  });
});

describe("readEngineBuildId", () => {
  afterEach(() => {
    jest.dontMock("expo-constants");
    jest.resetModules();
  });

  test("reads the id embedded at prebuild", () => {
    jest.resetModules();
    jest.doMock("expo-constants", () => ({
      __esModule: true,
      default: { expoConfig: { extra: { engineBuildId: "embedded-id" } } },
    }));
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require("./engineIdentity") as typeof import("./engineIdentity");
      expect(mod.readEngineBuildId()).toBe("embedded-id");
    });
  });

  test("fails closed (null) when the config is unavailable", () => {
    jest.resetModules();
    jest.doMock("expo-constants", () => {
      throw new Error("expo-constants unavailable outside the app runtime");
    });
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require("./engineIdentity") as typeof import("./engineIdentity");
      expect(mod.readEngineBuildId()).toBeNull();
    });
  });

  test("does not throw when expo-constants has no engineBuildId", () => {
    expect(() => readEngineBuildId()).not.toThrow();
  });
});

describe("engine build id generator", () => {
  const baseInputs = {
    pin: "67c73d26cb4ce53d8f04b199b523bf05d18fbd61",
    variant: "source",
    llamaRnVersion: "0.12.8",
    overlayScript: "overlay-sha",
    sourceBuildPlugin: "plugin-sha",
    patches: ["llama.rn+0.12.8.patch:patch-sha"],
    native: ["bmoe/rn/bmoe_stream.cpp:native-sha"],
  };

  test("is deterministic for the same inputs", () => {
    const { engineBuildIdFromInputs } = engineBuildIdModule;
    expect(engineBuildIdFromInputs(baseInputs)).toBe(
      engineBuildIdFromInputs(baseInputs),
    );
  });

  test("changes when the fork pin changes", () => {
    const { engineBuildIdFromInputs } = engineBuildIdModule;
    expect(
      engineBuildIdFromInputs({ ...baseInputs, pin: "a".repeat(40) }),
    ).not.toBe(engineBuildIdFromInputs(baseInputs));
  });

  test("changes when a native patch changes", () => {
    const { engineBuildIdFromInputs } = engineBuildIdModule;
    expect(
      engineBuildIdFromInputs({
        ...baseInputs,
        patches: ["llama.rn+0.12.8.patch:different-patch-sha"],
      }),
    ).not.toBe(engineBuildIdFromInputs(baseInputs));
  });

  test("changes when the native source tree changes", () => {
    const { engineBuildIdFromInputs } = engineBuildIdModule;
    expect(
      engineBuildIdFromInputs({
        ...baseInputs,
        native: ["bmoe/rn/bmoe_stream.cpp:different-native-sha"],
      }),
    ).not.toBe(engineBuildIdFromInputs(baseInputs));
  });

  test("changes when the source/prebuilt variant changes", () => {
    const { engineBuildIdFromInputs } = engineBuildIdModule;
    expect(
      engineBuildIdFromInputs({ ...baseInputs, variant: "prebuilt" }),
    ).not.toBe(engineBuildIdFromInputs(baseInputs));
  });

  test("collects the real committed inputs and is stable across calls", () => {
    const { computeEngineBuildId, collectEngineBuildInputs, ENGINE_BUILD_ID_PREFIX } =
      engineBuildIdModule;
    const inputs = collectEngineBuildInputs(PROJECT_ROOT);
    expect(inputs.pin).toMatch(/^[0-9a-f]{40}$/);
    expect(Array.isArray(inputs.patches) && inputs.patches.length > 0).toBe(true);
    expect(Array.isArray(inputs.native) && inputs.native.length > 0).toBe(true);

    const first = computeEngineBuildId(PROJECT_ROOT);
    const second = computeEngineBuildId(PROJECT_ROOT);
    expect(first).toBe(second);
    expect(first.startsWith(`${ENGINE_BUILD_ID_PREFIX}:`)).toBe(true);
    expect(first).toContain(":source:");
  });
});
