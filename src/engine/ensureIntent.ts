/**
 * Caller-side generation + model/backend intent for ensureEngineForModel.
 * Capture before the first await; a mismatch means the ensure is stale and
 * must not commit (especially setEngineBackendMode("remote")).
 */
import { REMOTE_MAC_MODEL_ID } from "./remote/remoteMacModel";

export type EnsureIntent = {
  generation: number;
  modelId: string;
  remote: boolean;
};

export function captureEnsureIntent(
  generation: number,
  modelId: string,
): EnsureIntent {
  return { generation, modelId, remote: modelId === REMOTE_MAC_MODEL_ID };
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
