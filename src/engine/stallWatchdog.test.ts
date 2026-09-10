import {
  createStallWatchdog,
  GENERATION_STALL_GAP_MS,
  MIN_DECODE_TOK_PER_SEC,
  RATE_GRACE_MS,
} from "./stallWatchdog";

describe("stall watchdog", () => {
  test("does not stall before the first token", () => {
    let now = 10_000;
    const watchdog = createStallWatchdog({
      gapMs: GENERATION_STALL_GAP_MS,
      now: () => now,
    });

    now += GENERATION_STALL_GAP_MS * 2;
    expect(watchdog.check()).toEqual({
      stalled: false,
      reason: "gap",
      gapMs: 0,
      tokPerSec: 0,
    });
  });

  test("stalls after the configured gap without tokens", () => {
    let now = 10_000;
    const watchdog = createStallWatchdog({
      gapMs: GENERATION_STALL_GAP_MS,
      now: () => now,
    });

    watchdog.noteToken();
    now += GENERATION_STALL_GAP_MS - 1;
    const beforeGap = watchdog.check();
    expect(beforeGap.stalled).toBe(false);
    expect(beforeGap.reason).toBe("gap");
    expect(beforeGap.gapMs).toBe(GENERATION_STALL_GAP_MS - 1);
    expect(beforeGap.tokPerSec).toBeCloseTo(
      1000 / (GENERATION_STALL_GAP_MS - 1),
      12,
    );
    now += 1;
    expect(watchdog.check()).toEqual({
      stalled: true,
      reason: "gap",
      gapMs: GENERATION_STALL_GAP_MS,
      tokPerSec: 1000 / GENERATION_STALL_GAP_MS,
    });
  });

  test("rate rule catches a sustained slow decode after its grace period", () => {
    let now = 10_000;
    const watchdog = createStallWatchdog({
      gapMs: GENERATION_STALL_GAP_MS,
      now: () => now,
    });

    watchdog.noteToken();
    now += 9_000;
    watchdog.noteToken();
    now += 9_000;
    watchdog.noteToken();
    now += 9_000;
    watchdog.noteToken();
    now += 3_000;
    const result = watchdog.check();
    expect(result.stalled).toBe(true);
    expect(result.reason).toBe("rate");
    expect(result.gapMs).toBe(3_000);
    expect(result.tokPerSec).toBeLessThan(MIN_DECODE_TOK_PER_SEC);
    expect(result.tokPerSec).toBe(4 / (RATE_GRACE_MS / 1000));
  });

  test("reset re-arms a fresh round", () => {
    let now = 10_000;
    const watchdog = createStallWatchdog({
      gapMs: GENERATION_STALL_GAP_MS,
      now: () => now,
    });

    watchdog.noteToken();
    now += GENERATION_STALL_GAP_MS;
    watchdog.reset();
    expect(watchdog.check()).toEqual({
      stalled: false,
      reason: "gap",
      gapMs: 0,
      tokPerSec: 0,
    });
    watchdog.noteToken();
    now += GENERATION_STALL_GAP_MS - 1;
    expect(watchdog.check().stalled).toBe(false);
  });
});
