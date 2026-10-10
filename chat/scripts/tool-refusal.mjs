// The tool-refusal retry, through `streamChatCompletion` with a stubbed server:
// one retry without tools that replaces the refused answer and its reasoning;
// none after a tool has run, when no tools were offered, or when the retry is
// itself a refusal; the refused answer is put back when the retry fails; and a
// Stop ends the turn without a retry or a restore.
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

// Server-sent events for one answer: the given deltas, then the finish and [DONE].
function sse(deltas, finish = "stop") {
  const lines = deltas.map((delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
  lines.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}\n\n`, "data: [DONE]\n\n");
  return sseBody(lines);
}
function sseBody(lines, signal = null) {
  const body = new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(new TextEncoder().encode(line));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}
// A stream that never finishes, and is cut when the request's signal aborts.
function hangingStream(signal) {
  const body = new ReadableStream({
    start(controller) {
      signal.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")), { once: true });
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

// A caller's row, shaped like the app's live buffer: the same withdraw, restore and sinks.
function makeRow() {
  const row = { content: "", reasoning: "", held: null };
  const options = {
    onToken: (text) => { row.content += text; },
    onReasoning: (text) => { row.reasoning += text; },
    onWithdraw: (text, reasoning) => {
      row.held = { content: row.content, reasoning: row.reasoning };
      row.content = row.content.slice(0, row.content.length - text.length);
      row.reasoning = row.reasoning.slice(0, row.reasoning.length - reasoning.length);
    },
    onRestore: () => {
      Object.assign(row, row.held);
      row.held = null;
    },
  };
  return { row, options };
}

// Runs one turn against a scripted server. `answers` is called per request and returns a Response.
async function turn({ answers, tools = OFFER }) {
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
    });
  } catch (error) {
    thrown = error;
  } finally {
    globalThis.fetch = realFetch;
  }
  return { requests, row, events, thrown };
}

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

  // 1. The refusal with tools is replaced by the answer without them, once.
  {
    const r = await turn({ answers: (n) => (n === 0 ? refusal() : story()) });
    check("refusal with tools: asked again exactly once", r.requests.length === 2, `requests: ${r.requests.length}`);
    check("refusal with tools: the retry carries no tools and no tool_choice", !("tools" in r.requests[1]) && !("tool_choice" in r.requests[1]), JSON.stringify(Object.keys(r.requests[1])));
    check("refusal with tools: the retry carries the same messages", JSON.stringify(r.requests[1].messages) === JSON.stringify(r.requests[0].messages));
    check("refusal with tools: the row holds the answer only", r.row.content === STORY, JSON.stringify(r.row.content));
    check("refusal with tools: the refused reasoning is withdrawn", r.row.reasoning === "", JSON.stringify(r.row.reasoning));
    check("refusal with tools: one ui event, with no text", r.events.filter((c) => c === "chat.retry_without_tools").length === 1 && r.events.every((c) => /^[a-z0-9_.]+$/.test(c)), JSON.stringify(r.events));
    check("refusal with tools: no error", r.thrown === null, String(r.thrown));
  }

  // 2. A refusal after a tool has run is not asked again.
  {
    const call = () => sse([{ tool_calls: [{ index: 0, id: "c0", type: "function", function: { name: "web_search", arguments: "{}" } }] }], "tool_calls");
    const r = await turn({ answers: (n) => (n === 0 ? call() : refusal()) });
    check("refusal after a tool: no second request without tools", r.requests.length === 2 && r.requests.every((body) => "tools" in body), `requests: ${r.requests.length}`);
    check("refusal after a tool: the refusal stays in the row", r.row.content === REFUSAL, JSON.stringify(r.row.content));
  }

  // 3. A failed retry puts the refused answer and its reasoning back, with no error.
  {
    const r = await turn({ answers: (n) => (n === 0 ? refusal() : new Response("boom", { status: 500 })) });
    check("failed retry: no error reaches the caller", r.thrown === null, String(r.thrown));
    check("failed retry: the refused answer is back", r.row.content === REFUSAL, JSON.stringify(r.row.content));
    check("failed retry: the refused reasoning is back", r.row.reasoning === THOUGHT, JSON.stringify(r.row.reasoning));
  }

  // 4. A Stop during the retry ends the turn as a Stop, with no restore.
  {
    const r = await turn({
      answers: (n, controller, signal) => {
        if (n === 0) return refusal();
        queueMicrotask(() => controller.abort());
        return hangingStream(signal);
      },
    });
    check("stop during retry: the turn ends as aborted", r.thrown?.kind === "aborted", String(r.thrown?.kind ?? r.thrown));
    check("stop during retry: no restore of the refusal", r.row.content === "" && r.row.held !== null, JSON.stringify(r.row.content));
  }

  // 5. A Stop that landed before the answer ended: no withdrawal, no retry.
  {
    const controller = new AbortController();
    const realFetch = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = async () => {
      requests += 1;
      return refusal();
    };
    const { row, options } = makeRow();
    const onToken = options.onToken;
    options.onToken = (text) => {
      onToken(text);
      if (text === REFUSAL) controller.abort();
    };
    try {
      await streamChatCompletion({
        endpoint: "http://engine.test/v1", token: "", model: "test-model",
        messages: [{ role: "user", content: "Write a story." }], sampling: {}, signal: controller.signal,
        tools: OFFER, runTool: async () => ({ text: "", ok: true }), onToolRun: () => {}, ...options,
      });
    } finally {
      globalThis.fetch = realFetch;
    }
    check("stop before the retry: no second request", requests === 1, `requests: ${requests}`);
    check("stop before the retry: the refusal is untouched", row.content === REFUSAL, JSON.stringify(row.content));
  }

  // 6. A plain answer, a turn without tools, and a refusal that is itself the retry: no second request.
  {
    const plain = await turn({ answers: () => story() });
    check("plain answer: one request", plain.requests.length === 1);
    const none = await turn({ tools: [], answers: () => refusal() });
    check("no tools offered: a refusal is not asked again", none.requests.length === 1);
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
