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
      "Whether this computer is helping your phone is not known right now.",
      "",
      false,
    );
    action.hidden = true;
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
          "This computer is ready. It cannot tell yet whether your phone is connected.",
          "Turn off",
          true,
        );
      }
      break;
    case "failed":
      // The reason is the supervisor's own sentence about what happened.
      set("Stopped", state.reason, "Try again", true);
      break;
    default:
      set(
        "Not known",
        "Whether this computer is helping your phone is not known right now.",
        "",
        false,
      );
      action.hidden = true;
  }
}

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
  if (!state) return;
  if (state.kind === "stopped" || state.kind === "failed") {
    if (modelChosen === false) {
      goTo("model");
      return;
    }
    action.disabled = true;
    try {
      await invoke("brain_start");
    } catch (error) {
      // The command's own words: they are written to be read.
      sentence.textContent = String(error);
    }
    action.disabled = false;
  } else {
    action.disabled = true;
    try {
      await invoke("brain_stop");
    } catch (error) {
      sentence.textContent = String(error);
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
