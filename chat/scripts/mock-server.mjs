// Tiny OpenAI-compatible mock endpoint for screenshots and manual testing.
// Routes:
//   POST /ok/v1/chat/completions      -> SSE stream, scenario chosen by `model`
//   POST /denied/v1/chat/completions  -> 401
// Scenarios (model contains): "code" = code-heavy, "heavy" = markdown
// showcase, "slow" = long answer with per-token delay (streaming shots).
// Anything else = short reply.
import http from "node:http";

const CODE_MD = [
  "Here are the three snippets you asked for.",
  "",
  "```python",
  "def greet(name: str) -> str:",
  "    return f\"Hello, {name}!\"",
  "```",
  "",
  "One-liner for the shell:",
  "",
  "```bash",
  "ls -la | head -20",
  "```",
  "",
  "And the long one — a small retry helper with backoff:",
  "",
  "```typescript",
  "export async function retry<T>(",
  "  fn: () => Promise<T>,",
  "  attempts = 5,",
  "  baseMs = 200,",
  "): Promise<T> {",
  "  let last: unknown;",
  "  for (let i = 0; i < attempts; i++) {",
  "    try {",
  "      return await fn();",
  "    } catch (error) {",
  "      last = error;",
  "      const wait = baseMs * 2 ** i + Math.random() * 100;",
  "      await new Promise((resolve) => setTimeout(resolve, wait));",
  "    }",
  "  }",
  "  throw last;",
  "}",
  "```",
  "",
  "And a minified one-liner — this block must scroll sideways, never wrap:",
  "",
  "```javascript",
  "const bundle=\"" + "import_crypto_".repeat(28) + "from_cdn_then_tree_shaken_and_minified_until_nothing_readable_remains_whatsoever();\"",
  "```",
  "",
  "That last block scrolls horizontally instead of wrapping — try resizing the window.",
].join("\n");

const HEAVY_MD = [
  "# A short field guide",
  "",
  "Some **bold** claims, some *quiet* asides, and a [link to nowhere](https://example.com).",
  "",
  "## Lists, nested",
  "",
  "- First item",
  "  - Nested one",
  "  - Nested two",
  "    1. Deeply numbered",
  "    2. Still going",
  "- Second item",
  "",
  "## A table",
  "",
  "| Feature | Chat A | Chat B |",
  "| --- | --- | --- |",
  "| Line length | 72 chars | full width |",
  "| Code header | yes | no |",
  "| Stop button | yes | sometimes |",
  "",
  "> A quiet quotation, set apart with a rule instead of a bubble.",
  ">",
  "> — *someone, somewhere*",
  "",
  "Done. That was headings, lists, a table, a quote, and inline `code` in one answer.",
].join("\n");

const LONG_MD = [
  "Working through this step by step, because the details matter more than the headline.",
  "",
  "First, the shape of a good answer: it opens with the shortest true sentence, then earns",
  "the right to be longer. Each paragraph below adds one idea and nothing else, so the",
  "reader can stop anywhere and still leave with something whole.",
  "",
  "Second, pacing. A long response arriving token by token is a small performance: the",
  "first words should arrive quickly to prove the line is alive, then the text can settle",
  "into its rhythm. If you scrolled up while this was arriving, the view stayed where you",
  "left it — that is the scroll anchor doing its job, and the pill below offers the way back.",
  "",
  "Third, density. Turns are separated by air, not by boxes. Your words sit in a quiet",
  "bubble on the right; mine sit on the page itself, at a measure of seventy-odd characters,",
  "so the eye never has to run a marathon across a wide window.",
  "",
  "Fourth, the ending. Nothing here needed a summary, so there is none — the text simply",
  "stops when it has said what it came to say, like this.",
].join("\n");

const JSON_MD = "Non-streaming reply: some servers ignore stream:true and answer plain JSON. This text arrived that way.";

// Thinking filler: original deliberation-like text, in the model's voice.
const THINK_A = [
  "Let me think about this properly before answering.",
  "",
  "First, what is actually being asked? Strip the politeness, keep the need.",
  "There are two readings; the second one survives contact with the numbers.",
  "Check the arithmetic twice, because confidence is cheap and errors are not.",
  "Eight sheep left. Yes — eight. Now say it plainly.",
].join("\n");

const THINK_SHORT = [
  "Hmm. Quick one — no need to overthink.",
  "The answer is 8 sheep left.",
].join("\n");

const THINK_LONG = Array.from(
  { length: 40 },
  (_, i) =>
    `Consideration ${i + 1}: turn the problem around, check the edges, distrust the first answer, keep the units honest, and write down what would change my mind.`,
).join("\n");

const THINK_SLOW = Array.from(
  { length: 24 },
  (_, i) => `Slow thought ${i + 1}: patience first, conclusions later.`,
).join("\n");

// The leaked answer, verbatim from the live run of 2026-09-19 (see
// /tmp/kalsa-tool-live.md): a model forbidden a structured tool call wrote one
// out as text, and the page showed it.
const MARKUP_LEAK = [
  "I need one more search to be sure.",
  "",
  "<tool_call>",
  "<function=web_search>",
  "<parameter=query>",
  "weather in Tokyo today",
  "</parameter>",
  "</function>",
  "</tool_call>",
].join("\n");

function scenarioFor(model) {
  if (model.includes("markup-demo")) return { text: MARKUP_LEAK, delay: 8 };
  if (model.includes("code")) return { text: CODE_MD, delay: 12 };
  if (model.includes("heavy")) return { text: HEAVY_MD, delay: 8 };
  if (model.includes("slow")) return { text: LONG_MD, delay: 45 };
  // Patient: first token takes 1.5s so the waiting state is observable.
  if (model.includes("patient")) return { text: LONG_MD, delay: 20, firstDelay: 1500 };
  return { text: "Hello! The line is open and streaming works.", delay: 10 };
}

function chunk(text) {
  // Token-ish slices so the UI visibly streams.
  const parts = [];
  for (let i = 0; i < text.length; i += 7) parts.push(text.slice(i, i + 7));
  return parts;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization",
};

let lastBody = null;
/// Every chat body this run has received, oldest first. A tool round trip is a
/// sequence, and `__last-body` can only show its end; an oracle needs all of it.
const chatBodies = [];

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  // The door's slot routes, as a seeded brain's own endpoint reaches them:
  // the endpoint carries a scenario prefix (/ok, /denied, …), so the path is
  // matched by its end. 204 is SlotAnswer's `ok` (chat.ts slotRoute), which
  // is all `activate`/`erase` need to say.
  // The door's slot routes under the SCENARIO's own base — the exact path
  // serverBase(endpoint) builds (`…/ok/kalsa/chat/activate`). A bare
  // `/kalsa/chat/activate` would mean the address lost its scenario prefix,
  // so only the based path answers 204: the check proves the address.
  const slotRoute =
    req.method === "POST" &&
    /^(?:\/[\w.-]+)+\/kalsa\/chat\/(?:activate|erase)$/.exec(req.url);
  if (slotRoute) {
    req.resume();
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  // Test-only: what did the client actually send last? Lets asserts check
  // the wire (documents pinned, turns pruned) without guessing from UI.
  if (req.method === "GET" && req.url === "/__last-body") {
    res.writeHead(200, { "Content-Type": "application/json", ...CORS });
    res.end(JSON.stringify({ body: lastBody }));
    return;
  }
  // Test-only: the whole sequence, and a way to start a clean one, so a test
  // can assert what the loop sent round by round.
  if (req.method === "GET" && req.url === "/__bodies") {
    res.writeHead(200, { "Content-Type": "application/json", ...CORS });
    res.end(JSON.stringify({ bodies: chatBodies }));
    return;
  }
  if (req.url === "/__reset") {
    req.resume();
    chatBodies.length = 0;
    lastBody = null;
    res.writeHead(200, { "Content-Type": "application/json", ...CORS });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  // Context sizes: big by default, tiny under /small, tight under /tight.
  // /ok behaves like a server root (its own /props), so the default flow
  // sees a known size. Anything else stays silent: unknown, never invented.
  // The shape is the fork's contract: the window lives at
  // default_generation_settings.n_ctx (server-context.cpp:4939) — there is
  // NO top-level n_ctx on /props, and serving one here would let a re-read
  // of the old defect pass green.
  if (req.method === "GET" && (req.url === "/props" || req.url === "/ok/props")) {
    res.writeHead(200, { "Content-Type": "application/json", ...CORS });
    // A chat template with the switch the real model has: `/props` answers the
    // sampler values and the template together, and the app reads both from the
    // same answer.
    res.end(
      JSON.stringify({
        default_generation_settings: { n_ctx: 32768 },
        chat_template:
          "{%- if enable_thinking is defined and not enable_thinking %}{%- endif %}{%- for message in messages %}{{ message['content'] }}{%- endfor %}",
      }),
    );
    return;
  }
  if (req.method === "GET" && req.url === "/small/props") {
    res.writeHead(200, { "Content-Type": "application/json", ...CORS });
    res.end(JSON.stringify({ default_generation_settings: { n_ctx: 256 } }));
    return;
  }
  if (req.method === "GET" && req.url === "/tight/props") {
    res.writeHead(200, { "Content-Type": "application/json", ...CORS });
    res.end(JSON.stringify({ default_generation_settings: { n_ctx: 1024 } }));
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(404, CORS).end();
    return;
  }
  if (req.url === "/denied/v1/chat/completions") {
    req.resume();
    res.writeHead(401, { "Content-Type": "application/json", ...CORS });
    res.end(JSON.stringify({ error: { message: "Invalid API key", type: "invalid_request_error" } }));
    return;
  }
  if (req.url === "/forbidden/v1/chat/completions") {
    req.resume();
    res.writeHead(403, { "Content-Type": "application/json", ...CORS });
    res.end(JSON.stringify({ error: { message: "Forbidden", type: "invalid_request_error" } }));
    return;
  }
  // /ok streams the scenarios; /tight and /small behave the same (their
  // /props is what differs). Every chat body is remembered for __last-body.
  if (
    req.url === "/ok/v1/chat/completions" ||
    req.url === "/tight/v1/chat/completions" ||
    req.url === "/small/v1/chat/completions"
  ) {
    // Hard cases first: split frames, cuts, wrong shapes. Each exercises a
    // client branch the happy path never touches.
    let bodyPeek = "";
    req.on("data", (c) => (bodyPeek += c));
    req.on("end", () => {
      lastBody = bodyPeek;
      chatBodies.push(bodyPeek);
      let model = "";
      try {
        model = JSON.parse(bodyPeek).model ?? "";
      } catch { /* default scenario */ }
      model = String(model);
      // Order matters: "emptycut-demo" contains "cut-demo"; the think
      // family shares the "think-demo" tail the same way.
      if (model.includes("emptycut-demo")) {
        res.writeHead(200, { "Content-Type": "text/event-stream", ...CORS });
        res.end();
        return;
      }
      if (model.includes("split-demo")) return streamSplit(res);
      // Every tool scenario shares this prefix: tools-demo, toolsfetch-demo,
      // toolstwo-demo, toolsbad-demo, toolsloop-demo, toolsslow-demo.
      if (model.includes("tools")) return streamTools(res, bodyPeek, model);
      if (model.includes("cut-demo")) return streamCut(res);
      if (model.includes("casestream-demo")) {
        // A stream announced with a mixed-case media type: still a stream.
        res.writeHead(200, { "Content-Type": "Text/Event-Stream", ...CORS });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Mixed case is still a stream." } }] })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }
      if (model.includes("jsonmarkup-demo")) {
        // A server that ignored stream:true, answering with the tool-call markup
        // that must never reach the reader. See the live run of 2026-09-19.
        res.writeHead(200, { "Content-Type": "application/json", ...CORS });
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    "Here is the syntax.\n\n<tool_call>\n<function=web_search>\n<parameter=query>\nweather in Tokyo\n</parameter>\n</function>\n</tool_call>\n\nThat was the markup.",
                },
              },
            ],
          }),
        );
        return;
      }
      if (model.includes("json-demo")) {
        res.writeHead(200, { "Content-Type": "application/json", ...CORS });
        res.end(JSON.stringify({ choices: [{ message: { content: JSON_MD } }] }));
        return;
      }
      if (model.includes("html-demo")) {
        res.writeHead(200, { "Content-Type": "text/html", ...CORS });
        res.end("<html><body>Please log in</body></html>");
        return;
      }
      if (model.includes("silent-demo")) {
        res.writeHead(200, { "Content-Type": "text/event-stream", ...CORS });
        // Never write: the client's idle timer must give up first.
        return;
      }
      // Thinking family: reasoning travels in delta.reasoning_content
      // (llama.cpp, DeepSeek) or delta.reasoning (vLLM). Same stream.
      if (model.includes("splitthink-demo")) return streamThinkSplit(res);
      if (model.includes("slowthink-demo")) return streamThink(res, THINK_SLOW, 150, "content");
      if (model.includes("longthink-demo")) return streamThink(res, THINK_LONG, 8, "content");
      if (model.includes("thinkonly-demo")) return streamThink(res, THINK_A, 25, null);
      if (model.includes("vllm-demo")) return streamThink(res, THINK_A, 25, "reasoning");
      if (model.includes("both-demo")) return streamBoth(res);
      if (model.includes("emptywins-demo")) return streamDualReasoning(res, "", "Real thinking here. ");
      if (model.includes("bothfull-demo")) return streamDualReasoning(res, "Content-side wins. ", "Loser text. ");
      if (model.includes("jsonthink-demo")) {
        res.writeHead(200, { "Content-Type": "application/json", ...CORS });
        res.end(
          JSON.stringify({ choices: [{ message: { content: "", reasoning_content: "JSON thinking here." } }] }),
        );
        return;
      }
      if (model.includes("think-demo")) return streamThink(res, THINK_A, 25, "content");
      streamNormal(res, bodyPeek);
    });
    return;
  }
// Thinking family: reasoning first, then (usually) the answer.
function streamThink(res, thought, delayMs, answerField) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    ...CORS,
  });
  const rparts = [];
  for (let i = 0; i < thought.length; i += 24) rparts.push(thought.slice(i, i + 24));
  const answer = "The answer is 8 sheep left.";
  const aparts = [];
  for (let i = 0; i < answer.length; i += 7) aparts.push(answer.slice(i, i + 7));
  const field = answerField === "reasoning" ? "reasoning" : "reasoning_content";
  let ri = 0;
  let ai = 0;
  const timer = setInterval(() => {
    if (ri < rparts.length) {
      const delta = {};
      delta[field] = rparts[ri];
      res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
      ri++;
    } else if (answerField !== null && ai < aparts.length) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: aparts[ai] } }] })}\n\n`);
      ai++;
    } else {
      clearInterval(timer);
      res.write("data: [DONE]\n\n");
      res.end();
    }
  }, delayMs);
  res.on("close", () => clearInterval(timer));
}

// One delta carrying both fields at once.
function streamBoth(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    ...CORS,
  });
  const pairs = [
    ["Considering ", "Well, "],
    ["the flock… ", "counting "],
    ["eight remain. ", "heads: "],
    ["Say it plainly. ", "eight sheep left."],
  ];
  let i = 0;
  const timer = setInterval(() => {
    if (i < pairs.length) {
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: pairs[i][0], content: pairs[i][1] } }] })}\n\n`,
      );
      i++;
    } else {
      clearInterval(timer);
      res.write("data: [DONE]\n\n");
      res.end();
    }
  }, 25);
  res.on("close", () => clearInterval(timer));
}

// Both reasoning names populated: empty string must not win, and when both
// are non-empty the documented precedence (reasoning_content) must hold.
function streamDualReasoning(res, rcText, rText) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    ...CORS,
  });
  let i = 0;
  const timer = setInterval(() => {
    if (i < 2) {
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: rcText, reasoning: rText } }] })}\n\n`,
      );
      i++;
    } else if (i === 2) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Answered." } }] })}\n\n`);
      i++;
    } else {
      clearInterval(timer);
      res.write("data: [DONE]\n\n");
      res.end();
    }
  }, 25);
  res.on("close", () => clearInterval(timer));
}

// Tool calling: the first request asks for a search with the argument JSON
// torn across three chunks; the second carries the tool's result and answers
// in words. The mock reads the body to tell which request it is, so it does
// not depend on counting requests.
/**
 * The oracle for a tool round trip. The client is what is under test here, so
 * the mock reads the wire it sends back: every call the assistant made must be
 * answered once, by id, in the same order, with words in the result. Anything
 * else is answered with a 400 naming the fault, so a broken pairing fails the
 * test loudly instead of quietly getting an answer.
 *
 * Returns null when the sequence is whole.
 */
function toolSequenceProblem(bodyText) {
  let messages;
  try {
    messages = JSON.parse(bodyText).messages ?? [];
  } catch {
    return "the body was not JSON";
  }
  const asked = messages
    .map((message, at) => ({ message, at }))
    .filter(({ message }) => message.role === "assistant" && Array.isArray(message.tool_calls))
    .pop();
  if (!asked) return "no assistant message carried tool_calls";
  const calls = asked.message.tool_calls;
  if (calls.length === 0) return "the assistant message carried an empty tool_calls array";

  // The results of that call, and only those: the run ends where the next
  // message is not a tool result. A later turn's user message is not a fault.
  const results = [];
  for (const message of messages.slice(asked.at + 1)) {
    if (message.role !== "tool") break;
    results.push(message);
  }
  if (results.length !== calls.length) {
    return `expected ${calls.length} tool result(s) right after the call, found ${results.length}`;
  }
  for (const [nth, call] of calls.entries()) {
    if (typeof call.id !== "string" || !call.id) return `call ${nth} has no id`;
    if (typeof call.function?.name !== "string" || !call.function.name) {
      return `call ${nth} has no name`;
    }
    if (typeof call.function?.arguments !== "string") return `call ${nth} has no argument text`;
    if (results[nth].tool_call_id !== call.id) {
      return `result ${nth} answers ${results[nth].tool_call_id}, not ${call.id}`;
    }
    if (typeof results[nth].content !== "string" || results[nth].content === "") {
      return `result ${nth} is empty`;
    }
  }
  return null;
}

function refuseWire(res, problem) {
  res.writeHead(400, { "Content-Type": "application/json", ...CORS });
  res.end(JSON.stringify({ error: { message: `tool wire rejected: ${problem}` } }));
}

function callFrames(calls, splitFirst) {
  const frames = [];
  calls.forEach((call, index) => {
    const pieces = splitFirst && index === 0 ? [8, 12] : [];
    const parts = [];
    let rest = call.arguments;
    for (const size of pieces) {
      parts.push(rest.slice(0, size));
      rest = rest.slice(size);
    }
    parts.push(rest);
    frames.push({
      choices: [
        {
          delta: {
            tool_calls: [
              { index, id: call.id, type: "function", function: { name: call.name, arguments: parts[0] } },
            ],
          },
        },
      ],
    });
    for (const part of parts.slice(1)) {
      frames.push({ choices: [{ delta: { tool_calls: [{ index, function: { arguments: part } }] } }] });
    }
  });
  frames.push({ choices: [{ delta: {}, finish_reason: "tool_calls" }] });
  return frames;
}

function answerFrames(text) {
  const parts = [];
  for (let at = 0; at < text.length; at += 9) parts.push(text.slice(at, at + 9));
  return [
    ...parts.map((content) => ({ choices: [{ delta: { content } }] })),
    { choices: [{ delta: {}, finish_reason: "stop" }] },
  ];
}

/**
 * Tool calling. What the mock sends depends on the model and on how many tool
 * rounds the client has already taken — it reads the body, so it never has to
 * count requests. Each scenario covers one thing the loop must get right:
 *
 * - `tools-demo`   one search, its argument JSON torn across three chunks;
 * - `toolsfetch-demo`  a page fetch;
 * - `toolstwo-demo`   two calls in one round, then a third in a second round;
 * - `toolsbad-demo`   arguments that are not JSON, and the turn must survive;
 * - `toolsloop-demo`  a call every round, until the client asks for words;
 * - `toolsslow-demo`  one call, and the page stops the turn while it runs.
 */
function streamTools(res, bodyText, model) {
  let body = {};
  let parsed = false;
  try {
    body = JSON.parse(bodyText);
    parsed = true;
  } catch {
    /* refuseWire below names it */
  }
  const messages = (body.messages ?? []);
  const rounds = messages.filter(
    (message) => message.role === "assistant" && Array.isArray(message.tool_calls),
  ).length;
  // Checked whenever an exchange is on the wire, not only when a result is
  // present: a client that sent the call and dropped every result used to skip
  // the oracle entirely and still get its answer.
  const carriesExchange = messages.some(
    (message) => message.role === "assistant" && Array.isArray(message.tool_calls),
  );
  if (carriesExchange) {
    const problem = parsed ? toolSequenceProblem(bodyText) : "the body was not JSON";
    if (problem) return refuseWire(res, problem);
  }

  let frames;
  if (model.includes("toolsshowmarkup-demo")) {
    // The user asked to be shown the tags, and the model wrote them out in an
    // ordinary round (tools offered, tool_choice "auto"). They must be visible.
    frames = answerFrames(
      "Here is the syntax: <tool_call>\n<function=web_search>\n<parameter=query>x</parameter>\n</function>\n</tool_call> and that is the format.",
    );
  } else if (model.includes("toolshidemarkup-demo")) {
    // The round cap: told with tool_choice "none" to answer in words, the model
    // wrote a call out anyway. This is the markup the page must not show.
    frames =
      body.tool_choice === "none"
        ? answerFrames(
            "I cannot answer in words. <tool_call>\n<function=web_search>\n<parameter=query>x</parameter>\n</function>\n</tool_call>",
          )
        : callFrames([{ id: `hide${rounds}`, name: "web_search", arguments: `{"query":"round ${rounds}"}` }], false);
  } else if (model.includes("toolsburn-demo")) {
    // The model spends the whole round on calls and ends it as "length" with no
    // words at all — the live shape of 2026-09-19, where the turn refused the
    // calls and the reader got silence. Asked for words, it answers.
    if (body.tool_choice === "none") {
      frames = answerFrames("In words, since calls are not allowed: the answer is 42.");
    } else {
      frames = callFrames([{ id: `burn${rounds}`, name: "web_search", arguments: `{"query":"burn ${rounds}"}` }], false);
      frames[frames.length - 1] = { choices: [{ delta: {}, finish_reason: "length" }] };
    }
  } else if (model.includes("toolsloop-demo")) {
    // Answers only when the client asks for words with tool_choice: "none".
    frames =
      body.tool_choice === "none"
        ? answerFrames("I have looked enough: the answer is 42.")
        : callFrames([{ id: `loop${rounds}`, name: "web_search", arguments: `{"query":"round ${rounds}"}` }], false);
  } else if (model.includes("toolsrepeat-demo")) {
    // The server numbers its calls per response, so it may reuse an id in the
    // next round; the client's transcript must still keep both exchanges.
    frames =
      rounds === 0
        ? callFrames([{ id: "call_1", name: "web_search", arguments: '{"query":"first"}' }], false)
        : rounds === 1
          ? callFrames([{ id: "call_1", name: "web_search", arguments: '{"query":"second"}' }], false)
          : answerFrames("Both searches are in, and the answer is 42.");
  } else if (model.includes("toolstwo-demo")) {
    if (rounds === 0) {
      frames = callFrames(
        [
          { id: "two0", name: "web_search", arguments: '{"query":"first search"}' },
          { id: "two1", name: "web_fetch", arguments: '{"url":"https://example.com/one"}' },
        ],
        false,
      );
    } else if (rounds === 1) {
      frames = callFrames([{ id: "two2", name: "web_search", arguments: '{"query":"second search"}' }], false);
    } else {
      frames = answerFrames("Both searches and the page are in, and the answer is 42.");
    }
  } else if (model.includes("toolsfetch-demo")) {
    frames =
      rounds === 0
        ? callFrames([{ id: "fetch1", name: "web_fetch", arguments: '{"url":"https://example.com/page"}' }], false)
        : answerFrames("The page says the answer is 42.");
  } else if (model.includes("toolsbad-demo")) {
    frames =
      rounds === 0
        ? callFrames([{ id: "bad1", name: "web_search", arguments: '{"query": "unterminated' }], false)
        : answerFrames("Without that search I can still say: 42.");
  } else if (model.includes("toolsslow-demo")) {
    frames = callFrames([{ id: "slow1", name: "web_search", arguments: '{"query":"slow one"}' }], false);
  } else if (rounds === 0) {
    frames = callFrames([{ id: "call_1", name: "web_search", arguments: '{"query":"weather in Lisbon"}' }], true);
  } else {
    frames = answerFrames("It will be mild: 18 °C on Saturday, 21 °C on Sunday.");
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    ...CORS,
  });
  let i = 0;
  const timer = setInterval(() => {
    if (i < frames.length) {
      res.write(`data: ${JSON.stringify(frames[i])}\n\n`);
      i++;
      return;
    }
    clearInterval(timer);
    res.write("data: [DONE]\n\n");
    res.end();
  }, 25);
  res.on("close", () => clearInterval(timer));
}

// A reasoning payload torn across two writes (terminated lines otherwise).
function streamThinkSplit(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    ...CORS,
  });
  const line = `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "Split thinking reassembled." } }] })}\n\n`;
  const cut = Math.floor(line.length / 2);
  res.write(line.slice(0, cut));
  setTimeout(() => {
    res.write(line.slice(cut));
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Answered." } }] })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  }, 30);
}

function streamNormal(res, bodyText) {
      let model = "";
      try {
        model = JSON.parse(bodyText).model ?? "";
      } catch { /* default scenario */ }
      const { text, delay, firstDelay } = scenarioFor(String(model));
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        ...CORS,
      });
      const parts = chunk(text);
      let i = 0;
      let finished = false;
      // Optional beat before the first token (waiting-state tests).
      let wait = firstDelay ?? 0;
      const timer = setInterval(() => {
        if (finished) {
          clearInterval(timer);
          return;
        }
        if (wait > 0) {
          wait -= delay;
          return;
        }
        if (i < parts.length) {
          const payload = JSON.stringify({ choices: [{ delta: { content: parts[i] } }] });
          res.write(`data: ${payload}\n\n`);
          i++;
        } else {
          finished = true;
          clearInterval(timer);
          res.write("data: [DONE]\n\n");
          res.end();
        }
      }, delay);
      // Client went away mid-stream: stop ticking. (res 'close' also fires
      // after a normal res.end(); clearing a finished timer is harmless.)
      res.on("close", () => {
        finished = true;
        clearInterval(timer);
      });
}

// Every data line torn across two writes; the last line is unterminated and
// no [DONE] follows. The client must reassemble the frames, drain the tail,
// keep the text, and still report the cut.
function streamSplit(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    ...CORS,
  });
  const lines = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: "Split " } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: { content: "frames " } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: { content: "reassembled." } }] })}`,
  ];
  let i = 0;
  const timer = setInterval(() => {
    if (i >= lines.length) {
      clearInterval(timer);
      res.end();
      return;
    }
    const line = lines[i];
    const cut = Math.floor(line.length / 2);
    res.write(line.slice(0, cut));
    setTimeout(() => res.write(line.slice(cut)), 5);
    i++;
  }, 20);
  res.on("close", () => clearInterval(timer));
}

// Tokens, then the socket dies with no [DONE]: the client must say so.
function streamCut(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    ...CORS,
  });
  const parts = chunk(LONG_MD).slice(0, 12);
  let i = 0;
  const timer = setInterval(() => {
    if (i < parts.length) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: parts[i] } }] })}\n\n`);
      i++;
    } else {
      clearInterval(timer);
      res.destroy();
    }
  }, 15);
  res.on("close", () => clearInterval(timer));
}
  req.resume();
  res.writeHead(404, CORS).end();
});

const PORT = 18081;
server.listen(PORT, () => console.log(`mock endpoint on http://127.0.0.1:${PORT}`));
