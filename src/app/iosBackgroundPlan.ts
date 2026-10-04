/**
 * What an iOS suspend does to a LOCAL generation.
 *
 * The phone does not let a backgrounded app submit GPU work: the Metal
 * command buffer fails and `ctx->has_error` latches inside ggml
 * (`ggml-metal-context.m` resets it only when the context is created), so
 * every later graph compute returns GGML_STATUS_FAILED — the context is dead
 * while `llama_decode` returns -3 and the binding resolves normally, i.e. the
 * next message silently produces nothing. So the turn in flight is STOPPED
 * through the send's own abort path (partial kept, marked interrupted), the
 * context is MARKED (its KV must not be written out, and it must be released
 * before anything decodes on it again), and the next "active" releases it —
 * after which the ensure path every send already runs reloads the engine.
 *
 * The mark covers the context, not just the send that happened to be running:
 * a prefix prewarm, a memory extraction, a translation, an embed or a load
 * building a context all submit work that the same suspension breaks. An
 * engine merely RESIDENT and idle is not work, and marking it would reload on
 * every app switch for nothing.
 *
 * "inactive" is NOT a suspension: Control Center, a notification pull and the
 * app switcher all fire it with the app still on screen, and aborting there
 * would kill turns nobody suspended.
 *
 * Pure (platform, event and state injected) so the decisions are testable off
 * device; the wiring is `src/host/iosBackgroundGuard.ts`.
 */
const noAction = () => ({ stop: false, mark: false, release: false });

export function iosBackgroundPlan(args: {
  platform: string;
  /** The AppState change; only "background" and "active" do anything. */
  event: string;
  /** A send is in flight (`sendClaimRef` / `sendingInFlightRef`). */
  sending: boolean;
  /** It runs on the remote brain: no local GPU, nothing to stop. */
  remote: boolean;
  /** A local native op is in flight: a completion (a send or the memory
   *  extraction), the prefix prewarm, a translation, an embed. */
  nativeWork: boolean;
  /** A chat load is building a context (the gate's `chat_loading`): its
   *  `initLlama` has not registered a native op yet, and the context it is
   *  building is as poisoned as the one a running op reports. */
  loadInProgress: boolean;
  /** The poisoned context has not been released yet. */
  reloadPending: boolean;
}): { stop: boolean; mark: boolean; release: boolean } {
  if (args.platform !== "ios") return noAction();
  if (args.event === "background") {
    const stop = args.sending && !args.remote;
    // A local send counts even before its native completion registers.
    return stop || args.nativeWork || args.loadInProgress
      ? { stop, mark: true, release: false }
      : noAction();
  }
  if (args.event === "active" && args.reloadPending) {
    return { stop: false, mark: false, release: true };
  }
  return noAction();
}

/** What a release attempt left behind: the context was released, there was
 *  none to release, or the engine refused to release it (hung). */
export type LocalReleaseOutcome = "released" | "absent" | "withheld";

/**
 * The mark after a release attempt. `released` ends it — a fresh context is
 * what the next load builds. `absent` ends it too: no context and no load
 * means there is nothing poisoned left, and keeping the mark would refuse
 * every later KV save (`shouldSaveSession`). `withheld` keeps it — a dispose
 * that timed out with native work still active never released the context
 * (`LlamaService.ts:3144`), so the poisoned KV must stay unwritten and the
 * next "active" retries. A mark epoch that MOVED while the release ran is a
 * later suspension's (`LlamaService.contextPoisonMark`): it owns the mark, so
 * this release leaves it alone either way.
 */
export function iosBackgroundMarkAfterRelease(args: {
  outcome: LocalReleaseOutcome;
  /** The mark this release was for, read before its first await. */
  markEpochAtStart: number;
  /** The mark now — moved means a later suspension re-marked. */
  markEpochNow: number;
}): { clearMark: boolean; released: boolean } {
  return {
    clearMark:
      args.outcome !== "withheld" && args.markEpochAtStart === args.markEpochNow,
    released: args.outcome === "released",
  };
}
