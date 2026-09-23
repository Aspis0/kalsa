/**
 * What the modelIndex presence/eager effect may do. During a remote→local
 * switch backendCache can still be remote while the user intent is already
 * local — never follow the cache or start ensure/initEngine in that window.
 */

export type ModelIndexProbeInput = {
  switchInFlight: boolean;
  backendRemote: boolean;
  intentRemote: boolean;
};

export type ModelIndexProbeDecision =
  | { action: "skip" }
  | { action: "ensure-remote" }
  | { action: "probe-local" };

export function decideModelIndexProbe(
  input: ModelIndexProbeInput,
): ModelIndexProbeDecision {
  if (input.switchInFlight) return { action: "skip" };
  // User picked local: do not overwrite that intent from a stale remote cache.
  if (!input.intentRemote && input.backendRemote) return { action: "skip" };
  if (input.intentRemote) return { action: "ensure-remote" };
  return { action: "probe-local" };
}

export function canEagerInitLocal(input: {
  switchInFlight: boolean;
  backendRemote: boolean;
}): boolean {
  return !input.switchInFlight && !input.backendRemote;
}

/** Remote keeps the previous local modelIndex; selecting that row must still switch. */
export function shouldNoopLocalSelect(input: {
  nextIndex: number;
  currentIndex: number;
  remoteActive: boolean;
}): boolean {
  if (input.remoteActive) return false;
  return input.nextIndex === input.currentIndex;
}

export function shouldReprobeAfterSwitch(disposeOk: boolean): boolean {
  return disposeOk === true;
}

/** Timeout, rejection, or any failed dispose: error UI, no reprobe, remoteActive off. */
export function switchDisposeUi(disposeOk: boolean): {
  reprobe: boolean;
  remoteActive: false;
  surfaceError: boolean;
} {
  return {
    reprobe: disposeOk === true,
    remoteActive: false,
    surfaceError: disposeOk !== true,
  };
}

/** selectRemoteComputer dispose: failures take the K3 error path; in-flight always released. */
export function afterRemoteSwitchDispose(ok: boolean): {
  surfaceError: boolean;
  remoteActive: boolean;
  reprobe: false;
  inFlightReleased: true;
} {
  if (ok) {
    return {
      surfaceError: false,
      remoteActive: true,
      reprobe: false,
      inFlightReleased: true,
    };
  }
  return {
    surfaceError: true,
    remoteActive: false,
    reprobe: false,
    inFlightReleased: true,
  };
}
