import {
  requireOptionalNativeModule,
  type EventSubscription,
} from "expo-modules-core";

export const THERMAL_STATE_DID_CHANGE = "thermalStateDidChange";

export interface PlatformThermalRead {
  platform: "android" | "ios" | null;
  supported: boolean;
  /** Android PowerManager status, when the Android API is supported. */
  androidStatus?: number | null;
  /** iOS ProcessInfo thermalState string, when the iOS API is supported. */
  iosState?: string | number | null;
}

type NativeKalsaThermalModule = {
  getCurrentThermalStateAsync?: () => Promise<unknown>;
  addListener?: (
    eventName: string,
    listener: (snapshot: unknown) => void,
  ) => EventSubscription;
};

let nativeModule: NativeKalsaThermalModule | null | undefined;

function getNativeModule(): NativeKalsaThermalModule | null {
  if (nativeModule !== undefined) return nativeModule;
  try {
    nativeModule =
      requireOptionalNativeModule<NativeKalsaThermalModule>("KalsaThermal") ??
      null;
  } catch {
    nativeModule = null;
  }
  return nativeModule;
}

/** Read the current OS thermal signal; null means the API is unavailable. */
export async function getCurrentPlatformThermalState(): Promise<PlatformThermalRead | null> {
  const module = getNativeModule();
  if (!module?.getCurrentThermalStateAsync) return null;
  try {
    const snapshot = await module.getCurrentThermalStateAsync();
    return normalizeSnapshot(snapshot);
  } catch {
    return null;
  }
}

/** Subscribe to native OS thermal status/state changes. */
export function addPlatformThermalListener(
  listener: (snapshot: PlatformThermalRead) => void,
): EventSubscription | null {
  const module = getNativeModule();
  if (!module?.addListener) return null;
  try {
    return module.addListener(THERMAL_STATE_DID_CHANGE, (snapshot) => {
      const normalized = normalizeSnapshot(snapshot);
      // An invalid native event is an unavailable signal, not permission to
      // keep an old gate alive indefinitely. Preserve the fail-open contract.
      listener(normalized ?? { platform: null, supported: false });
    });
  } catch {
    return null;
  }
}

/** True when the native module is linked; individual API calls can still fail. */
export function isPlatformThermalModuleAvailable(): boolean {
  return typeof getNativeModule()?.getCurrentThermalStateAsync === "function";
}

function normalizeSnapshot(value: unknown): PlatformThermalRead | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as Record<string, unknown>;
  if (snapshot.platform === "android") {
    return (
      typeof snapshot.supported === "boolean"
        ? {
            platform: "android",
            supported: snapshot.supported,
            androidStatus:
              snapshot.status === null || typeof snapshot.status === "number"
                ? (snapshot.status as number | null)
                : null,
          }
        : null
    );
  }
  if (snapshot.platform === "ios") {
    return (
      typeof snapshot.supported === "boolean"
        ? {
            platform: "ios",
            supported: snapshot.supported,
            iosState:
              snapshot.state === null ||
              typeof snapshot.state === "string" ||
              typeof snapshot.state === "number"
                ? (snapshot.state as string | number | null)
                : null,
          }
        : null
    );
  }
  if (snapshot.platform === "unsupported" && snapshot.supported === false) {
    return { platform: null, supported: false };
  }
  return null;
}
