/**
 * The iOS half of the local engine lifecycle: stop the send the phone's
 * suspension is about to break, mark the context that suspension poisons, and
 * release that context once the app is back. `src/app/iosBackgroundPlan.ts`
 * holds the decisions; this file holds the reads, the wiring and the log line.
 *
 * The stop aborts the send's own AbortController — the signal the stop handler
 * aborts (`sendStop.ts:76`) and the same bridge the idle discard aborts through
 * (`foregroundIdle.idleDiscardAbortRef`). The send classifies its result off
 * that signal, so the partial is kept and marked interrupted exactly as a user
 * Stop leaves it, while the mark keeps that dead context's KV off disk
 * (`shouldSaveSession`, `LlamaService.isContextPoisoned`).
 *
 * The release waits out a load another owner holds (`loadSettle`, the same
 * machinery the send path uses): that load is building the very context the
 * suspension poisoned, so it has to exist before it can be released. The
 * release itself is `./poisonedContext.ts` — the same one the ensure path runs
 * when a turn arrives before the guard's "active" does; the reload needs no
 * code here, the ensure path every send already runs reloads a released engine.
 */
import { useEffect, useState } from "react";
import { AppState, Platform, type AppStateStatus } from "react-native";
import {
  iosBackgroundMarkAfterRelease,
  iosBackgroundPlan,
} from "../app/iosBackgroundPlan";
import { isRemoteEngineBackend } from "../engine/engineBackend";
import {
  clearContextPoison,
  contextPoisonMark,
  isContextPoisoned,
  markContextPoisoned,
  nativeEngineWorkInFlight,
} from "../engine/LlamaService";
import { getState as getLlamaContextGateState } from "../engine/llamaContextGate";
import { sendClaimRef, sendingInFlightRef } from "../engine/regenState";
import { releasePoisonedContext } from "./poisonedContext";

/** Mounted by `useHostEffects` with the send's own controller ref: that ref is
 *  stable for the process, so the subscription mounts once (the port pattern
 *  of `useForegroundIdleDispose`). */
export function useIosBackgroundGuard(ports: {
  abortRef: { current: AbortController | null };
}): void {
  const { abortRef } = ports;
  // A real release changes what HostRoot renders (`engineResident` is read at
  // render): one tick is how the face learns, as the idle discard's
  // `onDisposed` does in `foregroundIdle.ts`.
  const [, setReleasedTick] = useState(0);

  useEffect(() => {
    let active = true;
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      const plan = iosBackgroundPlan({
        platform: Platform.OS,
        event: next,
        sending: sendClaimRef.current || sendingInFlightRef.current,
        remote: isRemoteEngineBackend(),
        nativeWork: nativeEngineWorkInFlight(),
        loadInProgress: loadInProgress(),
        reloadPending: isContextPoisoned(),
      });
      if (plan.mark) markContextPoisoned();
      const controller = abortRef.current;
      if (plan.stop && controller) {
        controller.abort();
        log("abort");
      }
      if (plan.release) {
        // The mark this release answers: a later suspension that re-marks while
        // it runs owns the mark, and its own "active" releases again.
        const mark = contextPoisonMark();
        void releasePoisonedContext()
          .then((outcome) => {
            const after = iosBackgroundMarkAfterRelease({
              outcome,
              markEpochAtStart: mark,
              markEpochNow: contextPoisonMark(),
            });
            if (after.clearMark) clearContextPoison();
            if (!after.released) return; // nothing released: nothing to log
            log("reload");
            if (active) setReleasedTick((n) => n + 1);
          })
          .catch(() => undefined);
      }
    });
    return () => {
      active = false;
      sub.remove();
    };
  }, [abortRef]);
}

/**
 * A chat load is building a context: its `initLlama` has not registered a
 * native op yet, so `nativeEngineWorkInFlight` alone would miss it. The gate's
 * `chat_loading` covers the whole load, from the synchronous claim in
 * `engineEnsure` to ready/error/catch. An engine merely resident and idle is
 * in `chat_ready` and reaches neither.
 */
function loadInProgress(): boolean {
  return getLlamaContextGateState() === "chat_loading";
}

function log(op: "abort" | "reload"): void {
  console.info("KALSA_IOS_BG", JSON.stringify({ op }));
}
