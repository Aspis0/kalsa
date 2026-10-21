// The picture of the page.
//
// The model may look at the page it is driving: the browser takes one
// photograph of the viewport and the model reads it beside the page's own
// text. This is the A/B's one new thing, so the things around it are the
// traps: a picture is a lot of bytes on a wire that counts them, and a
// memory that kept them would keep them forever.
//
// Everything here goes through the app's own seams — the turn engine, the
// store, the registry, the tool loop, the ledger — so a change that would
// break the real turn breaks this. Only the engine and the browser are stubs:
// there is no engine and no browser in a test.
//
// **What is proved here, and what would fail without it:**
//   - the offer: the picture is offered only where the three conditions hold
//     (armed, the hidden switch, eyes), and never on a phone;
//   - the gate: a call to the picture outside those conditions is refused with
//     a fixed sentence — the offer is something the model can write past;
//   - the wire: the bytes ride as their own part, the line beside them says
//     what they are, and no base64 is ever inside a sentence;
//   - the memory: the record keeps a line in words and never a byte, and the
//     replay of a later turn carries that line;
//   - the ledger: no bytes are kept, and a second picture is a second look —
//     the page may have moved;
//   - the budget: six pictures a turn, and the body's own road;
//   - the status: the closing round's status survives a tool message that
//     carries parts.
//
// Run: node scripts/browser-shot.mjs   (from chat/)

import { rm } from "node:fs/promises";
import { loadApp } from "./lib/app-bundle.mjs";

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
/** Two lists, compared by what is in them. */
function same(actual, expected, label) {
  check(
    JSON.stringify(actual) === JSON.stringify(expected),
    label,
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

// ---------------------------------------------------------------- the world

const storage = new Map();
globalThis.localStorage = {
  get length() {
    return storage.size;
  },
  key: (index) => [...storage.keys()][index] ?? null,
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => void storage.set(key, String(value)),
  removeItem: (key) => void storage.delete(key),
};
Object.defineProperty(globalThis, "navigator", {
  value: { languages: ["en-US"], language: "en-US" },
  configurable: true,
  writable: true,
});

/** The picture the browser answers with. **A big one**, so the body's own
 *  budget is something the turn has to answer for: six of these are more than
 *  a turn's pictures may weigh. */
const DATA = "A".repeat(1_200_000);
/** The page the picture was of. */
const HOST = "shop.example";
const TAKEN_AT = 1760000000000;
/** The line the record keeps: the host and the moment. */
const PLACEHOLDER = `screenshot of ${HOST} at ${new Date(TAKEN_AT).toISOString()}`;

/** The browser's own answers. The picture is JSON: the bytes, the host and the
 *  moment, and the app reads them as they are. */
globalThis.window = {
  setTimeout,
  clearTimeout,
  addEventListener: () => {},
  __TAURI__: {
    core: {
      invoke: async (command) => {
        if (command === "brain_browser_screenshot") {
          return JSON.stringify({
            ok: true,
            image: DATA,
            media_type: "image/jpeg",
            host: HOST,
            taken_at: TAKEN_AT,
          });
        }
        return null;
      },
    },
    event: { listen: async () => () => {} },
  },
};

const { app, dir } = await loadApp();
const {
  useChatTurns,
  LanguageProvider,
  renderToStaticMarkup,
  createElement,
  createStore,
  noteBrowserStatus,
  executeToolCall,
  newLedger,
  filed,
  decide,
  pictureLoad,
  demoteOldestToolPicture,
  BROWSER_SCREENSHOT_NAME,
  MAX_PICTURES_PER_TURN,
  PICTURE_BYTES_PER_TURN,
  WIRE_BODY_BUDGET,
  IMAGE_TOKENS,
} = app;

/** The browser is there. */
noteBrowserStatus({ supported: true, installed: true, size: 0 });

// ---------------------------------------------------------------- the engine

/** What the engine counts for one wire. **A picture is IMAGE_TOKENS**, the
 *  way the real engine counts it, and not its characters: the estimate that
 *  counted a JPEG's base64 as prose would close the turn for space before it
 *  ever reached the body's own budget, and the case under test is that
 *  budget. The constant is the app's own, not a number written here. */
function engineTokens(messages, tools) {
  let prose = 0;
  let images = 0;
  for (const message of messages) {
    if (typeof message.content === "string") {
      prose += message.content.length;
    } else if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type === "image_url") images += 1;
        else prose += part.text.length;
      }
    }
    for (const call of message.tool_calls ?? []) prose += call.function.arguments.length;
    prose += 8;
  }
  if (tools !== undefined) prose += JSON.stringify(tools).length;
  return Math.ceil(prose / 4) + images * IMAGE_TOKENS;
}

/** The requests the turn sent, and the bodies they carried. */
const requests = [];
/** How many times the model asks for a picture before it says something. */
const ASKS = 7;
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(init.body);
  requests.push(body);
  const frames = [
    {
      prompt_progress: {
        total: engineTokens(body.messages, body.tools),
        cache: 0,
        processed: engineTokens(body.messages, body.tools),
        time_ms: 1,
      },
    },
  ];
  // The rounds already answered: one tool result per round that called a tool.
  const done = body.messages.filter((message) => message.role === "tool").length;
  if (body.tool_choice === "none") {
    // The closing round: the calls are over, the answer is in words.
    frames.push({ choices: [{ index: 0, delta: { content: "The page costs 129 euro." } }] });
    frames.push({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
  } else if (done < ASKS) {
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
                function: { name: "browser_screenshot", arguments: "{}" },
              },
            ],
          },
        },
      ],
    });
    frames.push({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
  } else {
    // **A round that says nothing in words and calls nothing.** The loop asks
    // once more, in a round that cannot call anything — that is the round the
    // status rides on.
    frames.push({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
  }
  const text = `${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(text, { headers: { "Content-Type": "text/event-stream" } });
};

// ---------------------------------------------------------------- the turn

const WINDOW = 65536;
const ENDPOINT = "http://127.0.0.1:9/v1/chat/completions";

const store = createStore();
const CONVERSATION = "conv-shot";
const ASSISTANT = "msg-assistant";
const now = Date.now();
store.put({
  id: CONVERSATION,
  title: "Picture",
  createdAt: now,
  updatedAt: now,
  messages: [
    {
      id: "msg-user",
      role: "user",
      content: "Look at the page and tell me the price.",
      createdAt: now,
      // **The turn is the browser's**: the person armed the control for this
      // message, so the browser's tools are the whole offer.
      browserMode: true,
    },
    { id: ASSISTANT, role: "assistant", content: "", createdAt: now },
  ],
});

let engine = null;
function Harness() {
  engine = useChatTurns({
    store,
    announce: () => {},
    contextSizes: { current: new Map([[ENDPOINT, WINDOW]]) },
    saveMailDraft: () => {},
  });
  return null;
}
renderToStaticMarkup(createElement(LanguageProvider, { children: createElement(Harness) }));

console.log("The picture of the page.\n");

await engine.runAssistant(
  CONVERSATION,
  ASSISTANT,
  // **The three conditions, all of them.** The turn is armed (the message
  // carries the flag), the hidden switch is on, and the engine has eyes.
  { endpoint: ENDPOINT, token: "", model: "test-model", webTools: true, browserVision: true },
  true,
  false,
);

// ---------------------------------------------------------------- the gate

console.log("\nThe gate.\n");
{
  /** The gate the registry asks about, and the calls that never touch it. */
  const gate = {
    documents: () => [],
    confirm: async () => {},
    firstSearch: async () => {},
  };
  const refused = await executeToolCall(
    "browser_screenshot",
    {},
    undefined,
    gate,
    [],
    "any-model",
    undefined,
    undefined,
    true,
    "conv-shot",
    null,
    { armed: true, flag: false, vision: true },
  );
  check(!refused.ok, "a call outside the conditions does not run");
  check(
    typeof refused.text === "string" && refused.text.startsWith("Not run:"),
    "and says so in a fixed sentence",
    JSON.stringify(refused.text),
  );
  check(refused.image === undefined, "and brings no picture back");
}

// ---------------------------------------------------------------- the wire

console.log("\nThe wire.\n");
{
  const bodies = requests.map((request) => request.messages);
  const toolMessages = bodies.flat().filter((message) => message.role === "tool");
  const withParts = toolMessages.filter((message) => Array.isArray(message.content));
  check(withParts.length > 0, "the tool result that carries a picture rides as parts");
  const parts = withParts[withParts.length - 1].content;
  equal(parts.length, 2, "the picture rides in two parts");
  equal(parts[0].type, "text", "the first part is the line");
  check(parts[0].text.includes(HOST), "the line names the host the page was on", parts[0].text);
  check(parts[0].text.includes("screenshot of"), "the line says what it is", parts[0].text);
  equal(parts[1].type, "image_url", "the second part is the picture");
  equal(
    parts[1].image_url.url,
    `data:image/jpeg;base64,${DATA}`,
    "the picture rides as a data URI, with no prefix of its own",
  );
  // **No base64 inside a sentence.** Every tool message on the wire is either
  // a plain string or the two parts above.
  const insideText = toolMessages.filter(
    (message) => typeof message.content === "string" && message.content.includes("base64"),
  );
  equal(insideText.length, 0, "no base64 rides inside a sentence");
}

// ---------------------------------------------------------------- the memory

console.log("\nThe memory.\n");
{
  const stored = store.get(CONVERSATION);
  const assistant = stored.messages.find((message) => message.id === ASSISTANT);
  const shots = (assistant.toolRuns ?? []).filter((run) => run.name === "browser_screenshot");
  check(shots.length > 0, "the turn kept a record of the pictures it took");
  const ok = shots.find((run) => run.state === "ok");
  check(ok !== undefined, "and one of them succeeded");
  equal(ok.result, PLACEHOLDER, "the record keeps the line in words");
  check(!ok.result.includes("base64"), "and never a byte of the picture");
  check(
    stored.messages.every((message) => JSON.stringify(message).indexOf(DATA) === -1),
    "and nothing in the store carries the picture's bytes",
  );
}

// ---------------------------------------------------------------- the ledger

console.log("\nThe ledger.\n");
{
  const ledger = newLedger();
  filed(ledger, "browser_screenshot", {}, { text: PLACEHOLDER, ok: true });
  const again = decide(ledger, "browser_screenshot", {});
  check(again.run, "a second picture runs again: the page may have moved");
  const remembered = JSON.stringify([...ledger.ran, ...ledger.failed]);
  check(!remembered.includes("base64"), "the ledger keeps no bytes");
  check(remembered.includes(HOST), "the ledger keeps the line", remembered);
}

// ---------------------------------------------------------------- the budget

console.log("\nThe budget.\n");
{
  check(MAX_PICTURES_PER_TURN === 6, "six pictures a turn");
  check(PICTURE_BYTES_PER_TURN === 6 * 1024 * 1024, "six mebibytes of them");
  // **The seventh is refused with the fixed sentence.** The conversation here
  // carries six pictures already.
  //
  // **The wire is the one the app builds**: the assistant asked six times and
  // the tool answered six times. The count the gate reads is the count of the
  // calls, and a wire carrying the six answers without the six asking is a
  // wire no turn ever had — so the fixture says the asking too.
  const pictures = [
    {
      role: "assistant",
      content: "",
      tool_calls: Array.from({ length: MAX_PICTURES_PER_TURN }, (_, at) => ({
        id: `call-${at}`,
        type: "function",
        function: { name: BROWSER_SCREENSHOT_NAME, arguments: "{}" },
      })),
    },
  ];
  for (let at = 0; at < MAX_PICTURES_PER_TURN; at += 1) {
    pictures.push({
      role: "tool",
      content: [
        { type: "text", text: `screenshot of ${HOST} at ${new Date(TAKEN_AT).toISOString()}` },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${DATA}` } },
      ],
      tool_call_id: `call-${at}`,
    });
  }
  const refused = await executeToolCall(
    "browser_screenshot",
    {},
    undefined,
    { documents: () => [], confirm: async () => {}, firstSearch: async () => {} },
    pictures,
    "any-model",
    undefined,
    undefined,
    true,
    "conv-shot",
    null,
    { armed: true, flag: true, vision: true },
  );
  check(!refused.ok, "the seventh picture of a turn is refused");
  check(
    typeof refused.text === "string" && refused.text.startsWith("Not run:"),
    "with a fixed sentence",
    JSON.stringify(refused.text),
  );
  // **The body never leaves beyond its own road.** The turn above took six
  // pictures of 1.2 MB each: the guard let the oldest go, and every request
  // the turn sent stayed inside the budget.
  const heaviest = Math.max(...requests.map((request) => JSON.stringify(request).length));
  check(
    heaviest <= WIRE_BODY_BUDGET,
    "no request the turn sent was heavier than the body's budget",
    `${heaviest} bytes`,
  );
  const load = pictureLoad(requests[requests.length - 1].messages);
  check(
    load.bytes <= PICTURE_BYTES_PER_TURN,
    "and the pictures on the last wire weigh no more than a turn's may",
    `${load.bytes} bytes`,
  );
  // **The turn took six and the seventh was refused.** The refusals are on the
  // wire in the app's own words, and the model reads them there.
  const refusals = requests
    .flatMap((request) => request.messages)
    .filter((message) => typeof message.content === "string" && message.content.startsWith("Not run:"));
  check(refusals.length > 0, "the seventh picture of the turn was refused in the turn itself");
  check(
    refusals[refusals.length - 1].content.includes("as many pictures of the page as a turn may take"),
    "and it says so in the fixed sentence",
    refusals[refusals.length - 1],
  );
  // **The guard let the oldest picture go**, because six of them are more than
  // a turn's pictures may weigh: the wire keeps the line and not the bytes.
  const demoted = requests
    .flatMap((request) => request.messages)
    .filter(
      (message) =>
        message.role === "tool" &&
        typeof message.content === "string" &&
        message.content.includes("screenshot of"),
    );
  check(demoted.length > 0, "the guard let the oldest picture go and kept its line");
  // **The guard itself, on a wire that is over.** A picture the person's own
  // is never let go; the tool's are.
  const over = [
    { role: "user", content: [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${DATA}` } }] },
    {
      role: "tool",
      content: [
        { type: "text", text: "screenshot of the page" },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${DATA}` } },
      ],
      tool_call_id: "call-x",
    },
  ];
  check(demoteOldestToolPicture(over), "the guard lets a picture go");
  check(
    Array.isArray(over[1].content) === false &&
      over[1].content.startsWith("screenshot of the page") &&
      over[1].content.includes("was let go"),
    "and the tool's picture is the one that goes, its line kept and its absence said",
  );
  check(Array.isArray(over[0].content), "the person's own picture is never touched");

  // **The person's own photographs are not the turn's pictures.** A wire that
  // carries a big photograph of theirs has not taken a picture of the page,
  // and the tool must not answer that it has.
  const heavy = "A".repeat(6_500_000);
  const withTheirs = [
    { role: "user", content: [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${heavy}` } }] },
  ];
  const stillAllowed = await executeToolCall(
    "browser_screenshot",
    {},
    undefined,
    { documents: () => [], confirm: async () => {}, firstSearch: async () => {} },
    withTheirs,
    "any-model",
    undefined,
    undefined,
    true,
    "conv-shot",
    null,
    { armed: true, flag: true, vision: true },
  );
  check(
    stillAllowed.ok === true,
    "a wire that carries only the person's own photograph is not a turn that has taken a picture",
    JSON.stringify(stillAllowed.text),
  );
}

// ---------------------------------------------------------------- the status

console.log("\nThe status.\n");
{
  const last = requests[requests.length - 1];
  const tail = last.messages[last.messages.length - 1];
  equal(tail.role, "user", "the closing round's status is a message of its own");
  check(typeof tail.content === "string" && tail.content.length > 0, "and it says something");
  const toolMessages = last.messages.filter((message) => message.role === "tool");
  check(toolMessages.length > 0, "the tool's messages are still on the closing wire");
  check(
    toolMessages.some((message) => Array.isArray(message.content)),
    "and the one that carries a picture is still parts",
  );
}

// ---------------------------------------------------------------- the control

console.log("\nThe control.\n");
{
  // **The same case without the gate must fail.** The gate is one line in the
  // registry; this build has it switched off, and the call outside the
  // conditions must go through — which is what proves the refusal above was
  // the gate's doing and not the browser's.
  const off = await loadApp({
    compileOut: {
      file: "src/lib/tools/registry.ts",
      from: "if (!picturesAllowed(pictures)) {",
      to: "if (false) {",
    },
  });
  try {
    const answered = await off.app.executeToolCall(
      "browser_screenshot",
      {},
      undefined,
      { documents: () => [], confirm: async () => {}, firstSearch: async () => {} },
      [],
      "any-model",
      undefined,
      undefined,
      true,
      "conv-shot",
      null,
      { armed: true, flag: false, vision: true },
    );
    check(
      answered.ok === true,
      "without the gate the call outside the conditions goes through",
      JSON.stringify(answered.text),
    );
  } finally {
    await rm(off.dir, { recursive: true, force: true });
  }
}

await rm(dir, { recursive: true, force: true });

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
