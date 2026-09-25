// The brain's one `brain_progress` subscription, driven straight through
// `subscribeBrainRead` against a fake Tauri bus whose `listen()` promises the
// test answers by hand — in StrictMode's order: mount, unmount, mount, then
// every promise resolving only after the second mount registered.
//
// What must hold, in whatever order those promises resolve: exactly one live
// subscription while a reader is mounted, and none after the last one leaves.
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

globalThis.window = {
  __TAURI__: {
    // A command that never answers: the poll is not under test here, and a
    // hanging invoke keeps `publish()` out of every assertion.
    core: { invoke: () => new Promise(() => {}) },
    event: {
      listen() {
        const call = { settled: false, live: false };
        const promise = new Promise((resolve) => {
          call.answer = () => {
            call.settled = true;
            call.live = true;
            resolve(() => {
              call.live = false;
            });
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
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log(
  failures === 0 ? "brain-progress: all checks passed" : `brain-progress: ${failures} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
