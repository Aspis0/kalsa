/**
 * The foreground-idle governor's host wiring (PARITY-STATUS gap 8): the hook
 * that mounts `idleWatchdog`'s clock, the one discard it can run, and the
 * abort bridge the send owner installs. The controller's original is the
 * `idleClock` + `discardBackground("idle")` inside `AppShell.tsx:3026-3315`;
 * the events, the gate and the disposal body are reproduced there — the
 * report for this slice names every arm/disarm site.
 *
 * What this host does NOT mount, reported rather than half-wired: the
 * background discard machine and its grace (`App:3076-3084, 3330-3424`), so
 * there is no `backgroundGrace` to cancel on the foreground transition and
 * no `background.grace` log line to emit; the download-start bump
 * (`App:4676` — no download system, Table 3 gap 3); and the controller's
 * `setProcessUnloadedReason` / `setMemoryBannerKey` paints
 * (`App:3124-3125` — row 35's strip hint was never lifted and D1:38 dropped
 * the banner). Residency truth after a dispose is carried by one re-render:
 * the composer already maps `ready && !engineResident` to its `unloaded`
 * hold line (`composerPhase.ts:44`).
 */
import { useEffect, useState } from "react";
import { AppState, Keyboard, type AppStateStatus } from "react-native";
import {
  bumpForegroundIdleRef,
  deriveTokenSilenceMs,
} from "../app/foregroundIdleDispose";
import {
  backgroundDiscardPlan,
  skipDisposeWhileInFlight,
} from "../app/backgroundDiscardPlan";
import { createBackgroundTimer } from "../platform/backgroundTimer";
import {
  disposeEngine,
  getActiveModelId,
  isEngineReady,
  lastNativeTokenAtMs,
  nativeEngineWorkInFlight,
  saveEngineSession,
} from "../engine/LlamaService";
import {
  computeHistoryHashFromMessages,
  readBootMessages,
  resetBootHistoryHash,
} from "../engine/sessionPersistence";
import {
  getChatGeneration,
  getState as getLlamaContextGateState,
  markChatReleased,
  runNativeOp,
} from "../engine/llamaContextGate";
import {
  regenAbortRef,
  regenInFlightRef,
  sendClaimRef,
  sendingInFlightRef,
} from "../engine/regenState";
import { modelSwitchInFlightRef } from "./modelSwitch";
import { createForegroundIdleClock } from "./idleWatchdog";

/** The controller's bounded pre-dispose drain (`App:3216-3231`): abort is
 *  re-asserted every tick and flags get this long to settle. */
const IDLE_DRAIN_MS = 5_000;
const IDLE_DRAIN_TICK_MS = 50;

/**
 * The send owner's abort, installed by `useHostEffects` (which receives the
 * send's controller) and read only by this discard — the controller's
 * `backgroundDiscardLifecycleRef` in miniature: that lifecycle aborted the
 * send, awaited finalization and returned the history hash; this host's send
 * finalizes itself off the abort (the `interrupted`/`aborted` outcomes of
 * `sendStream.ts:126-137`), so the bridge only has to abort.
 */
export const idleDiscardAbortRef: { current: (() => void) | null } = {
  current: null,
};

/** The controller's `engineWorkInFlight` (`App:3262-3269`) minus
 *  `downloadInFlight` — this host mounts no downloads (Table 3 gap 3). */
function engineWorkInFlight(streamInFlightRef: { current: boolean }): boolean {
  return (
    streamInFlightRef.current ||
    sendClaimRef.current ||
    sendingInFlightRef.current ||
    regenInFlightRef.current ||
    modelSwitchInFlightRef.current ||
    nativeEngineWorkInFlight()
  );
}

async function discardIdle(args: {
  /** Live idle age at log time (the controller recomputed it at the log). */
  ageNow: () => number;
  streamInFlightRef: { current: boolean };
  chatGateGenRef: { current: number | null };
  onDisposed: () => void;
}): Promise<"ended" | "skipped"> {
  // Capture THIS load's gen SYNCHRONOUSLY at entry (`App:3169-3172`): a load
  // that starts while this discard drains must not be released by it.
  const genAtEntry = args.chatGateGenRef.current;
  try {
    // The controller's preparation (`App:3174-3231`): abort, bounded drain,
    // save. Regen first so edit/regen cannot race the dispose; the send's
    // own abort arrives through the bridge `useHostEffects` installs.
    regenAbortRef.current?.abort();
    idleDiscardAbortRef.current?.();
    const t0 = Date.now();
    while (
      engineWorkInFlight(args.streamInFlightRef) &&
      Date.now() - t0 < IDLE_DRAIN_MS
    ) {
      await new Promise((resolve) => setTimeout(resolve, IDLE_DRAIN_TICK_MS));
      // Re-assert each tick: a late send may install a NEW controller while
      // its claim is still held — the controller's loop did the same
      // (`Chat:2126-2131`).
      regenAbortRef.current?.abort();
      idleDiscardAbortRef.current?.();
    }
    // Save before dispose (the controller `App:3220-3231`; this host's own
    // idiom is the model-switch dispose's save, `modelSwitch.ts:147-156`).
    const modelId = getActiveModelId();
    if (modelId && isEngineReady()) {
      try {
        const msgs = await readBootMessages();
        await saveEngineSession(
          modelId,
          computeHistoryHashFromMessages(msgs),
          msgs.length,
        );
      } catch {
        // previous good .kvs stays
      }
    }
    // Idle must not unload a live send — the controller's own rule
    // (`backgroundDiscardPlan.ts:48-57`): true stalls have their watchdogs.
    if (
      skipDisposeWhileInFlight({
        inFlight: engineWorkInFlight(args.streamInFlightRef),
        kind: "idle",
      })
    ) {
      return "skipped";
    }
    const plan = backgroundDiscardPlan({
      state: "idle_expired",
      pendingGrace: false,
      genAtEntry,
      genNow: args.chatGateGenRef.current,
      pressure: false,
    });
    if (!plan.disposeNow) {
      // `idle_expired` disposes only while the entry gen still owns the gate;
      // otherwise the plan says `newer_gen` — the controller re-armed there.
      return "skipped";
    }
    if (genAtEntry !== null && args.chatGateGenRef.current === genAtEntry) {
      args.chatGateGenRef.current = null;
    }
    if (isEngineReady() || genAtEntry !== null) {
      try {
        if (isEngineReady()) {
          await runNativeOp(() => disposeEngine());
          // Same-process unload→reload must not compare stale H0 against the
          // just-saved .kvs (`App:3121-3122`).
          resetBootHistoryHash();
          console.info(
            "model.unload",
            JSON.stringify({ reason: "idle", idleMs: args.ageNow() }),
          );
          args.onDisposed();
        }
      } catch {
        // a failed dispose still releases its gen, below
      }
      if (genAtEntry !== null) {
        markChatReleased(genAtEntry);
      } else {
        // The controller's stale-owner fallback (`App:3267-3273`): gen was
        // null, but this process's chat slot may still be held.
        const gate = getLlamaContextGateState();
        if (gate === "chat_loading" || gate === "chat_ready") {
          markChatReleased(getChatGeneration());
        }
      }
    }
    // The controller never re-arms after a completed dispose
    // (`requestDeferredDispose` has no `idleClock.arm()` on success): the
    // next user-activity bump starts the clock again, and every fire until
    // then is refused by the engine-ready gate anyway.
    return "ended";
  } catch {
    // The controller's `catch {}` (`App:3246`): no re-arm, no throw. The
    // clock restarts on the next bump, which makes an unexpected failure a
    // retry after user activity rather than a hot loop.
    return "ended";
  }
}

/**
 * Mounts the clock for the process: arms on mount, bumps on keyboard show
 * and on the foreground transition, disarms on unmount — the controller's
 * eight bump sites minus the two this host cannot have (download start, and
 * the engine-turn site which already lives in `engineTurn.ts:134`).
 */
export function useForegroundIdleDispose(params: {
  streamInFlightRef: { current: boolean };
  nativeTurnStartAtRef: { current: number };
  chatGateGenRef: { current: number | null };
}): void {
  const { streamInFlightRef, nativeTurnStartAtRef, chatGateGenRef } = params;
  const [, setDisposedTick] = useState(0);

  useEffect(() => {
    let active = true;
    // The native paused-activity timer, as the controller's `backgroundTimer`
    // (`App:3027`): a JS timer is suspended on host pause and the fire would
    // silently never happen — the exact defect the native timer exists for.
    const timer = createBackgroundTimer();
    const clock = createForegroundIdleClock({
      now: () => Date.now(),
      schedule: (run, delayMs) => timer.setTimeout(run, delayMs),
      cancel: (handle) => timer.clearTimeout(handle),
      // A fire outside the foreground only re-arms (see `idleWatchdog.ts`):
      // this host mounts no background discard for a background fire to join.
      isForeground: () => AppState.currentState === "active",
      read: () => ({
        engineReady: isEngineReady(),
        inFlight: engineWorkInFlight(streamInFlightRef),
        tokenSilenceMs: deriveTokenSilenceMs({
          streamInFlight: streamInFlightRef.current,
          turnStartedAt: nativeTurnStartAtRef.current,
          lastRawTokenAt: lastNativeTokenAtMs(),
          now: Date.now(),
        }),
      }),
      discard: (ageNow) =>
        discardIdle({
          ageNow,
          streamInFlightRef,
          chatGateGenRef,
          onDisposed: () => {
            if (active) setDisposedTick((n) => n + 1);
          },
        }),
      onStallAttempt: (idleMs, tokenSilenceMs) => {
        console.log(
          "KALSA_IDLE_STALL",
          JSON.stringify({ idleMs, tokenSilenceMs: tokenSilenceMs ?? null }),
        );
      },
    });
    bumpForegroundIdleRef.current = clock.bump;
    clock.bump(); // the controller arms at mount (`App:3315`)
    const keyboardShow = Keyboard.addListener("keyboardDidShow", () => {
      clock.bump(); // `App:3316-3318`
    });
    const appStateSub = AppState.addEventListener(
      "change",
      (next: AppStateStatus) => {
        // Foreground return is user activity (`App:3392-3395`). Its partner
        // `cancelBackgroundGrace()` has nothing to cancel here — there is no
        // pending background grace without a background discard.
        if (next === "active") clock.bump();
      },
    );
    return () => {
      active = false;
      keyboardShow.remove();
      appStateSub.remove();
      clock.clear();
      // The controller's unmount order (`App:3516-3521`): cancel the fire,
      // then restore the default no-op so a late engine-turn bump cannot
      // resurrect a timer nobody owns.
      bumpForegroundIdleRef.current = () => {};
    };
    // The three refs are stable for the process; the root mounts once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
