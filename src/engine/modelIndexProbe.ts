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
