// The React review bench: mounts the real chat surfaces once per state, with
// a stubbed Tauri bridge. It uses the same invoke/listen path as the app and
// unmounts every root so polling timers cannot keep the process alive.
//
// Stub rules: failure sentences marked "(real words)" are copied verbatim
// from main.rs `words()`; invented examples and numbers carry "(stub)".

import React from "react";
import { createRoot } from "react-dom/client";
import { AdvancedSurface } from "../chat/src/surfaces/AdvancedSurface";
import { DevicesSurface } from "../chat/src/surfaces/DevicesSurface";
import { ModelsSurface } from "../chat/src/surfaces/ModelsSurface";
import { ServerSurface } from "../chat/src/surfaces/ServerSurface";
import { completionBody } from "../chat/src/lib/chat";
import { loadSampling, samplingProblem, samplingWire, saveSampling } from "../chat/src/lib/sampling";
import { SAMPLING_KNOBS } from "../chat/src/lib/knobs/sampling";

const REASON_PORT =
  "Another program is in the way. Restarting the computer usually clears it.";
const REASON_UNFUNDABLE =
  "The model chosen for this computer needs more memory than the computer can give it, even to start. An app update may bring a smaller option.";
const REASON_CONNECTION_LOST =
  "The connection dropped partway through. Trying again keeps what was already downloaded.";
const REASON_LONG =
  "The assistant stopped while it was getting ready. This can happen when the computer runs out of room while it is working. Turning it on again usually works, and closing other programs helps if it keeps happening. (stub)";
const MODEL_BYTES = 3786957088;
const STUB_SQUARE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21" shape-rendering="crispEdges">' +
  '<rect width="21" height="21" fill="#ffffff"/>' +
  '<path fill="#000000" d="M4 4h2v2H4zM8 4h1v1H8zM4 8h1v1H4zM10 10h3v3h-3zM6 12h1v1H6zM12 6h2v1h-2z"/>' +
  "</svg> (stub square)";

const ONE_DEVICE = [
  { id: 0, label: "Paired phone", phone: "phone with 2 GB of model weights" },
];
const MANY_DEVICES = [
  ...ONE_DEVICE,
  { id: 1, label: "Paired phone 2", phone: "phone with 3 GB of model weights" },
];

function advancedDto(extra = {}) {
  return {
    context_tokens: 4096,
    context_max: 8192,
    context_max_f16: 4096,
    context_override: null,
    idle_unload_seconds: 300,
    idle_override: null,
    batch_size: 512,
    batch_override: null,
    batch_automatic: 2048,
    ubatch_size: 128,
    ubatch_override: null,
    ubatch_automatic: 1024,
    kv_cache_type: "q8_0",
    kv_cache_override: null,
    kv_cache_automatic: "q8_0",
    flash_attention: "on",
    gpu_layers: "all",
    threads: 8,
    threads_batch: 8,
    door_port: 8131,
    internet_road: true,
    iroh_sentence:
      "The internet road is open. The phone can find this computer by " +
      "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08.",
    running: true,
    ...extra,
  };
}

function pairingDto(state, extra = {}) {
  return {
    state,
    qr_svg: null,
    refreshed: null,
    phone: null,
    devices: [],
    delivery_pending: false,
    door_port: null,
    failure: null,
    ...extra,
  };
}

function stateDto(kind, metrics = {}) {
  return {
    kind,
    metrics: {
      decode_tokens_per_second: null,
      active_devices: undefined,
      throttled: null,
      ...metrics,
    },
  };
}

const scenarios = [
  ["Status", "a progress event arrives and is shown (real bytes)", "server", { state: stateDto("stopped"), step: { kind: "model_bytes", done: 2100000000, total: MODEL_BYTES } }],
  ["Status", "a progress event: the engine's bytes (real bytes)", "server", { state: stateDto("stopped"), step: { kind: "runtime_bytes", done: 8000000, total: 18000000 } }],
  ["Status", "a progress event: resumed past zero (real bytes)", "server", { state: stateDto("stopped"), step: { kind: "model_bytes", done: 401000000, total: MODEL_BYTES } }],
  ["Status", "a progress event: no size announced (real bytes)", "server", { state: stateDto("stopped"), step: { kind: "model_bytes", done: 320000000, total: 0 } }],
  ["Status", "first run: measuring the machine", "server", { state: stateDto("stopped"), step: { kind: "measuring" } }],
  ["Status", "first run: deciding the engine", "server", { state: stateDto("stopped"), step: { kind: "deciding" } }],
  ["Status", "first run: choosing a model", "server", { state: stateDto("stopped"), step: { kind: "choosing" } }],
  ["Status", "first run: no model, engine off", "server", { state: stateDto("stopped") }],
  ["Status", "off, with a model set up", "server", { state: stateDto("stopped") }],
  ["Status", "starting", "server", { state: stateDto("starting") }],
  ["Status", "running, phone unknown", "server", { state: stateDto("running") }],
  ["Status", "running, live metrics (stub)", "server", { state: stateDto("running", { decode_tokens_per_second: 18.6, active_devices: [{}] }) }],
  ["Status", "running, phone not connected", "server", { state: stateDto("running", { active_devices: [] }) }],
  ["Status", "failed (real words)", "server", { state: { ...stateDto("failed"), reason: REASON_PORT } }],
  ["Status", "failed: the connection dropped (real words)", "server", { state: { ...stateDto("failed"), reason: REASON_CONNECTION_LOST } }],
  ["Status", "failed: the chosen model cannot be funded (real words)", "server", { state: { ...stateDto("failed"), reason: REASON_UNFUNDABLE } }],
  ["Status", "failed, deliberately long reason (wrap test)", "server", { state: { ...stateDto("failed"), reason: REASON_LONG } }],
  ["Status", "state unreadable", "server", { state: null }],
  ["Status", "running, with a slowdown announced", "server", { state: stateDto("running", { throttled: true }) }],

  ["Model", "running: the choice is automatic", "models", { state: { kind: "running" } }],
  ["Model", "advanced settings are visible", "models", { state: { kind: "running" }, advanced: advancedDto() }],
  ["Model", "advanced settings with the internet road unavailable", "models", { state: { kind: "running" }, advanced: advancedDto({ iroh_sentence: "The internet road could not open on this computer. The other roads to it still work." }) }],
  ["Model", "advanced settings with the internet road turned off", "models", { state: { kind: "running" }, advanced: advancedDto({ internet_road: false, iroh_sentence: "The internet road is turned off. The phone reaches this computer the Tailscale way." }) }],
  ["Model", "advanced settings with an f16 cache override", "models", { state: { kind: "running" }, advanced: advancedDto({ kv_cache_override: "f16", kv_cache_type: "f16" }) }],
  ["Model", "advanced settings with a saved micro-batch", "models", { state: { kind: "running" }, advanced: advancedDto({ ubatch_override: 1024, ubatch_size: 1024 }) }],
  ["Model", "starting on the chosen model", "models", { state: { kind: "starting" } }],
  ["Model", "off: nothing is chosen while off", "models", { state: { kind: "stopped" } }],
  ["Model", "not running: the Status page says why", "models", { state: { kind: "failed", reason: REASON_PORT } }],
  ["Model", "outside the app (browser preview)", "models", { available: false }],

  ["Pairing", "nothing to pair to yet", "devices", { pairing: pairingDto("idle") }],
  ["Pairing", "a square is waiting", "devices", { pairing: pairingDto("waiting", { qr_svg: STUB_SQUARE }) }],
  ["Pairing", "a fresh square after the old one expired", "devices", { pairing: pairingDto("waiting", { qr_svg: STUB_SQUARE, refreshed: "expired" }) }],
  ["Pairing", "a fresh square after one did not match", "devices", { pairing: pairingDto("waiting", { qr_svg: STUB_SQUARE, refreshed: "wrong-code" }) }],
  ["Pairing", "a phone is connecting", "devices", { pairing: pairingDto("claiming") }],
  ["Pairing", "paired; another phone can be paired", "devices", { pairing: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: ONE_DEVICE, door_port: 8131 }) }],
  ["Pairing", "saved here; the phone still needs the response", "devices", { pairing: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: ONE_DEVICE, delivery_pending: true, door_port: 8131 }) }],
  ["Pairing", "paired; the house holds several devices", "devices", { pairing: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: MANY_DEVICES, door_port: 8131 }) }],
  ["Pairing", "paired; the newest of several still waits for its response", "devices", { pairing: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: MANY_DEVICES, delivery_pending: true, door_port: 8131 }) }],
  ["Pairing", "the connection could not be saved", "devices", { pairing: pairingDto("failed", { failure: "could-not-save" }) }],
  ["Pairing", "the existing phone connection could not be read", "devices", { pairing: pairingDto("failed", { failure: "could-not-read" }) }],
  ["Pairing", "the local pairing service stopped", "devices", { pairing: pairingDto("failed", { failure: "service-unavailable" }) }],
];

let bridgeState = {};
let eventHandlers = new Set();

function installBridge() {
  globalThis.window.__TAURI__ = bridgeState.available === false
    ? undefined
    : {
        core: {
          invoke(command) {
            if (command === "brain_state") return Promise.resolve(bridgeState.state ?? null);
            if (command === "brain_pairing") return Promise.resolve(bridgeState.pairing ?? null);
            if (command === "brain_advanced") return Promise.resolve(bridgeState.advanced ?? null);
            if (command === "brain_start" && bridgeState.startFailure) return Promise.reject(new Error(bridgeState.startFailure));
            if (command === "brain_set_advanced") return Promise.resolve(bridgeState.advanced ?? null);
            return Promise.resolve(null);
          },
        },
        event: {
          listen(name, handler) {
            if (name === "brain_progress") eventHandlers.add(handler);
            return Promise.resolve(() => eventHandlers.delete(handler));
          },
        },
      };
}

function wait(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function settle() {
  await wait(0);
  await wait(0);
  await wait(0);
}

function elementText(node) {
  return node?.textContent ?? "";
}

function elements(node, predicate, out = []) {
  if (node.nodeType === 1 && predicate(node)) out.push(node);
  for (const child of node.childNodes ?? []) elements(child, predicate, out);
  return out;
}

function first(node, predicate) {
  return elements(node, predicate, [])[0] ?? null;
}

function visibleLines(node, out = []) {
  if (node.nodeType === 3) {
    if (node.data.trim()) out.push(node.data.trim());
    return out;
  }
  for (const child of node.childNodes ?? []) visibleLines(child, out);
  return out;
}

function extract(panel, heading) {
  const buttonEls = elements(panel, (el) => el.tagName === "BUTTON");
  const sentenceEl = first(panel, (el) => el.className === "surface-sentence");
  const progressEl = first(panel, (el) => el.className === "surface-walk-progress");
  const walkEl = first(panel, (el) => el.className === "surface-walk");
  const qrEl = first(panel, (el) => el.className === "surface-qr");
  const deviceEls = elements(panel, (el) => el.className === "surface-device-name");
  const quietEls = elements(panel, (el) => el.className === "surface-quiet");
  return {
    heading,
    lines: visibleLines(panel),
    sentence: elementText(sentenceEl) || elementText(panel),
    all: elementText(panel),
    button: buttonEls[0] ? { text: elementText(buttonEls[0]), disabled: buttonEls[0].disabled } : null,
    buttons: buttonEls.map(elementText),
    progress: progressEl ? elementText(progressEl) : null,
    working: Boolean(progressEl),
    walk: Boolean(walkEl),
    qr: Boolean(qrEl),
    deviceNames: deviceEls.map(elementText),
    fresh: quietEls.map(elementText).find((text) => text.includes("this one is fresh")) ?? null,
  };
}

function componentFor(kind) {
  if (kind === "server") return React.createElement(ServerSurface);
  if (kind === "models") return React.createElement(ModelsSurface, { onNavigate: () => {} });
  return React.createElement(DevicesSurface, { onNavigate: () => {} });
}

async function renderScenario(descriptor) {
  const [title, note, kind, data] = descriptor;
  bridgeState = data;
  eventHandlers = new Set();
  installBridge();
  const panel = document.createElement("div");
  document.getElementById("cards").appendChild(panel);
  const root = createRoot(panel);
  root.render(componentFor(kind));
  await settle();
  if (data.step) {
    for (const handler of eventHandlers) handler(data.step);
    await settle();
  }
  if (data.advanced) {
    const toggle = first(panel, (el) => el.tagName === "BUTTON" && elementText(el) === "Show settings");
    if (toggle) {
      toggle.click();
      await settle();
    }
  }
  const result = extract(panel, `${title} — ${note}`);
  root.unmount();
  await settle();
  return result;
}

export async function renderStates() {
  const results = [];
  for (const scenario of scenarios) results.push(await renderScenario(scenario));
  return results;
}

export async function renderServerProbe(data, step = null) {
  bridgeState = data;
  eventHandlers = new Set();
  installBridge();
  const panel = document.createElement("div");
  const root = createRoot(panel);
  root.render(React.createElement(ServerSurface));
  await settle();
  if (step !== null) {
    for (const handler of eventHandlers) handler(step);
    await settle();
  }
  const result = extract(panel, "probe");
  root.unmount();
  await settle();
  return { result, panel };
}

export async function renderAdvancedProbe(data) {
  bridgeState = data;
  eventHandlers = new Set();
  installBridge();
  const panel = document.createElement("div");
  const root = createRoot(panel);
  root.render(React.createElement(AdvancedSurface));
  await settle();
  const toggle = first(panel, (el) => el.tagName === "BUTTON" && elementText(el) === "Show settings");
  if (toggle) {
    toggle.click();
    await settle();
  }
  const result = extract(panel, "advanced probe");
  root.unmount();
  await settle();
  return { result, panel };
}

export async function renderAdvancedFieldProbe(data) {
  bridgeState = data;
  eventHandlers = new Set();
  installBridge();
  const panel = document.createElement("div");
  const root = createRoot(panel);
  root.render(React.createElement(AdvancedSurface));
  await settle();
  const toggle = first(panel, (el) => el.tagName === "BUTTON" && elementText(el) === "Show settings");
  toggle?.click();
  await settle();
  const input = first(panel, (el) => el.tagName === "INPUT");
  input?.focus();
  if (input) {
    input.value = "8192";
    input.dispatchEvent({ type: "input", target: input, bubbles: true });
  }
  await wait(2100);
  const preserved = input?.value === "8192";
  root.unmount();
  await settle();
  return preserved;
}

export async function renderAdvancedCacheProbe(data) {
  bridgeState = data;
  eventHandlers = new Set();
  installBridge();
  const panel = document.createElement("div");
  const root = createRoot(panel);
  root.render(React.createElement(AdvancedSurface));
  await settle();
  const toggle = first(panel, (el) => el.tagName === "BUTTON" && elementText(el) === "Show settings");
  toggle?.click();
  await settle();
  const select = first(panel, (el) => el.tagName === "SELECT");
  if (select) {
    select.value = "f16";
    select.dispatchEvent({ type: "change", target: select, bubbles: true });
    await settle();
  }
  const help = elements(panel, (el) => el.className === "advanced-help").map(elementText);
  root.unmount();
  await settle();
  return { help };
}

export async function renderStartFailureProbe(data) {
  bridgeState = data;
  eventHandlers = new Set();
  installBridge();
  const panel = document.createElement("div");
  const root = createRoot(panel);
  root.render(React.createElement(ServerSurface));
  await settle();
  first(panel, (el) => el.tagName === "BUTTON")?.click();
  await settle();
  const result = elementText(panel);
  root.unmount();
  await settle();
  return result;
}

export {
  REASON_UNFUNDABLE,
  MODEL_BYTES,
  advancedDto,
  completionBody,
  loadSampling,
  samplingProblem,
  samplingWire,
  saveSampling,
  SAMPLING_KNOBS,
};
