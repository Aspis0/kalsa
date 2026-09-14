/**
 * Caller-side generation + model/backend intent for ensureEngineForModel.
 * Capture before the first await; a mismatch means the ensure is stale and
 * must not commit (especially setEngineBackendMode("remote")).
 *
 * `remote` is part of the INTENT (the model this ensure was asked for), not a
 * read of the live backend: the backend flips during the ensure, and this
 * module stays pure (no AsyncStorage in the import graph).
 */
import {
  isRemoteComputerModelId,
  REMOTE_COMPUTER_MODEL_ID,
} from "./remote/remoteComputerModel";

export type EnsureIntent = {
  generation: number;
  modelId: string;
  remote: boolean;
};

export function captureEnsureIntent(
  generation: number,
  modelId: string,
): EnsureIntent {
  return { generation, modelId, remote: isRemoteComputerModelId(modelId) };
}

export function ensureIntentStale(
  captured: EnsureIntent,
  live: EnsureIntent,
): boolean {
  return (
    captured.generation !== live.generation ||
    captured.modelId !== live.modelId ||
    captured.remote !== live.remote
  );
}
