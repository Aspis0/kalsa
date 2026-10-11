// The arguments a tool call goes back with, on both roads the app builds a
// wire from: the live loop's own assistant message, and the replay of a stored
// run. Text that is not a JSON object goes as "{}" — with an object-arguments
// chat template llama-server reads the string back as JSON and answers a
// broken one with a 500. A valid object goes byte-identical.
//
// The live loop is the app's own streamChatCompletion. The engine is a stub:
// fetch answers with a tool call, then records the request that follows, which
// carries the assistant message the loop built.
//
// Pure: no server, no browser, no network.
//
// Run: node scripts/tool-arguments-wire.mjs   (from chat/)

import { rm } from "node:fs/promises";
import { loadApp } from "./lib/app-bundle.mjs";

const { dir, app } = await loadApp();
const { streamChatCompletion, buildPinnedContext, wireArguments, MAX_ARGUMENTS } = app;

let fail = 0;
function check(label, condition, detail) {
  const ok = condition ? "ok  " : "FAIL";
  if (!condition) fail++;
  console.log(`${ok} ${label}${condition || detail === undefined ? "" : `\n     ${detail}`}`);
}
function equal(label, actual, expected) {
  check(label, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}\n     want ${JSON.stringify(expected)}`);
}

// --- the engine stub ----------------------------------------------------------
// runRound arms idle timers on the window; they are cleared when a round ends.
globalThis.window = { setTimeout, clearTimeout };

const requests = [];
let replies = [];
globalThis.fetch = async (_url, init) => {
  requests.push(JSON.parse(init.body));
  const frames = replies.shift() ?? [];
  const body = [...frames, "[DONE]"]
    .map((frame) => `data: ${typeof frame === "string" ? frame : JSON.stringify(frame)}\n\n`)
    .join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
};

/** One round that asks for `web_search` with the given argument text, in one chunk. */
function callReply(argumentsText) {
  return [
    {
      choices: [
        {
          index: 0,
          finish_reason: null,
          delta: {
            tool_calls: [
              { index: 0, id: "call-a", type: "function", function: { name: "web_search", arguments: argumentsText } },
            ],
          },
        },
      ],
    },
    { choices: [{ index: 0, finish_reason: "tool_calls", delta: {} }] },
  ];
}
const WORDS = [
  { choices: [{ index: 0, finish_reason: null, delta: { content: "Done." } }] },
  { choices: [{ index: 0, finish_reason: "stop", delta: {} }] },
];
const TOOLS = [
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web.",
      parameters: { type: "object", properties: { query: { type: "string" } } },
    },
  },
];

const NOT_VALID_FOR_MODEL = "The arguments were not valid JSON. Call the tool again with a JSON object.";
const TOO_LONG = "That was too long for Kalsa to check. Try a shorter search or address.";
const BROKEN = '{"query": "unterminated';
const LONG = `{"query":"${"a".repeat(MAX_ARGUMENTS + 500)}"}`;
const SPACED = '{ "query" :  "x" }';
const NESTED = '{"query":"x","n":[1,2]}';

/** Runs one live round and returns what the second request carried. */
async function liveRound(argumentsText) {
  requests.length = 0;
  replies = [callReply(argumentsText), WORDS];
  const ran = [];
  await streamChatCompletion({
    endpoint: "http://127.0.0.1:8138",
    token: "",
    model: "m",
    messages: [{ role: "user", content: "find it" }],
    sampling: {},
    signal: new AbortController().signal,
    onToken() {},
    onReasoning() {},
    tools: TOOLS,
    runTool: async (name, args) => {
      ran.push({ name, args });
      return { text: "found", ok: true };
    },
    onToolRun() {},
  });
  const second = requests[1];
  const assistant = second?.messages.find((m) => m.role === "assistant" && m.tool_calls);
  const tool = second?.messages.find((m) => m.role === "tool");
  return {
    requests: requests.length,
    wire: assistant?.tool_calls[0].function.arguments,
    answer: tool?.content,
    ran,
  };
}

/** Replays a stored run and returns the arguments the wire carries for it. */
function replay(storedArguments) {
  const history = [
    { id: "u1", role: "user", content: "find it", createdAt: 1 },
    {
      id: "a1",
      role: "assistant",
      content: "",
      createdAt: 2,
      toolRuns: [{ id: "call-a", name: "web_search", arguments: storedArguments, result: "found", state: "ok" }],
    },
    { id: "u2", role: "user", content: "again", createdAt: 3 },
  ];
  const pinned = buildPinnedContext(history, [], null);
  if (pinned.status !== "ok") return `status ${pinned.status}`;
  const assistant = pinned.wire.find((m) => m.role === "assistant" && m.tool_calls);
  return assistant?.tool_calls[0].function.arguments;
}

// --- the helper itself ----------------------------------------------------------
equal("helper: a valid object is returned unchanged", wireArguments(SPACED), SPACED);
equal("helper: nested valid object is returned unchanged", wireArguments(NESTED), NESTED);
equal("helper: a broken object becomes {}", wireArguments(BROKEN), "{}");
equal("helper: an array becomes {}", wireArguments("[1,2]"), "{}");
equal("helper: a bare string becomes {}", wireArguments('"x"'), "{}");
equal("helper: empty text becomes {}", wireArguments(""), "{}");
equal("helper: a cut call becomes {} even when its text parses", wireArguments('{"query":"x"}', true), "{}");

// --- the live loop ----------------------------------------------------------------
const liveCases = [
  { label: "broken object", args: BROKEN, wire: "{}", ran: false, answer: NOT_VALID_FOR_MODEL },
  { label: "array", args: "[1,2]", wire: "{}", ran: false, answer: NOT_VALID_FOR_MODEL },
  { label: "bare string", args: '"x"', wire: "{}", ran: false, answer: NOT_VALID_FOR_MODEL },
  { label: "longer than the app holds", args: LONG, wire: "{}", ran: false, answer: TOO_LONG },
  { label: "empty arguments", args: "", wire: "{}", ran: true, answer: "found" },
  { label: "valid object, odd spacing", args: SPACED, wire: SPACED, ran: true, answer: "found" },
  { label: "valid nested object", args: NESTED, wire: NESTED, ran: true, answer: "found" },
];
for (const c of liveCases) {
  const got = await liveRound(c.args);
  equal(`live (${c.label}): two requests went out`, got.requests, 2);
  equal(`live (${c.label}): the wire carries ${JSON.stringify(c.wire)}`, got.wire, c.wire);
  equal(`live (${c.label}): the tool ran ${c.ran}`, got.ran.length > 0, c.ran);
  equal(`live (${c.label}): the model reads the answer`, got.answer, c.answer);
}

// --- the replay of a stored run ----------------------------------------------------
const replayCases = [
  { label: "broken object", stored: BROKEN, wire: "{}" },
  { label: "array", stored: "[1,2]", wire: "{}" },
  { label: "empty arguments", stored: "", wire: "{}" },
  // A stored run keeps at most MAX_ARGUMENTS characters, so a long one is stored cut.
  { label: "stored cut", stored: LONG.slice(0, MAX_ARGUMENTS), wire: "{}" },
  { label: "valid object, odd spacing", stored: SPACED, wire: SPACED },
  { label: "valid nested object", stored: NESTED, wire: NESTED },
];
for (const c of replayCases) {
  equal(`replay (${c.label}): the wire carries ${JSON.stringify(c.wire)}`, replay(c.stored), c.wire);
}

await rm(dir, { recursive: true, force: true });
console.log(fail === 0 ? "tool-arguments-wire: all checks passed" : `tool-arguments-wire: ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
