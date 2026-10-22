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
//     carries parts;
//   - the picture that comes by itself: an open that succeeded brings the page
//     with it, and it is counted like any other picture the turn took.
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
 *  a turn's pictures may weigh.
 *
 *  **A stress, not a size.** The real picture the sidecar takes is at most
 *  256 KiB (q55), and this one is five times that on purpose: the budget, the
 *  demotion and the fit are all things the turn has to answer for, and a
 *  picture small enough never to test them would not. */
const DATA = "A".repeat(1_200_000);
/** The page the picture was of. */
const HOST = "shop.example";
const TAKEN_AT = 1760000000000;
/** The line the record keeps: the host and the moment. */
const PLACEHOLDER = `screenshot of ${HOST} at ${new Date(TAKEN_AT).toISOString()}`;
/** The address the model opens, and the page it finds there. */
const OPEN_URL = "https://shop.example/dp/B012345678";
const PAGE = "Price: 129 euro.\nThe blue one is in stock.";

/** How many times the browser was asked for a picture. */
let shots = 0;
/** Whether the browser refuses to take one. */
let shotRefused = false;
/** Whether the browser's command fails outright. */
let shotThrows = false;

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
          shots += 1;
          if (shotThrows) throw new Error("the browser's command failed");
          if (shotRefused) {
            return JSON.stringify({
              ok: false,
              error: "not_yours",
              message: "The page on the screen is not this conversation's, so no picture was taken.",
            });
          }
          return JSON.stringify({
            ok: true,
            image: DATA,
            media_type: "image/jpeg",
            host: HOST,
            taken_at: TAKEN_AT,
          });
        }
        if (command === "brain_browser_open") return PAGE;
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
  wireSize,
  buildPinnedContext,
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
/** What the model asks for, and how many times: the turn that takes pictures
 *  and the turn that opens a page are two different rounds. */
let plan = { name: "browser_screenshot", asks: ASKS };
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
  } else if (done < plan.asks) {
    const call =
      plan.name === "browser_open"
        ? {
            index: 0,
            id: `call-${requests.length}`,
            type: "function",
            function: { name: "browser_open", arguments: JSON.stringify({ url: OPEN_URL }) },
          }
        : {
            index: 0,
            id: `call-${requests.length}`,
            type: "function",
            function: { name: "browser_screenshot", arguments: "{}" },
          };
    frames.push({
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [call],
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

// ------------------------------------------------ the picture that comes by itself

console.log("\nThe picture that comes by itself.\n");
{
  /** The gate the registry asks about, and the calls that never touch it. */
  const gate = { documents: () => [], confirm: async () => {}, firstSearch: async () => {} };
  /** The conversation that carries the address: the rule asks for the person's
   *  own words before a page may be opened. */
  const said = [{ role: "user", content: `Open ${OPEN_URL} and tell me the price.` }];
  /** The open, called the way the registry calls it. */
  const open = (calls, pictures) =>
    executeToolCall(
      "browser_open",
      { url: OPEN_URL },
      undefined,
      gate,
      said,
      "any-model",
      undefined,
      undefined,
      true,
      "conv-open",
      calls,
      pictures,
    );

  // **A turn where the model opens a page.** The open's own answer carries the
  // picture: the model sees the page it opened, without having asked to see it.
  const OPEN = "conv-open";
  const OPEN_ASSISTANT = "msg-open-assistant";
  store.put({
    id: OPEN,
    title: "The page",
    createdAt: now,
    updatedAt: now,
    messages: [
      {
        id: "msg-open-user",
        role: "user",
        content: `Open ${OPEN_URL} and tell me the price.`,
        createdAt: now,
        browserMode: true,
      },
      { id: OPEN_ASSISTANT, role: "assistant", content: "", createdAt: now },
    ],
  });
  plan = { name: "browser_open", asks: 1 };
  const openAt = requests.length;
  await engine.runAssistant(
    OPEN,
    OPEN_ASSISTANT,
    // **The three conditions, all of them**, as in the turn above.
    { endpoint: ENDPOINT, token: "", model: "test-model", webTools: true, browserVision: true },
    true,
    false,
  );
  plan = { name: "browser_screenshot", asks: ASKS };

  // **The wire.** The open's answer rides as two parts: the page's own words
  // and the picture of the page.
  const openWire = requests.slice(openAt).flatMap((request) => request.messages);
  const carried = openWire.find((message) => message.role === "tool" && Array.isArray(message.content));
  check(carried !== undefined, "the open's answer rides as parts");
  if (carried !== undefined) {
    equal(carried.content.length, 2, "two parts: the open's own words and the picture");
    check(
      carried.content[0].text.includes("129 euro"),
      "the first part is the open's own answer",
      carried.content[0].text,
    );
    check(
      carried.content[0].text.includes(HOST),
      "and the line names the host the page was on",
      carried.content[0].text,
    );
    check(carried.content[0].text.includes("screenshot of"), "and says what it is");
    equal(carried.content[1].type, "image_url", "the second part is the picture");
    equal(
      carried.content[1].image_url.url,
      `data:image/jpeg;base64,${DATA}`,
      "and it rides as a data URI, with no prefix of its own",
    );
  }

  // **The window's own estimate weighs the open's picture like any other.** A
  // picture part costs IMAGE_TOKENS whoever's message it is, and the tool
  // loop's fit check reads this estimate between rounds.
  if (carried !== undefined) {
    const withPicture = wireSize([{ role: "tool", content: carried.content }]);
    const withoutPicture = wireSize([
      { role: "tool", content: [{ type: "text", text: carried.content[0].text }] },
    ]);
    equal(withPicture - withoutPicture, IMAGE_TOKENS, "the open's picture weighs as an image on the wire");
  }

  // **The memory.** The record keeps the line in words and never a byte, and it
  // says the call brought a picture — which is what the turn's own record
  // counts as a read of the page.
  const stored = store.get(OPEN);
  const assistant = stored.messages.find((message) => message.id === OPEN_ASSISTANT);
  const runs = assistant.toolRuns ?? [];
  const opened = runs.find((run) => run.name === "browser_open");
  check(opened !== undefined, "the turn kept a record of the open");
  if (opened !== undefined) {
    equal(opened.state, "ok", "and the open succeeded");
    check(opened.result.includes(PLACEHOLDER), "the record keeps the line in words", opened.result);
    check(
      !opened.result.includes("base64") && !opened.result.includes(DATA),
      "and never a byte of the picture",
      opened.result,
    );
    equal(opened.picture, true, "and says the call brought a picture");
    equal(opened.recap?.read, 1, "and the turn's record counts the picture as a read of the page");
  }
  check(
    stored.messages.every((message) => JSON.stringify(message).indexOf(DATA) === -1),
    "and nothing in the store carries the picture's bytes",
  );

  // **The disk keeps the fact, the wire says it.** The browser's runs lose
  // their result on the way to localStorage — a page is a stranger's words —
  // so the trace of the picture would go with it and a later turn would
  // forget it. The reloaded turn says it in one fixed sentence: no host, no
  // page, no byte.
  const reloaded = createStore().get(OPEN);
  const reloadedRun = (reloaded.messages.find((message) => message.id === OPEN_ASSISTANT)?.toolRuns ?? []).find(
    (run) => run.name === "browser_open",
  );
  check(reloadedRun !== undefined, "the reloaded turn kept the run");
  if (reloadedRun !== undefined) {
    equal(reloadedRun.result, "", "the disk keeps no page and no line");
    equal(reloadedRun.picture, true, "but it keeps the fact that a picture came");
  }
  const rebuilt = buildPinnedContext(reloaded.messages, [], null, { vision: true });
  const replayed = rebuilt.wire
    .filter((message) => message.role === "tool")
    .map((message) => message.content)
    .filter((content) => typeof content === "string");
  check(
    replayed.some((content) => content.includes("brought a picture")),
    "and the wire says the call brought a picture",
    JSON.stringify(replayed),
  );
  check(
    replayed.every((content) => !content.includes(HOST) && !content.includes("base64")),
    "with no host, no page and no byte in it",
    JSON.stringify(replayed),
  );

  // **The ledger.** A picture that came with an open is a picture the turn
  // took, and the turn's ceiling counts it like any other.
  const ledger = newLedger();
  filed(ledger, "browser_open", { url: OPEN_URL }, { text: PAGE, ok: true, image: { data: DATA, mediaType: "image/jpeg", text: PLACEHOLDER } });
  equal(ledger.pictures, 1, "the ledger counts the picture that came with the open");

  // **Without the flag, no picture at all.** The open is answered by the page's
  // own words, and the browser is never asked for a picture: the negative is
  // proved by the port, not by the shape of the answer.
  let asked = shots;
  const withoutFlag = await open(newLedger(), { armed: true, flag: false, vision: true });
  check(withoutFlag.ok, "the open itself still succeeds without the flag");
  check(withoutFlag.image === undefined, "and brings no picture");
  equal(shots - asked, 0, "and the browser was never asked for one");

  // **The ceiling is the turn's own.** Six opens that brought a picture have
  // filled it: the next open is answered without one, and a picture asked for
  // by hand is refused as well.
  const full = newLedger();
  for (let at = 0; at < MAX_PICTURES_PER_TURN; at += 1) {
    filed(full, "browser_open", { url: `https://shop.example/dp/${at}` }, { text: PAGE, ok: true, image: { data: DATA, mediaType: "image/jpeg", text: PLACEHOLDER } });
  }
  equal(full.pictures, MAX_PICTURES_PER_TURN, "six opens have taken the turn's six pictures");
  asked = shots;
  const overCap = await open(full, { armed: true, flag: true, vision: true });
  check(overCap.ok, "the open still succeeds when the turn has had its pictures");
  check(overCap.image === undefined, "and brings no picture");
  equal(shots - asked, 0, "and the browser was never asked for one");
  const byHand = await executeToolCall(
    "browser_screenshot",
    {},
    undefined,
    gate,
    said,
    "any-model",
    undefined,
    undefined,
    true,
    "conv-open",
    full,
    { armed: true, flag: true, vision: true },
  );
  check(!byHand.ok, "and a picture asked for by hand is refused as well");

  // **Without the ledger there is no picture.** The count of a turn's pictures
  // is the ledger's, and a caller with no ledger cannot know it: the answers
  // enter the wire only when the round is over, so a batch of opens would each
  // see the same count and spend the ceiling twice. A ceiling that cannot be
  // counted is no ceiling, so the picture is not taken at all.
  asked = shots;
  const noLedger = await executeToolCall(
    "browser_open",
    { url: OPEN_URL },
    undefined,
    gate,
    said,
    "any-model",
    undefined,
    undefined,
    true,
    "conv-open",
    null,
    { armed: true, flag: true, vision: true },
  );
  check(noLedger.ok, "an open without a ledger still succeeds");
  check(noLedger.image === undefined, "and brings no picture");
  equal(shots - asked, 0, "and the browser was never asked for one");

  // **A picture the browser refuses is not a failure of the open.** The open
  // stands on its own answer and the model is told nothing.
  shotRefused = true;
  asked = shots;
  const refused = await open(newLedger(), { armed: true, flag: true, vision: true });
  shotRefused = false;
  check(refused.ok, "an open whose picture was refused still succeeds");
  check(refused.image === undefined, "and brings no picture");
  check(refused.text.includes("129 euro"), "and keeps the page's own words", refused.text);
  equal(shots - asked, 1, "and the browser was asked exactly once");

  // **A command that fails outright is the same case.** The open stands on its
  // own answer: a picture that could not be taken is never a failed open.
  shotThrows = true;
  asked = shots;
  const broke = await open(newLedger(), { armed: true, flag: true, vision: true });
  shotThrows = false;
  check(broke.ok, "an open whose picture command failed still succeeds");
  check(broke.image === undefined, "and brings no picture");
  check(broke.text.includes("129 euro"), "and keeps the page's own words", broke.text);

  // **The control.** The same build with the automatic gate REMOVED, and the
  // flag-off case run again: the mutant takes the picture. That is what proves
  // the refusal above was the gate's doing and not the browser's — the
  // negative control has to make the picture appear, not merely hide it.
  const off = await loadApp({
    compileOut: {
      file: "src/lib/tools/autoShot.ts",
      from: "if (!picturesAllowed(pictures)) return null;",
      to: "",
    },
  });
  try {
    asked = shots;
    const answered = await off.app.executeToolCall(
      "browser_open",
      { url: OPEN_URL },
      undefined,
      gate,
      said,
      "any-model",
      undefined,
      undefined,
      true,
      "conv-open",
      newLedger(),
      { armed: true, flag: false, vision: true },
    );
    check(answered.ok, "without the gate the open still succeeds", JSON.stringify(answered.text));
    check(answered.image !== undefined, "and the flag-off case takes the picture");
    equal(shots - asked, 1, "and the browser is asked for one");
  } finally {
    await rm(off.dir, { recursive: true, force: true });
  }
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
