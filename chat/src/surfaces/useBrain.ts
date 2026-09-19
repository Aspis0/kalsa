import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { available, invoke, listen } from "../lib/tauri";
import type { ProgressStep } from "./SetupProgress";
import type { ChatSettings } from "../lib/types";

const POLL_MS = 1000;
const COULD_NOT_TELL =
  "This page could not tell whether the assistant is running. Trying again usually works.";

/** What a refused turn-off says. Shared, because the home page is where the
    owner presses Turn off and the Server page is where they go looking when
    it did not work; two sentences for one fact is how they come to disagree. */
export const STOP_FAILURE = "The assistant did not turn off. Closing this window will stop it.";

/** What `brain_state` answers: the server's own account of itself. */
export interface BrainState {
  kind: "stopped" | "starting" | "running" | "failed";
  reason?: string;
  // Only on `running`: where an OpenAI-style client on this machine
  // reaches the local server, and the catalog's own name for what
  // launched (absent on the development path).
  endpoint?: string;
  model?: string;
  metrics?: {
    decode_tokens_per_second?: number;
    active_devices?: unknown[];
    throttled?: boolean;
  };
}

/** Where the local server answers and what it loaded, while it is running. */
export interface BrainServer {
  endpoint: string;
  model: string;
}

// One read of `brain_state` runs for the whole app: the command itself
// reconciles the pairing door on every answer, so a second poller would
// double its side effects. The surfaces and the shell subscribe to the
// same poll instead of each owning one.
interface BrainRead {
  state: BrainState | null;
  step: ProgressStep | null;
}

let currentState: BrainState | null = null;
let currentStep: ProgressStep | null = null;
let readSnapshot: BrainRead = { state: null, step: null };
let serverSnapshot: BrainServer | null = null;
const listeners = new Set<() => void>();
let pollTimer: ReturnType<typeof setInterval> | undefined;
let offProgress: (() => void) | null = null;

function publish(): void {
  // A stable snapshot: identical facts keep their identity, so a poll
  // that changes nothing re-renders nobody. `invoke` parses fresh JSON
  // every second, so identity has to be re-established by value — and
  // until it was, this line handed out a new object on every poll and the
  // sentence above was true only of the server block below it.
  const next: BrainRead = { state: currentState, step: currentStep };
  if (JSON.stringify(next) !== JSON.stringify(readSnapshot)) {
    readSnapshot = next;
  }
  const server =
    currentState?.kind === "running" && currentState.endpoint
      ? { endpoint: currentState.endpoint, model: currentState.model ?? "" }
      : null;
  if (
    server === null ||
    serverSnapshot === null ||
    server.endpoint !== serverSnapshot.endpoint ||
    server.model !== serverSnapshot.model
  ) {
    serverSnapshot = server;
  }
  for (const listener of listeners) listener();
}

async function poll(): Promise<void> {
  let next: BrainState | null = null;
  if (available()) {
    try {
      next = await invoke<BrainState>("brain_state");
    } catch {
      next = null;
    }
  }
  currentState = next;
  publish();
}

// The first reader starts the poll, the last one stops it. The bus
// subscription is async: if the last reader leaves before it answers,
// the unsubscribe still runs.
function subscribeBrainRead(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    void poll();
    pollTimer = setInterval(() => void poll(), POLL_MS);
    void listen("brain_progress", (step: unknown) => {
      currentStep = (step as ProgressStep) || null;
      void poll();
    }).then((unsubscribe) => {
      if (listeners.size > 0) offProgress = unsubscribe;
      else unsubscribe();
    });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(pollTimer);
      pollTimer = undefined;
      if (offProgress) offProgress();
      offProgress = null;
      // The walk's step is live only while someone reads it: the next
      // reader starts from nothing, never from a stale phase.
      currentStep = null;
      readSnapshot = { state: null, step: null };
    }
  };
}

function getBrainRead(): BrainRead {
  return readSnapshot;
}

function getBrainServer(): BrainServer | null {
  return serverSnapshot;
}

/** The brain's server facts, for the shell: filled blanks, never overrides. */
export function useBrainServer(): BrainServer | null {
  return useSyncExternalStore(subscribeBrainRead, getBrainServer, getBrainServer);
}

/** The owner's settings win; the brain's own server fills their blanks. */
export function withBrainDefaults(
  settings: ChatSettings,
  server: BrainServer | null,
): ChatSettings {
  if (!server) return settings;
  return {
    ...settings,
    endpoint: settings.endpoint.trim() ? settings.endpoint : server.endpoint,
    model: settings.model.trim() ? settings.model : server.model,
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
export function brainWords(
  state: BrainState | null,
  heldFailure: string | null,
  busy: boolean,
): BrainWords {
  const running = state?.kind === "running";
  if (!state) {
    return { headline: "Not known", sentence: COULD_NOT_TELL, button: "Try again", enabled: true, running };
  }
  // A turn-on under way owns the page, whatever it was saying before. Without
  // this, Try again on a machine that refuses the same way twice leaves the
  // screen identical for the ten seconds the probe takes, and the button
  // looks like it does nothing.
  if (state.kind === "starting" || (busy && !running)) {
    return {
      headline: "Starting",
      sentence: "Getting ready. On an older computer this can take a minute.",
      button: "Starting",
      enabled: false,
      running,
    };
  }
  // The mirror of the branch above. A turn-OFF in flight leaves the state
  // `running`, so the page held "On — this computer is ready for you" over a
  // server on its way down, under a greyed-out Turn off. Ready is the one
  // thing it is not.
  if (busy && running) {
    return {
      headline: "Stopping",
      sentence: "Putting the assistant away.",
      button: "Stopping",
      enabled: false,
      running,
    };
  }
  switch (state.kind) {
    case "stopped":
      // A held start failure means an attempt ran and did not end in a
      // running brain. "Off" would deny the attempt; "Stopped" would claim
      // something was halted that never began.
      return {
        headline: heldFailure ? "Did not start" : "Off",
        sentence: heldFailure ?? "This computer is not running anything right now.",
        button: heldFailure ? "Try again" : "Turn on",
        enabled: true,
        running,
      };
    case "running": {
      // A connected device is real information, so it keeps its own sentence.
      // With none, the honest and useful thing is that the computer is on and
      // the bar below it writes to it — the phone is one client, not the
      // reason it is running.
      const deviceCount = state.metrics?.active_devices?.length ?? 0;
      return {
        headline: "On",
        sentence:
          deviceCount > 0 ? "Your phone is using this computer right now." : "This computer is ready for you.",
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
 * The brain's state as a surface sees it: the shared poll's read, plus the
 * surface-local facts — a held start failure, a held stop failure, and
 * `act`, the one start/stop path. Surfaces never mount together, so the
 * held facts are always exactly one surface's.
 */
export function useBrain() {
  const read = useSyncExternalStore(subscribeBrainRead, getBrainRead);
  const state = read.state;
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

  function holdFailure(value: string | null): void {
    heldFailureRef.current = value;
    setHeldFailure(value);
  }

  function holdStopFailure(value: boolean): void {
    stopFailureRef.current = value;
    setStopFailure(value);
  }

  // A held stop failure survives the polls. Only the brain honestly going
  // down — or the read becoming impossible — takes it back; a new action
  // clears it in act.
  useEffect(() => {
    const next = read.state;
    if (!next || (next.kind !== "running" && next.kind !== "starting")) holdStopFailure(false);
  }, [read.state]);

  // The walk lives while the brain is on its way up and no start failure is
  // held; otherwise the ordinary view takes the page back. `starting` counts:
  // suppressing it there hid the progress bar for the whole walk and put the
  // previous measurement's card in its place, which is the one thing the
  // surface's own comment says must not happen.
  const walking = state?.kind === "stopped" || state?.kind === "starting";
  const liveStep = walking && heldFailure === null ? read.step : null;

  async function act(): Promise<void> {
    if (!state) {
      void poll();
      return;
    }
    setBusy(true);
    // The owner acted again: whatever a previous stop said is superseded.
    holdStopFailure(false);
    try {
      if (state.kind === "stopped" || state.kind === "failed") {
        // The attempt takes the page before it runs: the sentence it is
        // answering goes, and so does the previous walk's last step, so what
        // appears is this walk and not the one before it.
        holdFailure(null);
        currentStep = null;
        publish();
        await invoke("brain_start");
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
    void poll();
  }

  /**
   * Run a different model: remember the choice, stop what is running, and take
   * the walk again. The stop is skipped when nothing is up. The choice is
   * written by the backend, which is the only side that can turn the page's
   * token back into a catalog row.
   */
  async function chooseModel(token: string): Promise<void> {
    setBusy(true);
    holdStopFailure(false);
    try {
      await invoke("brain_choose_model", { token });
      if (state !== null && state.kind !== "stopped" && state.kind !== "failed") {
        await invoke("brain_stop");
      }
      holdFailure(null);
      currentStep = null;
      publish();
      await invoke("brain_start");
    } catch (error) {
      holdFailure(String(error));
    }
    setBusy(false);
    void poll();
  }

  return { state, liveStep, heldFailure, stopFailure, busy, act, chooseModel };
}
