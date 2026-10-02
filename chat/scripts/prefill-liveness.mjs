// A prompt that takes minutes to read is a stream that is alive, not a
// silence. The engine reports its prefill (`return_progress`); the client
// counts each report as a sign of life, allows the next batch the time it
// needs, and still gives up on a real silence.
//
// Pure: the app's own `runRound` runs against a fake clock and a fake engine
// stream, so the minutes cost nothing. Every scenario also runs under a real
// five-second limit: a run that never settles is a named FAIL, not a silent
// exit.
//
// Run: node scripts/prefill-liveness.mjs   (from chat/)

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "../node_modules/esbuild/lib/main.js";

// Only the modules under test, compiled from the app's own TypeScript (the
// shared bundle in lib/ pulls in the whole app).
const SCRIPTS_DIR = fileURLToPath(new URL(".", import.meta.url));
const dir = await mkdtemp(join(tmpdir(), "kalsa-prefill-"));
const outfile = join(dir, "app.mjs");
await build({
  stdin: {
    contents: `
      export { completionBody, IDLE_TIMEOUT_MS, createPrefillWatch } from "../src/lib/chat.ts";
      export { runRound } from "../src/lib/streamRound.ts";
    `,
    resolveDir: SCRIPTS_DIR,
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  outfile,
  loader: { ".css": "empty" },
  logLevel: "silent",
});
const app = await import(pathToFileURL(outfile).href);
const { runRound, completionBody, createPrefillWatch, IDLE_TIMEOUT_MS } = app;

let fail = 0;
function check(label, condition, detail) {
  const ok = condition ? "ok  " : "FAIL";
  if (!condition) fail++;
  console.log(`${ok} ${label}${condition || detail === undefined ? "" : `\n     ${detail}`}`);
}

// --- the fake clock ---------------------------------------------------------
let now = 0;
let nextId = 1;
const timers = new Map();
globalThis.window = {
  setTimeout(fn, ms) {
    const id = nextId++;
    timers.set(id, { at: now + ms, fn });
    return id;
  },
  clearTimeout(id) {
    timers.delete(id);
  },
};
const settle = () => new Promise((resolve) => setImmediate(resolve));
async function advance(ms) {
  const end = now + ms;
  for (;;) {
    const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
    if (!due) break;
    now = due[1].at;
    timers.delete(due[0]);
    due[1].fn();
    await settle();
  }
  now = end;
  await settle();
}

// --- the fake engine --------------------------------------------------------
const encoder = new TextEncoder();
/** Installs a fetch that answers with an event stream the test feeds by hand.
    `onAbort` says what an abort does to the body: fail the read, or close it. */
function engine(onAbort) {
  const feed = {};
  globalThis.fetch = async (_url, init) => {
    const stream = new ReadableStream({
      start(controller) {
        feed.controller = controller;
        init.signal.addEventListener("abort", () => {
          if (onAbort === "close") controller.close();
          else controller.error(new DOMException("aborted", "AbortError"));
        });
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  // Sent, then let the read loop take it before the clock moves again.
  feed.send = async (object) => {
    try {
      feed.controller.enqueue(encoder.encode(`data: ${typeof object === "string" ? object : JSON.stringify(object)}\n\n`));
    } catch {
      // The client already gave up and closed the body: the check says so.
    }
    await settle();
  };
  return feed;
}
const progress = (processed, total, timeMs) => ({
  choices: [{ index: 0, finish_reason: null, delta: { role: "assistant", content: null } }],
  prompt_progress: { total, cache: 0, processed, time_ms: timeMs },
});
const word = (content) => ({ choices: [{ index: 0, finish_reason: null, delta: { content } }] });

function start(feed) {
  const texts = [];
  const reasoning = [];
  const options = {
    endpoint: "http://127.0.0.1:8138",
    token: "",
    model: "m",
    messages: [],
    sampling: {},
    signal: new AbortController().signal,
    onToken: (text) => texts.push(text),
    onReasoning: (text) => reasoning.push(text),
  };
  const outcome = runRound(options, [], [], "auto", false).then(
    (round) => ({ round }),
    (error) => ({ error }),
  );
  return { texts, reasoning, outcome };
}

/** "done" when `run` settles inside the real time limit, "hung" when it does not. */
async function withinLimit(run, limitMs) {
  let giveUp;
  const hung = new Promise((resolve) => {
    giveUp = setTimeout(() => resolve("hung"), limitMs);
  });
  try {
    return await Promise.race([run().then(() => "done"), hung]);
  } finally {
    clearTimeout(giveUp);
  }
}

/** Runs one scenario under a real time limit; a hang or a throw is its FAIL. */
async function scenario(label, run, limitMs = 5000) {
  timers.clear();
  now = 0;
  try {
    if ((await withinLimit(run, limitMs)) === "hung") {
      check(`${label}: reached a verdict`, false, `no verdict in ${limitMs} ms of real time`);
    }
  } catch (error) {
    check(`${label}: ran`, false, String(error?.stack ?? error));
  }
}

await scenario("the request", async () => {
  check(
    "the request asks the engine for prefill progress",
    completionBody("m", [], {}).return_progress === true &&
      completionBody("m", [], {}, [{ type: "function", function: { name: "x" } }]).return_progress === true,
  );
});

await scenario("the allowance", async () => {
  const S = 1000;
  const watch = createPrefillWatch();
  check("the first report gets a generous guess", watch.report({ total: 5000, processed: 0, time_ms: 0 }) === 5 * IDLE_TIMEOUT_MS);
  check(
    "then three times the batch the engine just timed",
    watch.report({ total: 5000, processed: 2048, time_ms: 90 * S }) === 270 * S,
  );
  check("a fast batch never goes below the ordinary bound", watch.report({ total: 5000, processed: 4096, time_ms: 92 * S }) === IDLE_TIMEOUT_MS);
  check("a finished prefill is back to the ordinary bound", watch.report({ total: 5000, processed: 5000, time_ms: 93 * S }) === IDLE_TIMEOUT_MS);
  const slow = createPrefillWatch();
  slow.report({ total: 90000, processed: 0, time_ms: 0 });
  // A batch of 8192 tokens at 22 tok/s: 372 s. The allowance follows it.
  check(
    "a batch larger than any constant is covered by the pace it showed",
    slow.report({ total: 90000, processed: 8192, time_ms: 372 * S }) === 3 * 372 * S,
  );
  for (const bad of ["nope", null, undefined, {}, { total: "many", processed: 1, time_ms: 1 }]) {
    check(`an unreadable report (${JSON.stringify(bad)}) is only liveness`, createPrefillWatch().report(bad) === IDLE_TIMEOUT_MS);
  }
  for (const value of [Infinity, -Infinity, NaN]) {
    const w = createPrefillWatch();
    check(`a non-finite number (${value}) is rejected`, w.report({ total: 5000, processed: 0, time_ms: value }) === IDLE_TIMEOUT_MS);
    check(
      `a non-finite total (${value}) is rejected`,
      createPrefillWatch().report({ total: value, processed: 0, time_ms: 0 }) === IDLE_TIMEOUT_MS,
    );
  }
  const huge = createPrefillWatch();
  huge.report({ total: 10, processed: 1, time_ms: 0 });
  const bound = huge.report({ total: 10, processed: 2, time_ms: 1e300 });
  check("an absurd pace is still a usable timer", Number.isFinite(bound) && bound <= 2_147_483_647, String(bound));
});

await scenario("a slow prefill that keeps reporting", async () => {
  const feed = engine("error");
  const run = start(feed);
  await settle();
  await feed.send(progress(0, 4500, 0)); // 0 % at the start
  // The first 2048-token batch takes 90 s on this CPU: far past a minute.
  await advance(90_000);
  await feed.send(progress(2048, 4500, 90_000));
  await advance(90_000);
  await feed.send(progress(4096, 4500, 180_000));
  await advance(20_000);
  await feed.send(progress(4500, 4500, 200_000));
  await advance(5_000);
  await feed.send(word("Ciao"));
  await feed.send("[DONE]");
  const result = await run.outcome;
  check("a 3-minute prefill that reports is answered", result.round !== undefined, String(result.error?.kind));
  check("no progress report is rendered as text", JSON.stringify(run.texts) === '["Ciao"]', JSON.stringify(run.texts));
  check("nor as thinking", run.reasoning.length === 0);
});

await scenario("a batch far past the ordinary bound", async () => {
  // A huge batch the owner chose: 372 s between reports, once the pace is known.
  const feed = engine("error");
  const run = start(feed);
  await settle();
  await feed.send(progress(0, 90000, 0));
  await advance(200_000); // inside the first-gap guess
  await feed.send(progress(8192, 90000, 200_000));
  await advance(500_000); // the pace (200 s) allows 600 s
  await feed.send(progress(16384, 90000, 700_000));
  await feed.send(progress(90000, 90000, 800_000));
  await feed.send(word("ok"));
  await feed.send("[DONE]");
  const result = await run.outcome;
  check("a batch that takes minutes is waited for once the pace is known", result.round !== undefined, String(result.error?.kind));
});

await scenario("silence before any byte", async () => {
  const feed = engine("error");
  const run = start(feed);
  await settle();
  await advance(IDLE_TIMEOUT_MS + 1);
  const result = await run.outcome;
  check("no byte at all for a minute is a timeout", result.error?.kind === "timeout", String(result.error?.kind));
});

await scenario("silence after a first report", async () => {
  const feed = engine("error");
  const run = start(feed);
  await settle();
  await feed.send(progress(0, 5000, 0));
  await advance(5 * IDLE_TIMEOUT_MS - 1);
  await settle();
  check("the first gap is generous", run.texts.length === 0);
  await advance(2);
  const result = await run.outcome;
  check("a prefill that never reports again is a timeout at the guess", result.error?.kind === "timeout", String(result.error?.kind));
});

await scenario("silence after a timed batch", async () => {
  const feed = engine("error");
  const run = start(feed);
  await settle();
  await feed.send(progress(0, 5000, 0));
  await advance(10_000);
  await feed.send(progress(2048, 5000, 10_000)); // a 10 s batch: the bound stays a minute
  await advance(IDLE_TIMEOUT_MS + 1);
  const result = await run.outcome;
  check("a fast prefill that goes quiet is a timeout after a minute", result.error?.kind === "timeout", String(result.error?.kind));
});

await scenario("silence after the first word", async () => {
  const feed = engine("error");
  const run = start(feed);
  await settle();
  await feed.send(progress(0, 5000, 0));
  await advance(10_000);
  await feed.send(word("Ci"));
  await advance(IDLE_TIMEOUT_MS + 1);
  const result = await run.outcome;
  check("after the first word a minute of silence is a timeout", result.error?.kind === "timeout", String(result.error?.kind));
});

await scenario("an idle abort that closes the body", async () => {
  const feed = engine("close");
  const run = start(feed);
  await settle();
  await advance(IDLE_TIMEOUT_MS + 1);
  const result = await run.outcome;
  check(
    "an idle abort that closes the stream cleanly is a timeout, not an empty answer",
    result.error?.kind === "timeout",
    String(result.error?.kind),
  );
});

// The harness itself: a run that never settles must be called a hang.
check(
  "a scenario that never settles is reported as hung",
  (await withinLimit(() => new Promise(() => {}), 200)) === "hung",
);
check("and one that settles is not", (await withinLimit(async () => {}, 200)) === "done");

await rm(dir, { recursive: true, force: true });
console.log(fail === 0 ? "\nprefill liveness: all checks passed" : `\nprefill liveness: ${fail} check(s) FAILED`);
process.exit(fail === 0 ? 0 : 1);
