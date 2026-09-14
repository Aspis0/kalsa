// The Model page: what this computer runs for the phone, and why.
//
// The choice is not the user's to make, and it is not made on this page:
// the first Turn on measures this machine, picks a model from the catalog
// (kalsa-catalog, via startup::run) and starts it. This page explains that
// choice. Which model was picked, and its exact reason, arrive when the
// shell grows a command for the walk's Selection — until then the page says
// what is true without inventing a name, and never asks the user to do a
// step the walk does on its own.

import { available, invoke } from "../lib/tauri.js";

const POLL_MS = 2000;

const tauriBackend = {
  async read() {
    if (!available()) return null;
    return invoke("brain_state");
  },
};

// The two sentences the checker holds the page to (dev/smoke.mjs owns its
// own copies): the choice is automatic, and picking is never the user's job.
const MODEL_AUTO =
  "A model is chosen automatically — from this computer's memory and what your phone runs — every time you turn on.";
const MODEL_NO_PICK = "You never have to pick one.";

export function mountModel(root, { goTo = () => {}, backend = tauriBackend } = {}) {
  root.innerHTML = `
    <h2>Model</h2>
    <p class="headline" data-el="headline" hidden></p>
    <p class="sentence" data-el="sentence"></p>
    <button type="button" class="primary" data-el="action" hidden></button>
  `;
  const headline = root.querySelector('[data-el="headline"]');
  const sentence = root.querySelector('[data-el="sentence"]');
  const action = root.querySelector('[data-el="action"]');

  let onAction = () => {};

  function apply({ head = null, text, button = null }) {
    headline.hidden = head === null;
    if (head !== null) headline.textContent = head;
    sentence.textContent = text;
    action.hidden = button === null;
    if (button !== null) action.textContent = button;
  }

  function render(state) {
    if (!state) {
      apply({
        text: "This page could not check what this computer is running. Trying again usually works.",
      });
      return;
    }

    switch (state.kind) {
      case "running":
        onAction = () => {};
        apply({
          head: "Chosen for this computer",
          text: `${MODEL_AUTO} ${MODEL_NO_PICK}`,
        });
        break;
      case "starting":
        onAction = () => {};
        apply({
          head: "Chosen and starting",
          text: "A model has been chosen for this computer. It is starting now.",
        });
        break;
      case "failed":
        onAction = () => {};
        apply({
          head: "Not running",
          text: "This computer is not running right now. The Status page says why.",
        });
        break;
      case "stopped":
        onAction = () => goTo("status");
        apply({
          text: "When you turn on, this computer measures itself, picks a model it can run, and starts it. You never have to pick anything.",
          button: "Go to Status",
        });
        break;
      default:
        onAction = () => {};
        apply({
          text: "This page could not tell what this computer is running. Trying again usually works.",
        });
    }
  }

  async function refresh() {
    if (!backend) {
      onAction = () => {};
      apply({
        text: "This page works inside the Kalsa Brain app. Open the app on this computer.",
      });
      return;
    }
    let state = null;
    try {
      state = await backend.read();
    } catch {
      state = null; // unknown, not stopped
    }
    render(state);
  }

  return { refresh };
}

export function initModel(goTo) {
  const page = mountModel(document.getElementById("page-model"), { goTo });
  const tick = () => page.refresh();
  tick();
  setInterval(tick, POLL_MS);
}
