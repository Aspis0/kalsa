/**
 * The eager engine kick's bench wait (kalsa.bench.eager_delay_ms) and its
 * measurement lines. Delay 0 never enters this module — the hook runs the
 * historical synchronous kick inline. Delay > 0 arms ONE cancellable wait per
 * process; the delay counts from the host's first committed render, and at
 * fire time a veto (remote backend, a load an early send already started,
 * the one-shot claim — consumed only when the kick really fires) decides
 * between the kick and a KALSA_EAGER_SKIP line. The model-switch paths and
 * the hook's effect cleanup cancel the pending wait so it can never fire
 * into another generation.
 */
import { claimEagerKick } from "../engine/ttftFlags";

/** Wall-clock anchor of since_launch_ms; module eval ≈ JS launch. */
const PROCESS_LAUNCH_MS = Date.now();

export interface EagerKickWait {
  modelId: string;
  generation: number;
  delayMs: number;
  /** Epoch ms of the host's first committed render; null → count from now. */
  anchorMs: () => number | null;
  /** Remote/computer backend active at fire time — the kick must not load. */
  remoteActive: () => boolean;
  /** An early send already loaded this exact model — no second load. */
  alreadyLoaded: () => boolean;
  /** The load start (the hook's ensure kick). */
  ensure: () => void;
}

let pendingCancel: ((reason: string) => void) | null = null;

/**
 * Cancel the pending wait, logging why it ended. True when one was actually
 * pending — after the kick fired, or with nothing scheduled, a silent no-op.
 */
export function cancelPendingEagerKick(reason: string): boolean {
  const cancel = pendingCancel;
  pendingCancel = null;
  if (cancel === null) return false;
  cancel(reason);
  return true;
}

/** The kick's start line, shared by the immediate and the delayed path. */
export function logEagerInit(modelId: string, generation: number): void {
  // eslint-disable-next-line no-console
  console.log("engine.eagerInit", JSON.stringify({ modelId, generation }));
}

function logSkip(wait: EagerKickWait, reason: string): void {
  // eslint-disable-next-line no-console
  console.log(
    "KALSA_EAGER_SKIP",
    JSON.stringify({
      reason,
      modelId: wait.modelId,
      generation: wait.generation,
      delay_ms: wait.delayMs,
    }),
  );
}

/**
 * Arm the wait. A wait still pending is superseded (cancelled with a SKIP
 * line) — the hook's effect cleanup cancels on re-runs, so this is only a
 * backstop against two schedulers in one process.
 */
export function startEagerKick(wait: EagerKickWait): void {
  cancelPendingEagerKick("superseded");
  const anchor = wait.anchorMs();
  const elapsed = anchor === null ? 0 : Date.now() - anchor;
  let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    timer = null;
    pendingCancel = null;
    let reason: string | null = null;
    if (wait.remoteActive()) reason = "remote";
    else if (wait.alreadyLoaded()) reason = "already_loaded";
    else if (!claimEagerKick(wait.modelId, wait.generation)) reason = "claimed";
    if (reason !== null) {
      logSkip(wait, reason);
      return;
    }
    logEagerInit(wait.modelId, wait.generation);
    // Measurement anchor: when the load actually started.
    // eslint-disable-next-line no-console
    console.log(
      "KALSA_EAGER",
      JSON.stringify({
        modelId: wait.modelId,
        generation: wait.generation,
        delay_ms: wait.delayMs,
        since_launch_ms: Date.now() - PROCESS_LAUNCH_MS,
      }),
    );
    wait.ensure();
  }, Math.max(0, wait.delayMs - elapsed));
  pendingCancel = (reason: string) => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    logSkip(wait, reason);
  };
}
