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

/**
 * What an ensure attempt produced.
 *
 * `superseded` is NOT a failure: the attempt lost its turn (a newer model or
 * backend, a dispose), so the operation that replaced it owns the screen. A
 * caller must neither write an error for it nor pretend it succeeded — and a
 * boolean cannot say that, which is why this is not one.
 */
export type EnsureOutcome = "ready" | "failed" | "superseded";

/**
 * The verdict for a finished attempt: `ready` as reported, otherwise a failure
 * only if the intent is still the current one. Once the intent has moved on, the
 * "not ready" belongs to a turn nobody is waiting for.
 */
export function ensureOutcome(input: {
  ready: boolean;
  captured: EnsureIntent;
  live: EnsureIntent;
}): EnsureOutcome {
  if (input.ready) return "ready";
  return ensureIntentStale(input.captured, input.live) ? "superseded" : "failed";
}

/** Identity of an ensure attempt: same generation, model and backend. */
export function ensureIntentKey(intent: EnsureIntent): string {
  return `${intent.generation}:${intent.remote ? "remote" : "local"}:${intent.modelId}`;
}

/**
 * One in-flight attempt per intent.
 *
 * Two callers asking for the same engine — the explicit select and the
 * `remoteActive` effect, for instance — must share one init. The second adds
 * nothing, and a rival attempt that finishes second can overwrite the winner's
 * state. A different intent (the user changed model or backend) is a different
 * key and starts its own attempt.
 */
export class InFlightEnsures<T> {
  private readonly running = new Map<string, Promise<T>>();

  run(key: string, start: () => Promise<T>): Promise<T> {
    const existing = this.running.get(key);
    if (existing) return existing;
    const attempt = start();
    this.running.set(key, attempt);
    const settle = () => {
      if (this.running.get(key) === attempt) this.running.delete(key);
    };
    // Also on rejection: a failed attempt kept in the map would make every later
    // caller wait for a result that already happened.
    attempt.then(settle, settle);
    return attempt;
  }
}
