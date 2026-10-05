import type { ModelPipelineState } from "./hostPipelineState";

export type RemoteModelSelectionRefusal = "busy" | "turn-active" | "documents-busy";

export function remoteModelSelectionRefusal(input: {
  downloadBusy: boolean;
  switchBusy: boolean;
  modelState: ModelPipelineState;
  streaming: boolean;
  regenerating: boolean;
  /** A send holds its pre-await claim (fit gate): the turn has begun even
   *  though `streamInFlightRef` has not been raised yet. */
  sendClaim: boolean;
  /** The turn-end memory extract owns the engine; a dispose would kill it. */
  memoryExtract: boolean;
  semanticRebuildBusy: boolean;
  documentDeleteBusy: boolean;
}): RemoteModelSelectionRefusal | null {
  if (
    input.downloadBusy ||
    input.switchBusy ||
    input.modelState === "downloading" ||
    input.modelState === "loading" ||
    // Engine work with no stream of its own: it must finish (or be waited
    // out) before a switch's dispose takes the model away.
    input.memoryExtract
  ) {
    return "busy";
  }
  if (input.streaming || input.regenerating || input.sendClaim) return "turn-active";
  if (input.semanticRebuildBusy || input.documentDeleteBusy) return "documents-busy";
  return null;
}

/** The callback used by the model row; refusal never dispatches a backend flip. */
export function trySelectRemoteComputer(
  input: Parameters<typeof remoteModelSelectionRefusal>[0],
  onRefusal: (reason: RemoteModelSelectionRefusal) => void,
  dispatch: () => void,
): boolean {
  const refusal = remoteModelSelectionRefusal(input);
  if (refusal) {
    onRefusal(refusal);
    return false;
  }
  dispatch();
  return true;
}
