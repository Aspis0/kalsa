// The states page: mounts the REAL page code once per state, with stubbed
// data, so copy and layout can be reviewed side by side. Served from dev/ —
// outside src/, the app never sees this file, and nothing in the app links
// here.
//
// Stub rules: failure sentences marked "(real words)" are copied verbatim
// from main.rs `words()` — keep them in sync when the words change there.
// Invented examples carry "(stub)" in the text itself, and numbers stay as
// bracketed placeholders: this page reviews words, it never rehearses
// plausible measurements.

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

function statusBackend(state, modelChosen) {
  return {
    async read() {
      return state ? [state, modelChosen] : null;
    },
    async start() {},
    async stop() {},
  };
}

// The progress payloads above are the real `brain_progress` shapes from
// src-tauri/src/startup.rs, with byte figures measured tonight; they exist
// to review the sentence around them, not to promise a download size.

function modelBackend(measured, measure) {
  return {
    async measured() {
      return measured;
    },
    measure,
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
      backend: statusBackend({ kind: "stopped" }, true),
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
    backend: statusBackend({ kind: "stopped" }, true),
    events: (() => {
      const bus = fakeBus();
      bus.emit("brain_progress", { kind: "measuring" });
      return bus;
    })(),
  }).refresh(),
);

card("Status", "first run: deciding the engine", (panel) =>
  mountStatus(panel, {
    backend: statusBackend({ kind: "stopped" }, true),
    events: (() => {
      const bus = fakeBus();
      bus.emit("brain_progress", { kind: "deciding" });
      return bus;
    })(),
  }).refresh(),
);

card("Status", "first run: choosing a model", (panel) =>
  mountStatus(panel, {
    backend: statusBackend({ kind: "stopped" }, true),
    events: (() => {
      const bus = fakeBus();
      bus.emit("brain_progress", { kind: "choosing" });
      return bus;
    })(),
  }).refresh(),
);

card("Status", "first run: no model, engine off", (panel) =>
  mountStatus(panel, {
    backend: statusBackend({ kind: "stopped" }, false),
  }).refresh(),
);

card("Status", "off, with a model set up", (panel) =>
  mountStatus(panel, {
    backend: statusBackend({ kind: "stopped" }, true),
  }).refresh(),
);

card("Status", "starting", (panel) =>
  mountStatus(panel, {
    backend: statusBackend({ kind: "starting" }, true),
  }).refresh(),
);

card("Status", "running, phone unknown", (panel) =>
  mountStatus(panel, {
    backend: statusBackend({ kind: "running" }, true),
  }).refresh(),
);

card("Status", "running, phone connected", (panel) =>
  mountStatus(panel, {
    backend: statusBackend({ kind: "running" }, true),
    phone: true,
  }).refresh(),
);

card("Status", "running, phone known absent", (panel) =>
  mountStatus(panel, {
    backend: statusBackend({ kind: "running" }, true),
    phone: false,
  }).refresh(),
);

card("Status", "failed (real words)", (panel) =>
  mountStatus(panel, {
    backend: statusBackend(
      { kind: "failed", reason: REASON_PORT },
      true,
    ),
  }).refresh(),
);

card("Status", "failed: the connection dropped (real words)", (panel) =>
  mountStatus(panel, {
    backend: statusBackend(
      { kind: "failed", reason: REASON_CONNECTION_LOST },
      true,
    ),
  }).refresh(),
);

card("Status", "failed: the chosen model cannot be funded (real words)", (panel) =>
  mountStatus(panel, {
    backend: statusBackend(
      { kind: "failed", reason: REASON_UNFUNDABLE },
      true,
    ),
  }).refresh(),
);

card("Status", "failed, deliberately long reason (wrap test)", (panel) =>
  mountStatus(panel, {
    backend: statusBackend(
      { kind: "failed", reason: REASON_LONG },
      true,
    ),
  }).refresh(),
);

card("Status", "state unreadable", (panel) =>
  mountStatus(panel, { backend: statusBackend(null, null) }).refresh(),
);

card("Status", "running, with a slowdown announced", (panel) =>
  mountStatus(panel, {
    backend: statusBackend({ kind: "running" }, true),
    throttled: true,
  }).refresh(),
);

// ---- Model ----

card("Model", "not measured yet", (panel) =>
  mountModel(panel, { backend: modelBackend(false) }).refresh(),
);

card("Model", "measuring (click Measure to watch it)", async (panel) => {
  mountModel(panel, {
    backend: modelBackend(false, () => new Promise(() => {})),
  }).refresh();
  await settle();
  press(panel);
  await settle();
});

card("Model", "measurement rejected: too busy (click Measure)", async (panel) => {
  mountModel(panel, { backend: modelBackend(false, async () => false) }).refresh();
  await settle();
  press(panel);
  await settle();
});

card("Model", "measuring failed (click Measure)", async (panel) => {
  mountModel(panel, {
    backend: modelBackend(false, async () => {
      throw new Error("stub failure");
    }),
  }).refresh();
  await settle();
  press(panel);
  await settle();
});

card("Model", "measured, waiting for the phone", (panel) =>
  mountModel(panel, { backend: modelBackend(true) }).refresh(),
);

card("Model", "outside the app (browser preview)", (panel) =>
  mountModel(panel, { backend: null }).refresh(),
);

card("Model", "a refusal (real words)", (panel) =>
  mountModel(panel, { backend: null }).showDecision({
    refuse: {
      reason: "nothingBetter",
      explanation: "(stub explanation)",
    },
  }),
);

const STUB_RATIONALE =
  "This model has about [N] billion parameters and should write at about [X] to [Y] words a second on this computer; the cache size is still an assumption. (stub)";

function pickCard(title, justification) {
  card("Model", title, (panel) =>
    mountModel(panel, { backend: null }).showDecision({
      pick: {
        label: "Example Model (stub)",
        justification,
        rationale: STUB_RATIONALE,
      },
    }),
  );
}

pickCard("a capability pick", "capability");
pickCard("a relief pick", "relief");
pickCard("an expected-but-unmeasured pick", "expectedButUnmeasured");

card("Model", "no decision at all", (panel) =>
  mountModel(panel, { backend: null }).showDecision(null),
);

// ---- Pairing ----
// The DTO is pages/pairing.js's contract; the square is a stub symbol — a
// real one comes from kalsa-pairing's qr_svg(payload) and is never logged.

function pairingBackend(dto) {
  return { async read() { return dto; }, async retry() {}, async decide() {} };
}

function pairingDto(state, extra = {}) {
  return {
    kind: "pairing",
    state,
    qr_svg: null,
    refreshed: null,
    phone: null,
    new_phone: null,
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

card("Pairing", "paired", (panel) =>
  mountPairing(panel, {
    backend: pairingBackend(pairingDto("paired", { phone: "Pixel 9a (stub)" })),
  }).refresh(),
);

card("Pairing", "already paired; a new phone asks", (panel) =>
  mountPairing(panel, {
    backend: pairingBackend(
      pairingDto("replace", { phone: "Pixel 9a (stub)", new_phone: "New phone (stub)" }),
    ),
  }).refresh(),
);

card("Pairing", "the connection could not be saved", (panel) =>
  mountPairing(panel, {
    backend: pairingBackend(pairingDto("failed", { failure: "could-not-save" })),
  }).refresh(),
);
