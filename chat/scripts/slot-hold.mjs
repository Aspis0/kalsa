// The hold's two edges, and the read `send` takes from the gate: a wait the
// window can see, an end that arrives as an error instead of a frozen
// composer (C1), and a fresh gate read instead of the render's snapshot (C3).
//
// These checks live BESIDE `slot-gate.mjs`, not inside it: that file is at
// 392 of the project's 400-line ceiling and this round's rule is that it does
// not cross. Moving its checks out to make room would be the dodge the limit
// exists to forbid; adding new behaviour under its own ceiling is not.
//
// The fake activate answers instantly on purpose: what is under test here is
// the gate's clock and snapshot identity, not the wire — `slot-gate.mjs`
// owns the request's method, path, bearer and body.
//
// Run: node scripts/slot-hold.mjs

import { rm } from "node:fs/promises";
import { loadApp } from "./lib/app-bundle.mjs";

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/// The door callable, answering at once: every check below is about when the
/// gate lets go, not about what an answer contains.
const activate = async () => ({ kind: "ok" });
/// Stands in for "a promise that never settles" when the gate itself has no
/// deadline: on a gate with no exit this wins the race, which is the defect.
const never = () => new Promise((resolve) => setTimeout(() => resolve(null), 400));

const { app, dir } = await loadApp();
try {
  // C1 — a hold that can never end must end: after the deadline the open
  // answers as an error, the freeze comes down, and the window is told why —
  // both while waiting and at the end. On a gate with no deadline neither the
  // sentence nor the end exists and both checks below fail.
  {
    const gate = app.createSlotGate(60);
    await gate.setAccess({ kind: "unready" });
    const held = gate.open("H");
    await sleep(20);
    check(
      "a held open says what it is waiting for",
      (gate.getSnapshot().notice?.message ?? "") !== "",
      JSON.stringify(gate.getSnapshot().notice),
    );
    const settled = await Promise.race([held, never()]);
    check(
      "a hold that never resolves ends as an error, not pending forever",
      settled !== null && settled.opened === null && settled.notice?.failed === true,
      JSON.stringify(settled),
    );
    check(
      "...and the composer's freeze is released with it",
      gate.getSnapshot().pending === false,
      String(gate.getSnapshot().pending),
    );
    check(
      "...and the gate carries the error for the window to show",
      gate.getSnapshot().notice?.failed === true,
      JSON.stringify(gate.getSnapshot().notice),
    );
  }

  // The other edge of the same clock: a door that arrives before the deadline
  // opens the chat, with no error left standing — the deadline is a backstop,
  // not a new way to fail a wait that succeeds.
  {
    const gate = app.createSlotGate(1000);
    await gate.setAccess({ kind: "unready" });
    const held = gate.open("R");
    setTimeout(() => void gate.setAccess({ kind: "ready", activate }), 20);
    const result = await Promise.race([held, never()]);
    check(
      "a door that arrives before the deadline opens the chat with no error",
      result !== null && result.opened?.id === "R" && result.notice === null,
      JSON.stringify(result),
    );
    check(
      "...and the waiting sentence is down again",
      gate.getSnapshot().notice === null,
      JSON.stringify(gate.getSnapshot().notice),
    );
  }

  // C3 — what `send`, `retry` and `writeFromBrain` rely on when they reread
  // the gate instead of the render's snapshot: a snapshot object is frozen at
  // the render that took it, the gate's current one is not. (The React half —
  // that the handlers actually reread — is three `App.tsx` lines this harness
  // cannot execute; `npx tsc --noEmit` covers the compile, reading the diff
  // covers the rest.)
  {
    const gate = app.createSlotGate(1000);
    await gate.setAccess({ kind: "ready", activate });
    const render = gate.getSnapshot();
    const opening = gate.open("S");
    check(
      "a caller that rereads the gate sees the freeze the render's snapshot froze",
      gate.getSnapshot().pending === true && render.pending === false,
      `fresh=${gate.getSnapshot().pending} render=${render.pending}`,
    );
    await opening;
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? "slot-hold: all checks passed" : `slot-hold: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
