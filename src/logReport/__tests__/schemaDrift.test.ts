/**
 * Drift test: where a tagSchemas closed set has an exported runtime source in
 * the emitting code, the two must be equal (or the schema must be a superset
 * when the exported source is partial). Sets with no exported runtime source
 * (type unions only: pause reasons, stall reasons, cooling outcomes, pause
 * sites, context/flash modes, native thermal states) are pinned by their
 * emitter tests and cannot drift here by construction.
 *
 * The react-native / AsyncStorage / expo-modules-core mocks exist only so the
 * real governorInputs module graph loads under plain node; the literals under
 * test are the real ones.
 */
jest.mock("react-native", () => ({ NativeModules: {} }));
jest.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => undefined },
}));
jest.mock("expo-modules-core", () => ({
  requireOptionalNativeModule: () => null,
}));

import { TAG_SCHEMAS } from "../tagSchemas";
import { ALL_TOOL_NAMES } from "../../agent/toolNames";
import { STRATEGY_SET } from "../../engine/turnTelemetry";
import { GPU_PREFILL_CORRECT } from "../../engine/governorInputs";
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
});
