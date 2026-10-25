// Poll coalescing: a `brain_progress` event asks the page for a `brain_state`
// read, and the read already in flight answers every event that arrives
// during it — one trailing read, never a queue. The defect this pins,
// measured on a real first-run download (2026-10-04): the page answered
// EVERY progress event — ~510 a second on a 2.87 GB file — with an
// `invoke("brain_state")` of its own, and the renderer's private memory
// reached 13.2 GB.
//
// The fix has two halves and both are asserted: the reads collapse (an event
// batch while a read is in flight adds exactly one more read), and the step
// itself is live (an event renders without waiting on any read).
//
// The real `useBrain.ts` is compiled by `lib/app-bundle.mjs`, never copied —
// a JavaScript copy would test the copy. No test framework: this is the
// repo's existing harness shape (a `check` list and an exit code).
//
// Run: node scripts/brain-poll-coalescing.mjs

import { rm } from "node:fs/promises";
import { loadApp } from "./lib/app-bundle.mjs";

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

/// Every `invoke` the app made, in order, each waiting on an answer the test
/// gives by hand: a read stays in flight until told otherwise, which is the
/// window the coalescing has to survive.
const calls = [];
/// The live `brain_progress` handler, as `listen()` registered it.
let progressHandler = null;

globalThis.window = {
  __TAURI__: {
    core: {
      invoke(command) {
        const call = { command, settled: false };
        call.promise = new Promise((resolve) => {
          call.answer = (value) => {
            call.settled = true;
            resolve(value);
          };
        });
        calls.push(call);
        return call.promise;
      },
    },
    event: {
      listen(event, handler) {
        if (event === "brain_progress") progressHandler = handler;
        return Promise.resolve(() => {
          progressHandler = null;
        });
      },
    },
  },
};

const flush = () => new Promise((resolve) => setImmediate(resolve));
const reads = () => calls.filter((call) => call.command === "brain_state");
const inFlight = () => reads().filter((call) => !call.settled);
/// One progress event, in the envelope the real bus hands the listener.
const event = (done) =>
  progressHandler({
    event: "brain_progress",
    id: 1,
    payload: { kind: "model_bytes", done, total: 2_874_779_680 },
  });

const { app, dir } = await loadApp();
try {
  const { getBrainRead, subscribeBrainRead } = app;
  let notified = 0;
  const leave = subscribeBrainRead(() => {
    notified += 1;
  });
  await flush();
  check(
    "the first read is in flight",
    reads().length === 1 && inFlight().length === 1,
    `brain_state calls=${reads().length}`,
  );

  // A download's own rate: hundreds of events inside one read.
  for (let done = 1; done <= 300; done += 1) event(done);
  check(
    "events while a read is in flight add no read",
    reads().length === 1,
    `brain_state calls=${reads().length}`,
  );
  check(
    "the event renders without waiting for the read",
    notified === 300,
    `notifications=${notified}`,
  );
  check(
    "and the snapshot carries the step itself",
    getBrainRead().step?.done === 300,
    `step.done=${getBrainRead().step?.done}`,
  );

  reads()[0].answer({ kind: "starting" });
  await flush();
  check(
    "the whole batch earns exactly one trailing read",
    reads().length === 2,
    `brain_state calls=${reads().length}`,
  );

  event(301);
  event(302);
  await flush();
  check(
    "events during the trailing read add no read of their own",
    reads().length === 2,
    `brain_state calls=${reads().length}`,
  );
  reads()[1].answer({ kind: "starting" });
  await flush();
  check(
    "and they earn one trailing read again",
    reads().length === 3,
    `brain_state calls=${reads().length}`,
  );
  reads()[2].answer({ kind: "starting" });
  await flush();
  check(
    "with no events, the loop settles",
    reads().length === 3 && inFlight().length === 0,
    `brain_state calls=${reads().length} in flight=${inFlight().length}`,
  );

  event(303);
  await flush();
  check(
    "an event with no read in flight starts exactly one",
    reads().length === 4,
    `brain_state calls=${reads().length}`,
  );
  reads()[3].answer({ kind: "starting" });
  await flush();
  check(
    "and it leaves no trailing read behind",
    reads().length === 4,
    `brain_state calls=${reads().length}`,
  );

  leave();
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log(
  failures === 0 ? "brain-poll-coalescing: all checks passed" : `brain-poll-coalescing: ${failures} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
