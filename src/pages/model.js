// The Model page explains that selection is automatic and owns the advanced
// launch controls. The chooser remains in Rust; this page only reads its
// answer and sends explicit edits back to the start command.

import { available, invoke } from "../lib/tauri.js";
import { mountAdvanced } from "./advanced.js";

const POLL_MS = 2000;
const MODEL_AUTO =
  "A model is chosen automatically — from this computer's memory and what your phone runs — every time you turn on.";
const MODEL_NO_PICK = "You never have to pick one.";

const tauriBackend = {
  async read() {
    if (!available()) return null;
    return invoke("brain_state");
  },
};

const tauriAdvancedBackend = {
  read() {
    if (!available()) return Promise.resolve(null);
    return invoke("brain_advanced");
  },
  save(contextTokens, idleUnloadSeconds) {
    return invoke("brain_set_advanced", { contextTokens, idleUnloadSeconds });
  },
};

export function mountModel(
  root,
  { goTo = () => {}, backend = tauriBackend, advancedBackend = tauriAdvancedBackend } = {},
) {
  root.innerHTML = `
    <p class="eyebrow">MODEL</p>
    <h2>How this computer thinks</h2>
    <p class="headline" data-el="headline" hidden></p>
    <p class="sentence" data-el="sentence"></p>
    <button type="button" class="primary" data-el="action" hidden></button>
    <div data-el="advanced"></div>
  `;
  const headline = root.querySelector('[data-el="headline"]');
  const sentence = root.querySelector('[data-el="sentence"]');
  const action = root.querySelector('[data-el="action"]');
  const advanced = mountAdvanced(root.querySelector('[data-el="advanced"]'), {
    backend: advancedBackend,
  });
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
        apply({ head: "Chosen for this computer", text: `${MODEL_AUTO} ${MODEL_NO_PICK}` });
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
    let state = null;
    if (backend) {
      try {
        state = await backend.read();
      } catch {
        state = null;
      }
    }
    if (!backend) {
      apply({
        text: "This page works inside the Kalsa Brain app. Open the app on this computer.",
      });
    } else {
      render(state);
    }
    await advanced.refresh();
  }

  action.addEventListener("click", () => onAction());
  return { refresh, advanced };
}

export function initModel(goTo) {
  const page = mountModel(document.getElementById("page-model"), { goTo });
  setInterval(() => page.refresh(), POLL_MS);
  page.refresh();
}
