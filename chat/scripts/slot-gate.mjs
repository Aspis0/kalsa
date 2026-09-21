// The gate's ordering, single flight and late-resolver guard, against a fake
// door on a real socket.
//
// `lib/slotGate.ts` is what `App.tsx` calls to become active, and it is a pure
// module on purpose: the shell cannot be compiled here (React), so the logic
// that must be falsifiable lives where this harness can drive it. The real
// `chat.ts` and `slotGate.ts` are compiled by `lib/app-bundle.mjs`, never
// copied — a JavaScript re-implementation would test the re-implementation.
//
// The door's four workers answer on different sockets, so an unserialized
// client lets two activations of one device invert. The fake door delays each
// answer by id and counts simultaneous handlers: with the client serializing,
// the second request is not emitted until the first has answered, so the order
// the door sees is the order the UI asked. Remove the chain in `slotGate.ts`
// and `maxActive` becomes 2 and the order follows the delays.
//
// Run: node scripts/slot-gate.mjs

import { createServer } from "node:http";
import { rm } from "node:fs/promises";
import { loadApp } from "./lib/app-bundle.mjs";

const TOKEN = "not-a-real-credential";

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

/// A door that records every activate in arrival order, answers after a delay
/// chosen per id, and counts how many handlers run at once. A plan per id says
/// which status to answer with (204 opens; 5xx refuses; 501 is a door without
/// the tier).
function makeDoor() {
  const requests = [];
  const plans = new Map();
  const delays = new Map();
  let inFlight = 0;
  let peak = 0;
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      const { id } = JSON.parse(body || "{}");
      requests.push(id);
      await new Promise((resolve) => setTimeout(resolve, delays.get(id) ?? 0));
      inFlight -= 1;
      const status = plans.get(id) ?? 204;
      response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(status === 204 ? "" : "The slot refused this chat.");
    });
  });
  return {
    server,
    requests,
    get peak() {
      return peak;
    },
    plan(id, status) {
      plans.set(id, status);
    },
    delay(id, ms) {
      delays.set(id, ms);
    },
    reset() {
      requests.length = 0;
      plans.clear();
      delays.clear();
      peak = 0;
    },
  };
}

const door = makeDoor();
await new Promise((resolve) => door.server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${door.server.address().port}`;
const { app, dir } = await loadApp();
const activate = (id) => app.activateChat(base, TOKEN, id);
const activeOf = (gate) => gate.getSnapshot().active?.id ?? null;

try {
  // C3 — two quick switches. Both are asked, the door sees them one at a time
  // and in emission order, and the last asked is the one that ends active. The
  // delays would invert an unserialized client (A is 12x slower than B).
  {
    const gate = app.createSlotGate();
    door.reset();
    door.delay("A", 60);
    door.delay("B", 5);
    const [ra, rb] = await Promise.all([gate.open("A", activate), gate.open("B", activate)]);
    check(
      "opens run one at a time, so the door cannot reorder them",
      door.peak === 1,
      `peak simultaneous handlers=${door.peak}`,
    );
    check(
      "the door sees the opens in the order the UI asked",
      door.requests.join(",") === "A,B",
      door.requests.join(","),
    );
    check("the last asked ends active", activeOf(gate) === "B", activeOf(gate));
    check(
      "isCurrent is true only for the chat that is still active",
      gate.isCurrent(ra.opened) === false && gate.isCurrent(rb.opened) === true,
      `A current=${gate.isCurrent(ra.opened)}, B current=${gate.isCurrent(rb.opened)}`,
    );
  }

  // C2 — single flight. A second Enter while a chat is being created emits no
  // request and cannot make a second chat; once the first resolves, the next
  // creation works.
  {
    const gate = app.createSlotGate();
    door.reset();
    door.delay("X", 40);
    const first = gate.create("X", activate);
    const ignored = await gate.create("Y", activate);
    check("a second creation is ignored, not a second chat", ignored === null, JSON.stringify(ignored));
    const opened = await first;
    check("the first creation opened the chat", opened.opened?.id === "X", JSON.stringify(opened.opened));
    check(
      "the ignored creation emitted no request",
      door.requests.join(",") === "X",
      door.requests.join(","),
    );
    const next = await gate.create("Z", activate);
    check("a creation after the first resolves still works", next.opened?.id === "Z", activeOf(gate));
    check(
      "...and the door saw both that ran",
      door.requests.join(",") === "X,Z",
      door.requests.join(","),
    );
  }

  // A refused activation leaves the active chat exactly as it was, and the next
  // one still works: one failure must not wedge the gate.
  {
    const gate = app.createSlotGate();
    door.reset();
    const a = await gate.open("a", activate);
    check("a first open takes the chat", a.opened?.id === "a", activeOf(gate));
    door.plan("b", 502);
    const b = await gate.open("b", activate);
    check("a refusal is a refusal, with the door's sentence", b.opened === null && b.notice?.failed === true, JSON.stringify(b));
    check("a refused open leaves the active chat unchanged", activeOf(gate) === "a", activeOf(gate));
    const c = await gate.open("c", activate);
    check("the open after a refusal works", c.opened?.id === "c", activeOf(gate));
  }

  // C1 — with no active chat, an attachment that creates a conversation goes
  // through the door. On a refusal the chat does not become active, and the
  // gate answers with the sentence the shell shows.
  {
    const gate = app.createSlotGate();
    door.reset();
    const created = await gate.create("attach-new", activate);
    check(
      "a conversation created by an attachment passes the door",
      door.requests.includes("attach-new"),
      door.requests.join(","),
    );
    check("...and becomes active when the door takes it", created.opened?.id === "attach-new", activeOf(gate));

    const refusedGate = app.createSlotGate();
    door.reset();
    door.plan("attach-refused", 502);
    const refused = await refusedGate.create("attach-refused", activate);
    check(
      "a refused attachment chat does not become active",
      refused.opened === null && activeOf(refusedGate) === null,
      `opened=${refused.opened}, active=${activeOf(refusedGate)}`,
    );
    check(
      "...and the refusal carries the door's sentence for the warning",
      refused.notice?.failed === true && refused.notice.message.length > 0,
      JSON.stringify(refused.notice),
    );
    door.plan("attach-refused", 204);
    const retried = await refusedGate.create("attach-refused", activate);
    check("the next attempt still works", retried.opened?.id === "attach-refused", activeOf(refusedGate));
  }

  // C4 — the freeze. `pending` is true from the moment the open is asked until
  // the door has answered, which is what freezes the outgoing chat's composer
  // and retry.
  {
    const gate = app.createSlotGate();
    door.reset();
    door.delay("slow", 40);
    const slow = gate.open("slow", activate);
    check("an open in flight reports pending", gate.getSnapshot().pending === true, JSON.stringify(gate.getSnapshot()));
    await slow;
    check("...and pending clears when it resolves", gate.getSnapshot().pending === false, JSON.stringify(gate.getSnapshot()));
  }

  // The two notices, kept apart: a door built without the tier (501) opens the
  // chat with a status; a plain success has no notice.
  {
    const gate = app.createSlotGate();
    door.reset();
    door.plan("tierless", 501);
    const tierless = await gate.open("tierless", activate);
    check(
      "a 501 opens the chat with a status, not a refusal",
      tierless.opened?.id === "tierless" && tierless.notice?.failed === false,
      JSON.stringify(tierless),
    );
    const plain = await gate.open("plain", activate);
    check("a plain success has no slot sentence", plain.opened?.id === "plain" && plain.notice === null, JSON.stringify(plain.notice));
  }

  // No door at all: a window on a remote server. Every open succeeds locally,
  // because there is no slot to diverge from.
  {
    const gate = app.createSlotGate();
    const local = await gate.open("remote", null);
    check("with no door an open succeeds locally", local.opened?.id === "remote" && local.notice === null, JSON.stringify(local));
  }
} finally {
  await rm(dir, { recursive: true, force: true });
  door.server.close();
}

console.log(failures === 0 ? "slot-gate: all checks passed" : `slot-gate: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
