import {
  backgroundDiscardPlan,
  skipDisposeWhileInFlight,
} from "./backgroundDiscardPlan";

describe("backgroundDiscardPlan", () => {
  test("saves at a new background entry and schedules disposal", () => {
    expect(
      backgroundDiscardPlan({
        state: "background",
        pendingGrace: false,
        genAtEntry: 4,
        genNow: 4,
        pressure: false,
      }),
    ).toEqual({
      saveNow: true,
      scheduleDispose: true,
      disposeNow: false,
      skipReason: null,
    });
  });

  test("does nothing for a second background while grace is pending", () => {
    expect(
      backgroundDiscardPlan({
        state: "background",
        pendingGrace: true,
        genAtEntry: 4,
        genNow: 4,
        pressure: false,
      }),
    ).toEqual({ saveNow: false, scheduleDispose: false, disposeNow: false, skipReason: null });
  });

  test("foreground cancels without starting a discard", () => {
    expect(
      backgroundDiscardPlan({
        state: "active",
        pendingGrace: true,
        genAtEntry: 4,
        genNow: 4,
        pressure: false,
      }),
    ).toEqual({ saveNow: false, scheduleDispose: false, disposeNow: false, skipReason: null });
  });

  test("expires into disposal when the captured generation is current", () => {
    expect(
      backgroundDiscardPlan({
        state: "background_expired",
        pendingGrace: false,
        genAtEntry: 4,
        genNow: 4,
        pressure: false,
      }).disposeNow,
    ).toBe(true);
  });

  test("pressure disposes immediately while still backgrounded", () => {
    expect(
      backgroundDiscardPlan({
        state: "background",
        pendingGrace: true,
        genAtEntry: 4,
        genNow: 4,
        pressure: true,
      }).disposeNow,
    ).toBe(true);
  });

  test("skips foreground pressure and a newer generation", () => {
    expect(
      backgroundDiscardPlan({
        state: "active",
        pendingGrace: true,
        genAtEntry: 4,
        genNow: 4,
        pressure: true,
      }).skipReason,
    ).toBe("foreground");
    expect(
      backgroundDiscardPlan({
        state: "background_expired",
        pendingGrace: false,
        genAtEntry: 4,
        genNow: 5,
        pressure: false,
      }).skipReason,
    ).toBe("newer_gen");
  });

  test("idle expiry disposes while still foreground", () => {
    expect(
      backgroundDiscardPlan({
        state: "idle_expired",
        pendingGrace: false,
        genAtEntry: 4,
        genNow: 4,
        pressure: false,
      }).disposeNow,
    ).toBe(true);
  });

  test("background/trim in-flight still dispose; idle in-flight always blocks", () => {
    expect(
      skipDisposeWhileInFlight({ inFlight: true, kind: "background" }),
    ).toBe(false);
    expect(
      skipDisposeWhileInFlight({ inFlight: true, kind: "trim" }),
    ).toBe(false);
    expect(
      skipDisposeWhileInFlight({ inFlight: true, kind: "idle" }),
    ).toBe(true);
    expect(
      skipDisposeWhileInFlight({ inFlight: false, kind: "idle" }),
    ).toBe(false);
  });

  test("idle second in-flight check blocks dispose with no stuck-age escape", () => {
    // The old stuckExpired escape (S23 T20C 2026-09-15 turn 9) let the
    // deferred idle dispose proceed once the idle window crossed 15 min.
    // The parameter is gone (compile-enforced); any in-flight state must
    // still block the idle unload at dispose time.
    for (const kind of ["idle"] as const) {
      expect(skipDisposeWhileInFlight({ inFlight: true, kind })).toBe(true);
    }
  });
});
