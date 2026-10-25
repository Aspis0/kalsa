const noAction = (skipReason: "foreground" | "newer_gen" | null = null) => ({
  saveNow: false,
  scheduleDispose: false,
  disposeNow: false,
  skipReason,
});

/** Decide whether a lifecycle event starts, cancels, or executes a discard. */
export function backgroundDiscardPlan({
  state,
  pendingGrace,
  genAtEntry,
  genNow,
  pressure,
}: {
  state: string;
  pendingGrace: boolean;
  genAtEntry: number | null;
  genNow: number | null;
  pressure: boolean;
}) {
  // The timer callback uses this private state so expiry is distinct from a
  // second background notification, which must not schedule twice.
  if (state === "background_expired" || state === "idle_expired") {
    return genAtEntry === genNow
      ? { ...noAction(), disposeNow: true }
      : noAction("newer_gen");
  }
  if (pressure) {
    if (state !== "background") return noAction("foreground");
    if (!pendingGrace || genAtEntry !== genNow) {
      return genAtEntry !== genNow ? noAction("newer_gen") : noAction();
    }
    return { ...noAction(), disposeNow: true };
  }
  if (state === "background" && !pendingGrace) {
    return { ...noAction(), saveNow: true, scheduleDispose: true };
  }
  return noAction();
}

/**
 * After abort + bounded wait, background/trim still dispose even if JS
 * in-flight flags are stuck. Idle must not unload a live send: kind="idle"
 * blocks while anything is in flight, regardless of idle age — true stalls
 * have their own watchdogs.
 */
export function skipDisposeWhileInFlight(args: {
  inFlight: boolean;
  kind: "background" | "idle" | "trim";
}): boolean {
  if (!args.inFlight) return false;
  if (args.kind === "background" || args.kind === "trim") return false;
  return true;
}
