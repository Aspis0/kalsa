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

/**
 * The remote configuration an attempt actually reads.
 *
 * It is part of the attempt's identity: the URL and the server model are read
 * inside the attempt (RemoteEngine's probe), and editing them in Settings does
 * not bump the AppShell generation — only selecting a model does. Without this
 * in the key, an attempt started against server A is handed to a caller that has
 * since changed the address or the model: it either fails carrying A's failure or
 * reports ready an engine configured for B.
 */
export type RemoteConfiguration = {
  url: string;
  serverModelId: string;
};

export type EnsureIntent = {
  generation: number;
  modelId: string;
  remote: boolean;
  /** Null for a local intent: it reads no remote configuration. */
  remoteConfig: RemoteConfiguration | null;
};

export function captureEnsureIntent(
  generation: number,
  modelId: string,
  remoteConfig: RemoteConfiguration,
): EnsureIntent {
  const remote = isRemoteComputerModelId(modelId);
  return {
    generation,
    modelId,
    remote,
    // A local intent is not affected by the remote settings, so it does not
    // carry them: a URL edit must not stale a local load.
    remoteConfig: remote ? remoteConfig : null,
  };
}

export function ensureIntentStale(
  captured: EnsureIntent,
  live: EnsureIntent,
): boolean {
  return (
    captured.generation !== live.generation ||
    captured.modelId !== live.modelId ||
    captured.remote !== live.remote ||
    !sameRemoteConfiguration(captured.remoteConfig, live.remoteConfig)
  );
}

function sameRemoteConfiguration(
  captured: RemoteConfiguration | null,
  live: RemoteConfiguration | null,
): boolean {
  if (captured === null || live === null) return captured === live;
  return (
    captured.url === live.url && captured.serverModelId === live.serverModelId
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

/**
 * Identity of an ensure attempt: the generation, the model, the backend — and,
 * for a remote attempt, the address and server model it will read.
 */
export function ensureIntentKey(intent: EnsureIntent): string {
  const configuration = intent.remoteConfig
    ? `${intent.remoteConfig.url}|${intent.remoteConfig.serverModelId}`
    : "";
  return `${intent.generation}:${intent.remote ? "remote" : "local"}:${intent.modelId}:${configuration}`;
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

  /**
   * Runs `start`, or joins the attempt already running for `key`.
   *
   * The attempt is bounded by `withinMillis`: a caller gets `abandon` if it has
   * not settled by then, and the map entry is released **whether or not it ever
   * settles**. Storage reads (SecureStore, AsyncStorage) have no deadline of
   * their own — the abort signal covers the network call only — so without this
   * an attempt that never settles would be handed to every later caller, and the
   * app would neither work nor fail.
   *
   * A rejection is passed through rather than turned into `abandon`: the caller
   * distinguishes a superseded attempt from a failed one by the error it carries.
   */
  run(
    key: string,
    start: () => Promise<T>,
    withinMillis: number,
    abandon: T,
  ): Promise<T> {
    const existing = this.running.get(key);
    if (existing) return existing;
    const attempt = start();
    const bounded = new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        if (this.running.get(key) === bounded) this.running.delete(key);
        action();
      };
      attempt.then(
        (value) => finish(() => resolve(value)),
        (error) => finish(() => reject(error)),
      );
      const timer = setTimeout(() => finish(() => resolve(abandon)), withinMillis);
      // `finally` would re-raise the attempt's rejection on a promise nobody
      // holds, which is an unhandled rejection. `then` with both callbacks
      // clears the timer without inventing another rejected promise.
      const stopTimer = () => clearTimeout(timer);
      attempt.then(stopTimer, stopTimer);
    });
    this.running.set(key, bounded);
    return bounded;
  }
}
