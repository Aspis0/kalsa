/**
 * What an iOS suspend does to a LOCAL generation.
 *
 * The phone does not let a backgrounded app submit GPU work: the Metal
 * command buffer fails and `ctx->has_error` latches inside ggml
 * (`ggml-metal-context.m` resets it only when the context is created), so
 * every later graph compute returns GGML_STATUS_FAILED — the context is dead
 * while `llama_decode` returns -3 and the binding resolves normally, i.e. the
 * next message silently produces nothing. So the turn in flight is STOPPED
 * through the send's own abort path (partial kept, marked interrupted) and
 * the poisoned context is released; the next local send reloads it through
 * the ensure path a disposed engine already goes through.
 *
 * "inactive" is NOT a suspension: Control Center, a notification pull and the
 * app switcher all fire it with the app still on screen, and aborting there
 * would kill turns nobody suspended.
 *
 * Pure (platform, event and state injected) so the decision is testable off
 * device; the wiring is `src/host/iosBackgroundGuard.ts`.
 */
const noAction = () => ({ stop: false, mark: false, release: false });

export function iosBackgroundPlan(args: {
  platform: string;
  /** The AppState change; only "background" and "active" do anything. */
  event: string;
  /** A send is in flight (`sendClaimRef` / `sendingInFlightRef`). */
  sending: boolean;
  /** It runs on the remote brain: no local GPU, nothing to stop or reload. */
  remote: boolean;
  /** An earlier background stop marked the local context, unconsumed. */
  reloadPending: boolean;
}): { stop: boolean; mark: boolean; release: boolean } {
  if (args.platform !== "ios") return noAction();
  if (args.event === "background") {
    return args.sending && !args.remote
      ? { stop: true, mark: true, release: false }
      : noAction();
  }
  if (args.event === "active" && args.reloadPending) {
    return { stop: false, mark: false, release: true };
  }
  return noAction();
}
