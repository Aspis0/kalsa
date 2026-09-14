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

// Dark mode without switching the OS: the banner button forces a theme;
// with no class on body, the page follows the OS like the app does.
const themeToggle = document.getElementById("theme-toggle");
themeToggle.textContent = "View dark";
themeToggle.addEventListener("click", () => {
  const dark = document.body.classList.toggle("theme-dark");
  document.body.classList.toggle("theme-light", !dark);
  themeToggle.textContent = dark ? "View light" : "View dark";
});

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

function modelBackend(measured, measure) {
  return {
    async measured() {
      return measured;
    },
    measure,
  };
}

// ---- Status ----

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

card("Pairing", "not ready yet", (panel) => mountPairing(panel, { steps: null }));

card("Pairing", "steps exist (stub)", (panel) =>
  mountPairing(panel, {
    steps: [
      { title: "Step one (stub)", detail: "(stub details)" },
      { title: "Step two (stub)" },
    ],
  }),
);
