// The attach/send race, the P0 of 2026-10-07: a PDF lands in the files panel
// after the send already left, so the wire's one system message carries no
// document block and the model answers it cannot read the attachment. What
// closes it is the attach gate — every send passes `gate.run`, the same
// funnel production's `sendMessage` and `retry` call, and an attach holds its
// conversation's key for the whole read.
//
// The real pieces, compiled from the app's own TypeScript by `loadApp`: the
// gate (`attachGate.ts`), the store (`store.ts`), and the wire builder
// (`buildPinnedContext`). The sends below are production's own shapes — the
// funnel `gate.run(key, body)` with a body that reads the store and builds
// the wire, which is what `sendNow` does — driven through the same exported
// function the app calls. A JavaScript copy of the GATE would test the copy,
// so the gate is the app's own; the bodies are the app's shapes.
//
// Mutations: delete the `attachGate.run(` funnel from useChat's `sendMessage`
// and the first wiring pin goes red; delete `attachGate.hold(holdKey)` from
// `attachFromDisk` and the second goes red; make `busy()` always false and
// the held checks go red — the send fires before the document lands, and the
// wire it builds is the P0's.
//
// Run: node scripts/attach-send-race.mjs   (from chat/)

import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

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
  chars: 52,
  tokens: 13,
  text: "Quarterly report: revenue is up and the sky is blue.",
  attachedAt: 1,
  active: true,
};

// The wiring pins, the way verify.mjs pins its sentences: the checks below
// drive the gate through its own exported funnel, so a body that stops
// calling that funnel would leave them green. These read the sources the
// funnel must stay wired into and go red the day the wiring is removed.
const useChatSource = readFileSync(
  fileURLToPath(new URL("../src/surfaces/useChat.ts", import.meta.url)),
  "utf8",
);
check(
  "sendMessage funnels through the attach gate",
  useChatSource.includes(
    "attachGate.run(opened !== null ? opened.id : (active?.id ?? null), () =>",
  ),
);
check(
  "retry funnels through the attach gate",
  useChatSource.includes("attachGate.run(active.id, () => {"),
);
check(
  "attachFromDisk holds the gate before the bytes are read",
  useChatSource.includes("attachGate.hold(holdKey);"),
);
const chatSurfaceSource = readFileSync(
  fileURLToPath(new URL("../src/surfaces/ChatSurface.tsx", import.meta.url)),
  "utf8",
);
check(
  "the composer's sendBlocked is the attach gate asked for this conversation",
  chatSurfaceSource.includes("sendBlocked={attachBusy}"),
);

const { dir, app } = await loadApp();
try {
  const store = app.createStore();
  for (const id of ["c1", "c2"]) {
    store.put({
      id,
      title: "T",
      createdAt: 1,
      updatedAt: 2,
      messages: [
        { id: `m-${id}`, role: "user", content: "What does the attached document say?", createdAt: 1 },
      ],
    });
  }
  const gate = app.createAttachGate();

  // sendNow's body, as production shapes it: read the store fresh, build the
  // wire, return the system message the engine reads.
  const wireFor = (convId) => {
    const docs = store.getAttachments(convId).filter((a) => a.active);
    return app.buildPinnedContext(store.get(convId).messages, docs, null).wire[0];
  };
  // sendMessage's funnel: one `run` per send, keyed by the conversation.
  const send = (convId) => gate.run(convId, () => wireFor(convId));

  // --- the disk attach (attachFromDisk): its hold opens before the bytes are
  // read and closes in its finally; attachFiles holds the same key beside it.
  const attachFromDisk = (convId, doc) => {
    gate.hold(convId);
    try {
      gate.hold(convId); // attachFiles' own hold, the same key
      try {
        store.putAttachment(convId, doc); // extraction lands
      } finally {
        gate.release(convId); // attachFiles' finally
      }
    } finally {
      gate.release(convId); // the disk path's finally
    }
  };

  // 1. The race, on the composer's entry: a send while the disk attach reads
  //    is held; the wire it would have built carries no document — the P0.
  gate.hold("c1"); // attachFromDisk began; the bytes are still reading
  check("a send while the disk attach reads is held, not fired", send("c1") === null);
  const racing = wireFor("c1");
  check(
    "that send's wire would have carried no document — the P0",
    !racing.content.includes("--- quarterly-report.pdf"),
  );
  store.putAttachment("c1", { ...DOC }); // extraction lands mid-attach
  gate.release("c1"); // the attach settles
  const wire = send("c1");
  check(
    "the sent system message names the document block",
    typeof wire?.content === "string" &&
      wire.content.includes("--- quarterly-report.pdf (pdf, 2 pages, ≈13 tokens) ---"),
    JSON.stringify(wire?.content).slice(0, 200),
  );
  check(
    "and carries the document's own text",
    typeof wire?.content === "string" && wire.content.includes("the sky is blue"),
  );

  // 2. Two conversations: an attach reading for c2 never holds c1's send.
  gate.hold("c2");
  store.putAttachment("c2", { ...DOC, id: "att-2", attachedAt: 2 });
  check("a hold on c2 leaves c1's send free", send("c1") !== null);
  check("c2's own send is the held one", send("c2") === null);
  gate.release("c2");
  check("c2's send goes once its attach settles", send("c2") !== null);

  // 3. The new-chat entry: an attach creating a conversation holds the chat
  //    that does not exist yet, and a null key is how a send asks for it. The
  //    body is sendNow's shape — no active chat means the send creates one.
  let freshCount = 0;
  const sendNew = () =>
    gate.run(null, () => {
      const id = `fresh-${(freshCount += 1)}`;
      store.put({
        id,
        title: "T",
        createdAt: 3,
        updatedAt: 3,
        messages: [{ id: `m-${id}`, role: "user", content: "hello", createdAt: 3 }],
      });
      return wireFor(id);
    });
  gate.hold(app.NEW_CHAT);
  check("a send that would create a chat waits for a creating attach", sendNew() === null);
  check("and a held send creates nothing", !store.list().some((meta) => meta.id.startsWith("fresh-")));
  gate.release(app.NEW_CHAT);
  check("the new-chat send goes once the attach settles", sendNew() !== null);

  // 4. A refusal settles an attach too: the gate must not stick shut.
  gate.hold("c1");
  gate.release("c1");
  check("a settled refusal reopens the gate", send("c1") !== null);
} finally {
  await rm(dir, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
