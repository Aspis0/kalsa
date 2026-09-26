import { readFileSync } from "fs";
import { join } from "path";

import { hostComposerPhase, type ComposerPhaseInput } from "./composerPhase";

const MODULE_SOURCE = readFileSync(join(__dirname, "composerPhase.ts"), "utf8");

const base: ComposerPhaseInput = {
  historyLoaded: true,
  thermalGated: false,
  sending: false,
  stopping: false,
  hasTokens: false,
  thinkingStatus: "Thinking",
  coolingStatus: "Cooling down",
  modelState: "ready",
  engineResident: true,
  remoteActive: false,
};

const phase = (over: Partial<ComposerPhaseInput>) => hostComposerPhase({ ...base, ...over });

describe("hostComposerPhase", () => {
  test("ready machine → idle", () => {
    expect(phase({})).toBe("idle");
  });

  test("history still settling → loading, not ready (a switch's first renders)", () => {
    expect(phase({ historyLoaded: false })).toBe("loading");
  });

  test("thermal CRITICAL wins over every other state", () => {
    expect(phase({ thermalGated: true, sending: true, modelState: "ready" })).toBe("tooHot");
  });

  test("prefill: sending before the first token", () => {
    expect(phase({ sending: true })).toBe("prefill");
  });

  test("cooling: a governor thermal pause mid-turn, label and all", () => {
    expect(phase({ sending: true, statusLabel: "Cooling down" })).toBe("cooling");
    // The label is live-turn state: without a run it can never claim cooling.
    expect(phase({ statusLabel: "Cooling down" })).toBe("idle");
  });

  test("thinking: sending while the engine reports the thinking status", () => {
    expect(phase({ sending: true, hasTokens: true, statusLabel: "Thinking" })).toBe("thinking");
  });

  test("writing: sending with a non-thinking status after tokens", () => {
    expect(phase({ sending: true, hasTokens: true, statusLabel: "Searching the web…" })).toBe(
      "writing",
    );
  });

  test("stopping outranks the status line (§2.8: visible until the engine releases)", () => {
    expect(phase({ sending: true, stopping: true, hasTokens: true, statusLabel: "Thinking" })).toBe(
      "stopping",
    );
  });

  test("ready but not resident after an idle unload → idle: the send reloads, so nothing holds", () => {
    expect(phase({ engineResident: false })).toBe("idle");
  });

  test("missing and error are both 'not loaded' for the composer", () => {
    expect(phase({ modelState: "missing" })).toBe("unloaded");
    expect(phase({ modelState: "error" })).toBe("unloaded");
  });

  test("checking / loading → loading", () => {
    expect(phase({ modelState: "checking" })).toBe("loading");
    expect(phase({ modelState: "loading" })).toBe("loading");
  });

  test("sending outranks a not-yet-resident model (the run holds the engine)", () => {
    expect(phase({ sending: true, hasTokens: true, engineResident: false, modelState: "loading" })).not.toBe("unloaded");
  });
});

describe("computer mode: the phone's model lifecycle never holds the composer", () => {
  test("missing, error, loading and checking states all send idle", () => {
    expect(phase({ remoteActive: true, modelState: "missing" })).toBe("idle");
    expect(phase({ remoteActive: true, modelState: "error" })).toBe("idle");
    expect(phase({ remoteActive: true, modelState: "loading" })).toBe("idle");
    expect(phase({ remoteActive: true, modelState: "checking" })).toBe("idle");
  });

  test("the phone's thermal CRITICAL gate does not refuse a computer send", () => {
    expect(phase({ remoteActive: true, thermalGated: true })).toBe("idle");
    // …while local mode still holds it: the gate is mode-scoped, not removed.
    expect(phase({ thermalGated: true })).toBe("tooHot");
  });

  test("history still settling and a live turn are unchanged in computer mode", () => {
    expect(phase({ remoteActive: true, historyLoaded: false })).toBe("loading");
    expect(phase({ remoteActive: true, sending: true, hasTokens: true, statusLabel: "Thinking" })).toBe("thinking");
    expect(phase({ remoteActive: true, converting: true })).toBe("converting");
  });
});

describe("the comments tell the truth about what holds", () => {
  test("the residency comment never claims only missing/dead bundles hold — error holds too", () => {
    // The behavior below the comment maps EVERY error to `unloaded`; a
    // comment promising a narrower hold sends the next reader to remove it.
    expect(MODULE_SOURCE).not.toContain("Only a genuinely missing or");
    expect(MODULE_SOURCE).toContain("A missing bundle or ANY");
    expect(phase({ modelState: "error" })).toBe("unloaded");
  });
});
