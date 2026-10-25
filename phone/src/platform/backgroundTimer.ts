/**
 * Timers that keep working while the Android activity is paused: the RN
 * Timing-module timers behind plain setTimeout/setInterval are suspended on
 * host pause, which silently disarmed every engine watchdog (KALSA_STALL
 * never fired in the t20c-gate 2026-09-16 run for exactly this reason).
 * Lives in platform/ so the engine and the app shell can both depend on it
 * without an engine→app import.
 */
import {
  cancelNativeBackgroundTimer,
  isKalsaLifecycleAvailable,
  scheduleNativeBackgroundTimer,
  type NativeTimerHandle,
} from "../../modules/kalsa-lifecycle/src";

export type TimerHandle =
  | { kind: "native"; value: NativeTimerHandle }
  | { kind: "js"; value: ReturnType<typeof setTimeout> };

export type BackgroundTimer = ReturnType<typeof createBackgroundTimer>;

type NativeTimerPair = {
  schedule: typeof scheduleNativeBackgroundTimer;
  cancel: typeof cancelNativeBackgroundTimer;
};

const defaultNativePair: NativeTimerPair = {
  schedule: scheduleNativeBackgroundTimer,
  cancel: cancelNativeBackgroundTimer,
};

/** Choose the native paused-activity timer, or the regular JS fallback. */
export function createBackgroundTimer(
  nativePair: NativeTimerPair | null =
    isKalsaLifecycleAvailable() ? defaultNativePair : null,
) {
  return {
    setTimeout(run: () => void, delayMs: number): TimerHandle {
      const nativeHandle = nativePair?.schedule(run, delayMs) ?? null;
      if (nativeHandle) return { kind: "native", value: nativeHandle };
      return { kind: "js", value: globalThis.setTimeout(run, delayMs) };
    },
    clearTimeout(handle: TimerHandle): void {
      if (handle.kind === "native") {
        nativePair?.cancel(handle.value);
        return;
      }
      globalThis.clearTimeout(handle.value);
    },
    source: nativePair ? ("native" as const) : ("js" as const),
  };
}

/**
 * Repeating timer re-armed from a one-shot: runs can never pile up when one
 * overruns, and a run that calls stop() cancels its own pending re-arm.
 * Restartable — per-round watchdogs stop and start across a turn.
 */
export function createRepeatingTimer(input: {
  run: () => void;
  delayMs: number;
  timer: BackgroundTimer;
}): { start: () => void; stop: () => void } {
  let running = false;
  let handle: TimerHandle | null = null;
  const tick = () => {
    handle = null;
    input.run();
    if (!running) return;
    handle = input.timer.setTimeout(tick, input.delayMs);
  };
  return {
    start() {
      if (running || handle !== null) return;
      running = true;
      handle = input.timer.setTimeout(tick, input.delayMs);
    },
    stop() {
      running = false;
      if (handle !== null) {
        input.timer.clearTimeout(handle);
        handle = null;
      }
    },
  };
}
