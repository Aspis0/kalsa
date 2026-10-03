/**
 * The iOS half of the local engine lifecycle: stop the send the phone's
 * suspension is about to break, then release the context it poisoned before
 * the next turn decodes on it. `src/app/iosBackgroundPlan.ts` holds the
 * decision; this file holds the subscription, the release and the log line.
 *
 * The stop aborts the send's own AbortController — the signal the stop handler
 * aborts (`sendStop.ts:76`) and the same bridge the idle discard aborts through
 * (`foregroundIdle.idleDiscardAbortRef`). The send classifies its result off
 * that signal, so the partial is kept and marked interrupted exactly as a user
 * Stop leaves it; a completion the abort does not settle is unblocked by the
 * release below, which disposes through the native-op FIFO.
 *
 * The release is the idle discard's own sequence (`foregroundIdle.ts:162-188`):
 * dispose through the native-op FIFO, reset the boot history hash so the
 * reload cannot compare a stale H0 against the .kvs, release the chat slot
 * the disposed context held. The reload itself needs no code here — the
 * ensure path every send already runs reloads a disposed engine.
 */
import { useEffect } from "react";
import { AppState, Platform, type AppStateStatus } from "react-native";
import { iosBackgroundPlan } from "../app/iosBackgroundPlan";
import { isRemoteEngineBackend } from "../engine/engineBackend";
import { disposeEngine, isEngineReady } from "../engine/LlamaService";
import {
  getChatGeneration,
  markChatReleased,
  runNativeOp,
} from "../engine/llamaContextGate";
import { sendClaimRef, sendingInFlightRef } from "../engine/regenState";
import { resetBootHistoryHash } from "../engine/sessionPersistence";

/** A background suspension marked the local context for release. Cleared by
 *  the release itself, so one suspension releases once. */
let reloadPending = false;

/** Mounted by `useHostEffects` with the send's own controller ref: that ref is
 *  stable for the process, so the subscription mounts once (the port pattern
 *  of `useForegroundIdleDispose`). */
export function useIosBackgroundGuard(ports: {
  abortRef: { current: AbortController | null };
}): void {
  const { abortRef } = ports;
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      const plan = iosBackgroundPlan({
        platform: Platform.OS,
        event: next,
        sending: sendClaimRef.current || sendingInFlightRef.current,
        remote: isRemoteEngineBackend(),
        reloadPending,
      });
      if (plan.mark) reloadPending = true;
      const controller = abortRef.current;
      if (plan.stop && controller) {
        controller.abort();
        log("abort");
      }
      if (plan.release) {
        // Consume the mark synchronously: the release is async and a second
        // active event must not run it twice.
        reloadPending = false;
        void releaseLocalContext()
          .then((released) => {
            if (released) log("reload");
          })
          .catch(() => undefined);
      }
    });
    return () => sub.remove();
  }, [abortRef]);
}

/**
 * The idle discard's release sequence, minus its drain, save and generation
 * bookkeeping (`foregroundIdle.ts:162-188`). Returns whether a context was
 * really released — the log line must not claim a reload nothing did.
 */
async function releaseLocalContext(): Promise<boolean> {
  if (!isEngineReady()) return false;
  try {
    await runNativeOp(() => disposeEngine());
  } catch {
    // A failed dispose still drops the JS slot; the next load re-acquires.
  }
  resetBootHistoryHash();
  markChatReleased(getChatGeneration());
  return true;
}

function log(op: "abort" | "reload"): void {
  console.info("KALSA_IOS_BG", JSON.stringify({ op }));
}
