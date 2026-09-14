// The Model page: what this computer runs for the phone, and why this one.
//
// The page is built by mountModel: the app mounts one instance on
// #page-model, and dev/states.html mounts more with stubbed backends.
//
// Two eras share this file on purpose. Until kalsa-catalog's `brain_choice`
// is wired, the page walks a real interim ladder: measure this computer
// (brain_measure, the probe), then wait for the phone. When brain_choice
// lands, initModel becomes `ctrl.showDecision(await invoke("brain_choice"))`
// and the ladder is deleted; showDecision and its copy are already shaped on
// kalsa-catalog::Decision, so that swap is a substitution, not a rewrite.

import { available, invoke } from "../lib/tauri.js";

// The default source of truth: the app's own commands. The states page
// replaces this with stubs.
const tauriBackend = {
  measured() {
    return invoke("brain_measured");
  },
  measure() {
    return invoke("brain_measure");
  },
};

export function mountModel(root, { goTo = () => {}, backend = tauriBackend } = {}) {
  root.innerHTML = `
    <h2>Model</h2>
    <p class="headline" data-el="headline"></p>
    <p class="sentence" data-el="body"></p>
    <p class="sentence" data-el="rationale" hidden></p>
    <button type="button" class="primary" data-el="action" hidden></button>
  `;
  const el = (name) => root.querySelector(`[data-el="${name}"]`);
  const headline = el("headline");
  const body = el("body");
  const rationale = el("rationale");
  const action = el("action");

  // Where the page is, so the button knows what to do. `measuring` exists so a
  // slow probe reads as progress, not as a dead window.
  let mode = "unknown";

  // Either an action with a name, or no action: an empty name is no action,
  // so a visible labelless button is not a state this page can produce.
  function set(head, text, button, enabled) {
    headline.textContent = head;
    body.textContent = text;
    rationale.hidden = true;
    if (!button) {
      action.hidden = true;
      return;
    }
    action.hidden = false;
    action.textContent = button;
    action.disabled = !enabled;
  }

  // Every state below ends in something the user can press, or in a plain
  // "not available in this view" — never in a statement with no exit.
  const STATES = {
    // Only reachable outside the app's own window (a browser checking the
    // layout); a user in the app never sees it.
    unknown: () =>
      set(
        "No model chosen",
        "This page works inside the Kalsa Brain app. Open the app on this computer.",
        null,
        false,
      ),
    unmeasured: () =>
      set(
        "No model chosen",
        "This computer has not been measured yet, so no model can be chosen. Measuring takes a few seconds.",
        "Measure this computer",
        true,
      ),
    measuring: () =>
      set(
        "Measuring",
        "Checking how fast this computer is.",
        "Measuring…",
        false,
      ),
    // The probe ran but does not believe its own numbers: a busy machine.
    unreliable: () =>
      set(
        "No model chosen",
        "This computer was too busy to measure cleanly. Trying again usually works.",
        "Measure again",
        true,
      ),
    // The measuring itself failed — a different story from an unclean
    // reading, and not claimed to be a busy machine.
    measureError: () =>
      set(
        "No model chosen",
        "The measuring did not finish. Trying again usually works.",
        "Measure again",
        true,
      ),
    awaitingPhone: () =>
      set(
        "No model chosen",
        "This computer has been measured. Before a model can be chosen for it, we need to know which model your phone runs.",
        "Pair your phone",
        true,
      ),
    // The measured flag itself could not be read. Rare, and not worth a
    // second word.
    unreadable: () =>
      set(
        "No model chosen",
        "This page could not check whether this computer has been measured. Trying again usually works.",
        "Try again",
        true,
      ),
  };

  async function refresh() {
    if (!backend) {
      mode = "unknown";
      STATES.unknown();
      return;
    }
    let measured = null;
    try {
      measured = await backend.measured();
    } catch {
      // leave null: the flag is unknown, not false
    }
    if (measured === null) {
      mode = "unreadable";
    } else {
      mode = measured ? "awaitingPhone" : "unmeasured";
    }
    STATES[mode]();
  }

  action.addEventListener("click", async () => {
    if (mode === "unreadable") {
      refresh();
      return;
    }
    if (mode === "awaitingPhone") {
      goTo("pairing");
      return;
    }
    if (mode !== "unmeasured" && mode !== "unreliable" && mode !== "measureError") {
      return;
    }
    mode = "measuring";
    STATES.measuring();
    try {
      const reliable = await backend.measure();
      mode = reliable ? "awaitingPhone" : "unreliable";
    } catch {
      mode = "measureError";
    }
    STATES[mode]();
  });

  // ---- The brain_choice substitution target ----

  // One plain sentence per RefusalReason. The crate's own explanation is the
  // fallback for anything this map has not caught up with.
  const REFUSAL_COPY = {
    phoneUnknown:
      "We do not know which model your phone runs yet. Pair the phone first; after that, this page can say which model to run here.",
    machineNotMeasured:
      "This computer has not been measured yet, so no model can be chosen. Nothing on this page is a guess, and nothing will be until the measuring has run.",
    nothingFits:
      "No model that would fit on this computer was found. There is nothing to choose.",
    nothingBetter:
      "Nothing here would be better than what your phone already runs. This computer is not worth it as a second brain.",
    nothingFastEnough:
      "Everything that would fit on this computer would be too slow to use. A slow answer is worse than the one your phone already gives.",
  };

  const JUSTIFICATION_COPY = {
    capability:
      "This model knows more than the one on your phone. That is why it runs here.",
    relief:
      "This model is not smarter than the one on your phone. It runs here so your phone's battery lasts longer.",
    expectedButUnmeasured:
      "This model should be better than the one on your phone. We have not tested it on this computer yet.",
  };

  function showDecision(decision) {
    if (!decision) {
      set(
        "No model chosen",
        "This page will say which model this computer runs for your phone, and why that one.",
        null,
        false,
      );
      return;
    }
    if (decision.refuse) {
      set(
        "No model chosen",
        REFUSAL_COPY[decision.refuse.reason] ?? decision.refuse.explanation,
        null,
        false,
      );
      return;
    }
    const pick = decision.pick;
    headline.textContent = pick.label;
    body.textContent =
      JUSTIFICATION_COPY[pick.justification] ?? "Why this one is not explained yet.";
    rationale.textContent = pick.rationale;
    rationale.hidden = !pick.rationale;
    action.hidden = true;
  }

  return { refresh, showDecision };
}

export function initModel(goTo) {
  const page = mountModel(document.getElementById("page-model"), { goTo });
  page.refresh();
}
