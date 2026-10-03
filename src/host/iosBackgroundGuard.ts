/**
 * The iOS half of the local engine lifecycle: stop the send the phone's
 * suspension is about to break, mark the context that suspension poisons, and
 * release that context once the app is back. `src/app/iosBackgroundPlan.ts`
 * holds the decisions; this file holds the reads, the release and the log line.
 *
 * The stop aborts the send's own AbortController — the signal the stop handler
 * aborts (`sendStop.ts:76`) and the same bridge the idle discard aborts through
 * (`foregroundIdle.idleDiscardAbortRef`). The send classifies its result off
 * that signal, so the partial is kept and marked interrupted exactly as a user
 * Stop leaves it, while the mark keeps that dead context's KV off disk
 * (`shouldSaveSession`, `LlamaService.contextPoisoned`).
 *
 * The release waits out a load another owner holds (`loadSettle`, the same
 * machinery the send path uses): that load is building the very context the
 * suspension poisoned, so it has to exist before it can be released. The
 * dispose itself is the idle discard's own sequence
 * (`foregroundIdle.ts:162-188`): dispose through the native-op FIFO, reset the
 * boot history hash so the reload cannot compare a stale H0 against the .kvs,
 * release the chat slot the disposed context held. The reload needs no code
 * here — the ensure path every send already runs reloads a disposed engine.
 */
import { useEffect, useState } from "react";
import { AppState, Platform, type AppStateStatus } from "react-native";
import {
  iosBackgroundMarkAfterRelease,
  iosBackgroundPlan,
  type LocalReleaseOutcome,
} from "../app/iosBackgroundPlan";
import { isRemoteEngineBackend } from "../engine/engineBackend";
import {
  clearContextPoison,
  disposeEngine,
  isContextPoisoned,
  isEngineHung,
  isEngineReady,
  markContextPoisoned,
  nativeEngineWorkInFlight,
} from "../engine/LlamaService";
import {
  getChatGeneration,
  getState as getLlamaContextGateState,
  markChatReleased,
  runNativeOp,
} from "../engine/llamaContextGate";
import { sendClaimRef, sendingInFlightRef } from "../engine/regenState";
import { resetBootHistoryHash } from "../engine/sessionPersistence";
import { waitForInFlightChatLoad } from "./loadSettle";

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
        void releaseLocalContext()
          .then((outcome) => {
            const after = iosBackgroundMarkAfterRelease(outcome);
            if (after.keepMark) return; // nothing released: next active retries
            clearContextPoison();
            if (!after.released) return; // no context was there to release
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

/**
 * Release what the suspension poisoned, reporting what really happened
 * (`released` / `absent` / `withheld`). Runs at "active", once per marked
 * period.
 */
async function releaseLocalContext(): Promise<LocalReleaseOutcome> {
  // Ownership token captured BEFORE any await: a stale release must not idle a
  // newer load's gate (`foregroundIdle.ts:103`). After the wait, a changed
  // token means a newer owner disposed what was poisoned and built its own
  // context — in the foreground, so nothing here is left to release.
  const chatGen = getChatGeneration();
  await waitForInFlightChatLoad();
  if (getChatGeneration() !== chatGen || !isEngineReady()) return "absent";
  try {
    await runNativeOp(() => disposeEngine());
  } catch {
    // A dispose that threw leaves the engine hung (initEngine refuses);
    // the mark has to stay so its KV is never written out.
    return "withheld";
  }
  // The 60 s safety timeout with native work still active refuses the release
  // and requires a restart (`LlamaService.ts:3123`): not released, mark kept.
  if (isEngineHung()) return "withheld";
  resetBootHistoryHash();
  markChatReleased(chatGen);
  return "released";
}

function log(op: "abort" | "reload"): void {
  console.info("KALSA_IOS_BG", JSON.stringify({ op }));
}
