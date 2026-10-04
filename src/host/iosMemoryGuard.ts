/**
 * The iOS memory-warning half of the local engine lifecycle: hand the resident
 * model context back to the OS before jetsam takes the process, without ever
 * breaking a turn.
 *
 * The decision is `src/app/iosMemoryWarningPlan.ts`. An owed (`deferred`)
 * release waits here for the native work to drain — a warning is not a
 * generation stop, and a release that lands mid-turn would be exactly the kill
 * the immediate path refuses. The release itself is
 * `./residentContextRelease.ts`, the same dispose the iOS background release
 * runs; the reload needs no code here, the ensure path every send already runs
 * reloads a released engine.
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
import { isRemoteEngineBackend } from "../engine/engineBackend";
import { isEngineReady, nativeEngineWorkInFlight } from "../engine/LlamaService";
import { getState as getLlamaContextGateState } from "../engine/llamaContextGate";
import { sendClaimRef, sendingInFlightRef } from "../engine/regenState";
import { releaseResidentContext } from "./residentContextRelease";

/**
 * How long an owed release waits for the work to drain. A generation can run
 * for minutes and the release is worth having whenever it ends; this bound
 * exists so a native op that never settles cannot leave a timer alive for the
 * life of the process. A dropped release is not lost: iOS repeats the warning
 * while it still wants memory back, and the idle discard releases the context
 * anyway.
 */
const DEFERRED_RELEASE_MAX_MS = 5 * 60_000;
const DEFERRED_RELEASE_TICK_MS = 250;

export function useIosMemoryGuard(): void {
  const [, setReleasedTick] = useState(0);
  /** One drain at a time: a second warning changes nothing while the first
   *  release is still owed, and two drains would race for the same dispose. */
  const drainInFlightRef = useRef(false);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    let active = true;

    const localWorkInFlight = (): boolean =>
      nativeEngineWorkInFlight() ||
      sendClaimRef.current ||
      sendingInFlightRef.current ||
      getLlamaContextGateState() === "chat_loading";

    const releaseNow = async (): Promise<void> => {
      // The predicate closes the window between the check and the dispose: a
      // send that claimed the engine while we waited makes this "absent", not
      // a killed turn.
      const outcome = await releaseResidentContext(() => !localWorkInFlight());
      // A real release changes what HostRoot renders (`engineResident` is read
      // at render): one tick is how the face learns, as the background
      // guard does.
      if (outcome === "released" && active) setReleasedTick((n) => n + 1);
    };

    const drainThenRelease = async (): Promise<void> => {
      const startedAt = Date.now();
      while (localWorkInFlight() && Date.now() - startedAt < DEFERRED_RELEASE_MAX_MS) {
        await new Promise<void>((resolve) => setTimeout(resolve, DEFERRED_RELEASE_TICK_MS));
        if (!active) return;
      }
      if (!active) return;
      await releaseNow();
    };

    const sub = AppState.addEventListener("memoryWarning", () => {
      const plan = iosMemoryWarningPlan({
        platform: Platform.OS,
        remote: isRemoteEngineBackend(),
        sending: sendClaimRef.current || sendingInFlightRef.current,
        nativeWork: nativeEngineWorkInFlight(),
        loadInProgress: getLlamaContextGateState() === "chat_loading",
        resident: isEngineReady(),
      });
      // "platform" cannot occur here (the subscription is iOS-only), so any
      // skip is a real answer under pressure and is recorded like the others.
      if (plan.op === "skip") {
        if (plan.reason !== "platform") logMemoryWarning(plan);
        return;
      }
      logMemoryWarning(plan);
      if (plan.op === "release") {
        void releaseNow();
        return;
      }
      if (drainInFlightRef.current) return;
      drainInFlightRef.current = true;
      void drainThenRelease().finally(() => {
        drainInFlightRef.current = false;
      });
    });

    return () => {
      active = false;
      sub.remove();
    };
  }, []);
}

function logMemoryWarning(action: IosMemoryWarningAction): void {
  console.info("KALSA_IOS_MEM", JSON.stringify(action));
}
