// The tool-refusal retry, through `streamChatCompletion` with a stubbed server.
// The opening of a turn that offered tools is held until it is known whether it
// is a refusal: a refusal is never shown, and a normal answer is shown once its
// first sentence has ended. A refusal is asked again once without tools, and its
// reasoning is withdrawn. A retry that fails keeps what it streamed and reports
// its failure; a Stop ends the turn as a Stop. No retry after a tool has run, when
// no tools were offered, or when the retry is itself a refusal.
//
// Run: node scripts/tool-refusal.mjs   (from chat/)

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "../node_modules/esbuild/lib/main.js";

const REFUSAL = "I'm sorry, but I don't have the ability to write stories.";
const STORY = "The lighthouse stood alone on the rock. Every night its beam swept the water.";
const THOUGHT = "The request needs a tool I lack.";
const OFFER = [{ type: "function", function: { name: "web_search", description: "Search the web.", parameters: { type: "object", properties: {} } } }];

let fail = 0;
function check(label, condition, detail) {
  if (!condition) fail++;
  console.log(`${condition ? "ok  " : "FAIL"} ${label}${condition || detail === undefined ? "" : `\n     ${detail}`}`);
}

const encoder = new TextEncoder();
function eventLines(deltas, finish = "stop") {
  const lines = deltas.map((delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
  lines.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}\n\n`, "data: [DONE]\n\n");
  return lines;
}
function streamed(body) {
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}
// Server-sent events for one answer: the given deltas, then the finish and [DONE].
function sse(deltas, finish = "stop") {
  const lines = eventLines(deltas, finish);
  return streamed(new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  }));
}
// Some of an answer, then the socket is reset before its end.
function cutSse(deltas) {
  const lines = deltas.map((delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
  return streamed(new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      setTimeout(() => controller.error(new TypeError("socket reset")), 5);
    },
  }));
}
// A stream that never finishes, and is cut when the request's signal aborts.
function hangingStream(signal) {
  return streamed(new ReadableStream({
    start(controller) {
      signal.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")), { once: true });
    },
  }));
}

// A caller's row, shaped like the app's live buffer, and every chunk it was shown.
function makeRow() {
  const row = { content: "", reasoning: "", published: [], reasoningPublished: [] };
  const options = {
    onToken: (text) => {
      row.published.push(text);
      row.content += text;
    },
    onReasoning: (text) => {
      row.reasoningPublished.push(text);
      row.reasoning += text;
    },
    onWithdraw: (reasoning) => {
      row.reasoning = row.reasoning.slice(0, row.reasoning.length - reasoning.length);
    },
  };
  return { row, options };
}

// Runs one turn against a scripted server. `answers(n, controller, signal)` returns the Response for request n.
async function turn({ answers, tools = OFFER, options: extra = () => ({}) }) {
  const requests = [];
  const controller = new AbortController();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    requests.push(JSON.parse(init.body));
    return answers(requests.length - 1, controller, init.signal);
  };
  const events = [];
  globalThis.__TAURI__ = { core: { invoke: async (command, args) => { if (command === "brain_log_event") events.push(args.code); return null; } } };
  const { row, options } = makeRow();
  let thrown = null;
  try {
    await streamChatCompletion({
      endpoint: "http://engine.test/v1",
      token: "",
      model: "test-model",
      messages: [{ role: "system", content: "You are Kalsa." }, { role: "user", content: "Write a story about a lighthouse." }],
      sampling: {},
      signal: controller.signal,
      tools,
      runTool: async () => ({ text: "search result", ok: true }),
      onToolRun: () => {},
      ...options,
      ...extra(controller),
    });
  } catch (error) {
    thrown = error;
  } finally {
    globalThis.fetch = realFetch;
  }
  return { requests, row, events, thrown, controller };
}

const publishedRefusal = (row) => row.published.some((text) => text.includes("I'm sorry"));

let dir = null;
let streamChatCompletion;
try {
  dir = await mkdtemp(join(tmpdir(), "kalsa-tool-refusal-"));
  const outfile = join(dir, "toolLoop.mjs");
  await build({
    entryPoints: [fileURLToPath(new URL("../src/lib/toolLoop.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    outfile,
    logLevel: "silent",
  });
  // The loop reads `window` for its timers and the desktop bridge; in Node the global object plays that part.
  globalThis.window = globalThis;
  ({ streamChatCompletion } = await import(pathToFileURL(outfile).href));

  const refusal = () => sse([{ reasoning_content: THOUGHT }, { content: REFUSAL }]);
  const story = () => sse([{ content: STORY }]);

  // 1. A refusal with tools is never shown; the retry without tools is the answer, once.
  {
    const r = await turn({ answers: (n) => (n === 0 ? refusal() : story()) });
    check("refusal with tools: asked again exactly once", r.requests.length === 2, `requests: ${r.requests.length}`);
    check("refusal with tools: the retry carries no tools and no tool_choice", !("tools" in r.requests[1]) && !("tool_choice" in r.requests[1]), JSON.stringify(Object.keys(r.requests[1])));
    check("refusal with tools: the retry carries the same messages", JSON.stringify(r.requests[1].messages) === JSON.stringify(r.requests[0].messages));
    check("refusal with tools: the refusal text is never published", !publishedRefusal(r.row), JSON.stringify(r.row.published));
    check("refusal with tools: the refused reasoning was shown, then withdrawn", r.row.reasoningPublished.includes(THOUGHT) && r.row.reasoning === "", JSON.stringify(r.row.reasoning));
    check("refusal with tools: the row holds the answer only", r.row.content === STORY, JSON.stringify(r.row.content));
    check("refusal with tools: one ui event, with no text", r.events.filter((c) => c === "chat.retry_without_tools").length === 1 && r.events.every((c) => /^[a-z0-9_.]+$/.test(c)), JSON.stringify(r.events));
    check("refusal with tools: no error", r.thrown === null, String(r.thrown));
  }

  // 2. A refusal after a tool has run is not asked again, and is shown as it streams.
  {
    const call = () => sse([{ tool_calls: [{ index: 0, id: "c0", type: "function", function: { name: "web_search", arguments: "{}" } }] }], "tool_calls");
    const r = await turn({ answers: (n) => (n === 0 ? call() : refusal()) });
    check("refusal after a tool: no second request without tools", r.requests.length === 2 && r.requests.every((body) => "tools" in body), `requests: ${r.requests.length}`);
    check("refusal after a tool: the refusal stays in the row", r.row.content === REFUSAL, JSON.stringify(r.row.content));
  }

  // 3. A normal answer is shown from the end of its first sentence, with nothing lost.
  {
    const r = await turn({ answers: () => sse([{ content: "Here is the list" }, { content: ". First item." }, { content: " Second item." }]) });
    check("normal answer: held through its first sentence, then shown", JSON.stringify(r.row.published) === JSON.stringify(["Here is the list. First item.", " Second item."]), JSON.stringify(r.row.published));
    check("normal answer: one request", r.requests.length === 1);
  }

  // 4. An opening too long to be a refusal is shown without waiting for a sentence end.
  {
    const long = Array.from({ length: 85 }, (_, i) => `word${i}`).join(" ");
    const r = await turn({ answers: () => sse([{ content: long }]) });
    check("long opening: shown at once, past the refusal length", r.row.published[0] === long, JSON.stringify(r.row.published.map((t) => t.length)));
  }

  // 5. A retry that dies mid-answer keeps what it streamed and reports the failure, as any turn does.
  {
    const r = await turn({ answers: (n) => (n === 0 ? refusal() : cutSse([{ content: "The lighthouse stood" }])) });
    check("retry dies mid-answer: its failure reaches the caller", r.thrown?.kind === "truncated", String(r.thrown?.kind ?? r.thrown));
    check("retry dies mid-answer: its partial text stays", r.row.content === "The lighthouse stood", JSON.stringify(r.row.content));
    check("retry dies mid-answer: the refusal is not back", !publishedRefusal(r.row));
  }

  // 6. A retry that answers nothing fails with no refusal in the row.
  {
    const r = await turn({ answers: (n) => (n === 0 ? refusal() : new Response("boom", { status: 500 })) });
    check("retry with no answer: the failure reaches the caller", r.thrown?.kind === "http", String(r.thrown?.kind ?? r.thrown));
    check("retry with no answer: the row is empty, the refusal is not back", r.row.content === "" && r.row.reasoning === "", JSON.stringify(r.row));
  }

  // 7. A Stop during the retry ends the turn as a Stop; the refusal does not come back.
  {
    const r = await turn({
      answers: (n, controller, signal) => {
        if (n === 0) return refusal();
        queueMicrotask(() => controller.abort());
        return hangingStream(signal);
      },
    });
    check("stop during retry: the turn ends as aborted", r.thrown?.kind === "aborted", String(r.thrown?.kind ?? r.thrown));
    check("stop during retry: the refusal is not in the row", r.row.content === "" && !publishedRefusal(r.row), JSON.stringify(r.row.content));
  }

  // 8. A Stop that landed during the first answer: no retry, and the answer is shown as it was.
  {
    const r = await turn({
      answers: () => refusal(),
      options: (controller) => ({ onReasoning: () => controller.abort() }),
    });
    check("stop before the retry: no second request", r.requests.length === 1, `requests: ${r.requests.length}`);
    check("stop before the retry: the answer is shown as it was", r.row.content === REFUSAL, JSON.stringify(r.row.content));
  }

  // 9. A turn without tools streams a refusal as it always did, and is never asked again.
  {
    const none = await turn({ tools: [], answers: () => refusal() });
    check("no tools offered: a refusal is not asked again", none.requests.length === 1);
    check("no tools offered: the refusal streams unheld", none.row.published.join("") === REFUSAL);
  }

  // 10. A refusal on the retry is not asked again.
  {
    const twice = await turn({ answers: () => refusal() });
    check("a refusal on the retry is not asked again", twice.requests.length === 2, `requests: ${twice.requests.length}`);
  }
} finally {
  delete globalThis.__TAURI__;
  if (dir) await rm(dir, { recursive: true, force: true });
}

if (fail > 0) {
  console.log(`\n${fail} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
