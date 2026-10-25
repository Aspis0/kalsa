/**
 * What an iOS memory warning does to the LOCAL engine.
 *
 * UIKit sends `memoryWarning` while the process is under pressure and still
 * holds memory it could take back — the step before it starts killing
 * processes. The only multi-GB reclaimable allocation this app holds is the
 * resident local context: the weights are mmap-backed and evictable, but the
 * KV, compute buffers and Metal allocations are not. So the answer is to
 * RELEASE the context: the ensure path every send already runs reloads it, and
 * a cold reload costs seconds where a jetsam costs the whole process.
 *
 * A turn in flight is NEVER killed here. The user asked for that answer, and
 * disposing the context under it would fail the turn and lose the partial —
 * the release becomes OWED instead (`deferred`), and the wiring releases it as
 * soon as the native work drains (`src/host/iosMemoryGuard.ts`).
 *
 * Remote (PC Brain) mode holds no local model, and an engine that is not
 * resident is already the state a warning asks for: both are recorded skips,
 * so a warning that arrived under pressure is distinguishable from no warning
 * at all in the report.
 *
 * Pure (platform and state injected) so the decision is testable off device;
 * the wiring is `src/host/iosMemoryGuard.ts`.
 */
export type IosMemoryWarningAction =
  | { op: "release" }
  | { op: "deferred" }
  | { op: "skip"; reason: IosMemoryWarningSkipReason };

export type IosMemoryWarningSkipReason = "platform" | "remote" | "no-engine";

export function iosMemoryWarningPlan(args: {
  platform: string;
  /** It runs on the remote brain: no local context to give back. */
  remote: boolean;
  /** A send is in flight (`sendClaimRef` / `sendingInFlightRef`), including
   *  the window between the claim and its native completion. */
  sending: boolean;
  /** A local native op is in flight: a completion (a send or the memory
   *  extraction), the prefix prewarm, a translation, an embed. */
  nativeWork: boolean;
  /** A chat load is building a context (the gate's `chat_loading`): its
   *  `initLlama` has not registered a native op yet, and the context it is
   *  building is the one a release would have to take away. */
  loadInProgress: boolean;
  /** A local context is loaded and idle (`isEngineReady()` for the chat
   *  engine, `isEmbedderActive()` for the embedder). An embed in USE is
   *  `nativeWork` and defers this warning instead. */
  resident: boolean;
}): IosMemoryWarningAction {
  if (args.platform !== "ios") return { op: "skip", reason: "platform" };
  if (args.remote) return { op: "skip", reason: "remote" };
  if (args.sending || args.nativeWork || args.loadInProgress) {
    return { op: "deferred" };
  }
  if (!args.resident) return { op: "skip", reason: "no-engine" };
  return { op: "release" };
}
