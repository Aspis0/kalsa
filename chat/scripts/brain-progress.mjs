// The brain's one `brain_progress` subscription, driven straight through
// `subscribeBrainRead` against a fake Tauri bus whose `listen()` promises the
// test answers by hand — in StrictMode's order: mount, unmount, mount, then
// every promise resolving only after the second mount registered.
//
// What must hold, in whatever order those promises resolve: once any pending
// registration has answered, exactly one live subscription while a reader is
// mounted — none while one is still pending — and none after the last one
// leaves. A registration that REJECTS must register again, bounded: the
// readers that arrived while it was pending returned at the guard and never
// ask on their own, so a rejection with no retry leaves them with 0.
// The defect this pins (docs/WHAT-IS-MISSING.md §17): both promises resolved
// with `listeners.size > 0`, the second overwrote `offProgress`, and the
// first unsubscribe was dropped — one dangling `brain_progress` listener per
// hot reload, dev builds only. Under the old code the first check below sees
// 2 live, the second sees 1 still live after unmount.
//
// The real `useBrain.ts` is compiled by `lib/app-bundle.mjs`, never copied —
// a JavaScript copy would test the copy. No test framework: this is the
// repo's existing harness shape (a `check` list and an exit code), and the
// only new dependency is none.
//
// Run: node scripts/brain-progress.mjs

import { rm } from "node:fs/promises";
import { loadApp } from "./lib/app-bundle.mjs";

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

/// Every `listen()` the app started, in order. A subscription is `live` from
/// the moment its promise resolves to the moment that unlisten runs — which
/// is exactly the count the defect got wrong.
const calls = [];

/// When true, `listen()` THROWS synchronously — the shape a shim whose
/// `window.__TAURI__` has `core` but no `event` has in a real window.
let syncThrow = false;

globalThis.window = {
  __TAURI__: {
    // A command that never answers: the poll is not under test here, and a
    // hanging invoke keeps `publish()` out of every assertion.
    core: { invoke: () => new Promise(() => {}) },
    event: {
      listen() {
        if (syncThrow) throw new Error("window.__TAURI__.event is missing");
        const call = { settled: false, live: false };
        const promise = new Promise((resolve, reject) => {
          call.answer = () => {
            call.settled = true;
            call.live = true;
            resolve(() => {
              call.live = false;
            });
          };
          call.fail = (error) => {
            call.settled = true;
            reject(error);
          };
        });
        calls.push(call);
        return promise;
      },
    },
  },
};

const liveCount = () => calls.filter((call) => call.live).length;
/// Lets the `listen()` resolutions already queued run; nothing here is timed.
const flush = () => new Promise((resolve) => setImmediate(resolve));

const { app, dir } = await loadApp();
try {
  const { subscribeBrainRead } = app;
  const reader = () => {};

  // StrictMode's order: the first mount's registration is still in the air
  // when its reader leaves, the second reader is mounted before either
  // promise answers, and only then does everything resolve.
  const leaveFirst = subscribeBrainRead(reader);
  leaveFirst();
  const leaveSecond = subscribeBrainRead(reader);
  for (const call of [...calls]) call.answer();
  await flush();
  check(
    "one live subscription while a reader is mounted",
    liveCount() === 1,
    `live=${liveCount()} after ${calls.length} listen() call(s) resolved`,
  );

  leaveSecond();
  await flush();
  check(
    "none left after the last reader leaves",
    liveCount() === 0,
    `live=${liveCount()}`,
  );

  // The other resolution order: the registration answers while nobody is
  // mounted. It must release itself — and must not leave up the guard that
  // would deny the next reader a subscription of its own.
  calls.length = 0;
  const leaveEarly = subscribeBrainRead(reader);
  leaveEarly();
  calls[0].answer();
  await flush();
  check(
    "a registration answering after its reader left releases itself",
    liveCount() === 0,
    `live=${liveCount()}`,
  );

  const leaveLate = subscribeBrainRead(reader);
  check(
    "a later reader starts a fresh registration",
    calls.length === 2,
    `listen() calls=${calls.length}`,
  );
  calls[1].answer();
  await flush();
  check("one live for the late reader", liveCount() === 1, `live=${liveCount()}`);
  leaveLate();
  await flush();
  check("and none after it leaves", liveCount() === 0, `live=${liveCount()}`);

  // A registration that REJECTS: its reader was already mounted while it
  // was pending, returned at the guard, and will never ask again — so the
  // rejection itself must register once more, and this reader must end
  // with one live subscription.
  calls.length = 0;
  const leaveFlaky = subscribeBrainRead(reader);
  calls[0].fail(new Error("event bus not up yet"));
  await flush();
  check(
    "a rejected registration registers again while its reader is mounted",
    calls.length === 2,
    `listen() calls=${calls.length}`,
  );
  calls[1]?.answer();
  await flush();
  check("the flaky reader ends with one live subscription", liveCount() === 1, `live=${liveCount()}`);
  leaveFlaky();
  await flush();
  check("and the flaky reader leaves none behind", liveCount() === 0, `live=${liveCount()}`);

  // The bound: a bus that ALWAYS rejects is asked a fixed number of times
  // (one start plus PROGRESS_RETRIES) and then left alone — no spin, no
  // subscription held.
  calls.length = 0;
  const leaveDown = subscribeBrainRead(reader);
  for (let i = 0; calls[i] && !calls[i].settled; i += 1) {
    calls[i].fail(new Error("always down"));
    await flush();
  }
  check(
    "a bus that always rejects stops after the bounded attempts",
    calls.length === 4,
    `listen() calls=${calls.length} (1 start + 3 retries)`,
  );
  check("and it holds no subscription", liveCount() === 0, `live=${liveCount()}`);
  leaveDown();
  await flush();
  check("the down-bus reader leaves none behind", liveCount() === 0, `live=${liveCount()}`);

  // The budget is per GENERATION: an always-reject episode must not follow
  // a reader that leaves and comes back — the next generation's ONE
  // rejection still earns its retry, and the reader must end with one live
  // subscription (no reset: this remount gets no retry and ends with 0).
  calls.length = 0;
  const leaveExhausted = subscribeBrainRead(reader);
  for (let i = 0; calls[i] && !calls[i].settled; i += 1) {
    calls[i].fail(new Error("down"));
    await flush();
  }
  check(
    "the first generation exhausts its budget",
    calls.length === 4,
    `listen() calls=${calls.length} (1 start + 3 retries)`,
  );
  leaveExhausted();
  await flush();
  calls.length = 0;
  const leaveRenewed = subscribeBrainRead(reader);
  calls[0]?.fail(new Error("one bad registration"));
  await flush();
  check(
    "the next generation's single rejection still earns a retry",
    calls.length === 2,
    `listen() calls=${calls.length}`,
  );
  calls[1]?.answer();
  await flush();
  check(
    "the remounted reader ends with one live subscription",
    liveCount() === 1,
    `live=${liveCount()}`,
  );
  leaveRenewed();
  await flush();
  check("and the remounted reader leaves none behind", liveCount() === 0, `live=${liveCount()}`);

  // A synchronous throw from `listen()` must not escape into the reader
  // (React would tear the mount down), and it must not strand the pending
  // flag either: a bus that works afterwards still has to answer with one
  // live subscription.
  calls.length = 0;
  syncThrow = true;
  let leaveThrown;
  let mountBroke = false;
  try {
    leaveThrown = subscribeBrainRead(reader);
  } catch {
    mountBroke = true;
  }
  check(
    "a synchronous throw from listen() does not take the reader down",
    !mountBroke,
    mountBroke ? "subscribeBrainRead threw" : "",
  );
  leaveThrown?.();
  await flush();
  syncThrow = false;
  const leaveWorking = subscribeBrainRead(reader);
  calls[0]?.answer();
  await flush();
  check(
    "a bus that works afterwards still gives one live subscription",
    liveCount() === 1,
    `live=${liveCount()} after ${calls.length} call(s)`,
  );
  leaveWorking?.();
  await flush();
  check("and the recovered bus leaves none behind", liveCount() === 0, `live=${liveCount()}`);
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log(
  failures === 0 ? "brain-progress: all checks passed" : `brain-progress: ${failures} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
