// The attach/send race, the P0 of 2026-10-07: a PDF lands in the files panel
// after the send already left, so the wire's one system message carries no
// document block and the model answers it cannot read the attachment. What
// closes it is the attach gate — the send asks it at Enter and stands down
// while an attach is in flight, then reads the store fresh.
//
// The real pieces, compiled from the app's own TypeScript by `loadApp`: the
// gate (`attachGate.ts`), the store (`store.ts`), and the wire builder
// (`buildPinnedContext`). `attemptSend` is useChat's send path line for line:
// the gate's refusal first, then `store.getAttachments(...).filter(active)`
// into `buildPinnedContext`, whose first message is the system message the
// engine reads. A JavaScript copy would test the copy.
//
// Mutation: delete the `attachGate.busy()` refusal in useChat's `send` and the
// wiring pin below goes red; make `busy()` always false and the held check
// goes red — the send fires before the document lands, and the wire it builds
// is the P0's.
//
// Run: node scripts/attach-send-race.mjs   (from chat/)

import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

class MemoryStorage {
  #map = new Map();
  get length() {
    return this.#map.size;
  }
  key(index) {
    return [...this.#map.keys()][index] ?? null;
  }
  getItem(key) {
    return this.#map.has(key) ? this.#map.get(key) : null;
  }
  setItem(key, value) {
    this.#map.set(String(key), String(value));
  }
  removeItem(key) {
    this.#map.delete(key);
  }
  clear() {
    this.#map.clear();
  }
}
globalThis.localStorage = new MemoryStorage();

const { loadApp } = await import("./lib/app-bundle.mjs");

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const DOC = {
  id: "att-1",
  name: "quarterly-report.pdf",
  kind: "pdf",
  pages: 2,
  chars: 40,
  tokens: 10,
  text: "Quarterly report: revenue is up and the sky is blue.",
  attachedAt: 1,
  active: true,
};

const { dir, app } = await loadApp();

// The wiring pins, the way verify.mjs pins its sentences: the behavioral
// checks above drive the gate directly, so deleting the gate's refusal from
// the app's `send` would leave them green. These two read the sources they
// must stay wired into and go red the day the wiring is removed.
const useChatSource = readFileSync(
  fileURLToPath(new URL("../src/surfaces/useChat.ts", import.meta.url)),
  "utf8",
);
check(
  "useChat's send stands down while an attach is in flight",
  useChatSource.includes("if (attachGate.busy()) return false;"),
);
const chatSurfaceSource = readFileSync(
  fileURLToPath(new URL("../src/surfaces/ChatSurface.tsx", import.meta.url)),
  "utf8",
);
check(
  "the composer's sendBlocked is the attach gate's count",
  chatSurfaceSource.includes("sendBlocked={attachBusy > 0}"),
);

try {
  const store = app.createStore();
  store.put({
    id: "c1",
    title: "T",
    createdAt: 1,
    updatedAt: 2,
    messages: [
      { id: "m1", role: "user", content: "What does the attached document say?", createdAt: 1 },
    ],
  });

  const gate = app.createAttachGate();
  // useChat's send path, line for line: the gate's word at Enter, then the
  // wire built from the store as it stands.
  const attemptSend = () => {
    if (gate.busy()) return null;
    const docs = store.getAttachments("c1").filter((a) => a.active);
    const ctx = app.buildPinnedContext(store.get("c1").messages, docs, null);
    return ctx.wire[0];
  };

  gate.begin(); // attachFiles started: the PDF is still being read

  const held = attemptSend();
  check("a send while the attach reads is held, not fired", held === null);
  const racing = (() => {
    const docs = store.getAttachments("c1").filter((a) => a.active);
    return app.buildPinnedContext(store.get("c1").messages, docs, null).wire[0];
  })();
  check(
    "that send's wire would have carried no document — the P0",
    !racing.content.includes("--- quarterly-report.pdf"),
  );

  store.putAttachment("c1", { ...DOC }); // extraction lands in the store
  gate.end(); // attachFiles settles; the held send may go

  check("the gate opens once the attach settles", gate.busy() === false);
  const wire = attemptSend();
  check(
    "the sent system message names the document block",
    typeof wire?.content === "string" &&
      wire.content.includes("--- quarterly-report.pdf (pdf, 2 pages, ≈10 tokens) ---"),
    JSON.stringify(wire?.content).slice(0, 200),
  );
  check(
    "and carries the document's own text",
    typeof wire?.content === "string" && wire.content.includes("the sky is blue"),
  );

  // A refusal settles an attach too: the gate must not stick shut.
  gate.begin();
  gate.end();
  check("a settled refusal reopens the gate", gate.busy() === false && attemptSend() !== null);
} finally {
  await rm(dir, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
