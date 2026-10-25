import { decideModelIndexProbe } from "../engine/modelIndexProbe";

export type RemoteHostProbeAction = "skip" | "ensure-remote" | "probe-local";

/** Mirror the controller's cache-versus-intent probe gate using host state. */
export function decideRemoteHostProbe(input: {
  prefsReady: boolean;
  switchInFlight: boolean;
  backendRemote: boolean;
  remoteActive: boolean;
  remoteReady: boolean;
}): RemoteHostProbeAction {
  if (!input.prefsReady) return "skip";
  const decision = decideModelIndexProbe({
    switchInFlight: input.switchInFlight,
    backendRemote: input.backendRemote,
    intentRemote: input.remoteActive,
  });
  if (decision.action === "probe-local") return "probe-local";
  if (decision.action === "ensure-remote" && !input.remoteReady) return "ensure-remote";
  return "skip";
}
