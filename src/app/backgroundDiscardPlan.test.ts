import { backgroundDiscardPlan } from "./backgroundDiscardPlan";

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
});
