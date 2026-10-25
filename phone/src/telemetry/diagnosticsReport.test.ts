/**
 * End to end through reportTelemetry: the POST body the phone sends for a
 * decode failure is a v2 report the Worker's validator accepts, nothing the
 * user typed or the device locates leaves the phone, and the device identity
 * fields come from the resolved profile or stay at today's default.
 */
import { validateReport } from "../../workers/telemetry/schema";
import {
  beginPrefill,
  markFirstToken,
  recordGovernorTurn,
  recordLoad,
  resetDiagnosticsForTests,
} from "./diagnosticsCollector";
import { noteDeviceProfile, resetDeviceFactsForTests } from "./deviceFacts";
import {
  __resetTelemetryForTests,
  initTelemetry,
  reportTelemetry,
  type StorageLike,
} from "./telemetry";

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
}));
jest.mock("react-native", () => ({
  AppState: { currentState: "active", addEventListener: () => ({ remove: () => undefined }) },
  Platform: { OS: "android" },
}));

const NOW = 1_700_000_000_000;
const CANARY_MESSAGE =
  "out of memory at /data/user/0/app/files/models/qwen.gguf via https://models.example.com/x on phone-host.local USER_TEXT_SECRET";

function memoryStorage(): StorageLike {
  const store = new Map<string, string>();
  return {
    getItem: async (key) => store.get(key) ?? null,
    setItem: async (key, value) => {
      store.set(key, value);
    },
    removeItem: async (key) => {
      store.delete(key);
    },
  };
}

/** Resolves with the first POST body the drain sends from a fresh service. */
async function firstWireBody(report: () => void): Promise<string> {
  __resetTelemetryForTests();
  const bodies: string[] = [];
  // No getDeviceContext override: production takes the default, which reads the resolved profile.
  await initTelemetry({
    storage: memoryStorage(),
    now: () => NOW,
    getAppState: () => "active",
    getAppVersion: () => "1.0.0",
    fetchImpl: (async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return new Response("{}", { status: 202 });
    }) as unknown as typeof fetch,
  });
  report();
  for (let i = 0; i < 100 && bodies.length === 0; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (bodies.length === 0) throw new Error("no report was sent");
  return bodies[0]!;
}

beforeEach(() => {
  resetDiagnosticsForTests();
  resetDeviceFactsForTests();
});

describe("decode failure report", () => {
  test("is v2, carries the failing location and state, and passes the Worker validator", async () => {
    recordLoad({ modelId: "qwen3.5-4b", contextTokens: 8192 });
    beginPrefill();
    markFirstToken();
    recordGovernorTurn(
      { engine_prefill: "GPU", engine_decode: "GPU", thermal_state: "WARM" },
      { timings: { prompt_n: 300, prompt_ms: 600, predicted_per_second: 12 } },
    );
    noteDeviceProfile({ socModel: "SM8550", ramTier: "mid", totalMemoryBytes: 8_000_000_000, osVersion: "14.2" });

    const body = await firstWireBody(() =>
      reportTelemetry({
        code: "chat.generation",
        detail: "oom",
        rawMessage: CANARY_MESSAGE,
        phase: "turn",
        component: "engine",
        modelId: "qwen3.5-4b",
      }),
    );
    const report = JSON.parse(body) as Record<string, unknown>;

    expect(validateReport(report)).toBeNull();
    expect(report).toMatchObject({ v: 2, platform: "android", deviceBucket: "mid", osMajor: "14" });
    expect(report.diagnostics).toEqual({
      component: "engine",
      stage: "decode",
      osFamily: "android",
      backend: "opencl",
      offload: "gpu",
      thermal: "fair",
      modelId: "qwen3.5-4b",
      cpuModel: "Snapdragon 8 Gen 2",
      ctxTokens: "4-16k",
      promptTokens: "lt-512",
      tokensPerSecond: "10-30",
      sinceStart: "lt-10s",
      signature: "out of memory",
      breadcrumbs: [
        { component: "engine", stage: "prefill", sinceStart: "lt-10s" },
        { component: "engine", stage: "decode", sinceStart: "lt-10s" },
      ],
    });
  });

  test("a failure in a new attempt does not inherit the previous attempt's facts", async () => {
    recordGovernorTurn(
      { engine_prefill: "GPU", engine_decode: "GPU", thermal_state: "WARM" },
      { timings: { prompt_n: 300, prompt_ms: 600, predicted_per_second: 12 } },
    );
    beginPrefill();

    const body = await firstWireBody(() =>
      reportTelemetry({ code: "chat.generation", detail: "oom", component: "engine" }),
    );
    const diagnostics = (JSON.parse(body) as { diagnostics: Record<string, unknown> }).diagnostics;

    expect(diagnostics).toMatchObject({ component: "engine", stage: "prefill" });
    for (const stale of ["backend", "offload", "thermal", "promptTokens", "tokensPerSecond"]) {
      expect(diagnostics).not.toHaveProperty(stale);
    }
  });

  test("no RAM sample is sent, because the profile's RAM figures are a process-start cache", async () => {
    beginPrefill();
    noteDeviceProfile({ socModel: "SM8550", ramTier: "high", totalMemoryBytes: 16_000_000_000, osVersion: "14" });
    const body = await firstWireBody(() =>
      reportTelemetry({ code: "chat.generation", detail: "oom", component: "engine" }),
    );
    const diagnostics = (JSON.parse(body) as { diagnostics: Record<string, unknown> }).diagnostics;
    expect(diagnostics).not.toHaveProperty("freeRam");
    expect(diagnostics).not.toHaveProperty("ramUse");
  });

  test("no user text, path, URL or hostname reaches the wire", async () => {
    const body = await firstWireBody(() =>
      reportTelemetry({
        code: "chat.generation",
        detail: "oom",
        rawMessage: CANARY_MESSAGE,
        component: "engine",
      }),
    );
    for (const canary of ["USER_TEXT_SECRET", "/data/", "https://", "models.example.com", "phone-host"]) {
      expect(body).not.toContain(canary);
    }
  });

  test("a report without a failure location stays v1 and has no diagnostics", async () => {
    const body = await firstWireBody(() =>
      reportTelemetry({ code: "web.fetch", detail: "timeout" }),
    );
    const report = JSON.parse(body) as Record<string, unknown>;
    expect(report.v).toBe(1);
    expect(report).not.toHaveProperty("diagnostics");
    expect(validateReport(report)).toBeNull();
  });
});

describe("device identity on the wire", () => {
  test("a resolved high-tier profile reports high and the real OS major", async () => {
    noteDeviceProfile({ socModel: "SM8550", ramTier: "high", totalMemoryBytes: 16_000_000_000, osVersion: "17.2" });
    const body = await firstWireBody(() =>
      reportTelemetry({ code: "chat.generation", detail: "oom", component: "engine" }),
    );
    expect(JSON.parse(body)).toMatchObject({ deviceBucket: "high", osMajor: "17", context: { memoryClass: "ge-6gb" } });
  });

  test("with no profile the report keeps today's default", async () => {
    const body = await firstWireBody(() =>
      reportTelemetry({ code: "chat.generation", detail: "oom", component: "engine" }),
    );
    expect(JSON.parse(body)).toMatchObject({ deviceBucket: "low", osMajor: "0" });
  });

  test("a degraded profile (total memory unreadable) keeps today's default", async () => {
    noteDeviceProfile({ socModel: "SM8550", ramTier: "low", totalMemoryBytes: null, osVersion: "14" });
    const body = await firstWireBody(() =>
      reportTelemetry({ code: "chat.generation", detail: "oom", component: "engine" }),
    );
    expect(JSON.parse(body)).toMatchObject({ deviceBucket: "low", osMajor: "0" });
  });
});
