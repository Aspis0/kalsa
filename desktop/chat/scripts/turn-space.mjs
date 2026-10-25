// The turn that ran out of room.
//
// On 21 October 2026 a browser turn read the same page sixteen times: the
// wire grew from 1400 tokens to 63828, the engine refused the next request
// with a 400, and the turn died there — a thought cut in half, no answer, and
// a sentence that blamed the person's files for weight that was never theirs.
//
// This harness is pure: no engine, no network, no browser. The transport is a
// mock that counts the prompt the way this model counts it and refuses what
// does not fit, the way llama.cpp refuses it.
//
// **The mock's density is not uniform, and that is the point.** Prose is four
// characters to a token and a page's own text is 1.76 — the rate the engine's
// own count gave on the day (a snapshot of 6000 characters weighed 3409
// tokens). One rate for everything cannot show the defect the turn died of:
// the density of the prompt *before* the page landed was the density of
// prose, and the page then arrived at a rate nobody had measured. The turn
// that stopped early did so because the average density of the prompt was
// read as the density of what came after it.
//
// Run: node scripts/turn-space.mjs   (from chat/)

import { rm } from "node:fs/promises";
import { loadApp } from "./lib/app-bundle.mjs";

const { app } = await loadApp();
const {
  streamChatCompletion,
  wireSize,
  systemPrompt,
  buildPinnedContext,
  definitionsTokens,
  denseTokens,
  ANSWER_RESERVE_TOKENS,
  BROWSER_TOOLS,
  WEB_TOOLS,
  FINAL_STATUS,
  TABLES,
} = app;

// The app is a webview: the round's timeouts and the door's calls live on
// `window`. Outside it there is nothing to call, which is what the harness
// wants — the transport is the mock below and nothing else.
globalThis.window = {
  setTimeout,
  clearTimeout,
  addEventListener: () => {},
  __TAURI__: { core: { invoke: async () => null } },
};

let failures = 0;
function check(ok, label, detail = "") {
  if (ok) {
    console.log(`  ok  ${label}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
}
function equal(actual, expected, label) {
  check(actual === expected, label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ---------------------------------------------------------------- the model

/** The window the engine works in. */
const LIMIT = 65536;
/** What the app keeps back for the answer. */
/** What the app keeps back: the room the answer has to write in. */
const RESERVE = ANSWER_RESERVE_TOKENS;
const BUDGET = LIMIT - RESERVE;

/**
 * The density this model really has — **two of them, because the content is
 * not one thing.**
 *
 * The house rule is four characters to a token, and it is right for prose: a
 * conversation, a question, an answer. A page body is not prose: the 21
 * October 2026 turn grew by about 3400 tokens for every 6000 characters a
 * snapshot carried — 1.76 characters to a token. The tool definitions are
 * the same kind of thing: JSON with English descriptions in it, and the
 * engine counted the five browser tools' 2755 characters at 1566 tokens.
 *
 * That gap is the whole defect: the app's estimate said 25000 where the
 * engine counted 63828.
 */
const PROSE_CHARS_PER_TOKEN = 4;
const DENSE_CHARS_PER_TOKEN = 1.76;
/** What the chat template adds around each message. */
const MESSAGE_OVERHEAD = 8;

/** What the mock engine counts for one wire. */
function engineTokens(messages, tools) {
  let prose = 0;
  let dense = 0;
  for (const message of messages) {
    const body =
      typeof message.content === "string"
        ? message.content
        : Array.isArray(message.content)
          ? message.content.map((part) => part.text ?? "").join("")
          : "";
    // A tool result is a page's own text: the dense half. Everything else is
    // the conversation: the prose half.
    if (message.role === "tool") dense += body.length;
    else prose += body.length;
    for (const call of message.tool_calls ?? []) prose += call.function.arguments.length;
    prose += MESSAGE_OVERHEAD;
  }
  // The tool definitions travel with every request and are part of the
  // prompt. The engine counts them as it counts a page.
  if (tools !== undefined) dense += JSON.stringify(tools).length;
  return Math.ceil(prose / PROSE_CHARS_PER_TOKEN + dense / DENSE_CHARS_PER_TOKEN);
}

/**
 * What the engine's prompt is, as far as its prefix cache is concerned: the
 * wire the chat template renders, in order, with the tool definitions in
 * front of it.
 *
 * **The engine keeps the prefix of the previous prompt only when the new
 * prompt extends it** — when the text it has already read is the beginning
 * of the text it is asked now. That is what the engine does, measured on it
 * (dev/lab-real/append-vs-insert.mjs, dev/lab-real/closing-before-after.mjs,
 * and the turn of 21 October 2026 where the closing request came back with
 * `cache 0`): a request that changes a part of the prompt the engine had
 * read is answered by a full re-read of the thread — 205 seconds for 62558
 * tokens, where the same request with the status appended reuses 56036 of
 * 56084 tokens in 0.58 seconds.
 *
 * The model below is the shape of that rule, not a token-exact one: it counts
 * characters where the engine counts tokens, and it gives back the whole
 * prefix where the engine gives back all but the generation prompt it renders
 * again. What it has to get right is the shape — a change in what the engine
 * has read costs everything, an addition at the end costs nothing — and that
 * is what the negative control below is about.
 */
function promptText(body) {
  let text = body.tools === undefined ? "" : JSON.stringify(body.tools);
  for (const message of body.messages) {
    text += `\n${message.role}\n`;
    const content = typeof message.content === "string" ? message.content : "";
    if (message.role === "tool") {
      // The template wraps a tool result in markers of its own, and they
      // close after the result's own text: a change inside the result moves
      // them, and the text the engine had read is no longer the beginning of
      // the text it is asked now.
      text += `<tool_response>\n${content}\n</tool_response>`;
    } else {
      text += content;
    }
    for (const call of message.tool_calls ?? []) {
      text += `\n${call.function.name}\n${call.function.arguments}`;
    }
  }
  return text;
}

// ------------------------------------------------------------- the transport

/**
 * A mock engine.
 *
 * `reports` says whether it answers with the prompt's own size, the way a
 * real engine does with `return_progress`. A mock that stays silent is the
 * app of before this fix: it had nothing but its own estimate to go by.
 * `reportTotal` overrides the number it reports — a broken report is what
 * the `total: 0` case is about.
 *
 * `calls` is the list of tools the model asks for, one per round; when the
 * wire already carries that many results, the model answers in words. A call
 * may also be written as `{name, arguments}`: the tool's own arguments are
 * what the turn's record is counted from, and a mock that always wrote
 * `{page: n}` would have no address to count.
 *
 * `answerTokens` is the size of the answer the engine writes, in tokens: the
 * engine writes what fits in the room the prompt left and ends the round
 * there, the way the cell of 21 October 2026 came back with its words cut at
 * `n_tokens = 65535`.
 */
/**
 * What the engine would have reused between two bodies: the prefix of the
 * prompt it read last, and nothing at all when the new prompt changed any of
 * it.
 */
function engineCache(previous, next) {
  if (previous === null) return 0;
  const before = promptText(previous);
  const after = promptText(next);
  return after.startsWith(before) ? before.length : 0;
}

function mockEngine({ bodyChars, reports, calls = [], limit = LIMIT, reportTotal = null, answerTokens = null }) {
  const requests = [];
  const caches = [];
  let refused = 0;
  let previousBody = null;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    const tokens = engineTokens(body.messages, body.tools);
    if (tokens > limit) {
      refused += 1;
      return new Response(
        JSON.stringify({
          error: {
            message: `the request exceeds the available context size (${tokens} > ${limit} tokens)`,
            type: "exceed_context_size_error",
            code: 400,
          },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    // What the engine would have reused: the prefix of the prompt it read
    // last — and nothing at all when this prompt changed any of it.
    const cache = engineCache(previousBody, body);
    previousBody = body;
    caches.push(cache);
    const frames = [];
    if (reports) {
      frames.push({
        prompt_progress: {
          total: reportTotal === null ? tokens : reportTotal,
          cache,
          processed: tokens,
          time_ms: 1,
        },
      });
    }
    // How many rounds have passed: the results already on the wire are one
    // per round that called a tool.
    const done = body.messages.filter((message) => message.role === "tool").length;
    if (body.tool_choice !== "none" && done < calls.length) {
      const call = calls[done];
      const name = typeof call === "string" ? call : call.name;
      const args = typeof call === "string" ? { page: done + 1 } : call.arguments;
      frames.push({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: `call-${requests.length}`,
                  type: "function",
                  function: { name, arguments: JSON.stringify(args) },
                },
              ],
            },
          },
        ],
      });
      frames.push({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
    } else {
      // **The answer, cut where the window ends.** The room the prompt left is
      // what the engine may write in, and a turn that asks for more than that
      // comes back with its words cut short.
      const room = limit - engineTokens(body.messages, body.tools);
      const said = answerTokens === null ? "Ecco cosa ho trovato." : "z".repeat(4 * answerTokens);
      const cut = Math.max(0, Math.min(said.length, 4 * room));
      frames.push({ choices: [{ index: 0, delta: { content: said.slice(0, cut) } }] });
      frames.push({ choices: [{ index: 0, delta: {}, finish_reason: cut < said.length ? "length" : "stop" }] });
    }
    const text = `${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("")}data: [DONE]\n\n`;
    return new Response(text, { headers: { "Content-Type": "text/event-stream" } });
  };
  return { requests, caches, refusedCount: () => refused };
}

// ----------------------------------------------------------------- the turn

const system = systemPrompt(false, false);
const user = { role: "user", content: "Leggi la pagina e dimmi cosa c'è." };

/**
 * Runs one turn against the mock and says what happened.
 *
 * `definitions` is what the tool definitions weigh in the fit's own
 * accounting: the number the caller that fitted the first wire used. It is a
 * parameter so that the negative control can turn it off — the accounting
 * of the code before this fix.
 */
async function runTurn(
  engine,
  {
    budget = BUDGET,
    bodyChars,
    tools = BROWSER_TOOLS,
    definitions = definitionsTokens(BROWSER_TOOLS),
    messages = [system, user],
    limit = LIMIT,
    /** The app this turn runs on: the negative control runs the same case on a
     * second build, with one rule compiled out of it. */
    bundle = app,
  } = {},
) {
  const answer = [];
  const runs = [];
  let closedForSpace = false;
  let failure = null;
  try {
    await bundle.streamChatCompletion({
      endpoint: "http://127.0.0.1:8130/v1/chat/completions",
      messages,
      tools,
      token: "",
      model: "test-model",
      sampling: { temperature: 0.2 },
      signal: new AbortController().signal,
      runTool: async () => ({ text: "z".repeat(bodyChars), ok: true }),
      contextFit: { budget, size: bundle.wireSize, definitions },
      onToken: (text) => answer.push(text),
      onToolRun: (run) => runs.push(run),
      onClosedForSpace: () => {
        closedForSpace = true;
      },
    });
  } catch (error) {
    failure = error;
  }
  return {
    answer: answer.join(""),
    runs: new Set(runs.map((run) => run.id)).size,
    closedForSpace,
    failure,
  };
}

console.log("The turn that ran out of room: the engine's count, the graceful close, the honest line.\n");

// ---------------------------------------------------------------------------
console.log("1. a dense page after a light prompt: the turn closes before the window, and nothing goes over it");

// The shape of the real case: a light prompt, and a page of 6000 characters
// (the engine counted that at 3409 tokens).
const PAGE = 6000;
const firstPrompt = engineTokens([system, user], BROWSER_TOOLS);
const perPage = denseTokens(PAGE);
// **What a page costs the engine, as the engine counts it.** The app weighs a
// page by the pessimistic rule and the engine by its own: the two are not the
// same number, and the pages the window allows are the ones the engine read.
const pageCost =
  engineTokens(
    [
      system,
      user,
      {
        role: "assistant",
        content: "",
        tool_calls: [{ function: { name: "browser_read", arguments: JSON.stringify({ page: 1 }) } }],
      },
      { role: "tool", content: "z".repeat(PAGE) },
    ],
    BROWSER_TOOLS,
  ) - firstPrompt;
// How many pages the window can carry: the budget less what the first prompt
// weighed, over what a page weighs — and one page more, because the read
// happens in the round that is still inside the window and the turn only
// finds out that the next one is not.
const expectedReads = Math.floor((BUDGET - firstPrompt) / pageCost) + 1;
console.log(
  `   the shape: the first prompt weighs ${firstPrompt} tokens, a page weighs ${pageCost} to the engine (${perPage} by the app's own pessimistic rule), so ${expectedReads} pages fit in ${BUDGET}`,
);

const engine = mockEngine({ bodyChars: PAGE, reports: true, calls: Array(expectedReads + 4).fill("browser_read") });
const turn = await runTurn(engine, { bodyChars: PAGE });

equal(turn.failure, null, "the turn did not die");
check(turn.answer.length > 0, "the person got an answer", `answer was ${JSON.stringify(turn.answer)}`);
equal(engine.refusedCount(), 0, "the engine never refused a request");

const overLimit = engine.requests.filter(
  (request) => engineTokens(request.messages, request.tools) > LIMIT,
);
equal(overLimit.length, 0, "no request was sent over the window");
equal(turn.runs, expectedReads, "the turn read every page the window allowed, and no more");
equal(turn.closedForSpace, true, "the turn says it was closed for space");

// The estimates the app weighs itself, round by round: they stay under the
// window long after the engine is over it — that is the hole the turn fell
// into, and the pessimistic rule for the tool results is what closes it.
const estimates = engine.requests.map((request) => wireSize(request.messages));
const grows = estimates.every((value, index) => index === 0 || value > estimates[index - 1]);
check(grows, "the estimate grows with every result the turn adds");
check(
  estimates[estimates.length - 1] < BUDGET,
  "the estimate still says the wire fits — this is the hole the turn fell into",
  `estimate ${estimates[estimates.length - 1]}, budget ${BUDGET}`,
);
const lastTrue = engineTokens(
  engine.requests[engine.requests.length - 1].messages,
  engine.requests[engine.requests.length - 1].tools,
);
check(
  lastTrue > estimates[estimates.length - 1],
  "the engine counted the wire far above the estimate",
  `engine ${lastTrue}, estimate ${estimates[estimates.length - 1]}`,
);

// The closing round: no calls, and the wire the engine had already read.
const closing = engine.requests[engine.requests.length - 1];
const beforeClosing = engine.requests[engine.requests.length - 2];
equal(closing.tool_choice, "none", "the closing round forbids the calls");
equal(
  closing.messages.length,
  beforeClosing.messages.length + 1,
  "the closing round carries the wire the engine read, and one message more",
);
const statusCarried = closing.messages[closing.messages.length - 1].content.includes(FINAL_STATUS);
check(statusCarried, "the closing round carries the execution status");
equal(
  closing.messages[closing.messages.length - 1].role,
  "user",
  "and the status is a message of its own, at the end of the wire",
);
const keptEverything = beforeClosing.messages.every((message, index) => {
  const after = closing.messages[index];
  return JSON.stringify(message) === JSON.stringify(after);
});
check(
  keptEverything,
  "the closing round rewrites nothing the engine had read — the status is added, not folded in",
);
equal(
  JSON.stringify(closing.tools),
  JSON.stringify(beforeClosing.tools),
  "and it offers the same tools",
);
equal(
  JSON.stringify({ ...closing, messages: undefined, tool_choice: undefined }),
  JSON.stringify({ ...beforeClosing, messages: undefined, tool_choice: undefined }),
  "and the same sampling and the same template kwargs: the tool_choice is the only difference",
);

// **The prefix the engine keeps.** The closing request asks the engine to
// read the thread it has already read, plus one sentence at the end. The
// engine reuses the prefix of a prompt it has read when the new prompt
// extends it, and reads the whole thread again when it does not: that is
// what the turn of 21 October 2026 paid for, 205 seconds of prefill and an
// answer that arrived after the door had stopped waiting.
check(
  engine.caches[engine.caches.length - 1] > 0,
  "the closing request keeps the prefix the engine had read",
  `cache ${engine.caches[engine.caches.length - 1]}`,
);
check(
  engine.caches[engine.caches.length - 1] === promptText(beforeClosing).length,
  "and keeps all of it: the wire it gets is the wire it had",
);
check(
  engineTokens(closing.messages, closing.tools) <= LIMIT,
  "the closing round fits the window",
  `${engineTokens(closing.messages, closing.tools)} tokens`,
);

// ---------------------------------------------------------------------------
console.log("\n2. the negative control: without the definitions in the accounting the turn stops early");

// The definitions travel with every request and the engine counts them into
// the prompt. Leave them out of the fit's own accounting and the ratio
// between the engine's count and the app's estimate reads their weight as
// the conversation's density: the turn stops thousands of tokens early, and
// the check above — "the turn read every page the window allowed" — fails.
//
// This is the accounting of the code before this fix, run on purpose. The
// window is small here, so the definitions are a large share of it: with
// them the turn reads two pages, without them it stops after the first.
const SMALL_WINDOW = 8192;
const SMALL_BUDGET = SMALL_WINDOW - RESERVE;
const twoReads = await runTurn(
  mockEngine({ bodyChars: PAGE, reports: true, calls: ["browser_read", "browser_read"], limit: SMALL_WINDOW }),
  { bodyChars: PAGE, budget: SMALL_BUDGET, limit: SMALL_WINDOW },
);
equal(twoReads.runs, 2, "with the definitions in the accounting the turn reads the two pages the window allows");
equal(twoReads.closedForSpace, true, "and then it closes for space");

const blindEngine = mockEngine({ bodyChars: PAGE, reports: true, calls: ["browser_read", "browser_read"], limit: SMALL_WINDOW });
const blindTurn = await runTurn(blindEngine, {
  bodyChars: PAGE,
  budget: SMALL_BUDGET,
  definitions: 0,
  limit: SMALL_WINDOW,
});
check(
  blindTurn.runs < twoReads.runs,
  "without the definitions' weight the stop starts early — the check above would fail",
  `${blindTurn.runs} reads instead of ${twoReads.runs}`,
);
check(blindTurn.closedForSpace, "and it closes for space rather than reading on");
equal(blindEngine.refusedCount(), 0, "the early stop is still a graceful one: the engine refuses nothing");

// ---------------------------------------------------------------------------
console.log("\n3. the first body is checked too: the definitions travel with it");

// A small window, so the definitions are a large share of it: the five
// browser tools alone are 1566 tokens of a 1900-token window.
const SMALL = 1900;
const SMALL_FIT = SMALL - RESERVE;
const smallEngine = mockEngine({
  bodyChars: PAGE,
  reports: true,
  calls: ["browser_read"],
  limit: SMALL,
});
const smallTurn = await runTurn(smallEngine, {
  bodyChars: PAGE,
  budget: SMALL_FIT,
  limit: SMALL,
});
equal(smallEngine.refusedCount(), 0, "the engine never refused: the body did not go out");
equal(smallEngine.requests.length, 0, "and no request went out at all");
check(smallTurn.failure !== null, "the turn refuses the send instead of dying on a 400");
equal(smallTurn.failure?.kind, "oversize", "and it refuses for size, in the app's own words");

// The negative control: the same body, with the definitions left out of the
// accounting — the fit of the code before this fix. The request goes out over
// the window and the engine refuses it.
const blindSmallEngine = mockEngine({
  bodyChars: PAGE,
  reports: true,
  calls: ["browser_read"],
  limit: SMALL,
});
const blindSmallTurn = await runTurn(blindSmallEngine, {
  bodyChars: PAGE,
  budget: SMALL_FIT,
  definitions: 0,
  limit: SMALL,
});
check(
  blindSmallEngine.refusedCount() > 0,
  "without the definitions in the fit the body goes out and the engine refuses it",
  `${blindSmallEngine.refusedCount()} refusal(s)`,
);
check(blindSmallTurn.failure !== null, "and the turn dies there");

// The same fit, on the caller's side: the build that assembles the wire
// knows the offer now, and refuses the send before anything is sent.
//
// **Its own window, and a small history.** The window here is big enough for
// the reserve the app keeps for the answer and for the status, so the fit's
// answer is about the definitions and not about the room the app keeps back.
const FIT_WINDOW = 2600;
const storedUser = {
  id: "u1",
  role: "user",
  content: "y".repeat(200),
  createdAt: 0,
};
const fitted = buildPinnedContext([storedUser], [], FIT_WINDOW, undefined, 0, 0, BROWSER_TOOLS);
const unfitted = buildPinnedContext([storedUser], [], FIT_WINDOW, undefined, 0, 0, []);
equal(fitted.status, "refused", "the caller's fit refuses a send the definitions would not fit into");
equal(unfitted.status, "ok", "without the definitions in it the same fit says yes — and the body does not fit");

// ---------------------------------------------------------------------------
console.log("\n4. the closing carries the thread the engine read, not the one the shed left");

// A history big enough that the shed fires, and a page big enough that the
// turn closes for space after it.
const HISTORY = 20000;
const historyMessages = [
  system,
  { role: "user", content: "y".repeat(200) },
  { role: "assistant", content: "y".repeat(HISTORY) },
  { role: "user", content: "Leggi la pagina e dimmi cosa c'è." },
];
const historyEngine = mockEngine({
  bodyChars: PAGE * 4,
  reports: true,
  calls: ["browser_read"],
  limit: 8192,
});
const historyTurn = await runTurn(historyEngine, {
  bodyChars: PAGE * 4,
  budget: 8192 - RESERVE,
  messages: historyMessages,
  limit: 8192,
});
equal(historyTurn.failure, null, "the turn did not die");
equal(historyEngine.refusedCount(), 0, "the engine never refused");
equal(historyTurn.closedForSpace, true, "the turn closed for space");

const historyClosing = historyEngine.requests[historyEngine.requests.length - 1];
const historyBefore = historyEngine.requests[historyEngine.requests.length - 2];
// The shed took the older half of the history away from the conversation.
// The closing request must not carry that: it carries the wire the engine
// read, which still has the old turn in it.
check(
  historyClosing.messages.length >= historyBefore.messages.length,
  "the closing round carries at least the wire the engine had read",
  `${historyClosing.messages.length} messages against ${historyBefore.messages.length}`,
);
equal(
  historyClosing.messages[1]?.content,
  historyBefore.messages[1]?.content,
  "the closing round still carries the old turn the shed removed from the conversation",
);
check(
  !historyClosing.messages.some((message) => JSON.stringify(message).includes("z".repeat(4000))),
  "and it does not carry the page the turn never got to send",
);

// ---------------------------------------------------------------------------
console.log("\n4b. the closing without the status: the thread was already at the limit");

// A thread that fills the window on its own, and pages so small that the
// turn only runs out of room at the very end. The status no longer fits the
// kept wire — so it is left out, the closing request is the body the engine
// accepted, and the person is still told the turn was closed for space.
const limitWindow = 8192;
const limitBudget = limitWindow - RESERVE;
// **The thread fills the window on its own.** The body has to fit the budget
// — the window less the room the answer has — and the status has not to fit
// it, which is the case this section is about: the thread was already at the
// limit when the turn started, so the wire cannot grow and the status has
// nowhere to go.
//
// **Sized by the app's own estimate**, so that the first body is a hair under
// the budget whatever the definitions weigh — and the engine counts it a few
// tokens under that, so the status has nowhere to go.
const limitChars = Math.max(
  0,
  (limitBudget - 10 - wireSize([system, { role: "user", content: "" }]) - definitionsTokens(BROWSER_TOOLS)) * 4,
);
const fullThread = [system, { role: "user", content: "y".repeat(limitChars) }];
const limitEngine = mockEngine({
  bodyChars: 50,
  reports: true,
  calls: Array(12).fill("browser_read"),
  limit: limitWindow,
});
const limitTurn = await runTurn(limitEngine, {
  bodyChars: 50,
  budget: limitBudget,
  messages: fullThread,
  limit: limitWindow,
});
equal(limitTurn.failure, null, "the turn did not die");
equal(limitEngine.refusedCount(), 0, "the engine never refused");
equal(limitTurn.closedForSpace, true, "the person is still told the turn was closed for space");
const limitClosing = limitEngine.requests[limitEngine.requests.length - 1];
const limitBefore = limitEngine.requests[limitEngine.requests.length - 2];
check(
  !JSON.stringify(limitClosing.messages).includes(FINAL_STATUS),
  "the status is left out: the kept wire plus the status would not fit",
);
equal(
  JSON.stringify(limitClosing.messages),
  JSON.stringify(limitBefore.messages),
  "and the closing request is the body the engine accepted, word for word",
);
check(
  engineTokens(limitClosing.messages, limitClosing.tools) <= limitWindow,
  "the closing request fits the window",
  `${engineTokens(limitClosing.messages, limitClosing.tools)} tokens`,
);

// ---------------------------------------------------------------------------
console.log("\n4c. the negative control: the status folded into the last tool result");

// **The closing request of the code before this fix.** The status was copied
// into the last tool result the engine had read: the same thread, the same
// length, and the text the engine had read is no longer the beginning of the
// text it is asked now. The prefix is gone, the whole thread is read again —
// 205 seconds for 62558 tokens, and an answer that arrives after the door
// has stopped waiting for it.
const lastTool = beforeClosing.messages[beforeClosing.messages.length - 1];
const folded = {
  ...beforeClosing,
  messages: beforeClosing.messages.slice(0, -1).concat([
    { ...lastTool, content: `${lastTool.content}\n\n${FINAL_STATUS}` },
  ]),
};
const appended = {
  ...beforeClosing,
  messages: beforeClosing.messages.concat([{ role: "user", content: FINAL_STATUS }]),
};
check(
  !promptText(folded).startsWith(promptText(beforeClosing)),
  "the folded status changes the text the engine had read",
);
equal(
  engineCache(beforeClosing, folded),
  0,
  "so the engine keeps nothing of it — and the check above would fail",
);
check(
  promptText(appended).startsWith(promptText(beforeClosing)),
  "the appended status leaves the text the engine had read where it was",
);
check(
  engineCache(beforeClosing, appended) > 0,
  "so the engine keeps the whole prefix — and the check above holds",
);
equal(
  engineCache(beforeClosing, beforeClosing),
  engineCache(beforeClosing, appended),
  "and the same prefix as the request the app sends",
);

// ---------------------------------------------------------------------------
console.log("\n5. an ordinary web turn changes nothing");

// A web turn with the fit on: a search and two pages read. It must not stop
// for space — the window is nowhere near full.
const plainEngine = mockEngine({
  bodyChars: 4000,
  reports: true,
  calls: ["web_search", "web_fetch", "web_fetch"],
});
const plainTurn = await runTurn(plainEngine, {
  bodyChars: 4000,
  tools: WEB_TOOLS,
  definitions: definitionsTokens(WEB_TOOLS),
});
equal(plainTurn.failure, null, "the turn ends well");
equal(plainTurn.closedForSpace, false, "the turn is not closed for space — the window is not full");
equal(plainEngine.refusedCount(), 0, "the engine never refused");
equal(plainEngine.requests.length, 4, "a search, two reads and the answer round");
check(plainTurn.answer.length > 0, "the person got the answer");
equal(plainTurn.runs, 3, "and the three calls are on the turn");

// ---------------------------------------------------------------------------
console.log("\n6. a count of zero is not a count");

// The engine reports a prompt of zero tokens for a prompt that has words in
// it: a broken report. Taken at its word it would project the whole wire to
// nothing — the turn would believe it had room for ever, and the request
// that does not fit would go out.
const zeroEngine = mockEngine({
  bodyChars: PAGE,
  reports: true,
  reportTotal: 0,
  calls: Array(expectedReads + 4).fill("browser_read"),
});
const zeroTurn = await runTurn(zeroEngine, { bodyChars: PAGE });
equal(zeroTurn.failure, null, "the turn did not die");
equal(zeroEngine.refusedCount(), 0, "the engine never refused");
equal(zeroTurn.closedForSpace, true, "the turn still closes for space — the broken count was not taken at its word");
const zeroOver = zeroEngine.requests.filter(
  (request) => engineTokens(request.messages, request.tools) > LIMIT,
);
equal(zeroOver.length, 0, "no request was sent over the window");

// ---------------------------------------------------------------------------
console.log("\n7. the copy says what happened, in the person's language");

const { TABLES: tables } = app;
const languages = ["en", "it", "es", "fr", "zh"];
for (const language of languages) {
  const table = tables[language];
  check(
    typeof table.thread.tooMuchTitle === "string" && table.thread.tooMuchTitle.length > 0,
    `${language}: the oversize title is there`,
  );
  check(
    !/file|allegat|archiv/i.test(table.thread.tooMuchTitle + table.thread.tooMuchBody),
    `${language}: the oversize line does not blame the files`,
    `${table.thread.tooMuchTitle} / ${table.thread.tooMuchBody}`,
  );
  check(
    typeof table.shell.readTooMuch === "string" && table.shell.readTooMuch.length > 0,
    `${language}: the turn's refusal line is there`,
  );
  check(
    typeof table.shell.spaceClosed === "string" && table.shell.spaceClosed.length > 0,
    `${language}: the closed-for-space line is there`,
  );
  check(
    /file|fichier|allegat|archiv|archivo|文件/i.test(table.shell.tooMuchAtOnce),
    `${language}: the attach refusal still names the file — there it is true`,
    table.shell.tooMuchAtOnce,
  );
}

// ---------------------------------------------------------------------------
console.log("\n8. the answer's room: the turn stops before the thread is at the limit");

// The shape of the cell of 21 October 2026: a window of 65536 and a thread
// that was already most of the way to the limit, with pages still coming. The
// turn has to stop with the room the answer needs still free, and the answer
// it goes on to ask for must not be cut.
//
// **A small page every round.** The room the answer has is the window less the
// thread the engine read, and the thread grows by one round's page: a small
// page means the turn stops within a round of the budget, so the margin is a
// number and not a coincidence.
const STEP_CHARS = 170;
const stepTokens = denseTokens(STEP_CHARS);

// **The thread, sized by the app's own estimate**, so that the first body is
// the same size in every build and the two stops below are the same case.
const firstBody = LIMIT - RESERVE - 700;
const nearlyFullThread = [
  system,
  {
    role: "user",
    content: "y".repeat(
      Math.max(0, (firstBody - wireSize([system, user]) - definitionsTokens(BROWSER_TOOLS)) * 4),
    ),
  },
];
console.log(
  `   the shape: the first body weighs ${engineTokens(nearlyFullThread, BROWSER_TOOLS)} tokens, a round weighs ${stepTokens}, so the window of ${LIMIT} has ${RESERVE} tokens of it kept for the answer`,
);

const roomEngine = mockEngine({
  bodyChars: STEP_CHARS,
  reports: true,
  calls: Array(24).fill("browser_read"),
  answerTokens: 900,
});
const roomTurn = await runTurn(roomEngine, { bodyChars: STEP_CHARS, messages: nearlyFullThread });
equal(roomTurn.failure, null, "the turn did not die");
equal(roomTurn.closedForSpace, true, "the turn closed for space");
equal(roomEngine.refusedCount(), 0, "the engine never refused a request");
const roomClosing = roomEngine.requests[roomEngine.requests.length - 1];
const roomBefore = roomEngine.requests[roomEngine.requests.length - 2];
// **The margin is the window less the thread the engine read.** The turn
// stopped before the thread was at the limit, and the room the answer has is
// that margin less the status the closing request carries.
const margin = LIMIT - engineTokens(roomBefore.messages, roomBefore.tools);
const answerRoom = LIMIT - engineTokens(roomClosing.messages, roomClosing.tools);
console.log(`   the turn stopped with ${margin} tokens of margin, and the answer had ${answerRoom}`);
check(
  margin >= ANSWER_RESERVE_TOKENS,
  "the turn stopped with the answer's reserve free",
  `margin ${margin}, reserve ${ANSWER_RESERVE_TOKENS}`,
);
check(
  roomTurn.answer.length === 4 * 900,
  "and the answer of 900 tokens was written whole",
  `${roomTurn.answer.length} characters`,
);
check(answerRoom >= 900, "the room the answer had was big enough for it", `${answerRoom} tokens`);

// **The negative control.** The same case on a build with the reserve the cell
// had — 512 tokens. The thread then stops nearer the limit, the answer has
// less room than it needs, and it comes back cut: the cell's own failure.
{
  const blind = await loadApp({
    compileOut: {
      file: "lib/attachments.ts",
      from: "export const ANSWER_RESERVE_TOKENS = 1536;",
      to: "export const ANSWER_RESERVE_TOKENS = 512;",
    },
  });
  try {
    const blindEngine = mockEngine({
      bodyChars: STEP_CHARS,
      reports: true,
      calls: Array(24).fill("browser_read"),
      answerTokens: 900,
    });
    const blindTurn = await runTurn(blindEngine, {
      bodyChars: STEP_CHARS,
      messages: nearlyFullThread,
      budget: LIMIT - blind.app.ANSWER_RESERVE_TOKENS,
      bundle: blind.app,
    });
    const blindClosing = blindEngine.requests[blindEngine.requests.length - 1];
    const blindBefore = blindEngine.requests[blindEngine.requests.length - 2];
    const blindMargin = LIMIT - engineTokens(blindBefore.messages, blindBefore.tools);
    const blindRoom = LIMIT - engineTokens(blindClosing.messages, blindClosing.tools);
    check(
      blindMargin < ANSWER_RESERVE_TOKENS,
      "with the reserve of 512 the turn stops inside the answer's room — the check above would fail",
      `margin ${blindMargin}`,
    );
    check(
      blindTurn.answer.length < 4 * 900,
      "and the answer of 900 tokens comes back cut, as it did in the cell",
      `${blindTurn.answer.length} characters`,
    );
    check(blindRoom < 900, "because the room left for it was smaller than it is", `${blindRoom} tokens`);
  } finally {
    await rm(blind.dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
console.log("\n9. the final status carries the turn's own record");

// **The cell of 21 October 2026, in one line.** The model wrote "dalle schede
// prodotto che ho visitato" and called the prices verified; the app's record
// said that no product's page had been opened at all. The record was the app's
// and the model never saw it — so the final status carries it now.
//
// **The turn of the cell, as a mock.** The site, the search, the listing read
// three times, two fields written and two clicks — and not one product's page.
const cellCalls = [
  { name: "browser_open", arguments: { url: "https://amazon.it/" } },
  { name: "browser_read", arguments: { page: 1 } },
  { name: "browser_type", arguments: { ref: "e1", text: "laptop" } },
  { name: "browser_click", arguments: { ref: "e2" } },
];

/** The status the last request carries: the message of its own at the end. */
const statusOf = (request) => String(request.messages[request.messages.length - 1].content);

// **The ordinary turn, at the cap.** The model keeps calling until the turn's
// own bound stops it, and the last round is the one that has to answer.
const cappedEngine = mockEngine({
  bodyChars: 400,
  reports: true,
  calls: [...cellCalls, ...Array(20).fill({ name: "browser_read", arguments: { page: 2 } })],
});
const cappedTurn = await runTurn(cappedEngine, { bodyChars: 400 });
equal(cappedTurn.failure, null, "the turn did not die");
equal(cappedTurn.closedForSpace, false, "the turn was not closed for space — the window is not full");
const cappedClosing = cappedEngine.requests[cappedEngine.requests.length - 1];
equal(cappedClosing.tool_choice, "none", "the last round forbids the calls");
const cappedStatus = statusOf(cappedClosing);
check(cappedStatus.includes(FINAL_STATUS), "the last round carries the execution status");
check(
  cappedStatus.includes("The browser opened 1 page (asked for amazon.it)"),
  "and the record says which page the turn opened, with its host",
  cappedStatus,
);
check(cappedStatus.includes("read 21 times"), "and how many times it read", cappedStatus);
check(cappedStatus.includes("wrote into 1 field"), "and how many fields it wrote into", cappedStatus);
check(cappedStatus.includes("clicked 1 time"), "and how many times it clicked", cappedStatus);
check(
  cappedStatus.includes("No detail page of any product was opened in this turn."),
  "and it says out loud that no product's page was among them",
  cappedStatus,
);
check(
  cappedStatus.includes("Answer only from what those pages actually showed; say what was not verified."),
  "and it closes with the instruction the answer has to follow",
  cappedStatus,
);

// **Two pages that are products' own.** The record then names both of them and
// says nothing about a page that was never opened.
const twoEngine = mockEngine({
  bodyChars: 400,
  reports: true,
  calls: [
    { name: "browser_open", arguments: { url: "https://shop.example/dp/B012345678" } },
    { name: "browser_open", arguments: { url: "https://other.example/item/9" } },
    ...Array(22).fill({ name: "browser_read", arguments: { page: 1 } }),
  ],
});
await runTurn(twoEngine, { bodyChars: 400 });
const twoStatus = statusOf(twoEngine.requests[twoEngine.requests.length - 1]);
check(
  twoStatus.includes("The browser opened 2 pages (asked for shop.example, other.example)"),
  "the record names both pages it opened",
  twoStatus,
);
check(
  !twoStatus.includes("No detail page of any product was opened"),
  "and it does not claim that no product's page was opened — two of them were",
  twoStatus,
);

// **The turn that closed for space** carries the same record: the closing
// round is a final round too.
const spaceEngine = mockEngine({
  bodyChars: STEP_CHARS,
  reports: true,
  calls: [...cellCalls, ...Array(20).fill({ name: "browser_read", arguments: { page: 2 } })],
});
const spaceTurn = await runTurn(spaceEngine, { bodyChars: STEP_CHARS, messages: nearlyFullThread });
equal(spaceTurn.closedForSpace, true, "the turn closed for space");
const spaceClosing = spaceEngine.requests[spaceEngine.requests.length - 1];
const spaceStatus = statusOf(spaceClosing);
check(spaceStatus.includes(FINAL_STATUS), "the closing round carries the execution status");
check(
  spaceStatus.includes("[Kalsa turn record]"),
  "and the record of what the turn did goes with it",
  spaceStatus,
);
check(
  spaceStatus.includes("asked for amazon.it"),
  "and it names the page the turn opened",
  spaceStatus,
);
check(
  spaceStatus.includes("No detail page of any product was opened in this turn."),
  "and it says out loud that no product's page was among them",
  spaceStatus,
);

// **The negative control.** The same turn on a build with the record compiled
// out: the status is there and the record is not, and the checks above fail.
{
  const blind = await loadApp({
    compileOut: {
      file: "toolLoop.ts",
      from: "const status = finalStatus(recordRuns);",
      to: "const status = FINAL_STATUS;",
    },
  });
  try {
    const blindEngine = mockEngine({
      bodyChars: 400,
      reports: true,
      calls: [...cellCalls, ...Array(20).fill({ name: "browser_read", arguments: { page: 2 } })],
    });
    await runTurn(blindEngine, { bodyChars: 400, bundle: blind.app });
    const blindStatus = statusOf(blindEngine.requests[blindEngine.requests.length - 1]);
    check(blindStatus.includes(FINAL_STATUS), "with the record compiled out the status is still there");
    check(
      !blindStatus.includes("[Kalsa turn record]"),
      "and the record is not — the checks above would fail",
      blindStatus,
    );
    check(
      !blindStatus.includes("No detail page of any product was opened"),
      "and the sentence that names what was never opened is not either",
      blindStatus,
    );
  } finally {
    await rm(blind.dir, { recursive: true, force: true });
  }
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
