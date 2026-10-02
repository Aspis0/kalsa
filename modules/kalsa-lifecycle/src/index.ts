import {
  requireOptionalNativeModule,
  type EventSubscription,
} from "expo-modules-core";

const BACKGROUND_TIMER_DID_FIRE = "backgroundTimerDidFire";
const TRIM_MEMORY = "trimMemory";

type NativeKalsaLifecycleModule = {
  addListener?: (
    eventName: string,
    listener: (event: unknown) => void,
  ) => EventSubscription;
  startBackgroundTimer?: (delayMs: number) => number;
  cancelBackgroundTimer?: (id: number) => void;
  /**
   * Apple side: os_proc_available_memory() as bytes (jetsam headroom). On
   * device a 0 crosses unchanged; the simulator build substitutes null for
   * a 0 read; the iPad-on-Mac build is not covered and is unmeasured.
   */
  availableMemoryBytes?: () => Promise<unknown>;
};

export type NativeTimerHandle = {
  id: number;
  subscription: EventSubscription;
};

// Android ComponentCallbacks2 threshold used by the lifecycle bridge.
export const TRIM_MEMORY_BACKGROUND = 40;

let nativeModule: NativeKalsaLifecycleModule | undefined;

function getNativeModule(): NativeKalsaLifecycleModule | null {
  if (nativeModule !== undefined) return nativeModule;
  try {
    const module = requireOptionalNativeModule<NativeKalsaLifecycleModule>(
      "KalsaLifecycle",
    );
    if (module) nativeModule = module;
    return module ?? null;
  } catch {
    return null;
  }
}

/** True when the native timer and event surface is linked and callable. */
export function isKalsaLifecycleAvailable(): boolean {
  const module = getNativeModule();
  return Boolean(
    module?.addListener &&
      module.startBackgroundTimer &&
      module.cancelBackgroundTimer,
  );
}

/** Schedule a native timer, or return null so callers can use JS timers. */
export function scheduleNativeBackgroundTimer(
  run: () => void,
  delayMs: number,
): NativeTimerHandle | null {
  const module = getNativeModule();
  if (
    !module?.addListener ||
    !module.startBackgroundTimer ||
    !module.cancelBackgroundTimer
  ) {
    return null;
  }

  let id: number | null = null;
  let fired = false;
  let subscription: EventSubscription | null = null;
  try {
    subscription = module.addListener(BACKGROUND_TIMER_DID_FIRE, (event) => {
      const eventId = readNumber(event, "id");
      if (fired || id === null || eventId !== id) return;
      fired = true;
      subscription?.remove();
      run();
    });
    id = module.startBackgroundTimer(delayMs);
    return { id, subscription };
  } catch {
    subscription?.remove();
    return null;
  }
}

/** Cancel a native timer and stop listening for its event. */
export function cancelNativeBackgroundTimer(handle: NativeTimerHandle): void {
  const module = getNativeModule();
  try {
    module?.cancelBackgroundTimer?.(handle.id);
  } catch {
    // Native teardown is best effort; always remove the JS subscription.
  }
  try {
    handle.subscription.remove();
  } catch {
    // A subscription may already have removed itself after firing.
  }
}

/** Subscribe to Android ComponentCallbacks2 trim-memory events. Android-only
 *  by definition: the Apple lifecycle module deliberately does not re-emit
 *  UIKit's memory warning on this event (its coarse warning is not on the
 *  Android trim-level scale, and nothing consumed the mapping). */
export function addTrimMemoryListener(
  listener: (level: number) => void,
): EventSubscription | null {
  const module = getNativeModule();
  if (!module?.addListener) return null;
  try {
    return module.addListener(TRIM_MEMORY, (event) => {
      const level = readNumber(event, "level");
      if (level !== null) listener(level);
    });
  } catch {
    return null;
  }
}

/**
 * Apple side: os_proc_available_memory() — the per-app jetsam headroom in
 * bytes, the closest iOS analog of Android's MemAvailable. On device, 0 is a
 * REAL reading (Apple: the app is at/over its memory limit) and reaches
 * callers as 0, never as null. On the simulator the native side returns nil
 * for a 0 read, so callers see null = unknown there; the iPad-on-Mac build is
 * not covered by that substitution and is unmeasured. Otherwise null means
 * the module is not linked or the read is malformed. Never throws. Never
 * cached — Apple documents the value as a fast-changing snapshot and says
 * not to cache it.
 */
export async function getOsAvailableMemoryBytes(): Promise<number | null> {
  const module = getNativeModule();
  if (!module?.availableMemoryBytes) return null;
  try {
    const value = await module.availableMemoryBytes();
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function readNumber(value: unknown, key: string): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "number" ? candidate : null;
}
