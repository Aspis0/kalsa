// The turn's own line, on the turn that ran out of room.
//
// On 21 October 2026 a browser turn that ran out of room kept its rows and
// lost its summary. The line about what the turn did — the recap — was said
// *after* the last write to the store, and the write that would have carried
// it waited on a debounce that the end of the turn cancelled. The rows were
// already in the store; the line never was.
//
// This harness mounts the app's own turn engine — the real hook, the real
// store, the real tool loop, the real transport boundary — and drives one
// browser turn that runs out of room. The line has to be in the store when
// the turn ends, because the store is what the thread draws from.
//
// **Nothing here is a re-implementation.** The hook is the one the chat uses,
// the store is the one the chat writes to, the tool call goes through the
// registry and the door, and the turn closes for space on the loop's own
// terms. Only the engine and the browser are stubs, and they are stubs
// because there is no engine and no browser in a test.
//
// Run: node scripts/recap-space.mjs   (from chat/)

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

// ---------------------------------------------------------------- the world

// **The app is a webview.** The door's calls live on `window`, the
// conversations live in `localStorage`, and the language is the system's.
// All three are here, because the turn engine reads all three.
const storage = new Map();
globalThis.localStorage = {
  get length() {
    return storage.size;
  },
  key: (index) => [...storage.keys()][index] ?? null,
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => {
    storage.set(key, String(value));
  },
  removeItem: (key) => {
    storage.delete(key);
  },
  clear: () => {
    storage.clear();
  },
};
Object.defineProperty(globalThis, "navigator", {
  value: { languages: ["en-US"], language: "en-US" },
  configurable: true,
  writable: true,
});

/** The page the browser answers with. A page's own text, and long enough that
    the window cannot hold it: the turn has to run out of room, because that
    is the path this harness is about. */
const PAGE = "Prezzo 129 euro. Disponibilità: consegna in 3 giorni. ".repeat(700);

/** The page the browser answers with. **A big one, and then a small one**: the
    first turn cannot hold a page at all, and the second one can. */
let pageText = PAGE;

globalThis.window = {
  setTimeout,
  clearTimeout,
  addEventListener: () => {},
  __TAURI__: {
    core: {
      invoke: async (command, args) => {
        if (command === "brain_browser_open") return pageText;
        if (command === "brain_browser_read") return pageText;
        return null;
      },
    },
    event: { listen: async () => () => {} },
  },
};

const { app } = await loadApp();
const {
  useChatTurns,
  LanguageProvider,
  renderToStaticMarkup,
  createElement,
  createStore,
  noteBrowserStatus,
  recapLine,
  TABLES,
  FINAL_STATUS,
} = app;

// **The browser is there.** The offer of the browser's own tools is behind
// what the Settings row last read, and a harness that did not say so would
// offer nothing and turn would have nothing to say.
noteBrowserStatus({ supported: true, installed: true, size: 0 });

// ---------------------------------------------------------------- the engine

/**
 * What the engine counts for one wire.
 *
 * **Two densities, because the content is not one thing.** Prose is four
 * characters to a token; a page's own text is 1.76 — the rate the engine's
 * own count gave on the day (6000 characters of page weighed 3409 tokens).
 * The turn's fit reads this number as the engine's own count of the prompt,
 * so the mock has to count the way the engine counts.
 */
const PROSE_CHARS_PER_TOKEN = 4;
const DENSE_CHARS_PER_TOKEN = 1.76;
function engineTokens(messages, tools) {
  let prose = 0;
  let dense = 0;
  for (const message of messages) {
    const body = typeof message.content === "string" ? message.content : "";
    if (message.role === "tool") dense += body.length;
    else prose += body.length;
    for (const call of message.tool_calls ?? []) prose += call.function.arguments.length;
    prose += 8;
  }
  if (tools !== undefined) dense += JSON.stringify(tools).length;
  return Math.ceil(prose / PROSE_CHARS_PER_TOKEN + dense / DENSE_CHARS_PER_TOKEN);
}

/** The requests the turn sent, and the bodies they carried. */
const requests = [];
/** The address the mock opens. **The front door in the second turn**, which is
    the shape of the cell of 21 October 2026: the site, and not one product's
    page under it. */
let openUrl = "https://example.com/prodotto";
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
  if (body.tool_choice === "none") {
    // The closing round: the calls are over, the answer is in words.
    frames.push({ choices: [{ index: 0, delta: { content: "La pagina costa 129 euro." } }] });
    frames.push({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
  } else {
    frames.push({
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call-1",
                type: "function",
                function: { name: "browser_open", arguments: JSON.stringify({ url: openUrl }) },
              },
            ],
          },
        },
      ],
    });
    frames.push({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
  }
  const text = `${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(text, { headers: { "Content-Type": "text/event-stream" } });
};

// ---------------------------------------------------------------- the turn

/** The window the engine is answering in. Small, so the turn runs out of it. */
const WINDOW = 8192;
const ENDPOINT = "http://127.0.0.1:9/v1/chat/completions";

const store = createStore();
const CONVERSATION = "conv-recap";
const ASSISTANT = "msg-assistant";
const now = Date.now();
store.put({
  id: CONVERSATION,
  title: "Recap",
  createdAt: now,
  updatedAt: now,
  messages: [
    {
      id: "msg-user",
      role: "user",
      content: "Apri https://example.com/prodotto e dimmi prezzo e disponibilità.",
      createdAt: now,
      // **The turn is the browser's.** The person armed the control for this
      // message, so the browser's tools are the whole offer.
      browserMode: true,
    },
    { id: ASSISTANT, role: "assistant", content: "", createdAt: now },
  ],
});

/** The turn engine, mounted. */
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
renderToStaticMarkup(
  createElement(LanguageProvider, { children: createElement(Harness) }),
);

console.log("The turn that ran out of room: the line about what it did.\n");

await engine.runAssistant(
  CONVERSATION,
  ASSISTANT,
  { endpoint: ENDPOINT, token: "", model: "test-model", webTools: true },
  false,
  false,
);

// **What is in the store now.** Read back through the store, so the line is
// read off the disk the chat draws from and not out of a live buffer.
const stored = store.get(CONVERSATION);
const answer = stored?.messages.find((message) => message.id === ASSISTANT);
const runs = answer?.toolRuns ?? [];
const lastBrowser = [...runs].reverse().find((run) => run.name.startsWith("browser_"));
const said = lastBrowser?.recap;

console.log(`  the turn made ${runs.length} run(s): ${runs.map((run) => run.name).join(", ")}`);
console.log(`  the turn closed for space: ${answer?.closedForSpace === true}`);
console.log(`  the recap on the last browser run: ${said === undefined ? "none" : JSON.stringify(said)}\n`);

// ---------------------------------------------------------------------------
console.log("1. the turn ran out of room, and said so");

check(answer !== undefined, "the turn left an answer in the store");
equal(answer?.failed, undefined, "the turn did not fail");
equal(answer?.closedForSpace, true, "the turn says it closed for space");
check(
  requests.length >= 2,
  "the turn sent more than one request",
  `${requests.length} requests`,
);
const closing = requests[requests.length - 1];
equal(closing.tool_choice, "none", "the closing request forbids the calls");
check(
  String(closing.messages[closing.messages.length - 1].content).includes(FINAL_STATUS),
  "the closing request carries the execution status",
);

// ---------------------------------------------------------------------------
console.log("\n2. the line about what the turn did is in the store");

check(runs.length > 0, "the turn's runs are in the store");
check(lastBrowser !== undefined, "the last browser run is in the store");
check(said !== undefined, "**and it carries the line about what the turn did**");
const line = said === undefined ? "" : recapLine(said, TABLES.en.tools.recap);
check(line.trim() !== "", "the line has words in it", JSON.stringify(line));
// **"opened a page", and not the site's name.** The host is one field the disk
// does not keep (`store.ts` strips it when the record is written), so a
// reloaded chat says "a page" and says nothing false about it.
check(
  line.includes(TABLES.en.tools.recap.openedSome),
  "and it says the turn opened a page",
  JSON.stringify(line),
);

// ---------------------------------------------------------------------------
console.log("\n2b. the closing request carries the record of what the turn did");

// **The first turn read no page at all.** The page did not fit the window, so
// the model never saw one: the closing request carries the thread the engine
// read, and that thread has no page in it. The record has nothing to say, and
// says nothing — a record of a page the model did not see is a record of
// something it cannot speak of.
const closingStatus = String(closing.messages[closing.messages.length - 1].content);
check(
  closingStatus.includes(FINAL_STATUS),
  "the closing request still carries the execution status",
  closingStatus,
);
check(
  !closingStatus.includes("[Kalsa turn record]"),
  "and no record: the turn's one page never reached the model",
  closingStatus,
);

// **The second turn, with a page the window can hold.** The turn opens a
// site's front door and reads it, and the final round has to carry the
// record: the counts the app's own runs stand for, and the sentence that
// names what was never opened.
{
  openUrl = "https://example.com/";
  pageText = "Prezzo 129 euro. Disponibilità: consegna in 3 giorni.";
  const home = createStore();
  home.put({
    id: "conv-home",
    title: "Home",
    createdAt: now,
    updatedAt: now,
    messages: [
      {
        id: "msg-home-user",
        role: "user",
        content: "Apri https://example.com/ e dimmi cosa c'è.",
        createdAt: now,
        browserMode: true,
      },
      { id: "msg-home-assistant", role: "assistant", content: "", createdAt: now },
    ],
  });
  let homeEngine = null;
  function HomeHarness() {
    homeEngine = useChatTurns({
      store: home,
      announce: () => {},
      contextSizes: { current: new Map([[ENDPOINT, WINDOW]]) },
      saveMailDraft: () => {},
    });
    return null;
  }
  renderToStaticMarkup(
    createElement(LanguageProvider, { children: createElement(HomeHarness) }),
  );
  await homeEngine.runAssistant(
    "conv-home",
    "msg-home-assistant",
    { endpoint: ENDPOINT, token: "", model: "test-model", webTools: true },
    false,
    false,
  );
  const homeClosing = requests[requests.length - 1];
  const homeStatus = String(homeClosing.messages[homeClosing.messages.length - 1].content);
  check(
    homeStatus.includes(FINAL_STATUS),
    "the final round of the turn that had a page carries the execution status",
    homeStatus,
  );
  check(
    homeStatus.includes("[Kalsa turn record]"),
    "and the record of what the turn did goes with it",
    homeStatus,
  );
  check(
    homeStatus.includes("The browser opened 1 page (asked for example.com)"),
    "and it names the page the turn opened, with its host",
    homeStatus,
  );
  check(
    homeStatus.includes("No detail page of any product was opened in this turn."),
    "and it says out loud that no product's page was among them",
    homeStatus,
  );
  check(
    homeStatus.includes("Answer only from what those pages actually showed; say what was not verified."),
    "and it closes with the instruction the answer has to follow",
    homeStatus,
  );

  // **The negative control.** The same turn on a build with the record
  // compiled out of it: the status is there and the record is not.
  const blind = await loadApp({
    compileOut: {
      file: "toolLoop.ts",
      from: "const status = finalStatus(recordRuns);",
      to: "const status = FINAL_STATUS;",
    },
  });
  try {
    await blind.app.streamChatCompletion({
      endpoint: ENDPOINT,
      token: "",
      model: "test-model",
      sampling: { temperature: 0.2 },
      signal: new AbortController().signal,
      messages: [
        { role: "system", content: "You are a browser." },
        { role: "user", content: "Apri https://example.com/ e dimmi cosa c'è." },
      ],
      tools: blind.app.BROWSER_TOOLS,
      runTool: async () => ({ text: pageText, ok: true }),
      contextFit: {
        budget: WINDOW - blind.app.ANSWER_RESERVE_TOKENS,
        size: blind.app.wireSize,
        definitions: blind.app.definitionsTokens(blind.app.BROWSER_TOOLS),
      },
      onToken: () => {},
      onToolRun: () => {},
      onClosedForSpace: () => {},
    });
    const blindStatus = String(requests[requests.length - 1].messages.at(-1).content);
    check(blindStatus.includes(FINAL_STATUS), "with the record compiled out the status is still there");
    check(
      !blindStatus.includes("[Kalsa turn record]"),
      "and the record is not — the checks above would fail",
      blindStatus,
    );
  } finally {
    await rm(blind.dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
console.log("\n3. the line is the one the thread would draw");

// **The same record, read the way the thread reads it.** The thread finds the
// last run that carries a recap and draws the line from it
// (components/ToolActivity.tsx) — so a store that has the record is a thread
// that draws the line.
const drawn = [...runs].reverse().find((run) => run.recap !== undefined)?.recap;
check(drawn !== undefined, "the thread's own rule finds the line");
equal(
  drawn === undefined ? null : JSON.stringify(drawn),
  said === undefined ? null : JSON.stringify(said),
  "and it is the same record",
);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
