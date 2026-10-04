/**
 * The iOS memory-warning half of the local engine lifecycle: hand the resident
 * model contexts back to the OS before jetsam takes the process, without ever
 * breaking a turn or an embed.
 *
 * The decision is `src/app/iosMemoryWarningPlan.ts`. A turn in flight is never
 * killed: the warning sets an OWED release, and the release runs on the next
 * notification that a unit of native engine work ended
 * (`src/engine/nativeWorkSettle.ts` — the settle points behind
 * `nativeEngineWorkInFlight()`), so a long generation is followed out to its
 * real end instead of polled for. The flag survives until that notification or
 * the next warning and is cleared on unmount. The releases themselves are the
 * app's own dispose paths — `./residentContextRelease.ts` for the chat context
 * and `releaseEmbedder` for an idle embedder — and neither touches work that is
 * still running. The reload needs no code here: the ensure path every send
 * already runs reloads a released engine.
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

    /**
     * What a release has to wait for. The host's own turn refs
     * (`sendingInFlightRef` / `streamInFlightRef`) are deliberately NOT here:
     * they outlive the native work by a host tail that touches no engine, and
     * every post-turn engine call (the landing-keyed KV save) is itself a
     * native job, which does show up. `sendClaimRef` stays: a send that has
     * claimed but not yet reached native work is one this must not break.
     */
    const nativeWorkInFlight = (): boolean =>
      nativeEngineWorkInFlight() ||
      sendClaimRef.current ||
      getLlamaContextGateState() === "chat_loading";

    const bumpReleased = (): void => {
      // A real release changes what HostRoot renders (`engineResident` is read
      // at render): one tick is how the face learns, as the background guard
      // does.
      if (active) setReleasedTick((n) => n + 1);
    };

    /** The memory release itself: the chat context, then an idle embedder. */
    const releaseLocalContexts = async (): Promise<void> => {
      if (isEngineReady()) {
        const outcome = await releaseResidentContext(() => !nativeWorkInFlight());
        if (outcome === "released") bumpReleased();
        else if (nativeWorkInFlight()) {
          // A turn claimed the engine while we asked: still owed.
          owedRef.current = true;
          return;
        }
      }
      // An embed in USE is native work and deferred this warning; reaching here
      // means the embedder is idle, and the re-check closes the last instant.
      if (isEmbedderActive() && !nativeWorkInFlight()) {
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
      if (owedRef.current && !nativeWorkInFlight()) startRelease();
    };

    const unsubscribeSettled = subscribeNativeWorkSettled(releaseWhenSettled);
    const sub = AppState.addEventListener("memoryWarning", () => {
      const plan = iosMemoryWarningPlan({
        platform: Platform.OS,
        remote: isRemoteEngineBackend(),
        sending: sendClaimRef.current || sendingInFlightRef.current,
        nativeWork: nativeEngineWorkInFlight(),
        loadInProgress: getLlamaContextGateState() === "chat_loading",
        resident: isEngineReady() || isEmbedderActive(),
      });
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
      unsubscribeSettled();
      sub.remove();
    };
  }, []);
}

function logMemoryWarning(action: IosMemoryWarningAction): void {
  console.info("KALSA_IOS_MEM", JSON.stringify(action));
}
