// The attach/send race, the P0 of 2026-10-07: a PDF lands in the files panel
// after the send already left, so the wire's one system message carries no
// document block and the model answers it cannot read the attachment. What
// closes it is the attach gate — every send passes `gate.run`, the same
// funnel production's `sendMessage` and `retry` call, and an attach holds its
// conversation's key for the whole read.
//
// Beside the race, the two ways a document rides (2026-10-07, owner's ask):
// unpinned by default — bound at send to the user message it left with, its
// block before that message's words, remembered while the turn is kept and
// dropped with it when the fit sheds it — and pinned, riding the one system
// message on every turn until removed.
//
// The real pieces, compiled from the app's own TypeScript by `loadApp`: the
// gate (`attachGate.ts`), the store (`store.ts`), the block builder
// (`turnDocBlock`), and the wire builder (`buildPinnedContext`). The sends
// below are production's own shapes: the funnel `gate.run(key, body)` with a
// body that binds, reads the store and builds the wire — what `sendNow`
// does. A JavaScript copy of the gate would test the copy.
//
// Mutations: delete the `attachGate.run(` funnel from useChat's `sendMessage`
// and the first wiring pin goes red; delete `attachGate.hold(holdKey)` from
// `attachFromDisk` and the second goes red; make `busy()` always false and
// the held checks go red. For the riding: drop the `pinned` filter in
// `buildPinnedContext` (an unpinned active rides the system message) and the
// per-turn checks go red; drop the `docTokens` term in `messageTokens` and
// the fit check goes red.
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
  pinned: false,
};
const PINNED_DOC = { ...DOC, id: "att-pin", name: "handbook.txt", kind: "txt", pages: undefined, pinned: true };
delete PINNED_DOC.pages;

// The wiring pins, the way verify.mjs pins its sentences: the checks below
// drive the gate and the wire through the app's own exported functions, so a
// body that stopped calling them would leave them green. These read the
// sources they must stay wired into and go red the day the wiring is removed.
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
check(
  "sendNow binds the riding documents to the user message",
  useChatSource.includes("const bindable = store.getAttachments(conv.id).filter((a) => a.active && !(a.pinned ?? true));") &&
    useChatSource.includes("docTokens: estTokens(boundBlock)"),
);
check(
  "the attach trial weighs the staged and the arriving as one rendered block",
  useChatSource.includes("estTokens(turnDocBlock([...riding, ...extracted]))"),
);
check(
  "a bound document leaves the composer's set at send",
  useChatSource.includes('for (const doc of bindable) store.putAttachment(conv.id, { ...doc, active: false });'),
);
const chatSurfaceSource = readFileSync(
  fileURLToPath(new URL("../src/surfaces/ChatSurface.tsx", import.meta.url)),
  "utf8",
);
check(
  "the composer's sendBlocked is the attach gate asked for this conversation",
  chatSurfaceSource.includes("sendBlocked={attachBusy}"),
);
check(
  "the chip and the panel both carry the pin",
  chatSurfaceSource.includes("onPinDoc={chat.setAttachmentPinned}") &&
    chatSurfaceSource.includes("onPin={chat.setAttachmentPinned}"),
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

  // The wire of one conversation, as send-time builds it: every stored
  // attachment rides the build — pinned as the system block, bound through
  // the ids their messages carry.
  const wireFor = (convId, nctx = null) => {
    const conv = store.get(convId);
    return app.buildPinnedContext(conv.messages, store.getAttachments(convId), nctx);
  };
  // sendNow's binding, exactly its shape: the riding documents of this
  // conversation are bound to the new user message by id, weighed once, and
  // detached from the composer's set.
  const sendWith = (convId, text) => {
    const conv = store.get(convId);
    const bindable = store.getAttachments(convId).filter((a) => a.active && !(a.pinned ?? true));
    const boundBlock = app.turnDocBlock(bindable);
    const message = {
      id: `u-${convId}-${conv.messages.length}`,
      role: "user",
      content: text,
      createdAt: conv.messages.length + 1,
      ...(bindable.length > 0
        ? { docs: bindable.map((a) => a.id), docTokens: app.estTokens(boundBlock) }
        : {}),
    };
    store.put({
      ...conv,
      updatedAt: message.createdAt,
      messages: [...conv.messages, message],
    });
    for (const doc of bindable) store.putAttachment(convId, { ...doc, active: false });
    return message;
  };
  // sendMessage's funnel: one `run` per send, keyed by the conversation.
  const send = (convId, text) => gate.run(convId, () => sendWith(convId, text));

  // --- 1. the race: a send while the disk attach reads is held, and the
  //     wire it would have built carries no document anywhere.
  gate.hold("c1");
  const racing = wireFor("c1");
  check(
    "a send while the attach reads is held, not fired",
    gate.run("c1", () => true) === null,
  );
  check(
    "that send's wire would have carried no document — the P0",
    !JSON.stringify(racing.wire).includes("quarterly-report.pdf"),
    JSON.stringify(racing.wire.map((m) => m.role)),
  );

  // --- 2. the attach lands; the next send binds it to its user message.
  store.putAttachment("c1", { ...DOC });
  gate.release("c1");
  check("the gate opens once the attach settles", gate.busy("c1") === false);
  const bound = send("c1", "What does the attached document say?");
  const first = wireFor("c1");
  const system = first.wire[0];
  const userTurn = first.wire.find((m) => m.role === "user" && m.content.includes("quarterly-report.pdf"));
  check(
    "the bound document is NOT in the system message",
    !system.content.includes("quarterly-report.pdf"),
    JSON.stringify(system.content.slice(-80)),
  );
  check(
    "its block rides before its message's words",
    typeof userTurn?.content === "string" &&
      userTurn.content.startsWith("Attached documents:\n\n--- quarterly-report.pdf (pdf, 2 pages, ≈13 tokens) ---\n") &&
      userTurn.content.endsWith("\n\nWhat does the attached document say?"),
    JSON.stringify((userTurn?.content ?? "").slice(0, 90)),
  );
  check(
    "the binding left the composer's set",
    !store.getAttachments("c1").some((a) => a.id === DOC.id && a.active),
  );
  // The delta against the same message without its binding is exactly the
  // block's weight — the fixed prompt and the message's own words cancel.
  const bare = { ...bound, docs: undefined, docTokens: undefined };
  check(
    "the fit counts the bound block as history",
    app.buildPinnedContext([bound], store.getAttachments("c1"), null).historyTokens -
      app.buildPinnedContext([bare], [], null).historyTokens ===
      bound.docTokens,
  );

  // --- 3. the turn after: the bound document still rides its message, a
  //     second send binds nothing new.
  send("c1", "And the access code in it?");
  const second = wireFor("c1");
  check(
    "the next turn still reads the bound document, block and words",
    second.wire.some(
      (m) =>
        m.role === "user" &&
        typeof m.content === "string" &&
        m.content.includes("the sky is blue") &&
        m.content.endsWith("What does the attached document say?"),
    ),
  );
  check(
    "still nothing in the system message",
    !second.wire[0].content.includes("quarterly-report.pdf"),
  );

  // --- 4. the fit sheds the turn, and the document goes with it: a window
  //     that cannot hold the first turn drops the block it carried.
  const shed = wireFor("c1", 756);
  check(
    "a shed turn takes its bound document with it",
    shed.status === "ok" && !JSON.stringify(shed.wire).includes("quarterly-report.pdf"),
    JSON.stringify(shed),
  );

  // --- 5. pinned rides the system message on every turn, until removed.
  store.putAttachment("c2", { ...PINNED_DOC, active: true });
  send("c2", "one");
  send("c2", "two");
  const pinnedWire = wireFor("c2");
  check(
    "a pinned document rides the system message",
    pinnedWire.wire[0].content.includes("--- handbook.txt (txt, ≈13 tokens) ---\nQuarterly report"),
    JSON.stringify(pinnedWire.wire[0].content.slice(-90)),
  );
  store.putAttachment("c2", { ...PINNED_DOC, active: false });
  check(
    "a removed pin leaves the system message",
    !wireFor("c2").wire[0].content.includes("handbook.txt"),
  );

  // --- 6. an old attachment — stored before pinning existed — reads back
  //     pinned, so its behaviour never changes under it.
  store.getAttachments; // the store normalizes on read
  localStorage.setItem(
    "crescent-chat.attach.old.v2",
    JSON.stringify([{ ...DOC, id: "att-old", attachedAt: 1, active: true }].map(({ pinned, ...rest }) => rest)),
  );
  const legacy = store.getAttachments("old").find((a) => a.id === "att-old");
  check(
    "an attachment stored before pinning reads back pinned",
    legacy !== undefined && legacy.active === true && legacy.pinned === true,
    JSON.stringify(legacy),
  );

  // --- 7. two conversations: an attach reading for c2 never holds c1's
  //     send, and the new-chat key holds a creating attach.
  gate.hold("c2");
  check("a hold on c2 leaves c1's send free", send("c1", "side") !== null);
  check("c2's own send is the held one", gate.run("c2", () => true) === null);
  gate.release("c2");
  gate.hold(app.NEW_CHAT);
  check("a send that would create a chat waits for a creating attach", gate.run(null, () => true) === null);
  gate.release(app.NEW_CHAT);
  check("a settled refusal reopens the gate", gate.run("c1", () => true) !== null);

  // --- 8. the history cap never prunes a bound document: 21 documents sent
  //     with one message all survive their own detach, and the wire still
  //     carries every block the message's count pays for.
  {
    const many = Array.from({ length: 21 }, (_, i) => ({
      ...DOC,
      id: `att-20-${String(i).padStart(2, "0")}`,
      name: `page-${String(i).padStart(2, "0")}.txt`,
      kind: "txt",
      attachedAt: i + 1,
      pinned: false,
    }));
    for (const d of many) delete d.pages;
    store.put({ id: "c20", title: "T", createdAt: 1, updatedAt: 2, messages: [] });
    for (const d of many) store.putAttachment("c20", d);
    store.put({
      id: "c20",
      title: "T",
      createdAt: 1,
      updatedAt: 99,
      messages: [
        {
          id: "u20",
          role: "user",
          content: "all of them",
          createdAt: 99,
          docs: many.map((d) => d.id),
          docTokens: app.estTokens(app.turnDocBlock(many)),
        },
      ],
    });
    for (const d of many) store.putAttachment("c20", { ...d, active: false });
    const after = store.getAttachments("c20");
    check(
      "no bound document is pruned by the history cap",
      after.length === 21,
      `${after.length} of 21 remain`,
    );
    const wire20 = app.buildPinnedContext(store.get("c20").messages, after, null);
    check(
      "the oldest bound block still rides the wire",
      wire20.wire.some(
        (m) => typeof m.content === "string" && m.content.includes("--- page-00.txt (txt, ≈13 tokens) ---"),
      ),
    );
    // The cap itself stands for history nobody points at — detached the way
    // the send detaches, through putAttachment, where the cap lives.
    store.put({ id: "c21", title: "T", createdAt: 1, updatedAt: 2, messages: [] });
    for (let i = 0; i < 25; i++) {
      store.putAttachment("c21", { ...DOC, id: `att-loose-${i}`, name: `loose-${i}.txt`, kind: "txt", attachedAt: i + 1, pinned: false });
    }
    for (let i = 0; i < 25; i++) {
      const found = store.getAttachments("c21").find((a) => a.id === `att-loose-${i}`);
      if (found) store.putAttachment("c21", { ...found, active: false });
    }
    check(
      "history nobody references is still capped at twenty",
      store.getAttachments("c21").length === 20,
      `${store.getAttachments("c21").length} remain`,
    );
  }

  // --- 9. the attach trial counts what the send will bind: a staged A plus
  //     an arriving B, measured as their one rendered block. A window that
  //     holds A alone refuses A+B at the attach's own door.
  {
    const staged = { id: "att-a", name: "staged.txt", kind: "txt", chars: 600, tokens: 150, text: "a".repeat(600), attachedAt: 5, active: true, pinned: false };
    const arriving = { id: "att-b", name: "arriving.txt", kind: "txt", chars: 600, tokens: 150, text: "b".repeat(600), attachedAt: 6, active: true, pinned: false };
    for (const id of ["c3", "c4"]) {
      store.put({
        id,
        title: "T",
        createdAt: 1,
        updatedAt: 2,
        messages: [{ id: `m-${id}`, role: "user", content: "hello", createdAt: 1 }],
      });
    }
    store.putAttachment("c3", staged);
    // useChat's own trial expression, driven as the app drives it.
    const riding = store.getAttachments("c3").filter((a) => a.active && !(a.pinned ?? true));
    const blind = { vision: false, url: () => null };
    const trialBoth = app.buildPinnedContext(
      store.get("c3").messages,
      store.getAttachments("c3"),
      1000,
      blind,
      0,
      app.estTokens(app.turnDocBlock([...riding, arriving])),
    );
    check(
      "staged A + arriving B, together too big, refused at attach",
      trialBoth.status === "refused",
      JSON.stringify(trialBoth).slice(0, 90),
    );
    const trialStagedAlone = app.buildPinnedContext(
      store.get("c3").messages,
      store.getAttachments("c3"),
      1000,
      blind,
      0,
      app.estTokens(app.turnDocBlock([...riding])),
    );
    check(
      "the same window still takes the staged A alone",
      trialStagedAlone.status === "ok",
      JSON.stringify(trialStagedAlone).slice(0, 90),
    );
    const trialArrivingAlone = app.buildPinnedContext(
      store.get("c4").messages,
      [],
      1000,
      blind,
      0,
      app.estTokens(app.turnDocBlock([arriving])),
    );
    check(
      "and B alone on an empty conversation",
      trialArrivingAlone.status === "ok",
    );
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
