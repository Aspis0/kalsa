import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { available, invoke, listen } from "../lib/tauri";
import { lastKnown, standingOf } from "../lib/slotGate";
import type { DoorStanding } from "../lib/slotGate";
import type { ProgressStep } from "./SetupProgress";
import type { ChatSettings } from "../lib/types";

const POLL_MS = 1000;
const COULD_NOT_TELL =
  "This page could not tell whether the assistant is running. Trying again usually works.";

/** What a released model costs the owner, in one sentence. The release itself
    is the server's (`--sleep-idle-seconds`); this only says what their next
    message will find. */
const ASLEEP_SENTENCE =
  "The model is not in memory right now. Your next message brings it back, which takes a few seconds.";

/** What a refused turn-off says. Shared, because the home page is where the
    owner presses Turn off and the Server page is where they go looking when
    it did not work; two sentences for one fact is how they come to disagree. */
export const STOP_FAILURE = "The assistant did not turn off. Closing this window will stop it.";

/** The disk tier's numbers as `brain_state` answers them: three separate
    reads of the running door, not one instant. The residency count and the
    disk scan take their own locks, so they can be a moment apart, and a poll
    whose scan fails leaves the last known block standing one poll longer.
    Old numbers are possible; numbers no process produced are not — `residents`
    cannot exceed `capacity`, because both come from the same slot vector,
    fixed when the door was built. `null` when there is no door to ask: the page
    then shows no rows, never zeros. Declared here beside the poll's other
    fields because the Rust DTO (`src-tauri/src/metrics.rs`) crosses IPC only if
    this side names it too: `port: u16` already crossed without a type of its
    own, and that is the error this declaration avoids. */
export interface TierFacts {
  /** The slots the door was built with: the denominator the count below is
      honest against. NOT `/props`' `total_slots` — `door_capacity` forces that
      to 1 when the engine ignores the private headers, so the numbers diverge
      and this is the door's own. */
  capacity: number;
  /** Slots whose residency map names a chat. NOT `active_devices`: that counts
      in-flight requests before the ownership check and answers 0 at rest with
      N resident chats. */
  residents: number;
  /** One scan of the save directory, `null` when the tier is not wired or the
      directory could not be read. `unreadable` is the entries the scan skipped
      because their metadata would not read, so `bytes` and `files` are short by
      exactly that many — declared partial, never invented whole. */
  disk?: { bytes: number; files: number; unreadable: number } | null;
}

/** What `brain_state` answers: the server's own account of itself.
    `stopping` is the drain: a stop in flight, reported instead of `running`
    until the worker has torn the server down and written `stopped`. */
export interface BrainState {
  kind: "stopped" | "starting" | "stopping" | "running" | "failed";
  reason?: string;
  // Only on `running`: the DOOR's OpenAI-style address, and `null` while
  // the door is not up. The engine's own port is deliberately not offered
  // as a fallback — the page's own chat is a device at the door, and the
  // engine port has no credential and no slot. The catalog's own name for
  // what launched rides along (absent on the development path).
  endpoint?: string | null;
  model?: string;
  // Only on `running`: whether the model is in memory right now, as the
  // server's own announcement on stderr. `null` (and an absent field) is "not
  // known" — a server this app adopted on startup has no stderr to read — and
  // is never taken for "loaded".
  asleep?: boolean | null;
  metrics?: {
    decode_tokens_per_second?: number;
    // Who the door is serving right now, with the kind that tells this
    // computer's own traffic from a phone's.
    active_devices?: { kind?: string }[];
    // The door's own reads for the panel: residents, the capacity they are
    // counted against, and the directory scan. Absent or null is "no number",
    // which renders no row.
    tier?: TierFacts | null;
    throttled?: boolean;
  };
}

/** The local server as the page reaches it, while it runs: the door's
    endpoint, the model it launched, and this computer's own credential. The
    credential is a secret and lives only here, in memory, for the life of
    the window — never in settings, never in localStorage, never in a
    sentence. */
export interface BrainServer {
  endpoint: string;
  model: string;
  credential: string;
}

// One read of `brain_state` runs for the whole app: the command itself
// reconciles the pairing door on every answer, and a second poller asks the
// same question twice — `ModelsSurface` already owns one of its own. The
// surfaces and the shell subscribe to the same poll instead of each owning one.
interface BrainRead {
  state: BrainState | null;
  step: ProgressStep | null;
}

let currentState: BrainState | null = null;
let currentStep: ProgressStep | null = null;
let readSnapshot: BrainRead = { state: null, step: null };
let serverSnapshot: BrainServer | null = null;
// This computer's own credential, fetched from Rust while the door is up.
// Memory only, on purpose: it is a bearer secret, and the one place it must
// never be is somewhere it outlives the process or can be read back. It is
// re-fetched rather than kept forever, because forgetting the store mints a
// new one: see `forgetLocalCredential`.
let hostCredential: string | null = null;
// What the shell is allowed to do with a slot, derived in `publish` from the
// facts above. `unready` until the first answer: a window that has not heard
// from its own brain does not know whether there is a door to diverge from.
let standingSnapshot: DoorStanding = "unready";
const listeners = new Set<() => void>();
let pollTimer: ReturnType<typeof setInterval> | undefined;
let offProgress: (() => void) | null = null;
// A `listen()` registration in flight: not held yet, and the reason a
// second one does not start. StrictMode's mount→unmount→mount runs all
// three before the first promise answers, so "nothing held" is not
// "nothing wanted" — starting again there would put two live
// subscriptions on one bus with one stored unsubscribe between them.
let progressPending = false;

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
    currentState?.kind === "running" && currentState.endpoint && hostCredential
      ? { endpoint: currentState.endpoint, model: currentState.model ?? "", credential: hostCredential }
      : null;
  if (
    server === null ||
    serverSnapshot === null ||
    server.endpoint !== serverSnapshot.endpoint ||
    server.model !== serverSnapshot.model ||
    server.credential !== serverSnapshot.credential
  ) {
    serverSnapshot = server;
  }
  // Outside the Tauri webview this window defaults to `absent` on an
  // assumption it cannot verify: that the configured endpoint is not itself a
  // door. A remote server or a plain browser satisfies it; a browser reaching
  // this machine's door — or saved settings pointing at another
  // Kalsa-brain — does not, and a chat minted there is that door's
  // divergence by another road. Everywhere else the standing is the poll's.
  standingSnapshot = available() ? standingOf(currentState, hostCredential !== null) : "absent";
  for (const listener of listeners) listener();
}

async function poll(): Promise<void> {
  // A poll that does not answer keeps what this window already knows. Writing
  // `null` here — "not known" flattened into "no brain" — threw away exactly
  // the information that a door exists, and the next open in that second was
  // minted locally against the live slot the door was holding: the fifth way.
  if (available()) {
    try {
      currentState = lastKnown(currentState, await invoke<BrainState>("brain_state"));
    } catch {
      // The command rejected: the previous answer stands.
    }
  } else {
    currentState = null;
  }
  // The credential is fetched through its own command, never through
  // `brain_state`: the state is polled and logged-about everywhere, and the
  // secret belongs in exactly one IPC answer. Cached, but it CAN change under
  // a running window: the Devices page's hatch deletes the whole store — host
  // record included — so the door rebuilt beside it holds a key this cache
  // does not. `forgetLocalCredential` is that hatch's call, and the next poll
  // then fetches the replacement. A failed read leaves it null and the next
  // poll asks again — what must not happen is an empty string standing in for
  // a key, which the door answers with 401.
  if (currentState?.kind === "running" && currentState.endpoint && hostCredential === null) {
    try {
      const value = await invoke<string>("brain_host_credential");
      if (typeof value === "string" && value.trim()) hostCredential = value.trim();
    } catch {
      // No key yet: the page then has no local connection to offer, which is
      // the honest state, and the next poll tries again.
    }
  }
  publish();
}

/** Starts the bus subscription — the one `brain_progress` listener the whole
    app holds. A resolution that finds no reader (the last one left while the
    registration was in the air) or finds one already held releases its own
    unsubscribe at once, so whichever order the promises resolve in, one
    subscription lives while `listeners` is non-empty and none after it
    empties. */
function startProgress(): void {
  if (offProgress !== null || progressPending) return;
  progressPending = true;
  void listen("brain_progress", (step: unknown) => {
    currentStep = (step as ProgressStep) || null;
    void poll();
  }).then(
    (unsubscribe) => {
      progressPending = false;
      if (listeners.size > 0 && offProgress === null) offProgress = unsubscribe;
      else unsubscribe();
    },
    () => {
      // A registration that never landed must not leave `progressPending`
      // up: every reader after it would find the guard closed and start
      // nothing, and only a reload could take the flag back down.
      progressPending = false;
    },
  );
}

// The first reader starts the poll, the last one stops it. The bus
// subscription is async: if the last reader leaves before it answers, the
// unsubscribe still runs — `startProgress` answers its own late resolution
// with `unsubscribe()` (see above). Exported for
// `scripts/brain-progress.mjs`, which drives it against a fake bus.
export function subscribeBrainRead(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    void poll();
    pollTimer = setInterval(() => void poll(), POLL_MS);
    startProgress();
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

function getDoorStanding(): DoorStanding {
  return standingSnapshot;
}

/** The brain's server facts, for the shell. */
export function useBrainServer(): BrainServer | null {
  return useSyncExternalStore(subscribeBrainRead, getBrainServer, getBrainServer);
}

/** What this window knows about its own door, for the shell: `absent` — the one
    standing where an open may settle locally — is not the same fact as "a door
    exists and this window cannot call it yet". The gate acts on the difference
    (`lib/slotGate.ts`). */
export function useDoorStanding(): DoorStanding {
  return useSyncExternalStore(subscribeBrainRead, getDoorStanding, getDoorStanding);
}

/** Drops this computer's cached key. The Devices page's hatch deletes the
    whole store, host record included, so the door rebuilt beside it holds a
    different key — every message the page signed with the cached one would
    answer 401. Clearing it here makes the next poll fetch the replacement;
    without it the window keeps a dead credential until a reload. */
export function forgetLocalCredential(): void {
  hostCredential = null;
  publish();
}

/** The brain's own connection WINS while it runs: its door endpoint, its
    model and this computer's credential. The owner's saved values describe
    their own remote server, and are used only while the brain is not
    serving — letting a saved endpoint win would send this computer's
    credential to a remote host, or a remote key to the door, which is the
    one pairing of secret and address that must not happen. */
export function withBrainDefaults(
  settings: ChatSettings,
  server: BrainServer | null,
): ChatSettings {
  if (!server) return settings;
  return {
    ...settings,
    endpoint: server.endpoint,
    token: server.credential,
    // The model name is the one thing the brain may not have: the
    // development path pins a file no catalog choice named, and the page
    // then keeps whatever the owner typed. An empty brain model is the
    // absence of a name, not a name to send.
    model: server.model.trim() ? server.model : settings.model,
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
  //
  // The TRUE state is read before this heuristic, not after: a turn-off that
  // has landed is `stopping`, and `(busy && !running)` below is true for it
  // too — the walk flag is up while the stop is in flight and `running` is
  // false for a state that is neither — so this order would tell an owner who
  // just asked for the machine to go quiet that it is Starting.
  if (state.kind === "stopping") {
    return {
      headline: "Stopping",
      sentence: "Putting the assistant away.",
      button: "Stopping",
      enabled: false,
      running,
    };
  }
  if (state.kind === "starting" || (busy && !running)) {
    return {
      headline: "Starting",
      sentence: "Getting ready. On an older computer this can take a minute.",
      button: "Starting",
      enabled: false,
      running,
    };
  }
  // The mirror of the branch above, for the window BEFORE the stop lands.
  // `brain_stop` returns at once and the state follows on the next poll, so
  // while the command is still in the air the read says `running` — and the
  // page would hold "On — this computer is ready for you" over a server on
  // its way down, under a greyed-out Turn off. Ready is the one thing it is
  // not. This branch covers the command's flight; the `stopping` branch
  // covers the drain behind it, and the two say the same words on purpose.
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
      // A connected PHONE is real information, so it keeps its own sentence.
      // It wins over the sleeping model below: a release cannot cut a live job
      // (the server releases its weights only when idle), so a phone using this
      // computer right now is the fresher of the two facts and the one the
      // owner can see for themselves.
      //
      // The host is a device now and its own chat runs through the same door,
      // so it is counted out here: this computer's traffic must not produce a
      // sentence about a phone, and the kind is what tells them apart. A
      // device without a kind is counted as a phone — an older backend, and
      // the reading the sentence always had.
      const deviceCount = (state.metrics?.active_devices ?? []).filter(
        (device) => device.kind !== "host",
      ).length;
      // Only `true` changes the words. `false` is a model in memory, and `null`
      // is a residency nothing could announce — an adopted server, whose
      // stderr this app never held. `null` is not guessed into either answer.
      const asleep = state.asleep === true;
      return {
        headline: asleep && deviceCount === 0 ? "On, asleep" : "On",
        sentence:
          deviceCount > 0
            ? "Your phone is using this computer right now."
            : asleep
              ? ASLEEP_SENTENCE
              : "This computer is ready for you.",
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
