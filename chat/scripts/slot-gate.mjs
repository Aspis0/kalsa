// The gate's ordering, single flight and late-resolver guard, against a fake
// door on a real socket.
//
// `lib/slotGate.ts` is what `App.tsx` calls to become active, and it is pure on
// purpose: the shell cannot be compiled here (React), so the logic that must be
// falsifiable lives where this harness can drive it. The real `chat.ts` and
// `slotGate.ts` are compiled by `lib/app-bundle.mjs`, never copied — a
// JavaScript copy would test the copy.
//
// The door's four workers answer on different sockets, so an unserialized
// client lets two activations of one device invert: with the client
// serializing, the door sees the opens in the order the UI asked. Remove the
// chain in `slotGate.ts` and `peak` becomes 2, and the order follows the delays.
//
// The fake door checks the REQUEST, not only the id in it — the method, the
// path, the bearer header, and a body whose only key is `id`. A `slotRoute`
// regression would otherwise leave this file green while the real door answered
// 404, or while a file name travelled beside the id.
//
// Run: node scripts/slot-gate.mjs

import { createServer } from "node:http";
import { rm } from "node:fs/promises";
import { loadApp } from "./lib/app-bundle.mjs";

const TOKEN = "not-a-real-credential";
const ROUTE = "/kalsa/chat/activate";

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

/// The one request shape `chat.ts:slotRoute` may send, as a fault: `null` is the
/// request the door's route accepts. The routes live on the server root, so a
/// `/v1` in front of one is a fault like any other.
function requestFault(request, body) {
  if (request.method !== "POST") return `method ${request.method}`;
  if (request.url !== ROUTE) return `path ${request.url}`;
  if ((request.headers.authorization ?? "") !== `Bearer ${TOKEN}`)
    return `authorization ${request.headers.authorization ?? "(none)"}`;
  let carried;
  try {
    carried = JSON.parse(body);
  } catch {
    return `body is not JSON: ${body}`;
  }
  if (carried === null || typeof carried !== "object" || Array.isArray(carried))
    return `body is not an object: ${body}`;
  const keys = Object.keys(carried);
  if (keys.length !== 1 || keys[0] !== "id") return `body keys ${keys.join(",") || "(none)"}`;
  if (typeof carried.id !== "string" || carried.id === "") return `body id ${JSON.stringify(carried.id)}`;
  return null;
}

/// A door that refuses any request that is not the route's own shape, records
/// every activate in arrival order, answers after a delay chosen per id, and
/// counts how many handlers run at once. A plan per id says which status to
/// answer with (204 opens; 5xx refuses; 501 is a door without the tier).
function makeDoor() {
  const requests = [];
  const faults = [];
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
      let carried = {};
      try {
        const parsed = JSON.parse(body || "{}");
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) carried = parsed;
      } catch {
        // Not JSON at all; the fault below says so.
      }
      requests.push(carried.id);
      const fault = requestFault(request, body);
      if (fault !== null) {
        faults.push(fault);
        inFlight -= 1;
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("The door does not accept this request.");
        return;
      }
      const { id } = carried;
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
    faults,
    get peak() {
      return peak;
    },
    plan(id, status) {
      plans.set(id, status);
    },
    delay(id, ms) {
      delays.set(id, ms);
    },
    /// `faults` is deliberately not cleared: the last check reads it for the
    /// whole run, and the self-test accounts for the two it provokes.
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
/// A gate whose door is callable, which is what every block below is about
/// except the standing ones, which set the access themselves.
async function readyGate() {
  const gate = app.createSlotGate();
  await gate.setAccess({ kind: "ready", activate });
  return gate;
}
/// The faults this script provokes on purpose in B5 — counted as its own, so a
/// malformed request from the app is a failure and never part of the arithmetic.
let deliberate = 0;

try {
  // C3 — two quick switches. Both are asked, the door sees them one at a time
  // and in emission order, and the last asked is the one that ends active. The
  // delays would invert an unserialized client (A is 12x slower than B).
  {
    const gate = await readyGate();
    door.reset();
    door.delay("A", 60);
    door.delay("B", 5);
    const [ra, rb] = await Promise.all([gate.open("A"), gate.open("B")]);
    check("opens run one at a time, so the door cannot reorder them", door.peak === 1, `peak simultaneous handlers=${door.peak}`);
    check("the door sees the opens in the order the UI asked", door.requests.join(",") === "A,B", door.requests.join(","));
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
    const gate = await readyGate();
    door.reset();
    door.delay("X", 40);
    const first = gate.create("X");
    const ignored = await gate.create("Y");
    check("a second creation is ignored, not a second chat", ignored === null, JSON.stringify(ignored));
    const opened = await first;
    check("the first creation opened the chat", opened.opened?.id === "X", JSON.stringify(opened.opened));
    check("the ignored creation emitted no request", door.requests.join(",") === "X", door.requests.join(","));
    const next = await gate.create("Z");
    check("a creation after the first resolves still works", next.opened?.id === "Z", activeOf(gate));
    check("...and the door saw both that ran", door.requests.join(",") === "X,Z", door.requests.join(","));
  }

  // A refused activation leaves the active chat exactly as it was, and the next
  // one still works: one failure must not wedge the gate.
  {
    const gate = await readyGate();
    door.reset();
    const a = await gate.open("a");
    check("a first open takes the chat", a.opened?.id === "a", activeOf(gate));
    door.plan("b", 502);
    const b = await gate.open("b");
    check("a refusal is a refusal, with the door's sentence", b.opened === null && b.notice?.failed === true, JSON.stringify(b));
    check("a refused open leaves the active chat unchanged", activeOf(gate) === "a", activeOf(gate));
    const c = await gate.open("c");
    check("the open after a refusal works", c.opened?.id === "c", activeOf(gate));
  }

  // C1 — with no active chat, an attachment that creates a conversation goes
  // through the door. On a refusal the chat does not become active, and the
  // gate answers with the sentence the shell shows.
  {
    const gate = await readyGate();
    door.reset();
    const created = await gate.create("attach-new");
    check("a conversation created by an attachment passes the door", door.requests.includes("attach-new"), door.requests.join(","));
    check("...and becomes active when the door takes it", created.opened?.id === "attach-new", activeOf(gate));

    const refusedGate = await readyGate();
    door.reset();
    door.plan("attach-refused", 502);
    const refused = await refusedGate.create("attach-refused");
    check(
      "a refused attachment chat does not become active",
      refused.opened === null && activeOf(refusedGate) === null,
      `opened=${refused.opened}, active=${activeOf(refusedGate)}`,
    );
    check("...and the refusal carries the door's sentence for the warning", refused.notice?.failed === true && refused.notice.message.length > 0, JSON.stringify(refused.notice));
    door.plan("attach-refused", 204);
    const retried = await refusedGate.create("attach-refused");
    check("the next attempt still works", retried.opened?.id === "attach-refused", activeOf(refusedGate));
  }

  // C4 — the freeze. `pending` is true from the moment the open is asked until
  // the door has answered, which is what freezes the outgoing chat's composer
  // and retry.
  {
    const gate = await readyGate();
    door.reset();
    door.delay("slow", 40);
    const slow = gate.open("slow");
    check("an open in flight reports pending", gate.getSnapshot().pending === true, JSON.stringify(gate.getSnapshot()));
    await slow;
    check("...and pending clears when it resolves", gate.getSnapshot().pending === false, JSON.stringify(gate.getSnapshot()));
  }

  // The two notices, kept apart: a door built without the tier (501) opens the
  // chat with a status; a plain success has no notice.
  {
    const gate = await readyGate();
    door.reset();
    door.plan("tierless", 501);
    const tierless = await gate.open("tierless");
    check(
      "a 501 opens the chat with a status, not a refusal",
      tierless.opened?.id === "tierless" && tierless.notice?.failed === false,
      JSON.stringify(tierless),
    );
    const plain = await gate.open("plain");
    check("a plain success has no slot sentence", plain.opened?.id === "plain" && plain.notice === null, JSON.stringify(plain.notice));
  }

  // No door at all: a window on a remote server. Every open succeeds locally,
  // because there is no slot to diverge from. This case must stay green.
  {
    const gate = app.createSlotGate();
    await gate.setAccess({ kind: "absent" });
    const local = await gate.open("remote");
    check("with no door an open succeeds locally", local.opened?.id === "remote" && local.notice === null, JSON.stringify(local));
  }

  // C5 — a door that exists and cannot be called yet HOLDS the open. Nothing
  // reaches the door, and above all nothing is minted locally: a chat minted in
  // that window is one the door never took, and the next switch writes the
  // slot's state into that chat's file.
  {
    const gate = app.createSlotGate();
    door.reset();
    // The window C5 is about: a brain has started (past `absent`) and its key is
    // not in this window's hand yet.
    await gate.setAccess({ kind: "absent" });
    await gate.setAccess({ kind: "unready" });
    const held = gate.open("B");
    await new Promise((resolve) => setTimeout(resolve, 20));
    check("an open against a door that is not callable yet reaches no door", door.requests.length === 0, door.requests.join(","));
    check("...and mints nothing locally", activeOf(gate) === null, activeOf(gate));
    check("...and reports pending while it waits", gate.getSnapshot().pending === true, JSON.stringify(gate.getSnapshot()));
    await gate.setAccess({ kind: "ready", activate });
    const opened = await held;
    check("the held open starts when the door becomes callable", door.requests.join(",") === "B", door.requests.join(","));
    check("...and the chat becomes active then", opened.opened?.id === "B" && activeOf(gate) === "B", activeOf(gate));
  }

  // The hand-over. The window minted a chat with no door at all — a remote
  // server, or the second before the brain started — and a door appears: the
  // active chat must be opened on it, or the UI keeps showing a chat the slot
  // does not hold and the next switch writes the slot's state into its file.
  {
    const gate = app.createSlotGate();
    door.reset();
    await gate.setAccess({ kind: "absent" });
    const local = await gate.open("A");
    check("with no door the chat opens locally", local.opened?.id === "A", activeOf(gate));
    check("...and the door heard nothing of it", door.requests.length === 0, door.requests.join(","));
    await gate.setAccess({ kind: "ready", activate });
    check("the chat minted without a door is opened on it", door.requests.join(",") === "A", door.requests.join(","));
    check("...and stays the active one", activeOf(gate) === "A", activeOf(gate));
    await gate.setAccess({ kind: "ready", activate });
    check("a door that stays callable does not open it a second time", door.requests.join(",") === "A", door.requests.join(","));
  }

  // A hand-over the door refuses. The UI must not keep showing a chat the slot
  // does not hold, and there is no other chat to fall back to — the refusal is
  // about the only chat that was open — so the window ends up with none, with
  // the door's sentence up. That sentence is the gate's own notice: this open
  // has no caller to return it to.
  {
    const gate = app.createSlotGate();
    door.reset();
    await gate.setAccess({ kind: "absent" });
    await gate.open("A");
    door.plan("A", 502);
    await gate.setAccess({ kind: "ready", activate });
    check("a refused hand-over leaves no active chat", activeOf(gate) === null, activeOf(gate));
    check("...and keeps the door's sentence for the warning", gate.getSnapshot().notice?.failed === true && gate.getSnapshot().notice.message.length > 0, JSON.stringify(gate.getSnapshot().notice));
    gate.dismissNotice();
    check("...and the sentence can be dismissed", gate.getSnapshot().notice === null, JSON.stringify(gate.getSnapshot().notice));
    // A second one, to prove a later open takes it down instead of letting it
    // reappear behind the shell's own cleared sentence.
    await gate.setAccess({ kind: "absent" });
    await gate.open("B");
    door.plan("B", 502);
    await gate.setAccess({ kind: "ready", activate });
    check("a second hand-over says so again", gate.getSnapshot().notice?.failed === true, JSON.stringify(gate.getSnapshot().notice));
    door.plan("B", 204);
    await gate.open("C");
    check("a later open takes the old sentence down", gate.getSnapshot().notice === null, JSON.stringify(gate.getSnapshot().notice));
  }

  // C5's root, as a pure rule: a poll that does not answer must not turn a known
  // door into no door. Read the wrong way, a lost tick was a second in which the
  // window believed there was no door and minted a chat locally against a live
  // slot.
  {
    const up = { kind: "running", endpoint: "http://127.0.0.1:8123/v1" };
    check("a lost poll keeps the brain this window already knew", app.lastKnown(up, null) === up, JSON.stringify(app.lastKnown(up, null)));
    check("...and a real answer replaces it", app.lastKnown(up, { kind: "stopped" }).kind === "stopped", JSON.stringify(app.lastKnown(up, { kind: "stopped" })));
    check("a running brain whose key is not in hand is not 'no door'", app.standingOf(up, false) === "unready", app.standingOf(up, false));
    check("...with the key in hand it is ready", app.standingOf(up, true) === "ready", app.standingOf(up, true));
    check("a brain that is not running is no door", app.standingOf({ kind: "stopped" }, true) === "absent", app.standingOf({ kind: "stopped" }, true));
    check("a brain that has not answered yet is not 'no door'", app.standingOf(null, false) === "unready", app.standingOf(null, false));
    check("a running brain with no door address yet is not 'no door'", app.standingOf({ kind: "running", endpoint: null }, true) === "unready", app.standingOf({ kind: "running", endpoint: null }, true));
  }

  // B3 — the shell's "already open" fast path. It must read the gate, not the
  // rendered active id: during a switch the render still says the outgoing chat,
  // and skipping the open on that basis lets an open the user has moved past win.
  {
    const gate = await readyGate();
    door.reset();
    door.delay("B", 40);
    await gate.open("A");
    check("the settled active chat is reported settled", gate.isSettled("A") === true, String(gate.isSettled("A")));
    const opening = gate.open("B");
    check("...and while a switch is in flight nothing is", gate.isSettled("A") === false && gate.isSettled("B") === false, `A=${gate.isSettled("A")} B=${gate.isSettled("B")}`);
    await opening;
    check("...and the chat that won the last click is settled", gate.isSettled("B") === true && gate.isSettled("A") === false, `A=${gate.isSettled("A")} B=${gate.isSettled("B")}`);
  }

  // B4 — a chat deleted while its own open is in flight. The gate must not end
  // up active on a conversation the store no longer has.
  {
    const gate = await readyGate();
    door.reset();
    door.delay("B", 40);
    await gate.open("A");
    const opening = gate.open("B");
    gate.clearIf("B");
    const result = await opening;
    check("a chat deleted while it was being opened never becomes active", activeOf(gate) === "A", activeOf(gate));
    check("...and the open that was taken from it opens nothing", result.opened === null, JSON.stringify(result.opened));
  }

  // Every request the app sent is in by now; B5's provocations are its own.
  const appFaults = door.faults.length;
  // B5 — the shape guard is itself checked, or a check that never fires would
  // look exactly like a shape that is right.
  {
    const wrongPath = await fetch(`${base}/v1${ROUTE}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ id: "x" }),
    });
    check("the fake door refuses the route with a /v1 in front of it", wrongPath.status === 400, `status ${wrongPath.status}`);
    const withName = await fetch(`${base}${ROUTE}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ id: "x", filename: "d1-m2-c3.bin" }),
    });
    check("...and a body carrying a file name beside the id", withName.status === 400, `status ${withName.status}`);
    deliberate = door.faults.length - appFaults;
  }

  const dims = [
    requestFault({ method: "PUT", url: ROUTE, headers: { authorization: `Bearer ${TOKEN}` } }, `{"id":"x"}`),
    requestFault({ method: "POST", url: `/v1${ROUTE}`, headers: { authorization: `Bearer ${TOKEN}` } }, `{"id":"x"}`),
    requestFault({ method: "POST", url: ROUTE, headers: { authorization: "Bearer wrong" } }, `{"id":"x"}`),
    requestFault({ method: "POST", url: ROUTE, headers: { authorization: `Bearer ${TOKEN}` } }, `{"id":"x","filename":"f"}`),
  ];
  check("every request the app sent passed method, path, bearer and exact body keys — and the guard fires on all four", appFaults === 0 && deliberate === 2 && dims.every((d, i) => String(d).startsWith(["method", "path", "authorization", "body keys"][i])), door.faults.slice(0, appFaults).join("; ") || JSON.stringify(dims));
} finally {
  await rm(dir, { recursive: true, force: true });
  door.server.close();
}

console.log(failures === 0 ? "slot-gate: all checks passed" : `slot-gate: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
