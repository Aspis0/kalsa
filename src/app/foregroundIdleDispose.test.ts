import {
  FOREGROUND_IDLE_DISPOSE_MS,
  shouldRunForegroundIdleDispose,
} from "./foregroundIdleDispose";

describe("shouldRunForegroundIdleDispose", () => {
  test("quiet idle at 180s disposes; in-flight at 180s does not", () => {
    expect(
      shouldRunForegroundIdleDispose({
        engineReady: true,
        inFlight: false,
        idleMs: FOREGROUND_IDLE_DISPOSE_MS,
      }),
    ).toBe(true);
    expect(
      shouldRunForegroundIdleDispose({
        engineReady: true,
        inFlight: true,
        idleMs: FOREGROUND_IDLE_DISPOSE_MS,
      }),
    ).toBe(false);
  });

  test("in-flight never disposes, at 15 min or any wall-clock age", () => {
    // S23 T20C 2026-09-15: a healthy slow/thermal decode (KALSA_STALL=0)
    // was disposed by the old stuck-in-flight escape at exactly this age.
    const fifteenMinutes = 900_000;
    expect(
      shouldRunForegroundIdleDispose({
        engineReady: true,
        inFlight: true,
        idleMs: fifteenMinutes,
      }),
    ).toBe(false);
    const sixHours = 6 * 60 * 60 * 1000;
    expect(
      shouldRunForegroundIdleDispose({
        engineReady: true,
        inFlight: true,
        idleMs: sixHours,
      }),
    ).toBe(false);
    expect(
      shouldRunForegroundIdleDispose({
        engineReady: true,
        inFlight: true,
        idleMs: Number.MAX_SAFE_INTEGER,
      }),
    ).toBe(false);
  });

  test("quiet idle still disposes at any large age", () => {
    const sixHours = 6 * 60 * 60 * 1000;
    expect(
      shouldRunForegroundIdleDispose({
        engineReady: true,
        inFlight: false,
        idleMs: sixHours,
      }),
    ).toBe(true);
  });

  test("does not dispose when the engine is not ready", () => {
    expect(
      shouldRunForegroundIdleDispose({
        engineReady: false,
        inFlight: false,
        idleMs: FOREGROUND_IDLE_DISPOSE_MS,
      }),
    ).toBe(false);
    expect(
      shouldRunForegroundIdleDispose({
        engineReady: true,
        inFlight: false,
        idleMs: FOREGROUND_IDLE_DISPOSE_MS - 1,
      }),
    ).toBe(false);
  });
});
