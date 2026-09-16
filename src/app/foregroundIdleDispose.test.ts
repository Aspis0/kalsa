import {
  FOREGROUND_IDLE_DISPOSE_MS,
  FOREGROUND_STUCK_INFLIGHT_MS,
  FOREGROUND_TOKEN_SILENCE_MS,
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

  test("slow-but-producing turn never disposes, however old the turn is", () => {
    // S23 T20C 2026-09-15 lost turn 9 to a wall-clock disposal while the
    // stream was healthy; liveness is the last token, not the turn age.
    const sixHours = 6 * 60 * 60 * 1000;
    const justUnderSilence = FOREGROUND_TOKEN_SILENCE_MS - 1;
    expect(
      shouldRunForegroundIdleDispose({
        engineReady: true,
        inFlight: true,
        idleMs: sixHours,
        tokenSilenceMs: justUnderSilence,
      }),
    ).toBe(false);
    expect(
      shouldRunForegroundIdleDispose({
        engineReady: true,
        inFlight: true,
        idleMs: Number.MAX_SAFE_INTEGER,
        tokenSilenceMs: 0,
      }),
    ).toBe(false);
  });

  test("a decoding turn silent past 45s disposes", () => {
    // t20c-gate 2026-09-16: max healthy inter-token gap was 21.7s (turn 4),
    // so 45s of decode silence is a stall, not thermal slowness.
    expect(
      shouldRunForegroundIdleDispose({
        engineReady: true,
        inFlight: true,
        idleMs: FOREGROUND_IDLE_DISPOSE_MS,
        tokenSilenceMs: FOREGROUND_TOKEN_SILENCE_MS,
      }),
    ).toBe(true);
  });

  test("in-flight with no token yet disposes at the 15 min stuck net", () => {
    // t20c-gate 2026-09-16 turns 2/3: native loadPrompt wedged pre-token for
    // 30+ min; the engine's KALSA_STALL timers cannot run while the host is
    // paused, so this net is the only recovery for that window.
    expect(
      shouldRunForegroundIdleDispose({
        engineReady: true,
        inFlight: true,
        idleMs: FOREGROUND_STUCK_INFLIGHT_MS - 1,
      }),
    ).toBe(false);
    expect(
      shouldRunForegroundIdleDispose({
        engineReady: true,
        inFlight: true,
        idleMs: FOREGROUND_STUCK_INFLIGHT_MS,
      }),
    ).toBe(true);
    expect(
      shouldRunForegroundIdleDispose({
        engineReady: true,
        inFlight: true,
        idleMs: Number.MAX_SAFE_INTEGER,
      }),
    ).toBe(true);
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
