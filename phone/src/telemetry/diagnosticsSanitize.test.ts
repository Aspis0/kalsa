/**
 * Allowlist rules for v2 diagnostics: governor engine labels, thermal
 * mapping, SoC names, canonical signatures and the breadcrumb cap.
 */
import type { RawDiagnosticInput } from "./diagnosticsSanitize";
import { sanitizeDiagnostics } from "./diagnosticsSanitize";
import { signatureFromMessage } from "./diagnosticsSignature";
import { snapdragonMarketingName } from "./diagnosticsSocModel";

function raw(overrides: Partial<RawDiagnosticInput> = {}): RawDiagnosticInput {
  return {
    component: "engine",
    stage: "decode",
    breadcrumbs: [],
    sinceStartSeconds: 5,
    turn: {},
    ...overrides,
  };
}

describe("backend and offload follow the failing stage", () => {
  test("GPU on Android is OpenCL; GPU on iOS is Metal", () => {
    const turn = { enginePrefill: "GPU", engineDecode: "GPU" };
    expect(sanitizeDiagnostics(raw({ turn }), "android")).toMatchObject({ backend: "opencl", offload: "gpu" });
    expect(sanitizeDiagnostics(raw({ turn }), "ios")).toMatchObject({ backend: "metal", offload: "gpu" });
  });

  test("the decode stage reads engine_decode, not engine_prefill", () => {
    const d = sanitizeDiagnostics(raw({ turn: { enginePrefill: "GPU", engineDecode: "CPU" } }), "android");
    expect(d).toMatchObject({ stage: "decode", backend: "cpu", offload: "cpu" });
  });

  test("an engine label outside GPU/CPU is unknown, not guessed", () => {
    const d = sanitizeDiagnostics(raw({ turn: { engineDecode: "HTP0" } }), "android");
    expect(d?.backend).toBe("unknown");
    expect(d?.offload).toBeUndefined();
  });

  test("a load failure carries no backend, because no stage ran", () => {
    const d = sanitizeDiagnostics(raw({ stage: "load", turn: { enginePrefill: "GPU" } }), "android");
    expect(d?.backend).toBeUndefined();
  });
});

describe("thermal", () => {
  test.each([
    ["FAST", "nominal"],
    ["WARM", "fair"],
    ["COOLMODE", "serious"],
    ["CRITICAL", "critical"],
    ["LOWBAT", "unknown"],
  ])("governor state %s → %s", (state, expected) => {
    expect(sanitizeDiagnostics(raw({ turn: { thermalState: state } }), "android")?.thermal).toBe(expected);
  });

  test("falls back to the Android platform status when the governor state is absent", () => {
    expect(sanitizeDiagnostics(raw({ turn: { platformThermalStatus: 3 } }), "android")?.thermal).toBe("serious");
    expect(sanitizeDiagnostics(raw({ turn: { platformThermalStatus: 6 } }), "android")?.thermal).toBe("critical");
  });

  test("an inherited object key is not a thermal state", () => {
    expect(sanitizeDiagnostics(raw({ turn: { thermalState: "constructor" } }), "android")?.thermal).toBe("unknown");
  });
});

describe("cpu model", () => {
  test("a known Snapdragon code gets its marketing name", () => {
    expect(snapdragonMarketingName("SM8550")).toBe("Snapdragon 8 Gen 2");
    expect(sanitizeDiagnostics(raw({ socModel: "SM8550" }), "android")?.cpuModel).toBe("Snapdragon 8 Gen 2");
  });

  test("an unknown SoC code is omitted, never sent raw", () => {
    const d = sanitizeDiagnostics(raw({ socModel: "SM9999" }), "android");
    expect(d?.cpuModel).toBeUndefined();
  });

  test("a name the Worker pattern rejects is omitted (SM8750 'Elite' form)", () => {
    expect(snapdragonMarketingName("SM8750")).toBeUndefined();
  });

  test("an iOS chip class already in pattern form passes through", () => {
    expect(sanitizeDiagnostics(raw({ socModel: "A17 Pro" }), "ios")?.cpuModel).toBe("A17 Pro");
  });
});

describe("signature", () => {
  test("GGML_ASSERT keeps only the source file and line", () => {
    expect(
      signatureFromMessage("/data/user/0/app/ggml-opencl.cpp:1234: GGML_ASSERT(n) failed"),
    ).toBe("GGML_ASSERT ggml-opencl.cpp:1234");
  });

  test("an engine error becomes its fixed token", () => {
    expect(signatureFromMessage("device ran Out of memory while mapping")).toBe("out of memory");
    expect(signatureFromMessage("CUDA error: device lost")).toBe("CUDA error");
  });

  test("unrelated text yields no signature", () => {
    expect(signatureFromMessage("the user asked about cats")).toBeUndefined();
  });
});

describe("breadcrumbs", () => {
  test("keep the last eight, each with a bucketed sinceStart", () => {
    const crumbs = Array.from({ length: 10 }, (_, i) => ({ component: "engine", stage: "decode", sinceSeconds: i * 100 }));
    const d = sanitizeDiagnostics(raw({ breadcrumbs: crumbs }), "android");
    expect(d?.breadcrumbs).toHaveLength(8);
    expect(d?.breadcrumbs?.[7]?.sinceStart).toBe("ge-10m");
  });

  test("a crumb with a non-contract component is dropped", () => {
    const d = sanitizeDiagnostics(
      raw({ breadcrumbs: [{ component: "chat", stage: "decode", sinceSeconds: 1 }] }),
      "android",
    );
    expect(d?.breadcrumbs).toBeUndefined();
  });
});

describe("unknown locations", () => {
  test("a component or stage outside the contract yields no diagnostics", () => {
    expect(sanitizeDiagnostics(raw({ component: "chat" }), "android")).toBeUndefined();
    expect(sanitizeDiagnostics(raw({ stage: "generate" }), "android")).toBeUndefined();
  });
});
