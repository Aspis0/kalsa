import { useCallback, useEffect, useRef, useState } from "react";
import { available, invoke, listen } from "../lib/tauri";
import type { ProgressStep } from "./SetupProgress";

const POLL_MS = 1000;
const COULD_NOT_TELL =
  "This page could not tell whether the assistant is running. Trying again usually works.";

/** What `brain_state` answers: the server's own account of itself. */
export interface BrainState {
  kind: "stopped" | "starting" | "running" | "failed";
  reason?: string;
  metrics?: {
    decode_tokens_per_second?: number;
    active_devices?: unknown[];
    throttled?: boolean;
  };
}

/** The state as words: headline, sentence, and the one honest button. */
export interface BrainWords {
  headline: string;
  sentence: string;
  button: string;
  enabled: boolean;
  running: boolean;
}

// The brain's state in words, shared by the brain page (presence only) and
// the Server surface (which adds its metrics). One decision, so the two
// pages can never disagree about the same machine.
export function brainWords(state: BrainState | null, heldFailure: string | null): BrainWords {
  const running = state?.kind === "running";
  if (!state) {
    return { headline: "Not known", sentence: COULD_NOT_TELL, button: "Try again", enabled: true, running };
  }
  switch (state.kind) {
    case "stopped":
      return {
        headline: heldFailure ? "Stopped" : "Off",
        sentence: heldFailure ?? "This computer is not helping your phone right now.",
        button: heldFailure ? "Try again" : "Turn on",
        enabled: true,
        running,
      };
    case "starting":
      return {
        headline: "Starting",
        sentence: "Getting ready. On an older computer this can take a minute.",
        button: "Starting",
        enabled: false,
        running,
      };
    case "running": {
      const deviceCount = state.metrics?.active_devices?.length ?? 0;
      return {
        headline: "On",
        sentence:
          deviceCount > 0 ? "Your phone is using this computer right now." : "This computer is ready for your phone.",
        button: "Turn off",
        enabled: true,
        running: true,
      };
    }
    case "failed":
      return { headline: "Stopped", sentence: state.reason ?? "", button: "Try again", enabled: true, running };
    default:
      return { headline: "Not known", sentence: COULD_NOT_TELL, button: "Try again", enabled: true, running };
  }
}

/**
 * The brain's state as the frontend sees it: the polled `brain_state` read,
 * the live `brain_progress` step, and `act` — the one start/stop path. Two
 * surfaces use it, never at the same time (one surface shows at once), so
 * there is always exactly one poller, as before.
 */
export function useBrain() {
  const [state, setState] = useState<BrainState | null>(null);
  // A start that failed keeps its own sentence on the page against the poll,
  // until a start actually succeeds.
  const [heldFailure, setHeldFailure] = useState<string | null>(null);
  const heldFailureRef = useRef<string | null>(null);
  // A stop that failed says so until the brain is honestly down or the
  // owner acts again. Held in a ref like a start failure: the sentence is
  // the one warning that the server is still running after a stop, and a
  // poll landing a moment later must not erase it before it is read.
  const [stopFailure, setStopFailure] = useState(false);
  const stopFailureRef = useRef(false);
  const [busy, setBusy] = useState(false);
  // The latest walk step, live. It is cleared — never shown stale — the
  // moment the read stops saying "stopped".
  const [liveStep, setLiveStep] = useState<ProgressStep | null>(null);

  function holdFailure(value: string | null): void {
    heldFailureRef.current = value;
    setHeldFailure(value);
  }

  function holdStopFailure(value: boolean): void {
    stopFailureRef.current = value;
    setStopFailure(value);
  }

  const refresh = useCallback(async (): Promise<void> => {
    let next: BrainState | null = null;
    if (available()) {
      try {
        next = await invoke<BrainState>("brain_state");
      } catch {
        next = null;
      }
    }
    setState(next);
    // A held stop failure survives the poll. Only the brain really going
    // down — or becoming unreadable — takes it back; a new action clears
    // it in act.
    if (!next || (next.kind !== "running" && next.kind !== "starting")) holdStopFailure(false);
    // The walk lives only while the read still says stopped and no start
    // failure is held; otherwise the ordinary view takes the page back.
    if (!next || next.kind !== "stopped" || heldFailureRef.current) setLiveStep(null);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // The subscription is async: if the surface unmounts before the bus
  // answers, the unsubscribe still runs.
  useEffect(() => {
    let off: (() => void) | null = null;
    let live = true;
    void listen("brain_progress", (step: unknown) => {
      setLiveStep((step as ProgressStep) || null);
      void refresh();
    }).then((unsubscribe) => {
      if (live) off = unsubscribe;
      else unsubscribe();
    });
    return () => {
      live = false;
      if (off) off();
    };
  }, [refresh]);

  async function act(): Promise<void> {
    if (!state) {
      void refresh();
      return;
    }
    setBusy(true);
    // The owner acted again: whatever a previous stop said is superseded.
    holdStopFailure(false);
    try {
      if (state.kind === "stopped" || state.kind === "failed") {
        await invoke("brain_start");
        holdFailure(null);
      } else {
        await invoke("brain_stop");
      }
    } catch (error) {
      if (state.kind === "stopped" || state.kind === "failed") {
        holdFailure(String(error));
      } else {
        // Held against the polls: the brain is (still) not down, and the
        // sentence stays until that honestly changes.
        holdStopFailure(true);
      }
    }
    setBusy(false);
    void refresh();
  }

  return { state, liveStep, heldFailure, stopFailure, busy, act };
}
