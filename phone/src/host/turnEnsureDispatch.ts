import type { ModelInfo } from "../engine/ModelRegistry";

/** Keep sends on the model host's local/remote ensure dispatcher. */
export function createTurnEnsure(
  ensureRef: { current: (model: ModelInfo) => Promise<boolean> },
): (model: ModelInfo) => Promise<boolean> {
  return (model) => ensureRef.current(model);
}
