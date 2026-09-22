/**
 * The tap-state table of the model pill (D1 row 33, controller
 * `AppShell.tsx:6874-6911`) — the semantics the brief says were "measured
 * once already": download if missing, retry if error, load if ready-but-
 * unloaded; disabled while downloading/loading/checking and while fully
 * resident; INERT whenever the embedder is hung, in every state, because
 * behind a hung native op even the download button must not pretend.
 */
import { decideModelPress } from "./modelBarPress";
import type { ModelPipelineState } from "../app/AppShell";

function press(overrides: Partial<Parameters<typeof decideModelPress>[0]> = {}) {
  return decideModelPress({
    modelState: "ready",
    errorKind: null,
    resident: false,
    hung: false,
    ...overrides,
  });
}

const ALL_STATES: ModelPipelineState[] = [
  "checking",
  "missing",
  "downloading",
  "loading",
  "error",
  "ready",
];

describe("missing → download", () => {
  it("is the one state whose answer is the confirm dialog", () => {
    expect(press({ modelState: "missing" })).toEqual({
      action: "download",
      control: "enabled",
    });
  });
});

describe("error → the failure kind picks the door", () => {
  it("a download failure re-runs the transfer", () => {
    expect(press({ modelState: "error", errorKind: "download" })).toEqual({
      action: "download",
      control: "enabled",
    });
  });
  it("an engine failure retries the load, never the bytes", () => {
    expect(press({ modelState: "error", errorKind: "engine" })).toEqual({
      action: "reload",
      control: "enabled",
    });
  });
  it("a null kind counts as download failure (controller default branch)", () => {
    expect(press({ modelState: "error", errorKind: null }).action).toBe("download");
  });
});

describe("ready → only the unloaded residency is tappable", () => {
  it("resident + ready is inert-but-visible: disabled, no action", () => {
    expect(press({ modelState: "ready", resident: true })).toEqual({
      action: "none",
      control: "disabled",
    });
  });
  it("downloaded-but-unloaded reloads — HIGH-2: never auto-loads", () => {
    expect(press({ modelState: "ready", resident: false })).toEqual({
      action: "reload",
      control: "enabled",
    });
  });
});

describe("the busy states never answer a tap", () => {
  for (const modelState of ["checking", "downloading", "loading"] as const) {
    it(`${modelState} is disabled with no action`, () => {
      expect(press({ modelState })).toEqual({ action: "none", control: "disabled" });
    });
  }
});

describe("the hung embedder outranks every state", () => {
  for (const modelState of ALL_STATES) {
    it(`${modelState} + hung → inert, no action`, () => {
      expect(press({ modelState, hung: true })).toEqual({
        action: "none",
        control: "inert",
      });
    });
  }

  it("inert is the only control state that also drops the pointer channel (Shell)", () => {
    // The shell maps `inert` to pointerEvents="none" and `disabled` to the
    // Pressable's disabled — pin the three-state vocabulary the view reads.
    const states = new Set(
      ALL_STATES.flatMap((modelState) =>
        ["hung", "not"].map(
          (flag) => press({ modelState, hung: flag === "hung" }).control,
        ),
      ),
    );
    expect([...states].sort()).toEqual(["disabled", "enabled", "inert"]);
  });
});
