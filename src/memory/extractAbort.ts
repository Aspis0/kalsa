/**
 * Cancellation for one memory-extraction job.
 *
 * WHY A SEPARATE SIGNAL AT ALL: `extractMemory` hands an AbortSignal to the
 * native completion and attaches its own listener to it (LlamaService
 * `onAbort` -> `stopCompletion`). The turn's signal cannot be that signal: the
 * job must be cancelable by the next send too, and the turn signal is already
 * owned by chat streaming.
 *
 * THE GAP THIS CLOSES (audit 2026-09-10): the only path that aborted this
 * controller was the next-send hook. `stop` and `clearChat` abort the TURN
 * signal, and the AppShell listener for it released the save gate but never
 * forwarded the abort — so once the job had passed its post-gate check and
 * entered the native completion, a stop/clear left that completion running
 * until it finished or hit its timeout. Releasing the gate is not cancellation.
 *
 * `onCancel` is owned by the caller because the gate release is AppShell state
 * (the gate promise and its telemetry source code), not cancellation state.
 */

export type ExtractAbortOptions = {
  /**
   * The turn's signal. `stop` and `clearChat` abort it; the next send does not
   * (it calls `cancel` directly, which is why the abort must be forwarded here
   * and not merely observed).
   */
  outer?: AbortSignal;
  /**
   * Runs exactly once, synchronously, on the first cancellation from any path
   * (new send, stop, clearChat): release the save gate and record its source.
   */
  onCancel: () => void;
};

export type ExtractAbort = {
  /** Signal handed to `extractMemory` — the one the native completion listens on. */
  readonly signal: AbortSignal;
  /** True once cancelled. Read by the job before it starts native work. */
  cancelled: () => boolean;
  /** Cancel this job. Idempotent. Stable identity for ref comparisons. */
  cancel: () => void;
  /** Stop forwarding the outer signal once the job has settled. */
  detach: () => void;
};

/**
 * Create the cancellation handle for one extraction job.
 *
 * If `outer` is already aborted at arm time (stop landed between the turn's
 * `onDone` and this call) the job is cancelled immediately and never starts
 * native work.
 */
export function createExtractAbort({ outer, onCancel }: ExtractAbortOptions): ExtractAbort {
  const controller = new AbortController();
  let cancelled = false;

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    try {
      onCancel();
    } finally {
      // Always abort, even if the gate release throws: a live native
      // completion after stop is worse than a missed telemetry counter.
      controller.abort();
    }
  };

  const forward = () => cancel();

  if (outer) {
    if (outer.aborted) cancel();
    else outer.addEventListener("abort", forward, { once: true });
  }

  return {
    signal: controller.signal,
    cancelled: () => cancelled,
    cancel,
    detach: () => {
      try {
        outer?.removeEventListener("abort", forward);
      } catch {
        // AbortSignal from a torn-down polyfill must never throw here.
      }
    },
  };
}
