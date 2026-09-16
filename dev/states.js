// The states page: mounts the REAL page code once per state, with stubbed
// data, so copy and layout can be reviewed side by side. Served from dev/ —
// outside src/, the app never sees this file, and nothing in the app links
// here.
//
// Stub rules: failure sentences marked "(real words)" are copied verbatim
// from main.rs `words()` — keep them in sync when the words change there.
// Invented examples carry "(stub)" in the text itself, and numbers stay as
// explicitly marked stubs: this page reviews words and shapes, it never
// presents a bench value as a production measurement.

import { mountStatus } from "../src/pages/status.js";
import { mountModel } from "../src/pages/model.js";
import { mountPairing } from "../src/pages/pairing.js";

const cards = document.getElementById("cards");
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function card(title, note, build) {
  const wrap = document.createElement("section");
  wrap.className = "card";
  const heading = document.createElement("h3");
  heading.textContent = note ? `${title} — ${note}` : title;
  const panel = document.createElement("div");
  panel.className = "panel";
  wrap.append(heading, panel);
  cards.append(wrap);
  return build(panel);
}

function press(panel) {
  return panel.querySelector('[data-el="action"]').click();
}

// Failure sentences: the real words, and one deliberately long invention to
// test wrapping.
const REASON_PORT =
  "Another program is in the way. Restarting the computer usually clears it.";
// failure.rs's ChosenModelUnfundable words, verbatim — smoke pins them.
const REASON_UNFUNDABLE =
  "The model chosen for this computer needs more memory than the computer can give it, even to start. An app update may bring a smaller option.";
// failure.rs's ConnectionLost words, verbatim — the resume promise, pinned.
const REASON_CONNECTION_LOST =
  "The connection dropped partway through. Trying again keeps what was already downloaded.";
const REASON_LONG =
  "The assistant stopped while it was getting ready. This can happen when the computer runs out of room while it is working. Turning it on again usually works, and closing other programs helps if it keeps happening. (stub)";

function statusBackend(state) {
  return {
    async read() {
      return state ?? null;
    },
    async start() {},
    async stop() {},
  };
}

// The progress payloads above are the real `brain_progress` shapes from
// src-tauri/src/startup.rs, with byte figures measured tonight; they exist
// to review the sentence around them, not to promise a download size.

function modelBackend(state) {
  return {
    async read() {
      return state ?? null;
    },
  };
}

function advancedBackend(dto) {
  return {
    async read() {
      return dto ?? null;
    },
    async save(contextTokens, idleUnloadSeconds) {
      return {
        ...dto,
        context_override: contextTokens,
        context_tokens: contextTokens ?? dto.context_tokens,
        idle_override: idleUnloadSeconds,
        idle_unload_seconds: idleUnloadSeconds,
      };
    },
  };
}

function advancedDto(extra = {}) {
  return {
    context_tokens: 4096,
    context_max: 8192,
    context_override: null,
    idle_unload_seconds: 300,
    idle_override: null,
    batch_size: 512,
    ubatch_size: 128,
    kv_cache_type: "q8_0",
    flash_attention: "on",
    gpu_layers: "all",
    threads: 8,
    threads_batch: 8,
    door_port: 8131,
    running: true,
    ...extra,
  };
}

function runningState(metrics = {}) {
  return {
    kind: "running",
    port: 8130,
    metrics: {
      decode_tokens_per_second: null,
      phone_connected: null,
      throttled: null,
      ...metrics,
    },
  };
}

// ---- Status ----

// The walk's progress: the card mounts the real page, then replays a real
// `brain_progress` payload (startup.rs) through a bus shaped like the
// backend's — so what the card shows is what arrives on the wire.
function fakeBus() {
  const handlers = {};
  return {
    listen(name, handler) {
      (handlers[name] ??= []).push(handler);
      return Promise.resolve(() => {});
    },
    emit(name, payload) {
      for (const handler of handlers[name] ?? []) handler(payload);
    },
  };
}

function progressCard(title, note, step) {
  card("Status", `${title} (real bytes)`, (panel) => {
    const bus = fakeBus();
    const view = mountStatus(panel, {
      backend: statusBackend({ kind: "stopped" }),
      events: bus,
    });
    view.refresh();
    bus.emit("brain_progress", step);
  });
}

// The model's true size, measured tonight: 3786957088 bytes.
const MODEL_BYTES = 3786957088;

progressCard(
  "a progress event arrives and is shown",
  "the model download, mid-way",
  { kind: "model_bytes", done: 2100000000, total: MODEL_BYTES },
);

progressCard(
  "a progress event: the engine's bytes",
  "the small download",
  { kind: "runtime_bytes", done: 8000000, total: 18000000 },
);

progressCard(
  "a progress event: resumed past zero",
  "picked up where it stopped",
  { kind: "model_bytes", done: 401000000, total: MODEL_BYTES },
);

progressCard(
  "a progress event: no size announced",
  "the server said no Content-Length",
  { kind: "model_bytes", done: 320000000, total: 0 },
);

card("Status", "first run: measuring the machine", (panel) =>
  mountStatus(panel, {
    backend: statusBackend({ kind: "stopped" }),
    events: (() => {
      const bus = fakeBus();
      bus.emit("brain_progress", { kind: "measuring" });
      return bus;
    })(),
  }).refresh(),
);

card("Status", "first run: deciding the engine", (panel) =>
  mountStatus(panel, {
    backend: statusBackend({ kind: "stopped" }),
    events: (() => {
      const bus = fakeBus();
      bus.emit("brain_progress", { kind: "deciding" });
      return bus;
    })(),
  }).refresh(),
);

card("Status", "first run: choosing a model", (panel) =>
  mountStatus(panel, {
    backend: statusBackend({ kind: "stopped" }),
    events: (() => {
      const bus = fakeBus();
      bus.emit("brain_progress", { kind: "choosing" });
      return bus;
    })(),
  }).refresh(),
);

card("Status", "first run: no model, engine off", (panel) =>
  mountStatus(panel, {
    backend: statusBackend({ kind: "stopped" }),
  }).refresh(),
);

card("Status", "off, with a model set up", (panel) =>
  mountStatus(panel, {
    backend: statusBackend({ kind: "stopped" }),
  }).refresh(),
);

card("Status", "starting", (panel) =>
  mountStatus(panel, {
    backend: statusBackend({ kind: "starting" }),
  }).refresh(),
);

card("Status", "running, phone unknown", (panel) =>
  mountStatus(panel, {
    backend: statusBackend(runningState()),
  }).refresh(),
);

card("Status", "running, live metrics (stub)", (panel) =>
  mountStatus(panel, {
    backend: statusBackend(runningState({
      decode_tokens_per_second: 18.6,
      phone_connected: true,
    })),
  }).refresh(),
);

card("Status", "running, phone not connected", (panel) =>
  mountStatus(panel, {
    backend: statusBackend(runningState({ phone_connected: false })),
  }).refresh(),
);

card("Status", "failed (real words)", (panel) =>
  mountStatus(panel, {
    backend: statusBackend(
      { kind: "failed", reason: REASON_PORT }
   ),
  }).refresh(),
);

card("Status", "failed: the connection dropped (real words)", (panel) =>
  mountStatus(panel, {
    backend: statusBackend(
      { kind: "failed", reason: REASON_CONNECTION_LOST }
   ),
  }).refresh(),
);

card("Status", "failed: the chosen model cannot be funded (real words)", (panel) =>
  mountStatus(panel, {
    backend: statusBackend(
      { kind: "failed", reason: REASON_UNFUNDABLE }
   ),
  }).refresh(),
);

card("Status", "failed, deliberately long reason (wrap test)", (panel) =>
  mountStatus(panel, {
    backend: statusBackend(
      { kind: "failed", reason: REASON_LONG }
   ),
  }).refresh(),
);

card("Status", "state unreadable", (panel) =>
  mountStatus(panel, { backend: statusBackend(null) }).refresh(),
);

card("Status", "running, with a slowdown announced", (panel) =>
  mountStatus(panel, {
    backend: statusBackend(runningState({ throttled: true })),
  }).refresh(),
);

// ---- Model ----
// The walk chooses on its own (startup.rs Progress::Choosing) and speaks
// its failures through the Status page; this page explains the choice. The
// Selection's own words arrive when the shell grows a command for it — no
// invented model names here.

card("Model", "running: the choice is automatic", (panel) =>
  mountModel(panel, { backend: modelBackend({ kind: "running" }) }).refresh(),
);

card("Model", "advanced settings are visible", (panel) => {
  const view = mountModel(panel, {
    backend: modelBackend({ kind: "running" }),
    advancedBackend: advancedBackend(advancedDto()),
  });
  view.refresh().then(() => view.advanced.open());
  return view;
});

card("Model", "starting on the chosen model", (panel) =>
  mountModel(panel, { backend: modelBackend({ kind: "starting" }) }).refresh(),
);

card("Model", "off: nothing is chosen while off", (panel) =>
  mountModel(panel, { backend: modelBackend({ kind: "stopped" }) }).refresh(),
);

card("Model", "not running: the Status page says why", (panel) =>
  mountModel(panel, {
    backend: modelBackend({ kind: "failed", reason: REASON_PORT }),
  }).refresh(),
);

card("Model", "outside the app (browser preview)", (panel) =>
  mountModel(panel, { backend: null }).refresh(),
);


// ---- Pairing ----
// The DTO is pages/pairing.js's contract; the square is a stub symbol — a
// real one comes from kalsa-pairing's qr_svg(payload) and is never logged.

function pairingBackend(dto) {
  return {
    async read() { return dto; },
    async retry() {},
    async decide() {},
    async forget() {},
  };
}

function pairingDto(state, extra = {}) {
  return {
    kind: "pairing",
    state,
    qr_svg: null,
    refreshed: null,
    phone: null,
    new_phone: null,
    delivery_pending: false,
    door_port: null,
    failure: null,
    ...extra,
  };
}

const STUB_SQUARE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21" shape-rendering="crispEdges">' +
  '<rect width="21" height="21" fill="#ffffff"/>' +
  '<path fill="#000000" d="M4 4h2v2H4zM8 4h1v1H8zM4 8h1v1H4zM10 10h3v3h-3zM6 12h1v1H6zM12 6h2v1h-2z"/>' +
  "</svg> (stub square)";

card("Pairing", "nothing to pair to yet", (panel) =>
  mountPairing(panel, { backend: pairingBackend(pairingDto("idle")) }).refresh(),
);

card("Pairing", "a square is waiting", (panel) =>
  mountPairing(panel, {
    backend: pairingBackend(pairingDto("waiting", { qr_svg: STUB_SQUARE })),
  }).refresh(),
);

card("Pairing", "a fresh square after the old one expired", (panel) =>
  mountPairing(panel, {
    backend: pairingBackend(pairingDto("waiting", { qr_svg: STUB_SQUARE, refreshed: "expired" })),
  }).refresh(),
);

card("Pairing", "a fresh square after one did not match", (panel) =>
  mountPairing(panel, {
    backend: pairingBackend(pairingDto("waiting", { qr_svg: STUB_SQUARE, refreshed: "wrong-code" })),
  }).refresh(),
);

card("Pairing", "a phone is connecting", (panel) =>
  mountPairing(panel, { backend: pairingBackend(pairingDto("claiming")) }).refresh(),
);

card("Pairing", "paired; another phone can be paired", (panel) =>
  mountPairing(panel, {
    backend: pairingBackend(pairingDto("paired", { phone: "Pixel 9a (stub)", door_port: 8131 })),
  }).refresh(),
);

card("Pairing", "saved here; the phone still needs the response", (panel) =>
  mountPairing(panel, {
    backend: pairingBackend(
      pairingDto("paired", { phone: "Pixel 9a (stub)", delivery_pending: true, door_port: 8131 }),
    ),
  }).refresh(),
);

card("Pairing", "already paired; a new phone asks", (panel) =>
  mountPairing(panel, {
    backend: pairingBackend(
      pairingDto("replace", {
        phone: "Pixel 9a (stub)",
        new_phone: "New phone (stub)",
        door_port: 8131,
      }),
    ),
  }).refresh(),
);

card("Pairing", "the connection could not be saved", (panel) =>
  mountPairing(panel, {
    backend: pairingBackend(pairingDto("failed", { failure: "could-not-save" })),
  }).refresh(),
);

card("Pairing", "the existing phone connection could not be read", (panel) =>
  mountPairing(panel, {
    backend: pairingBackend(pairingDto("failed", { failure: "could-not-read" })),
  }).refresh(),
);

card("Pairing", "the local pairing service stopped", (panel) =>
  mountPairing(panel, {
    backend: pairingBackend(pairingDto("failed", { failure: "service-unavailable" })),
  }).refresh(),
);
