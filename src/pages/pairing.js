// The Pairing page: how the phone connects to this computer, in as few steps
// as possible. No pairing flow exists yet, so the page says so — showing
// invented steps would have the user trying things that cannot work.

import { pairingSteps } from "../data/placeholders.js";

const body = document.getElementById("pairing-body");
const list = document.getElementById("pairing-steps");

function render(steps) {
  if (!steps) {
    body.textContent =
      "Connecting your phone is not ready yet, so there is nothing for you to do here. When it is ready, the steps will appear on this page.";
    return;
  }
  body.textContent = "To connect your phone to this computer:";
  list.hidden = false;
  for (const step of steps) {
    const item = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = step.title;
    item.append(title);
    if (step.detail) {
      item.append(" — " + step.detail);
    }
    list.append(item);
  }
}

export function initPairing() {
  render(pairingSteps);
}
