// The Status page: one glance tells the owner whether the local server is
// helping the phone, and the cards below show only facts the process produced.

import { available, invoke, listen } from "../lib/tauri.js";
import { mountSetup } from "./setup.js";

const POLL_MS = 1000;
const STOP_FAILURE =
  "The assistant did not turn off. Closing this window will stop it.";

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

function rateText(rate) {
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0
    ? `${rate.toFixed(1)} tokens/s`
    : "Not measured yet";
}

function phoneText(connected) {
  if (connected === true) return "Connected";
  if (connected === false) return "Not connected";
  return "Not measured yet";
}

function setMetric(element, value, positive = false) {
  const changed = element.textContent !== value;
  element.textContent = value;
  element.classList?.toggle("is-positive", positive);
  if (!changed) return;
  element.classList?.add("is-updating");
  setTimeout(() => element.classList?.remove("is-updating"), 180);
}

function setHeadline(element, value) {
  const changed = element.textContent !== value;
  element.textContent = value;
  if (!changed) return;
  element.classList?.add("is-changing");
  setTimeout(() => element.classList?.remove("is-changing"), 180);
}

export function mountStatus(
  root,
  { goTo = () => {}, backend = tauriBackend, events = { listen: () => Promise.resolve(() => {}) } } = {},
) {
  root.innerHTML = `
    <p class="eyebrow">STATUS</p>
    <p class="verdict" data-el="headline"></p>
    <p class="sentence" data-el="sentence"></p>
    <div class="metrics-grid" data-el="metrics" hidden>
      <div class="metric"><span class="metric-label">Decode</span><strong class="metric-value" data-el="rate">Not measured yet</strong><span class="metric-detail">Measured by the server</span></div>
      <div class="metric"><span class="metric-label">Phone</span><strong class="metric-value" data-el="phone">Not measured yet</strong><span class="metric-detail">Live connection</span></div>
    </div>
    <p class="note" data-el="note" hidden></p>
    <button type="button" class="primary" data-el="action"></button>
    <div data-el="setup" hidden></div>
  `;
  const el = (name) => root.querySelector(`[data-el="${name}"]`);
  const headline = el("headline");
  const sentence = el("sentence");
  const metrics = el("metrics");
  const rate = el("rate");
  const phone = el("phone");
  const note = el("note");
  const action = el("action");
  const setupBox = el("setup");
  const setupView = mountSetup(setupBox);

  let liveProgress = null;
  let offProgress = null;
  let current = { state: null };
  let heldFailure = null;
  events.listen("brain_progress", (step) => {
    liveProgress = step;
    refresh();
  }).then((off) => {
    offProgress = off;
  });

  function set(head, body, button, enabled) {
    setHeadline(headline, head);
    sentence.textContent = body;
    action.hidden = !button;
    if (button) action.textContent = button;
    action.disabled = !enabled;
  }

  function renderMetrics(state) {
    const data = state?.metrics ?? {};
    metrics.hidden = false;
    setMetric(rate, rateText(data.decode_tokens_per_second));
    setMetric(phone, phoneText((data.active_devices?.length ?? 0) > 0), (data.active_devices?.length ?? 0) > 0);
    note.hidden = data.throttled !== true;
    note.textContent = data.throttled === true
      ? "This computer is running slower on purpose, to protect itself. Answers take longer than usual."
      : "";
  }

  function clearMetrics() {
    metrics.hidden = true;
    note.hidden = true;
    note.textContent = "";
  }

  function render(state) {
    current = { state };
    if (!state || state.kind !== "stopped" || heldFailure) liveProgress = null;
    if (liveProgress) {
      for (const item of [headline, sentence, metrics, note, action]) item.hidden = true;
      setupBox.hidden = false;
      setupView.update(liveProgress);
      return;
    }
    for (const item of [headline, sentence, action]) item.hidden = false;
    setupBox.hidden = true;
    clearMetrics();

    if (!state) {
      set("Not known", "This page could not tell whether the assistant is running. Trying again usually works.", "Try again", true);
      return;
    }
    switch (state.kind) {
      case "stopped":
        set(
          heldFailure ? "Stopped" : "Off",
          heldFailure ?? "This computer is not helping your phone right now.",
          heldFailure ? "Try again" : "Turn on",
          true,
        );
        break;
      case "starting":
        set("Starting", "Getting ready. On an older computer this can take a minute.", "Starting", false);
        break;
      case "running":
        renderMetrics(state);
        set("On", (state.metrics?.active_devices?.length ?? 0) > 0
          ? "Your phone is using this computer right now."
          : "This computer is ready for your phone.", "Turn off", true);
        break;
      case "failed":
        set("Stopped", state.reason, "Try again", true);
        break;
      default:
        set("Not known", "This page could not tell whether the assistant is running. Trying again usually works.", "Try again", true);
    }
  }

  async function refresh() {
    const state = await backend.read();
    render(state);
  }

  action.addEventListener("click", async () => {
    const { state } = current;
    if (!state) {
      refresh();
      return;
    }
    action.disabled = true;
    try {
      if (state.kind === "stopped" || state.kind === "failed") {
        await backend.start();
        heldFailure = null;
      } else {
        await backend.stop();
      }
    } catch (error) {
      if (state.kind === "stopped" || state.kind === "failed") {
        heldFailure = String(error);
        set("Stopped", heldFailure, "Try again", true);
      } else {
        sentence.textContent = STOP_FAILURE;
      }
    }
    action.disabled = false;
    refresh();
  });

  return {
    refresh,
    dispose() {
      if (offProgress) offProgress();
    },
  };
}

export function initStatus(goTo) {
  const page = mountStatus(document.getElementById("page-status"), { goTo });
  setInterval(() => page.refresh(), POLL_MS);
  page.refresh();
}
