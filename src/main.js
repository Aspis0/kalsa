// The shell: three pages and the tab bar between them. Status is the front
// page; there is no other navigation in the app.

import { initStatus } from "./pages/status.js";
import { initModel } from "./pages/model.js";
import { initPairing } from "./pages/pairing.js";

const tabs = Array.from(document.querySelectorAll("nav[role='tablist'] button"));

function select(name, moveFocus = false) {
  for (const tab of tabs) {
    const on = tab.dataset.page === name;
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on ? 0 : -1;
    const panel = document.getElementById(`page-${tab.dataset.page}`);
    panel.hidden = !on;
    panel.classList.toggle("is-active", on);
    if (on && moveFocus) tab.focus();
  }
}

function goTo(name) {
  if (tabs.some((tab) => tab.dataset.page === name)) select(name);
}

// Arrow keys move both selection and focus, as the tabs pattern expects: on a
// machine with a broken trackpad, the tab bar is reachable with arrows alone.
document.querySelector("nav").addEventListener("keydown", (event) => {
  const names = tabs.map((tab) => tab.dataset.page);
  const at = names.indexOf(document.activeElement?.dataset?.page);
  if (at === -1) return;
  let next = null;
  if (event.key === "ArrowRight") next = names[(at + 1) % names.length];
  if (event.key === "ArrowLeft") next = names[(at - 1 + names.length) % names.length];
  if (event.key === "Home") next = names[0];
  if (event.key === "End") next = names[names.length - 1];
  if (next) {
    event.preventDefault();
    select(next, true);
  }
});

for (const tab of tabs) {
  tab.addEventListener("click", () => select(tab.dataset.page));
}

initStatus(goTo);
initModel(goTo);
initPairing(goTo);
select("status");
