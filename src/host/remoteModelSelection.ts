import type { ModelPipelineState } from "./hostPipelineState";

export type RemoteModelSelectionRefusal = "busy" | "turn-active" | "documents-busy";

export function remoteModelSelectionRefusal(input: {
  downloadBusy: boolean;
  switchBusy: boolean;
  modelState: ModelPipelineState;
  streaming: boolean;
  regenerating: boolean;
  semanticRebuildBusy: boolean;
  documentDeleteBusy: boolean;
}): RemoteModelSelectionRefusal | null {
  if (
    input.downloadBusy ||
    input.switchBusy ||
    input.modelState === "downloading" ||
    input.modelState === "loading"
  ) {
    return "busy";
  }
  if (input.streaming || input.regenerating) return "turn-active";
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
    if (refusal !== "busy") onRefusal(refusal);
    return false;
  }
  dispatch();
  return true;
}
