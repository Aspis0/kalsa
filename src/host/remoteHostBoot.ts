import {
  decideRemoteBoot,
  type RemoteBootDecision,
} from "../engine/remote/remoteBoot";
import type { RemoteBrainSnapshot } from "../engine/remote/remoteSettings";

export type RemoteHostBootPlan =
  | { kind: "switch-in-flight" }
  | { kind: "remote"; decision: Extract<RemoteBootDecision, { kind: "remote" }> }
  | {
      kind: "deferred-remote";
      decision: Extract<RemoteBootDecision, { kind: "remote" }>;
      restoreModelId: string;
    }
  | {
      kind: "local";
      decision: Extract<RemoteBootDecision, { kind: "local" }>;
      restoreModelId: string;
      persistRemoteDemotion: boolean;
    };

export function planRemoteHostBoot(input: {
  snapshot: Pick<RemoteBrainSnapshot, "backend" | "url" | "hydrationOk">;
  hydrationStale: boolean;
  savedModelId: string | null;
  defaultLocalModelId: string;
  remoteModelId: string;
  modelSwitchInFlight: boolean;
  semanticRebuildBusy: boolean;
  documentDeleteBusy: boolean;
}): RemoteHostBootPlan {
  if (input.modelSwitchInFlight) return { kind: "switch-in-flight" };
  const decision = decideRemoteBoot({
    hydrationOk: input.snapshot.hydrationOk,
    hydrationStale: input.hydrationStale,
    backend: input.snapshot.backend,
    url: input.snapshot.url,
    savedModelId: input.savedModelId,
    defaultLocalModelId: input.defaultLocalModelId,
    remoteModelId: input.remoteModelId,
  });
  if (decision.kind === "remote") {
    if (input.semanticRebuildBusy || input.documentDeleteBusy) {
      return {
        kind: "deferred-remote",
        decision,
        restoreModelId:
          input.savedModelId && input.savedModelId !== input.remoteModelId
            ? input.savedModelId
            : input.defaultLocalModelId,
      };
    }
    return { kind: "remote", decision };
  }
  return {
    kind: "local",
    decision,
    restoreModelId: decision.persistModelId,
    persistRemoteDemotion:
      decision.reason === "orphan" &&
      input.savedModelId === input.remoteModelId,
  };
}

export async function pickHostBootModel(
  plan: RemoteHostBootPlan,
  pick: (savedModelId: string) => Promise<string | null>,
): Promise<string | null> {
  if (plan.kind === "remote" || plan.kind === "switch-in-flight") return null;
  return pick(plan.restoreModelId);
}
