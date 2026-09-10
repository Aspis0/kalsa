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

/** Subscribe to Android ComponentCallbacks2 trim-memory events. */
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

function readNumber(value: unknown, key: string): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "number" ? candidate : null;
}
