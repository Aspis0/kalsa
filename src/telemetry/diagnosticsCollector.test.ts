/**
 * The in-process trail and facts: repeats collapse, the trail is capped, a
 * report's stage defaults to where the component last was, a new attempt or
 * load drops the previous one's facts, and a hook never throws to its caller.
 */
import {
  beginLoad,
  beginPrefill,
  markFirstToken,
  markStage,
  recordGovernorTurn,
  recordLoad,
  resetDiagnosticsForTests,
  snapshotDiagnostics,
} from "./diagnosticsCollector";

const T0 = 1_700_000_000_000;

beforeEach(() => {
  resetDiagnosticsForTests();
});

describe("breadcrumb trail", () => {
  test("consecutive repeats collapse into one crumb", () => {
    markStage("engine", "decode", T0);
    markStage("engine", "decode", T0 + 1);
    markStage("engine", "decode", T0 + 2);
    const snap = snapshotDiagnostics({ component: "engine" }, T0 + 3);
    expect(snap.breadcrumbs).toHaveLength(1);
  });

  test("the trail keeps the last eight transitions", () => {
    for (let i = 0; i < 12; i += 1) {
      markStage("engine", i % 2 === 0 ? "prefill" : "decode", T0 + i);
      markStage("web", "tool_call", T0 + i);
    }
    const snap = snapshotDiagnostics({ component: "engine" }, T0 + 100);
    expect(snap.breadcrumbs).toHaveLength(8);
    expect(snap.breadcrumbs.at(-1)).toMatchObject({ component: "engine" });
  });
});

describe("report stage", () => {
  test("defaults to the component's latest recorded stage", () => {
    markStage("engine", "prefill", T0);
    markStage("web", "tool_call", T0 + 1);
    markStage("engine", "decode", T0 + 2);
    expect(snapshotDiagnostics({ component: "engine" }, T0 + 3).stage).toBe("decode");
  });

  test("is other when the component never recorded a stage", () => {
    expect(snapshotDiagnostics({ component: "governor" }, T0).stage).toBe("other");
  });

  test("an explicit stage wins and is appended to the trail once", () => {
    markStage("engine", "decode", T0);
    const snap = snapshotDiagnostics({ component: "engine", stage: "load" }, T0 + 1);
    expect(snap.stage).toBe("load");
    expect(snap.breadcrumbs.map((c) => c.stage)).toEqual(["decode", "load"]);
  });

  test("taking a snapshot does not change the trail", () => {
    markStage("engine", "decode", T0);
    snapshotDiagnostics({ component: "governor", stage: "load" }, T0 + 1);
    expect(snapshotDiagnostics({ component: "engine" }, T0 + 2).breadcrumbs).toHaveLength(1);
  });
});

describe("stale facts", () => {
  test("a new attempt drops the previous attempt's turn facts", () => {
    recordGovernorTurn(
      { engine_prefill: "GPU", thermal_state: "WARM" },
      { timings: { prompt_n: 300, prompt_ms: 600, predicted_per_second: 12 } },
    );
    beginPrefill();
    expect(snapshotDiagnostics({ component: "engine" }, T0).turn).toEqual({});
  });

  test("a new load drops the previous model and context size", () => {
    recordLoad({ modelId: "qwen3.5-4b", contextTokens: 8192 });
    beginLoad();
    const snap = snapshotDiagnostics({ component: "engine" }, T0);
    expect(snap.modelId).toBeUndefined();
    expect(snap.contextTokens).toBeUndefined();
  });

  test("a failed load reports the model it was asked for, not the last good one", () => {
    recordLoad({ modelId: "qwen3.5-4b", contextTokens: 8192 });
    beginLoad();
    expect(snapshotDiagnostics({ component: "engine", modelId: "lfm2.5-2.6b" }, T0).modelId).toBe("lfm2.5-2.6b");
  });
});

describe("decode mark", () => {
  test("is recorded once per attempt, however many tokens arrive", () => {
    beginPrefill();
    markFirstToken();
    markStage("engine", "tool_call", T0);
    markFirstToken();
    expect(snapshotDiagnostics({ component: "engine" }, T0 + 1).breadcrumbs.map((c) => c.stage)).toEqual([
      "prefill",
      "decode",
      "tool_call",
    ]);
  });

  test("a new attempt marks decode again on its first token", () => {
    beginPrefill();
    markFirstToken();
    beginPrefill();
    markFirstToken();
    expect(snapshotDiagnostics({ component: "engine" }, T0).breadcrumbs.map((c) => c.stage)).toEqual([
      "prefill",
      "decode",
      "prefill",
      "decode",
    ]);
  });
});

describe("hooks never throw", () => {
  test("a failing clock does not reach the caller", () => {
    const clock = jest.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("clock");
    });
    try {
      expect(() => {
        beginPrefill();
        markFirstToken();
        beginLoad();
        markStage("web", "tool_call");
      }).not.toThrow();
    } finally {
      clock.mockRestore();
    }
  });

  test("a stats object that throws on read does not reach the caller", () => {
    const hostileCompletion = {
      get timings(): unknown {
        throw new Error("getter");
      },
    };
    expect(() => recordGovernorTurn({}, hostileCompletion)).not.toThrow();
  });
});
