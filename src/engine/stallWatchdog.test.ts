import {
  createStallWatchdog,
  GENERATION_STALL_GAP_MS,
  MIN_DECODE_TOK_PER_SEC,
  MIN_GAP_MS_BEFORE_RATE,
  MIN_TOKENS_BEFORE_RATE,
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

  test("does not stall on a 10.143s first-token think pause", () => {
    let now = 10_000;
    const watchdog = createStallWatchdog({
      gapMs: GENERATION_STALL_GAP_MS,
      now: () => now,
    });

    watchdog.noteToken();
    now += 10_143;
    const result = watchdog.check();
    expect(result.stalled).toBe(false);
    expect(result.reason).toBe("gap");
    expect(result.gapMs).toBe(10_143);
  });

  test("stalls after the configured 45s gap without tokens", () => {
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
    now += 1;
    expect(watchdog.check()).toEqual({
      stalled: true,
      reason: "gap",
      gapMs: GENERATION_STALL_GAP_MS,
      tokPerSec: 0,
    });
  });

  test("does not stall on 8 tokens every 3s", () => {
    let now = 10_000;
    const watchdog = createStallWatchdog({
      gapMs: GENERATION_STALL_GAP_MS,
      now: () => now,
    });

    const stepMs = 3_000;
    watchdog.noteToken();
    for (let i = 1; i < MIN_TOKENS_BEFORE_RATE; i += 1) {
      now += stepMs;
      watchdog.noteToken();
    }
    const atArrival = watchdog.check();
    expect(atArrival.stalled).toBe(false);
    expect(atArrival.gapMs).toBe(0);
    expect(atArrival.tokPerSec).toBeCloseTo(1 / 3, 12);
    expect(atArrival.tokPerSec).toBeGreaterThan(MIN_DECODE_TOK_PER_SEC);

    now += MIN_GAP_MS_BEFORE_RATE;
    const afterGap = watchdog.check();
    expect(afterGap.stalled).toBe(false);
    expect(afterGap.gapMs).toBe(MIN_GAP_MS_BEFORE_RATE);
    expect(afterGap.tokPerSec).toBeCloseTo(1 / 3, 12);
  });

  test("does not rate-stall a live think at 0.166 tok/s with a 1.8s gap", () => {
    let now = 10_000;
    const watchdog = createStallWatchdog({
      gapMs: GENERATION_STALL_GAP_MS,
      now: () => now,
    });

    // T20D: 7/42s ≈ 0.166 tok/s, gapMs=1812.
    const stepMs = 6_000;
    watchdog.noteToken();
    for (let i = 1; i < MIN_TOKENS_BEFORE_RATE; i += 1) {
      now += stepMs;
      watchdog.noteToken();
    }
    now += 1_812;
    const result = watchdog.check();
    expect(result.stalled).toBe(false);
    expect(result.gapMs).toBe(1_812);
    expect(result.tokPerSec).toBeCloseTo(7 / 42_000 * 1000, 8);
    expect(result.tokPerSec).toBeLessThan(MIN_DECODE_TOK_PER_SEC);
  });

  test("stalls on trailing 8 tokens slower than 0.2 tok/s with reason rate", () => {
    let now = 10_000;
    const watchdog = createStallWatchdog({
      gapMs: GENERATION_STALL_GAP_MS,
      now: () => now,
    });

    // 20 s/token → 0.05 tok/s. Pathological 0.058 tok/s is the same class.
    const stepMs = 20_000;
    watchdog.noteToken();
    for (let i = 1; i < MIN_TOKENS_BEFORE_RATE - 1; i += 1) {
      now += stepMs;
      watchdog.noteToken();
    }
    now += MIN_GAP_MS_BEFORE_RATE;
    const beforeEnough = watchdog.check();
    expect(beforeEnough.stalled).toBe(false);
    expect(beforeEnough.tokPerSec).toBeLessThan(MIN_DECODE_TOK_PER_SEC);

    now += stepMs - MIN_GAP_MS_BEFORE_RATE;
    watchdog.noteToken();
    const atArrival = watchdog.check();
    expect(atArrival.stalled).toBe(false);
    expect(atArrival.gapMs).toBe(0);
    expect(atArrival.tokPerSec).toBeCloseTo(1 / 20, 12);
    expect(atArrival.tokPerSec).toBeLessThan(MIN_DECODE_TOK_PER_SEC);

    now += MIN_GAP_MS_BEFORE_RATE;
    const result = watchdog.check();
    expect(result.stalled).toBe(true);
    expect(result.reason).toBe("rate");
    expect(result.gapMs).toBe(MIN_GAP_MS_BEFORE_RATE);
    expect(result.tokPerSec).toBeCloseTo(1 / 20, 12);
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
