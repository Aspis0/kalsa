import {
  FOREGROUND_IDLE_DISPOSE_MS,
  FOREGROUND_STUCK_INFLIGHT_MS,
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

  test("in-flight at 15 min is stuck and may dispose", () => {
    expect(
      shouldRunForegroundIdleDispose({
        engineReady: true,
        inFlight: true,
        idleMs: FOREGROUND_STUCK_INFLIGHT_MS,
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
