// The Pairing page: how the phone connects to this computer, in as few steps
// as possible. No pairing flow exists yet, so the page says so — showing
// invented steps would have the user trying things that cannot work.
//
// Built by mountPairing: the app mounts one instance on #page-pairing, and
// dev/states.html mounts more with stubbed steps.

import { pairingSteps as defaultSteps } from "../data/placeholders.js";

export function mountPairing(root, { steps = defaultSteps } = {}) {
  root.innerHTML = `
    <h2>Pairing</h2>
    <p class="sentence" data-el="body"></p>
    <ol class="steps" data-el="list" hidden></ol>
  `;
  const body = root.querySelector('[data-el="body"]');
  const list = root.querySelector('[data-el="list"]');

  function render(steps) {
    if (!steps) {
      body.textContent =
        "Pairing your phone is not ready yet, so there is nothing for you to do here. When it is ready, the steps will appear on this page.";
      return;
    }
    body.textContent = "To pair your phone with this computer:";
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

  render(steps);
  return { update: render };
}

export function initPairing() {
  mountPairing(document.getElementById("page-pairing"));
}
