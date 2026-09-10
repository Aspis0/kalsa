import {
  cancelNativeBackgroundTimer,
  isKalsaLifecycleAvailable,
  scheduleNativeBackgroundTimer,
  type NativeTimerHandle,
} from "../../modules/kalsa-lifecycle/src";

type NativeTimerPair = {
  schedule: typeof scheduleNativeBackgroundTimer;
  cancel: typeof cancelNativeBackgroundTimer;
};

type TimerHandle =
  | { kind: "native"; value: NativeTimerHandle }
  | { kind: "js"; value: ReturnType<typeof setTimeout> };

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
