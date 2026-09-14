// The Status page: one glance — is this computer helping the phone right now.
//
// The page is built by mountStatus: the app mounts one instance on
// #page-status, and dev/states.html mounts more with stubbed backends, so
// what the states page reviews is the real page code, not a drawing of it.
// Everything real comes from the supervisor (brain_state, brain_start,
// brain_stop) plus the one fact brain_model can honestly report. The phone
// and throttle facts are placeholders (data/placeholders.js); until they are
// wired, the page says it cannot tell, and never guesses.

import { available, invoke } from "../lib/tauri.js";
import {
  phone as defaultPhone,
  throttled as defaultThrottled,
} from "../data/placeholders.js";

const POLL_MS = 1000;

// Every sentence on this screen is a literal this page owns, or words the
// Rust side produced in main.rs `words()` for state.reason. Raw error text is
// never rendered: if a command fails without its own words, the fallback is
// the generic honest sentence.
const GENERIC_FAILURE =
  "Something on this computer stopped the assistant from starting. Restarting the computer usually clears it.";

const STOP_FAILURE =
  "The assistant did not turn off. Closing this window will stop it.";

// The default source of truth: the app's own commands. The states page
// replaces this with stubs.
const tauriBackend = {
  async read() {
    if (!available()) return null;
    try {
      const [state, model] = await Promise.all([
        invoke("brain_state"),
        invoke("brain_model"),
      ]);
      return [state, model ? model.chosen : null];
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

export function mountStatus(
  root,
  {
    goTo = () => {},
    phone = defaultPhone,
    throttled = defaultThrottled,
    backend = tauriBackend,
  } = {},
) {
  root.innerHTML = `
    <p class="verdict" data-el="headline"></p>
    <p class="sentence" data-el="sentence"></p>
    <p class="note" data-el="note" hidden></p>
    <button type="button" class="primary" data-el="action"></button>
  `;
  const el = (name) => root.querySelector(`[data-el="${name}"]`);
  const headline = el("headline");
  const sentence = el("sentence");
  const note = el("note");
  const action = el("action");

  // The last render's facts, so the button acts on what the screen shows.
  let current = { state: null, modelChosen: null };

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

  function render(state, modelChosen) {
    current = { state, modelChosen };

    // A slowdown the machine chose for itself is announced, never silent.
    note.hidden = throttled !== true;
    note.textContent = throttled === true
      ? "This computer is running slower on purpose, to protect itself. Answers take longer than usual."
      : "";

    if (!state || modelChosen === null) {
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
        if (modelChosen === false) {
          set(
            "Not set up",
            "This computer needs a model before it can help your phone.",
            "Choose a model",
            true,
          );
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
    const read = await backend.read();
    if (!read) {
      render(null, null);
      return;
    }
    render(read[0], read[1]);
  }

  action.addEventListener("click", async () => {
    const { state, modelChosen } = current;
    if (!state) {
      refresh(); // the unknown state's action is trying again
      return;
    }
    if (state.kind === "stopped" || state.kind === "failed") {
      if (modelChosen === false) {
        goTo("model");
        return;
      }
      action.disabled = true;
      try {
        await backend.start();
      } catch {
        sentence.textContent = GENERIC_FAILURE;
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

  return { refresh };
}

export function initStatus(goTo) {
  const page = mountStatus(document.getElementById("page-status"), { goTo });
  const tick = () => page.refresh();
  tick();
  setInterval(tick, POLL_MS);
}
