// Live tool calling: the app's own loop, the real model, the real crate.
//
// Run (from chat/, with a llama-server up and the example binary built):
//   cargo build -p kalsa-web --example tool
//   node scripts/live-tools.mjs [scenario ...]
//
// Nothing on the tool path is faked here:
//   * `toolLoop.ts`, `streamRound.ts`, `registry.ts` and `offeredTools` are the
//     app's own modules, compiled by the shared esbuild loader;
//   * the model is whatever `llama-server` on KALSA_ENDPOINT is serving;
//   * the tool door spawns `target/debug/examples/tool`, which calls the same
//     `kalsa_web::search` / `kalsa_web::fetch` that `src-tauri/src/web.rs` wraps.
// The only thing stood in for is the Tauri bridge itself (`window.__TAURI__`),
// because a node script has no window: `invoke` shells out to that binary, and
// `brain_web_stop` kills the child. A real stopped turn is driven instead by the
// crate's own stop flag, through `--stop-after`.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadApp } from "./lib/app-bundle.mjs";

const run = promisify(execFile);
const ENDPOINT = process.env.KALSA_ENDPOINT ?? "http://127.0.0.1:8130";
const TOOL_BIN = process.env.KALSA_TOOL_BIN ?? "../target/debug/examples/tool";
const MODEL = process.env.KALSA_MODEL ?? null;

/** Every tool call of the run, in order, with what came back. */
const transcript = [];
/** Every `brain_web_stop` the registry asked for, so a stopped turn can be checked. */
const stops = [];
let stopChild = null;
let stopAfter = null;

globalThis.window = {
  setTimeout,
  clearTimeout,
  __TAURI__: {
    core: {
      invoke: async (command, args) => {
        if (command === "brain_web_stop") {
          stops.push(args?.id);
          // The real command sets the call's stop flag; a child process cannot
          // have its flag set from outside, so the closest honest stand-in is
          // to end that process. (Scenario E drives the real flag instead, with
          // `--stop-after`, and is the evidence for the cooperative stop.)
          if (stopChild) stopChild.kill("SIGTERM");
          return null;
        }
        const verb = command === "brain_web_search" ? "search" : "fetch";
        const argument = verb === "search" ? args.query : args.url;
        const argv = [verb, argument];
        if (stopAfter !== null) argv.push("--stop-after", String(stopAfter));
        const child = run(TOOL_BIN, argv, { maxBuffer: 8 * 1024 * 1024, timeout: 120000 });
        stopChild = child.child;
        let stdout = "";
        try {
          ({ stdout } = await child);
        } catch (error) {
          stdout = error.stdout ?? "";
        } finally {
          stopChild = null;
        }
        const answer = JSON.parse(stdout.trim().split("\n").pop() || "{}");
        transcript.push({ tool: verb, argument, ok: answer.ok, result: answer.text ?? answer.error });
        // The Tauri command answers a failure by rejecting with its sentence.
        if (!answer.ok) throw answer.error;
        return answer.text;
      },
    },
    event: { listen: () => Promise.resolve(() => {}) },
  },
};

const { dir, app } = await loadApp();

async function modelName() {
  if (MODEL) return MODEL;
  const listed = await (await fetch(`${ENDPOINT}/v1/models`)).json();
  return listed.models[0].name;
}

const model = await modelName();
const tools = app.offeredTools(true);
if (tools.length !== 2) {
  console.error(`offeredTools said ${tools.length} tools; the door is not being seen`);
  process.exit(2);
}

/**
 * One turn: the real loop, streaming, with the real tools.
 *
 * `sampling` starts empty on purpose: that is what the app sends when the owner
 * has not touched the sampler — `samplingWire(loadSampling())` returns `{}`.
 * Anything here would be my choice, not the app's, and a generation budget I
 * impose can look like a broken loop. (Learned the hard way: with
 * `max_tokens: 700` forced, this model spent the whole budget thinking and the
 * turn ended with no words — which the app's own defaults do not cause.)
 */
async function turn(question, { maxTokens = null, stopAfterMs = null, abortAfterMs = null } = {}) {
  transcript.length = 0;
  stops.length = 0;
  stopAfter = stopAfterMs;
  const controller = new AbortController();
  if (abortAfterMs !== null) setTimeout(() => controller.abort(), abortAfterMs);
  let answer = "";
  let thought = "";
  const runs = [];
  const started = Date.now();
  let failure = null;
  try {
    await app.streamChatCompletion({
      endpoint: ENDPOINT,
      token: "",
      model,
      messages: [{ role: "user", content: question }],
      sampling: maxTokens === null ? {} : { temperature: 0.2, max_tokens: maxTokens },
      signal: controller.signal,
      onToken: (text) => (answer += text),
      onReasoning: (text) => (thought += text),
      tools,
      runTool: app.executeToolCall,
      onToolRun: (entry) => {
        const at = runs.findIndex((existing) => existing.id === entry.id);
        if (at >= 0) runs[at] = entry;
        else runs.push(entry);
      },
    });
  } catch (error) {
    failure = `${error?.kind ?? "error"}: ${error?.message ?? String(error)}`;
  }
  return { answer, thought, runs, failure, stops: [...stops], seconds: (Date.now() - started) / 1000, calls: [...transcript] };
}

function show(name, result) {
  console.log(`\n${"=".repeat(78)}\n## ${name}  (${result.seconds.toFixed(1)}s)\n`);
  console.log("tool calls:");
  for (const call of result.calls) {
    console.log(`  - ${call.tool}(${JSON.stringify(call.argument)}) -> ${call.ok ? "ok" : "error"}`);
    const text = String(call.result ?? "");
    console.log(text.split("\n").map((line) => `      ${line}`).join("\n").slice(0, 2600));
  }
  if (result.calls.length === 0) console.log("  (none)");
  console.log(`thinking: ${result.thought.length} chars`);
  console.log(`answer: ${JSON.stringify(result.answer)}`);
  if (result.failure) console.log(`turn failure: ${result.failure}`);
  console.log(`runs: ${result.runs.map((r) => `${r.state}:${r.name}`).join(", ") || "(none)"}`);
}

/** Whether every number-ish token in the answer appears in what the tools returned. */
function answerTokens(result) {
  const toolText = result.calls.map((call) => String(call.result ?? "")).join("\n").toLowerCase();
  const tokens = [...result.answer.matchAll(/\b\d[\d.,]{1,12}\b/g)].map((m) => m[0].replace(/[.,]$/, ""));
  return tokens.map((token) => ({ token, inTool: toolText.includes(token.toLowerCase()) }));
}

let failures = 0;

/** A live check, with the exit status that makes it mean something. */
function expect(label, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

/**
 * Did the answer come from the tools, or from the model's imagination?
 * "A tool ran" and "every number in the answer was in what a tool returned" are
 * the two things a broken loop or a hallucinating model cannot satisfy, so they
 * are assertions here, not a paragraph in the log.
 */
function verdict(result, { allowEmptyAnswer = false } = {}) {
  if (result.calls.length === 0) {
    expect("a tool actually ran", false, "no tool call reached the door");
    return;
  }
  expect("a tool actually ran", true, result.calls.map((c) => c.tool).join(", "));
  if (!result.answer.trim()) {
    expect(
      "the turn ended with words",
      allowEmptyAnswer,
      "the model thought and gave no answer after the tools had answered",
    );
    return;
  }
  const tokens = answerTokens(result);
  for (const { token, inTool } of tokens) {
    console.log(`     ${inTool ? "in tool   " : "NOT IN TOOL"}  ${token}`);
  }
  const unsourced = tokens.filter((t) => !t.inTool);
  expect(
    "every number in the answer appears in what a tool returned",
    unsourced.length === 0,
    unsourced.map((t) => t.token).join(", "),
  );
}

const scenarios = {
  // A fact from after the model's training: only the search can have it.
  async rust() {
    const result = await turn(
      "What is the latest stable release of the Rust programming language, and when was it published? Search the web, then answer in one sentence with the version number and the date.",
    );
    show("A. a fact the model cannot know (latest Rust release)", result);
    verdict(result);
    const answer = result.answer;
    expect("the answer names a version", /\b\d+\.\d+(\.\d+)?\b/.test(answer), answer.slice(0, 120));
    expect("the answer's version was in the search", result.calls.some((call) => String(call.result ?? "").includes(regOf(answer))), regOf(answer));
  },

  // A number that changes daily.
  async price() {
    const result = await turn(
      "What is the price of Bitcoin in US dollars right now? Search the web for it and answer with the number and the source you used.",
    );
    show("B. a number that changes daily (Bitcoin price)", result);
    verdict(result);
  },

  // The same question with a small generation budget forced by hand: a
  // thinking-heavy model can spend it all on thinking and end the turn with no
  // words. Kept, because that failure mode is real for anyone who sets the
  // knob low — it is just not what the app's defaults do.
  async rustshort() {
    const result = await turn(
      "Search the web once for the latest stable release of the Rust programming language, then answer in one short sentence with the version number and its date.",
      { maxTokens: 700 },
    );
    show("A2. the same fact, one search, a small generation budget", result);
    // A forced 700-token budget can legitimately be spent on thinking, so this
    // one may end with no words; what must hold is that the tool ran.
    verdict(result, { allowEmptyAnswer: true });
    expect("the search ran", result.calls.some((call) => call.tool === "search"), JSON.stringify(result.calls.map((c) => c.tool)));
  },

  // Two rounds: search, then read one of the results.
  async twoRounds() {
    const result = await turn(
      "Search the web for the page announcing the latest stable Rust release, then open that page and tell me one concrete thing it says changed. Search first, then fetch, then answer in two sentences.",
    );
    show("C. two rounds: a search, then a fetch of a result", result);
    const kinds = result.calls.map((call) => call.tool).join(",");
    expect("the model searched and then opened a page, in that order", kinds === "search,fetch", kinds || "(none)");
    const searched = result.calls.find((call) => call.tool === "search");
    const opened = result.calls.find((call) => call.tool === "fetch");
    expect(
      "the page it opened was one the search returned",
      opened !== undefined && String(searched?.result ?? "").includes(String(opened.argument)),
      `${opened?.argument}`,
    );
    expect("the turn ended with words", result.answer.trim().length > 0);
  },

  // A real network failure reaching the model as a tool result.
  async failure() {
    const result = await turn(
      "Open this exact address and tell me what it says: https://192.0.2.1/ . If you cannot open it, say exactly what went wrong.",
    );
    show("D. a real failure: a routable address that never answers", result);
    const reported = String(result.calls[0]?.result ?? "");
    expect("the dead address was reported as a failure", result.calls[0]?.ok === false, reported.slice(0, 80));
    expect("the answer says it could not open the page", /cannot|could not|unable|too long/i.test(result.answer), result.answer.slice(0, 120));
  },

  // A real stop in the middle of a real fetch.
  async stopped() {
    const result = await turn(
      "Open this exact address and summarize it for me: https://httpbingo.org/drip?duration=9&numbytes=20000&delay=0",
      { stopAfterMs: 3000 },
    );
    show("E. a call stopped in flight by the crate's own stop flag", result);
    const said = String(result.calls[0]?.result ?? "");
    expect("the stopped call said it was stopped", said.includes("stopped"), said.slice(0, 80));
    expect("the turn carried on and answered", result.answer.trim().length > 0, result.answer.slice(0, 120));
  },

  // The user pressing Stop while a tool is running. Late enough that the
  // model's first round has finished and the fetch is under way.
  async aborted() {
    const result = await turn(
      "Open this exact address and summarize it for me: https://httpbingo.org/drip?duration=9&numbytes=20000&delay=0",
      { abortAfterMs: 12000 },
    );
    show("F. the user stops the turn while the tool is in flight", result);
    console.log(`stop asked for: ${JSON.stringify(result.stops)}`);
    expect("the turn ended as stopped", String(result.failure).startsWith("aborted"), String(result.failure));
    expect("the running call was named for stopping", result.stops.length > 0, JSON.stringify(result.stops));
  },

  // The owner's own question, which produced no answer at all on 2026-09-19:
  // the model wrote <tool_call> fourteen times without closing it, the stripper
  // held the lot, and the page sat on "thinking" for ever.
  async showtags() {
    const result = await turn(
      "Mostrami il formato di tool call con i tag <tool_call> che usa Qwen, dentro un blocco di codice, e poi spiegami sotto in un paragrafo cosa c'è dentro.",
      { maxTokens: 1200 },
    );
    show("H. the owner's question: show me the <tool_call> format", result);
    expect("an answer arrived at all", result.answer.trim().length > 0, `${result.answer.length} characters`);
    expect(
      "the tags the question asked for are in it",
      result.answer.includes("<tool_call>"),
      result.answer.slice(0, 160),
    );
  },

  // The round cap, if the model can be persuaded to keep searching.
  async cap() {
    const result = await turn(
      "Search the web five separate times, one search at a time, for each of these: the weather in Lisbon today, the weather in Oslo today, the weather in Lima today, the weather in Tokyo today, and the weather in Cairo today. Do them one by one.",
      { maxTokens: 1500 },
    );
    show("G. trying to reach the round cap", result);
    expect("the cap stopped the searching at four", result.calls.length === 4, String(result.calls.length));
    expect("no tool-call markup was shown to the reader", !/<tool_call|<function=|parameter=/.test(result.answer), result.answer.slice(0, 120));
  },
};

const only = process.argv.slice(2);
for (const name of only.length ? only : Object.keys(scenarios)) {
  if (!scenarios[name]) {
    console.log(`UNKNOWN SCENARIO ${name}`);
    continue;
  }
  await scenarios[name]();
}

await (await import("node:fs/promises")).rm(dir, { recursive: true, force: true });
console.log(failures === 0 ? "\nall live checks passed" : `\n${failures} live checks FAILED`);
process.exit(failures === 0 ? 0 : 1);

/** The version the answer names, for checking it came from the search. */
function regOf(answer) {
  return (answer.match(/\b\d+\.\d+(?:\.\d+)?\b/) ?? [""])[0];
}
