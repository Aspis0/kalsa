// The React review bench: mounts the real chat surfaces once per state, with
// a stubbed Tauri bridge and a stubbed HTTP fetch. It uses the same
// invoke/listen path as the app and unmounts every root so polling timers
// cannot keep the process alive.
//
// Stub rules: failure sentences marked "(real words)" are copied verbatim
// from main.rs `words()`; invented examples and numbers carry "(stub)".

import React from "react";
import { createRoot } from "react-dom/client";
import { AdvancedPanel } from "../chat/src/components/AdvancedPanel";
import { SamplingPanel } from "../chat/src/components/SamplingPanel";
import { DevicesSurface } from "../chat/src/surfaces/DevicesSurface";
import { ModelsSurface } from "../chat/src/surfaces/ModelsSurface";
import { BrainSurface } from "../chat/src/surfaces/BrainSurface";
import { FailedWalkScreen, ReadyScreen } from "../chat/src/surfaces/WalkScreens";
import { growthOf, walkPercent } from "../chat/src/surfaces/walkFigures";
import { forgetWalk } from "../chat/src/surfaces/useWalkMemory";
import { brainWords, credentialRefusalText } from "../chat/src/surfaces/useBrain";
import { BEAT_MS, FOLD_MS } from "../chat/src/surfaces/motion";
import { POLL_MS } from "../chat/src/surfaces/usePairingRead";
import { EmptyState, setupArm } from "../chat/src/components/EmptyState";
import { RoomSurface, queueLine } from "../chat/src/surfaces/RoomSurface";
import { callsAi } from "../chat/src/lib/roomMention";
import { emptyFeed, mergeHistory, reduceEvent } from "../chat/src/surfaces/roomFeed";
import { LanguageProvider } from "../chat/src/i18n/useLanguage";
import { TABLES, LANGUAGES } from "../chat/src/i18n";

import { LANGUAGE_KEY } from "../chat/src/i18n/useLanguage";
import { completionBody } from "../chat/src/lib/chat";
import { buildPinnedContext } from "../chat/src/lib/attachments";
import { loadSampling, samplingFault, samplingWire, saveSampling } from "../chat/src/lib/sampling";

// The English table read directly: the parity walker and the probe cards
// compare against it without mounting the provider. Re-exported for the
// smoke, so its assertions quote the table instead of a transcript of it.
const english = () => TABLES.en;
export { english };
import { SAMPLING_KNOBS } from "../chat/src/lib/knobs/sampling";

// The page's own clocks, read from the source: the pairing poll the
// surface runs on, the fold and its reverse, and the beat a landed Allow
// holds. The beat cards wait these numbers out — one poll plus a margin
// to read inside the hold, both numbers plus a margin to read after it —
// never a wall-clock guess.

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
  "This is the model that suits this computer best. " +
  "Pair your phone and the app can tell you whether it beats what the phone runs.";
export const PHONE_REASON = "This computer runs a bigger model than your phone does. (stub)";
export const AUTO_REASON = "This is the model this computer runs best. (stub)";
export const RUNNING_MODEL = "IBM Granite 4 Tiny";
/** Home's update check, at rest: the too-weak screen is the one reader. */
const IDLE_UPDATES = { state: { current: null, phase: { kind: "idle" }, notice: null }, check: () => {}, install: () => {}, dismissNotice: () => {} };
/** A walk's end, as useWalkMemory holds it. */
const DOWNLOAD_STOP = { kind: "model_bytes", done: 1_600_000_000, total: 4_600_000_000 };

/** Two catalog rows for Your AI's cards: a big one and a light one. The
    second option's reason code is the backend's comparison of the two. */
const BIG_ROW = {
  id: "tok-big", name: "Alibaba Qwen 3.6", quant: "Q4_K_M", download_bytes: 20_600_000_000,
  context_tokens: 131072, speed_context_tokens: 8192, speed: { shape: "range", low: 31, high: 46 },
  measured: null, reason: "Kalsa picked this because it runs well on this computer.", reason_code: "model.reason.pick", details: "the working",
};
const LIGHT_ROW = {
  id: "tok-light", name: "Google Gemma 4 E4B", quant: "Q8_0", download_bytes: 4_600_000_000,
  context_tokens: 131072, speed_context_tokens: 8192, speed: { shape: "range", low: 70, high: 92 },
  measured: null, reason: "You picked this AI.", reason_code: "model.reason.chosen", details: "the working",
};
function aiCapability(model, quicker, chosenRow) {
  return {
    kind: "measured", chosen: true, chosen_model: chosenRow.name, chosen_id: chosenRow.id,
    machine: { ram_bytes: 64 * 1024 ** 3, budget_bytes: 48 * 1024 ** 3, gpu_accounted_for: true, runs_on: "the graphics chip", bandwidth_bytes_per_second: 400e9, bandwidth_basis: "measured" },
    model, quicker, refusal: null,
  };
}
const second = (row, reason_code) => ({ ...row, reason_code, reason: `(${reason_code})` });
const runningOn = (row) => ({ kind: "running", model: row.name, reason: AUTO_REASON });
/// The house the invitation states pair in: phones already paired, both
/// ports known — the page's own "paired" branch, where the owner adds one.
function pairedHouse() {
  return pairingDto("paired", {
    phone: "Pixel 9a (stub)",
    devices: ONE_DEVICE,
    door_port: 8131,
    desk_port: 8134,
  });
}

const INVITE_LINK = "https://kalsa.io/pair#stub";
// A seat the owner admitted, and the waiting record behind it: the same
// phone mid re-pair. The record's own label is the number the store would
// have minted — the page must never draw it as a second phone.
const REPAIR_SEAT = { id: 4, label: "Paired phone 4", phone: "phone with 2 GB of model weights", kind: "phone" };
const REPAIR_REQUEST = { id: 5, label: "Paired phone 5", phone: "phone with 2 GB of model weights", kind: "phone", waiting: true, pairing_again: 4 };
const REPAIR_REQUEST_2 = { id: 6, label: "Paired phone 6", phone: "phone with 3 GB of model weights", kind: "phone", waiting: true, pairing_again: 4 };
/// The command's own words for "the road is not open", verbatim from
/// src-tauri/src/invites.rs NO_ROAD — the page shows them as they are.
const NO_ROAD =
  "An invitation is a link to this computer, and it can only lead over this computer's connection over the internet, which is not open.";
const INVITE_SOON = Math.floor(Date.now() / 1000) + 60 * 60;
const INVITE_LATER = Math.floor(Date.now() / 1000) + 60 * 60 * 5;

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
// The beat after Allow: a waiting phone the owner admits, and the house
// every later read answers with once the store has it.
const WAITING_PHONE = { id: 1, label: "Paired phone", phone: "phone with 2 GB of model weights", kind: "phone", waiting: true };
const WAITING_PHONE_2 = { id: 2, label: "Paired phone 2", phone: "phone with 3 GB of model weights", kind: "phone", waiting: true };
const ADMITTED_HOUSE = [
  HOST_DEVICE,
  { id: 1, label: "Paired phone", phone: "phone with 2 GB of model weights", kind: "phone" },
];
const ADMITTED_TWO = [
  HOST_DEVICE,
  { id: 1, label: "Paired phone", phone: "phone with 2 GB of model weights", kind: "phone" },
  { id: 2, label: "Paired phone 2", phone: "phone with 3 GB of model weights", kind: "phone" },
];

// No card presses Save. A card that does needs the post-save DTO from the bridge,
// so a press here fails loudly instead of answering with the pre-save read.
const advancedSave = async () => {
  throw new Error("no states-react card presses Save: give that card its own post-save answer");
};

function advancedDto(extra = {}) {
  return {
    context_tokens: 4096,
    parallel: 1,
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
    iroh_code: "road.open",
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
  ["Home", "a progress event arrives and is shown (real bytes)", "home", { state: stateDto("starting"), step: { kind: "model_bytes", done: 2100000000, total: MODEL_BYTES } }],
  ["Home", "a progress event: the engine's bytes (real bytes)", "home", { state: stateDto("starting"), step: { kind: "runtime_bytes", done: 8000000, total: 18000000 } }],
  ["Home", "a progress event: resumed past zero (real bytes)", "home", { state: stateDto("starting"), step: { kind: "model_bytes", done: 401000000, total: MODEL_BYTES } }],
  ["Home", "a progress event: no size announced (real bytes)", "home", { state: stateDto("starting"), step: { kind: "model_bytes", done: 320000000, total: 0 } }],
  ["Home", "the tune runs once and says so", "home", { state: stateDto("starting"), step: { kind: "tuning", done: 1, total: 4, candidate: 2 } }],
  ["Home", "first run: measuring the machine", "home", { state: stateDto("starting"), step: { kind: "measuring" } }],
  ["Home", "first run: deciding the engine", "home", { state: stateDto("starting"), step: { kind: "deciding" } }],
  ["Home", "first run: choosing a model", "home", { state: stateDto("starting"), step: { kind: "choosing" } }],
  ["Home", "first run: no model, engine off", "home", { state: stateDto("stopped") }],
  ["Home", "off, with a model set up", "home", { state: stateDto("stopped") }],
  ["Home", "starting", "home", { state: stateDto("starting") }],
  // A stop in flight, as `brain_state` now reports it: the drain is its own
  // state, so the page says "Stopping" from the state itself — the direct
  // `brainWords` checks in smoke-react.mjs add the `busy` reading of the same
  // state, which the branch order must not turn into "Starting".
  ["Home", "stopping", "home", { state: stateDto("stopping") }],
  ["Home", "running, phone unknown", "home", { state: stateDto("running") }],
  ["Home", "running, asleep", "home", { state: { ...stateDto("running"), asleep: true } }],
  ["Home", "running, asleep while a phone works", "home", { state: { ...stateDto("running", { active_devices: [{}] }), asleep: true } }],
  ["Home", "running, residency unknown (stub)", "home", { state: { ...stateDto("running"), asleep: null } }],
  ["Model", "running, live metrics (stub)", "models", { state: stateDto("running", { decode_tokens_per_second: 18.6, active_devices: [{}] }) }],
  ["Home", "running, phone not connected", "home", { state: stateDto("running", { active_devices: [] }) }],
  ["Home", "failed (real words)", "home", { state: { ...stateDto("failed"), reason: REASON_PORT } }],
  ["Home", "failed: the connection dropped (real words)", "home", { state: { ...stateDto("failed"), reason: REASON_CONNECTION_LOST } }],
  ["Home", "failed: the chosen model cannot be funded (real words)", "home", { state: { ...stateDto("failed"), reason: REASON_UNFUNDABLE } }],
  ["Home", "failed, deliberately long reason (wrap test)", "home", { state: { ...stateDto("failed"), reason: REASON_LONG } }],
  ["Home", "state unreadable", "home", { state: null }],
  ["Home", "running, with a slowdown announced", "home", { state: stateDto("running", { throttled: true }) }],

  // --- The room (the host's view) ---
  ["Room", "empty room", "room", { room: { epoch: "e1", open: true, room_name: "Studio", you: 4294967295, members: [
    { member_id: 4294967295, name: "This computer", kind: "host", former: false },
    { member_id: 4294967294, name: "Kalsa", kind: "ai", former: false },
  ], ai: { state: "idle", running: null, queue: [], you_pending: false } }, roomHistory: [] }],
  ["Room", "messages from several members, one left the room", "room", { room: { epoch: "e1", open: true, room_name: "Studio", you: 4294967295, members: [
    { member_id: 4294967295, name: "This computer", kind: "host", former: false },
    { member_id: 3, name: "Marco", kind: "phone", former: false },
    { member_id: 4, name: "Mamma", kind: "phone", former: true },
    { member_id: 4294967294, name: "Kalsa", kind: "ai", former: false },
  ], ai: { state: "idle", running: null, queue: [], you_pending: false } }, roomHistory: [
    { seq: 1, member_id: 3, name: "Marco", former: false, text: "dinner at eight?", time: 1791000000, call_ai: false, read: null, client_msg_id: "" },
    { seq: 2, member_id: 4, name: "Mamma", former: true, text: "saving me a seat", time: 1791000060, call_ai: false, read: null, client_msg_id: "" },
    { seq: 3, member_id: 4294967294, name: "Kalsa", former: false, text: "It is 17:00.", time: 1791000120, call_ai: true, read: 2, client_msg_id: "" },
  ] }],
  ["Room", "Kalsa answering, Stop visible", "room", { room: { epoch: "e1", open: true, room_name: "Studio", you: 4294967295, members: [
    { member_id: 4294967295, name: "This computer", kind: "host", former: false },
    { member_id: 3, name: "Marco", kind: "phone", former: false },
    { member_id: 4294967294, name: "Kalsa", kind: "ai", former: false },
  ], ai: { state: "answering", running: "Marco", queue: [], you_pending: false } }, roomHistory: [
    { seq: 1, member_id: 3, name: "Marco", former: false, text: "@Kalsa what time is it?", time: 1791000000, call_ai: true, read: null, client_msg_id: "" },
  ], roomEvents: [
    { kind: "ai_delta", turn: 1, text: "It is 17:00, and the" },
  ] }],
  ["Room", "thinking: Stop visible", "room", { room: { epoch: "e1", open: true, room_name: "Studio", you: 4294967295, members: [
    { member_id: 4294967295, name: "This computer", kind: "host", former: false },
    { member_id: 3, name: "Marco", kind: "phone", former: false },
    { member_id: 4294967294, name: "Kalsa", kind: "ai", former: false },
  ], ai: { state: "thinking", running: "Marco", queue: [], you_pending: false } }, roomHistory: [] }],
    ["Room", "waiting with the busy note", "room", { room: { epoch: "e1", open: true, room_name: "Studio", you: 4294967295, members: [
    { member_id: 4294967295, name: "This computer", kind: "host", former: false },
    { member_id: 3, name: "Marco", kind: "phone", former: false },
    { member_id: 4294967294, name: "Kalsa", kind: "ai", former: false },
  ], ai: { state: "waiting", running: "Marco", queue: [], you_pending: false } }, roomEvents: [
    { kind: "ai_status", state: "waiting", note_code: "busy_waiting",
      note: "Kalsa is busy with another conversation. You keep your turn.",
      running: "Marco", queue: [], you_pending: false },
  ] }],
  ["Room", "idle: no Stop", "room", { room: { epoch: "e1", open: true, room_name: "Studio", you: 4294967295, members: [
    { member_id: 4294967295, name: "This computer", kind: "host", former: false },
    { member_id: 4294967294, name: "Kalsa", kind: "ai", former: false },
  ], ai: { state: "idle", running: null, queue: [], you_pending: false } }, roomHistory: [] }],

  // The @Kalsa rule, mirrored from the Rust matcher: what the highlighter
  // calls and what it does not, in one card the smoke bench reads back.
  ["Room", "the @Kalsa rule, mirrored", "room", { room: { epoch: "e1", open: true, room_name: "Studio", you: 4294967295, members: [], ai: { state: "idle", running: null, queue: [], you_pending: false } }, mentionProbe: true }],

  // The feed's own rules, driven through the pure reducer the page runs:
  // a history page must not wipe what the live news delivered, an epoch
  // must replace instead of merge, and a Stop must show whenever a turn
  // runs (thinking included).
  ["Room", "the feed reducer: merge, epoch, live", "room", { reducerProbe: true }],
  ["Room", "the queue line: one, two, three", "room", { queueProbe: true }],
  ["Room", "in Italian: the waiting line", "room", { language: "it", room: { epoch: "e1", open: true, room_name: "Studio", you: 4294967295, members: [
    { member_id: 4294967295, name: "This computer", kind: "host", former: false },
    { member_id: 3, name: "Marco", kind: "phone", former: false },
    { member_id: 4, name: "Luca", kind: "phone", former: false },
  ], ai: { state: "queued", running: null, queue: ["Marco", "Luca"], you_pending: false } }, roomHistory: [] }],
  // "工作室" is a device-label fixture the card carries, not table copy:
  // the room name comes from the pairing store's label for this computer.
  ["Room", "in Chinese: Kalsa answering", "room", { language: "zh", room: { epoch: "e1", open: true, room_name: "工作室", you: 4294967295, members: [
    { member_id: 4294967295, name: "This computer", kind: "host", former: false },
    { member_id: 3, name: "Marco", kind: "phone", former: false },
    { member_id: 4294967294, name: "Kalsa", kind: "ai", former: false },
  ], ai: { state: "answering", running: "Marco", queue: [], you_pending: false } }, roomHistory: [] }],
  ["Room", "the copy table: refusal and name sentences", "room", { copyProbe: true }],
  ["Room", "queue: three waiting, real line", "room", { room: { epoch: "e1", open: true, room_name: "Studio", you: 4294967295, members: [
    { member_id: 4294967295, name: "This computer", kind: "host", former: false },
    { member_id: 3, name: "Marco", kind: "phone", former: false },
    { member_id: 4, name: "Luca", kind: "phone", former: false },
    { member_id: 5, name: "Sofia", kind: "phone", former: false },
    { member_id: 4294967294, name: "Kalsa", kind: "ai", former: false },
  ], ai: { state: "queued", running: null, queue: ["Marco", "Luca", "Sofia"], you_pending: false } }, roomHistory: [] }],

  ["Model", "running: the choice is automatic", "models", { state: { kind: "running", model: RUNNING_MODEL, reason: AUTO_REASON } }],
  ["Model", "running: a phone was paired and compared", "models", { state: { kind: "running", model: RUNNING_MODEL, reason: PHONE_REASON } }],
  ["Model", "running: no phone was paired", "models", { state: { kind: "running", model: RUNNING_MODEL, reason: PHONE_FREE_REASON } }],
  ["Advanced", "server settings are visible", "advanced", { state: { kind: "running" }, advanced: advancedDto() }],
  ["Advanced", "server settings with the internet road unavailable", "advanced", { state: { kind: "running" }, advanced: advancedDto({ iroh_sentence: "The internet road could not open on this computer. The other roads to it still work." }) }],
  ["Advanced", "server settings with the internet road turned off", "advanced", { state: { kind: "running" }, advanced: advancedDto({ internet_road: false, iroh_sentence: "The internet road is turned off. The phone reaches this computer the Tailscale way." }) }],
  ["Advanced", "server settings with an f16 cache override", "advanced", { state: { kind: "running" }, advanced: advancedDto({ kv_cache_override: "f16", kv_cache_type: "f16" }) }],
  ["Advanced", "server settings with a saved micro-batch", "advanced", { state: { kind: "running" }, advanced: advancedDto({ ubatch_override: 1024, ubatch_size: 1024 }) }],
  ["Model", "cards: second smaller and faster", "models", { state: runningOn(BIG_ROW), capability: aiCapability(BIG_ROW, second(LIGHT_ROW, "model.reason.quicker"), BIG_ROW) }],
  ["Model", "cards: second bigger and slower", "models", { state: runningOn(LIGHT_ROW), capability: aiCapability(LIGHT_ROW, second(BIG_ROW, "model.reason.more_capable"), LIGHT_ROW) }],
  ["Model", "cards: second smaller, not faster", "models", { state: runningOn(BIG_ROW), capability: aiCapability(BIG_ROW, second(LIGHT_ROW, "model.reason.quicker_smaller"), BIG_ROW) }],
  ["Model", "cards: second bigger and faster", "models", { state: runningOn(LIGHT_ROW), capability: aiCapability(LIGHT_ROW, second(BIG_ROW, "model.reason.bigger"), LIGHT_ROW) }],
  ["Model", "cards: a code this build does not know", "models", { state: runningOn(BIG_ROW), capability: aiCapability(BIG_ROW, second(LIGHT_ROW, "model.reason.catalog"), BIG_ROW) }],
  ["Model", "cards: one option alone", "models", { state: runningOn(BIG_ROW), capability: aiCapability(BIG_ROW, null, BIG_ROW) }],
  ["Model", "cards: two rows of one model share a name", "models", { state: { kind: "running", model: BIG_ROW.name, reason: AUTO_REASON }, capability: aiCapability(BIG_ROW, { ...second(BIG_ROW, "model.reason.quicker"), id: "tok-big-q4" }, { ...BIG_ROW, id: "tok-big-q4" }) }],
  ["Model", "cards: off, the stored choice is not offered", "models", { state: { kind: "stopped" }, capability: aiCapability(BIG_ROW, second(LIGHT_ROW, "model.reason.quicker"), { ...LIGHT_ROW, id: "tok-other", name: "Google Gemma 4 12B" }) }],
  ["Model", "cards: running, readings not known", "models", { state: runningOn(BIG_ROW), capability: aiCapability(BIG_ROW, second(LIGHT_ROW, "model.reason.quicker"), BIG_ROW) }],
  ["Walk", "ready after a finished tune", "walkready", { memory: { last: { kind: "tuning", done: 4, total: 4, candidate: 4 }, reach: 1, ownsEnd: true } }],
  ["Walk", "ready after a tune the budget cut", "walkready", { memory: { last: { kind: "tuning", done: 2, total: 4, candidate: 2, cut: true, retry_next: true }, reach: growthOf("tuning", 50, false), ownsEnd: true } }],
  ["Walk", "failed partway through the download", "walkfailed", {
    memory: { last: DOWNLOAD_STOP, reach: growthOf("model_bytes", 34, false) },
    reason: "Kalsa needs more space. Free up 6 GB and try again.",
    detail: { code: "startup.disk_full", text: "Not enough space for the model." },
  }],
  ["Walk", "failed before any download", "walkfailed", { memory: { last: { kind: "working" }, reach: 0 }, reason: "Kalsa couldn't start. Try again.", detail: null }],
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
  // The road's own switch, off: the permission that sentence explains is
  // irrelevant here, so the sentence must be gone with it.
  ["Advanced", "the internet road is off", "advanced", { state: { kind: "stopped" }, advanced: advancedDto({ internet_road: false, iroh_sentence: "The internet road is turned off. The phone reaches this computer the Tailscale way." }) }],
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
  // The claiming sentence's dots are motion and nothing else: under
  // reduced motion the sentence stands alone.
  ["Pairing", "a claiming phone under reduced motion has no dots", "devices", { pairing: pairingDto("claiming"), reduceMotion: true }],
  // The door is serving one of the paired phones right now: its row carries
  // the live dot (the id is the pairing store's own, the same space the
  // rows are drawn from — the Rust side builds it from that store).
  ["Pairing", "a phone being served right now", "devices", { pairing: pairedHouse(), state: { kind: "running", metrics: { active_devices: [{ id: 1, label: "Paired phone", kind: "phone" }] } }, invites: { discarded: false, invites: [] } }],
  // The host is a device at the door too: this computer's own chat being
  // served must not light a dot on "This computer" — the dot speaks about
  // phones, and the page's own typing is not a phone asking.
  ["Pairing", "the computer itself being served carries no dot", "devices", { pairing: pairedHouse(), state: { kind: "running", metrics: { active_devices: [{ id: 0, label: "This computer", kind: "host" }] } }, invites: { discarded: false, invites: [] } }],
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
  // The invitation half of this page. Every state pairs as a house that is
  // already paired: that is the state the owner adds a link in, and it
  // carries the primary action the rules expect beneath the new button.
  ["Pairing", "no invitations are out", "devices", { pairing: pairedHouse(), invites: { discarded: false, invites: [] } }],
  ["Pairing", "two invitations are out", "devices", { pairing: pairedHouse(), invites: { discarded: false, invites: [{ id: 1, expires_at: INVITE_SOON }, { id: 2, expires_at: INVITE_LATER }] } }],
  ["Pairing", "an invitation link is copied", "devices", { pairing: pairedHouse(), invites: { discarded: false, invites: [{ id: 3, expires_at: INVITE_SOON }] }, inviteLink: INVITE_LINK, click: "Invite by link" }],
  ["Pairing", "an invitation cannot be made without the road", "devices", { pairing: pairedHouse(), invites: { discarded: false, invites: [] }, inviteCreateError: NO_ROAD, click: "Invite by link" }],
  ["Pairing", "the clipboard refuses the link", "devices", { pairing: pairedHouse(), invites: { discarded: false, invites: [{ id: 4, expires_at: INVITE_SOON }] }, inviteLink: INVITE_LINK, clipboardFails: true, click: "Invite by link" }],
  ["Pairing", "earlier invitations could not be read", "devices", { pairing: pairedHouse(), invites: { discarded: true, invites: [] } }],
  // The copy worked but the moment cannot be named: the list the panel asks
  // for after the copy answers with nothing, so the sentence falls back to
  // what is true of every link — and the link itself is never shown.
  ["Pairing", "the list goes quiet after the copy", "devices", { pairing: pairedHouse(), invites: { discarded: false, invites: [{ id: 5, expires_at: INVITE_SOON }] }, inviteLink: INVITE_LINK, inviteListGoesEmpty: true, click: "Invite by link" }],
  // A create that has not answered: the button is held down, so a second
  // press cannot mint a second invitation.
  ["Pairing", "an invitation is being made", "devices", { pairing: pairedHouse(), invites: { discarded: false, invites: [] }, inviteCreateHangs: true, click: "Invite by link" }],
  // Past the bound the create is slow, not failed: the button stays down
  // and the owner is told to look below — read before any answer arrives.
  ["Pairing", "an invitation is taking longer than usual", "devices", { pairing: pairedHouse(), invites: { discarded: false, invites: [] }, inviteCreateHangs: true, click: "Invite by link", waitMs: 8500 }],
  // …and one that settles only after the bound: the gesture that answer
  // belongs to is stale, so nothing is copied and nothing is announced —
  // the list is read from the source instead, and the invitation is there.
  // A forgotten row takes its beat: at 100 ms it is still there, folding.
  ["Pairing", "a forgotten phone folds first", "devices", { pairing: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: ONE_DEVICE, door_port: 8131, desk_port: 8134 }), invites: { discarded: false, invites: [] }, click: "Remove", waitMs: 100 }],
  // …and by 600 ms the beat is over: the row has left the list.
  ["Pairing", "a forgotten phone is gone after the fold", "devices", { pairing: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: ONE_DEVICE, door_port: 8131, desk_port: 8134 }), invites: { discarded: false, invites: [] }, click: "Remove", waitMs: 600 }],
  // A forget the store refuses: nothing folds, because nothing left.
  // Reduced motion: the row is simply gone — no fold phase at all.
  ["Pairing", "a forget under reduced motion is simply gone", "devices", { pairing: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: ONE_DEVICE, door_port: 8131, desk_port: 8134 }), invites: { discarded: false, invites: [] }, reduceMotion: true, click: "Remove", waitMs: 100 }],
  // Allow on the seat's row asks for the WAITING record behind it, never the
  // seat the owner already admitted.
  ["Pairing", "an allowed pairing-again asks for the waiting id", "devices", { pairing: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: [HOST_DEVICE, REPAIR_SEAT, REPAIR_REQUEST], door_port: 8131, desk_port: 8134, delivery_pending: false }), invites: { discarded: false, invites: [] }, click: "Allow" }],
  // The beat after Allow: the next poll that shows the phone admitted says
  // "{label} is connected." on the row the owner is watching, holds it a
  // beat, and settles into the ordinary row. A phone the page never saw
  // waiting says nothing — an allowed row on a later poll is not a
  // transition this page watched.
  ["Pairing", "an allowed phone says connected for a beat", "devices", { pairing: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: [HOST_DEVICE, WAITING_PHONE], door_port: 8131, desk_port: 8134 }), pairingAfterAllow: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: ADMITTED_HOUSE, door_port: 8131, desk_port: 8134 }), invites: { discarded: false, invites: [] }, click: "Allow", waitMs: POLL_MS + 600 }],
  ["Pairing", "the connected beat settles into the row", "devices", { pairing: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: [HOST_DEVICE, WAITING_PHONE], door_port: 8131, desk_port: 8134 }), pairingAfterAllow: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: ADMITTED_HOUSE, door_port: 8131, desk_port: 8134 }), invites: { discarded: false, invites: [] }, click: "Allow", waitMs: POLL_MS + BEAT_MS + 1000 }],
  ["Pairing", "an allowed pairing-again lands its beat on the seat", "devices", { pairing: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: [HOST_DEVICE, REPAIR_SEAT, REPAIR_REQUEST], door_port: 8131, desk_port: 8134, delivery_pending: false }), pairingAfterAllow: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: [HOST_DEVICE, REPAIR_SEAT], door_port: 8131, desk_port: 8134, delivery_pending: false }), invites: { discarded: false, invites: [] }, click: "Allow", waitMs: POLL_MS + 600 }],
  ["Pairing", "an already-allowed phone says nothing on a later poll", "devices", { pairing: pairedHouse(), invites: { discarded: false, invites: [] }, waitMs: POLL_MS + 600 }],
  // The race this pins: an Allow whose store answer arrives as the record
  // GONE — the same shape a Refuse leaves. The beat keys on the answer
  // saying allowed, never on the record merely leaving, so a phone the
  // owner did not get is never "connected". (The buttons going down after
  // one press is the other half; its card is below.)
  ["Pairing", "an allow the store answers with the record gone says no beat", "devices", { pairing: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: [HOST_DEVICE, WAITING_PHONE], door_port: 8131, desk_port: 8134 }), pairingAfterAllow: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: [HOST_DEVICE], door_port: 8131, desk_port: 8134 }), invites: { discarded: false, invites: [] }, click: "Allow", waitMs: POLL_MS + 600 }],
  // One press is enough: the row holds its decision until the store's next
  // answer makes the outcome visible, and nothing lands while it waits. A
  // second press lands on the held button and must not ask again.
  ["Pairing", "a row holds its decision until the store answers", "devices", { pairing: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: [HOST_DEVICE, WAITING_PHONE], door_port: 8131, desk_port: 8134 }), invites: { discarded: false, invites: [] }, click: "Allow", clickThen: "Allow" }],
  // The Allow's store answer arrives as a REPLACEMENT request on the same
  // seat: the old ask is gone, the phone did not get in, and no beat lands.
  ["Pairing", "a replaced request arms nothing", "devices", { pairing: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: [HOST_DEVICE, REPAIR_SEAT, REPAIR_REQUEST], door_port: 8131, desk_port: 8134, delivery_pending: false }), pairingAfterAllow: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: [HOST_DEVICE, REPAIR_SEAT, REPAIR_REQUEST_2], door_port: 8131, desk_port: 8134, delivery_pending: false }), invites: { discarded: false, invites: [] }, click: "Allow", waitMs: POLL_MS + 600 }],
  // A Refuse the store refuses: the decision was never taken, so the row
  // gets its buttons back at once — they must not stay down forever.
  ["Pairing", "a refused request the store rejects gives the buttons back", "devices", { pairing: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: [HOST_DEVICE, REPAIR_SEAT, REPAIR_REQUEST], door_port: 8131, desk_port: 8134, delivery_pending: false }), invites: { discarded: false, invites: [] }, forgetFails: true, click: "Refuse" }],
  // Two Allows riding one poll answer: each row holds its own beat, and
  // neither drops the other's.
  ["Pairing", "two allows in one poll each hold their beat", "devices", { pairing: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: [HOST_DEVICE, WAITING_PHONE, WAITING_PHONE_2], door_port: 8131, desk_port: 8134 }), pairingAfterAllow: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: ADMITTED_TWO, door_port: 8131, desk_port: 8134 }), invites: { discarded: false, invites: [] }, click: "Allow", clickThen: "Allow", waitMs: POLL_MS + 600 }],
  ["Pairing", "a connected beat under reduced motion is still said", "devices", { pairing: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: [HOST_DEVICE, WAITING_PHONE], door_port: 8131, desk_port: 8134 }), pairingAfterAllow: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: ADMITTED_HOUSE, door_port: 8131, desk_port: 8134 }), invites: { discarded: false, invites: [] }, reduceMotion: true, click: "Allow", waitMs: POLL_MS + 600 }],
  // The seat was forgotten while its request waited: the request has no row
  // to sit on, so it draws its own — a waiting record like any other, with
  // its own id on its buttons.
  ["Pairing", "a seat forgotten while its request waits", "devices", { pairing: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: [HOST_DEVICE, REPAIR_REQUEST], door_port: 8131, desk_port: 8134, delivery_pending: false }), invites: { discarded: false, invites: [] }, click: "Allow" }],
  ["Pairing", "a forget that fails keeps its row", "devices", { pairing: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: ONE_DEVICE, door_port: 8131, desk_port: 8134 }), invites: { discarded: false, invites: [] }, forgetFails: true, click: "Remove", waitMs: 400 }],
  // Two waiting records under one seat — the shape an old pairing.json can
  // still carry. The seat is drawn once, the request is said once, and the
  // buttons answer for the newest ceremony: the one the store would keep.
  ["Pairing", "two requests on one seat", "devices", { pairing: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: [HOST_DEVICE, REPAIR_SEAT, { id: 5, label: "Paired phone 5", phone: "phone with 2 GB of model weights", kind: "phone", waiting: true, pairing_again: 4 }, { id: 6, label: "Paired phone 6", phone: "phone with 3 GB of model weights", kind: "phone", waiting: true, pairing_again: 4 }], door_port: 8131, desk_port: 8134, delivery_pending: false }), invites: { discarded: false, invites: [] }, click: "Refuse" }],
  ["Pairing", "a phone is pairing again", "devices", { pairing: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: [HOST_DEVICE, REPAIR_SEAT, REPAIR_REQUEST], door_port: 8131, desk_port: 8134, delivery_pending: false }), invites: { discarded: false, invites: [] }, click: "Refuse" }],
  // A waiting phone arrives while the page is open: its row unfolds in and
  // then breathes like every row that needs the owner. The card reads once
  // the entrance has had its whole beat — what must hold after it is the
  // breath, not the entrance.
  // Under reduced motion it simply appears, saying the same thing.
  ["Pairing", "a waiting row appears on a later poll", "devices", { pairing: pairedHouse(), pairingSwapAfter: 1, pairingSwapped: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: [...ONE_DEVICE, { id: 2, label: "Waiting phone", phone: "phone with 3 GB of model weights", kind: "phone", waiting: true }], door_port: 8131, desk_port: 8134 }), invites: { discarded: false, invites: [] }, waitMs: POLL_MS + FOLD_MS + 300 }],
  // Two waiting phones arrive in one answer: each row takes its own
  // entrance, one no sooner than the other. The card reads inside the
  // entrance's own beat, which is the only place the two can be told apart
  // from one shared entrance.
  ["Pairing", "two waiting rows arrive together and each unfolds", "devices", { pairing: pairedHouse(), pairingSwapAfter: 1, pairingSwapped: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: [...ONE_DEVICE, { id: 2, label: "Waiting phone", phone: "phone with 3 GB of model weights", kind: "phone", waiting: true }, { id: 3, label: "Waiting phone 3", phone: "phone with 4 GB of model weights", kind: "phone", waiting: true }], door_port: 8131, desk_port: 8134 }), invites: { discarded: false, invites: [] }, waitMs: POLL_MS + 200 }],
  // The store answered the press (allowed, beat landed) and the phone then
  // asked again: the earlier release is what gives this row its buttons
  // back — a decision still held from the first press would leave them
  // down forever.
  ["Pairing", "the buttons come back once the store has answered", "devices", { pairing: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: [HOST_DEVICE, WAITING_PHONE], door_port: 8131, desk_port: 8134 }), pairingAfterAllow: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: ADMITTED_HOUSE, door_port: 8131, desk_port: 8134 }), pairingSwapAfter: 2, pairingSwapped: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: [HOST_DEVICE, WAITING_PHONE], door_port: 8131, desk_port: 8134 }), invites: { discarded: false, invites: [] }, click: "Allow", waitMs: POLL_MS * 2 + 600 }],
  ["Pairing", "a waiting row under reduced motion stands still", "devices", { pairing: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: [HOST_DEVICE, WAITING_PHONE], door_port: 8131, desk_port: 8134 }), invites: { discarded: false, invites: [] }, reduceMotion: true }],
  ["Pairing", "an invitation that answers late", "devices", { pairing: pairedHouse(), invites: { discarded: false, invites: [] }, inviteCreateLate: INVITE_LINK, inviteListFillsAfterCreate: true, click: "Invite by link", waitMs: 10000 }],
  // The first pairing read awaits two Tailscale CLI calls, so "no answer yet"
  // is a state of its own: the page says it is checking and offers nothing to
  // retry. And a read that rejects AFTER an answer must leave that answer on
  // screen — the poll is what would otherwise blank the square.
  ["Pairing", "the first read has not answered yet", "devices", { pairingSilent: true }],
  // The bound: silence stops being "still checking" after 8 s (the page's
  // own FIRST_READ_BOUND_MS) and becomes a failure with a retry, so this
  // card waits past it before it is read.
  ["Pairing", "the first read hangs past the bound", "devices", { pairingSilent: true, waitMs: 9000 }],
  // Outside the webview nothing can be asked, so the same failure stands
  // with no Try again — a button with no command behind it.
  ["Pairing", "there is no app behind the page", "devices", { available: false }],
  ["Pairing", "a later pairing read fails and the answer stands", "devices", { pairing: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: ONE_DEVICE, door_port: 8131, desk_port: 8134 }), pairingFailsAfter: true, waitMs: 3000 }],
  // A read that ANSWERS nothing is not "there is nothing": the command came
  // back with no DTO, and the square on screen must survive it too.
  ["Pairing", "a later pairing read answers nothing", "devices", { pairing: pairingDto("paired", { phone: "Pixel 9a (stub)", devices: ONE_DEVICE, door_port: 8131, desk_port: 8134 }), pairingNullAfter: true, waitMs: 3000 }],
  // The first page's arms: each state through setupArm — the mapping App
  // runs — so a scenario pins the mapping AND the words the page that fixes
  // that arm already shows. Titles carry the arm; smoke-react checks both.
  ["firstpage/off", "the machine is off", "empty", { setup: setupArm("stopped", "answered", true, "x") }],
  ["firstpage/starting", "the start is walking", "empty", { setup: setupArm("starting", "pending", false, "") }],
  ["firstpage/key", "the door stood up but could not hand its key over", "empty", { setup: setupArm("running", "missing", true, "") }],
  ["firstpage/key-read", "the store would not let the key be read", "empty", { setup: setupArm("running", "missing", true, ""), credentialMessage: credentialRefusalText("This computer could not read its own connection key.") }],
  ["firstpage/key-junk", "a rejection this app never wrote says nothing", "empty", { setup: setupArm("running", "missing", true, ""), credentialMessage: credentialRefusalText("[object Object]") }],
  ["firstpage/advanced", "the door is up but unnamed", "empty", { setup: setupArm("running", "answered", true, "") }],
  ["firstpage/ready", "ready to write", "empty", { setup: setupArm("running", "answered", true, "x") }],
  ["firstpage/service", "the engine runs but the local service stopped", "empty", { setup: setupArm("running", "answered", false, "x") }],
  ["firstpage/service", "the credential read never runs without a door", "empty", { setup: setupArm("running", "pending", false, "x") }],
];

/** The runaway bound for the whole bench: every card's declared wait,
    summed, plus room for the renders and settles between them. A guard,
    not a target. */
/** The sampling fault as an English sentence. Bench-only: the app speaks
    the owner's language through `samplingProblemWords`. */
export function samplingProblem(sampling) {
  const fault = samplingFault(sampling);
  if (!fault) return null;
  const label = fault.knob.label;
  if (fault.kind === "finite") return `${label} must be a finite number; got ${fault.value}.`;
  if (fault.kind === "whole") return `${label} must be a whole number; got ${fault.value}.`;
  return `${label} must be between ${fault.low} and ${fault.high}; got ${fault.value}.`;
}

export function benchTimeoutMs() {
  const waits = scenarios.reduce((sum, [, , , data]) => sum + (data?.waitMs ?? 0), 0);
  return waits + 30000;
}

let bridgeState = {};
let eventHandlers = new Set();
let roomEventHandlers = new Set();
let propsReads = 0;
let pairingReads = 0;
let inviteListReads = 0;
let forgetIds = [];
let allowIds = [];

function installBridge() {
  roomEventHandlers = new Set();
  propsReads = 0;
  pairingReads = 0;
  inviteListReads = 0;
  forgetIds.length = 0;
  allowIds.length = 0;
  // The page reads the reduced-motion preference the way App.tsx does:
  // answered, and false unless this card asks for it.
  globalThis.window.matchMedia = (query) => ({
    matches: bridgeState.reduceMotion === true && String(query).includes("reduced-motion"),
    media: String(query),
  });
  globalThis.window.__TAURI__ = bridgeState.available === false
    ? undefined
    : {
        core: {
          invoke(command, args) {
            if (command === "brain_pairing_allow_device") {
              allowIds.push(args?.id ?? -1);
              // The store changed: every read after the Allow answers with
              // the admitted house, the way the real store would.
              if (bridgeState.pairingAfterAllow) {
                bridgeState.pairing = bridgeState.pairingAfterAllow;
              }
              return Promise.resolve(null);
            }
            if (command === "brain_pairing_forget_device") {
              // Which id the page's Refuse actually asked for: the seat's or
              // the waiting record's. The rule that cares reads it back.
              forgetIds.push(args?.id ?? -1);
              if (bridgeState.forgetFails) return Promise.reject(new Error("the store refused"));
              return Promise.resolve(null);
            }
            // A card that names no brain state gets a stopped one, never a
            // null: a null answer means "not known", and the shared poll
            // keeps what the LAST card that named one knew — so a served
            // phone would light rows on every later card.
            if (command === "brain_room") {
              return Promise.resolve(bridgeState.room ?? { open: false, room_name: "", you: 4294967295, members: [], ai: { state: "idle", running: null, queue: [], you_pending: false } });
            }
            if (command === "brain_room_history") {
              return Promise.resolve(bridgeState.roomHistory ?? []);
            }
            if (command === "brain_room_post") {
              const entry = bridgeState.roomPostAnswer ?? {
                seq: 900, member_id: 4294967295, name: "This computer", former: false,
                text: args?.text ?? "", time: 1791000000, call_ai: Boolean(args?.callAi),
                read: null, client_msg_id: args?.client_msg_id ?? "",
              };
              return Promise.resolve(entry);
            }
            if (command === "brain_room_set_name") return Promise.resolve(args?.name ?? "");
            if (command === "brain_room_stop") return Promise.resolve(true);
            if (command === "brain_state") {
              return Promise.resolve(bridgeState.state ?? { kind: "stopped" });
            }
            if (command === "brain_pairing") {
              // The shapes a real open takes: a read that has not answered
              // yet (it awaits two Tailscale CLI calls), and reads after the
              // first answer that come back empty or rejected.
              if (bridgeState.pairingSilent) return new Promise(() => {});
              if (bridgeState.pairingNullAfter && pairingReads++ > 0) {
                return Promise.resolve(null);
              }
              if (bridgeState.pairingFailsAfter && pairingReads++ > 0) {
                return Promise.reject(new Error("stub: the pairing read rejected"));
              }
              // A phone that shows up while the page is already open: every
              // read after the Nth answers with the other house.
              if (
                bridgeState.pairingSwapAfter !== undefined &&
                pairingReads++ >= bridgeState.pairingSwapAfter
              ) {
                return Promise.resolve(bridgeState.pairingSwapped ?? bridgeState.pairing ?? null);
              }
              return Promise.resolve(bridgeState.pairing ?? null);
            }
            if (command === "brain_invite_list") {
              // The list the panel asks for AFTER a copy: a read that goes
              // quiet leaves the sentence with no moment to name.
              if (bridgeState.inviteListGoesEmpty && inviteListReads++ > 0) {
                return Promise.resolve({ discarded: false, invites: [] });
              }
              // The list after a create that settled late: the invitation
              // is in it because the answer was read from the source.
              if (bridgeState.inviteListFillsAfterCreate && inviteListReads++ > 0) {
                return Promise.resolve({ discarded: false, invites: [{ id: 6, expires_at: INVITE_SOON }] });
              }
              return Promise.resolve(bridgeState.invites ?? null);
            }
            if (command === "brain_invite_create") {
              if (bridgeState.inviteCreateHangs) return new Promise(() => {});
              // An answer that arrives after the page's bound: it has to be
              // dropped, not rendered as the link it never promised.
              if (bridgeState.inviteCreateLate) {
                return new Promise((resolve) =>
                  setTimeout(() => resolve(bridgeState.inviteCreateLate), 9000),
                );
              }
              return bridgeState.inviteCreateError
                ? Promise.reject(bridgeState.inviteCreateError)
                : Promise.resolve(bridgeState.inviteLink ?? INVITE_LINK);
            }
            if (command === "brain_invite_link") return Promise.resolve(bridgeState.inviteLink ?? INVITE_LINK);
            if (command === "brain_advanced") return Promise.resolve(bridgeState.advanced ?? null);
            // Home reads the chooser before it draws anything; a card that names
            // no capability is a machine past its first run.
            if (command === "brain_capability") return Promise.resolve(bridgeState.capability ?? { kind: "unmeasured", chosen: true, chosen_model: "Liquid LFM 2.5" });
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
            if (name === "room-event") {
              roomEventHandlers.add(handler);
              const queued = bridgeState.roomEvents ?? [];
              for (const payload of queued) handler(payload);
            }
            return Promise.resolve(() => {
              roomEventHandlers.delete(handler);
            });
          },
        },
      };
  // No scenario touches a socket. The sampling panel reads the server's own
  // defaults from `/props`; this answers from the scenario's `props` and
  // refuses everything else, so a live server on the developer's machine can
  // never leak into a rendered state. `propsFailures` makes the first reads
  // reject, which is how a server that is still loading the model behaves.
  // The clipboard the page copies a link into. It answers unless the
  // scenario says otherwise, so a copy that "works" is the ordinary case
  // and `clipboardFails` is the one where the page must show the link
  // itself instead.
  globalThis.window.navigator.clipboard = {
    writeText: async () => {
      if (bridgeState.clipboardFails) throw new Error("the clipboard refused");
    },
  };
  // …and the road behind it fails too: this bench has no execCommand, and
  // the fallback cards depend on that throw happening — the page then shows
  // the field, and a copy that kept its text would be a leaked secret.
  globalThis.document.execCommand = () => {
    throw new TypeError("the bench has no execCommand");
  };
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
  // The Phones page titles a paired house with the house itself and leads
  // with its sentence (09-phones-paired): read there when nothing else says it.
  const headlineEl = first(panel, (el) => el.className === "surface-headline" || el.className === "brain-headline" || el.className === "phones-headline");
  const sentenceEl =
    first(panel, (el) => el.className === "surface-sentence" || el.className === "brain-sentence") ??
    (headlineEl?.className === "phones-headline" ? first(panel, (el) => el.className === "phones-lead") : null);
  const progressEl = first(panel, (el) => el.className === "walk-line");
  const barEl = first(panel, (el) => (el.className ?? "").split(" ").includes("walk-bar"));
  const walkEl = first(panel, (el) => el.className === "surface-walk");
  const qrEl = first(panel, (el) => el.className === "surface-qr");
  const deviceEls = elements(panel, (el) => el.className === "surface-device-name");
  // A row whose box is already giving way — fading out under its own
  // transition — which is the fold itself, not the list being shorter.
  const rowEls = elements(panel, (el) =>
    String(el.className ?? "").split(" ").includes("surface-device"),
  );
  const foldingRows = rowEls.filter((el) => String(el.style?.opacity ?? "1") === "0").length;
  const detailEls = elements(panel, (el) => el.className === "surface-device-detail");
  const inviteEls = elements(panel, (el) => el.className === "surface-invite-name");
  const inputEls = elements(panel, (el) => el.tagName === "INPUT");
  // A button this page is holding down: really disabled, or held with
  // aria-disabled (the kind that keeps its focus).
  const disabledEls = buttonEls.filter(
    (el) => el.disabled === true || el.getAttribute?.("aria-disabled") === "true",
  );
  const quietEls = elements(panel, (el) => el.className === "surface-quiet");
  return {
    heading,
    headline: elementText(headlineEl),
    lines: visibleLines(panel),
    sentence: elementText(sentenceEl) || elementText(panel),
    all: elementText(panel),
    // Home's round button has no text: its name is its label, as for Stop below.
    button: buttonEls[0]
      ? { text: elementText(buttonEls[0]) || buttonEls[0].getAttribute?.("aria-label") || "", disabled: buttonEls[0].disabled }
      : null,
    // An icon button (the composer's Stop) has no text: its name is its label.
    buttons: buttonEls.map((el) => elementText(el) || el.getAttribute?.("aria-label") || ""),
    progress: progressEl ? elementText(progressEl) : null,
    working: Boolean(progressEl),
    barValue: barEl?.getAttribute?.("aria-valuenow") ?? null,
    walk: Boolean(walkEl),
    qr: Boolean(qrEl),
    deviceNames: deviceEls.map(elementText),
    foldingRows,
    // The motion classes the rows wear, in row order: which rows breathe,
    // which unfold in — and that reduced motion wears none.
    deviceClasses: rowEls.map((el) => String(el.className ?? "")),
    // The two indicators with no words: the live dot on a served row, the
    // three dots beside the claiming sentence.
    liveDots: elements(panel, (el) =>
      String(el.className ?? "").split(" ").includes("surface-device-live"),
    ).length,
    connectingDots: elements(panel, (el) =>
      String(el.className ?? "").split(" ").includes("surface-connecting"),
    ).length,
    deviceDetails: detailEls.map(elementText),
    inviteNames: inviteEls.map(elementText),
    // The field a refused clipboard leaves behind, by value: this is the one
    // place a link may appear, and it is an input's, never a sentence's.
    fallbackLinks: inputEls.map((el) => String(el.value ?? "")),
    disabledButtons: disabledEls.map(elementText),
    // Which ids the page's Refuse and Allow asked for in this card.
    forgetIds: [...forgetIds],
    allowIds: [...allowIds],
    // The WHOLE document, not just this card: a link the copy path left
    // behind in the body, or in a field outside the card, must be visible
    // to the rule that forbids it.
    documentText: elementText(document.body),
    documentFields: elements(
      document.body,
      (el) => el.tagName === "INPUT" || el.tagName === "TEXTAREA",
    ).map((el) => String(el.value ?? "")),
    fresh: quietEls.map(elementText).find((text) => text.includes("this one is fresh")) ?? null,
    // Your AI's cards, as each one titles itself and whether it is the one in use.
    aiCards: elements(panel, (el) => String(el.className ?? "").split(" ").includes("ai-card")).map((card) => ({
      title: elementText(first(card, (el) => el.className === "ai-card-title")),
      chosen: String(card.className).split(" ").includes("is-chosen"),
    })),
    aiDetails: elementText(first(panel, (el) => el.className === "ai-details")),
    // The walk's bar and tree as the end screens leave them.
    barFailed: (barEl?.className ?? "").split(" ").includes("is-failed"),
    treeFailed: elements(panel, (el) => String(el.className ?? "").split(" ").includes("tree")).some((el) =>
      String(el.className).split(" ").includes("is-failed"),
    ),
    blossoms: elements(panel, (el) => String(el.className ?? "").split(" ").includes("tree-bloom")).length,
    walkDetails: elementText(first(panel, (el) => el.className === "walk-details")),
    automatic,
  };
}

function componentFor(kind, data) {
  if (kind === "empty") {
    // The first page off the app: its arms come from the same mapping App
    // runs, so the scenario pins the mapping and the rendered words both.
    // The provider is needed for the arm that reads the advanced table.
    return React.createElement(
      LanguageProvider,
      null,
      React.createElement(EmptyState, {
        setup: data?.setup,
        credentialMessage: data?.credentialMessage ?? null,
        onOpenAdvanced: () => {},
        onOpenHome: () => {},
        onOpenDevices: () => {},
      }),
    );
  }
  if (kind === "home") return React.createElement(BrainSurface, { onNavigate: () => {}, onOpenChat: () => {}, updates: IDLE_UPDATES });
  // The walk's own end, as Home shows it once the walk is over.
  if (kind === "walkready") {
    return React.createElement(LanguageProvider, null, React.createElement(ReadyScreen, { memory: data.memory, onStartChat: () => {} }));
  }
  if (kind === "walkfailed") {
    return React.createElement(
      LanguageProvider,
      null,
      React.createElement(FailedWalkScreen, { memory: data.memory, reason: data.reason, detail: data.detail, busy: false, onRetry: () => {} }),
    );
  }
  if (kind === "models") {
    return React.createElement(
      LanguageProvider,
      null,
      React.createElement(ModelsSurface, { onNavigate: () => {} }),
    );
  }
  if (kind === "advanced") {
    return React.createElement(
      LanguageProvider,
      null,
      React.createElement(AdvancedPanel, {
        save: advancedSave,
        model: data?.model ?? "",
        onModelChange: () => {},
      }),
      React.createElement(SamplingPanel),
    );
  }
  if (kind === "room") {
    if (data?.copyProbe) {
      const REFUSALS = [
        ["already_pending", "You already have a question waiting for Kalsa."],
      ];
      const NAMES = [
        ["name_taken", "Someone in this room already uses that name. Pick another."],
        ["name_reserved", "Kalsa is reserved for the assistant. Pick another name."],
        ["name_framing", "Names can't use [ or ]."],
        ["name_mixed_scripts", "Use letters from one alphabet in your name."],
        ["name_too_long", "That name is too long. Try a shorter one."],
      ];
      const notes = english().room.notes;
      const line = (pairs) =>
        pairs.map(([code, wanted]) => `${notes[code] === wanted ? "GOOD" : "WRONGLY"}: ${code}`).join("\n");
      return React.createElement("div", null,
        React.createElement("p", { className: "room-copy" },
          line(REFUSALS) + "\n" + line(NAMES)));
    }
    if (data?.queueProbe) {
      return React.createElement("div", null,
        React.createElement("p", { className: "room-queue-line" }, [
          queueLine(["Marco"], english().room),
          queueLine(["Marco", "Luca"], english().room),
          queueLine(["Marco", "Luca", "Sofia"], english().room),
        ].join("\n")));
    }
    if (data?.reducerProbe) {
      const lines = [];
      // A delta lands live, then the history page arrives carrying the
      // same seq: the page keeps both the live text and the landed entry.
      let feed = emptyFeed();
      feed = reduceEvent(feed, { kind: "ai_delta", turn: 1, text: "KALSA-LIVE" });
      feed = mergeHistory(feed, "e1", [
        { seq: 1, member_id: 3, name: "Marco", former: false, text: "LAND1", time: 1, call_ai: false, read: null },
        { seq: 2, member_id: 3, name: "Marco", former: false, text: "LAND2", time: 2, call_ai: false, read: null },
      ]);
      lines.push(`LIVE-KEPT: ${feed.live?.text === "KALSA-LIVE" ? "yes" : "no"}`);
      lines.push(`MERGED: ${feed.entries.map((entry) => entry.text).join("+")}`);
      // An epoch move replaces: the old seqs name different words now.
      feed = reduceEvent(feed, { kind: "message", epoch: "e2", seq: 1, member_id: 3, name: "Marco", former: false, text: "NEW-EPOCH", time: 3, call_ai: false, read: null });
      lines.push(`EPOCH-REPLACED: ${feed.entries.length === 1 && feed.entries[0].text === "NEW-EPOCH" ? "yes" : "no"}`);
      // A duplicate seq cannot double an entry.
      const before = feed.entries.length;
      feed = reduceEvent(feed, { kind: "message", epoch: "e2", seq: 1, member_id: 3, name: "Marco", former: false, text: "NEW-EPOCH", time: 3, call_ai: false, read: null });
      lines.push(`NO-DUPLICATE: ${feed.entries.length === before ? "yes" : "no"}`);
      return React.createElement("div", null,
        React.createElement("p", { className: "room-reducer" }, lines.join("\n")));
    }
    if (data?.mentionProbe) {
      // The mirrored @Kalsa rule, read back as rendered lists: the CALLS
      // card names the texts that call, the SILENT card the ones that do
      // not. The vectors are the Rust tests' own.
      const CALLS = ["请问@Kalsa", "@Kalsa你好", "你好，@Kalsa", "hey @Kalsa, ciao", "(@Kalsa)", "@Kalsa's"];
      const SILENT = ["marco@kalsa.io", "josé@Kalsa", "café@Kalsa", "cafe\u0301@Kalsa", "@Kalsabot", "@Kalsa\u0301"];
      return React.createElement(
        "div",
        null,
        // Each verdict is prefixed, so the bench reads both directions from
        // one text stream. The kalsa.io vector is labelled without the
        // domain: the harness's own rule keeps a link off the rendered page.
        React.createElement("p", { className: "room-calls" },
          CALLS.map((text) => (callsAi(text) ? `CALL: ${text}` : `MISSED: ${text}`)).join("\n")),
        React.createElement("p", { className: "room-silent" },
          SILENT.map((text) => {
            const verdict = callsAi(text) ? "WRONGLY CALLS" : "SILENT";
            const label = text.includes("kalsa.io") ? "marco [at] kalsa [dot] io" : text;
            return `${verdict}: ${label}`;
          }).join("\n")),
      );
    }
    return React.createElement(RoomSurface);
  }
  return React.createElement(DevicesSurface, { onNavigate: () => {} });
}

// The walk arms when the page sees the brain ENTER "starting" (walkStep.ts),
// and useBrain keeps the last state it saw across mounts. A walk card would
// otherwise read "starting" over a previous card's "starting" and never arm,
// so it is preceded by a mount at "stopped".
async function enterStartingFromStopped() {
  bridgeState = { state: stateDto("stopped") };
  eventHandlers = new Set();
  installBridge();
  const panel = document.createElement("div");
  document.getElementById("cards").appendChild(panel);
  const root = createRoot(panel);
  root.render(React.createElement(LanguageProvider, null, componentFor("home", bridgeState)));
  await settle();
  root.unmount();
  await settle();
}

async function renderScenario(descriptor) {
  const [title, note, kind, data] = descriptor;
  // Each card is its own app session: no walk's end carries over from the last.
  forgetWalk();
  if (data?.state?.kind === "starting") await enterStartingFromStopped();
  bridgeState = data;
  eventHandlers = new Set();
  installBridge();
  // A card that names a language seeds the override the provider reads —
  // the real persistence path, not a test hook.
  const lang = data?.language;
  try {
    if (lang) localStorage.setItem(LANGUAGE_KEY, lang);
    else localStorage.removeItem(LANGUAGE_KEY);
  } catch {}
  const panel = document.createElement("div");
  document.getElementById("cards").appendChild(panel);
  const root = createRoot(panel);
  root.render(React.createElement(LanguageProvider, null, componentFor(kind, data)));
  await settle();
  if (data.click) {
    // A button the owner presses: the panel's own answer follows in
    // microtasks, which one turn of the queue drains whole.
    const target = first(
      panel,
      (el) => el.tagName === "BUTTON" && elementText(el) === data.click,
    );
    // Nothing by that name to press: the card's own rules read what the
    // click would have done — an empty answer, a problem of theirs. Throwing
    // here would take the whole run down with a card that is being shown
    // wrong, which is the one case the run must still report.
    if (target) {
      target.click();
      await settle();
    }
  }
  if (data.clickThen) {
    // A second press, on a button the owner can still press: the first
    // match that is not held down. A held button — disabled, or aria-held
    // with its focus kept — is not pressable, and the races these cards
    // run need the presses that still are.
    const second = first(
      panel,
      (el) =>
        el.tagName === "BUTTON" &&
        el.getAttribute?.("aria-disabled") !== "true" &&
        elementText(el) === data.clickThen,
    );
    if (second) {
      second.click();
      await settle();
    }
  }
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
  result.step = data.step ?? null;
  root.unmount();
  await settle();
  return result;
}

/** Every key of every language against the English shape, walked
    recursively: a missing key, an extra one, or an empty string. */
export function checkKeyParity() {
  const problems = [];
  const walk = (path, englishValue, value, lang) => {
    if (typeof englishValue === "function") {
      if (typeof value !== "function") problems.push(`${lang}.${path}: not a function`);
      return;
    }
    if (typeof englishValue === "string") {
      if (typeof value !== "string") problems.push(`${lang}.${path}: not a string`);
      else if (value.trim() === "") problems.push(`${lang}.${path}: empty string`);
      return;
    }
    if (typeof englishValue === "object" && englishValue !== null) {
      if (typeof value !== "object" || value === null) {
        problems.push(`${lang}.${path}: not an object`);
        return;
      }
      const keys = new Set([...Object.keys(englishValue), ...Object.keys(value)]);
      for (const key of keys) {
        if (!(key in value)) problems.push(`${lang}.${path}.${key}: missing`);
        else if (!(key in englishValue)) problems.push(`${lang}.${path}.${key}: extra`);
        else walk(`${path}.${key}`, englishValue[key], value[key], lang);
      }
    }
  };
  for (const lang of LANGUAGES) {
    walk("", TABLES.en, TABLES[lang], lang);
  }
  return problems;
}

/** Renders the room's waiting line in a chosen language, for the smoke
    bench's Italian and Chinese runs. */
export function queueLineIn(lang) {
  return queueLine(["Marco", "Luca", "Sofia"], TABLES[lang].room);
}

export async function renderStates() {
  const results = [];
  for (const scenario of scenarios) results.push(await renderScenario(scenario));
  return results;
}

export async function renderHomeProbe(data, step = null) {
  bridgeState = data;
  eventHandlers = new Set();
  installBridge();
  // A card that names a language seeds the override the provider reads —
  // the real persistence path, not a test hook.
  const lang = data?.language;
  try {
    if (lang) localStorage.setItem(LANGUAGE_KEY, lang);
    else localStorage.removeItem(LANGUAGE_KEY);
  } catch {}
  const panel = document.createElement("div");
  const root = createRoot(panel);
  root.render(React.createElement(LanguageProvider, null, React.createElement(BrainSurface, { onNavigate: () => {}, onOpenChat: () => {} })));
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
  // A card that names a language seeds the override the provider reads —
  // the real persistence path, not a test hook.
  const lang = data?.language;
  try {
    if (lang) localStorage.setItem(LANGUAGE_KEY, lang);
    else localStorage.removeItem(LANGUAGE_KEY);
  } catch {}
  const panel = document.createElement("div");
  const root = createRoot(panel);
  root.render(
    React.createElement(
      LanguageProvider,
      null,
      React.createElement(AdvancedPanel, { save: advancedSave, model: "", onModelChange: () => {} }),
    ),
  );
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
  // A card that names a language seeds the override the provider reads —
  // the real persistence path, not a test hook.
  const lang = data?.language;
  try {
    if (lang) localStorage.setItem(LANGUAGE_KEY, lang);
    else localStorage.removeItem(LANGUAGE_KEY);
  } catch {}
  const panel = document.createElement("div");
  const root = createRoot(panel);
  root.render(
    React.createElement(
      LanguageProvider,
      null,
      React.createElement(AdvancedPanel, { save: advancedSave, model: "", onModelChange: () => {} }),
    ),
  );
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
  // A card that names a language seeds the override the provider reads —
  // the real persistence path, not a test hook.
  const lang = data?.language;
  try {
    if (lang) localStorage.setItem(LANGUAGE_KEY, lang);
    else localStorage.removeItem(LANGUAGE_KEY);
  } catch {}
  const panel = document.createElement("div");
  const root = createRoot(panel);
  root.render(
    React.createElement(
      LanguageProvider,
      null,
      React.createElement(AdvancedPanel, { save: advancedSave, model: "", onModelChange: () => {} }),
    ),
  );
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
  // A card that names a language seeds the override the provider reads —
  // the real persistence path, not a test hook.
  const lang = data?.language;
  try {
    if (lang) localStorage.setItem(LANGUAGE_KEY, lang);
    else localStorage.removeItem(LANGUAGE_KEY);
  } catch {}
  const panel = document.createElement("div");
  const root = createRoot(panel);
  root.render(React.createElement(LanguageProvider, null, React.createElement(BrainSurface, { onNavigate: () => {}, onOpenChat: () => {} })));
  await settle();
  first(panel, (el) => el.tagName === "BUTTON")?.click();
  await settle();
  const result = elementText(panel);
  root.unmount();
  await settle();
  return result;
}

export {
  growthOf,
  walkPercent,
  LANGUAGES,
  REASON_UNFUNDABLE,
  TABLES,
  MODEL_BYTES,
  advancedDto,
  brainWords,
  buildPinnedContext,
  completionBody,
  loadSampling,
  samplingWire,
  saveSampling,
  SAMPLING_KNOBS,
};
