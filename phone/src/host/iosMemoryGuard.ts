/**
 * The iOS memory-warning half of the local engine lifecycle: hand the resident
 * model contexts back to the OS before jetsam takes the process, without ever
 * breaking a turn or an embed.
 *
 * The decision is `src/app/iosMemoryWarningPlan.ts`, and the owed release is
 * gated by the SAME plan re-read from the live state: a send that claimed the
 * engine since the warning, native work that started, or a load that began all
 * keep it owed. It runs on the next notification that a unit of native engine
 * work ended (`src/engine/nativeWorkSettle.ts` — the settle points behind
 * `nativeEngineWorkInFlight()`, plus the turn's own finish in
 * `engineTurnFinish.ts`, the wedged-stop unlock in `sendStop.ts` and the
 * conversation-change abort in `useHostEffects.ts`), so a long generation is
 * followed out to its real end instead of polled for. The
 * flag survives until that notification or the next warning and is cleared on
 * unmount. The releases themselves are the app's own dispose paths —
 * `./residentContextRelease.ts` for the chat context and `releaseEmbedder` for
 * an idle embedder — and neither touches work that is still running. The
 * reload needs no code here: the ensure path every send already runs reloads a
 * released engine.
 *
 * RN 0.86 emits `memoryWarning` on iOS only: `RCTAppState.mm`'s
 * `supportedEvents` carries it, while Android's `AppStateModule.kt` emits
 * `appStateDidChange` / `appStateFocusChange` and nothing else (its pressure
 * arrives as trim levels on the native side). So Android never subscribes.
 *
 * Mounted once by `useHostEffects` beside the background guard: the
 * subscription is on `AppState`, whose emitter lives for the process.
 */
import { useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import {
  iosMemoryWarningPlan,
  type IosMemoryWarningAction,
} from "../app/iosMemoryWarningPlan";
import { isEmbedderActive, releaseEmbedder } from "../engine/EmbeddingService";
import { isRemoteEngineBackend } from "../engine/engineBackend";
import { isEngineReady, nativeEngineWorkInFlight } from "../engine/LlamaService";
import { getState as getLlamaContextGateState } from "../engine/llamaContextGate";
import { subscribeNativeWorkSettled } from "../engine/nativeWorkSettle";
import { sendClaimRef, sendingInFlightRef } from "../engine/regenState";
import { releaseResidentContext } from "./residentContextRelease";

export function useIosMemoryGuard(): void {
  const [, setReleasedTick] = useState(0);
  /** The release a warning asked for and the work owes: kept across a turn,
   *  honoured by the next settle notification or the next warning, cleared on
   *  unmount. A flag, not a timer — no poll can tell a long generation from a
   *  hung op. */
  const owedRef = useRef(false);
  /** One release at a time: a settle storm must not submit two disposes. */
  const releasingRef = useRef(false);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    let active = true;
    /** A queued settle reaction (see `scheduleOwedCheck`). */
    let pendingCheck: ReturnType<typeof setTimeout> | null = null;

    /**
     * The warning's decision, re-read from the live state. The owed release runs
     * on the SAME plan as the warning that owed it — a send that claimed the
     * engine since, native work that started, or a load that began keeps the
     * release owed — so there is no second condition to drift from it.
     */
    const currentPlan = (): IosMemoryWarningAction =>
      iosMemoryWarningPlan({
        platform: Platform.OS,
        remote: isRemoteEngineBackend(),
        sending: sendClaimRef.current || sendingInFlightRef.current,
        nativeWork: nativeEngineWorkInFlight(),
        loadInProgress: getLlamaContextGateState() === "chat_loading",
        resident: isEngineReady() || isEmbedderActive(),
      });

    const bumpReleased = (): void => {
      // A real release changes what HostRoot renders (`engineResident` is read
      // at render): one tick is how the face learns, as the background guard
      // does.
      if (active) setReleasedTick((n) => n + 1);
    };

    /** The memory release itself: the chat context, then an idle embedder. */
    const releaseLocalContexts = async (): Promise<void> => {
      if (isEngineReady()) {
        // The predicate re-reads the plan after the load wait: a send that
        // claimed the engine in that window makes this "absent", not a killed
        // turn.
        const outcome = await releaseResidentContext(() => currentPlan().op === "release");
        if (outcome === "released") bumpReleased();
        else if (outcome === "absent" && currentPlan().op === "deferred") {
          // A turn claimed the engine while we asked: still owed.
          owedRef.current = true;
          return;
        }
      }
      // An embed in USE is native work, so the plan defers it; a plan that says
      // "release" here means the embedder is idle, and the re-read closes the
      // last instant.
      if (isEmbedderActive() && currentPlan().op === "release") {
        await releaseEmbedder();
        bumpReleased();
      }
    };

    const startRelease = (): void => {
      if (!active || releasingRef.current) return;
      owedRef.current = false;
      releasingRef.current = true;
      void releaseLocalContexts()
        .catch(() => undefined)
        .finally(() => {
          releasingRef.current = false;
        });
    };

    /** A settle: run the release a warning owed, if its work has ended. Work
     *  still running keeps it owed for the next settle. */
    const releaseWhenSettled = (): void => {
      if (owedRef.current && currentPlan().op === "release") startRelease();
    };

    /**
     * Never react inside the notifier's stack: `notifyNativeWorkSettled` fires
     * synchronously inside engine transitions (`llamaContextGate.markChatReady`
     * can run before `LlamaService` assigns the context), and a release started
     * there would re-enter the engine mid-transition. The check is queued as a
     * macrotask and re-reads every condition when it runs; one pending check at
     * a time, however many settles arrive.
     */
    const scheduleOwedCheck = (): void => {
      if (!owedRef.current || pendingCheck !== null) return;
      pendingCheck = setTimeout(() => {
        pendingCheck = null;
        releaseWhenSettled();
      }, 0);
    };

    const unsubscribeSettled = subscribeNativeWorkSettled(scheduleOwedCheck);
    const sub = AppState.addEventListener("memoryWarning", () => {
      const plan = currentPlan();
      // "platform" cannot occur here (the subscription is iOS-only), so any
      // skip is a real answer under pressure and is recorded like the others.
      if (plan.op === "skip") {
        if (plan.reason !== "platform") logMemoryWarning(plan);
        return;
      }
      logMemoryWarning(plan);
      if (plan.op === "deferred") {
        owedRef.current = true;
        return;
      }
      startRelease();
    });

    return () => {
      active = false;
      owedRef.current = false;
      if (pendingCheck !== null) clearTimeout(pendingCheck);
      unsubscribeSettled();
      sub.remove();
    };
  }, []);
}

function logMemoryWarning(action: IosMemoryWarningAction): void {
  console.info("KALSA_IOS_MEM", JSON.stringify(action));
}
