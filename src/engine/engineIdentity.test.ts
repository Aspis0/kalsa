/**
 * Engine build identity: the saved KV must be invalidated by a real change of
 * the compiled engine (llama.rn fork commit, kalsallama base, engine tree,
 * native tree), and must never fall back to a static fabricated value.
 *
 * These tests encode the e2e09f5 audit finding: the old implementation returned
 * the constant "kalsa-native-patches:app:1" for every engine build because it
 * ignored the build inputs entirely.
 */

import fs from "fs";
import os from "os";
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

const SAVED_ENV = process.env.KALSA_LLAMA_FROM_SOURCE;

beforeAll(() => {
  // No ambient env may influence the results under test.
  delete process.env.KALSA_LLAMA_FROM_SOURCE;
});

afterAll(() => {
  if (SAVED_ENV === undefined) {
    delete process.env.KALSA_LLAMA_FROM_SOURCE;
  } else {
    process.env.KALSA_LLAMA_FROM_SOURCE = SAVED_ENV;
  }
});

const SYSTEM_INFO = `system_info: n_threads = 4 | OpenCL : Adreno | ${ENGINE_PATCH_MARKER}`;
// Opaque fixtures for the runtime fingerprint (it never parses the id shape).
const BUILD_ID = `kalsa-eng-v2:${"a".repeat(64)}`;
const OTHER_BUILD_ID = `kalsa-eng-v2:${"b".repeat(64)}`;

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
    // The generated id would not describe what is actually running.
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

  test("changes when the engine build id changes", () => {
    const a = engineBuildFingerprint(SYSTEM_INFO, BUILD_ID);
    const b = engineBuildFingerprint(SYSTEM_INFO, OTHER_BUILD_ID);
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
    llamaRnCommit: "987799a1ccb6af4976d44e7825393346de0db49f",
    kalsallamaSha: "134a35cf201f3a9c4b25eb32768198b8cb3f3c5d",
    llamaRnVersion: "0.12.8",
    sourceBuildPlugin: "0123456789abcdef".repeat(4),
    native: ["bmoe/rn/bmoe_stream.cpp:native-sha"],
    engineTree: ["cpp/rn-governor.cpp:engine-sha"],
  };

  // One "changes when" test per input: if that input's line were dropped from
  // the canonical string, the id would stop tracking the input and the
  // matching test below would fail.
  test("same inputs give the same id", () => {
    const { engineBuildIdFromInputs } = engineBuildIdModule;
    expect(engineBuildIdFromInputs(baseInputs)).toBe(
      engineBuildIdFromInputs(baseInputs),
    );
  });

  test("changes when the llama.rn git sha changes", () => {
    const { engineBuildIdFromInputs } = engineBuildIdModule;
    expect(
      engineBuildIdFromInputs({
        ...baseInputs,
        llamaRnCommit: "a".repeat(40),
      }),
    ).not.toBe(engineBuildIdFromInputs(baseInputs));
  });

  test("changes when KALSALLAMA_SHA changes", () => {
    const { engineBuildIdFromInputs } = engineBuildIdModule;
    expect(
      engineBuildIdFromInputs({
        ...baseInputs,
        kalsallamaSha: "b".repeat(40),
      }),
    ).not.toBe(engineBuildIdFromInputs(baseInputs));
  });

  test("changes when the llama.rn version changes", () => {
    const { engineBuildIdFromInputs } = engineBuildIdModule;
    expect(
      engineBuildIdFromInputs({ ...baseInputs, llamaRnVersion: "0.13.0" }),
    ).not.toBe(engineBuildIdFromInputs(baseInputs));
  });

  test("changes when the source-build plugin changes", () => {
    const { engineBuildIdFromInputs } = engineBuildIdModule;
    expect(
      engineBuildIdFromInputs({
        ...baseInputs,
        sourceBuildPlugin: "fedcba9876543210".repeat(4),
      }),
    ).not.toBe(engineBuildIdFromInputs(baseInputs));
  });

  test("changes when the native tree changes", () => {
    const { engineBuildIdFromInputs } = engineBuildIdModule;
    expect(
      engineBuildIdFromInputs({
        ...baseInputs,
        native: ["bmoe/rn/bmoe_stream.cpp:different-native-sha"],
      }),
    ).not.toBe(engineBuildIdFromInputs(baseInputs));
  });

  test("changes when the engine tree changes", () => {
    const { engineBuildIdFromInputs } = engineBuildIdModule;
    expect(
      engineBuildIdFromInputs({
        ...baseInputs,
        engineTree: ["cpp/rn-governor.cpp:different-engine-sha"],
      }),
    ).not.toBe(engineBuildIdFromInputs(baseInputs));
  });

  test("throws on missing, empty, or malformed inputs", () => {
    const { engineBuildIdFromInputs } = engineBuildIdModule;
    expect(() => engineBuildIdFromInputs({})).toThrow(/engine-build-id:/);
    for (const field of Object.keys(baseInputs)) {
      const broken = { ...baseInputs } as Record<string, unknown>;
      delete broken[field];
      expect(() => engineBuildIdFromInputs(broken)).toThrow(
        new RegExp(`input ${field}`),
      );
    }
    expect(() =>
      engineBuildIdFromInputs({ ...baseInputs, llamaRnCommit: "nothex" }),
    ).toThrow(/input llamaRnCommit/);
    expect(() =>
      engineBuildIdFromInputs({ ...baseInputs, sourceBuildPlugin: "short" }),
    ).toThrow(/input sourceBuildPlugin/);
    expect(() =>
      engineBuildIdFromInputs({ ...baseInputs, native: [] }),
    ).toThrow(/input native/);
    expect(() =>
      engineBuildIdFromInputs({
        ...baseInputs,
        native: ["bmoe/rn/bmoe_stream.cpp:native\nsha"],
      }),
    ).toThrow(/must not contain newlines/);
  });

  test("collects the real committed inputs and is stable across calls", () => {
    const {
      computeEngineBuildId,
      collectEngineBuildInputs,
      ENGINE_BUILD_ID_PREFIX,
    } = engineBuildIdModule;
    const lock = JSON.parse(
      fs.readFileSync(path.join(PROJECT_ROOT, "package-lock.json"), "utf8"),
    ) as { packages: Record<string, { resolved?: string }> };
    const resolved = lock.packages["node_modules/llama.rn"].resolved ?? "";
    const match = resolved.match(/#([0-9a-f]{40})$/);
    expect(match).not.toBeNull();
    const kalsallamaSha = fs
      .readFileSync(
        path.join(PROJECT_ROOT, "node_modules", "llama.rn", "cpp", "KALSALLAMA_SHA"),
        "utf8",
      )
      .trim();

    const inputs = collectEngineBuildInputs(PROJECT_ROOT);
    expect(inputs.llamaRnCommit).toBe(match![1]);
    expect(inputs.kalsallamaSha).toBe(kalsallamaSha);
    expect(Array.isArray(inputs.native) && inputs.native.length > 0).toBe(true);
    expect(Array.isArray(inputs.engineTree) && inputs.engineTree.length > 0).toBe(
      true,
    );

    const first = computeEngineBuildId(PROJECT_ROOT);
    const second = computeEngineBuildId(PROJECT_ROOT);
    expect(first).toBe(second);
    expect(first).toMatch(/^kalsa-eng-v2:[0-9a-f]{64}$/);
    expect(first.startsWith(`${ENGINE_BUILD_ID_PREFIX}:`)).toBe(true);
  });

  // Scaffold a minimal fork checkout: enough for collectEngineBuildInputs to
  // reach the lockfile check (refusals) or finish a full collect (accepts).
  function scaffoldForkRoot(root: string, resolved: string): void {
    fs.mkdirSync(path.join(root, "node_modules", "llama.rn", "cpp"), {
      recursive: true,
    });
    // The full collect digests all four engine-tree subdirs.
    for (const sub of ["android", "bin", "ios"]) {
      fs.mkdirSync(path.join(root, "node_modules", "llama.rn", sub));
    }
    fs.mkdirSync(path.join(root, "native"), { recursive: true });
    fs.mkdirSync(path.join(root, "plugins"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "package-lock.json"),
      JSON.stringify({
        packages: { "node_modules/llama.rn": { resolved } },
      }),
    );
    fs.writeFileSync(
      path.join(root, "node_modules", "llama.rn", "package.json"),
      JSON.stringify({ name: "llama.rn", version: "0.12.8" }),
    );
    fs.writeFileSync(
      path.join(root, "node_modules", "llama.rn", "cpp", "KALSALLAMA_SHA"),
      `${"1".repeat(40)}\n`,
    );
    fs.writeFileSync(path.join(root, "native", "GovernorBatteryModule.kt"), "class X\n");
    fs.writeFileSync(
      path.join(root, "plugins", "withLlamaFromSource.js"),
      "module.exports = (config) => config;\n",
    );
  }

  const FORK_SHA = "987799a1ccb6af4976d44e7825393346de0db49f";

  test("accepts the git+ssh lockfile form npm writes natively", () => {
    const { collectEngineBuildInputs } = engineBuildIdModule;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "engine-build-id-"));
    try {
      scaffoldForkRoot(tmp, `git+ssh://git@github.com/Aspis0/llama.rn.git#${FORK_SHA}`);
      expect(collectEngineBuildInputs(tmp).llamaRnCommit).toBe(FORK_SHA);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("accepts the git+https lockfile form", () => {
    const { collectEngineBuildInputs } = engineBuildIdModule;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "engine-build-id-"));
    try {
      scaffoldForkRoot(tmp, `git+https://github.com/Aspis0/llama.rn.git#${FORK_SHA}`);
      expect(collectEngineBuildInputs(tmp).llamaRnCommit).toBe(FORK_SHA);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("throws when the resolved URL has no sha", () => {
    const { collectEngineBuildInputs } = engineBuildIdModule;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "engine-build-id-"));
    try {
      scaffoldForkRoot(tmp, "git+https://github.com/Aspis0/llama.rn.git");
      expect(() => collectEngineBuildInputs(tmp)).toThrow(/#<40-char sha>/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("throws on a wrong host/owner/repo", () => {
    const { collectEngineBuildInputs } = engineBuildIdModule;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "engine-build-id-"));
    try {
      scaffoldForkRoot(
        tmp,
        `git+https://github.com/NotAspis0/llama.rn.git#${FORK_SHA}`,
      );
      expect(() => collectEngineBuildInputs(tmp)).toThrow(
        /github\.com git URL for Aspis0\/llama\.rn/,
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("throws on a short sha", () => {
    const { collectEngineBuildInputs } = engineBuildIdModule;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "engine-build-id-"));
    try {
      scaffoldForkRoot(
        tmp,
        `git+ssh://git@github.com/Aspis0/llama.rn.git#${"a".repeat(39)}`,
      );
      expect(() => collectEngineBuildInputs(tmp)).toThrow(/#<40-char sha>/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("throws when the installed tree is not the fork (no KALSALLAMA_SHA)", () => {
    const { collectEngineBuildInputs } = engineBuildIdModule;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "engine-build-id-"));
    try {
      fs.mkdirSync(path.join(tmp, "node_modules", "llama.rn"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(tmp, "package-lock.json"),
        JSON.stringify({
          packages: {
            "node_modules/llama.rn": {
              resolved:
                "git+https://github.com/Aspis0/llama.rn.git#987799a1ccb6af4976d44e7825393346de0db49f",
            },
          },
        }),
      );
      fs.writeFileSync(
        path.join(tmp, "node_modules", "llama.rn", "package.json"),
        JSON.stringify({ name: "llama.rn", version: "0.12.8" }),
      );
      expect(() => collectEngineBuildInputs(tmp)).toThrow(/KALSALLAMA_SHA/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
