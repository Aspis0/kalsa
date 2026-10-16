/**
 * Drift test: where a tagSchemas closed set has an exported runtime source in
 * the emitting code, the two must be equal (or the schema must be a superset
 * when the exported source is partial). Sets with no exported runtime source
 * (type unions only: pause reasons, stall reasons, cooling outcomes, pause
 * sites, context/flash modes, native thermal states) are pinned by their
 * emitter tests and cannot drift here by construction.
 *
 * The react-native / AsyncStorage / expo-modules-core / expo-file-system mocks
 * exist only so the real governorInputs and sessionPersistence module graphs
 * load under plain node; the literals under test are the real ones.
 */
jest.mock("react-native", () => ({ NativeModules: {} }));
jest.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => undefined },
}));
jest.mock("expo-modules-core", () => ({
  requireOptionalNativeModule: () => null,
}));
jest.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  getFreeDiskStorageAsync: jest.fn(async () => 1_000_000_000),
  readDirectoryAsync: jest.fn(async () => []),
}));

import { TAG_SCHEMAS } from "../tagSchemas";
import { ALL_TOOL_NAMES } from "../../agent/toolNames";
import { STRATEGY_SET } from "../../engine/turnTelemetry";
import { GPU_PREFILL_CORRECT } from "../../engine/governorInputs";
import {
  EVICT_REASON_DEFICIT,
  EVICT_REASON_FAILED,
  EVICT_REASON_GATE_UNREADABLE,
  EVICT_REASON_INVALID_BUDGET,
  EVICT_REASON_UNEVICTABLE,
} from "../../engine/sessionEvictMarker";
import { GOVERNOR_SESSION_REASON } from "../../engine/sessionPersistence";
import {
  sessionNativeErrorReason,
  shouldSaveSession,
} from "../../engine/sessionPersistence";
import {
  GOVERNOR_FALLBACK_CODES,
  GOVERNOR_NOT_ELIGIBLE_REASON,
  GOVERNOR_THERMO_INVALID_REASON,
} from "../../engine/governorTurnLog";
import { KV_CACHE_TYPES } from "../../engine/kvCacheProfile";
import { ANCHORED_HISTORY_DROPPED_REASON } from "../../context/compactor";
import { IROH_BRIDGE_STAGES, IROH_DIAL_ERROR_REASONS } from "../../remote/road";
import { pauseReasonOf } from "../../engine/thermalResume";

function enumValues(tag: string, field: string): readonly string[] {
  const rule = TAG_SCHEMAS[tag]?.[field];
  if (rule?.k !== "enum") throw new Error(`${tag}.${field} is not an enum`);
  return rule.values;
}

describe("schema sets equal the real emitter sets", () => {
  it("tool = ALL_TOOL_NAMES plus the clamp placeholder", () => {
    expect(new Set(enumValues("KALSA_TELEMETRY", "tool"))).toEqual(
      new Set([...ALL_TOOL_NAMES, "other"]),
    );
  });

  it("strategy = the emitter STRATEGY_SET", () => {
    expect(new Set(enumValues("KALSA_TELEMETRY", "strategy"))).toEqual(
      new Set(STRATEGY_SET),
    );
  });

  it("governor fallback reason = one per emitter generation", () => {
    expect(new Set(enumValues("KALSA_GOVERNOR_FALLBACK", "reason"))).toEqual(
      new Set(Object.keys(GPU_PREFILL_CORRECT).map((g) => `gpu-prefill-incorrect-${g}`)),
    );
  });

  it("historyDropped = the compactor's anchored-drop constant", () => {
    expect(enumValues("KALSA_WINDOW", "historyDropped")).toEqual([
      ANCHORED_HISTORY_DROPPED_REASON,
    ]);
  });

  it("every exported iroh dial reason is a KALSA_ROAD reason", () => {
    // Partial source: no_node / module_absent / ok are type-only in road.ts.
    const roadReasons = new Set(enumValues("KALSA_ROAD", "reason"));
    for (const reason of Object.values(IROH_DIAL_ERROR_REASONS)) {
      expect(roadReasons.has(reason)).toBe(true);
    }
  });

  it("KALSA_ROAD stage = the dial stage plus every bridge decision stage", () => {
    // "dial" is emitted inline by logIrohDial; the bridge stages are exported.
    expect(new Set(enumValues("KALSA_ROAD", "stage"))).toEqual(
      new Set(["dial", ...IROH_BRIDGE_STAGES]),
    );
  });

  it("every schema pause reason is accepted by the real pauseReasonOf", () => {
    // The four literals live in a type union plus pauseReasonOf itself; the
    // accepting function is the runtime source, so probe it directly.
    for (const reason of enumValues("KALSA_GOVERNOR_PAUSE", "reason")) {
      expect(pauseReasonOf({ pause_reason: reason })).toBe(reason);
    }
    expect(pauseReasonOf({ pause_reason: "thermal2" })).toBeNull();
  });

  it("governor cost fallback code = the emitter's own set", () => {
    expect(enumValues("KALSA_GOVERNOR_COST", "fr")).toEqual(GOVERNOR_FALLBACK_CODES);
    // Every code LlamaService can assign must be in the report's set: the
    // runtime fallback (reloadGovernorRuntimeFallback) is a session-long
    // condition, not a one-turn message, so it needs its own code.
    for (const code of ["not_eligible", "thermo_invalid", "native_unnamed", "runtime"]) {
      expect(GOVERNOR_FALLBACK_CODES).toContain(code);
    }
  });

  it("every cache type the governor lines accept is a real cache type", () => {
    for (const tag of ["KALSA_GOVERNOR_TURN", "KALSA_GOVERNOR_LOAD"]) {
      for (const field of ["ck", "cv"]) {
        expect(new Set(enumValues(tag, field))).toEqual(new Set(KV_CACHE_TYPES));
      }
    }
  });

  it("the app's own governor fallback reasons have a code beside them", () => {
    // The prose rides the wide logcat line; the report needs the closed code.
    // These two literals are the only non-native reasons LlamaService can set.
    expect(GOVERNOR_FALLBACK_CODES).toContain("not_eligible");
    expect(GOVERNOR_FALLBACK_CODES).toContain("thermo_invalid");
    expect(GOVERNOR_NOT_ELIGIBLE_REASON).not.toBe(GOVERNOR_THERMO_INVALID_REASON);
    for (const code of GOVERNOR_FALLBACK_CODES) expect(code).not.toContain(" ");
  });

  it("KALSA_SESSION accepts the governor refusal and every evict reason", () => {
    const sessionReasons = new Set(enumValues("KALSA_SESSION", "reason"));
    expect(sessionReasons.has(GOVERNOR_SESSION_REASON)).toBe(true);
    for (const reason of [
      EVICT_REASON_FAILED,
      EVICT_REASON_UNEVICTABLE,
      EVICT_REASON_DEFICIT,
      EVICT_REASON_INVALID_BUDGET,
      EVICT_REASON_GATE_UNREADABLE,
    ]) {
      expect(sessionReasons.has(reason)).toBe(true);
    }
  });

  it("every refusal the save gate can return is a KALSA_SESSION reason", () => {
    // shouldSaveSession is the runtime source for the gate's reasons, so probe
    // it rather than restating its literals here.
    const sessionReasons = new Set(enumValues("KALSA_SESSION", "reason"));
    const refusals = [
      { hasContext: false, disposing: false, kvHoldsChatSession: true, kvReproducible: true },
      { hasContext: true, disposing: false, kvHoldsChatSession: true, kvReproducible: true, kvPoisoned: true },
      { hasContext: true, disposing: true, kvHoldsChatSession: true, kvReproducible: true },
      { hasContext: true, disposing: false, kvHoldsChatSession: false, kvReproducible: true },
      { hasContext: true, disposing: false, kvHoldsChatSession: true, kvReproducible: false },
    ].map((args) => shouldSaveSession(args).reason);
    expect(refusals.filter(Boolean).length).toBe(5);
    for (const reason of refusals) {
      expect(sessionReasons.has(reason as string)).toBe(true);
    }
  });

  it("every native session refusal class is a KALSA_SESSION reason", () => {
    const sessionReasons = new Set(enumValues("KALSA_SESSION", "reason"));
    const classes = [
      sessionNativeErrorReason(new Error("kv_inconsistent")),
      sessionNativeErrorReason(
        new Error("native session save is not supported while governor mode is enabled"),
      ),
    ];
    for (const reason of classes) expect(sessionReasons.has(reason as string)).toBe(true);
    expect(sessionNativeErrorReason(new Error("something else entirely"))).toBeNull();
  });
});
