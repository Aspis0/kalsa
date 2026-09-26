/**
 * The eager engine kick and its bench wait (kalsa.bench.eager_delay_ms): the
 * kick's measurement lines, the cancellable InteractionManager+timer wait,
 * and the start. Default delay 0 is today's synchronous kick; a send during
 * the wait supersedes it (the explicit ensure cancels the pending wait).
 */
import { InteractionManager } from "react-native";

/** Wall-clock anchor of the KALSA_EAGER line; module eval ≈ JS launch. */
const PROCESS_LAUNCH_MS = Date.now();

let pendingCancel: (() => void) | null = null;

/**
 * Cancel the pending wait. True when one was actually pending — after the
 * kick fired, or with nothing scheduled, this is a no-op.
 */
export function cancelPendingEagerKick(): boolean {
  const cancel = pendingCancel;
  pendingCancel = null;
  if (!cancel) return false;
  cancel();
  return true;
}

function logEagerKick(modelId: string, generation: number, delayMs: number): void {
  // eslint-disable-next-line no-console
  console.log("engine.eagerInit", JSON.stringify({ modelId, generation }));
  // Measurement anchor: when the load actually started.
  // eslint-disable-next-line no-console
  console.log(
    "KALSA_EAGER",
    JSON.stringify({
      delay_ms: delayMs,
      since_launch_ms: Date.now() - PROCESS_LAUNCH_MS,
    }),
  );
}

/**
 * Start the kick now (delay 0 — exactly the historical path, no readiness
 * consult) or after interactions settle plus the delay, skipping the load if
 * an early send already loaded the model.
 */
export function startEagerKick(args: {
  modelId: string;
  generation: number;
  delayMs: number;
  alreadyLoaded: () => boolean;
  kick: () => void;
}): void {
  if (args.delayMs <= 0) {
    logEagerKick(args.modelId, args.generation, args.delayMs);
    args.kick();
    return;
  }
  scheduleEagerKick(args.delayMs, () => {
    if (args.alreadyLoaded()) return;
    logEagerKick(args.modelId, args.generation, args.delayMs);
    args.kick();
  });
}

/**
 * Run `fire` once interactions settle, then `delayMs` later. Callers only
 * schedule with delayMs > 0 (the immediate kick must not round-trip the
 * scheduler).
 */
function scheduleEagerKick(delayMs: number, fire: () => void): void {
  let cleared = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let interactions: { cancel: () => void } | null = null;
  const clear = () => {
    cleared = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    interactions?.cancel();
    interactions = null;
  };
  pendingCancel = clear;
  interactions = InteractionManager.runAfterInteractions(() => {
    // A cancel while the gate was pending must stay void even if this
    // callback still runs.
    if (cleared) return;
    timer = setTimeout(() => {
      // Detach before firing: the kick's own ensure re-enters
      // cancelPendingEagerKick and must not tear down its own kick.
      timer = null;
      interactions = null;
      if (pendingCancel === clear) pendingCancel = null;
      fire();
    }, delayMs);
  });
}
