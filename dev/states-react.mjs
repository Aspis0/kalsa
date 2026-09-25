// The React review bench: mounts the real chat surfaces once per state, with
// a stubbed Tauri bridge and a stubbed HTTP fetch. It uses the same
// invoke/listen path as the app and unmounts every root so polling timers
// cannot keep the process alive.
//
// Stub rules: failure sentences marked "(real words)" are copied verbatim
// from main.rs `words()`; invented examples and numbers carry "(stub)".

import React from "react";
import { createRoot } from "react-dom/client";
import { AdvancedSurface } from "../chat/src/surfaces/AdvancedSurface";
import { DevicesSurface } from "../chat/src/surfaces/DevicesSurface";
import { ModelsSurface } from "../chat/src/surfaces/ModelsSurface";
import { ServerSurface } from "../chat/src/surfaces/ServerSurface";
import { brainWords } from "../chat/src/surfaces/useBrain";
import { EmptyState, setupArm } from "../chat/src/components/EmptyState";
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
// What the shell puts on the wire for a running start. The phone-free reason is
// verbatim from `capability::PHONE_FREE_REASON` (real words); the catalog reason
// for a paired phone is invented (stub). The name is a real catalog row.
export const PHONE_FREE_REASON =
  "This is the biggest model this computer runs well. " +
  "Pair your phone and the app can tell you whether it beats what the phone runs.";
export const PHONE_REASON = "This computer runs a bigger model than your phone does. (stub)";
export const AUTO_REASON = "This is the model this computer runs best. (stub)";
export const RUNNING_MODEL = "IBM Granite 4 Tiny";
const STUB_SQUARE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21" shape-rendering="crispEdges">' +
  '<rect width="21" height="21" fill="#ffffff"/>' +
  '<path fill="#000000" d="M4 4h2v2H4zM8 4h1v1H8zM4 8h1v1H4zM10 10h3v3h-3zM6 12h1v1H6zM12 6h2v1h-2z"/>' +
  "</svg> (stub square)";

// The host is a stored device now: every real `brain_pairing` answer carries
// it, and the page must render "This computer" with no Forget. The phone is
// what the paired sentence counts.
const HOST_DEVICE = { id: 0, label: "This computer", phone: "", kind: "host" };
const ONE_DEVICE = [
  HOST_DEVICE,
  { id: 1, label: "Paired phone", phone: "phone with 2 GB of model weights", kind: "phone" },
];
const MANY_DEVICES = [
  ...ONE_DEVICE,
  { id: 2, label: "Paired phone 2", phone: "phone with 3 GB of model weights", kind: "phone" },
];

function advancedDto(extra = {}) {
  return {
    context_tokens: 4096,
    context_max: 8192,
    context_max_f16: 4096,
    // The launcher's automatic pick under each cache, and its own two KV
    // terms: the panel shows "Automatic — 8k" and prices the choice with
    // these, so a fixture that omits them shows no memory line at all.
    context_automatic: 8192,
    context_automatic_f16: 4096,
    kv_bytes_per_token: 131072,
    kv_bytes_per_token_f16: 262144,
    kv_bytes_fixed: 0,
    kv_bytes_fixed_f16: 0,
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
    desk_port: 8134,
    desk_port_preferred: true,
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
    desk_port: null,
    desk_port_preferred: true,
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
  // A stop in flight, as `brain_state` now reports it: the drain is its own
  // state, so the page says "Stopping" from the state itself — the direct
  // `brainWords` checks in smoke-react.mjs add the `busy` reading of the same
  // state, which the branch order must not turn into "Starting".
  ["Status", "stopping", "server", { state: stateDto("stopping") }],
  ["Status", "running, phone unknown", "server", { state: stateDto("running") }],
  ["Status", "running, asleep", "server", { state: { ...stateDto("running"), asleep: true } }],
  ["Status", "running, asleep while a phone works", "server", { state: { ...stateDto("running", { active_devices: [{}] }), asleep: true } }],
  ["Status", "running, residency unknown (stub)", "server", { state: { ...stateDto("running"), asleep: null } }],
  ["Status", "running, live metrics (stub)", "server", { state: stateDto("running", { decode_tokens_per_second: 18.6, active_devices: [{}] }) }],
  ["Status", "running, phone not connected", "server", { state: stateDto("running", { active_devices: [] }) }],
  ["Status", "failed (real words)", "server", { state: { ...stateDto("failed"), reason: REASON_PORT } }],
  ["Status", "failed: the connection dropped (real words)", "server", { state: { ...stateDto("failed"), reason: REASON_CONNECTION_LOST } }],
  ["Status", "failed: the chosen model cannot be funded (real words)", "server", { state: { ...stateDto("failed"), reason: REASON_UNFUNDABLE } }],
  ["Status", "failed, deliberately long reason (wrap test)", "server", { state: { ...stateDto("failed"), reason: REASON_LONG } }],
  ["Status", "state unreadable", "server", { state: null }],
  ["Status", "running, with a slowdown announced", "server", { state: stateDto("running", { throttled: true }) }],

  ["Model", "running: the choice is automatic", "models", { state: { kind: "running", model: RUNNING_MODEL, reason: AUTO_REASON } }],
  ["Model", "running: a phone was paired and compared", "models", { state: { kind: "running", model: RUNNING_MODEL, reason: PHONE_REASON } }],
  ["Model", "running: no phone was paired", "models", { state: { kind: "running", model: RUNNING_MODEL, reason: PHONE_FREE_REASON } }],
  ["Model", "advanced settings are visible", "models", { state: { kind: "running" }, advanced: advancedDto() }],
  ["Model", "advanced settings with the internet road unavailable", "models", { state: { kind: "running" }, advanced: advancedDto({ iroh_sentence: "The internet road could not open on this computer. The other roads to it still work." }) }],
  ["Model", "advanced settings with the internet road turned off", "models", { state: { kind: "running" }, advanced: advancedDto({ internet_road: false, iroh_sentence: "The internet road is turned off. The phone reaches this computer the Tailscale way." }) }],
  ["Model", "advanced settings with an f16 cache override", "models", { state: { kind: "running" }, advanced: advancedDto({ kv_cache_override: "f16", kv_cache_type: "f16" }) }],
  ["Model", "advanced settings with a saved micro-batch", "models", { state: { kind: "running" }, advanced: advancedDto({ ubatch_override: 1024, ubatch_size: 1024 }) }],
  ["Model", "starting on the chosen model", "models", { state: { kind: "starting" } }],
  // The drain as the Models page reports it: the model being put away — never
  // the "could not tell" sentence, which the blind `default:` used to show
  // for the whole teardown while the poll was saying exactly what happened.
  ["Model", "draining: the model is being put away", "models", { state: { kind: "stopping" } }],
  ["Model", "off: nothing is chosen while off", "models", { state: { kind: "stopped" } }],
  ["Model", "not running: the Status page says why", "models", { state: { kind: "failed", reason: REASON_PORT } }],
  ["Model", "outside the app (browser preview)", "models", { available: false }],

  // The sampling panel's automatic values must come from the server that is
  // really running, not from the endpoint field the owner never filled in. The
  // second state has neither, so the "no server is configured" sentence still
  // has to be the true answer there.
  ["Advanced", "sampling values come from the running server", "advanced", {
    state: { kind: "running", endpoint: "http://127.0.0.1:8130/v1", model: RUNNING_MODEL },
    props: { default_generation_settings: { params: { temperature: 1.0, top_k: 20, top_p: 0.95 } } },
  }],
  ["Advanced", "sampling with no server and nothing typed in Settings", "advanced", {
    state: { kind: "stopped" },
  }],
  // The Advanced panel's own moved sentence: only the Devices fallback
  // card exercised it before, and the panel builds its line separately.
  ["Advanced", "the desk on a fallback port", "advanced", {
    state: { kind: "stopped" },
    advanced: advancedDto({ desk_port: 51990, desk_port_preferred: false }),
  }],
  // The server is up but still loading its model: the first read finds nothing
  // listening and only a later one answers. One ask is not enough, and silence
  // in the meantime is not a failure to report.
  ["Advanced", "sampling after the server was still loading", "advanced", {
    state: { kind: "running", endpoint: "http://127.0.0.1:8130/v1", model: RUNNING_MODEL },
    props: { default_generation_settings: { params: { temperature: 1.0, top_k: 20, top_p: 0.95 } } },
    propsFailures: 1,
    waitMs: 1600,
  }],

  ["Pairing", "nothing to pair to yet", "devices", { pairing: pairingDto("idle") }],
  // Only the desk port is on every pairing read; the door's is there only
  // while the door is up. These two are the production shapes of a running
  // brain: idle and failed KNOW both ports and still draw no Tailscale
  // note - the note belongs to a square or a paired house, not to a page
  // with nothing to point a road at.
  ["Pairing", "idle with both ports known", "devices", { pairing: pairingDto("idle", { door_port: 8131, desk_port: 8134 }) }],
  // The production shape of a fallback nobody is told about: idle draws no
  // note, so a moved desk on this card has no sentence to demand.
  ["Pairing", "idle with the desk on a fallback number", "devices", { pairing: pairingDto("idle", { door_port: 8131, desk_port: 51990, desk_port_preferred: false }) }],
  ["Pairing", "failed with both ports known", "devices", { pairing: pairingDto("failed", { failure: "could-not-save", door_port: 8131, desk_port: 8134 }) }],
  ["Pairing", "a square is waiting", "devices", { pairing: pairingDto("waiting", { qr_svg: STUB_SQUARE, door_port: 8131, desk_port: 8134 }) }],
  ["Pairing", "a fresh square after the old one expired", "devices", { pairing: pairingDto("waiting", { qr_svg: STUB_SQUARE, refreshed: "expired" }) }],
  ["Pairing", "a fresh square after one did not match", "devices", { pairing: pairingDto("waiting", { qr_svg: STUB_SQUARE, refreshed: "wrong-code" }) }],
  ["Pairing", "a phone is connecting", "devices", { pairing: pairingDto("claiming") }],
  ["Pairing", "paired; another phone can be paired", "devices", { pairing: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: ONE_DEVICE, door_port: 8131, desk_port: 8134 }) }],
  ["Pairing", "a phone waits for the owner's OK", "devices", { pairing: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: [HOST_DEVICE, { id: 1, label: "Waiting phone", phone: "phone with 2 GB of model weights", kind: "phone", waiting: true }], door_port: 8131, desk_port: 8134 }) }],
  ["Pairing", "a phone waits for the owner's OK, its response still in flight", "devices", { pairing: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: [HOST_DEVICE, { id: 1, label: "Waiting phone", phone: "phone with 2 GB of model weights", kind: "phone", waiting: true }], delivery_pending: true, door_port: 8131, desk_port: 8134 }) }],
  ["Pairing", "a paired phone and one that waits for the owner's OK", "devices", { pairing: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: [...ONE_DEVICE, { id: 2, label: "Waiting phone", phone: "phone with 3 GB of model weights", kind: "phone", waiting: true }], door_port: 8131, desk_port: 8134 }) }],
  ["Pairing", "every phone waits for the owner's OK", "devices", { pairing: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: [HOST_DEVICE, { id: 1, label: "Waiting phone", phone: "phone with 2 GB of model weights", kind: "phone", waiting: true }, { id: 2, label: "Waiting phone 2", phone: "phone with 3 GB of model weights", kind: "phone", waiting: true }], door_port: 8131, desk_port: 8134 }) }],
  ["Pairing", "every phone waits for the owner's OK, its response still in flight", "devices", { pairing: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: [HOST_DEVICE, { id: 1, label: "Waiting phone", phone: "phone with 2 GB of model weights", kind: "phone", waiting: true }, { id: 2, label: "Waiting phone 2", phone: "phone with 3 GB of model weights", kind: "phone", waiting: true }], delivery_pending: true, door_port: 8131, desk_port: 8134 }) }],
  ["Pairing", "a paired phone and one that waits for the owner's OK, its response still in flight", "devices", { pairing: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: [...ONE_DEVICE, { id: 2, label: "Waiting phone", phone: "phone with 3 GB of model weights", kind: "phone", waiting: true }], delivery_pending: true, door_port: 8131, desk_port: 8134 }) }],
  ["Pairing", "saved here; the phone still needs the response", "devices", { pairing: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: ONE_DEVICE, delivery_pending: true, door_port: 8131, desk_port: 8134 }) }],
  ["Pairing", "paired; the house holds several devices", "devices", { pairing: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: MANY_DEVICES, door_port: 8131, desk_port: 8134 }) }],
  ["Pairing", "paired; the newest of several still waits for its response", "devices", { pairing: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: MANY_DEVICES, delivery_pending: true, door_port: 8131, desk_port: 8134 }) }],
  ["Pairing", "the desk fell back to another port", "devices", { pairing: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: ONE_DEVICE, door_port: 8131, desk_port: 51990, desk_port_preferred: false }) }],
  ["Pairing", "the connection could not be saved", "devices", { pairing: pairingDto("failed", { failure: "could-not-save" }) }],
  ["Pairing", "the existing phone connection could not be read", "devices", { pairing: pairingDto("failed", { failure: "could-not-read" }) }],
  ["Pairing", "the local pairing service stopped", "devices", { pairing: pairingDto("failed", { failure: "service-unavailable" }) }],
  // The first page's arms: each state through setupArm — the mapping App
  // runs — so a scenario pins the mapping AND the words the page that fixes
  // that arm already shows. Titles carry the arm; smoke-react checks both.
  ["firstpage/off", "the machine is off", "empty", { setup: setupArm("stopped", "answered", true, "x") }],
  ["firstpage/starting", "the start is walking", "empty", { setup: setupArm("starting", "pending", false, "") }],
  ["firstpage/key", "the store refused the key", "empty", { setup: setupArm("running", "missing", false, "") }],
  ["firstpage/settings", "the door is up but unnamed", "empty", { setup: setupArm("running", "answered", true, "") }],
  ["firstpage/ready", "ready to write", "empty", { setup: setupArm("running", "answered", true, "x") }],
  ["firstpage/service", "the engine runs but the local service stopped", "empty", { setup: setupArm("running", "answered", false, "x") }],
];

let bridgeState = {};
let eventHandlers = new Set();
let propsReads = 0;

function installBridge() {
  propsReads = 0;
  globalThis.window.__TAURI__ = bridgeState.available === false
    ? undefined
    : {
        core: {
          invoke(command) {
            if (command === "brain_state") return Promise.resolve(bridgeState.state ?? null);
            if (command === "brain_pairing") return Promise.resolve(bridgeState.pairing ?? null);
            if (command === "brain_advanced") return Promise.resolve(bridgeState.advanced ?? null);
            // The host's credential the page keeps in memory. A stub value:
            // nothing in these states talks to a door.
            if (command === "brain_host_credential") return Promise.resolve("ab".repeat(32));
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
  // No scenario touches a socket. The sampling panel reads the server's own
  // defaults from `/props`; this answers from the scenario's `props` and
  // refuses everything else, so a live server on the developer's machine can
  // never leak into a rendered state. `propsFailures` makes the first reads
  // reject, which is how a server that is still loading the model behaves.
  globalThis.fetch = (url) => {
    if (!bridgeState.props || !String(url).endsWith("/props")) {
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    }
    propsReads += 1;
    if (propsReads <= (bridgeState.propsFailures ?? 0)) {
      return Promise.reject(new TypeError("fetch failed: nothing is listening yet"));
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => bridgeState.props });
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

function extract(panel, heading, automatic = []) {
  const buttonEls = elements(panel, (el) => el.tagName === "BUTTON");
  const headlineEl = first(panel, (el) => el.className === "surface-headline");
  const sentenceEl = first(panel, (el) => el.className === "surface-sentence");
  const progressEl = first(panel, (el) => el.className === "surface-walk-progress");
  const walkEl = first(panel, (el) => el.className === "surface-walk");
  const qrEl = first(panel, (el) => el.className === "surface-qr");
  const deviceEls = elements(panel, (el) => el.className === "surface-device-name");
  const detailEls = elements(panel, (el) => el.className === "surface-device-detail");
  const quietEls = elements(panel, (el) => el.className === "surface-quiet");
  return {
    heading,
    headline: elementText(headlineEl),
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
    deviceDetails: detailEls.map(elementText),
    fresh: quietEls.map(elementText).find((text) => text.includes("this one is fresh")) ?? null,
    automatic,
  };
}

function componentFor(kind, data) {
  if (kind === "empty") {
    // The first page off the app: its arms come from the same mapping App
    // runs, so the scenario pins the mapping and the rendered words both.
    return React.createElement(EmptyState, {
      setup: data?.setup,
      onOpenSettings: () => {},
      onOpenServer: () => {},
      onOpenDevices: () => {},
    });
  }
  if (kind === "server") return React.createElement(ServerSurface);
  if (kind === "models") return React.createElement(ModelsSurface, { onNavigate: () => {} });
  if (kind === "advanced") return React.createElement(AdvancedSurface);
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
  root.render(componentFor(kind, data));
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
  // A scenario whose first `/props` read fails on purpose needs the panel's
  // retry to be given the time to happen before the card is read, and before
  // the sampling groups are opened and their lines collected.
  if (data.waitMs) {
    await wait(data.waitMs);
    await settle();
  }
  // The sampling rows sit behind collapsible groups and only one group is open
  // at a time, so each is opened in turn and its automatic lines are collected.
  // Those values arrive from a read of the running server's `/props`, a second
  // round trip after the brain's own endpoint lands, so the first group also
  // waits for that read to come back.
  const groups = elements(panel, (el) => el.className === "sampling-group-toggle");
  const automatic = [];
  for (const group of groups) {
    group.click();
    await wait(20);
    automatic.push(
      ...elements(panel, (el) => el.className === "sampling-automatic").map(elementText),
    );
  }
  const result = extract(panel, `${title} — ${note}`, automatic);
  // The note's numbers are checked against the scenario's own ports, so
  // the card carries them beside its rendered text.
  const dto = bridgeState.pairing ?? bridgeState.advanced ?? null;
  result.doorPort = dto?.door_port ?? null;
  result.deskPort = dto?.desk_port ?? null;
  result.deskPreferred = dto?.desk_port_preferred !== false;
  result.pairingState = data.pairing?.state ?? null;
  result.hasAdvanced = Boolean(data.advanced);
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
  brainWords,
  completionBody,
  loadSampling,
  samplingProblem,
  samplingWire,
  saveSampling,
  SAMPLING_KNOBS,
};
