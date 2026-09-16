jest.mock("expo-modules-core", () => ({
  requireOptionalNativeModule: () => null,
}));

import type { NativeTimerHandle } from "../../modules/kalsa-lifecycle/src";
import {
  createBackgroundTimer,
  createRepeatingTimer,
} from "./backgroundTimer";
import {
  createStallWatchdog,
  GENERATION_STALL_GAP_MS,
} from "../engine/stallWatchdog";

/**
 * Native timer pair backed by a manual clock. Nothing here touches the JS
 * timer queue, so a test that passes while JS timers never run reproduces the
 * paused-host condition that silenced KALSA_STALL in t20c-gate 2026-09-16.
 */
function fakeNativePair() {
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, { run: () => void; dueAt: number }>();
  return {
    now: () => now,
    pair: {
      schedule: (run: () => void, delayMs: number): NativeTimerHandle => {
        const id = nextId++;
        pending.set(id, { run, dueAt: now + delayMs });
        return { id, subscription: { remove: jest.fn() } };
      },
      cancel: (handle: NativeTimerHandle) => {
        pending.delete(handle.id);
      },
    },
    /** Fire every due native timer in due order; `now` tracks each fire. */
    advance: (ms: number) => {
      const end = now + ms;
      for (;;) {
        let nextId: number | null = null;
        let nextDue = Number.POSITIVE_INFINITY;
        for (const [id, job] of pending) {
          if (job.dueAt <= end && job.dueAt < nextDue) {
            nextId = id;
            nextDue = job.dueAt;
          }
        }
        if (nextId === null) break;
        now = nextDue;
        const job = pending.get(nextId)!;
        pending.delete(nextId);
        job.run();
      }
      now = end;
    },
    pendingCount: () => pending.size,
  };
}

describe("createBackgroundTimer", () => {
  test("uses the native pair when present", () => {
    const handle = { id: 7, subscription: { remove: jest.fn() } };
    const schedule = jest.fn(() => handle);
    const cancel = jest.fn();
    const timer = createBackgroundTimer({ schedule, cancel });
    const run = jest.fn();

    const nativeHandle = timer.setTimeout(run, 45000);

    expect(nativeHandle.kind).toBe("native");
    expect(schedule).toHaveBeenCalledWith(run, 45000);
    expect(timer.source).toBe("native");
  });

  test("falls back to JS when the native pair is null", () => {
    jest.useFakeTimers();
    const timer = createBackgroundTimer(null);
    const run = jest.fn();

    const jsHandle = timer.setTimeout(run, 10);
    jest.advanceTimersByTime(10);

    expect(jsHandle.kind).toBe("js");
    expect(run).toHaveBeenCalledTimes(1);
    expect(timer.source).toBe("js");
    jest.useRealTimers();
  });

  test("routes cancellation to the matching scheduler", () => {
    jest.useFakeTimers();
    const nativeHandle = { id: 8, subscription: { remove: jest.fn() } };
    const cancel = jest.fn();
    const nativeTimer = createBackgroundTimer({
      schedule: jest.fn(() => nativeHandle),
      cancel,
    });
    const jsTimer = createBackgroundTimer(null);
    const native = nativeTimer.setTimeout(jest.fn(), 1);
    const js = jsTimer.setTimeout(jest.fn(), 1);

    nativeTimer.clearTimeout(native);
    jsTimer.clearTimeout(js);

    expect(cancel).toHaveBeenCalledWith(nativeHandle);
    expect(nativeHandle.subscription.remove).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });
});

describe("createRepeatingTimer on native timers", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("stall watchdog fires while the JS timer queue is never pumped", () => {
    // t20c-gate 2026-09-16: the engine's KALSA_STALL watchdogs ran on plain
    // RN timers, suspended while the host was paused — a wedged prefill hung
    // 30+ min with the prefill deadline armed but never fired. This is the
    // same wiring on the native pair: silence past GENERATION_STALL_GAP_MS
    // must be detected with zero JS timers scheduled.
    const fake = fakeNativePair();
    const turnTimer = createBackgroundTimer(fake.pair);
    const stall = createStallWatchdog({
      gapMs: GENERATION_STALL_GAP_MS,
      now: () => fake.now(),
    });
    let stallFired = false;
    const stallTimer = createRepeatingTimer({
      run: () => {
        if (stall.check().stalled) stallFired = true;
      },
      delayMs: 2_000,
      timer: turnTimer,
    });

    stall.noteToken(); // first token: decode began, watchdog arms
    stallTimer.start();
    // Synchronous advance: only native timers can fire here — a JS-timer
    // fallback could never run inside this block, so a pass proves the
    // native path drove the watchdog with the JS queue untouched.
    fake.advance(60_000); // host paused, decode silent, only native timers run

    expect(stallFired).toBe(true);
    expect(fake.pendingCount()).toBe(1); // watchdog keeps ticking for the turn
  });

  test("a generating turn keeps the gap under the limit and never trips", () => {
    const fake = fakeNativePair();
    const turnTimer = createBackgroundTimer(fake.pair);
    const stall = createStallWatchdog({
      gapMs: GENERATION_STALL_GAP_MS,
      now: () => fake.now(),
    });
    let stallFired = false;
    const stallTimer = createRepeatingTimer({
      run: () => {
        if (stall.check().stalled) stallFired = true;
      },
      delayMs: 2_000,
      timer: turnTimer,
    });

    stall.noteToken();
    stallTimer.start();
    // Healthy thermal decode: a token every 5 s, plus one 21.7 s pause — the
    // longest healthy gap observed (Jelly t20c-gate turn 4). Ten minutes of
    // this must never look stalled.
    for (let elapsed = 0; elapsed < 540_000; elapsed += 5_000) {
      fake.advance(5_000);
      stall.noteToken();
    }
    expect(stallFired).toBe(false);
    fake.advance(21_700);
    expect(stallFired).toBe(false);
    stall.noteToken();
    fake.advance(5_000);
    expect(stallFired).toBe(false);
  });

  test("stop cancels the pending native timer exactly — no late run", () => {
    const fake = fakeNativePair();
    const timer = createBackgroundTimer(fake.pair);
    const run = jest.fn();
    const repeating = createRepeatingTimer({ run, delayMs: 2_000, timer });

    repeating.start();
    fake.advance(2_000);
    expect(run).toHaveBeenCalledTimes(1);

    repeating.stop();
    fake.advance(60_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(fake.pendingCount()).toBe(0);
  });

  test("a run that stops inside its own callback does not re-arm", () => {
    const fake = fakeNativePair();
    const timer = createBackgroundTimer(fake.pair);
    let runs = 0;
    const repeating = createRepeatingTimer({
      run: () => {
        runs += 1;
        repeating.stop();
      },
      delayMs: 2_000,
      timer,
    });

    repeating.start();
    fake.advance(60_000);

    expect(runs).toBe(1);
    expect(fake.pendingCount()).toBe(0);
  });

  test("start is idempotent while armed and restarts after stop", () => {
    const fake = fakeNativePair();
    const timer = createBackgroundTimer(fake.pair);
    const run = jest.fn();
    const repeating = createRepeatingTimer({ run, delayMs: 2_000, timer });

    repeating.start();
    repeating.start();
    expect(fake.pendingCount()).toBe(1);

    fake.advance(2_000);
    expect(run).toHaveBeenCalledTimes(1);

    repeating.stop();
    repeating.start();
    expect(fake.pendingCount()).toBe(1);
    fake.advance(2_000);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
