// A prompt that takes minutes to read is a stream that is alive, not a
// silence. The engine reports its prefill (`return_progress`); the client
// counts each report as a sign of life, allows the next batch the time it
// needs, and still gives up on a real silence.
//
// Pure: the app's own `runRound` runs against a fake clock and a fake engine
// stream, so the minutes cost nothing.
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
      export { completionBody, IDLE_TIMEOUT_MS, PREFILL_IDLE_MAX_MS, prefillAllowance } from "../src/lib/chat.ts";
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
const { runRound, completionBody, prefillAllowance, IDLE_TIMEOUT_MS, PREFILL_IDLE_MAX_MS } = app;

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
const progress = (processed, total) => ({
  choices: [{ index: 0, finish_reason: null, delta: { role: "assistant", content: null } }],
  prompt_progress: { total, cache: 0, processed, time_ms: 1 },
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

// 1. The wire asks for the reports.
check(
  "the request asks the engine for prefill progress",
  completionBody("m", [], {}).return_progress === true &&
    completionBody("m", [], {}, [{ type: "function", function: { name: "x" } }]).return_progress === true,
);

// 2. The allowance: the next batch at the slowest rate worth waiting for.
check("a short prompt keeps the one-minute rule", prefillAllowance({ total: 300, processed: 0 }) === IDLE_TIMEOUT_MS);
const full = prefillAllowance({ total: 5000, processed: 0 });
check("a full batch gets the minutes it needs", full > IDLE_TIMEOUT_MS && full <= PREFILL_IDLE_MAX_MS, `got ${full}`);
check("a finished prefill is back to the ordinary bound", prefillAllowance({ total: 5000, processed: 5000 }) === IDLE_TIMEOUT_MS);
check("an unreadable report is no more than liveness", prefillAllowance("nope") === IDLE_TIMEOUT_MS);

// 3. A slow prefill that keeps reporting is answered, and no report becomes text.
{
  const feed = engine("error");
  const run = start(feed);
  await settle();
  await feed.send(progress(0, 4500)); // 0 % at the start
  // The first 2048-token batch takes 90 s on this CPU: far past a minute.
  await advance(90_000);
  await feed.send(progress(2048, 4500));
  await advance(90_000);
  await feed.send(progress(4096, 4500));
  await advance(20_000);
  await feed.send(progress(4500, 4500));
  await advance(5_000);
  await feed.send(word("Ciao"));
  await feed.send("[DONE]");
  const result = await run.outcome;
  check("a 3-minute prefill that reports is answered", result.round !== undefined, String(result.error?.kind));
  check("no progress report is rendered as text", JSON.stringify(run.texts) === '["Ciao"]', JSON.stringify(run.texts));
  check("nor as thinking", run.reasoning.length === 0);
}

// 4. A real silence is still a timeout — before the first report and after it.
{
  const feed = engine("error");
  const run = start(feed);
  await settle();
  await advance(IDLE_TIMEOUT_MS + 1);
  const result = await run.outcome;
  check("no byte at all for a minute is a timeout", result.error?.kind === "timeout", String(result.error?.kind));
}
{
  const feed = engine("error");
  const run = start(feed);
  await settle();
  await feed.send(progress(0, 100)); // a short prompt: the ordinary bound
  await advance(IDLE_TIMEOUT_MS + 1);
  const result = await run.outcome;
  check("a report, then a minute of nothing, is a timeout", result.error?.kind === "timeout", String(result.error?.kind));
}
{
  const feed = engine("error");
  const run = start(feed);
  await settle();
  await feed.send(progress(0, 5000));
  await advance(PREFILL_IDLE_MAX_MS + 1);
  const result = await run.outcome;
  check("a prefill that stops reporting is a timeout at the cap", result.error?.kind === "timeout", String(result.error?.kind));
}

// 5. Once the words flow, the ordinary bound is back.
{
  const feed = engine("error");
  const run = start(feed);
  await settle();
  await feed.send(progress(0, 5000));
  await advance(10_000);
  await feed.send(word("Ci"));
  await advance(IDLE_TIMEOUT_MS + 1);
  const result = await run.outcome;
  check("after the first word a minute of silence is a timeout", result.error?.kind === "timeout", String(result.error?.kind));
}

// 6. The idle abort that closes the body instead of failing the read.
{
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
}

await rm(dir, { recursive: true, force: true });
console.log(fail === 0 ? "\nprefill liveness: all checks passed" : `\nprefill liveness: ${fail} check(s) FAILED`);
process.exit(fail === 0 ? 0 : 1);
