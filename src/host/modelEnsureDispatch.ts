import type { ModelInfo } from "../engine/ModelRegistry";

/** Bind one model host's local and remote ensure paths to the model identity. */
export function createModelEnsureDispatch(
  remoteModelId: string,
  ensureRemote: () => Promise<boolean>,
  ensureLocal: (model: ModelInfo) => Promise<boolean>,
): (model: ModelInfo) => Promise<boolean> {
  return (model) => model.id === remoteModelId ? ensureRemote() : ensureLocal(model);
}
