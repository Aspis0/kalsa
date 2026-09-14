// The Status page: one glance — is this computer helping the phone right now.
//
// The page is built by mountStatus: the app mounts one instance on
// #page-status, and dev/states.html mounts more with stubbed backends, so
// what the states page reviews is the real page code, not a drawing of it.
// Everything real comes from the supervisor (brain_state, brain_start,
// brain_stop) and the walk's own progress event (brain_progress, rendered
// by pages/setup.js). The phone and throttle facts are placeholders
// (data/placeholders.js); until they are wired, the page says it cannot
// tell, and never guesses.

import { available, invoke, listen } from "../lib/tauri.js";
import { mountSetup } from "./setup.js";
import {
  phone as defaultPhone,
  throttled as defaultThrottled,
} from "../data/placeholders.js";

const POLL_MS = 1000;

// Every sentence on this screen is a literal this page owns, or words the
// Rust side produced: brain_state's reason is failure::words' sentence, and
// brain_start's rejections are the walk's failure::words sentences. Raw
// error text is never rendered because no command sends any.
const STOP_FAILURE =
  "The assistant did not turn off. Closing this window will stop it.";

// The default source of truth: the app's own commands. The states page
// replaces this with stubs.
const tauriBackend = {
  async read() {
    if (!available()) return null;
    try {
      return await invoke("brain_state");
    } catch {
      return null;
    }
  },
  start() {
    return invoke("brain_start");
  },
  stop() {
    return invoke("brain_stop");
  },
};

const tauriEvents = {
  listen(event, handler) {
    return listen(event, handler);
  },
};

export function mountStatus(
  root,
  {
    goTo = () => {},
    phone = defaultPhone,
    throttled = defaultThrottled,
    backend = tauriBackend,
    events = tauriEvents,
  } = {},
) {
  root.innerHTML = `
    <p class="verdict" data-el="headline"></p>
    <p class="sentence" data-el="sentence"></p>
    <p class="note" data-el="note" hidden></p>
    <button type="button" class="primary" data-el="action"></button>
    <div data-el="setup" hidden></div>
  `;
  const el = (name) => root.querySelector(`[data-el="${name}"]`);
  const headline = el("headline");
  const sentence = el("sentence");
  const note = el("note");
  const action = el("action");
  const setupBox = el("setup");
  const setupView = mountSetup(setupBox);

  // The walk reports its progress as an event, not as a state: this page
  // owns the subscription, holds the latest step, and re-reads the facts so
  // the progress never renders against a stale state. The unlisten is kept
  // so whoever replaces this panel can hang up.
  let liveProgress = null;
  let offProgress = null;
  events.listen("brain_progress", (step) => {
    liveProgress = step;
    refresh();
  }).then((off) => {
    offProgress = off;
  });

  // The last render's facts, so the button acts on what the screen shows.
  let current = { state: null };
  // A failed walk has no state to live in — the supervisor is still Stopped —
  // so its sentence is held here until something actually runs. Without the
  // hold, the next poll wipes the only honest words on the screen.
  let heldFailure = null;

  // Either an action with a name, or no action: an empty name is no action,
  // so a visible labelless button is not a state this page can produce.
  function set(head, body, button, enabled) {
    headline.textContent = head;
    sentence.textContent = body;
    if (!button) {
      action.hidden = true;
      return;
    }
    action.hidden = false;
    action.textContent = button;
    action.disabled = !enabled;
  }

  function render(state) {
    current = { state };
    // The hold lives only while nothing runs: any other state has words of
    // its own. Same for the walk's progress — once something runs, or a
    // failure is being spoken, the progress view has nothing to say.
    if (!state || state.kind !== "stopped" || heldFailure) liveProgress = null;

    // The first run is not Off or On: it is a walk with live progress, and
    // while it runs the progress view replaces the switch entirely.
    if (liveProgress) {
      for (const el of [headline, sentence, note, action]) el.hidden = true;
      setupBox.hidden = false;
      setupView.update(liveProgress);
      return;
    }
    for (const el of [headline, sentence, note, action]) el.hidden = false;
    setupBox.hidden = true;

    // A slowdown the machine chose for itself is announced, never silent.
    note.hidden = throttled !== true;
    note.textContent = throttled === true
      ? "This computer is running slower on purpose, to protect itself. Answers take longer than usual."
      : "";

    if (!state) {
      set(
        "Not known",
        "This page could not tell whether the assistant is running. Trying again usually works.",
        "Try again",
        true,
      );
      return;
    }

    switch (state.kind) {
      case "stopped":
        if (heldFailure) {
          set("Stopped", heldFailure, "Try again", true);
        } else {
          set(
            "Off",
            "This computer is not helping your phone right now.",
            "Turn on",
            true,
          );
        }
        break;
      case "starting":
        set(
          "Starting",
          "Getting ready. On an older computer this can take a minute.",
          "Starting",
          false,
        );
        break;
      case "running":
        if (phone === true) {
          set("On", "Your phone is using this computer.", "Turn off", true);
        } else if (phone === false) {
          set(
            "On",
            "No phone is paired. You can pair one from the Pairing page.",
            "Turn off",
            true,
          );
        } else {
          set(
            "On",
            "This computer is ready. It cannot tell whether your phone is paired, because pairing is not ready yet.",
            "Turn off",
            true,
          );
        }
        break;
      case "failed":
        // Already in the user's words: mapped from the supervisor's structured
        // reason in main.rs `words()`.
        set("Stopped", state.reason, "Try again", true);
        break;
      default:
        set(
          "Not known",
          "This page could not tell whether the assistant is running. Trying again usually works.",
          "Try again",
          true,
        );
    }
  }

  async function refresh() {
    const state = await backend.read();
    render(state);
  }

  action.addEventListener("click", async () => {
    const { state } = current;
    if (!state) {
      refresh(); // the unknown state's action is trying again
      return;
    }
    if (state.kind === "stopped" || state.kind === "failed") {
      action.disabled = true;
      try {
        await backend.start();
        heldFailure = null;
      } catch (error) {
        // brain_start rejects with failure::words' own sentences — the
        // walk's failures among them. Speak that sentence and hold it while
        // nothing runs; the next poll must not wipe the only honest words
        // on the screen.
        heldFailure = String(error);
        set("Stopped", heldFailure, "Try again", true);
      }
      action.disabled = false;
    } else {
      action.disabled = true;
      try {
        await backend.stop();
      } catch {
        sentence.textContent = STOP_FAILURE;
      }
      action.disabled = false;
    }
    refresh();
  });

  // Whoever replaces this panel hangs up the event subscription here.
  return {
    refresh,
    dispose() {
      if (offProgress) offProgress();
    },
  };
}

export function initStatus(goTo) {
  const page = mountStatus(document.getElementById("page-status"), { goTo });
  const tick = () => page.refresh();
  tick();
  setInterval(tick, POLL_MS);
}
