/**
 * The root's lifecycle effects: the static-prefix skip-first notifier (rule
 * pinned by `staticPrefixNotify.test.ts` — D2 row 21), the conversation-
 * change abort (trimmed to the systems this host mounts) and the unmount
 * flush-then-abort: the partial reaches the store BEFORE the abort,
 * epoch-stamped, because `updateMessage` no-ops once unmounted.
 */
import { useEffect, useMemo, useRef } from "react";
import {
  regenHandleSendPassRef,
  regenInFlightRef,
  sendClaimRef,
  sendingInFlightRef,
} from "../engine/regenState";
import { notifyStaticPrefixInputs, type EngineTool } from "../engine/LlamaService";
import { createStaticPrefixNotifier } from "./staticPrefixNotify";
import { idleDiscardAbortRef } from "./foregroundIdle";
import type { TurnFence } from "./turnGuards";

export interface HostEffectParams {
  fence: TurnFence;
  conversationId: string | undefined;
  locale: string;
  webToolsEnabled: boolean;
  deviceToolsEnabled: boolean;
  calendarToolsEnabled: boolean;
  tools: EngineTool[];
  abortRef: { current: AbortController | null };
  stopWatchdogRef: { current: ReturnType<typeof setTimeout> | null };
  sendingRef: { current: boolean };
  stopRequestedRef: { current: boolean };
  /** The history host's flush: partial text reaches the store, epoch-stamped. */
  flushPartial: () => void;
  setSending: (sending: boolean) => void;
  /** The volatile tool rows die with their turn / conversation. */
  clearTools: () => void;
}

export function useHostEffects(params: HostEffectParams): void {
  const {
    fence,
    conversationId,
    locale,
    webToolsEnabled,
    deviceToolsEnabled,
    calendarToolsEnabled,
    tools,
    abortRef,
    stopWatchdogRef,
    sendingRef,
    stopRequestedRef,
    flushPartial,
    setSending,
    clearTools,
  } = params;

  // First run is skipped (mount/remount), every later flip notifies — the
  // old ref-based rule as a value.
  const notify = useMemo(
    () => createStaticPrefixNotifier<string, EngineTool>((l, toolList) =>
      notifyStaticPrefixInputs(l as "en" | "it", toolList),
    ),
    [],
  );
  useEffect(() => {
    notify(locale, tools);
  }, [notify, locale, tools, webToolsEnabled, deviceToolsEnabled, calendarToolsEnabled]);

  // Abort in-flight work when the active conversation changes (the message
  // reload lives in the history host's load effect, which bumps the epoch
  // before it reads a byte).
  const lastAbortConvRef = useRef(conversationId);
  useEffect(() => {
    const prev = lastAbortConvRef.current;
    lastAbortConvRef.current = conversationId;
    if (prev === conversationId) return;
    abortRef.current?.abort();
    // Owner transfer: the fence moves before any lock is cleared, so a stale
    // send's finally cannot drop a newer turn's claim (D2 row 4).
    fence.invalidate();
    sendClaimRef.current = false;
    regenAbortReset();
    sendingRef.current = false;
    sendingInFlightRef.current = false;
    setSending(false);
    stopRequestedRef.current = false;
    if (stopWatchdogRef.current != null) {
      clearTimeout(stopWatchdogRef.current);
      stopWatchdogRef.current = null;
    }
    clearTools();
  }, [
    conversationId,
    fence,
    abortRef,
    stopWatchdogRef,
    sendingRef,
    stopRequestedRef,
    setSending,
    clearTools,
  ]);

  // Unmount: flush the partial from the ref BEFORE aborting — updateMessage
  // no-ops once unmounted and the turn's finally may never rewrite state.
  useEffect(() => {
    // The idle governor's abort bridge (`foregroundIdle.ts`): the discard
    // drains a stalled send through this handle — the controller's abort
    // inside its discard lifecycle (`Chat:2103`).
    idleDiscardAbortRef.current = () => abortRef.current?.abort();
    return () => {
      idleDiscardAbortRef.current = null;
      flushPartial();
      abortRef.current?.abort();
      sendingInFlightRef.current = false;
      fence.invalidate();
      sendClaimRef.current = false;
      if (stopWatchdogRef.current != null) {
        clearTimeout(stopWatchdogRef.current);
        stopWatchdogRef.current = null;
      }
    };
    // The root mounts once for the process; the identities are stable refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** The regen locks — held now, briefly: `messageActions.regenerate` sets
 *  `regenInFlightRef` across the truncate→send handoff and the run's own
 *  release clears it (`sendHost.releaseOwned` / the stop watchdog). This is
 *  where the old screen cleared them too, so a switch mid-handoff cannot
 *  wedge the menu closed forever. */
function regenAbortReset(): void {
  regenInFlightRef.current = false;
  regenHandleSendPassRef.current = false;
}
