// The Status page: one glance — is this computer helping the phone right now.
//
// Everything real comes from the supervisor (brain_state, brain_start,
// brain_stop) plus the one fact brain_model can honestly report. The phone
// and throttle facts are placeholders (data/placeholders.js); until they are
// wired, the page says it cannot tell, and never guesses.

import { available, invoke } from "../lib/tauri.js";
import { phone, throttled } from "../data/placeholders.js";

const POLL_MS = 1000;

const headline = document.getElementById("status-headline");
const sentence = document.getElementById("status-sentence");
const note = document.getElementById("status-note");
const action = document.getElementById("status-action");

// The last render's facts, so the button acts on what the screen shows.
let current = { state: null, modelChosen: null };
let goTo = () => {};

function set(head, body, button, enabled) {
  headline.textContent = head;
  sentence.textContent = body;
  action.textContent = button;
  action.disabled = !enabled;
  action.hidden = false;
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
      "Something went wrong reading the assistant's state. Trying again usually works.",
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
          "No phone is connected. Pair yours from the Pairing page.",
          "Turn off",
          true,
        );
      } else {
        set(
          "On",
          "This computer is ready. It cannot tell whether your phone is connected, because connecting a phone is not ready yet.",
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
        "Something went wrong reading the assistant's state. Trying again usually works.",
        "Try again",
        true,
      );
  }
}

// Every sentence on this screen is a literal this page owns, or words the
// Rust side produced in main.rs `words()` for state.reason. Raw error text is
// never rendered: if a command fails without its own words, the fallback is
// the generic honest sentence.
const GENERIC_FAILURE =
  "Something on this computer stopped the assistant from starting. Restarting the computer usually clears it.";

async function refresh() {
  if (!available()) {
    render(null, null);
    return;
  }
  try {
    const [state, model] = await Promise.all([
      invoke("brain_state"),
      invoke("brain_model"),
    ]);
    render(state, model ? model.chosen : null);
  } catch {
    render(null, null);
  }
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
      await invoke("brain_start");
    } catch {
      sentence.textContent = GENERIC_FAILURE;
    }
    action.disabled = false;
  } else {
    action.disabled = true;
    try {
      await invoke("brain_stop");
    } catch {
      // brain_stop returns nothing, so a rejection here has no words of its
      // own. This one is true: the app's exit handler stops the server.
      sentence.textContent =
        "The assistant did not turn off. Closing this window will stop it.";
    }
    action.disabled = false;
  }
  refresh();
});

export function initStatus(navigate) {
  goTo = navigate;
  refresh();
  setInterval(refresh, POLL_MS);
}
